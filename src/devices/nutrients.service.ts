import { BadRequestException, ConflictException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from './device.entity';
import { RelayCommand } from './relay-command.entity';
import { HaRelayService, MAX_MIX_ON_MS } from '../home-assistant/ha-relay.service';
import type { MixDto, RecipeDto } from './nutrients.controller';

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
  status(device: Device) { return { recipe: device.nutrientRecipe, mix: device.lastMix }; }
  async saveRecipe(id: number, recipe: RecipeDto) {
    if (this.jobs.has(id)) throw new ConflictException('Tunggu campuran selesai');
    const token = this.relays.reserveMix(id);
    try { await this.devices.update(id, { nutrientRecipe: recipe }); return this.status(await this.devices.findOneByOrFail({ id })); }
    finally { this.relays.releaseMix(id, token); }
  }
  plan(device: Device, liters: number) {
    const r = device.nutrientRecipe;
    if (!r) throw new BadRequestException('Simpan kalibrasi detik per liter terlebih dahulu');
    const aSeconds = Math.round(liters / r.liters * r.aSeconds * 1000) / 1000;
    const bSeconds = Math.round(liters / r.liters * r.bSeconds * 1000) / 1000;
    if (![aSeconds, bSeconds].every(n => Number.isFinite(n) && n >= .5 && n * 1000 <= MAX_MIX_ON_MS)) throw new BadRequestException('Durasi tiap relay harus 0,5–60 detik. Sesuaikan volume air.');
    return { liters, aSeconds, bSeconds, calibrationKey: `${r.liters}:${r.aSeconds}:${r.bSeconds}`, ready: !!device.haRelays?.relay1 && !!device.haRelays?.relay2 };
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
      if (!plan.ready) throw new BadRequestException('Hubungkan relay A dan B ke Home Assistant dahulu');
      const states = await this.relays.status(device);
      if (states.slice(0, 2).some(s => s.state !== 'off')) throw new ConflictException('Relay A dan B harus berstatus Mati sebelum mulai');
      const mix: NonNullable<Device['lastMix']> = { requestId: dto.requestId, status: 'running', liters: dto.liters, aSeconds: plan.aSeconds, bSeconds: plan.bSeconds, startedAt: new Date().toISOString() };
      await this.devices.update(id, { lastMix: mix });
      const job = this.run(device, mix, token, userId);
      this.jobs.set(id, job);
      void job.finally(() => { this.jobs.delete(id); this.relays.releaseMix(id, token); }).catch(() => {});
      return { recipe: device.nutrientRecipe, mix };
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
