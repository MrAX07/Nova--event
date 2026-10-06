import crypto from 'node:crypto';
import { ButtonInteraction, EmbedBuilder, GuildMember, MessageFlags } from 'discord.js';
import { Prisma } from '@prisma/client';
import type { Event as EventRow } from '@prisma/client';
import { prisma } from '../db';
import { errMsg, logError } from '../logger';
import { COLORS } from '../shared/constants';
import { UserError, diffJson, fill, getMessage, truncate } from '../shared/text';
import { fmtDurationLong } from '../shared/time';
import { audit } from './audit';
import { getMessageCount, touchUser } from './activity';
import { getMember, getTextChannel, messageUrl } from './discord';
import {
  GiveawayConfig,
  errEmbed,
  eventVars,
  giveawayEmbed,
  giveawayRow,
  normalizeGiveawayConfig,
  okEmbed,
} from './embeds';
import { isBlacklisted } from './blacklist';
import { normalizeCode, requireEvent } from './entries';
import { rewardWinner } from './rewards';
import { getSettings, readDefaults } from './settings';
import type { Actor } from './types';

export const MAX_DURATION_SEC = 90 * 86400;
export const MIN_DURATION_SEC = 10;
const EPH = MessageFlags.Ephemeral;

export { normalizeCode, requireEvent };

export async function generateCode(): Promise<string> {
  for (let i = 0; i < 25; i++) {
    const code = `EVENT-${crypto.randomInt(10000, 100000)}`;
    const ex = await prisma.event.findUnique({ where: { code }, select: { id: true } });
    if (!ex) return code;
  }
  return `EVENT-${Date.now().toString().slice(-9)}`;
}

export const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export async function getStats(eventId: string): Promise<{ entries: number; participants: number }> {
  const agg = await prisma.entry.aggregate({ where: { eventId, amount: { gt: 0 } }, _sum: { amount: true }, _count: { _all: true } });
  return { entries: agg._sum.amount ?? 0, participants: agg._count._all };
}

export async function currentWinnerIds(eventId: string): Promise<string[]> {
  const rows = await prisma.winner.findMany({ where: { eventId, status: 'VALID' }, orderBy: { place: 'asc' }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

function validateBasics(prize: string, durationSec: number, winnerCount: number): void {
  if (!prize.trim() || prize.length > 250) throw new UserError('Præmien skal være mellem 1 og 250 tegn.');
  if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 50) throw new UserError('Antallet af vindere skal være mellem 1 og 50.');
  if (!Number.isFinite(durationSec) || durationSec < MIN_DURATION_SEC || durationSec > MAX_DURATION_SEC) {
    throw new UserError(`Varigheden skal være mellem ${MIN_DURATION_SEC} sekunder og 90 dage.`);
  }
}

// ───────────────────────── creating & posting ─────────────────────────

export interface CreateGiveawayInput {
  guildId: string;
  actor: Actor;
  channelId: string;
  prize: string;
  durationSec: number;
  winnerCount: number;
  startsAt?: Date | null;
  config: unknown;
  test?: boolean;
}

export async function createGiveaway(input: CreateGiveawayInput): Promise<EventRow> {
  validateBasics(input.prize, input.durationSec, input.winnerCount);
  const settings = await getSettings(input.guildId);
  const cfg = normalizeGiveawayConfig(input.config, readDefaults(settings));
  const now = new Date();
  const scheduled = !!input.startsAt && input.startsAt.getTime() > now.getTime() + 5000;
  if (scheduled && input.startsAt!.getTime() > now.getTime() + 365 * 86400_000) throw new UserError('Du kan højst planlægge et giveaway ét år frem.');
  const ch = await getTextChannel(input.guildId, input.channelId);
  if (!ch) throw new UserError('Jeg kan ikke tilgå den kanal. Vælg en tekstkanal hvor jeg har rettighederne Se kanal, Send beskeder og Indlejr links.');

  const code = await generateCode();
  const startsAt = scheduled ? input.startsAt! : now;
  let ev = await prisma.event.create({
    data: {
      code,
      guildId: input.guildId,
      type: 'GIVEAWAY',
      status: scheduled ? 'SCHEDULED' : 'ACTIVE',
      prize: input.prize.trim(),
      winnerCount: input.winnerCount,
      channelId: input.channelId,
      hostId: input.actor.id,
      isTest: !!input.test || settings.testMode,
      startsAt,
      endsAt: scheduled ? null : new Date(now.getTime() + input.durationSec * 1000),
      durationSec: input.durationSec,
      config: cfg as unknown as Prisma.InputJsonValue,
    },
  });
  if (!scheduled) {
    try {
      ev = await postGiveaway(ev);
    } catch (e) {
      await prisma.event.delete({ where: { id: ev.id } }).catch(() => undefined);
      throw e;
    }
  }
  await audit({
    guildId: input.guildId,
    actorId: input.actor.id,
    action: scheduled ? 'GIVEAWAY_SCHEDULED' : 'GIVEAWAY_CREATED',
    targetType: 'EVENT',
    targetId: ev.id,
    eventCode: ev.code,
    after: {
      prize: ev.prize,
      winners: ev.winnerCount,
      channel: `<#${ev.channelId}>`,
      duration: fmtDurationLong(ev.durationSec),
      ...(scheduled ? { startsAt: startsAt.toISOString() } : {}),
      test: ev.isTest,
    },
    source: input.actor.source,
  });
  return ev;
}

async function postGiveaway(ev: EventRow): Promise<EventRow> {
  const ch = await getTextChannel(ev.guildId, ev.channelId);
  if (!ch) throw new UserError('Jeg kan ikke længere tilgå giveaway-kanalen.');
  const settings = await getSettings(ev.guildId);
  const started = getMessage(settings.messages, 'giveawayStarted');
  try {
    const msg = await ch.send({
      content: started.enabled ? fill(started.text, eventVars(ev, '')) : undefined,
      embeds: [giveawayEmbed(ev, { entries: 0, participants: 0 })],
      components: [giveawayRow(ev)],
      allowedMentions: { parse: ['roles', 'everyone'] },
    });
    return await prisma.event.update({ where: { id: ev.id }, data: { messageId: msg.id } });
  } catch (e) {
    throw new UserError(`Jeg kunne ikke sende giveawayet i <#${ev.channelId}>: ${errMsg(e)}. Tjek mine rettigheder (Se kanal, Send beskeder, Indlejr links).`);
  }
}

export async function startScheduledGiveaway(ev: EventRow): Promise<void> {
  const now = new Date();
  const r = await prisma.event.updateMany({
    where: { id: ev.id, status: 'SCHEDULED' },
    data: { status: 'ACTIVE', startsAt: now, endsAt: new Date(now.getTime() + ev.durationSec * 1000) },
  });
  if (r.count !== 1) return;
  const fresh = await prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
  try {
    await postGiveaway(fresh);
    await audit({ guildId: ev.guildId, actorId: ev.hostId, action: 'GIVEAWAY_STARTED', targetType: 'EVENT', targetId: ev.id, eventCode: ev.code, after: { prize: ev.prize, channel: `<#${ev.channelId}>` }, source: 'system' });
  } catch (e) {
    await prisma.event.update({ where: { id: ev.id }, data: { status: 'CANCELLED', endedAt: new Date() } });
    await logError('giveaways.startScheduled', e, ev.guildId);
  }
}

// ───────────────────────── message refresh ─────────────────────────

const refreshTimers = new Map<string, NodeJS.Timeout>();

export async function refreshGiveaway(code: string): Promise<void> {
  try {
    const ev = await prisma.event.findUnique({ where: { code } });
    if (!ev || !ev.messageId || ev.type !== 'GIVEAWAY') return;
    const ch = await getTextChannel(ev.guildId, ev.channelId);
    if (!ch) return;
    const msg = await ch.messages.fetch(ev.messageId).catch(() => null);
    if (!msg) return;
    const stats = await getStats(ev.id);
    const winners = ev.status === 'ENDED' ? await currentWinnerIds(ev.id) : undefined;
    await msg.edit({ embeds: [giveawayEmbed(ev, stats, winners)], components: [giveawayRow(ev)] });
  } catch (e) {
    await logError('giveaways.refresh', e);
  }
}

/** Debounced refresh so a flood of entries does not hit Discord's rate limits. */
export function requestRefresh(code: string): void {
  if (refreshTimers.has(code)) return;
  refreshTimers.set(
    code,
    setTimeout(() => {
      refreshTimers.delete(code);
      refreshGiveaway(code).catch(() => undefined);
    }, 5000),
  );
}

// ───────────────────────── eligibility & entering ─────────────────────────

/** Returns null when eligible, otherwise a short human reason. */
export async function checkEligibility(ev: EventRow, cfg: GiveawayConfig, member: GuildMember, mode: 'entry' | 'winner'): Promise<string | null> {
  const bl = await isBlacklisted(ev.guildId, member.id, ev.code);
  if (bl) return bl.scope === 'global' ? 'Blacklistet fra alle giveaways' : 'Blacklistet fra dette giveaway';
  const roles = member.roles.cache;
  if (cfg.blacklistedRoles.some((r) => roles.has(r))) return 'Har en rolle der ikke er tilladt';
  if (cfg.requiredRoles.length && !cfg.requiredRoles.some((r) => roles.has(r))) return 'Mangler en påkrævet rolle';
  if (cfg.minAccountAgeDays) {
    const days = (Date.now() - member.user.createdTimestamp) / 86400_000;
    if (days < cfg.minAccountAgeDays) return `Discord-kontoen er for ny (skal være ${cfg.minAccountAgeDays} dage gammel)`;
  }
  if (cfg.minServerDays) {
    const days = (Date.now() - (member.joinedTimestamp ?? Date.now())) / 86400_000;
    if (days < cfg.minServerDays) return `Har ikke været på serveren længe nok (kræver ${cfg.minServerDays} dage)`;
  }
  if (cfg.minMessages) {
    const n = await getMessageCount(ev.guildId, member.id);
    if (n < cfg.minMessages) return `For få beskeder sendt (${n}/${cfg.minMessages})`;
  }
  if (mode === 'entry' && cfg.voiceRequired) {
    const vc = member.voice.channelId;
    if (!vc) return 'Skal være i en stemmekanal';
    if (cfg.voiceChannelId && vc !== cfg.voiceChannelId) return 'Skal være i den påkrævede stemmekanal';
  }
  return null;
}

export function computeEntries(cfg: GiveawayConfig, member: GuildMember): number {
  const base = cfg.entriesPerClick;
  const bonuses = cfg.bonusRoles.filter((b) => member.roles.cache.has(b.roleId)).map((b) => b.entries);
  let n = base;
  if (bonuses.length) n = cfg.bonusMode === 'stack' ? base + bonuses.reduce((a, b) => a + b, 0) : Math.max(base, ...bonuses);
  if (cfg.maxEntries > 0) n = Math.min(n, cfg.maxEntries);
  return Math.max(1, n);
}

export async function handleEnter(i: ButtonInteraction): Promise<void> {
  await i.deferReply({ flags: EPH });
  const code = i.customId.split(':')[2];
  if (!i.guildId || !i.guild) return;
  const ev = await prisma.event.findUnique({ where: { code } });
  if (!ev || ev.guildId !== i.guildId || ev.type !== 'GIVEAWAY') {
    await i.editReply({ embeds: [errEmbed('Dette giveaway findes ikke længere.')] });
    return;
  }
  if (ev.status === 'PAUSED') {
    await i.editReply({ embeds: [errEmbed('⏸️ Dette giveaway er sat på pause. Prøv igen når det genoptages.')] });
    return;
  }
  if (ev.status !== 'ACTIVE' || (ev.endsAt && ev.endsAt.getTime() <= Date.now())) {
    await i.editReply({ embeds: [errEmbed('Dette giveaway tager ikke længere imod deltagere.')] });
    return;
  }
  const member = await i.guild.members.fetch(i.user.id).catch(() => null);
  if (!member || member.user.bot) {
    await i.editReply({ embeds: [errEmbed('Jeg kunne ikke bekræfte dit medlemskab af serveren.')] });
    return;
  }
  const cfg = normalizeGiveawayConfig(ev.config);
  const reason = await checkEligibility(ev, cfg, member, 'entry');
  if (reason) {
    await i.editReply({ embeds: [errEmbed(`Du kan ikke deltage i dette giveaway: ${reason}.`)] });
    return;
  }
  const amount = computeEntries(cfg, member);
  try {
    await prisma.$transaction([
      prisma.entry.create({ data: { eventId: ev.id, guildId: ev.guildId, userId: member.id, amount, isTest: ev.isTest } }),
      prisma.entryTransaction.create({
        data: { guildId: ev.guildId, eventId: ev.id, eventCode: ev.code, userId: member.id, type: 'JOIN', delta: amount, before: 0, after: amount, isTest: ev.isTest },
      }),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) {
      const cur = await prisma.entry.findUnique({ where: { eventId_userId: { eventId: ev.id, userId: member.id } } });
      await i.editReply({ embeds: [okEmbed(`Du deltager allerede i dette giveaway med **${cur?.amount ?? amount}** ${((cur?.amount ?? amount) === 1) ? 'entry' : 'entries'}. Held og lykke! 🍀`)] });
      return;
    }
    throw e;
  }
  touchUser(member.user).catch(() => undefined);
  await audit({ guildId: ev.guildId, actorId: member.id, action: 'JOIN_ENTERED', targetType: 'USER', targetId: member.id, eventCode: ev.code, before: { entries: 0 }, after: { entries: amount } });
  requestRefresh(ev.code);
  await i.editReply({ embeds: [okEmbed(`Du er med! Du har nu **${amount}** ${amount === 1 ? 'entry' : 'entries'}. Held og lykke! 🍀`, '🎟️ DU ER MED')] });
}

export async function handleMyEntries(i: ButtonInteraction): Promise<void> {
  await i.deferReply({ flags: EPH });
  const code = i.customId.split(':')[2];
  const ev = await prisma.event.findUnique({ where: { code } });
  if (!ev || ev.guildId !== i.guildId) {
    await i.editReply({ embeds: [errEmbed('Dette giveaway findes ikke længere.')] });
    return;
  }
  const mine = await prisma.entry.findUnique({ where: { eventId_userId: { eventId: ev.id, userId: i.user.id } } });
  const stats = await getStats(ev.id);
  const amount = mine?.amount ?? 0;
  const chance = stats.entries > 0 ? ((amount / stats.entries) * 100).toFixed(2) : '0.00';
  const e = new EmbedBuilder()
    .setColor(COLORS.BRAND)
    .setTitle('🎟️ Dine entries')
    .addFields(
      { name: '👤 Bruger', value: `<@${i.user.id}>`, inline: true },
      { name: '🎟️ Entries', value: String(amount), inline: true },
      { name: '🎯 Chance', value: `${chance}%`, inline: true },
      { name: 'I alt i giveawayet', value: `${stats.entries.toLocaleString('en-US')} entries • ${stats.participants.toLocaleString('en-US')} deltagere` },
    )
    .setFooter({ text: ev.code });
  await i.editReply({ embeds: [e] });
}

// ───────────────────────── winners ─────────────────────────

async function verifyWinner(ev: EventRow, cfg: GiveawayConfig, userId: string): Promise<string | null> {
  const member = await getMember(ev.guildId, userId);
  if (!member) return 'Er ikke længere på serveren';
  return checkEligibility(ev, cfg, member, 'winner');
}

export async function pickWinners(
  ev: EventRow,
  count: number,
  exclude: Set<string>,
): Promise<{ winners: string[]; rejected: { userId: string; reason: string }[] }> {
  const cfg = normalizeGiveawayConfig(ev.config);
  const rows = await prisma.entry.findMany({ where: { eventId: ev.id, amount: { gt: 0 } }, select: { userId: true, amount: true } });
  const pool = rows.filter((r) => !exclude.has(r.userId));
  let total = pool.reduce((a, r) => a + r.amount, 0);
  const winners: string[] = [];
  const rejected: { userId: string; reason: string }[] = [];
  while (winners.length < count && pool.length) {
    let roll = crypto.randomInt(0, total);
    let idx = 0;
    for (; idx < pool.length; idx++) {
      roll -= pool[idx].amount;
      if (roll < 0) break;
    }
    if (idx >= pool.length) idx = pool.length - 1;
    const [pick] = pool.splice(idx, 1);
    total -= pick.amount;
    const why = await verifyWinner(ev, cfg, pick.userId);
    if (why) rejected.push({ userId: pick.userId, reason: why });
    else winners.push(pick.userId);
  }
  return { winners, rejected };
}

async function lowestFreePlaces(eventId: string, n: number): Promise<number[]> {
  const used = new Set((await prisma.winner.findMany({ where: { eventId, status: 'VALID' }, select: { place: true } })).map((w) => w.place));
  const out: number[] = [];
  for (let p = 1; out.length < n; p++) if (!used.has(p)) out.push(p);
  return out;
}

async function persistWinners(ev: EventRow, picked: { winners: string[]; rejected: { userId: string; reason: string }[] }, rerolled: boolean, actor?: Actor): Promise<number[]> {
  for (const r of picked.rejected) {
    await prisma.winner.create({
      data: { eventId: ev.id, guildId: ev.guildId, userId: r.userId, place: null, status: 'REJECTED', rejectReason: r.reason, eventType: 'GIVEAWAY', isTest: ev.isTest, rerolled },
    });
    await audit({ guildId: ev.guildId, action: 'WINNER_REJECTED', targetType: 'USER', targetId: r.userId, eventCode: ev.code, reason: r.reason, source: 'system', actorId: actor?.id });
  }
  const places = await lowestFreePlaces(ev.id, picked.winners.length);
  for (let i = 0; i < picked.winners.length; i++) {
    await prisma.winner.create({
      data: { eventId: ev.id, guildId: ev.guildId, userId: picked.winners[i], place: places[i], prize: ev.prize, status: 'VALID', eventType: 'GIVEAWAY', isTest: ev.isTest, rerolled },
    });
    await audit({ guildId: ev.guildId, action: rerolled ? 'WINNER_REROLLED' : 'WINNER_SELECTED', targetType: 'USER', targetId: picked.winners[i], eventCode: ev.code, after: { place: places[i], prize: ev.prize }, source: actor?.source ?? 'system', actorId: actor?.id });
  }
  return places;
}

async function announceResult(ev: EventRow, winners: string[], places: number[], rerolled: boolean): Promise<void> {
  const settings = await getSettings(ev.guildId);
  const cfg = normalizeGiveawayConfig(ev.config);
  const url = messageUrl(ev.guildId, ev.channelId, ev.messageId);
  const mentions = winners.map((w) => `<@${w}>`).join(', ');
  const vars = { ...eventVars(ev, url), winners: mentions };
  await refreshGiveaway(ev.code);
  const ch = await getTextChannel(ev.guildId, ev.channelId);
  if (ch) {
    const lines: string[] = [];
    const ended = getMessage(settings.messages, 'giveawayEnded');
    if (!rerolled && ended.enabled) lines.push(fill(ended.text, vars));
    if (winners.length) {
      const win = getMessage(settings.messages, 'winnerSelected');
      const text = cfg.winnerMessage ?? (win.enabled ? win.text : '');
      if (text) lines.push(fill(text, vars));
      if (rerolled) lines.unshift('🔄 **Reroll!**');
    } else {
      const none = getMessage(settings.messages, 'giveawayNoWinners');
      if (none.enabled) lines.push(fill(none.text, vars));
    }
    if (ev.isTest) lines.push('🧪 *Testtilstand: der blev ikke sendt roller eller DM\'er.*');
    if (lines.length) {
      await ch
        .send({
          content: winners.length ? winners.map((w) => `<@${w}>`).join(' ') : undefined,
          embeds: [new EmbedBuilder().setColor(winners.length ? COLORS.GOLD : COLORS.ENDED).setDescription(truncate(lines.join('\n\n'), 4000)).setFooter({ text: ev.code })],
          reply: ev.messageId ? { messageReference: ev.messageId, failIfNotExists: false } : undefined,
          allowedMentions: { users: winners },
        })
        .catch((e) => logError('giveaways.announce', e, ev.guildId));
    }
  }
  for (let i = 0; i < winners.length; i++) await rewardWinner(ev, winners[i], places[i] ?? i + 1, ev.prize);
}

const drawing = new Set<string>();

/** Draws winners for an ENDED giveaway that has none yet. Safe to call twice. */
export async function drawWinners(evId: string): Promise<string[]> {
  if (drawing.has(evId)) return [];
  drawing.add(evId);
  try {
    const ev = await prisma.event.findUniqueOrThrow({ where: { id: evId } });
    const existing = await prisma.winner.count({ where: { eventId: ev.id } });
    let winners: string[];
    let places: number[];
    if (existing === 0) {
      const picked = await pickWinners(ev, ev.winnerCount, new Set());
      places = await persistWinners(ev, picked, false);
      winners = picked.winners;
    } else {
      const rows = await prisma.winner.findMany({ where: { eventId: ev.id, status: 'VALID' }, orderBy: { place: 'asc' } });
      winners = rows.map((r) => r.userId);
      places = rows.map((r) => r.place ?? 0);
    }
    await prisma.event.update({ where: { id: ev.id }, data: { winnersDrawn: true } });
    await announceResult(ev, winners, places, false);
    return winners;
  } finally {
    drawing.delete(evId);
  }
}

export async function endGiveaway(guildId: string, codeInput: string, actor: Actor | null, reason?: string): Promise<string[]> {
  const ev = await requireEvent(guildId, codeInput, 'GIVEAWAY');
  const now = new Date();
  const r = await prisma.event.updateMany({
    where: { id: ev.id, status: { in: ['ACTIVE', 'PAUSED'] } },
    data: { status: 'ENDED', endedAt: now, endsAt: now, remainingSec: null, pausedAt: null },
  });
  if (r.count !== 1) throw new UserError(`**${ev.code}** er allerede afsluttet eller annulleret.`);
  await audit({
    guildId,
    actorId: actor?.id ?? null,
    action: 'GIVEAWAY_ENDED',
    targetType: 'EVENT',
    targetId: ev.id,
    eventCode: ev.code,
    before: { status: ev.status },
    after: { status: 'ENDED' },
    reason: reason ?? (actor ? 'Afsluttet manuelt' : 'Tiden løb ud'),
    source: actor?.source ?? 'system',
  });
  return drawWinners(ev.id);
}

export async function rerollGiveaway(
  guildId: string,
  codeInput: string,
  actor: Actor,
  opts: { count: number; allowRejected: boolean; replaceUserId?: string | null },
): Promise<string[]> {
  const ev = await requireEvent(guildId, codeInput, 'GIVEAWAY');
  if (ev.status !== 'ENDED' || !ev.winnersDrawn) throw new UserError(`**${ev.code}** er ikke afsluttet endnu. Afslut det først, før du kan reroll'e.`);
  let count = Math.floor(opts.count);
  if (!(count >= 1 && count <= 50)) throw new UserError('Du kan reroll\'e mellem 1 og 50 vindere.');
  if (drawing.has(ev.id)) throw new UserError('Der kører allerede en trækning for dette giveaway. Prøv igen om lidt.');
  drawing.add(ev.id);
  try {
    if (opts.replaceUserId) {
      const row = await prisma.winner.findFirst({ where: { eventId: ev.id, userId: opts.replaceUserId, status: 'VALID' } });
      if (!row) throw new UserError('Den bruger er ikke en nuværende vinder af dette giveaway.');
      await prisma.winner.update({ where: { id: row.id }, data: { status: 'REJECTED', place: null, rejectReason: 'Erstattet via reroll' } });
      await audit({ guildId, actorId: actor.id, action: 'WINNER_REJECTED', targetType: 'USER', targetId: opts.replaceUserId, eventCode: ev.code, reason: 'Erstattet via reroll', source: actor.source });
      count = 1;
    }
    const all = await prisma.winner.findMany({ where: { eventId: ev.id }, select: { userId: true, status: true } });
    const exclude = new Set<string>(all.filter((w) => w.status === 'VALID' || !opts.allowRejected).map((w) => w.userId));
    const picked = await pickWinners(ev, count, exclude);
    const places = await persistWinners(ev, picked, true, actor);
    if (!picked.winners.length) throw new UserError('Der er ingen tilbage at vælge: alle andre deltagere er allerede vindere, afvist eller ikke længere berettigede.');
    await announceResult(ev, picked.winners, places, true);
    return picked.winners;
  } finally {
    drawing.delete(ev.id);
  }
}

/** Called by the scheduler: re-runs draws that were interrupted by a crash. */
export async function retryUndrawn(): Promise<void> {
  const rows = await prisma.event.findMany({
    where: { type: 'GIVEAWAY', status: 'ENDED', winnersDrawn: false, endedAt: { lt: new Date(Date.now() - 60_000) } },
    take: 10,
  });
  for (const ev of rows) await drawWinners(ev.id).catch((e) => logError('giveaways.retryUndrawn', e, ev.guildId));
}

// ───────────────────────── pause / resume / cancel / delete / edit ─────────────────────────

export async function pauseGiveaway(guildId: string, codeInput: string, actor: Actor): Promise<EventRow> {
  const ev = await requireEvent(guildId, codeInput, 'GIVEAWAY');
  if (ev.status !== 'ACTIVE' || !ev.endsAt) throw new UserError('Kun aktive giveaways kan pauses.');
  const remaining = Math.max(1, Math.ceil((ev.endsAt.getTime() - Date.now()) / 1000));
  const r = await prisma.event.updateMany({ where: { id: ev.id, status: 'ACTIVE' }, data: { status: 'PAUSED', pausedAt: new Date(), remainingSec: remaining } });
  if (r.count !== 1) throw new UserError('Det giveaway er ikke længere aktivt.');
  await audit({ guildId, actorId: actor.id, action: 'GIVEAWAY_PAUSED', targetType: 'EVENT', targetId: ev.id, eventCode: ev.code, before: { status: 'ACTIVE' }, after: { status: 'PAUSED', remaining: fmtDurationLong(remaining) }, source: actor.source });
  await refreshGiveaway(ev.code);
  return prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
}

export async function resumeGiveaway(guildId: string, codeInput: string, actor: Actor): Promise<EventRow> {
  const ev = await requireEvent(guildId, codeInput, 'GIVEAWAY');
  if (ev.status !== 'PAUSED') throw new UserError('Kun pausede giveaways kan genoptages.');
  const remaining = Math.max(1, ev.remainingSec ?? 1);
  const r = await prisma.event.updateMany({
    where: { id: ev.id, status: 'PAUSED' },
    data: { status: 'ACTIVE', pausedAt: null, remainingSec: null, endsAt: new Date(Date.now() + remaining * 1000), endingNotified: ev.endingNotified.filter((t) => t >= remaining) },
  });
  if (r.count !== 1) throw new UserError('Det giveaway er ikke længere sat på pause.');
  await audit({ guildId, actorId: actor.id, action: 'GIVEAWAY_RESUMED', targetType: 'EVENT', targetId: ev.id, eventCode: ev.code, before: { status: 'PAUSED' }, after: { status: 'ACTIVE', remaining: fmtDurationLong(remaining) }, source: actor.source });
  await refreshGiveaway(ev.code);
  return prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
}

export async function cancelGiveaway(guildId: string, codeInput: string, actor: Actor, reason?: string): Promise<EventRow> {
  const ev = await requireEvent(guildId, codeInput, 'GIVEAWAY');
  const r = await prisma.event.updateMany({
    where: { id: ev.id, status: { in: ['ACTIVE', 'PAUSED', 'SCHEDULED'] } },
    data: { status: 'CANCELLED', endedAt: new Date(), pausedAt: null, remainingSec: null },
  });
  if (r.count !== 1) throw new UserError(`**${ev.code}** er allerede afsluttet eller annulleret.`);
  await audit({ guildId, actorId: actor.id, action: 'GIVEAWAY_CANCELLED', targetType: 'EVENT', targetId: ev.id, eventCode: ev.code, before: { status: ev.status }, after: { status: 'CANCELLED' }, reason: reason ?? null, source: actor.source });
  await refreshGiveaway(ev.code);
  return prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
}

export async function deleteEvent(guildId: string, codeInput: string, actor: Actor): Promise<void> {
  const ev = await requireEvent(guildId, codeInput);
  if (ev.status === 'ACTIVE' || ev.status === 'PAUSED') throw new UserError('Annuller eller afslut eventet, før du sletter det.');
  const stats = await getStats(ev.id);
  await prisma.event.delete({ where: { id: ev.id } });
  if (ev.messageId) {
    const ch = await getTextChannel(ev.guildId, ev.channelId);
    await ch?.messages.delete(ev.messageId).catch(() => undefined);
  }
  await audit({ guildId, actorId: actor.id, action: 'GIVEAWAY_DELETED', targetType: 'EVENT', targetId: ev.id, eventCode: ev.code, before: { prize: ev.prize, status: ev.status, participants: stats.participants, entries: stats.entries }, source: actor.source });
}

export interface GiveawayPatch {
  prize?: string;
  winnerCount?: number;
  /** Seconds from now (active), remaining time (paused) or total duration (scheduled). */
  endsInSec?: number;
  config?: Record<string, any>;
}

export async function editGiveaway(guildId: string, codeInput: string, patch: GiveawayPatch, actor: Actor): Promise<EventRow> {
  const ev = await requireEvent(guildId, codeInput, 'GIVEAWAY');
  if (ev.status === 'ENDED' || ev.status === 'CANCELLED') throw new UserError('Afsluttede giveaways kan ikke redigeres.');
  const curCfg = normalizeGiveawayConfig(ev.config);
  const raw = { ...curCfg, ...(patch.config ?? {}), embed: { ...curCfg.embed, ...((patch.config?.embed as object | undefined) ?? {}) } };
  const nextCfg = normalizeGiveawayConfig(raw);
  const prize = patch.prize !== undefined ? patch.prize.trim() : ev.prize;
  const winnerCount = patch.winnerCount ?? ev.winnerCount;
  validateBasics(prize, patch.endsInSec ?? Math.max(ev.durationSec, MIN_DURATION_SEC), winnerCount);
  const data: Prisma.EventUpdateInput = { prize, winnerCount, config: nextCfg as unknown as Prisma.InputJsonValue };
  if (patch.endsInSec !== undefined) {
    if (ev.status === 'ACTIVE') {
      data.endsAt = new Date(Date.now() + patch.endsInSec * 1000);
      data.endingNotified = ev.endingNotified.filter((t) => t >= patch.endsInSec!);
    } else if (ev.status === 'PAUSED') data.remainingSec = patch.endsInSec;
    else data.durationSec = patch.endsInSec;
  }
  const updated = await prisma.event.update({ where: { id: ev.id }, data });
  const d = diffJson(
    { prize: ev.prize, winnerCount: ev.winnerCount, endsAt: ev.endsAt?.toISOString() ?? null, config: curCfg },
    { prize: updated.prize, winnerCount: updated.winnerCount, endsAt: updated.endsAt?.toISOString() ?? null, config: nextCfg },
  );
  if (Object.keys(d.after).length) {
    await audit({ guildId, actorId: actor.id, action: 'GIVEAWAY_EDITED', targetType: 'EVENT', targetId: ev.id, eventCode: ev.code, before: d.before, after: d.after, source: actor.source });
  }
  await refreshGiveaway(ev.code);
  return updated;
}

// ───────────────────────── ending-soon notices ─────────────────────────

export async function notifyEndingSoon(ev: EventRow, thresholds: number[]): Promise<void> {
  if (!ev.endsAt) return;
  const remaining = (ev.endsAt.getTime() - Date.now()) / 1000;
  if (remaining <= 0) return;
  const crossed = thresholds.filter((t) => remaining <= t && !ev.endingNotified.includes(t));
  if (!crossed.length) return;
  const claim = await prisma.event.updateMany({
    where: { id: ev.id, status: 'ACTIVE', NOT: { endingNotified: { hasSome: crossed } } },
    data: { endingNotified: { push: crossed } },
  });
  if (claim.count !== 1) return;
  if (ev.durationSec <= Math.min(...crossed)) return; // too short for this notice to make sense
  const settings = await getSettings(ev.guildId);
  const m = getMessage(settings.messages, 'endingSoon');
  if (!m.enabled) return;
  const ch = await getTextChannel(ev.guildId, ev.channelId);
  if (!ch) return;
  await ch
    .send({
      content: fill(m.text, eventVars(ev, messageUrl(ev.guildId, ev.channelId, ev.messageId))),
      reply: ev.messageId ? { messageReference: ev.messageId, failIfNotExists: false } : undefined,
      allowedMentions: { parse: [] },
    })
    .catch((e) => logError('giveaways.endingSoon', e, ev.guildId));
}

// ───────────────────────── preview ─────────────────────────

export function makePreviewEvent(p: { guildId: string; hostId: string; channelId: string; prize: string; durationSec: number; winnerCount: number; config: unknown; test: boolean }): EventRow {
  const now = new Date();
  return {
    id: 'preview',
    code: 'EVENT-PREVIEW',
    guildId: p.guildId,
    type: 'GIVEAWAY',
    status: 'ACTIVE',
    prize: p.prize,
    winnerCount: p.winnerCount,
    channelId: p.channelId,
    messageId: null,
    hostId: p.hostId,
    isTest: p.test,
    startsAt: now,
    endsAt: new Date(now.getTime() + p.durationSec * 1000),
    durationSec: p.durationSec,
    remainingSec: null,
    pausedAt: null,
    endedAt: null,
    endingNotified: [],
    winnersDrawn: false,
    secretNumber: null,
    winnersFound: 0,
    hintsSent: 0,
    config: p.config as Prisma.JsonValue,
    createdAt: now,
    updatedAt: now,
  };
}

