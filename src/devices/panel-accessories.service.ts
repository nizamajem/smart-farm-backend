import { BadGatewayException, BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from './device.entity';
import { SettingsService } from '../settings/settings.service';
import { AccessoryCommand, defaultAccessories, PanelAccessories } from './panel-accessories';
import type { HaState } from '../home-assistant/home-assistant.service';

@Injectable()
export class PanelAccessoriesService {
  private busy = new Set<number>();
  private saving = false;
  constructor(@InjectRepository(Device) private devices: Repository<Device>, private settings: SettingsService) {}

  private async request(path: string, body?: object): Promise<HaState[]> {
    const base = (process.env.HA_BASE_URL || '').replace(/\/+$/, '');
    if (!base || !process.env.HA_TOKEN) throw new ServiceUnavailableException('Home Assistant belum dihubungkan.');
    try {
      const response = await fetch(`${base}/api${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${process.env.HA_TOKEN}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error();
      return await response.json();
    } catch { throw new BadGatewayException('Panel belum merespons. Perbarui status sebelum mencoba lagi.'); }
  }

  async save(device: Device, config: PanelAccessories) {
    if (this.saving || this.busy.size) throw new ConflictException('Tunggu perintah selesai.');
    this.saving = true;
    this.busy.add(device.id);
    try {
      if (!config.level || !config.valve) throw new BadRequestException('Lengkapi pengaturan level air dan valve.');
      // Rebuild only fields supported by each device type.
      const clean: PanelAccessories = {
        plugs: config.plugs.map(p => ({ name: p.name.trim(), entity: p.entity || '' })),
        valve: { name: config.valve.name.trim(), entity: config.valve.entity || '' },
        level: { name: config.level.name.trim(), status: config.level.status || '', depth: config.level.depth || '' },
        soils: config.soils.map(s => ({ name: s.name.trim(), moisture: s.moisture || '', temperature: s.temperature || '' })),
      };
      if ([...clean.plugs, clean.valve, clean.level, ...clean.soils].some(p => !p.name)) throw new BadRequestException('Isi nama setiap perlengkapan.');
      const switches = [...clean.plugs, clean.valve].map(p => p.entity).filter(Boolean) as string[];
      if (new Set(switches).size !== switches.length) throw new BadRequestException('Pilih entity berbeda untuk setiap kontrol.');
      const all = await this.devices.find();
      const used = all.flatMap(d => [...Object.values(d.haRelays || {}), d.haMcbEntity,
        ...(d.id === device.id ? [] : [...(d.accessories?.plugs || []).map(p => p.entity), d.accessories?.valve?.entity])]);
      if (switches.some(id => used.includes(id))) throw new BadRequestException('Entity kontrol sudah digunakan. Pilih entity lain.');
      const ids = Object.values(clean).flatMap(v => Array.isArray(v) ? v : [v])
        .flatMap(v => Object.entries(v).filter(([key]) => key !== 'name').map(([, value]) => value)).filter(Boolean);
      const previous = [...(device.accessories?.plugs || []), device.accessories?.valve].map(p => p?.entity).filter(Boolean);
      if (ids.length || previous.length) {
        const states = await this.request('/states');
        if (previous.some(id => !switches.includes(id!) && states.some(s => s.entity_id === id && s.state === 'on'))) throw new ConflictException('Matikan perangkat sebelum mengganti entity kontrolnya.');
        if (ids.some(id => !states.some(s => s.entity_id === id))) throw new BadRequestException('Ada entity yang tidak ditemukan. Muat ulang daftar entity.');
      }
      await this.devices.update(device.id, { accessories: clean });
      return clean;
    } finally { this.saving = false; this.busy.delete(device.id); }
  }

  async status(device: Device) {
    const config = device.accessories || defaultAccessories();
    const configured = [...config.plugs, config.valve, config.level, ...config.soils]
      .some(p => Object.entries(p).some(([key, value]) => key !== 'name' && !!value));
    const states = configured ? await this.request('/states') : [];
    const read = (id?: string, numeric = false) => {
      const state = states.find(s => s.entity_id === id);
      const available = !!state && !['unknown', 'unavailable', ''].includes(state.state);
      const n = available && numeric ? Number(state.state) : null;
      return { entityId: id || null, state: available ? state!.state : null,
        value: n !== null && Number.isFinite(n) ? n : null,
        unit: state?.attributes?.unit_of_measurement || null, updatedAt: state?.last_updated || null };
    };
    return {
      plugs: config.plugs.map((p, i) => ({ key: `plug${i + 1}`, name: p.name, ...read(p.entity) })),
      valve: { key: 'valve', name: config.valve.name, ...read(config.valve.entity) },
      level: { name: config.level.name, status: read(config.level.status), depth: read(config.level.depth, true) },
      soils: config.soils.map(s => ({ name: s.name, moisture: read(s.moisture, true), temperature: read(s.temperature, true) })),
    };
  }

  async command(device: Device, dto: AccessoryCommand) {
    if (this.saving || this.busy.has(device.id)) throw new ConflictException('Tunggu perintah selesai.');
    this.busy.add(device.id);
    try {
      if (dto.action === 'ON' && !(await this.settings.getBool('ha.enabled'))) throw new ServiceUnavailableException('Integrasi Home Assistant sedang dimatikan.');
      const config = device.accessories || defaultAccessories();
      const entity = dto.key === 'valve' ? config.valve.entity : config.plugs[dto.key === 'plug1' ? 0 : 1].entity;
      if (!entity) throw new BadRequestException('Kontrol ini belum dihubungkan.');
      const before = (await this.request('/states')).find(s => s.entity_id === entity);
      if (!before || !['on', 'off'].includes(before.state)) throw new BadRequestException('Perangkat belum tersedia. Periksa sambungannya.');
      await this.request(`/services/switch/turn_${dto.action === 'ON' ? 'on' : 'off'}`, { entity_id: entity });
      const result = await this.status(device);
      const state = dto.key === 'valve' ? result.valve : result.plugs[dto.key === 'plug1' ? 0 : 1];
      if (state.state !== dto.action.toLowerCase()) throw new BadGatewayException('Perintah terkirim, tetapi status belum terkonfirmasi. Perbarui status.');
      return result;
    } finally { this.busy.delete(device.id); }
  }
}
