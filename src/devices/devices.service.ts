import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { LessThan, Repository } from 'typeorm';
import { ActivityService } from '../activity/activity.service';
import { ClientInfo } from '../activity/client-info.decorator';
import { JwtUser } from '../auth/jwt-auth.guard';
import { DeviceEvents } from './device-events';
import { DEFAULT_RELAY_LABELS, Device, RELAY_KEYS } from './device.entity';
import { HaRelayService } from '../home-assistant/ha-relay.service';
import { CreateCommandDto, CreateDeviceDto, CreateReadingDto, MAX_ON_MS, ReadingsQueryDto } from './dto';
import { RelayCommand } from './relay-command.entity';
import { ReadingSource, SensorReading } from './sensor-reading.entity';

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
    private readonly activity: ActivityService,
    private readonly events: DeviceEvents,
    private readonly haRelays: HaRelayService,
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

  async create(user: JwtUser, dto: CreateDeviceDto, client?: ClientInfo) {
    const device = await this.devices.save(
      this.devices.create({
        name: dto.name,
        location: dto.location ?? '',
        relayLabels: dto.relayLabels ?? DEFAULT_RELAY_LABELS,
        ownerId: user.sub,
        apiKey: randomBytes(16).toString('hex'),
      }),
    );
    await this.activity.action(user.sub, 'device.create', `Menambah perangkat "${device.name}"`, { deviceId: device.id, client });
    return this.withStatus(device);
  }

  async remove(user: JwtUser, id: number, client?: ClientInfo) {
    const device = await this.getOwned(user, id);
    await this.devices.remove(device);
    await this.activity.action(user.sub, 'device.delete', `Menghapus perangkat "${device.name}"`, { deviceId: id, client });
    return { ok: true };
  }

  async readingsFor(user: JwtUser, id: number, limit = 48, query: ReadingsQueryDto = {}) {
    await this.getOwned(user, id);
    if (query.from && query.to && Date.parse(query.from) >= Date.parse(query.to)) {
      throw new BadRequestException('Tanggal akhir harus setelah tanggal awal');
    }
    const builder = this.readings.createQueryBuilder('reading')
      .where('reading.deviceId = :id', { id });
    if (query.from) builder.andWhere('reading.createdAt >= :from', { from: new Date(query.from) });
    if (query.to) builder.andWhere('reading.createdAt < :to', { to: new Date(query.to) });
    const rows = await builder.orderBy('reading.createdAt', 'DESC')
      .addOrderBy('reading.id', 'DESC').skip(query.offset ?? 0).take(limit).getMany();
    return rows.reverse();
  }

  async allReadingsFor(user: JwtUser, query: ReadingsQueryDto = {}) {
    if (query.from && query.to && Date.parse(query.from) >= Date.parse(query.to)) throw new BadRequestException('Tanggal akhir harus setelah tanggal awal');
    const builder = this.readings.createQueryBuilder('reading').innerJoinAndSelect('reading.device', 'device');
    if (user.role !== 'admin') builder.where('device.ownerId = :owner', { owner: user.sub });
    if (query.from) builder.andWhere('reading.createdAt >= :from', { from: new Date(query.from) });
    if (query.to) builder.andWhere('reading.createdAt < :to', { to: new Date(query.to) });
    const rows = await builder.orderBy('reading.createdAt', 'DESC').addOrderBy('reading.id', 'DESC').skip(query.offset ?? 0).take(query.limit ?? 200).getMany();
    return rows.reverse().map(({ device, ...reading }) => ({ ...reading, deviceName: device.name }));
  }

  async commandsFor(user: JwtUser, id: number) {
    await this.getOwned(user, id);
    return this.commands.find({ where: { deviceId: id }, order: { createdAt: 'DESC' }, take: 20 });
  }

  async queueCommand(user: JwtUser, id: number, dto: CreateCommandDto, client?: ClientInfo) {
    const device = await this.getOwned(user, id);
    const label = device.relayLabels[dto.relay - 1] ?? `Relay ${dto.relay}`;
    const entityId = device.haRelays?.[RELAY_KEYS[dto.relay - 1]];
    const command = await this.commands.save(
      this.commands.create({
        deviceId: id,
        relay: dto.relay,
        action: dto.action,
        durationMs: dto.action === 'ON' ? Math.min(dto.durationMs ?? MAX_ON_MS, MAX_ON_MS) : 0,
        requestedById: user.sub,
        transport: entityId ? 'ha' : 'device',
        status: entityId ? 'sent' : 'pending',
      }),
    );
    await this.activity.action(
      user.sub,
      dto.action === 'ON' ? 'relay.on' : 'relay.off',
      `${dto.action === 'ON' ? 'Menyalakan' : 'Mematikan'} ${label} di "${device.name}"`,
      { deviceId: id, client, meta: { relay: dto.relay, commandId: command.id, durationMs: command.durationMs } },
    );
    // Jalur MQTT (bila aktif & perangkat tersambung) langsung meneruskan perintah ini
    if (entityId) {
      try {
        await this.haRelays.execute(command, entityId);
        command.status = 'done';
        command.ackAt = new Date();
        await this.commands.save(command);
      } catch (e) {
        command.status = 'failed';
        await this.commands.save(command);
        throw e;
      }
    } else this.events.commandCreated(command);
    return command;
  }

  // ---------- akses perangkat (ESP32) ----------

  findByApiKey(apiKey: string) {
    return this.devices.findOne({ where: { apiKey } });
  }

  findById(id: number) {
    return this.devices.findOne({ where: { id } });
  }

  async recordReading(device: Device, dto: CreateReadingDto, source: ReadingSource = 'http') {
    await this.touch(device);
    return this.readings.save(this.readings.create({ deviceId: device.id, ...dto, source }));
  }

  /** Perintah sudah dikirim lewat MQTT (hanya bila masih menunggu). */
  async markSent(commandId: number) {
    await this.commands.update({ id: commandId, status: 'pending' }, { status: 'sent' });
  }

  /** Ambil perintah yang menunggu, tandai sebagai terkirim. */
  async pullCommands(device: Device) {
    await this.touch(device);
    await this.commands.update(
      { deviceId: device.id, status: 'pending', createdAt: LessThan(new Date(Date.now() - COMMAND_TTL_MS)) },
      { status: 'expired' },
    );
    const pending = await this.commands.find({
      where: { deviceId: device.id, status: 'pending', transport: 'device' },
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
    const cmd = await this.commands.findOne({ where: { id: commandId, deviceId: device.id, transport: 'device' } });
    if (!cmd) throw new NotFoundException('Perintah tidak ditemukan');
    cmd.status = 'done';
    cmd.ackAt = new Date();
    return this.commands.save(cmd);
  }

  // ---------- helper ----------

  /** Perangkat milik pengguna (atau semua untuk admin), 404 bila tidak berhak. */
  async getOwned(user: JwtUser, id: number) {
    const device = await this.devices.findOne({ where: { id } });
    if (!device || (user.role !== 'admin' && device.ownerId !== user.sub)) {
      throw new NotFoundException('Perangkat tidak ditemukan');
    }
    return device;
  }

  async touch(device: Device) {
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
