import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import type { AuditLog, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { logError, setErrorHook } from '../logger';
import { LOG_CATEGORIES, LogCategory, categoryOf } from '../shared/constants';
import { fmtDateTime } from '../shared/time';
import { truncate } from '../shared/text';
import { getTextChannel } from './discord';
import { getSettings } from './settings';

const TITLES: Record<string, string> = {
  GIVEAWAY_CREATED: '🎁 GIVEAWAY OPRETTET',
  GIVEAWAY_SCHEDULED: '⏰ GIVEAWAY PLANLAGT',
  GIVEAWAY_STARTED: '🚀 PLANLAGT GIVEAWAY STARTET',
  GIVEAWAY_EDITED: '✏️ GIVEAWAY REDIGERET',
  GIVEAWAY_ENDED: '🏁 GIVEAWAY AFSLUTTET',
  GIVEAWAY_CANCELLED: '🛑 GIVEAWAY ANNULLERET',
  GIVEAWAY_PAUSED: '⏸️ GIVEAWAY PAUSET',
  GIVEAWAY_RESUMED: '▶️ GIVEAWAY GENOPTAGET',
  GIVEAWAY_DELETED: '🗑️ GIVEAWAY SLETTET',
  GIVEAWAY_TEMPLATE_CREATED: '📋 SKABELON GEMT',
  GIVEAWAY_TEMPLATE_DELETED: '📋 SKABELON SLETTET',
  ENTRY_ADDED: '🛡️ MANUEL ENTRY-ÆNDRING',
  ENTRY_REMOVED: '🛡️ MANUEL ENTRY-ÆNDRING',
  ENTRY_SET: '🛡️ MANUEL ENTRY-ÆNDRING',
  JOIN_ENTERED: '🎟️ DELTAGELSE VIA KNAP',
  WINNER_SELECTED: '🏆 VINDER VALGT',
  WINNER_REJECTED: '❌ VINDER UGYLDIG',
  WINNER_REROLLED: '🔄 VINDER REROLLET',
  WINNER_DM_FAILED: '✉️ VINDER-DM FEJLEDE',
  NUMBER_STARTED: '🎯 TALEVENT STARTET',
  NUMBER_WON: '🏆 TALEVENT VUNDET',
  NUMBER_ENDED: '⌛ TALEVENT AFSLUTTET',
  NUMBER_STOPPED: '🛑 TALEVENT STOPPET',
  NUMBER_REROLLED: '🔄 TALEVENT GENÅBNET',
  ROLE_GRANTED: '🏅 VINDERROLLE GIVET',
  ROLE_GRANT_FAILED: '⚠️ VINDERROLLE FEJLEDE',
  ROLE_ADDED: '➕ ROLLE TILFØJET TIL MEDLEM',
  ROLE_REMOVED: '➖ ROLLE FJERNET FRA MEDLEM',
  BLACKLIST_ADDED: '🚫 BRUGER BLACKLISTET',
  BLACKLIST_REMOVED: '✅ BRUGER FJERNET FRA BLACKLIST',
  PERMISSION_CHANGED: '🔐 RETTIGHEDER ÆNDRET',
  SETTINGS_CHANGED: '⚙️ INDSTILLINGER ÆNDRET',
  SETTINGS_TESTMODE: '🧪 TESTTILSTAND ÆNDRET',
  EXPORT_CREATED: '📤 DATA EKSPORTERET',
  ERROR_LOGGED: '⚠️ FEJL',
  TICKET_OPENED: '🎫 TICKET OPRETTET',
  TICKET_CLAIMED: '🙋 TICKET OVERTAGET',
  TICKET_CLOSED: '🔒 TICKET LUKKET',
  TICKET_USER_ADDED: '➕ BRUGER TILFØJET TIL TICKET',
  TICKET_USER_REMOVED: '➖ BRUGER FJERNET FRA TICKET',
  TICKET_PANEL: '🎫 TICKET-PANEL OPRETTET',
};

const CAT_COLOR: Record<LogCategory, number> = {
  GIVEAWAY: 0xe11d2e,
  ENTRY: 0xffb454,
  JOIN: 0x60a5fa,
  WINNER: 0xffc857,
  NUMBER: 0xff3b47,
  ADMIN: 0xa78bfa,
  TICKET: 0x38bdf8,
  SETTINGS: 0x94a3b8,
  ERROR: 0xb91c1c,
};

export interface AuditInput {
  guildId: string;
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  eventCode?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  source?: 'discord' | 'dashboard' | 'system';
  files?: AttachmentBuilder[];
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') {
    const lines = Object.entries(v as Record<string, unknown>).map(([k, val]) => {
      const s = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val);
      return `**${k}:** ${truncate(s, 200)}`;
    });
    return truncate(lines.join('\n') || '—', 1000);
  }
  return truncate(String(v), 1000);
}

function targetText(type?: string | null, id?: string | null): string {
  if (!id) return '—';
  if (type === 'USER') return `<@${id}>`;
  if (type === 'ROLE') return `<@&${id}>`;
  if (type === 'CHANNEL') return `<#${id}>`;
  return type ? `${type}: ${id}` : id;
}

export function auditEmbed(row: AuditLog, tz: string): EmbedBuilder {
  const cat = categoryOf(row.action);
  const e = new EmbedBuilder()
    .setColor(CAT_COLOR[cat])
    .setTitle(TITLES[row.action] ?? row.action.replace(/_/g, ' '))
    .setTimestamp(row.createdAt);
  const b = (row.before ?? {}) as Record<string, any>;
  const a = (row.after ?? {}) as Record<string, any>;
  const who = row.actorId ? `<@${row.actorId}>${row.source === 'dashboard' ? ' (kontrolpanel)' : ''}` : 'System';

  if (row.action.startsWith('ENTRY_') || row.action === 'JOIN_ENTERED') {
    const diff = Number(a.entries ?? 0) - Number(b.entries ?? 0);
    e.addFields(
      { name: row.action === 'JOIN_ENTERED' ? 'Bruger' : 'Admin', value: row.action === 'JOIN_ENTERED' ? targetText('USER', row.targetId) : who, inline: true },
      ...(row.action === 'JOIN_ENTERED' ? [] : [{ name: 'Bruger', value: targetText('USER', row.targetId), inline: true }]),
      { name: 'Ændring', value: `${diff >= 0 ? '+' : ''}${diff} entries`, inline: true },
      { name: 'Før', value: String(b.entries ?? 0), inline: true },
      { name: 'Nu', value: String(a.entries ?? 0), inline: true },
      { name: 'Giveaway', value: row.eventCode ?? '—', inline: true },
      { name: 'Årsag', value: truncate(row.reason || 'Ingen årsag angivet', 500) },
      { name: 'Tidspunkt', value: fmtDateTime(row.createdAt, tz) },
    );
    return e;
  }

  e.addFields({ name: 'Hvem', value: who, inline: true });
  if (row.targetId || row.targetType) e.addFields({ name: 'Mål', value: targetText(row.targetType, row.targetId), inline: true });
  if (row.eventCode) e.addFields({ name: 'Event', value: row.eventCode, inline: true });
  if (row.before !== null && row.before !== undefined) e.addFields({ name: 'Før', value: fmtVal(row.before) });
  if (row.after !== null && row.after !== undefined) e.addFields({ name: 'Efter', value: fmtVal(row.after) });
  if (row.reason) e.addFields({ name: 'Årsag', value: truncate(row.reason, 500) });
  e.addFields({ name: 'Tidspunkt', value: fmtDateTime(row.createdAt, tz) });
  return e;
}

export async function sendLogEmbed(guildId: string, category: LogCategory, embed: EmbedBuilder, files?: AttachmentBuilder[]): Promise<void> {
  try {
    const s = await getSettings(guildId);
    if (s.disabledLogCategories.includes(category)) return;
    const per = (s.logChannels ?? {}) as Record<string, string>;
    const channelId = per[category] || s.logChannelId;
    if (!channelId) return;
    const ch = await getTextChannel(guildId, channelId);
    if (!ch) return;
    await ch.send({ embeds: [embed], files, allowedMentions: { parse: [] } });
  } catch (e) {
    console.error(`[audit] could not post to log channel (${category})`, e instanceof Error ? e.message : e);
  }
}

/** Writes an audit row and posts it to the configured log channel. Never throws. */
export async function audit(input: AuditInput): Promise<AuditLog | null> {
  try {
    const category = categoryOf(input.action);
    const s = await getSettings(input.guildId);
    if (category === 'JOIN' && s.disabledLogCategories.includes('JOIN')) return null;
    const row = await prisma.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId ?? null,
        action: input.action,
        category,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        eventCode: input.eventCode ?? null,
        before: (input.before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (input.after ?? undefined) as Prisma.InputJsonValue | undefined,
        reason: input.reason ?? null,
        source: input.source ?? 'discord',
      },
    });
    await sendLogEmbed(input.guildId, category, auditEmbed(row, s.timezone), input.files);
    return row;
  } catch (e) {
    await logError('audit', e, null);
    return null;
  }
}

setErrorHook(async (guildId, scope, message) => {
  const embed = new EmbedBuilder()
    .setColor(CAT_COLOR.ERROR)
    .setTitle(TITLES.ERROR_LOGGED)
    .addFields({ name: 'Hvor', value: truncate(scope, 200) }, { name: 'Besked', value: truncate(message || '—', 900) })
    .setTimestamp(new Date());
  await sendLogEmbed(guildId, 'ERROR', embed);
});

export const LOG_CATEGORY_LIST = Object.entries(LOG_CATEGORIES).map(([key, label]) => ({ key, label }));
