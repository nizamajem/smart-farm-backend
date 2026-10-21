import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { LessThan, Repository } from 'typeorm';
import { JwtUser } from '../auth/jwt-auth.guard';
import { DEFAULT_RELAY_LABELS, Device } from './device.entity';
import { CreateCommandDto, CreateDeviceDto, CreateReadingDto, MAX_ON_MS } from './dto';
import { RelayCommand } from './relay-command.entity';
import { SensorReading } from './sensor-reading.entity';

/** Perangkat dianggap online bila mengirim data dalam 2 menit terakhir. */
const ONLINE_WINDOW_MS = 2 * 60 * 1000;
/** Perintah yang tidak diambil ESP32 dalam 30 detik tidak dieksekusi (hindari pompa menyala telat). */
const COMMAND_TTL_MS = 30 * 1000;

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(SensorReading) private readonly readings: Repository<SensorReading>,
    @InjectRepository(RelayCommand) private readonly commands: Repository<RelayCommand>,
  ) {}

  // ---------- akses pengguna ----------

  async findAllFor(user: JwtUser) {
    const devices = await this.devices.find({
      where: user.role === 'admin' ? {} : { ownerId: user.sub },
      order: { createdAt: 'ASC' },
    });
    return Promise.all(devices.map((d) => this.withStatus(d)));
  }

  async findOneFor(user: JwtUser, id: number) {
    return this.withStatus(await this.getOwned(user, id));
  }

  async create(user: JwtUser, dto: CreateDeviceDto) {
    const device = await this.devices.save(
      this.devices.create({
        name: dto.name,
        location: dto.location ?? '',
        relayLabels: dto.relayLabels ?? DEFAULT_RELAY_LABELS,
        ownerId: user.sub,
        apiKey: randomBytes(16).toString('hex'),
      }),
    );
    return this.withStatus(device);
  }

  async remove(user: JwtUser, id: number) {
    await this.devices.remove(await this.getOwned(user, id));
    return { ok: true };
  }

  async readingsFor(user: JwtUser, id: number, limit = 48) {
    await this.getOwned(user, id);
    const rows = await this.readings.find({
      where: { deviceId: id },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return rows.reverse();
  }

  async commandsFor(user: JwtUser, id: number) {
    await this.getOwned(user, id);
    return this.commands.find({ where: { deviceId: id }, order: { createdAt: 'DESC' }, take: 20 });
  }

  async queueCommand(user: JwtUser, id: number, dto: CreateCommandDto) {
    await this.getOwned(user, id);
    return this.commands.save(
      this.commands.create({
        deviceId: id,
        relay: dto.relay,
        action: dto.action,
        durationMs: dto.action === 'ON' ? Math.min(dto.durationMs ?? MAX_ON_MS, MAX_ON_MS) : 0,
        requestedById: user.sub,
      }),
    );
  }

  // ---------- akses perangkat (ESP32) ----------

  findByApiKey(apiKey: string) {
    return this.devices.findOne({ where: { apiKey } });
  }

  async recordReading(device: Device, dto: CreateReadingDto) {
    await this.touch(device);
    return this.readings.save(this.readings.create({ deviceId: device.id, ...dto }));
  }

  /** Ambil perintah yang menunggu, tandai sebagai terkirim. */
  async pullCommands(device: Device) {
    await this.touch(device);
    await this.commands.update(
      { deviceId: device.id, status: 'pending', createdAt: LessThan(new Date(Date.now() - COMMAND_TTL_MS)) },
      { status: 'expired' },
    );
    const pending = await this.commands.find({
      where: { deviceId: device.id, status: 'pending' },
      order: { createdAt: 'ASC' },
    });
    if (pending.length) {
      await this.commands.update(
        pending.map((c) => c.id),
        { status: 'sent' },
      );
    }
    return pending.map(({ id, relay, action, durationMs }) => ({ id, relay, action, durationMs }));
  }

  async ackCommand(device: Device, commandId: number) {
    const cmd = await this.commands.findOne({ where: { id: commandId, deviceId: device.id } });
    if (!cmd) throw new NotFoundException('Perintah tidak ditemukan');
    cmd.status = 'done';
    cmd.ackAt = new Date();
    return this.commands.save(cmd);
  }

  // ---------- helper ----------

  private async getOwned(user: JwtUser, id: number) {
    const device = await this.devices.findOne({ where: { id } });
    if (!device || (user.role !== 'admin' && device.ownerId !== user.sub)) {
      throw new NotFoundException('Perangkat tidak ditemukan');
    }
    return device;
  }

  private async touch(device: Device) {
    device.lastSeenAt = new Date();
    await this.devices.update(device.id, { lastSeenAt: device.lastSeenAt });
  }

  private async withStatus(device: Device) {
    const latestReading = await this.readings.findOne({
      where: { deviceId: device.id },
      order: { createdAt: 'DESC' },
    });
    const online = !!device.lastSeenAt && Date.now() - new Date(device.lastSeenAt).getTime() < ONLINE_WINDOW_MS;
    return { ...device, online, latestReading };
  }
}
