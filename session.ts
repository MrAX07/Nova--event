import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import type { WebSession } from '@prisma/client';
import { env } from '../env';
import { prisma } from '../db';

const COOKIE = 'nova_sid';
const MAX_AGE_MS = 7 * 86400_000;
const hash = (id: string) => crypto.createHmac('sha256', env.SESSION_SECRET).update(id).digest('hex');

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(res: Response, name: string, value: string, maxAgeSec: number): void {
  const flags = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (env.SECURE_COOKIES) flags.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  const list = Array.isArray(prev) ? prev.map(String) : prev ? [String(prev)] : [];
  res.setHeader('Set-Cookie', [...list, flags.join('; ')]);
}

export async function createSession(res: Response, user: { id: string; username: string; avatar: string | null }): Promise<void> {
  const sid = crypto.randomBytes(32).toString('hex');
  await prisma.webSession.create({
    data: { id: hash(sid), userId: user.id, username: user.username, avatar: user.avatar, csrf: crypto.randomBytes(24).toString('hex'), expiresAt: new Date(Date.now() + MAX_AGE_MS) },
  });
  setCookie(res, COOKIE, sid, MAX_AGE_MS / 1000);
}

export async function getSession(req: Request): Promise<WebSession | null> {
  const sid = parseCookies(req)[COOKIE];
  if (!sid || !/^[0-9a-f]{64}$/.test(sid)) return null;
  const row = await prisma.webSession.findUnique({ where: { id: hash(sid) } });
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.webSession.delete({ where: { id: row.id } }).catch(() => undefined);
    return null;
  }
  return row;
}

export async function destroySession(req: Request, res: Response): Promise<void> {
  const sid = parseCookies(req)[COOKIE];
  if (sid && /^[0-9a-f]{64}$/.test(sid)) await prisma.webSession.deleteMany({ where: { id: hash(sid) } });
  setCookie(res, COOKIE, '', 0);
}
