import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, MoreThan, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { ActivityLog, ActivityType } from './activity-log.entity';
import { ClientInfo } from './client-info.decorator';

export interface LogEntry {
  action?: string;
  description: string;
  deviceId?: number | null;
  meta?: Record<string, unknown>;
  client?: ClientInfo;
}

/** Buka aplikasi dari platform yang sama dalam rentang ini dianggap satu kali (hindari duplikat). */
const APP_OPEN_DEDUP_MS = 60 * 1000;
/** "Terakhir aktif" diperbarui paling sering sekali per menit per pengguna. */
const TOUCH_THROTTLE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ActivityService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Activity');
  private readonly lastTouch = new Map<number, number>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(ActivityLog) private readonly logs: Repository<ActivityLog>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  onModuleInit() {
    const run = () => this.cleanup().catch((e) => this.log.warn(`Pembersihan log gagal: ${(e as Error).message}`));
    run();
    this.cleanupTimer = setInterval(run, DAY_MS);
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }

  // ---------- pencatatan (tidak pernah melempar error ke pemanggil) ----------

  async record(userId: number, type: ActivityType, entry: LogEntry) {
    try {
      const now = new Date();
      await this.logs.save(this.logs.create({
        userId,
        type,
        action: entry.action ?? null,
        description: entry.description.slice(0, 255),
        deviceId: entry.deviceId ?? null,
        meta: entry.meta ?? null,
        platform: entry.client?.platform ?? null,
        appVersion: entry.client?.appVersion ?? null,
        ip: entry.client?.ip ?? null,
        userAgent: entry.client?.userAgent ?? null,
      }));
      if (type !== 'login_failed') {
        await this.users.update(userId, type === 'login' ? { lastLoginAt: now, lastSeenAt: now } : { lastSeenAt: now });
        this.lastTouch.set(userId, now.getTime());
      }
    } catch (e) {
      this.log.warn(`Gagal mencatat aktivitas: ${(e as Error).message}`);
    }
  }

  action(userId: number, action: string, description: string, extra: Omit<LogEntry, 'action' | 'description'> = {}) {
    return this.record(userId, 'action', { ...extra, action, description });
  }

  async appOpen(userId: number, client: ClientInfo) {
    const recent = await this.logs.findOne({
      where: {
        userId,
        type: 'app_open',
        platform: client.platform ?? undefined,
        createdAt: MoreThan(new Date(Date.now() - APP_OPEN_DEDUP_MS)),
      },
    });
    if (recent) return { ok: true, deduplicated: true };
    const where = client.platform === 'web' ? 'website' : 'aplikasi';
    await this.record(userId, 'app_open', {
      description: `Membuka ${where}${client.appVersion ? ` (versi ${client.appVersion})` : ''}`,
      client,
    });
    return { ok: true };
  }

  /** Dipanggil setiap request terautentikasi; memperbarui "terakhir aktif" dengan throttle. */
  touch(userId: number) {
    const now = Date.now();
    if (now - (this.lastTouch.get(userId) ?? 0) < TOUCH_THROTTLE_MS) return;
    this.lastTouch.set(userId, now);
    this.users.update(userId, { lastSeenAt: new Date(now) }).catch(() => undefined);
  }

  // ---------- baca (admin) ----------

  async list(userId: number, opts: { type?: string; limit?: number; before?: number }) {
    await this.ensureUser(userId);
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
    const types = opts.type === 'login' ? ['login', 'login_failed'] : opts.type ? [opts.type] : undefined;
    const items = await this.logs.find({
      where: {
        userId,
        ...(types ? { type: In(types) } : {}),
        ...(opts.before ? { id: LessThan(opts.before) } : {}),
      },
      order: { id: 'DESC' },
      take: limit + 1,
    });
    const hasMore = items.length > limit;
    const page = items.slice(0, limit);
    return { items: page, nextBefore: hasMore ? page[page.length - 1].id : null };
  }

  async summary(userId: number) {
    const user = await this.ensureUser(userId);
    const since30 = new Date(Date.now() - 30 * DAY_MS);
    const count = (type: ActivityType, since?: Date) =>
      this.logs.count({ where: { userId, type, ...(since ? { createdAt: MoreThan(since) } : {}) } });

    // Penggunaan 14 hari terakhir (buka aplikasi per hari, zona waktu server)
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 13);
    const opens = await this.logs.find({
      select: { createdAt: true, platform: true },
      where: { userId, type: 'app_open', createdAt: MoreThan(start) },
    });
    // Label tanggal pakai zona waktu server (TZ), sama dengan penentuan awal hari di atas
    const pad = (n: number) => String(n).padStart(2, '0');
    const daily = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, web: 0, app: 0 };
    });
    for (const o of opens) {
      const t = new Date(o.createdAt);
      const key = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
      const day = daily.find((d) => d.date === key);
      if (day) day[o.platform === 'web' ? 'web' : 'app']++;
    }

    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt, lastLoginAt: user.lastLoginAt, lastSeenAt: user.lastSeenAt },
      totals: {
        logins: await count('login'),
        failedLogins30d: await count('login_failed', since30),
        appOpens30d: await count('app_open', since30),
        actions30d: await count('action', since30),
      },
      daily,
    };
  }

  private async ensureUser(userId: number) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Pengguna tidak ditemukan');
    return user;
  }

  /** Hapus log lebih tua dari ACTIVITY_RETENTION_DAYS (default 365 hari). */
  private async cleanup() {
    const days = Number(process.env.ACTIVITY_RETENTION_DAYS ?? 365);
    if (!(days > 0)) return;
    const res = await this.logs.delete({ createdAt: LessThan(new Date(Date.now() - days * DAY_MS)) });
    if (res.affected) this.log.log(`${res.affected} log aktivitas lama dihapus`);
  }
}
