import type { Guild as GuildSettings, Prisma } from '@prisma/client';
import { diffJson } from '../shared/text';
import { audit } from './audit';
import { clearLevelCache } from './permissions';
import { getSettings, updateSettings } from './settings';
import type { Actor } from './types';

export const PERM_KEYS = ['ownerRoleIds', 'highAdminRoleIds', 'eventManagerRoleIds', 'moderatorRoleIds'];

export function snapshot(s: GuildSettings): Record<string, unknown> {
  return {
    timezone: s.timezone,
    giveawayChannelId: s.giveawayChannelId,
    numberChannelId: s.numberChannelId,
    logChannelId: s.logChannelId,
    logChannels: s.logChannels,
    disabledLogCategories: s.disabledLogCategories,
    logRoleChanges: s.logRoleChanges,
    ownerRoleIds: s.ownerRoleIds,
    highAdminRoleIds: s.highAdminRoleIds,
    eventManagerRoleIds: s.eventManagerRoleIds,
    moderatorRoleIds: s.moderatorRoleIds,
    winnerRoleId: s.winnerRoleId,
    testMode: s.testMode,
    defaults: s.defaults,
    messages: s.messages,
    endingSoonSeconds: s.endingSoonSeconds,
    dashboardEnabled: s.dashboardEnabled,
    ticketCategoryId: s.ticketCategoryId,
    ticketSupportRoleIds: s.ticketSupportRoleIds,
    ticketPrizeRoleIds: s.ticketPrizeRoleIds,
  };
}

function pretty(key: string, v: unknown): unknown {
  const top = key.split('.')[0];
  if (Array.isArray(v) && top.endsWith('RoleIds')) return v.length ? v.map((x) => `<@&${x}>`).join(' ') : '—';
  if (typeof v === 'string' && top === 'winnerRoleId') return `<@&${v}>`;
  if (typeof v === 'string' && (top.endsWith('ChannelId') || top === 'ticketCategoryId' || top === 'logChannels' || key.startsWith('logChannels.'))) return `<#${v}>`;
  if (v === null || v === undefined) return '—';
  return v;
}

/** Gemmer indstillinger og skriver ændringerne (før/efter) i loggen. */
export async function commitSettings(guildId: string, patch: Prisma.GuildUpdateInput, actor: Actor, reason?: string): Promise<GuildSettings> {
  const before = await getSettings(guildId);
  const after = await updateSettings(guildId, patch);
  clearLevelCache();
  const d = diffJson(snapshot(before), snapshot(after));
  const pb: Record<string, unknown> = {}, pa: Record<string, unknown> = {}, sb: Record<string, unknown> = {}, sa: Record<string, unknown> = {};
  for (const k of Object.keys(d.after)) {
    const top = k.split('.')[0];
    const [tb, ta] = PERM_KEYS.includes(top) ? [pb, pa] : [sb, sa];
    tb[k] = pretty(k, d.before[k]);
    ta[k] = pretty(k, d.after[k]);
  }
  const base = { guildId, actorId: actor.id, targetType: 'GUILD', targetId: guildId, reason: reason ?? null, source: actor.source };
  if (Object.keys(pa).length) await audit({ ...base, action: 'PERMISSION_CHANGED', before: pb, after: pa });
  if (Object.keys(sa).length) await audit({ ...base, action: Object.keys(sa).length === 1 && 'testMode' in sa ? 'SETTINGS_TESTMODE' : 'SETTINGS_CHANGED', before: sb, after: sa });
  return after;
}
