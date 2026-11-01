import { BadRequestException, ConflictException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from './device.entity';
import { RelayCommand } from './relay-command.entity';
import { HaRelayService, MAX_MIX_ON_MS } from '../home-assistant/ha-relay.service';
import type { MixDto, RecipeDto, PumpCalibrationDto } from './nutrients.controller';

@Injectable()
export class NutrientsService implements OnModuleInit, OnModuleDestroy {
  private readonly jobs = new Map<number, Promise<void>>();
  constructor(@InjectRepository(Device) private readonly devices: Repository<Device>, @InjectRepository(RelayCommand) private readonly commands: Repository<RelayCommand>, private readonly relays: HaRelayService) {}

  async onModuleInit() {
    for (const device of await this.devices.find()) {
      if (device.lastMix?.status === 'running') {
        let error = 'Server dimulai ulang; campuran tidak dilanjutkan otomatis.';
        try { await this.relays.cancelMix(device); } catch { error += ' Periksa relay A/B: konfirmasi OFF gagal.'; }
        await this.devices.update(device.id, { lastMix: { ...device.lastMix, status: 'failed', finishedAt: new Date().toISOString(), error } });
      }
    }
  }
  status(device: Device) { return { recipe: device.nutrientRecipe && 'version' in device.nutrientRecipe && device.nutrientRecipe.version === 2 ? device.nutrientRecipe : null, legacyRecipe: !!device.nutrientRecipe && !('version' in device.nutrientRecipe), pumps: device.dosingPumps || {}, mix: device.lastMix }; }
  async saveRecipe(id: number, recipe: RecipeDto) {
    if (this.jobs.has(id)) throw new ConflictException('Tunggu campuran selesai');
    const token = this.relays.reserveMix(id);
    try { await this.devices.update(id, { nutrientRecipe: { ...recipe, version: 2 } }); return this.status(await this.devices.findOneByOrFail({ id })); }
    finally { this.relays.releaseMix(id, token); }
  }
  async savePump(id: number, channel: string, calibration: PumpCalibrationDto, onlyIfMissing = false) {
    if (!['a', 'b', 'phUp', 'phDown'].includes(channel)) throw new BadRequestException('Kanal pompa tidak dikenal');
    const token = this.relays.reserveMix(id);
    try {
      const device = await this.devices.findOneByOrFail({ id });
      if (onlyIfMissing && device.dosingPumps?.[channel as keyof NonNullable<Device['dosingPumps']>]) return this.status(device);
      await this.devices.update(id, { dosingPumps: { ...device.dosingPumps, [channel]: { seconds: calibration.seconds, ml: calibration.ml } } });
      return this.status(await this.devices.findOneByOrFail({ id }));
    } finally { this.relays.releaseMix(id, token); }
  }
  plan(device: Device, liters: number) {
    const r = this.status(device).recipe;
    if (!r) throw new BadRequestException('Atur Resep Nutrisi dalam liter air utama dan ml A/B. Resep detik per liter lama tidak dikonversi otomatis.');
    if (!Number.isFinite(liters) || liters < .01 || liters > 1000000) throw new BadRequestException('Jumlah air harus antara 0,01 dan 1.000.000 liter');
    if (!Number.isFinite(r.waterLiters) || r.waterLiters <= 0 || ![r.aMl, r.bMl].every(n => Number.isFinite(n) && n > 0)) throw new BadRequestException('Resep tidak valid. Simpan ulang resep air utama dan ml larutan.');
    const aMl = liters / r.waterLiters * r.aMl;
    const bMl = liters / r.waterLiters * r.bMl;
    const pumps = device.dosingPumps || {};
    const duration = (pump: typeof pumps.a, ml: number) => pump && Number.isFinite(pump.ml) && pump.ml > 0 && Number.isFinite(pump.seconds) && pump.seconds >= .5 && pump.seconds <= 60 ? Math.round(ml / pump.ml * pump.seconds * 1000) / 1000 : null;
    const aSeconds = duration(pumps.a, aMl), bSeconds = duration(pumps.b, bMl);
    const issues: string[] = [];
    if (aSeconds == null) issues.push('Kalibrasi pompa A: isi ml yang keluar dan lama relay menyala.');
    if (bSeconds == null) issues.push('Kalibrasi pompa B: isi ml yang keluar dan lama relay menyala.');
    const withinLimits = [aSeconds, bSeconds].every(n => n != null && Number.isFinite(n) && n >= .5 && n * 1000 <= MAX_MIX_ON_MS);
    const aPerLiter = pumps.a ? r.aMl / r.waterLiters / pumps.a.ml * pumps.a.seconds : null;
    const bPerLiter = pumps.b ? r.bMl / r.waterLiters / pumps.b.ml * pumps.b.seconds : null;
    const minLiters = aPerLiter && bPerLiter ? Math.max(.5 / aPerLiter, .5 / bPerLiter) : null;
    const maxLiters = aPerLiter && bPerLiter ? Math.min(60 / aPerLiter, 60 / bPerLiter) : null;
    if (aSeconds != null && bSeconds != null && !withinLimits) issues.push('Durasi hasil hitung di luar 0,5–60 detik. Periksa resep ml dan hasil kalibrasi pompa.');
    const mapped = !!device.haRelays?.relay1 && !!device.haRelays?.relay2;
    if (!mapped) issues.push('Hubungkan relay A dan B di Pengaturan alat.');
    return { liters, aMl, bMl, aSeconds, bSeconds, calibrationKey: JSON.stringify({ recipe: r, a: pumps.a, b: pumps.b }), ready: withinLimits && mapped, issues, minLiters, maxLiters };
  }
  async start(id: number, dto: MixDto, userId: number) {
    if (this.jobs.has(id)) {
      const d = await this.devices.findOneByOrFail({ id });
      if (d.lastMix?.requestId === dto.requestId) return this.status(d);
      throw new ConflictException('Campuran sedang berjalan');
    }
    const token = this.relays.reserveMix(id);
    try {
      const device = await this.devices.findOneByOrFail({ id });
      if (device.lastMix?.requestId === dto.requestId) { this.relays.releaseMix(id, token); return this.status(device); }
      if (!dto.newWater) throw new BadRequestException('Konfirmasi air belum diberi AB mix');
      const plan = this.plan(device, dto.liters);
      if (dto.calibrationKey !== plan.calibrationKey) throw new ConflictException('Kalibrasi berubah. Hitung ulang takaran.');
      if (!plan.ready) throw new BadRequestException(plan.issues.join(' '));
      const states = await this.relays.status(device);
      const unavailable = states.filter(s => (s.relay <= 2 || s.entityId) && s.state !== 'off');
      if (unavailable.length) throw new ConflictException(`Campuran belum dimulai. ${unavailable.map(s => `Relay ${s.relay}${s.entityId ? ` (${s.entityId})` : ''}: ${s.state === 'on' ? 'masih menyala' : 'status belum tersedia'}`).join('; ')}. Periksa entity dan pastikan relay Mati di Home Assistant.`);
      const mix: NonNullable<Device['lastMix']> = { requestId: dto.requestId, status: 'running', liters: dto.liters, aSeconds: plan.aSeconds!, bSeconds: plan.bSeconds!, aMl: plan.aMl, bMl: plan.bMl, startedAt: new Date().toISOString() };
      await this.devices.update(id, { lastMix: mix });
      const job = this.run(device, mix, token, userId);
      this.jobs.set(id, job);
      void job.finally(() => { this.jobs.delete(id); this.relays.releaseMix(id, token); }).catch(() => {});
      return { ...this.status(device), mix };
    } catch (e) { this.relays.releaseMix(id, token); throw e; }
  }
  private async run(device: Device, mix: NonNullable<Device['lastMix']>, token: symbol, userId: number) {
    let status = 'completed', error: string | undefined;
    try {
      for (const [relay, seconds] of [[1, mix.aSeconds], [2, mix.bSeconds]]) {
        if (this.relays.mixCancelled(device.id, token)) { status = 'stopped'; break; }
        const command = await this.commands.save(this.commands.create({ deviceId: device.id, relay, action: 'ON', durationMs: Math.round(seconds * 1000), transport: 'ha', status: 'sent', requestedById: userId }));
        try { await this.relays.execute(command, device.haRelays![relay === 1 ? 'relay1' : 'relay2']!, token); command.status = 'done'; command.ackAt = new Date(); }
        catch (e) { command.status = 'failed'; throw e; }
        finally { await this.commands.save(command); }
      }
      if (this.relays.mixCancelled(device.id, token)) status = 'stopped';
    } catch (e) { status = this.relays.mixCancelled(device.id, token) ? 'stopped' : 'failed'; error = (e as Error).message; }
    finally {
      try { await this.relays.cancelMix(device); } catch { status = 'failed'; error = 'Konfirmasi relay OFF gagal. Periksa alat.'; }
      await this.devices.update(device.id, { lastMix: { ...mix, status, ...(error ? { error } : {}), finishedAt: new Date().toISOString() } });
    }
  }
  async stop(id: number) {
    const device = await this.devices.findOneByOrFail({ id });
    if (this.jobs.has(id)) { await this.relays.cancelMix(device); await this.jobs.get(id); }
    return this.status(await this.devices.findOneByOrFail({ id }));
  }
  async onModuleDestroy() { await Promise.allSettled([...this.jobs.keys()].map(id => this.stop(id))); }
}
