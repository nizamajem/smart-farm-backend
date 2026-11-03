import { BadGatewayException, BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device, HaRelayMap, RELAY_KEYS } from '../devices/device.entity';
import { RelayCommand } from '../devices/relay-command.entity';
import { MAX_ON_MS } from '../devices/dto';
import { logHub } from '../logs/log-hub';
import { SettingsService } from '../settings/settings.service';
import type { HaState } from './home-assistant.service';

const NAMES = ['Larutan A', 'Larutan B', 'pH Up', 'pH Down'];
const validEntity = (id: string) => /^(switch|light)\.[a-z0-9_]+$/.test(id);
export const MAX_MIX_ON_MS = 60_000;
export const MAX_PH_ON_MS = 3_600_000;

/** Direct HA commands have their own route; they never enter the MQTT/HTTP queue. */
@Injectable()
export class HaRelayService implements OnModuleDestroy {
  private readonly active = new Map<string, { cancel: () => void; finished: Promise<void> }>();
  private saving = false;
  private stopping = false;
  private readonly mcbBusy = new Set<number>();
  private readonly manualBusy = new Set<number>();
  private readonly mixes = new Map<number, { token: symbol; cancelled: boolean; kind: 'mix' | 'ph' }>();

  reserveMix(id: number, kind: 'mix' | 'ph' = 'mix') {
    if (this.saving || this.stopping || this.mixes.has(id) || this.manualBusy.has(id)) throw new ConflictException('Kontrol panel sedang digunakan');
    const token = Symbol('mix');
    this.mixes.set(id, { token, cancelled: false, kind });
    return token;
  }
  mixCancelled(id: number, token: symbol) { return this.mixes.get(id)?.token !== token || !!this.mixes.get(id)?.cancelled; }
  releaseMix(id: number, token: symbol) { if (this.mixes.get(id)?.token === token) this.mixes.delete(id); }
  async cancelMix(device: Device, kind?: 'mix' | 'ph') {
    const mix = this.mixes.get(device.id);
    if (mix) mix.cancelled = true;
    for (const id of Object.values(device.haRelays || {})) this.active.get(id)?.cancel();
    const keys = (kind ?? mix?.kind) === 'ph' ? ['relay3', 'relay4'] as const : ['relay1', 'relay2'] as const;
    await Promise.all(keys.map(key => device.haRelays?.[key]).filter((id): id is string => !!id).map(id => this.turnOff(id)));
  }

  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly settings: SettingsService,
  ) {}

  private async request<T>(path: string, data?: object): Promise<T> {
    const base = (process.env.HA_BASE_URL || '').replace(/\/+$/, '');
    if (!base || !process.env.HA_TOKEN) throw new ServiceUnavailableException('Home Assistant belum dikonfigurasi');
    try {
      const response = await fetch(`${base}/api${path}`, {
        method: data ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${process.env.HA_TOKEN}`, 'Content-Type': 'application/json' },
        ...(data ? { body: JSON.stringify(data) } : {}),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json() as T;
    } catch (e) {
      logHub.push('ha', 'error', 'Relay', `${data ? 'POST' : 'GET'} ${path}: ${(e as Error).message}`);
      throw new BadGatewayException(`Home Assistant gagal merespons: ${(e as Error).message}`);
    }
  }

  async choices() {
    const states = await this.request<HaState[]>('/states');
    return states.filter((s) => validEntity(s.entity_id)).map((s) => ({
      entity_id: s.entity_id, state: s.state, attributes: { friendly_name: s.attributes?.friendly_name }, last_updated: s.last_updated,
    }));
  }

  async saveMapping(deviceId: number, map: HaRelayMap) {
    if (this.mixes.has(deviceId)) throw new ConflictException('Hentikan campuran sebelum mengubah relay');
    if (this.saving || this.manualBusy.size) throw new ConflictException('Kontrol relay sedang digunakan, coba lagi');
    this.saving = true;
    try {
      const device = await this.devices.findOneBy({ id: deviceId });
      if (!device) throw new NotFoundException('Perangkat tidak ditemukan');
      const cleaned: HaRelayMap = {};
      for (const key of RELAY_KEYS) {
        const id = map[key]?.trim();
        if (!id) continue;
        if (!validEntity(id)) throw new BadRequestException('Pilih entity switch atau light untuk relay');
        cleaned[key] = id;
      }
      const ids = Object.values(cleaned);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Satu entity hanya boleh dipakai oleh satu kanal');
      const previous = Object.values(device.haRelays || {});
      if ([...previous, ...ids].some((id) => this.active.has(id))) throw new ConflictException('Tunggu uji relay selesai sebelum mengubah pemetaan');
      if (previous.length) {
        const states = await this.choices();
        if (states.some(state => previous.includes(state.entity_id) && state.state === 'on')) throw new ConflictException('Matikan relay sebelum mengubah pemetaan');
      }
      if (ids.length) {
        const states = await this.choices();
        if (ids.some((id) => !states.some((s) => s.entity_id === id))) throw new BadRequestException('Entity relay tidak ditemukan di Home Assistant. Muat ulang daftar entity.');
        const other = await this.devices.find();
        if (other.some((d) => (d.haMcbEntity && ids.includes(d.haMcbEntity)) || (d.id !== deviceId && Object.values(d.haRelays || {}).some((id) => ids.includes(id))))) {
          throw new BadRequestException('Entity relay sudah dipakai panel lain');
        }
      }
      await this.devices.update(deviceId, {
        haRelays: ids.length ? cleaned : null,
        ...(ids.length ? { relayLabels: [...NAMES] } : {}),
      });
      return this.devices.findOneByOrFail({ id: deviceId });
    } finally { this.saving = false; }
  }

  async status(device: Device) {
    const ids = Object.values(device.haRelays || {});
    const states = ids.length ? await this.choices() : [];
    return RELAY_KEYS.map((key, index) => {
      const entityId = device.haRelays?.[key] || null;
      const state = states.find((s) => s.entity_id === entityId);
      return {
        relay: index + 1, entityId,
        state: state?.state === 'on' || state?.state === 'off' ? state.state : entityId ? 'unavailable' : 'unmapped',
        friendlyName: state?.attributes.friendly_name || entityId,
        updatedAt: state?.last_updated || null,
      };
    });
  }

  async saveMcbMapping(deviceId: number, entityId: string) {
    if (this.saving || this.mcbBusy.has(deviceId)) throw new ConflictException('Tunggu perintah selesai');
    this.saving = true;
    try {
      const device = await this.devices.findOneBy({ id: deviceId });
      if (!device) throw new NotFoundException('Perangkat tidak ditemukan');
      if (entityId) {
        if (!/^switch\.[a-z0-9_]+$/.test(entityId)) throw new BadRequestException('Pilih entity switch untuk Smart MCB');
        const choices = await this.choices();
        if (!choices.some(s => s.entity_id === entityId)) throw new BadRequestException('Entity MCB tidak ditemukan di Home Assistant');
        const all = await this.devices.find();
        if (all.some(d => Object.values(d.haRelays || {}).includes(entityId) || (d.id !== deviceId && d.haMcbEntity === entityId))) {
          throw new BadRequestException('Entity sudah digunakan oleh relay atau MCB panel lain');
        }
      }
      await this.devices.update(deviceId, { haMcbEntity: entityId || null });
      return this.devices.findOneByOrFail({ id: deviceId });
    } finally { this.saving = false; }
  }

  async mcbStatus(device: Device) {
    const entityId = device.haMcbEntity;
    const states = entityId || Object.values(device.haMcbSensors || {}).some(Boolean) ? await this.request<HaState[]>('/states') : [];
    const state = states.find(s => s.entity_id === entityId);
    const metric = (id: string | undefined, kind: 'power' | 'energy') => {
      const s = states.find(s => s.entity_id === id);
      if (!s || !s.state.trim() || !Number.isFinite(Number(s.state)) || Number(s.state) < 0) return null;
      const units: Record<string, number | undefined> = kind === 'power' ? { W: 1, kW: 1000 } : { Wh: .001, kWh: 1 };
      const factor = units[s.attributes.unit_of_measurement || ''];
      if (factor == null) return null;
      const value = Number(s.state) * factor;
      return Number.isFinite(value) ? { value, updatedAt: s.last_updated || null } : null;
    };
    return {
      entityId,
      state: state?.state === 'on' || state?.state === 'off' ? state.state : entityId ? 'unavailable' : 'unmapped',
      friendlyName: state?.attributes.friendly_name || entityId,
      updatedAt: state?.last_updated || null,
      power: metric(device.haMcbSensors?.power, 'power'),
      energy: metric(device.haMcbSensors?.energy, 'energy'),
    };
  }

  async saveMcbSensors(id: number, sensors: { power: string; energy: string }) {
    const states = sensors.power || sensors.energy ? await this.request<HaState[]>('/states') : [];
    for (const key of ['power', 'energy'] as const) {
      if (!sensors[key]) continue;
      const state = states.find(s => s.entity_id === sensors[key]);
      const units = key === 'power' ? ['W', 'kW'] : ['Wh', 'kWh'];
      if (!state || !units.includes(state.attributes.unit_of_measurement || '')) throw new BadRequestException(`Pilih sensor ${key === 'power' ? 'daya W/kW' : 'energi Wh/kWh'} yang sesuai`);
    }
    if (sensors.power && sensors.power === sensors.energy) throw new BadRequestException('Sensor daya dan energi harus berbeda');
    const selected = Object.values(sensors).filter(Boolean);
    if ((await this.devices.find()).some(d => d.id !== id && Object.values(d.haMcbSensors || {}).some(entity => selected.includes(entity)))) throw new BadRequestException('Sensor listrik sudah dipakai panel lain');
    await this.devices.update(id, { haMcbSensors: { power: sensors.power || undefined, energy: sensors.energy || undefined } });
    return this.devices.findOneByOrFail({ id });
  }

  async executeMcb(deviceId: number, action: 'ON' | 'OFF') {
    if (this.saving || this.stopping || this.mcbBusy.has(deviceId)) throw new ConflictException('MCB sedang menerima perintah');
    this.mcbBusy.add(deviceId);
    try {
      const device = await this.devices.findOneBy({ id: deviceId });
      if (!device?.haMcbEntity) throw new BadRequestException('Smart MCB belum dipetakan');
      if (action === 'ON' && !(await this.settings.getBool('ha.enabled'))) throw new ServiceUnavailableException('Integrasi Home Assistant sedang dimatikan');
      await this.set(device.haMcbEntity, action === 'ON');
      return this.mcbStatus(device);
    } finally { this.mcbBusy.delete(deviceId); }
  }

  /** Persistent manual switches are separate from calibrated timed dosing. */
  async manualSwitch(deviceId: number, relay: number, action: 'ON' | 'OFF') {
    if (![1, 2, 3, 4].includes(relay) || !['ON', 'OFF'].includes(action)) throw new BadRequestException('Relay atau aksi tidak valid');
    if (this.manualBusy.has(deviceId) || this.saving || this.stopping) throw new ConflictException('Kontrol panel sedang digunakan');
    if (action === 'ON' && this.mixes.has(deviceId)) throw new ConflictException('Tunggu dosing selesai');
    this.manualBusy.add(deviceId);
    try {
      const device = await this.devices.findOneByOrFail({ id: deviceId });
      const entity = device.haRelays?.[RELAY_KEYS[relay - 1]];
      if (!entity || !validEntity(entity)) throw new BadRequestException('Relay belum terhubung ke Home Assistant');
      if (action === 'ON') {
        if (!(await this.settings.getBool('ha.enabled'))) throw new ServiceUnavailableException('Integrasi Home Assistant sedang dimatikan');
        if (Object.values(device.haRelays || {}).some(id => this.active.has(id)) || this.mixes.has(deviceId)) throw new ConflictException('Tunggu dosing selesai');
        await this.set(entity, true);
      } else {
        await this.execute({ deviceId, relay, action: 'OFF' } as RelayCommand, entity);
      }
      return this.status(device);
    } finally { this.manualBusy.delete(deviceId); }
  }

  private async set(entityId: string, on: boolean) {
    const domain = entityId.split('.')[0];
    await this.request(`/services/${domain}/${on ? 'turn_on' : 'turn_off'}`, { entity_id: entityId });
    logHub.push('ha', 'info', 'Relay', `${entityId}: ${on ? 'ON' : 'OFF'} dikirim ke Home Assistant`);
  }

  private async turnOff(entityId: string) {
    let failure: unknown;
    for (let i = 0; i < 3; i++) {
      try { await this.set(entityId, false); return; }
      catch (e) { failure = e; }
    }
    throw failure;
  }

  async execute(command: RelayCommand, entityId: string, mixToken?: symbol) {
    if (!validEntity(entityId)) throw new BadRequestException('Entity relay tidak valid');
    if (command.action === 'OFF') {
      const mix = this.mixes.get(command.deviceId);
      if (mix && !mixToken) mix.cancelled = true;
      this.active.get(entityId)?.cancel();
      await this.turnOff(entityId);
      return;
    }
    const mix = this.mixes.get(command.deviceId);
    if (mix && (mix.token !== mixToken || mix.cancelled)) throw new ConflictException('Campuran sedang berjalan atau dihentikan');
    if (mixToken && !mix) throw new ConflictException('Sesi campuran berakhir');
    if (this.stopping || this.saving) throw new ConflictException('Relay belum siap menerima uji');
    if (!(await this.settings.getBool('ha.enabled'))) throw new ServiceUnavailableException('Integrasi Home Assistant sedang dimatikan');
    if (this.active.has(entityId)) throw new ConflictException('Relay ini sedang diuji. Tunggu selesai atau kirim Matikan.');
    // One dosing channel per panel at a time, including pH Up vs pH Down.
    const device = await this.devices.findOneBy({ id: command.deviceId });
    if (!device || device.haRelays?.[RELAY_KEYS[command.relay - 1]] !== entityId) throw new ConflictException('Pemetaan berubah. Muat ulang panel.');
    if (Object.values(device.haRelays || {}).some((id) => this.active.has(id))) throw new ConflictException('Tunggu kanal dosing lain selesai sebelum memulai uji');
    if (this.stopping || this.saving || Object.values(device.haRelays || {}).some((id) => this.active.has(id))) throw new ConflictException('Kanal dosing sedang digunakan');
    let cancel!: () => void;
    let finish!: () => void;
    let wasCancelled = false;
    let attemptedOn = false;
    let timer: NodeJS.Timeout | undefined;
    const cancelled = new Promise<void>((resolve) => { cancel = () => { wasCancelled = true; resolve(); }; });
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    this.active.set(entityId, { cancel, finished });
    try {
      const state = await this.request<HaState>(`/states/${encodeURIComponent(entityId)}`);
      if (wasCancelled) return;
      if (state.state !== 'off') throw new ConflictException('Relay harus berstatus Mati sebelum uji. Periksa status atau kirim Matikan terlebih dahulu.');
      const current = await this.devices.findOneBy({ id: command.deviceId });
      if (current?.haRelays?.[RELAY_KEYS[command.relay - 1]] !== entityId) throw new ConflictException('Pemetaan berubah. Muat ulang panel.');
      if (wasCancelled) return;
      attemptedOn = true;
      await this.set(entityId, true);
      const remaining = Math.min(command.durationMs, mixToken ? (mix?.kind === 'ph' ? MAX_PH_ON_MS : MAX_MIX_ON_MS) : MAX_ON_MS);
      await Promise.race([cancelled, new Promise<void>((resolve) => { timer = setTimeout(resolve, remaining); })]);
    } finally {
      clearTimeout(timer);
      try { if (attemptedOn) await this.turnOff(entityId); }
      finally { this.active.delete(entityId); finish(); }
    }
  }

  async onModuleDestroy() {
    this.stopping = true;
    const pending = [...this.active.values()];
    pending.forEach((p) => p.cancel());
    await Promise.allSettled(pending.map((p) => p.finished));
  }
}
