import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import Aedes, { AuthenticateError, Client, PublishPacket, Subscription } from 'aedes';
import { timingSafeEqual } from 'crypto';
import type { IncomingMessage } from 'http';
import { createServer, Server, Socket } from 'net';
import { createWebSocketStream, WebSocketServer } from 'ws';
import { DeviceEvents } from '../devices/device-events';
import { HA_METRICS } from '../devices/device.entity';
import { DevicesService } from '../devices/devices.service';
import { SettingsService } from '../settings/settings.service';

/** Semua topik di bawah awalan ini: smartfarm/<deviceId>/<telemetry|status|cmd|cmd/ack> */
export const TOPIC_PREFIX = 'smartfarm';
/** MQTT lewat WebSocket menumpang server HTTP (di belakang Caddy/Cloudflare: wss://domain/api/mqtt) */
export const WS_PATH = '/api/mqtt';
export const tcpPort = () => Number(process.env.MQTT_PORT ?? 1883);
export const deviceUsername = (deviceId: number) => `device-${deviceId}`;

type SmartClient = Client & { deviceId?: number; isAdmin?: boolean };
type RelayPayload = { id: number; relay: number; action: string; durationMs: number };

const authError = (): AuthenticateError => Object.assign(new Error('Username atau password salah'), { returnCode: 4 as const });

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Broker MQTT di dalam backend (Aedes). Perangkat login dengan "device-<id>" + device key,
 * mengirim data sensor & menerima perintah relay seketika. Bisa dinyalakan/dimatikan dari halaman Integrasi.
 */
@Injectable()
export class MqttService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('MQTT');
  private broker: Aedes | null = null;
  private tcp: Server | null = null;
  private readonly wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has('mqtt') ? 'mqtt' : false),
  });
  /** deviceId → jumlah koneksi aktif */
  private readonly connected = new Map<number, number>();
  private startedAt: Date | null = null;
  private lastError: string | null = null;
  private messagesReceived = 0;
  private lastMessageAt: Date | null = null;
  private lastMessage: { deviceId: number; topic: string; at: Date } | null = null;

  constructor(
    private readonly devices: DevicesService,
    private readonly events: DeviceEvents,
    private readonly settings: SettingsService,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  async onApplicationBootstrap() {
    this.adapterHost.httpAdapter.getHttpServer().on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
      if (!req.url?.startsWith(WS_PATH)) return;
      if (!this.broker) return socket.destroy();
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        const stream = createWebSocketStream(ws);
        stream.on('error', () => undefined);
        this.broker?.handle(stream, req);
      });
    });
    this.events.onCommandCreated((cmd) => {
      this.dispatch(cmd.deviceId, [cmd]).catch((e) => this.log.warn(`Gagal kirim perintah: ${(e as Error).message}`));
    });
    if (await this.settings.getBool('mqtt.enabled')) await this.start().catch(() => undefined);
  }

  async onModuleDestroy() {
    await this.stop();
  }

  // ---------- nyala / mati ----------

  async setEnabled(enabled: boolean) {
    await this.settings.setBool('mqtt.enabled', enabled);
    if (enabled) await this.start();
    else await this.stop();
    return this.status();
  }

  async start() {
    if (this.broker) return;
    const broker = new Aedes({
      authenticate: (c, u, p, done) => this.authenticate(c as SmartClient, u, p, done),
      authorizePublish: (c, packet, cb) => cb(this.canPublish(c as SmartClient | null, packet.topic) ? null : new Error('Topik tidak diizinkan')),
      authorizeSubscribe: (c, sub, cb) => cb(null, this.canSubscribe(c as SmartClient, sub) ? sub : null),
    });
    broker.on('client', (c) => this.onConnect(c as SmartClient));
    broker.on('clientDisconnect', (c) => this.onDisconnect(c as SmartClient));
    broker.on('publish', (packet, c) => {
      if (c) this.onMessage(c as SmartClient, packet).catch((e) => this.log.warn(`Pesan diabaikan: ${(e as Error).message}`));
    });

    const tcp = createServer(broker.handle);
    try {
      await new Promise<void>((resolve, reject) => {
        tcp.once('error', reject);
        tcp.listen(tcpPort(), '0.0.0.0', () => {
          tcp.off('error', reject);
          resolve();
        });
      });
    } catch (e) {
      broker.close();
      this.lastError = `Port ${tcpPort()} tidak bisa dipakai: ${(e as Error).message}`;
      this.log.error(this.lastError);
      throw new Error(this.lastError);
    }
    this.broker = broker;
    this.tcp = tcp;
    this.startedAt = new Date();
    this.lastError = null;
    this.log.log(`Broker aktif — TCP :${tcpPort()}, WebSocket ${WS_PATH}`);
  }

  async stop() {
    if (!this.broker) return;
    const broker = this.broker;
    const tcp = this.tcp;
    this.broker = null;
    this.tcp = null;
    this.startedAt = null;
    this.connected.clear();
    for (const ws of this.wss.clients) ws.terminate();
    await new Promise<void>((resolve) => broker.close(() => resolve()));
    await new Promise<void>((resolve) => (tcp ? tcp.close(() => resolve()) : resolve()));
    this.log.log('Broker dimatikan');
  }

  status() {
    return {
      running: !!this.broker,
      tcpPort: tcpPort(),
      wsPath: WS_PATH,
      startedAt: this.startedAt,
      connectedClients: this.broker?.connectedClients ?? 0,
      devicesConnected: [...this.connected.keys()],
      messagesReceived: this.messagesReceived,
      lastMessageAt: this.lastMessageAt,
      lastMessage: this.lastMessage,
      lastError: this.lastError,
      adminUsername: process.env.MQTT_ADMIN_USERNAME || null,
    };
  }

  isDeviceConnected(deviceId: number) {
    return (this.connected.get(deviceId) ?? 0) > 0;
  }

  // ---------- autentikasi & hak akses ----------

  private async authenticate(
    client: SmartClient,
    username: string | undefined,
    password: Buffer | undefined,
    done: (error: AuthenticateError | null, success: boolean | null) => void,
  ) {
    try {
      const pass = password?.toString() ?? '';
      const adminUser = process.env.MQTT_ADMIN_USERNAME;
      const adminPass = process.env.MQTT_ADMIN_PASSWORD;
      if (adminUser && adminPass && username === adminUser && safeEqual(pass, adminPass)) {
        client.isAdmin = true;
        return done(null, true);
      }
      const id = Number(/^device-(\d+)$/.exec(username ?? '')?.[1]);
      const device = id ? await this.devices.findById(id) : null;
      if (!device || !safeEqual(pass, device.apiKey)) return done(authError(), false);
      client.deviceId = device.id;
      done(null, true);
    } catch {
      done(authError(), false);
    }
  }

  private canPublish(client: SmartClient | null, topic: string) {
    if (!client || client.isAdmin) return true; // null = pesan dari server sendiri
    const base = `${TOPIC_PREFIX}/${client.deviceId}/`;
    return [`${base}telemetry`, `${base}status`, `${base}cmd/ack`].includes(topic);
  }

  private canSubscribe(client: SmartClient, sub: Subscription) {
    if (client.isAdmin) return true;
    return sub.topic === `${TOPIC_PREFIX}/${client.deviceId}/cmd`;
  }

  // ---------- event broker ----------

  private async onConnect(client: SmartClient) {
    if (!client.deviceId) return;
    this.connected.set(client.deviceId, (this.connected.get(client.deviceId) ?? 0) + 1);
    const device = await this.devices.findById(client.deviceId);
    if (!device) return;
    // Kirim perintah yang tertunda (pullCommands juga menandai online & membuang yang kedaluwarsa)
    const pending = await this.devices.pullCommands(device);
    await this.publishCommands(device.id, pending);
  }

  private onDisconnect(client: SmartClient) {
    if (!client.deviceId) return;
    const n = (this.connected.get(client.deviceId) ?? 1) - 1;
    if (n > 0) this.connected.set(client.deviceId, n);
    else this.connected.delete(client.deviceId);
  }

  private async onMessage(client: SmartClient, packet: PublishPacket) {
    const m = /^smartfarm\/(\d+)\/(telemetry|status|cmd\/ack)$/.exec(packet.topic);
    if (!m) return;
    const deviceId = Number(m[1]);
    if (!client.isAdmin && client.deviceId !== deviceId) return;
    const device = await this.devices.findById(deviceId);
    if (!device) return;

    this.messagesReceived++;
    this.lastMessageAt = new Date();
    this.lastMessage = { deviceId, topic: packet.topic, at: this.lastMessageAt };
    const text = Buffer.from(packet.payload as Buffer).toString().trim();

    if (m[2] === 'telemetry') {
      const data = JSON.parse(text) as Record<string, unknown>;
      const values: Partial<Record<(typeof HA_METRICS)[number], number>> = {};
      for (const k of HA_METRICS) {
        const v = typeof data[k] === 'string' ? Number(data[k]) : data[k];
        if (typeof v === 'number' && Number.isFinite(v)) values[k] = v;
      }
      if (!Object.keys(values).length) throw new Error(`telemetry tanpa nilai sensor dari device ${deviceId}`);
      await this.devices.recordReading(device, values, 'mqtt');
    } else if (m[2] === 'status') {
      if (text.toLowerCase() !== 'offline') await this.devices.touch(device);
    } else {
      const id = Number(text.startsWith('{') ? (JSON.parse(text) as { id?: unknown }).id : text);
      if (Number.isInteger(id)) await this.devices.ackCommand(device, id);
    }
  }

  // ---------- perintah relay ----------

  private async dispatch(deviceId: number, commands: RelayPayload[]) {
    if (!this.broker || !this.isDeviceConnected(deviceId)) return;
    await this.publishCommands(deviceId, commands);
    for (const c of commands) await this.devices.markSent(c.id);
  }

  private async publishCommands(deviceId: number, commands: RelayPayload[]) {
    const broker = this.broker;
    if (!broker) return;
    for (const { id, relay, action, durationMs } of commands) {
      await new Promise<void>((resolve) =>
        broker.publish(
          {
            cmd: 'publish',
            topic: `${TOPIC_PREFIX}/${deviceId}/cmd`,
            payload: Buffer.from(JSON.stringify({ id, relay, action, durationMs })),
            qos: 1,
            retain: false,
            dup: false,
          },
          () => resolve(),
        ),
      );
    }
  }
}
