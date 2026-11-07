import { BadRequestException, ConflictException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from './device.entity';
import { RelayCommand } from './relay-command.entity';
import { HaRelayService, MAX_MIX_ON_MS, MAX_PH_ON_MS } from '../home-assistant/ha-relay.service';
import type { MixDto, RecipeDto, PumpCalibrationDto, PhDoseDto } from './nutrients.controller';

@Injectable()
export class NutrientsService implements OnModuleInit, OnModuleDestroy {
  private readonly jobs = new Map<number, Promise<void>>();
  private readonly phJobs = new Map<number, Promise<void>>();
  constructor(@InjectRepository(Device) private readonly devices: Repository<Device>, @InjectRepository(RelayCommand) private readonly commands: Repository<RelayCommand>, private readonly relays: HaRelayService) {}

  async onModuleInit() {
    for (const device of await this.devices.find()) {
      if (device.lastPhDose?.status === 'running') {
        let error = 'Server dimulai ulang; penambahan pH tidak dilanjutkan otomatis.';
        try { await this.relays.cancelMix(device, 'ph'); } catch { error += ' Konfirmasi OFF pH gagal. Periksa alat.'; }
        await this.devices.update(device.id, { lastPhDose: { ...device.lastPhDose, status: 'failed', finishedAt: new Date().toISOString(), error } });
      }
      if (device.lastMix?.status === 'running') {
        let error = 'Server dimulai ulang; campuran tidak dilanjutkan otomatis.';
        try { await this.relays.cancelMix(device); } catch { error += ' Periksa relay A/B: konfirmasi OFF gagal.'; }
        await this.devices.update(device.id, { lastMix: { ...device.lastMix, status: 'failed', finishedAt: new Date().toISOString(), error } });
      }
    }
  }
  status(device: Device) { return { recipe: device.nutrientRecipe && 'version' in device.nutrientRecipe && device.nutrientRecipe.version === 2 ? device.nutrientRecipe : null, legacyRecipe: !!device.nutrientRecipe && !('version' in device.nutrientRecipe), pumps: device.dosingPumps || {}, mix: device.lastMix, phDose: device.lastPhDose }; }

  phPlan(device: Device, channel: 'phUp' | 'phDown', ml: number) {
    if (!['phUp', 'phDown'].includes(channel) || !Number.isFinite(ml) || ml < .001 || ml > 1000000) throw new BadRequestException('Pilih pH Up atau pH Down dan isi jumlah ml yang valid');
    const pump = device.dosingPumps?.[channel];
    const valid = pump && Number.isFinite(pump.seconds) && pump.seconds >= .5 && pump.seconds <= 86400 && Number.isFinite(pump.ml) && pump.ml >= .001 && pump.ml <= 1000000;
    const seconds = valid ? Math.round(ml / pump.ml * pump.seconds * 1000) / 1000 : null;
    const issues: string[] = [];
    if (seconds == null) issues.push('Kalibrasi pompa terlebih dahulu: isi lama uji dan ml yang terkumpul.');
    if (seconds != null && (seconds < .5 || seconds * 1000 > MAX_PH_ON_MS || !Number.isFinite(seconds))) issues.push('Durasi penambahan harus 0,5 detik sampai 60 menit. Sesuaikan jumlah ml.');
    if (!device.haRelays?.[channel === 'phUp' ? 'relay3' : 'relay4']) issues.push('Hubungkan relay pH yang dipilih di Pengaturan alat.');
    return { channel, ml, seconds, calibrationKey: JSON.stringify({ channel, pump }), ready: !issues.length, issues };
  }

  async startPh(id: number, dto: PhDoseDto, userId: number) {
    if (this.phJobs.has(id)) {
      const device = await this.devices.findOneByOrFail({ id });
      if (device.lastPhDose?.requestId === dto.requestId) return this.status(device);
      throw new ConflictException('Penambahan pH sedang berjalan');
    }
    const token = this.relays.reserveMix(id, 'ph');
    try {
      const device = await this.devices.findOneByOrFail({ id });
      if (device.lastPhDose?.requestId === dto.requestId) { this.relays.releaseMix(id, token); return this.status(device); }
      const plan = this.phPlan(device, dto.channel, dto.ml);
      if (dto.calibrationKey !== plan.calibrationKey) throw new ConflictException('Kalibrasi berubah. Hitung ulang dosis pH.');
      if (!plan.ready) throw new BadRequestException(plan.issues.join(' '));
      const states = await this.relays.status(device);
      if (states.some(state => state.entityId && state.state !== 'off')) throw new ConflictException('Pastikan semua relay yang terhubung berstatus Mati sebelum menambahkan pH.');
      const dose: NonNullable<Device['lastPhDose']> = { requestId: dto.requestId, channel: dto.channel, ml: dto.ml, seconds: plan.seconds!, status: 'running', startedAt: new Date().toISOString() };
      await this.devices.update(id, { lastPhDose: dose });
      const job = this.runPh(device, dose, token, userId);
      this.phJobs.set(id, job);
      void job.finally(() => { this.phJobs.delete(id); this.relays.releaseMix(id, token); }).catch(() => {});
      return { ...this.status(device), phDose: dose };
    } catch (e) { this.relays.releaseMix(id, token); throw e; }
  }

  private async runPh(device: Device, dose: NonNullable<Device['lastPhDose']>, token: symbol, userId: number) {
    let status = 'completed', error: string | undefined;
    let command: RelayCommand | undefined;
    try {
      if (!this.relays.mixCancelled(device.id, token)) {
        const relay = dose.channel === 'phUp' ? 3 : 4;
        command = await this.commands.save(this.commands.create({ deviceId: device.id, relay, action: 'ON', durationMs: Math.round(dose.seconds * 1000), transport: 'ha', status: 'sent', requestedById: userId }));
        await this.relays.execute(command, device.haRelays![relay === 3 ? 'relay3' : 'relay4']!, token);
        command.status = 'done'; command.ackAt = new Date();
      }
      if (this.relays.mixCancelled(device.id, token)) status = 'stopped';
    } catch (e) { status = this.relays.mixCancelled(device.id, token) ? 'stopped' : 'failed'; error = (e as Error).message; if (command) command.status = 'failed'; }
    finally {
      try { await this.relays.cancelMix(device, 'ph'); } catch { status = 'failed'; error = 'Konfirmasi relay pH OFF gagal. Periksa alat.'; }
      try { if (command) await this.commands.save(command); }
      finally { await this.devices.update(device.id, { lastPhDose: { ...dose, status, ...(error ? { error } : {}), finishedAt: new Date().toISOString() } }); }
    }
  }

  async stopPh(id: number) {
    const device = await this.devices.findOneByOrFail({ id });
    if (this.phJobs.has(id)) { await this.relays.cancelMix(device, 'ph'); await this.phJobs.get(id); }
    return this.status(await this.devices.findOneByOrFail({ id }));
  }
  async saveRecipe(id: number, recipe: RecipeDto) {
    if (this.jobs.has(id)) throw new ConflictException('Tunggu campuran selesai');
    const token = this.relays.reserveMix(id);
    try { await this.devices.update(id, { nutrientRecipe: { ...recipe, version: 2 } }); return this.status(await this.devices.findOneByOrFail({ id })); }
    finally { this.relays.releaseMix(id, token); }
  }
  async savePump(id: number, channel: string, calibration: PumpCalibrationDto, onlyIfMissing = false) {
    if (!['ab', 'a', 'b', 'phUp', 'phDown'].includes(channel)) throw new BadRequestException('Kanal pompa tidak dikenal');
    const token = this.relays.reserveMix(id);
    try {
      const device = await this.devices.findOneByOrFail({ id });
      if (onlyIfMissing && device.dosingPumps?.[channel as keyof NonNullable<Device['dosingPumps']>]) return this.status(device);
      const measured = { seconds: calibration.seconds, ml: calibration.ml };
      const changes = ['ab', 'a', 'b'].includes(channel) && !onlyIfMissing ? { a: measured, b: measured } : { [channel]: measured };
      await this.devices.update(id, { dosingPumps: { ...device.dosingPumps, ...changes } });
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
    const duration = (pump: typeof pumps.a, ml: number) => pump && Number.isFinite(pump.ml) && pump.ml > 0 && Number.isFinite(pump.seconds) && pump.seconds >= .5 && pump.seconds <= 86400 ? Math.round(ml / pump.ml * pump.seconds * 1000) / 1000 : null;
    const aSeconds = duration(pumps.a, aMl), bSeconds = duration(pumps.b, bMl);
    const issues: string[] = [];
    if (aSeconds == null) issues.push('Kalibrasi pompa A: isi ml yang keluar dan lama relay menyala.');
    if (bSeconds == null) issues.push('Kalibrasi pompa B: isi ml yang keluar dan lama relay menyala.');
    const paired = aSeconds != null && bSeconds != null && aSeconds === bSeconds;
    if (!paired && aSeconds != null && bSeconds != null) issues.push('A dan B harus memakai durasi yang sama. Atur kalibrasi A + B bersama.');
    const withinLimits = [aSeconds, bSeconds].every(n => n != null && Number.isFinite(n) && n >= .5 && n * 1000 <= MAX_MIX_ON_MS);
    const aPerLiter = pumps.a ? r.aMl / r.waterLiters / pumps.a.ml * pumps.a.seconds : null;
    const bPerLiter = pumps.b ? r.bMl / r.waterLiters / pumps.b.ml * pumps.b.seconds : null;
    const minLiters = aPerLiter && bPerLiter ? Math.max(.5 / aPerLiter, .5 / bPerLiter) : null;
    const maxLiters = aPerLiter && bPerLiter ? Math.min(60 / aPerLiter, 60 / bPerLiter) : null;
    if (aSeconds != null && bSeconds != null && !withinLimits) issues.push('Durasi hasil hitung di luar 0,5–60 detik. Periksa resep ml dan hasil kalibrasi pompa.');
    const mapped = !!device.haRelays?.relay1 && !!device.haRelays?.relay2;
    if (!mapped) issues.push('Hubungkan relay A dan B di Pengaturan alat.');
    return { liters, aMl, bMl, aSeconds, bSeconds, calibrationKey: JSON.stringify({ recipe: r, a: pumps.a, b: pumps.b }), ready: withinLimits && mapped && paired, issues, minLiters, maxLiters };
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
      if (!dto.newWater && dto.mode !== 'correction') throw new BadRequestException('Konfirmasi air belum diberi AB mix');
      const plan = this.plan(device, dto.liters);
      if (dto.calibrationKey !== plan.calibrationKey) throw new ConflictException('Kalibrasi berubah. Hitung ulang takaran.');
      if (!plan.ready) throw new BadRequestException(plan.issues.join(' '));
      const states = await this.relays.status(device);
      const unavailable = states.filter(s => (s.relay <= 2 || s.entityId) && s.state !== 'off');
      if (unavailable.length) throw new ConflictException(`Campuran belum dimulai. ${unavailable.map(s => `Relay ${s.relay}${s.entityId ? ` (${s.entityId})` : ''}: ${s.state === 'on' ? 'masih menyala' : 'status belum tersedia'}`).join('; ')}. Periksa entity dan pastikan relay Mati di Home Assistant.`);
      const mix: NonNullable<Device['lastMix']> = { requestId: dto.requestId, mode: dto.mode ?? 'initial', status: 'running', liters: dto.liters, aSeconds: plan.aSeconds!, bSeconds: plan.bSeconds!, aMl: plan.aMl, bMl: plan.bMl, recipe: this.status(device).recipe, startedAt: new Date().toISOString() };
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
      mix.phase = 'ab';
      mix.phaseStartedAt = new Date().toISOString();
      mix.completedChannels = [];
      await this.devices.update(device.id, { lastMix: { ...mix } });
      let firstError: unknown;
      let writes = Promise.resolve();
      const outcomes = await Promise.allSettled(([ [1, mix.aSeconds], [2, mix.bSeconds] ] as const).map(async ([relay, seconds]) => {
        let command: RelayCommand | undefined;
        try {
          if (this.relays.mixCancelled(device.id, token)) return;
          command = await this.commands.save(this.commands.create({ deviceId: device.id, relay, action: 'ON', durationMs: Math.round(seconds * 1000), transport: 'ha', status: 'sent', requestedById: userId }));
          await this.relays.execute(command, device.haRelays![relay === 1 ? 'relay1' : 'relay2']!, token);
          command.status = 'done'; command.ackAt = new Date();
          if (!this.relays.mixCancelled(device.id, token)) {
            mix.completedChannels!.push(relay === 1 ? 'a' : 'b');
            writes = writes.then(async () => { await this.devices.update(device.id, { lastMix: { ...mix } }); });
            await writes;
          }
        } catch (e) {
          if (!this.relays.mixCancelled(device.id, token)) firstError ??= e;
          if (command) command.status = 'failed';
          try { await this.relays.cancelMix(device); } catch { /* final OFF verification below */ }
        } finally { if (command) await this.commands.save(command); }
      }));
      await writes;
      const rejected = outcomes.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (rejected) throw rejected.reason;
      if (firstError) throw firstError;
      if (this.relays.mixCancelled(device.id, token)) status = 'stopped';
    } catch (e) { status = 'failed'; error = (e as Error).message; }
    finally {
      if (status === 'completed') mix.phase = 'finishing';
      await this.devices.update(device.id, { lastMix: { ...mix } });
      try { await this.relays.cancelMix(device); } catch { status = 'failed'; error = 'Konfirmasi relay OFF gagal. Periksa alat.'; }
      await this.devices.update(device.id, { lastMix: { ...mix, status, ...(error ? { error } : {}), finishedAt: new Date().toISOString() } });
    }
  }
  async stop(id: number) {
    const device = await this.devices.findOneByOrFail({ id });
    if (this.jobs.has(id)) { await this.relays.cancelMix(device); await this.jobs.get(id); }
    return this.status(await this.devices.findOneByOrFail({ id }));
  }
  async onModuleDestroy() { await Promise.allSettled([...this.jobs.keys()].map(id => this.stop(id)).concat([...this.phJobs.keys()].map(id => this.stopPh(id)))); }
}
