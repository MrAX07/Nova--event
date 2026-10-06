import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import type { Event as EventRow } from '@prisma/client';
import { COLORS } from '../shared/constants';
import { fill, hexToInt, isHexColor, isHttpUrl, isValidEmoji, truncate } from '../shared/text';
import { fmtDurationLong, ts } from '../shared/time';
import type { GiveawayDefaults } from './settings';

const SNOWFLAKE = /^\d{15,25}$/;
const num = (v: unknown, d: number, lo: number, hi: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : d;
};
const strOrNull = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
const idList = (v: unknown, max = 25): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && SNOWFLAKE.test(x)))].slice(0, max) : [];

export interface GiveawayConfig {
  requiredRoles: string[];
  blacklistedRoles: string[];
  minAccountAgeDays: number;
  minServerDays: number;
  minMessages: number;
  voiceRequired: boolean;
  voiceChannelId: string | null;
  bonusRoles: { roleId: string; entries: number }[];
  bonusMode: 'highest' | 'stack';
  maxEntries: number;
  entriesPerClick: number;
  embed: {
    title: string | null;
    description: string | null;
    footer: string | null;
    thumbnail: string | null;
    image: string | null;
    timestamp: boolean;
    color: string | null;
    buttonLabel: string | null;
    buttonEmoji: string | null;
  };
  winnerMessage: string | null;
}

export function normalizeGiveawayConfig(raw: unknown, defaults?: GiveawayDefaults): GiveawayConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const e = (r.embed && typeof r.embed === 'object' ? r.embed : {}) as Record<string, any>;
  const bonus: { roleId: string; entries: number }[] = [];
  if (Array.isArray(r.bonusRoles)) {
    for (const b of r.bonusRoles) {
      if (b && typeof b.roleId === 'string' && SNOWFLAKE.test(b.roleId) && !bonus.some((x) => x.roleId === b.roleId)) {
        bonus.push({ roleId: b.roleId, entries: num(b.entries, 1, 1, 1000) });
      }
    }
  }
  const thumb = strOrNull(e.thumbnail, 500);
  const img = strOrNull(e.image, 500);
  const color = strOrNull(e.color, 10);
  const emoji = strOrNull(e.buttonEmoji, 60);
  return {
    requiredRoles: idList(r.requiredRoles),
    blacklistedRoles: idList(r.blacklistedRoles),
    minAccountAgeDays: num(r.minAccountAgeDays, 0, 0, 3650),
    minServerDays: num(r.minServerDays, 0, 0, 3650),
    minMessages: num(r.minMessages, 0, 0, 1_000_000),
    voiceRequired: r.voiceRequired === true,
    voiceChannelId: typeof r.voiceChannelId === 'string' && SNOWFLAKE.test(r.voiceChannelId) ? r.voiceChannelId : null,
    bonusRoles: bonus.slice(0, 25),
    bonusMode: r.bonusMode === 'stack' ? 'stack' : r.bonusMode === 'highest' ? 'highest' : (defaults?.bonusMode ?? 'highest'),
    maxEntries: r.maxEntries !== undefined ? num(r.maxEntries, 0, 0, 1_000_000) : (defaults?.maxEntries ?? 0),
    entriesPerClick: r.entriesPerClick !== undefined ? num(r.entriesPerClick, 1, 1, 1000) : (defaults?.entriesPerClick ?? 1),
    embed: {
      title: strOrNull(e.title, 200),
      description: strOrNull(e.description, 1500),
      footer: strOrNull(e.footer, 100),
      thumbnail: thumb && isHttpUrl(thumb) ? thumb : null,
      image: img && isHttpUrl(img) ? img : null,
      timestamp: e.timestamp !== false,
      color: color && isHexColor(color) ? color : null,
      buttonLabel: strOrNull(e.buttonLabel, 80),
      buttonEmoji: emoji && isValidEmoji(emoji) ? emoji : null,
    },
    winnerMessage: strOrNull(r.winnerMessage, 1000),
  };
}

export interface NumberConfig {
  min: number;
  max: number;
  prizes: string[];
  hints: { count: number; intervalSec: number; range: number };
  higherLower: boolean;
  showRange: boolean;
}

export function normalizeNumberConfig(raw: unknown): NumberConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const h = (r.hints && typeof r.hints === 'object' ? r.hints : {}) as Record<string, any>;
  return {
    min: num(r.min, 1, -1_000_000_000, 1_000_000_000),
    max: num(r.max, 10000, -1_000_000_000, 1_000_000_000),
    prizes: Array.isArray(r.prizes) ? r.prizes.filter((p: unknown) => typeof p === 'string').map((p: string) => p.slice(0, 200)).slice(0, 10) : [],
    hints: { count: num(h.count, 0, 0, 10), intervalSec: num(h.intervalSec, 60, 5, 86400), range: num(h.range, 1000, 2, 2_000_000_000) },
    higherLower: r.higherLower === true,
    showRange: r.showRange !== false,
  };
}

export const eventVars = (ev: EventRow, url: string): Record<string, string> => ({
  prize: ev.prize,
  id: ev.code,
  winners: String(ev.winnerCount),
  host: `<@${ev.hostId}>`,
  ends: ev.endsAt ? ts(ev.endsAt, 'R') : 'snart',
  link: url,
  min: String(normalizeNumberConfig(ev.config).min),
  max: String(normalizeNumberConfig(ev.config).max),
});

const STATUS_COLOR: Record<string, number> = {
  ACTIVE: COLORS.BRAND,
  PAUSED: COLORS.PAUSED,
  ENDED: COLORS.ENDED,
  CANCELLED: COLORS.CANCELLED,
  SCHEDULED: COLORS.SCHEDULED,
};

export function requirementLines(cfg: GiveawayConfig): string[] {
  const l: string[] = [];
  if (cfg.requiredRoles.length) l.push(`Kræver en af rollerne: ${cfg.requiredRoles.map((r) => `<@&${r}>`).join(' eller ')}`);
  if (cfg.blacklistedRoles.length) l.push(`Ikke tilladt: ${cfg.blacklistedRoles.map((r) => `<@&${r}>`).join(' ')}`);
  if (cfg.minAccountAgeDays) l.push(`Discord-konto mindst ${cfg.minAccountAgeDays} dage gammel`);
  if (cfg.minServerDays) l.push(`Medlem af serveren i mindst ${cfg.minServerDays} dage`);
  if (cfg.minMessages) l.push(`Mindst ${cfg.minMessages} sendte beskeder`);
  if (cfg.voiceRequired) l.push(cfg.voiceChannelId ? `Vær i <#${cfg.voiceChannelId}>` : 'Vær i en stemmekanal');
  if (cfg.maxEntries) l.push(`Maks. ${cfg.maxEntries} entries pr. person`);
  return l;
}

export function giveawayEmbed(
  ev: EventRow,
  stats: { entries: number; participants: number },
  winnerIds?: string[],
): EmbedBuilder {
  const cfg = normalizeGiveawayConfig(ev.config);
  const vars = eventVars(ev, '');
  const e = new EmbedBuilder().setColor(cfg.embed.color ? hexToInt(cfg.embed.color) : STATUS_COLOR[ev.status] ?? COLORS.BRAND);
  e.setTitle(truncate(cfg.embed.title ? fill(cfg.embed.title, vars) : `🎉 ${ev.prize}`, 256));

  const lines: string[] = [];
  if (cfg.embed.description) lines.push(fill(cfg.embed.description, vars), '');
  lines.push(`**Vært:** <@${ev.hostId}>`);
  lines.push(`**Vindere:** ${ev.winnerCount}`);
  if (ev.status === 'ACTIVE' && ev.endsAt) lines.push(`**Slutter:** ${ts(ev.endsAt, 'R')} (${ts(ev.endsAt, 'f')})`);
  if (ev.status === 'PAUSED') lines.push(`**⏸️ Pauset** — ${fmtDurationLong(ev.remainingSec ?? 0)} tilbage`);
  if (ev.status === 'SCHEDULED') lines.push(`**Starter:** ${ts(ev.startsAt, 'f')}`);
  if (ev.status === 'ENDED') {
    lines.push(`**Sluttede:** ${ev.endedAt ? ts(ev.endedAt, 'R') : '—'}`);
    lines.push(`**${winnerIds && winnerIds.length === 1 ? 'Vinder' : 'Vindere'}:** ${winnerIds && winnerIds.length ? winnerIds.map((i) => `<@${i}>`).join(', ') : 'Ingen gyldig vinder'}`);
  }
  if (ev.status === 'CANCELLED') lines.push('**🛑 Dette giveaway blev annulleret.**');
  lines.push(`**Entries:** ${stats.entries.toLocaleString('en-US')} • **Deltagere:** ${stats.participants.toLocaleString('en-US')}`);
  e.setDescription(truncate(lines.join('\n'), 4000));

  const req = requirementLines(cfg);
  if (req.length) e.addFields({ name: 'Krav', value: truncate(req.map((x) => `• ${x}`).join('\n'), 1000) });
  if (cfg.bonusRoles.length) {
    e.addFields({
      name: cfg.bonusMode === 'stack' ? 'Bonus-entries (lægges sammen)' : 'Bonus-entries',
      value: truncate(cfg.bonusRoles.map((b) => `<@&${b.roleId}> → **${b.entries}** ${b.entries === 1 ? 'entry' : 'entries'}`).join('\n'), 1000),
    });
  }
  if (cfg.embed.thumbnail) e.setThumbnail(cfg.embed.thumbnail);
  if (cfg.embed.image) e.setImage(cfg.embed.image);
  e.setFooter({ text: truncate(`${cfg.embed.footer ?? 'Nova Events'} • ${ev.code}${ev.isTest ? ' • 🧪 TEST' : ''}`, 2000) });
  if (cfg.embed.timestamp) e.setTimestamp(new Date());
  return e;
}

export function giveawayRow(ev: EventRow, forcePreview = false): ActionRowBuilder<ButtonBuilder> {
  const cfg = normalizeGiveawayConfig(ev.config);
  const enter = new ButtonBuilder()
    .setCustomId(`gw:enter:${ev.code}`)
    .setLabel(cfg.embed.buttonLabel ?? 'DELTAG I GIVEAWAY')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(forcePreview || ev.status !== 'ACTIVE');
  enter.setEmoji(cfg.embed.buttonEmoji ?? '🎉');
  const mine = new ButtonBuilder()
    .setCustomId(`gw:info:${ev.code}`)
    .setLabel('Mine entries')
    .setEmoji('🎟️')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(forcePreview || ev.status === 'CANCELLED');
  return new ActionRowBuilder<ButtonBuilder>().addComponents(enter, mine);
}

export const placeLabel = (p: number): string =>
  p === 1 ? '🥇 1. plads' : p === 2 ? '🥈 2. plads' : p === 3 ? '🥉 3. plads' : `🏅 ${p}. plads`;

export function prizeFor(ev: Pick<EventRow, 'prize' | 'config'>, place: number): string {
  const c = normalizeNumberConfig(ev.config);
  return c.prizes[place - 1] ?? ev.prize;
}

export function numberEmbed(
  ev: EventRow,
  opts: { winners?: { place: number; userId: string; prize: string | null }[]; reveal?: boolean; note?: string } = {},
): EmbedBuilder {
  const cfg = normalizeNumberConfig(ev.config);
  const color = ev.status === 'ACTIVE' ? 0xff3b47 : ev.status === 'CANCELLED' ? COLORS.CANCELLED : COLORS.ENDED;
  const lines: string[] = ['━━━━━━━━━━━━━━━━━━', ''];
  lines.push(ev.winnerCount > 1 ? `De første **${ev.winnerCount}**, der skriver det rigtige tal, vinder!` : 'Den første, der skriver det rigtige tal, vinder!');
  lines.push('');
  if (ev.winnerCount > 1 && cfg.prizes.length > 1) {
    lines.push('🏆 **Præmier:**');
    for (let p = 1; p <= ev.winnerCount; p++) lines.push(`${placeLabel(p)}: ${prizeFor(ev, p)}`);
  } else {
    lines.push('🏆 **Præmie:**', ev.prize);
  }
  lines.push('', '🔢 **Tal:**', opts.reveal && ev.secretNumber !== null ? `\`${ev.secretNumber}\`` : '???');
  if (cfg.showRange) lines.push('', `📏 **Interval:** ${cfg.min.toLocaleString('en-US')} – ${cfg.max.toLocaleString('en-US')}`);
  lines.push('', '⏱️ **Tid:**', ev.status === 'ACTIVE' && ev.endsAt ? `${fmtDurationLong(ev.durationSec)} (slutter ${ts(ev.endsAt, 'R')})` : fmtDurationLong(ev.durationSec));
  if (cfg.higherLower && ev.status === 'ACTIVE') lines.push('', '⬆️⬇️ Højere/lavere-hints er **slået til**.');
  if (opts.winners && opts.winners.length) {
    lines.push('', '🎊 **Vindere:**');
    for (const w of opts.winners) lines.push(`${placeLabel(w.place)}: <@${w.userId}>${w.prize ? ` — ${w.prize}` : ''}`);
  }
  if (opts.note) lines.push('', opts.note);
  return new EmbedBuilder()
    .setColor(color)
    .setTitle('🎯 TALEVENT')
    .setDescription(truncate(lines.join('\n'), 4000))
    .setFooter({ text: `Nova Events • ${ev.code}${ev.isTest ? ' • 🧪 TEST' : ''}` })
    .setTimestamp(new Date());
}

export const okEmbed = (text: string, title?: string): EmbedBuilder =>
  new EmbedBuilder().setColor(COLORS.OK).setDescription(text).setTitle(title ?? null);
export const errEmbed = (text: string): EmbedBuilder =>
  new EmbedBuilder().setColor(COLORS.ERR).setTitle('❌ Fejl').setDescription(truncate(text, 3500));
export const infoEmbed = (text: string, title?: string): EmbedBuilder =>
  new EmbedBuilder().setColor(COLORS.BRAND).setDescription(truncate(text, 4000)).setTitle(title ?? null);
