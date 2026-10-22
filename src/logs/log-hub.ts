import { ConsoleLogger } from '@nestjs/common';

export type LogChannel = 'system' | 'mqtt' | 'ha';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  ts: string;
  level: LogLevel;
  /** Sumber, mis. "MQTT", "HTTP", "HomeAssistant" */
  context: string;
  message: string;
  /** Data mentah (payload MQTT, respons HA, stack trace, …) */
  data?: unknown;
}

const BUFFER_SIZE = Number(process.env.LOG_BUFFER_SIZE ?? 2000);
const MAX_TEXT = 4000;

/** Potong teks/objek besar agar satu pesan tidak menghabiskan memori. */
function clip(data: unknown): unknown {
  if (data == null) return undefined;
  if (typeof data === 'string') return data.length > MAX_TEXT ? `${data.slice(0, MAX_TEXT)}… (+${data.length - MAX_TEXT} karakter)` : data;
  try {
    const text = JSON.stringify(data);
    return text.length > MAX_TEXT ? clip(text) : data;
  } catch {
    return String(data);
  }
}

/**
 * Penampung log di memori (ring buffer per kanal), seperti layar terminal.
 * Singleton modul agar logger Nest bisa menulis bahkan sebelum DI siap.
 */
class LogHub {
  private seq = 0;
  private readonly buffers: Record<LogChannel, LogEntry[]> = { system: [], mqtt: [], ha: [] };

  push(channel: LogChannel, level: LogLevel, context: string, message: string, data?: unknown) {
    const buf = this.buffers[channel];
    buf.push({ id: ++this.seq, ts: new Date().toISOString(), level, context, message, data: clip(data) });
    if (buf.length > BUFFER_SIZE) buf.splice(0, buf.length - BUFFER_SIZE);
  }

  /** Entri setelah id tertentu (untuk tampilan live), atau N terakhir. */
  read(channel: LogChannel, after = 0, limit = 500) {
    const buf = this.buffers[channel];
    const items = after ? buf.filter((e) => e.id > after) : buf;
    return items.slice(-limit);
  }

  clear(channel: LogChannel) {
    this.buffers[channel] = [];
  }

  stats() {
    return Object.fromEntries(
      (Object.keys(this.buffers) as LogChannel[]).map((c) => [
        c,
        { count: this.buffers[c].length, errors: this.buffers[c].filter((e) => e.level === 'error').length },
      ]),
    );
  }
}

export const logHub = new LogHub();

/** Logger Nest yang tetap menulis ke konsol (docker logs) dan menyalinnya ke kanal "system". */
export class HubLogger extends ConsoleLogger {
  log(message: unknown, context?: string) {
    super.log(message, context ?? this.context);
    this.copy('info', message, context);
  }

  warn(message: unknown, context?: string) {
    super.warn(message, context ?? this.context);
    this.copy('warn', message, context);
  }

  error(message: unknown, stackOrContext?: string, context?: string) {
    super.error(message, stackOrContext, context);
    const stack = context ? stackOrContext : undefined;
    this.copy('error', message, context ?? (stack ? undefined : stackOrContext), stack);
  }

  debug(message: unknown, context?: string) {
    super.debug(message, context ?? this.context);
    this.copy('debug', message, context);
  }

  private copy(level: LogLevel, message: unknown, context?: string, stack?: string) {
    const text = message instanceof Error ? message.message : typeof message === 'string' ? message : JSON.stringify(message);
    const trace = stack ?? (message instanceof Error ? message.stack : undefined);
    logHub.push('system', level, context ?? this.context ?? 'App', text, trace);
  }
}
