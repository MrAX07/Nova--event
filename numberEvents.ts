import crypto from 'node:crypto';
import { EmbedBuilder, Message } from 'discord.js';
import type { Event as EventRow, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { errMsg, logError } from '../logger';
import { COLORS } from '../shared/constants';
import { UserError, fill, getMessage, truncate } from '../shared/text';
import { fmtDurationLong } from '../shared/time';
import { audit } from './audit';
import { getTextChannel, messageUrl } from './discord';
import { requireEvent } from './entries';
import { NumberConfig, normalizeNumberConfig, numberEmbed, placeLabel, prizeFor } from './embeds';
import { isUniqueViolation, generateCode } from './giveaways';
import { rewardWinner } from './rewards';
import { getSettings } from './settings';
import type { Actor } from './types';

interface ActiveNumber {
  id: string;
  code: string;
  guildId: string;
  channelId: string;
  secret: number;
  min: number;
  max: number;
  higherLower: boolean;
  winnerCount: number;
}

/** channelId → the one active number event in that channel. Rebuilt from the database, never the source of truth. */
const active = new Map<string, ActiveNumber>();

export async function reloadActiveNumberEvents(): Promise<void> {
  const rows = await prisma.event.findMany({ where: { type: 'NUMBER', status: 'ACTIVE' } });
  active.clear();
  for (const r of rows) {
    if (r.secretNumber === null) continue;
    const cfg = normalizeNumberConfig(r.config);
    active.set(r.channelId, {
      id: r.id,
      code: r.code,
      guildId: r.guildId,
      channelId: r.channelId,
      secret: r.secretNumber,
      min: cfg.min,
      max: cfg.max,
      higherLower: cfg.higherLower,
      winnerCount: r.winnerCount,
    });
  }
}

export interface StartNumberInput {
  guildId: string;
  actor: Actor;
  channelId: string;
  prize: string;
  min: number;
  max: number;
  number?: number | null;
  durationSec: number;
  winnerCount: number;
  prizes?: string[];
  hintCount?: number;
  hintIntervalSec?: number | null;
  hintRange?: number | null;
  higherLower?: boolean;
  showRange?: boolean;
  test?: boolean;
}

export async function startNumberEvent(input: StartNumberInput): Promise<EventRow> {
  const prize = input.prize.trim();
  if (!prize || prize.length > 250) throw new UserError('Præmien skal være mellem 1 og 250 tegn.');
  if (!Number.isInteger(input.min) || !Number.isInteger(input.max)) throw new UserError('Minimum og maksimum skal være hele tal.');
  if (Math.abs(input.min) > 1_000_000_000 || Math.abs(input.max) > 1_000_000_000) throw new UserError('Tal skal være mellem -1.000.000.000 og 1.000.000.000.');
  if (input.max <= input.min) throw new UserError('Maksimum skal være større end minimum.');
  if (input.number !== null && input.number !== undefined && (!Number.isInteger(input.number) || input.number < input.min || input.number > input.max)) {
    throw new UserError(`Det hemmelige tal skal være et helt tal mellem ${input.min} og ${input.max}.`);
  }
  if (!Number.isInteger(input.winnerCount) || input.winnerCount < 1 || input.winnerCount > 10) throw new UserError('Antallet af vindere skal være mellem 1 og 10.');
  if (!Number.isFinite(input.durationSec) || input.durationSec < 30 || input.durationSec > 7 * 86400) throw new UserError('Varigheden skal være mellem 30 sekunder og 7 dage.');
  const hintCount = Math.max(0, Math.min(10, Math.floor(input.hintCount ?? 0)));
  const ch = await getTextChannel(input.guildId, input.channelId);
  if (!ch) throw new UserError('Jeg kan ikke tilgå den kanal. Vælg en tekstkanal hvor jeg har rettighederne Se kanal, Send beskeder og Indlejr links.');
  const busy = await prisma.event.findFirst({ where: { type: 'NUMBER', status: 'ACTIVE', channelId: input.channelId } });
  if (busy) throw new UserError(`Der er allerede et aktivt talevent (**${busy.code}**) i <#${input.channelId}>. Stop det først eller vælg en anden kanal.`);

  const settings = await getSettings(input.guildId);
  const secret = input.number ?? crypto.randomInt(input.min, input.max + 1);
  const prizes = (input.prizes ?? []).map((p) => p.trim()).filter(Boolean).slice(0, input.winnerCount);
  while (input.winnerCount > 1 && prizes.length > 0 && prizes.length < input.winnerCount) prizes.push(prize);
  const span = input.max - input.min;
  const cfg: NumberConfig = {
    min: input.min,
    max: input.max,
    prizes,
    hints: {
      count: hintCount,
      intervalSec: Math.max(5, input.hintIntervalSec ?? Math.floor(input.durationSec / (hintCount + 1))),
      range: Math.max(2, input.hintRange ?? Math.max(2, Math.floor(span * 0.3))),
    },
    higherLower: !!input.higherLower,
    showRange: input.showRange !== false,
  };
  const now = new Date();
  let ev = await prisma.event.create({
    data: {
      code: await generateCode(),
      guildId: input.guildId,
      type: 'NUMBER',
      status: 'ACTIVE',
      prize,
      winnerCount: input.winnerCount,
      channelId: input.channelId,
      hostId: input.actor.id,
      isTest: !!input.test || settings.testMode,
      startsAt: now,
      endsAt: new Date(now.getTime() + input.durationSec * 1000),
      durationSec: input.durationSec,
      secretNumber: secret,
      config: cfg as unknown as Prisma.InputJsonValue,
    },
  });
  try {
    const started = getMessage(settings.messages, 'numberStarted');
    const msg = await ch.send({
      content: started.enabled ? fill(started.text, { prize, id: ev.code, min: String(cfg.min), max: String(cfg.max), ends: `<t:${Math.floor((ev.endsAt as Date).getTime() / 1000)}:R>` }) : undefined,
      embeds: [numberEmbed(ev)],
      allowedMentions: { parse: ['roles', 'everyone'] },
    });
    ev = await prisma.event.update({ where: { id: ev.id }, data: { messageId: msg.id } });
  } catch (e) {
    await prisma.event.delete({ where: { id: ev.id } }).catch(() => undefined);
    throw new UserError(`Jeg kunne ikke sende talevent i <#${input.channelId}>: ${errMsg(e)}`);
  }
  await reloadActiveNumberEvents();
  await audit({
    guildId: input.guildId,
    actorId: input.actor.id,
    action: 'NUMBER_STARTED',
    targetType: 'EVENT',
    targetId: ev.id,
    eventCode: ev.code,
    // Det hemmelige tal skrives bevidst IKKE i loggen.
    after: { prize, winners: ev.winnerCount, channel: `<#${ev.channelId}>`, interval: `${cfg.min}–${cfg.max}`, varighed: fmtDurationLong(ev.durationSec), hints: hintCount, higherLower: cfg.higherLower, test: ev.isTest },
    source: input.actor.source,
  });
  return ev;
}

// ───────────────────────── message handling ─────────────────────────

const chains = new Map<string, Promise<void>>();
function enqueue(key: string, fn: () => Promise<void>): void {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev
    .then(fn)
    .catch((e) => {
      void logError('numberEvents.attemptWin', e);
    })
    .finally(() => {
      if (chains.get(key) === next) chains.delete(key);
    });
  chains.set(key, next);
}

const hintCooldown = new Map<string, number>();

export function handleNumberMessage(message: Message): void {
  if (message.author.bot || !message.guildId || !message.content) return;
  const ev = active.get(message.channelId);
  if (!ev || ev.guildId !== message.guildId) return;
  const text = message.content.trim();
  if (!/^-?\d{1,10}$/.test(text)) return; // exact numbers only: "7384abc" / "17384" / "7 384" never match
  const n = Number(text);
  if (!Number.isSafeInteger(n) || String(n) !== text) return;
  if (n === ev.secret) {
    enqueue(ev.id, () => attemptWin(ev, message));
    return;
  }
  if (ev.higherLower) {
    const k = `${ev.id}:${message.author.id}`;
    const last = hintCooldown.get(k) ?? 0;
    if (Date.now() - last < 2500) return;
    hintCooldown.set(k, Date.now());
    if (hintCooldown.size > 5000) hintCooldown.clear();
    message.reply({ content: n < ev.secret ? '⬆️ **HIGHER!**' : '⬇️ **LOWER!**', allowedMentions: { repliedUser: false } }).catch(() => undefined);
  }
}

async function attemptWin(a: ActiveNumber, message: Message): Promise<void> {
  const userId = message.author.id;
  const prior = await prisma.winner.findFirst({ where: { eventId: a.id, userId } });
  if (prior) return;
  // One single SQL statement = atomic. Only as many people as there are winner slots can pass this.
  const rows = await prisma.$queryRaw<{ winnersFound: number }[]>`
    UPDATE "Event" SET "winnersFound" = "winnersFound" + 1
    WHERE "id" = ${a.id} AND "status" = 'ACTIVE' AND "winnersFound" < "winnerCount"
    RETURNING "winnersFound"`;
  if (!rows.length) return;
  const found = rows[0].winnersFound;
  const finished = found >= a.winnerCount;
  if (finished) active.delete(a.channelId); // stop reacting instantly

  const ev = await prisma.event.findUniqueOrThrow({ where: { id: a.id } });
  let place = 0;
  for (let p = 1; p <= ev.winnerCount; p++) {
    try {
      await prisma.winner.create({
        data: { eventId: ev.id, guildId: ev.guildId, userId, place: p, prize: prizeFor(ev, p), status: 'VALID', eventType: 'NUMBER', isTest: ev.isTest },
      });
      place = p;
      break;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  if (!place) {
    await prisma.event.update({ where: { id: ev.id }, data: { winnersFound: { decrement: 1 } } });
    return;
  }
  if (finished) {
    const now = new Date();
    await prisma.event.updateMany({ where: { id: ev.id, status: 'ACTIVE' }, data: { status: 'ENDED', endedAt: now, endsAt: now, winnersDrawn: true } });
    await reloadActiveNumberEvents();
  }
  const prize = prizeFor(ev, place);
  const settings = await getSettings(ev.guildId);
  const m = getMessage(settings.messages, 'numberWinner');
  const ch = await getTextChannel(ev.guildId, ev.channelId);
  if (ch) {
    const text = fill(m.text, { winner: `<@${userId}>`, number: String(ev.secretNumber), prize, place: placeLabel(place), id: ev.code });
    const extra = ev.isTest ? '\n\n🧪 *Testtilstand: der blev ikke sendt roller eller DM\'er.*' : '';
    await ch
      .send({
        content: `<@${userId}>`,
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.GOLD)
            .setTitle(`🏆 ${ev.winnerCount > 1 ? placeLabel(place).toUpperCase() : 'VINDER'}`)
            .setDescription(truncate((m.enabled ? text : `${placeLabel(place)}: <@${userId}> — **${prize}**`) + extra, 4000))
            .setFooter({ text: `Nova Events • ${ev.code}` }),
        ],
        reply: { messageReference: message.id, failIfNotExists: false },
        allowedMentions: { users: [userId] },
      })
      .catch((e) => logError('numberEvents.announce', e, ev.guildId));
  }
  await audit({ guildId: ev.guildId, actorId: userId, action: 'NUMBER_WON', targetType: 'USER', targetId: userId, eventCode: ev.code, after: { place, prize, number: ev.secretNumber }, source: 'system' });
  await rewardWinner(ev, userId, place, prize);
  await updateNumberMessage(ev.code);
}

export async function updateNumberMessage(code: string, note?: string): Promise<void> {
  try {
    const ev = await prisma.event.findUnique({ where: { code } });
    if (!ev || !ev.messageId) return;
    const ch = await getTextChannel(ev.guildId, ev.channelId);
    const msg = ch ? await ch.messages.fetch(ev.messageId).catch(() => null) : null;
    if (!msg) return;
    const w = await prisma.winner.findMany({ where: { eventId: ev.id, status: 'VALID' }, orderBy: { place: 'asc' } });
    await msg.edit({
      embeds: [numberEmbed(ev, { reveal: ev.status !== 'ACTIVE', winners: w.map((x) => ({ place: x.place ?? 0, userId: x.userId, prize: x.prize })), note })],
    });
  } catch (e) {
    await logError('numberEvents.updateMessage', e);
  }
}

// ───────────────────────── expiry, hints, stop, reroll ─────────────────────────

export async function expireNumberEvents(): Promise<void> {
  const due = await prisma.event.findMany({ where: { type: 'NUMBER', status: 'ACTIVE', endsAt: { lte: new Date() } }, take: 20 });
  for (const ev of due) {
    const r = await prisma.event.updateMany({ where: { id: ev.id, status: 'ACTIVE' }, data: { status: 'ENDED', endedAt: new Date(), winnersDrawn: true } });
    if (r.count !== 1) continue;
    await reloadActiveNumberEvents();
    const settings = await getSettings(ev.guildId);
    const m = getMessage(settings.messages, 'numberExpired');
    const ch = await getTextChannel(ev.guildId, ev.channelId);
    const fresh = await prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
    if (ch && m.enabled) {
      const text = fresh.winnersFound > 0
        ? `⌛ Tiden er gået! Tallet var **${ev.secretNumber}**. ${fresh.winnersFound} af ${ev.winnerCount} vindere blev fundet.`
        : fill(m.text, { number: String(ev.secretNumber), prize: ev.prize, id: ev.code });
      await ch.send({ embeds: [new EmbedBuilder().setColor(COLORS.ENDED).setDescription(text).setFooter({ text: ev.code })], allowedMentions: { parse: [] } }).catch((e) => logError('numberEvents.expire', e, ev.guildId));
    }
    await updateNumberMessage(ev.code);
    await audit({ guildId: ev.guildId, action: 'NUMBER_ENDED', targetType: 'EVENT', targetId: ev.id, eventCode: ev.code, after: { winnersFound: fresh.winnersFound, number: ev.secretNumber }, reason: 'Tiden løb ud', source: 'system' });
  }
}

export async function sendDueHints(): Promise<void> {
  const rows = await prisma.event.findMany({ where: { type: 'NUMBER', status: 'ACTIVE' } });
  for (const ev of rows) {
    const cfg = normalizeNumberConfig(ev.config);
    if (cfg.hints.count <= ev.hintsSent || ev.secretNumber === null) continue;
    const elapsed = (Date.now() - ev.startsAt.getTime()) / 1000;
    const due = Math.min(cfg.hints.count, Math.floor(elapsed / cfg.hints.intervalSec));
    if (due <= ev.hintsSent) continue;
    const claim = await prisma.event.updateMany({ where: { id: ev.id, status: 'ACTIVE', hintsSent: ev.hintsSent }, data: { hintsSent: { increment: 1 } } });
    if (claim.count !== 1) continue;
    const span = cfg.max - cfg.min;
    const w = Math.min(span, Math.max(2, Math.floor(cfg.hints.range / 2 ** ev.hintsSent)));
    let lo = ev.secretNumber - crypto.randomInt(0, w + 1);
    lo = Math.max(cfg.min, Math.min(lo, cfg.max - w));
    const hi = lo + w;
    const ch = await getTextChannel(ev.guildId, ev.channelId);
    await ch
      ?.send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.PAUSED)
            .setTitle(`💡 HINT ${ev.hintsSent + 1}/${cfg.hints.count}`)
            .setDescription(`Tallet er mellem **${lo.toLocaleString('da-DK')}** og **${hi.toLocaleString('da-DK')}**.`)
            .setFooter({ text: ev.code }),
        ],
        allowedMentions: { parse: [] },
      })
      .catch((e) => logError('numberEvents.hint', e, ev.guildId));
  }
}

export async function stopNumberEvent(guildId: string, codeInput: string, actor: Actor, reason?: string): Promise<EventRow> {
  const ev = await requireEvent(guildId, codeInput, 'NUMBER');
  const now = new Date();
  const status = ev.winnersFound > 0 ? 'ENDED' : 'CANCELLED';
  const r = await prisma.event.updateMany({ where: { id: ev.id, status: 'ACTIVE' }, data: { status, endedAt: now, endsAt: now, winnersDrawn: true } });
  if (r.count !== 1) throw new UserError(`**${ev.code}** kører ikke.`);
  await reloadActiveNumberEvents();
  const ch = await getTextChannel(guildId, ev.channelId);
  await ch
    ?.send({ embeds: [new EmbedBuilder().setColor(COLORS.CANCELLED).setDescription(`🛑 Taleventet **${ev.prize}** blev stoppet af staff. Tallet var **${ev.secretNumber}**.`).setFooter({ text: ev.code })], allowedMentions: { parse: [] } })
    .catch(() => undefined);
  await updateNumberMessage(ev.code);
  await audit({ guildId, actorId: actor.id, action: 'NUMBER_STOPPED', targetType: 'EVENT', targetId: ev.id, eventCode: ev.code, before: { status: 'ACTIVE' }, after: { status }, reason: reason ?? null, source: actor.source });
  return prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
}

/** Disqualifies a winner and reopens the event so the next correct guess takes that place. */
export async function rerollNumberEvent(
  guildId: string,
  codeInput: string,
  actor: Actor,
  opts: { userId?: string | null; place?: number | null; durationSec?: number; reason?: string | null },
): Promise<EventRow> {
  const ev = await requireEvent(guildId, codeInput, 'NUMBER');
  if (ev.status === 'ACTIVE') throw new UserError('Det talevent kører stadig. Stop det først, eller vent til det er færdigt.');
  if (ev.status !== 'ENDED') throw new UserError('Kun afsluttede talevents med vindere kan reroll\'es.');
  const winners = await prisma.winner.findMany({ where: { eventId: ev.id, status: 'VALID' }, orderBy: { place: 'desc' } });
  const target = opts.userId ? winners.find((w) => w.userId === opts.userId) : opts.place ? winners.find((w) => w.place === opts.place) : winners[0];
  if (!target) throw new UserError('Jeg kunne ikke finde den vinder. Vælg en bruger eller plads der faktisk vandt dette event.');
  const duration = Math.max(30, Math.min(7 * 86400, opts.durationSec ?? 300));
  const reason = opts.reason?.slice(0, 300) || 'Afvist af staff (reroll)';
  await prisma.winner.update({ where: { id: target.id }, data: { status: 'REJECTED', place: null, rejectReason: reason } });
  const now = new Date();
  await prisma.event.update({
    where: { id: ev.id },
    data: { status: 'ACTIVE', endedAt: null, startsAt: now, endsAt: new Date(now.getTime() + duration * 1000), durationSec: duration, winnersFound: Math.max(0, ev.winnersFound - 1) },
  });
  await reloadActiveNumberEvents();
  const ch = await getTextChannel(guildId, ev.channelId);
  const fresh = await prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
  await ch
    ?.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2dd4bf)
          .setTitle('🔄 TALEVENT GENÅBNET')
          .setDescription(`En vinder blev diskvalificeret. Den første, der skriver det rigtige tal, vinder nu ${target.place ? placeLabel(target.place) : 'den ledige plads'} — **${prizeFor(fresh, target.place ?? 1)}**!\n⏱️ Tid: ${fmtDurationLong(duration)}\n\n<@${target.userId}> kan ikke vinde dette event igen.`)
          .setFooter({ text: ev.code }),
      ],
      allowedMentions: { parse: [] },
    })
    .catch(() => undefined);
  await updateNumberMessage(ev.code);
  await audit({ guildId, actorId: actor.id, action: 'WINNER_REJECTED', targetType: 'USER', targetId: target.userId, eventCode: ev.code, reason, source: actor.source });
  await audit({ guildId, actorId: actor.id, action: 'NUMBER_REROLLED', targetType: 'EVENT', targetId: ev.id, eventCode: ev.code, before: { status: 'ENDED', place: target.place }, after: { status: 'ACTIVE', genåbnetI: fmtDurationLong(duration) }, reason, source: actor.source });
  return fresh;
}

export function eventLink(ev: EventRow): string {
  return messageUrl(ev.guildId, ev.channelId, ev.messageId);
}
