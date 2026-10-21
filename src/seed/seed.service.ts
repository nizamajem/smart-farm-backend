import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { DEFAULT_RELAY_LABELS, Device } from '../devices/device.entity';
import { SensorReading } from '../devices/sensor-reading.entity';
import { UsersService } from '../users/users.service';

export const DEMO_EMAIL = 'admin@smartfarm.local';
export const DEMO_PASSWORD = 'admin123';
export const DEMO_DEVICE_KEY = 'demo-greenhouse-key';

/** Mengisi akun admin + perangkat demo dengan riwayat 24 jam saat database masih kosong. */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly log = new Logger('Seed');

  constructor(
    private readonly users: UsersService,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(SensorReading) private readonly readings: Repository<SensorReading>,
  ) {}

  async onApplicationBootstrap() {
    if (process.env.SEED_DEMO === 'false' || (await this.users.count()) > 0) return;

    const admin = await this.users.create({
      name: 'Admin Kebun',
      email: DEMO_EMAIL,
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
      role: 'admin',
    });
    const device = await this.devices.save(
      this.devices.create({
        name: 'Greenhouse 1',
        location: 'Blok A',
        apiKey: DEMO_DEVICE_KEY,
        relayLabels: DEFAULT_RELAY_LABELS,
        ownerId: admin.id,
      }),
    );

    const now = Date.now();
    const rows = Array.from({ length: 48 }, (_, i) => {
      const t = now - (47 - i) * 30 * 60 * 1000;
      const hour = new Date(t).getHours() + new Date(t).getMinutes() / 60;
      const sun = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
      return this.readings.create({
        deviceId: device.id,
        temperature: round(24 + 8 * sun + jitter(0.6)),
        humidity: round(85 - 25 * sun + jitter(2)),
        soilMoisture: round(65 - (i % 16) * 1.5 + jitter(1.5)),
        lightLux: Math.round(30000 * sun + Math.abs(jitter(300))),
        createdAt: new Date(t),
      });
    });
    await this.readings.save(rows);

    this.log.log(`Akun demo: ${DEMO_EMAIL} / ${DEMO_PASSWORD}  •  device key: ${DEMO_DEVICE_KEY}`);
  }
}

const jitter = (n: number) => (Math.random() * 2 - 1) * n;
const round = (n: number) => Math.round(n * 10) / 10;
