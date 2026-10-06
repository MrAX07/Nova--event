import type { Guild as GuildSettings, Prisma } from '@prisma/client';
import { prisma } from '../db';

const cache = new Map<string, { at: number; v: GuildSettings }>();
const TTL = 30_000;

export async function getSettings(guildId: string, name?: string): Promise<GuildSettings> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  const v = await prisma.guild.upsert({
    where: { id: guildId },
    create: { id: guildId, name: name ?? '' },
    update: name ? { name } : {},
  });
  cache.set(guildId, { at: Date.now(), v });
  return v;
}

export async function updateSettings(guildId: string, data: Prisma.GuildUpdateInput): Promise<GuildSettings> {
  await getSettings(guildId);
  const v = await prisma.guild.update({ where: { id: guildId }, data });
  cache.set(guildId, { at: Date.now(), v });
  return v;
}

export const invalidateSettings = (guildId: string): void => {
  cache.delete(guildId);
};

export interface GiveawayDefaults {
  durationSec: number;
  winnerCount: number;
  entriesPerClick: number;
  maxEntries: number;
  bonusMode: 'highest' | 'stack';
}

export function readDefaults(s: GuildSettings): GiveawayDefaults {
  const d = (s.defaults ?? {}) as Partial<GiveawayDefaults>;
  return {
    durationSec: Number(d.durationSec) > 0 ? Number(d.durationSec) : 3600,
    winnerCount: Number(d.winnerCount) > 0 ? Number(d.winnerCount) : 1,
    entriesPerClick: Number(d.entriesPerClick) > 0 ? Number(d.entriesPerClick) : 1,
    maxEntries: Number(d.maxEntries) >= 0 ? Number(d.maxEntries) : 0,
    bonusMode: d.bonusMode === 'stack' ? 'stack' : 'highest',
  };
}
