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

/** Direct HA commands have their own route; they never enter the MQTT/HTTP queue. */
@Injectable()
export class HaRelayService implements OnModuleDestroy {
  private readonly active = new Map<string, { cancel: () => void; finished: Promise<void> }>();
  private saving = false;
  private stopping = false;

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
    if (this.saving) throw new ConflictException('Pemetaan sedang disimpan, coba lagi');
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
      if (ids.length) {
        const states = await this.choices();
        if (ids.some((id) => !states.some((s) => s.entity_id === id))) throw new BadRequestException('Entity relay tidak ditemukan di Home Assistant. Muat ulang daftar entity.');
        const other = await this.devices.find();
        if (other.some((d) => d.id !== deviceId && Object.values(d.haRelays || {}).some((id) => ids.includes(id)))) {
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

  async execute(command: RelayCommand, entityId: string) {
    if (!validEntity(entityId)) throw new BadRequestException('Entity relay tidak valid');
    if (command.action === 'OFF') {
      this.active.get(entityId)?.cancel();
      await this.turnOff(entityId);
      return;
    }
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
      const started = Date.now();
      attemptedOn = true;
      await this.set(entityId, true);
      const remaining = Math.max(0, Math.min(command.durationMs, MAX_ON_MS) - (Date.now() - started));
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
