import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device, HA_METRICS, HaEntityMap } from '../devices/device.entity';
import { SensorReading } from '../devices/sensor-reading.entity';
import { SettingsService } from '../settings/settings.service';

export interface HaState {
  entity_id: string;
  state: string;
  attributes: {
    friendly_name?: string;
    unit_of_measurement?: string;
    device_class?: string;
    [key: string]: unknown;
  };
  last_changed: string;
  last_updated: string;
  /** HA ≥ 2024.3: diperbarui walau nilainya sama */
  last_reported?: string;
}

export interface HaReading {
  entity_id: string;
  friendly_name: string;
  value: number | null;
  unit: string;
  device_class: string | null;
  last_updated: string;
}

const toNumber = (state?: string) => {
  if (state == null || state === 'unavailable' || state === 'unknown') return null;
  const n = parseFloat(state);
  return Number.isFinite(n) ? n : null;
};

const toReading = (s: HaState): HaReading => ({
  entity_id: s.entity_id,
  friendly_name: s.attributes?.friendly_name || s.entity_id,
  value: toNumber(s.state),
  unit: s.attributes?.unit_of_measurement || '',
  device_class: s.attributes?.device_class || null,
  last_updated: s.last_updated,
});

/**
 * Integrasi Home Assistant lewat REST API (long-lived access token).
 * Entity HA dipetakan ke metrik perangkat (Device.haEntities) dan disalin berkala ke sensor_readings.
 */
@Injectable()
export class HomeAssistantService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('HomeAssistant');
  private timer?: NodeJS.Timeout;
  private syncing = false;
  /** Statistik untuk halaman Integrasi */
  lastSyncAt: Date | null = null;
  lastSyncResult: { devices: number; inserted: number; skipped: { deviceId: number; reason: string }[] } | null = null;
  lastSyncError: string | null = null;
  readonly intervalSec = Number(process.env.HA_SYNC_INTERVAL_SEC ?? 300);

  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(SensorReading) private readonly readings: Repository<SensorReading>,
    private readonly settings: SettingsService,
  ) {}

  private get baseUrl() {
    return (process.env.HA_BASE_URL ?? '').replace(/\/+$/, '');
  }

  get configured() {
    return !!this.baseUrl && !!process.env.HA_TOKEN;
  }

  onModuleInit() {
    const seconds = this.intervalSec;
    if (!this.configured || !(seconds > 0)) return;
    // Timer selalu jalan bila HA dikonfigurasi; saklar "ha.enabled" (halaman Integrasi) menentukan sync dilakukan atau tidak
    this.timer = setInterval(async () => {
      if (!(await this.settings.getBool('ha.enabled'))) return;
      this.sync().catch((e) => this.log.warn(`Sync dilewati: ${(e as Error).message}`));
    }, seconds * 1000);
    this.log.log(`Sync tiap ${seconds} detik dari ${this.baseUrl}`);
  }

  isEnabled() {
    return this.settings.getBool('ha.enabled');
  }

  setEnabled(enabled: boolean) {
    return this.settings.setBool('ha.enabled', enabled);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // ---------- baca dari Home Assistant ----------

  async health() {
    if (!this.configured) {
      return { status: 'not_configured', message: 'HA_BASE_URL / HA_TOKEN belum diisi' };
    }
    try {
      const res = await this.request<{ message?: string }>('/');
      return { status: 'ok', message: res.message, baseUrl: this.baseUrl };
    } catch (e) {
      return { status: 'error', message: (e as Error).message, baseUrl: this.baseUrl };
    }
  }

  async states(domain?: string) {
    const all = await this.request<HaState[]>('/states');
    return domain ? all.filter((s) => s.entity_id.startsWith(`${domain}.`)) : all;
  }

  state(entityId: string) {
    return this.request<HaState>(`/states/${encodeURIComponent(entityId)}`);
  }

  async sensors(entityIds: string[]) {
    const ids = new Set(entityIds);
    return (await this.states()).filter((s) => ids.has(s.entity_id)).map(toReading);
  }

  async history(entityId: string, start?: string, end?: string) {
    const path = `/history/period${start ? `/${encodeURIComponent(start)}` : ''}`;
    const params: Record<string, string> = { filter_entity_id: entityId, minimal_response: 'true' };
    if (end) params.end_time = end;
    const result = await this.request<HaState[][]>(path, params);
    return Array.isArray(result) ? result[0] ?? [] : [];
  }

  // ---------- pemetaan & sinkronisasi ----------

  async setDeviceEntities(deviceId: number, map: HaEntityMap) {
    const device = await this.devices.findOne({ where: { id: deviceId } });
    if (!device) throw new NotFoundException('Perangkat tidak ditemukan');
    const cleaned: HaEntityMap = {};
    for (const metric of HA_METRICS) {
      const id = map[metric]?.trim();
      if (id) cleaned[metric] = id;
    }
    device.haEntities = Object.keys(cleaned).length ? cleaned : null;
    return this.devices.save(device);
  }

  /** Ambil state terbaru semua entity yang dipetakan lalu simpan sebagai SensorReading. */
  async sync() {
    if (this.syncing) return { status: 'busy' as const };
    this.syncing = true;
    try {
      const result = await this.runSync();
      this.lastSyncAt = new Date();
      this.lastSyncResult = result;
      this.lastSyncError = null;
      return { status: 'success' as const, ...result };
    } catch (e) {
      this.lastSyncAt = new Date();
      this.lastSyncError = (e as Error).message;
      throw e;
    } finally {
      this.syncing = false;
    }
  }

  private async runSync() {
    const devices = (await this.devices.find()).filter((d) => d.haEntities && Object.keys(d.haEntities).length);
    if (!devices.length) return { devices: 0, inserted: 0, skipped: [] as { deviceId: number; reason: string }[] };

    const byId = new Map((await this.states()).map((s) => [s.entity_id, s]));
    let inserted = 0;
    const skipped: { deviceId: number; reason: string }[] = [];

    for (const device of devices) {
      const values: Partial<Record<(typeof HA_METRICS)[number], number>> = {};
      const missing: string[] = [];
      let latest = 0;
      for (const metric of HA_METRICS) {
        const entityId = device.haEntities![metric];
        if (!entityId) continue;
        const s = byId.get(entityId);
        if (!s) {
          missing.push(entityId);
          continue;
        }
        const v = toNumber(s.state);
        if (v != null) values[metric] = v;
        latest = Math.max(latest, Date.parse(s.last_reported ?? s.last_updated) || 0);
      }
      if (!Object.keys(values).length) {
        skipped.push({ deviceId: device.id, reason: missing.length ? `entity tidak ada: ${missing.join(', ')}` : 'semua nilai kosong' });
        continue;
      }
      await this.readings.save(this.readings.create({ deviceId: device.id, ...values, source: 'ha' }));
      await this.devices.update(device.id, { lastSeenAt: latest ? new Date(latest) : new Date() });
      inserted++;
    }

    return { devices: devices.length, inserted, skipped };
  }

  // ---------- HTTP ----------

  private async request<T>(path: string, params?: Record<string, string>): Promise<T> {
    if (!this.configured) {
      throw new ServiceUnavailableException('Home Assistant belum dikonfigurasi (HA_BASE_URL / HA_TOKEN)');
    }
    const url = new URL(`${this.baseUrl}/api${path}`);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${process.env.HA_TOKEN}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } };
      const detail = err.cause?.code ?? err.message;
      this.log.error(`HA tidak terjangkau: ${detail}`);
      throw new BadGatewayException({ code: 'HA_API_ERROR', message: `Gagal terhubung ke Home Assistant: ${detail}` });
    }
    if (!res.ok) {
      const hint = res.status === 401 ? ' (token salah / kedaluwarsa)' : res.status === 404 ? ' (entity tidak ditemukan)' : '';
      throw new BadGatewayException({
        code: 'HA_API_ERROR',
        message: `Home Assistant membalas ${res.status}${hint}`,
        status: res.status,
      });
    }
    return (await res.json()) as T;
  }
}
