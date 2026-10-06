import { Guild, GuildMember, PermissionFlagsBits } from 'discord.js';
import type { Guild as GuildSettings } from '@prisma/client';
import { Level } from '../shared/constants';
import { getSettings } from './settings';

export function levelFromRoles(s: GuildSettings, roleIds: string[], isGuildOwner: boolean): Level {
  if (isGuildOwner) return Level.OWNER;
  const has = (list: string[]) => list.some((r) => roleIds.includes(r));
  if (has(s.ownerRoleIds)) return Level.OWNER;
  if (has(s.highAdminRoleIds)) return Level.HIGH_ADMIN;
  if (has(s.eventManagerRoleIds)) return Level.EVENT_MANAGER;
  if (has(s.moderatorRoleIds)) return Level.MODERATOR;
  return Level.USER;
}

export async function getMemberLevel(member: GuildMember): Promise<Level> {
  const s = await getSettings(member.guild.id);
  return levelFromRoles(s, [...member.roles.cache.keys()], member.guild.ownerId === member.id);
}

const dashCache = new Map<string, { at: number; level: Level }>();

/** Level of a user in a guild (used by the dashboard). Cached for 15 seconds. */
export async function getUserLevel(guild: Guild, userId: string): Promise<Level> {
  const key = `${guild.id}:${userId}`;
  const hit = dashCache.get(key);
  if (hit && Date.now() - hit.at < 15_000) return hit.level;
  let level = Level.USER;
  if (guild.ownerId === userId) level = Level.OWNER;
  else {
    const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
    if (member) level = await getMemberLevel(member);
  }
  dashCache.set(key, { at: Date.now(), level });
  if (dashCache.size > 5000) dashCache.clear();
  return level;
}

export const clearLevelCache = (): void => dashCache.clear();

/** Before the first /setup is finished, a Discord Administrator may bootstrap the bot. */
export function canBootstrap(member: GuildMember, s: GuildSettings): boolean {
  return !s.setupDone && member.permissions.has(PermissionFlagsBits.Administrator);
}
