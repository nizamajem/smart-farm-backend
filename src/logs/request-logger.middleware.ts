import type { NextFunction, Request, Response } from 'express';
import { clientInfo } from '../activity/client-info.decorator';
import { logHub } from './log-hub';

/** Jalur yang dipanggil berkala oleh UI — tidak dicatat agar log tidak penuh. */
const QUIET = [/^\/api\/logs/, /^\/api\/health/];
const SLOW_MS = 3000;

/** Middleware Express: catat request yang gagal (4xx/5xx) atau lambat ke kanal "system". */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  let rejection: string | undefined;
  const originalJson = res.json;
  res.json = function (body: unknown) {
    if (res.statusCode >= 400 && body && typeof body === 'object') {
      const message = (body as { message?: unknown }).message;
      // Only validation/business messages for dosing; never log tokens, request bodies or credentials.
      if (/^\/api\/devices\/\d+\/nutrients(?:\/|$)/.test(req.originalUrl.split('?')[0])) {
        const parts = Array.isArray(message) ? message.filter(v => typeof v === 'string') : typeof message === 'string' ? [message] : [];
        rejection = parts.join('; ').slice(0, 500) || undefined;
      }
    }
    return originalJson.call(this, body);
  };
  res.on('finish', () => {
    const url = req.originalUrl.split('?')[0];
    if (QUIET.some((r) => r.test(url))) return;
    const ms = Date.now() - start;
    const status = res.statusCode;
    if (status < 400 && ms < SLOW_MS) return;
    const c = clientInfo(req);
    logHub.push(
      'system',
      status >= 500 ? 'error' : 'warn',
      'HTTP',
      `${req.method} ${url} → ${status} (${ms} ms)${status < 400 ? ' — lambat' : ''}`,
      { ip: c.ip, platform: c.platform, userAgent: c.userAgent, ...(rejection ? { reason: rejection } : {}) },
    );
  });
  next();
}
