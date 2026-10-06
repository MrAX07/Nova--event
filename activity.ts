import type { User } from 'discord.js';
import { prisma } from '../db';
import { logError } from '../logger';
import { getClient } from './discord';

// ---------- message counter (for "minimum messages") ----------
const buffer = new Map<string, number>();

export function countMessage(guildId: string, userId: string): void {
  const k = `${guildId}:${userId}`;
  buffer.set(k, (buffer.get(k) ?? 0) + 1);
}

export async function flushActivity(): Promise<void> {
  if (!buffer.size) return;
  const snapshot = [...buffer.entries()];
  buffer.clear();
  try {
    for (let i = 0; i < snapshot.length; i += 100) {
      await prisma.$transaction(
        snapshot.slice(i, i + 100).map(([k, n]) => {
          const [guildId, userId] = k.split(':');
          return prisma.memberActivity.upsert({
            where: { guildId_userId: { guildId, userId } },
            create: { guildId, userId, messages: n },
            update: { messages: { increment: n } },
          });
        }),
      );
    }
  } catch (e) {
    for (const [k, n] of snapshot) buffer.set(k, (buffer.get(k) ?? 0) + n); // put back, retry next time
    await logError('activity.flush', e);
  }
}

export async function getMessageCount(guildId: string, userId: string): Promise<number> {
  const row = await prisma.memberActivity.findUnique({ where: { guildId_userId: { guildId, userId } } });
  return (row?.messages ?? 0) + (buffer.get(`${guildId}:${userId}`) ?? 0);
}

// ---------- user profile cache ----------
const touched = new Map<string, number>();

export async function touchUser(user: Pick<User, 'id' | 'username' | 'avatar'>): Promise<void> {
  const last = touched.get(user.id) ?? 0;
  if (Date.now() - last < 10 * 60_000) return;
  touched.set(user.id, Date.now());
  if (touched.size > 20000) touched.clear();
  try {
    await prisma.userProfile.upsert({
      where: { id: user.id },
      create: { id: user.id, username: user.username, avatar: user.avatar },
      update: { username: user.username, avatar: user.avatar },
    });
  } catch (e) {
    await logError('activity.touchUser', e);
  }
}

export interface UserLite {
  id: string;
  username: string;
  avatar: string | null;
}

/** Resolves ids to usernames using the cache table, falling back to Discord for unknown ids. */
export async function resolveUsers(ids: string[]): Promise<Map<string, UserLite>> {
  const out = new Map<string, UserLite>();
  const unique = [...new Set(ids)];
  if (!unique.length) return out;
  const rows = await prisma.userProfile.findMany({ where: { id: { in: unique } } });
  for (const r of rows) out.set(r.id, { id: r.id, username: r.username, avatar: r.avatar });
  const missing = unique.filter((i) => !out.has(i)).slice(0, 25);
  for (const id of missing) {
    try {
      const u = await getClient().users.fetch(id);
      out.set(id, { id, username: u.username, avatar: u.avatar });
      touchUser(u).catch(() => undefined);
    } catch {
      out.set(id, { id, username: `Unknown (${id})`, avatar: null });
    }
  }
  return out;
}
