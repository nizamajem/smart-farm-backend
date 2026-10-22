import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface ClientInfo {
  platform: string | null;
  appVersion: string | null;
  ip: string | null;
  userAgent: string | null;
}

const header = (req: Request, name: string) => {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v)?.trim() || null;
};

export function clientInfo(req: Request): ClientInfo {
  const ua = header(req, 'user-agent');
  // Aplikasi mengirim x-client (web/android/ios); fallback tebak dari user-agent
  const platform =
    header(req, 'x-client')?.toLowerCase().slice(0, 16) ??
    (ua ? (/android/i.test(ua) ? 'android' : /iphone|ipad/i.test(ua) ? 'ios' : 'web') : null);
  // Di belakang Cloudflare + Caddy: IP asli ada di CF-Connecting-IP / X-Forwarded-For
  const ip = header(req, 'cf-connecting-ip') ?? header(req, 'x-forwarded-for')?.split(',')[0].trim() ?? req.ip ?? null;
  return {
    platform,
    appVersion: header(req, 'x-app-version')?.slice(0, 32) ?? null,
    ip,
    userAgent: ua?.slice(0, 255) ?? null,
  };
}

/** Info klien (platform, versi aplikasi, IP, user-agent) untuk dicatat di log aktivitas. */
export const Client = createParamDecorator((_: unknown, ctx: ExecutionContext): ClientInfo =>
  clientInfo(ctx.switchToHttp().getRequest()),
);
