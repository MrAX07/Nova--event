import { NextFunction, Request, Response, Router } from 'express';
import { ChannelType, Guild } from 'discord.js';
import { Prisma } from '@prisma/client';
import type { Event as EventRow, Guild as GuildSettings } from '@prisma/client';
import { prisma } from '../db';
import { env } from '../env';
import { logError } from '../logger';
import { Level, LEVEL_NAMES, LOG_CATEGORIES, TIMEZONES } from '../shared/constants';
import { MESSAGE_DEFAULTS, MessageKey, UserError } from '../shared/text';
import { isValidTimezone, parseDuration, parseLocalDateTime, snowflakeDate } from '../shared/time';
import { audit } from '../services/audit';
import { resolveUsers } from '../services/activity';
import { addBlacklist, listBlacklist, removeBlacklist } from '../services/blacklist';
import { getClient } from '../services/discord';
import { normalizeGiveawayConfig, normalizeNumberConfig } from '../services/embeds';
import { modifyEntries, normalizeCode, requireEvent } from '../services/entries';
import {
  cancelGiveaway,
  createGiveaway,
  deleteEvent,
  editGiveaway,
  endGiveaway,
  getStats,
  pauseGiveaway,
  rerollGiveaway,
  resumeGiveaway,
} from '../services/giveaways';
import { rerollNumberEvent, startNumberEvent, stopNumberEvent } from '../services/numberEvents';
import { getUserLevel } from '../services/permissions';
import { getSettings, readDefaults } from '../services/settings';
import { commitSettings } from '../services/settingsAdmin';
import { getGuildStats, getUserStats } from '../services/stats';
import { deleteTemplate, getTemplate, listTemplates, saveTemplate } from '../services/templates';
import { closeTicket } from '../services/tickets';
import type { Actor } from '../services/types';
import { streamCsv } from './csv';
import { getSession } from './session';

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface Ctx {
  guild: Guild;
  level: Level;
  settings: GuildSettings;
  user: { id: string; username: string };
  actor: Actor;
}

export const apiRouter = Router();

// ───────────── hjælpere ─────────────
const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isId = (v: unknown): v is string => typeof v === 'string' && /^\d{15,25}$/.test(v);
const int = (v: unknown, def: number, lo: number, hi: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : def;
};
const needConfirm = (b: any): void => {
  if (b?.confirm !== true) throw new HttpError(400, 'Handlingen skal bekræftes.');
};
const paging = (req: Request) => {
  const page = int(req.query.page, 1, 1, 100000);
  const size = int(req.query.pageSize, 25, 5, 100);
  return { page, size, skip: (page - 1) * size };
};
const ctxOf = (res: Response): Ctx => res.locals.ctx as Ctx;

function h(min: Level, fn: (req: Request, res: Response, c: Ctx) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const c = ctxOf(res);
      if (c.level < min) throw new HttpError(403, `Det kræver ${LEVEL_NAMES[min]} eller højere.`);
      const out = await fn(req, res, c);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
      next(e);
    }
  };
}

const avatarUrl = (id: string, hash: string | null): string | null => (hash ? `https://cdn.discordapp.com/avatars/${id}/${hash}.${hash.startsWith('a_') ? 'gif' : 'png'}?size=64` : null);

async function usersMap(ids: (string | null | undefined)[]) {
  const m = await resolveUsers(ids.filter((x): x is string => !!x));
  const out: Record<string, { username: string; avatar: string | null }> = {};
  for (const [id, u] of m) out[id] = { username: u.username, avatar: avatarUrl(id, u.avatar) };
  return out;
}

function evOut(ev: EventRow, stats?: { entries: number; participants: number }) {
  return {
    code: ev.code,
    type: ev.type,
    status: ev.status,
    prize: ev.prize,
    winnerCount: ev.winnerCount,
    channelId: ev.channelId,
    messageId: ev.messageId,
    hostId: ev.hostId,
    isTest: ev.isTest,
    startsAt: ev.startsAt,
    endsAt: ev.endsAt,
    endedAt: ev.endedAt,
    durationSec: ev.durationSec,
    remainingSec: ev.remainingSec,
    winnersFound: ev.winnersFound,
    createdAt: ev.createdAt,
    ...(stats ?? {}),
  };
}

function isTextChannel(guild: Guild, id: string): boolean {
  const c = guild.channels.cache.get(id);
  return !!c && (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement);
}
const roleExists = (guild: Guild, id: string): boolean => id !== guild.id && guild.roles.cache.has(id);

function fillDays(rows: { d: string; c: number }[], days: number) {
  const m = new Map(rows.map((r) => [r.d, r.c]));
  const out: { d: string; c: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    out.push({ d, c: m.get(d) ?? 0 });
  }
  return out;
}

// ───────────── auth + CSRF ─────────────
apiRouter.use(async (req, res, next) => {
  try {
    const s = await getSession(req);
    if (!s) return void res.status(401).json({ error: 'Du er ikke logget ind.' });
    res.locals.session = s;
    if (req.method !== 'GET') {
      if (req.get('x-nova-csrf') !== s.csrf) throw new HttpError(403, 'Ugyldig anmodning (CSRF). Genindlæs siden.');
      const origin = req.get('origin');
      if (origin && origin !== env.DASHBOARD_URL) throw new HttpError(403, 'Ugyldig oprindelse.');
    }
    next();
  } catch (e) {
    next(e);
  }
});

apiRouter.get('/me', async (req, res, next) => {
  try {
    const s = res.locals.session;
    const guilds: unknown[] = [];
    for (const g of getClient().guilds.cache.values()) {
      const level = await getUserLevel(g, s.userId);
      if (level < Level.MODERATOR) continue;
      const settings = await getSettings(g.id, g.name);
      if (!settings.dashboardEnabled && level < Level.OWNER) continue;
      guilds.push({ id: g.id, name: g.name, icon: g.iconURL({ size: 128 }), level, levelName: LEVEL_NAMES[level] });
    }
    res.json({ user: { id: s.userId, username: s.username, avatar: avatarUrl(s.userId, s.avatar) }, csrf: s.csrf, guilds });
  } catch (e) {
    next(e);
  }
});

// ───────────── server-kontekst ─────────────
const g = Router({ mergeParams: true });
apiRouter.use(
  '/g/:gid',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const gid = req.params.gid;
      const guild = isId(gid) ? getClient().guilds.cache.get(gid) : undefined;
      if (!guild) throw new HttpError(404, 'Ukendt server.');
      const s = res.locals.session;
      const level = await getUserLevel(guild, s.userId);
      const settings = await getSettings(guild.id, guild.name);
      if (level < Level.MODERATOR || (!settings.dashboardEnabled && level < Level.OWNER)) throw new HttpError(403, 'Du har ikke adgang til denne server.');
      res.locals.ctx = { guild, level, settings, user: { id: s.userId, username: s.username }, actor: { id: s.userId, level, source: 'dashboard' } } satisfies Ctx;
      next();
    } catch (e) {
      next(e);
    }
  },
  g,
);

// ───────────── meta & indstillinger ─────────────
g.get(
  '/meta',
  h(Level.MODERATOR, async (_req, _res, c) => {
    const channels = [...c.guild.channels.cache.values()].filter((x) => x.type === ChannelType.GuildText || x.type === ChannelType.GuildAnnouncement).sort((a, b) => ('position' in a && 'position' in b ? (a as any).position - (b as any).position : 0)).map((x) => ({ id: x.id, name: x.name }));
    const categories = [...c.guild.channels.cache.values()].filter((x) => x.type === ChannelType.GuildCategory).map((x) => ({ id: x.id, name: x.name }));
    const voice = [...c.guild.channels.cache.values()].filter((x) => x.type === ChannelType.GuildVoice || x.type === ChannelType.GuildStageVoice).map((x) => ({ id: x.id, name: x.name }));
    const roles = [...c.guild.roles.cache.values()].filter((r) => r.id !== c.guild.id).sort((a, b) => b.position - a.position).map((r) => ({ id: r.id, name: r.name, color: r.hexColor, managed: r.managed }));
    return {
      guild: { id: c.guild.id, name: c.guild.name, icon: c.guild.iconURL({ size: 128 }) },
      level: c.level,
      levelName: LEVEL_NAMES[c.level],
      channels,
      voice,
      categories,
      roles,
      settings: c.level >= Level.HIGH_ADMIN ? c.settings : null,
      defaults: readDefaults(c.settings),
      messageDefaults: MESSAGE_DEFAULTS,
      logCategories: LOG_CATEGORIES,
      timezones: TIMEZONES,
      timezone: c.settings.timezone,
      dashboardUrl: env.DASHBOARD_URL,
    };
  }),
);

g.put(
  '/settings',
  h(Level.HIGH_ADMIN, async (req, _res, c) => {
    const b = req.body ?? {};
    const patch: Prisma.GuildUpdateInput = {};
    if ('timezone' in b) {
      const z = str(b.timezone, 60);
      if (!isValidTimezone(z)) throw new HttpError(400, 'Ugyldig tidszone.');
      patch.timezone = z;
    }
    for (const k of ['giveawayChannelId', 'numberChannelId', 'logChannelId'] as const) {
      if (!(k in b)) continue;
      if (b[k] === null || b[k] === '') patch[k] = null;
      else if (isId(b[k]) && isTextChannel(c.guild, b[k])) patch[k] = b[k];
      else throw new HttpError(400, 'Ugyldig kanal.');
    }
    if ('logChannels' in b) {
      const out: Record<string, string> = {};
      for (const [cat, id] of Object.entries((b.logChannels ?? {}) as Record<string, unknown>)) {
        if (!(cat in LOG_CATEGORIES) || !id) continue;
        if (!isId(id) || !isTextChannel(c.guild, id)) throw new HttpError(400, `Ugyldig kanal til ${cat}.`);
        out[cat] = id;
      }
      patch.logChannels = out;
    }
    if ('disabledLogCategories' in b && Array.isArray(b.disabledLogCategories)) patch.disabledLogCategories = b.disabledLogCategories.filter((x: unknown): x is string => typeof x === 'string' && x in LOG_CATEGORIES);
    if ('ticketCategoryId' in b) {
      if (!b.ticketCategoryId) patch.ticketCategoryId = null;
      else if (isId(b.ticketCategoryId) && c.guild.channels.cache.get(b.ticketCategoryId)?.type === ChannelType.GuildCategory) patch.ticketCategoryId = b.ticketCategoryId;
      else throw new HttpError(400, 'Ugyldig ticket-kategori.');
    }
    for (const k of ['ticketSupportRoleIds', 'ticketPrizeRoleIds'] as const) {
      if (!(k in b)) continue;
      const list = Array.isArray(b[k]) ? [...new Set<string>(b[k].filter(isId))] : [];
      if (list.length > 10 || list.some((r) => !roleExists(c.guild, r))) throw new HttpError(400, 'Ugyldige ticket-roller.');
      patch[k] = list;
    }
    for (const k of ['logRoleChanges', 'testMode', 'dashboardEnabled'] as const) if (k in b) patch[k] = b[k] === true;
    if ('winnerRoleId' in b) {
      if (!b.winnerRoleId) patch.winnerRoleId = null;
      else if (isId(b.winnerRoleId) && roleExists(c.guild, b.winnerRoleId)) patch.winnerRoleId = b.winnerRoleId;
      else throw new HttpError(400, 'Ugyldig rolle.');
    }
    if ('defaults' in b) {
      const d = b.defaults ?? {};
      patch.defaults = {
        durationSec: int(d.durationSec, 3600, 10, 90 * 86400),
        winnerCount: int(d.winnerCount, 1, 1, 50),
        entriesPerClick: int(d.entriesPerClick, 1, 1, 1000),
        maxEntries: int(d.maxEntries, 0, 0, 1_000_000),
        bonusMode: d.bonusMode === 'stack' ? 'stack' : 'highest',
      };
    }
    if ('messages' in b) {
      const out: Record<string, { enabled: boolean; text?: string }> = {};
      for (const k of Object.keys(MESSAGE_DEFAULTS) as MessageKey[]) {
        const m = (b.messages ?? {})[k];
        if (!m) continue;
        const text = str(m.text, 1500);
        out[k] = { enabled: m.enabled !== false, ...(text && text !== MESSAGE_DEFAULTS[k].text ? { text } : {}) };
      }
      patch.messages = out;
    }
    if ('endingSoonSeconds' in b && Array.isArray(b.endingSoonSeconds)) {
      patch.endingSoonSeconds = [...new Set<number>(b.endingSoonSeconds.map((n: unknown) => int(n, 0, 0, 86400)).filter((n: number) => n >= 5))].sort((x, y) => y - x).slice(0, 6);
    }
    const s = await commitSettings(c.guild.id, patch, c.actor);
    return { settings: s };
  }),
);

g.put(
  '/permissions',
  h(Level.OWNER, async (req, _res, c) => {
    needConfirm(req.body);
    const patch: Record<string, string[]> = {};
    for (const k of ['ownerRoleIds', 'highAdminRoleIds', 'eventManagerRoleIds', 'moderatorRoleIds']) {
      if (!(k in req.body)) continue;
      const list = Array.isArray(req.body[k]) ? [...new Set<string>(req.body[k].filter(isId))] : [];
      if (list.length > 10) throw new HttpError(400, 'Højst 10 roller pr. niveau.');
      if (list.some((r) => !roleExists(c.guild, r))) throw new HttpError(400, 'En af rollerne findes ikke.');
      patch[k] = list;
    }
    const s = await commitSettings(c.guild.id, patch, c.actor);
    return { settings: s };
  }),
);

// ───────────── overblik & statistik ─────────────
g.get(
  '/overview',
  h(Level.MODERATOR, async (_req, _res, c) => {
    const gid = c.guild.id;
    const [stats, evSeries, entrySeries, recent] = await Promise.all([
      getGuildStats(gid),
      prisma.$queryRaw<{ d: string; c: number }[]>`SELECT to_char("createdAt",'YYYY-MM-DD') AS d, count(*)::int AS c FROM "Event" WHERE "guildId" = ${gid} AND "isTest" = false AND "createdAt" > (now() at time zone 'utc') - ${14}::int * interval '1 day' GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw<{ d: string; c: number }[]>`SELECT to_char("createdAt",'YYYY-MM-DD') AS d, COALESCE(sum("delta"),0)::int AS c FROM "EntryTransaction" WHERE "guildId" = ${gid} AND "isTest" = false AND "type" = 'JOIN' AND "createdAt" > (now() at time zone 'utc') - ${14}::int * interval '1 day' GROUP BY 1 ORDER BY 1`,
      prisma.auditLog.findMany({
        where: { guildId: gid, ...(c.level >= Level.HIGH_ADMIN ? { category: { not: 'JOIN' } } : { category: { in: ['GIVEAWAY', 'WINNER', 'NUMBER'] } }) },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
    ]);
    const users = await usersMap(recent.flatMap((r) => [r.actorId, r.targetType === 'USER' ? r.targetId : null]));
    return {
      totals: { ...stats, mostActive: undefined, mostWins: undefined, mostPopular: undefined },
      eventsPerDay: fillDays(evSeries, 14),
      entriesPerDay: fillDays(entrySeries, 14),
      recent: recent.map((r) => ({ id: r.id, action: r.action, category: r.category, actorId: r.actorId, targetType: r.targetType, targetId: r.targetId, eventCode: r.eventCode, createdAt: r.createdAt })),
      users,
    };
  }),
);

g.get(
  '/stats',
  h(Level.MODERATOR, async (_req, _res, c) => {
    const gid = c.guild.id;
    const stats = await getGuildStats(gid);
    const [evSeries, entrySeries, winSeries, last] = await Promise.all([
      prisma.$queryRaw<{ d: string; c: number }[]>`SELECT to_char("createdAt",'YYYY-MM-DD') AS d, count(*)::int AS c FROM "Event" WHERE "guildId" = ${gid} AND "isTest" = false AND "createdAt" > (now() at time zone 'utc') - ${30}::int * interval '1 day' GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw<{ d: string; c: number }[]>`SELECT to_char("createdAt",'YYYY-MM-DD') AS d, COALESCE(sum("delta"),0)::int AS c FROM "EntryTransaction" WHERE "guildId" = ${gid} AND "isTest" = false AND "type" = 'JOIN' AND "createdAt" > (now() at time zone 'utc') - ${30}::int * interval '1 day' GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw<{ d: string; c: number }[]>`SELECT to_char("createdAt",'YYYY-MM-DD') AS d, count(*)::int AS c FROM "Winner" WHERE "guildId" = ${gid} AND "isTest" = false AND "status" = 'VALID' AND "createdAt" > (now() at time zone 'utc') - ${30}::int * interval '1 day' GROUP BY 1 ORDER BY 1`,
      prisma.event.findMany({ where: { guildId: gid, type: 'GIVEAWAY', isTest: false }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, code: true, prize: true } }),
    ]);
    const parts = await prisma.entry.groupBy({ by: ['eventId'], where: { eventId: { in: last.map((l) => l.id) }, amount: { gt: 0 } }, _count: { _all: true } });
    const pm = new Map(parts.map((p) => [p.eventId, p._count._all]));
    const users = await usersMap([...stats.mostActive.map((x) => x.userId), ...stats.mostWins.map((x) => x.userId)]);
    return {
      stats,
      eventsPerDay: fillDays(evSeries, 30),
      entriesPerDay: fillDays(entrySeries, 30),
      winnersPerDay: fillDays(winSeries, 30),
      participantsPerGiveaway: last.reverse().map((l) => ({ code: l.code, prize: l.prize, participants: pm.get(l.id) ?? 0 })),
      users,
    };
  }),
);

// ───────────── events ─────────────
g.get(
  '/events',
  h(Level.MODERATOR, async (req, _res, c) => {
    const { page, size, skip } = paging(req);
    const q = str(req.query.q, 100);
    const where: Prisma.EventWhereInput = { guildId: c.guild.id };
    if (req.query.type === 'GIVEAWAY' || req.query.type === 'NUMBER') where.type = req.query.type;
    if (['ACTIVE', 'PAUSED', 'SCHEDULED', 'ENDED', 'CANCELLED'].includes(String(req.query.status))) where.status = req.query.status as any;
    if (q) where.OR = [{ code: { contains: q.toUpperCase() } }, { prize: { contains: q, mode: 'insensitive' } }, ...(isId(q) ? [{ hostId: q }] : [])];
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    if ((from && !isNaN(+from)) || (to && !isNaN(+to))) where.createdAt = { ...(from && !isNaN(+from) ? { gte: from } : {}), ...(to && !isNaN(+to) ? { lte: new Date(+to + 86400_000 - 1) } : {}) };
    const [items, total] = await Promise.all([prisma.event.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: size }), prisma.event.count({ where })]);
    const agg = await prisma.entry.groupBy({ by: ['eventId'], where: { eventId: { in: items.map((i) => i.id) }, amount: { gt: 0 } }, _count: { _all: true }, _sum: { amount: true } });
    const am = new Map(agg.map((a) => [a.eventId, a]));
    const users = await usersMap(items.map((i) => i.hostId));
    return { items: items.map((e) => evOut(e, { participants: am.get(e.id)?._count._all ?? 0, entries: am.get(e.id)?._sum.amount ?? 0 })), total, page, pageSize: size, users };
  }),
);

g.get(
  '/events/:code',
  h(Level.MODERATOR, async (req, _res, c) => {
    const ev = await requireEvent(c.guild.id, req.params.code);
    const [stats, winners] = await Promise.all([getStats(ev.id), prisma.winner.findMany({ where: { eventId: ev.id }, orderBy: [{ status: 'asc' }, { place: 'asc' }, { createdAt: 'asc' }] })]);
    const users = await usersMap([ev.hostId, ...winners.map((w) => w.userId)]);
    return {
      event: {
        ...evOut(ev, stats),
        config: ev.type === 'GIVEAWAY' ? normalizeGiveawayConfig(ev.config) : normalizeNumberConfig(ev.config),
        secretNumber: c.level >= Level.HIGH_ADMIN && (ev.status === 'ACTIVE' || ev.status === 'ENDED' || ev.status === 'CANCELLED') ? ev.secretNumber : ev.status === 'ENDED' ? ev.secretNumber : null,
      },
      winners: winners.map((w) => ({ userId: w.userId, place: w.place, prize: w.prize, status: w.status, rejectReason: w.rejectReason, rerolled: w.rerolled, createdAt: w.createdAt })),
      users,
    };
  }),
);

g.get(
  '/events/:code/entries',
  h(Level.MODERATOR, async (req, _res, c) => {
    const ev = await requireEvent(c.guild.id, req.params.code, 'GIVEAWAY');
    const { page, size, skip } = paging(req);
    const q = str(req.query.q, 100);
    const where: Prisma.EntryWhereInput = { eventId: ev.id, amount: { gt: 0 } };
    if (q) {
      const profiles = await prisma.userProfile.findMany({ where: { username: { contains: q, mode: 'insensitive' } }, select: { id: true }, take: 200 });
      where.userId = { in: [...profiles.map((p) => p.id), ...(isId(q) ? [q] : [])] };
    }
    const [items, total] = await Promise.all([prisma.entry.findMany({ where, orderBy: [{ amount: 'desc' }, { createdAt: 'asc' }], skip, take: size }), prisma.entry.count({ where })]);
    const users = await usersMap(items.map((i) => i.userId));
    return { items: items.map((i) => ({ userId: i.userId, amount: i.amount, createdAt: i.createdAt })), total, page, pageSize: size, users };
  }),
);

// ───────────── giveaways ─────────────
g.post(
  '/giveaways',
  h(Level.EVENT_MANAGER, async (req, _res, c) => {
    const b = req.body ?? {};
    let base: { prize?: string; durationSec?: number; winnerCount?: number; config: Record<string, any> } = { config: {} };
    if (str(b.template, 40)) base = (await getTemplate(c.guild.id, str(b.template, 40))).data as any;
    const prize = str(b.prize, 250) || base.prize || '';
    if (!prize) throw new HttpError(400, 'Du skal angive en præmie.');
    let durationSec = base.durationSec ?? readDefaults(c.settings).durationSec;
    if (b.duration) {
      const d = parseDuration(str(b.duration, 20));
      if (!d) throw new HttpError(400, 'Ugyldig varighed. Brug fx 30m, 2t eller 1d.');
      durationSec = d;
    } else if (b.durationSec) durationSec = int(b.durationSec, durationSec, 1, 90 * 86400);
    const channelId = isId(b.channelId) ? b.channelId : c.settings.giveawayChannelId;
    if (!channelId) throw new HttpError(400, 'Vælg en kanal (eller sæt en giveaway-kanal i indstillinger).');
    let startsAt: Date | null = null;
    if (str(b.startsAtLocal, 30)) {
      startsAt = parseLocalDateTime(str(b.startsAtLocal, 30).replace('T', ' '), c.settings.timezone);
      if (!startsAt) throw new HttpError(400, 'Ugyldig starttid.');
    }
    const cfg = { ...(base.config ?? {}), ...(typeof b.config === 'object' && b.config ? b.config : {}) };
    cfg.embed = { ...(base.config?.embed ?? {}), ...(b.config?.embed ?? {}) };
    const ev = await createGiveaway({
      guildId: c.guild.id,
      actor: c.actor,
      channelId,
      prize,
      durationSec,
      winnerCount: int(b.winnerCount, base.winnerCount ?? readDefaults(c.settings).winnerCount, 1, 50),
      startsAt,
      config: cfg,
      test: b.test === true,
    });
    return { event: evOut(ev) };
  }),
);

g.patch(
  '/giveaways/:code',
  h(Level.HIGH_ADMIN, async (req, _res, c) => {
    const b = req.body ?? {};
    let endsInSec: number | undefined;
    if (b.endsIn) {
      const d = parseDuration(str(b.endsIn, 20));
      if (!d) throw new HttpError(400, 'Ugyldig varighed. Brug fx 30m, 2t eller 1d.');
      endsInSec = d;
    }
    const ev = await editGiveaway(c.guild.id, req.params.code, { prize: b.prize ? str(b.prize, 250) : undefined, winnerCount: b.winnerCount ? int(b.winnerCount, 1, 1, 50) : undefined, endsInSec, config: typeof b.config === 'object' && b.config ? b.config : undefined }, c.actor);
    return { event: evOut(ev) };
  }),
);

g.post(
  '/giveaways/:code/:action',
  h(Level.EVENT_MANAGER, async (req, _res, c) => {
    const { code, action } = req.params;
    const b = req.body ?? {};
    switch (action) {
      case 'end': {
        needConfirm(b);
        const w = await endGiveaway(c.guild.id, code, c.actor, 'Afsluttet via kontrolpanel');
        return { winners: w };
      }
      case 'cancel':
        needConfirm(b);
        return { event: evOut(await cancelGiveaway(c.guild.id, code, c.actor, str(b.reason, 300) || undefined)) };
      case 'pause':
        return { event: evOut(await pauseGiveaway(c.guild.id, code, c.actor)) };
      case 'resume':
        return { event: evOut(await resumeGiveaway(c.guild.id, code, c.actor)) };
      case 'reroll': {
        if (c.level < Level.HIGH_ADMIN) throw new HttpError(403, 'Reroll kræver Højadmin eller højere.');
        needConfirm(b);
        const w = await rerollGiveaway(c.guild.id, code, c.actor, { count: int(b.count, 1, 1, 50), allowRejected: b.allowRejected === true, replaceUserId: isId(b.replaceUserId) ? b.replaceUserId : null });
        return { winners: w };
      }
      default:
        throw new HttpError(404, 'Ukendt handling.');
    }
  }),
);

g.delete(
  '/events/:code',
  h(Level.HIGH_ADMIN, async (req, _res, c) => {
    needConfirm(req.body);
    await deleteEvent(c.guild.id, req.params.code, c.actor);
    return { ok: true };
  }),
);

// ───────────── talevents ─────────────
g.post(
  '/numberevents',
  h(Level.EVENT_MANAGER, async (req, _res, c) => {
    const b = req.body ?? {};
    const dur = b.duration ? parseDuration(str(b.duration, 20)) : 600;
    if (!dur) throw new HttpError(400, 'Ugyldig varighed. Brug fx 10m eller 1t.');
    const hi = b.hintInterval ? parseDuration(str(b.hintInterval, 20)) : null;
    if (b.hintInterval && !hi) throw new HttpError(400, 'Ugyldig hint-interval.');
    const channelId = isId(b.channelId) ? b.channelId : c.settings.numberChannelId;
    if (!channelId) throw new HttpError(400, 'Vælg en kanal (eller sæt en talevent-kanal i indstillinger).');
    const hasNumber = b.number !== undefined && b.number !== null && b.number !== '';
    const ev = await startNumberEvent({
      guildId: c.guild.id,
      actor: c.actor,
      channelId,
      prize: str(b.prize, 250),
      min: int(b.min, 1, -1_000_000_000, 1_000_000_000),
      max: int(b.max, 10000, -1_000_000_000, 1_000_000_000),
      number: hasNumber ? Number(b.number) : null,
      durationSec: dur,
      winnerCount: int(b.winnerCount, 1, 1, 10),
      prizes: typeof b.prizes === 'string' ? b.prizes.split('|') : Array.isArray(b.prizes) ? b.prizes.map(String) : [],
      hintCount: int(b.hintCount, 0, 0, 10),
      hintIntervalSec: hi,
      hintRange: b.hintRange ? int(b.hintRange, 1000, 2, 2_000_000_000) : null,
      higherLower: b.higherLower === true,
      showRange: b.showRange !== false,
      test: b.test === true,
    });
    return { event: evOut(ev) };
  }),
);

g.post(
  '/numberevents/:code/:action',
  h(Level.EVENT_MANAGER, async (req, _res, c) => {
    const b = req.body ?? {};
    needConfirm(b);
    if (req.params.action === 'stop') return { event: evOut(await stopNumberEvent(c.guild.id, req.params.code, c.actor, str(b.reason, 300) || undefined)) };
    if (req.params.action === 'reroll') {
      if (c.level < Level.HIGH_ADMIN) throw new HttpError(403, 'Reroll kræver Højadmin eller højere.');
      const d = b.duration ? parseDuration(str(b.duration, 20)) : 300;
      if (!d) throw new HttpError(400, 'Ugyldig varighed.');
      return { event: evOut(await rerollNumberEvent(c.guild.id, req.params.code, c.actor, { userId: isId(b.userId) ? b.userId : null, place: b.place ? int(b.place, 1, 1, 10) : null, durationSec: d, reason: str(b.reason, 300) || null })) };
    }
    throw new HttpError(404, 'Ukendt handling.');
  }),
);

// ───────────── entries ─────────────
g.post(
  '/entries',
  h(Level.HIGH_ADMIN, async (req, _res, c) => {
    const b = req.body ?? {};
    if (!['add', 'remove', 'set'].includes(b.mode)) throw new HttpError(400, 'Ugyldig handling.');
    if (b.mode !== 'add') needConfirm(b);
    if (!isId(b.userId)) throw new HttpError(400, 'Ugyldigt bruger-ID.');
    const r = await modifyEntries({ guildId: c.guild.id, code: str(b.code, 30), userId: b.userId, mode: b.mode, amount: Number(b.amount), reason: str(b.reason, 300) || null, actor: c.actor });
    return { before: r.before, after: r.after, delta: r.delta };
  }),
);

// ───────────── brugere & blacklist ─────────────
g.get(
  '/users',
  h(Level.HIGH_ADMIN, async (req, _res, c) => {
    const q = str(req.query.q, 64);
    const { page, size, skip } = paging(req);
    let ids: string[] = [];
    let total = 0;
    if (!q) {
      const rows = await prisma.entry.groupBy({ by: ['userId'], where: { guildId: c.guild.id, isTest: false }, _sum: { amount: true }, orderBy: { _sum: { amount: 'desc' } }, skip, take: size });
      ids = rows.map((r) => r.userId);
      total = (await prisma.entry.groupBy({ by: ['userId'], where: { guildId: c.guild.id, isTest: false } })).length;
    } else if (isId(q)) {
      ids = [q];
      total = 1;
    } else {
      const found = await c.guild.members.search({ query: q, limit: 25 });
      ids = [...found.keys()];
      total = ids.length;
    }
    const [ent, win, bl] = await Promise.all([
      prisma.entry.groupBy({ by: ['userId'], where: { guildId: c.guild.id, userId: { in: ids }, isTest: false, amount: { gt: 0 } }, _sum: { amount: true }, _count: { _all: true } }),
      prisma.winner.groupBy({ by: ['userId', 'eventType'], where: { guildId: c.guild.id, userId: { in: ids }, isTest: false, status: 'VALID' }, _count: { _all: true } }),
      prisma.blacklist.findMany({ where: { guildId: c.guild.id, userId: { in: ids } }, select: { userId: true } }),
    ]);
    const users = await usersMap(ids);
    return {
      items: ids.map((id) => ({
        userId: id,
        entries: ent.find((e) => e.userId === id)?._sum.amount ?? 0,
        giveaways: ent.find((e) => e.userId === id)?._count._all ?? 0,
        wins: win.filter((w) => w.userId === id && w.eventType === 'GIVEAWAY').reduce((a, w) => a + w._count._all, 0),
        numberWins: win.filter((w) => w.userId === id && w.eventType === 'NUMBER').reduce((a, w) => a + w._count._all, 0),
        blacklisted: bl.some((x) => x.userId === id),
      })),
      total,
      page,
      pageSize: size,
      users,
    };
  }),
);

g.get(
  '/users/:uid',
  h(Level.HIGH_ADMIN, async (req, _res, c) => {
    const uid = req.params.uid;
    if (!isId(uid)) throw new HttpError(400, 'Ugyldigt bruger-ID.');
    const member = await c.guild.members.fetch(uid).catch(() => null);
    const [stats, blacklist, tx, users] = await Promise.all([
      getUserStats(c.guild.id, uid),
      listBlacklist(c.guild.id, uid),
      prisma.entryTransaction.findMany({ where: { guildId: c.guild.id, userId: uid }, orderBy: { createdAt: 'desc' }, take: 25 }),
      usersMap([uid]),
    ]);
    const adminIds = tx.map((t) => t.actorId);
    const admins = await usersMap(adminIds);
    return {
      user: { id: uid, username: users[uid]?.username ?? member?.user.username ?? uid, avatar: users[uid]?.avatar ?? member?.user.displayAvatarURL({ size: 64 }) ?? null },
      inGuild: !!member,
      roles: member ? [...member.roles.cache.values()].filter((r) => r.id !== c.guild.id).sort((a, b) => b.position - a.position).map((r) => ({ id: r.id, name: r.name, color: r.hexColor })) : [],
      joinedAt: member?.joinedAt ?? null,
      createdAt: snowflakeDate(uid),
      stats,
      blacklist: blacklist.map((b) => ({ eventCode: b.eventCode, reason: b.reason, addedBy: b.addedBy, createdAt: b.createdAt })),
      transactions: tx.map((t) => ({ eventCode: t.eventCode, type: t.type, delta: t.delta, before: t.before, after: t.after, actorId: t.actorId, reason: t.reason, createdAt: t.createdAt })),
      admins,
    };
  }),
);

g.get(
  '/blacklist',
  h(Level.HIGH_ADMIN, async (req, _res, c) => {
    const { page, size, skip } = paging(req);
    const [items, total] = await Promise.all([prisma.blacklist.findMany({ where: { guildId: c.guild.id }, orderBy: { createdAt: 'desc' }, skip, take: size }), prisma.blacklist.count({ where: { guildId: c.guild.id } })]);
    return { items, total, page, pageSize: size, users: await usersMap(items.flatMap((i) => [i.userId, i.addedBy])) };
  }),
);

g.post(
  '/blacklist',
  h(Level.HIGH_ADMIN, async (req, _res, c) => {
    const b = req.body ?? {};
    needConfirm(b);
    if (!isId(b.userId)) throw new HttpError(400, 'Ugyldigt bruger-ID.');
    await addBlacklist({ guildId: c.guild.id, userId: b.userId, eventCode: b.eventCode ? normalizeCode(String(b.eventCode)) : null, reason: str(b.reason, 300) || null, actor: c.actor });
    return { ok: true };
  }),
);

g.post(
  '/blacklist/remove',
  h(Level.HIGH_ADMIN, async (req, _res, c) => {
    const b = req.body ?? {};
    needConfirm(b);
    if (!isId(b.userId)) throw new HttpError(400, 'Ugyldigt bruger-ID.');
    await removeBlacklist({ guildId: c.guild.id, userId: b.userId, eventCode: b.eventCode ? normalizeCode(String(b.eventCode)) : null, actor: c.actor });
    return { ok: true };
  }),
);

// ───────────── vindere, logs, fejl ─────────────
g.get(
  '/winners',
  h(Level.MODERATOR, async (req, _res, c) => {
    const { page, size, skip } = paging(req);
    const q = str(req.query.q, 100);
    const where: Prisma.WinnerWhereInput = { guildId: c.guild.id };
    if (req.query.type === 'GIVEAWAY' || req.query.type === 'NUMBER') where.eventType = req.query.type;
    if (req.query.status === 'VALID' || req.query.status === 'REJECTED') where.status = req.query.status;
    if (q) {
      const profiles = await prisma.userProfile.findMany({ where: { username: { contains: q, mode: 'insensitive' } }, select: { id: true }, take: 100 });
      where.OR = [{ userId: { in: [...profiles.map((p) => p.id), ...(isId(q) ? [q] : [])] } }, { event: { code: { contains: q.toUpperCase() } } }, { event: { prize: { contains: q, mode: 'insensitive' } } }];
    }
    const [items, total] = await Promise.all([prisma.winner.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: size, include: { event: { select: { code: true, prize: true } } } }), prisma.winner.count({ where })]);
    return {
      items: items.map((w) => ({ id: w.id, userId: w.userId, place: w.place, prize: w.prize ?? w.event.prize, status: w.status, rejectReason: w.rejectReason, rerolled: w.rerolled, eventType: w.eventType, eventCode: w.event.code, isTest: w.isTest, createdAt: w.createdAt })),
      total,
      page,
      pageSize: size,
      users: await usersMap(items.map((i) => i.userId)),
    };
  }),
);

g.get(
  '/logs',
  h(Level.HIGH_ADMIN, async (req, _res, c) => {
    const { page, size, skip } = paging(req);
    const q = str(req.query.q, 100);
    const where: Prisma.AuditLogWhereInput = { guildId: c.guild.id };
    const cat = str(req.query.category, 20);
    if (cat && cat in LOG_CATEGORIES) where.category = cat;
    else where.category = { not: 'JOIN' };
    if (q) {
      const profiles = await prisma.userProfile.findMany({ where: { username: { contains: q, mode: 'insensitive' } }, select: { id: true }, take: 100 });
      const ids = [...profiles.map((p) => p.id), ...(isId(q) ? [q] : [])];
      where.OR = [{ eventCode: { contains: q.toUpperCase() } }, { action: { contains: q.toUpperCase().replace(/\s+/g, '_') } }, { reason: { contains: q, mode: 'insensitive' } }, ...(ids.length ? [{ actorId: { in: ids } }, { targetId: { in: ids } }] : [])];
    }
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    if ((from && !isNaN(+from)) || (to && !isNaN(+to))) where.createdAt = { ...(from && !isNaN(+from) ? { gte: from } : {}), ...(to && !isNaN(+to) ? { lte: new Date(+to + 86400_000 - 1) } : {}) };
    const [items, total] = await Promise.all([prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: size }), prisma.auditLog.count({ where })]);
    return { items, total, page, pageSize: size, users: await usersMap(items.flatMap((i) => [i.actorId, i.targetType === 'USER' ? i.targetId : null])) };
  }),
);

g.get(
  '/errors',
  h(Level.HIGH_ADMIN, async (req, _res, c) => {
    const { page, size, skip } = paging(req);
    const where = { OR: [{ guildId: c.guild.id }, { guildId: null }] };
    const [items, total] = await Promise.all([prisma.errorLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: size, select: { id: true, scope: true, message: true, createdAt: true } }), prisma.errorLog.count({ where })]);
    return { items, total, page, pageSize: size };
  }),
);

// ───────────── tickets ─────────────
g.get(
  '/tickets',
  h(Level.MODERATOR, async (req, _res, c) => {
    const { page, size, skip } = paging(req);
    const q = str(req.query.q, 100);
    const where: Prisma.TicketWhereInput = { guildId: c.guild.id };
    if (req.query.status === 'OPEN' || req.query.status === 'CLOSED') where.status = req.query.status;
    if (req.query.type === 'SUPPORT' || req.query.type === 'PRIZE') where.type = req.query.type;
    if (q) {
      const profiles = await prisma.userProfile.findMany({ where: { username: { contains: q, mode: 'insensitive' } }, select: { id: true }, take: 100 });
      const ids = [...profiles.map((p) => p.id), ...(isId(q) ? [q] : [])];
      where.OR = [{ subject: { contains: q, mode: 'insensitive' } }, { eventCode: { contains: q.toUpperCase() } }, ...(ids.length ? [{ userId: { in: ids } }] : []), ...(/^#?\d+$/.test(q) ? [{ number: Number(q.replace('#', '')) }] : [])];
    }
    const [items, total] = await Promise.all([prisma.ticket.findMany({ where, orderBy: { number: 'desc' }, skip, take: size, select: { id: true, number: true, type: true, status: true, channelId: true, userId: true, subject: true, eventCode: true, prize: true, verified: true, claimedBy: true, createdAt: true, closedAt: true } }), prisma.ticket.count({ where })]);
    return { items, total, page, pageSize: size, users: await usersMap(items.flatMap((t) => [t.userId, t.claimedBy])) };
  }),
);

g.get(
  '/tickets/:id',
  h(Level.MODERATOR, async (req, _res, c) => {
    const t = await prisma.ticket.findFirst({ where: { id: req.params.id, guildId: c.guild.id } });
    if (!t) throw new HttpError(404, 'Ticketten findes ikke.');
    return { ticket: t, users: await usersMap([t.userId, t.claimedBy, t.closedBy]) };
  }),
);

g.post(
  '/tickets/:id/close',
  h(Level.MODERATOR, async (req, _res, c) => {
    needConfirm(req.body);
    const t = await prisma.ticket.findFirst({ where: { id: req.params.id, guildId: c.guild.id } });
    if (!t) throw new HttpError(404, 'Ticketten findes ikke.');
    if (t.type === 'PRIZE' && c.level < Level.EVENT_MANAGER) throw new HttpError(403, 'Præmie-tickets kan kun lukkes af Eventansvarlig eller højere.');
    await closeTicket(c.guild.id, t, c.user.id, str(req.body?.reason, 300) || null, 'dashboard');
    return { ok: true };
  }),
);

// ───────────── skabeloner ─────────────
g.get('/templates', h(Level.EVENT_MANAGER, async (_req, _res, c) => ({ items: (await listTemplates(c.guild.id)).map((t) => ({ name: t.name, data: t.data, createdBy: t.createdBy, updatedAt: t.updatedAt })) })));

g.post(
  '/templates',
  h(Level.HIGH_ADMIN, async (req, _res, c) => {
    const b = req.body ?? {};
    let durationSec: number | undefined;
    if (b.duration) {
      const d = parseDuration(str(b.duration, 20));
      if (!d) throw new HttpError(400, 'Ugyldig varighed. Brug fx 30m, 2t eller 1d.');
      durationSec = d;
    }
    await saveTemplate(c.guild.id, str(b.name, 32), { prize: str(b.prize, 250) || undefined, durationSec, winnerCount: b.winnerCount ? int(b.winnerCount, 1, 1, 50) : undefined, config: typeof b.config === 'object' && b.config ? b.config : {} }, c.actor);
    return { ok: true };
  }),
);

g.delete(
  '/templates/:name',
  h(Level.HIGH_ADMIN, async (req, _res, c) => {
    needConfirm(req.body);
    await deleteTemplate(c.guild.id, req.params.name, c.actor);
    return { ok: true };
  }),
);

// ───────────── CSV-eksport ─────────────
g.get(
  '/export/:kind',
  async (req, res, next) => {
    try {
      const c = ctxOf(res);
      if (c.level < Level.HIGH_ADMIN) throw new HttpError(403, 'Eksport kræver Højadmin eller højere.');
      const kind = req.params.kind;
      const gid = c.guild.id;
      const code = str(req.query.code, 30) ? normalizeCode(str(req.query.code, 30)) : null;
      const ev = code ? await requireEvent(gid, code) : null;
      const stamp = new Date().toISOString().slice(0, 10);
      const batches = async function* <T extends { id: string }>(fetch: (cursor: string | undefined) => Promise<T[]>, map: (t: T) => unknown[]) {
        let cursor: string | undefined;
        for (;;) {
          const rows = await fetch(cursor);
          if (!rows.length) return;
          const users = 'userId' in rows[0] ? await usersMap(rows.map((r) => (r as any).userId)) : {};
          yield rows.map((r) => map({ ...r, __u: users } as any));
          cursor = rows[rows.length - 1].id;
          if (rows.length < 2000) return;
        }
      };
      const page = { take: 2000, orderBy: { id: 'asc' as const } };
      const cur = (cursor?: string) => (cursor ? { cursor: { id: cursor }, skip: 1 } : {});
      const uname = (r: any, id: string) => r.__u?.[id]?.username ?? '';
      if (kind === 'participants') {
        if (!ev) throw new HttpError(400, 'Vælg et giveaway (code) til deltager-eksport.');
        await audit({ guildId: gid, actorId: c.actor.id, action: 'EXPORT_CREATED', targetType: 'EXPORT', targetId: 'participants', eventCode: ev.code, source: 'dashboard' });
        return await streamCsv(res, `deltagere-${ev.code}-${stamp}.csv`, ['Event', 'Bruger-ID', 'Brugernavn', 'Entries', 'Tilmeldt'], batches((cursor) => prisma.entry.findMany({ where: { eventId: ev.id }, ...page, ...cur(cursor) }), (r: any) => [ev.code, r.userId, uname(r, r.userId), r.amount, r.createdAt]));
      }
      if (kind === 'entries') {
        await audit({ guildId: gid, actorId: c.actor.id, action: 'EXPORT_CREATED', targetType: 'EXPORT', targetId: 'entries', eventCode: ev?.code ?? null, source: 'dashboard' });
        return await streamCsv(res, `entries-${stamp}.csv`, ['Tidspunkt', 'Event', 'Bruger-ID', 'Brugernavn', 'Type', 'Ændring', 'Før', 'Efter', 'Admin-ID', 'Årsag'], batches((cursor) => prisma.entryTransaction.findMany({ where: { guildId: gid, ...(ev ? { eventId: ev.id } : {}) }, ...page, ...cur(cursor) }), (r: any) => [r.createdAt, r.eventCode, r.userId, uname(r, r.userId), r.type, r.delta, r.before, r.after, r.actorId, r.reason]));
      }
      if (kind === 'winners') {
        await audit({ guildId: gid, actorId: c.actor.id, action: 'EXPORT_CREATED', targetType: 'EXPORT', targetId: 'winners', eventCode: ev?.code ?? null, source: 'dashboard' });
        return await streamCsv(res, `vindere-${stamp}.csv`, ['Tidspunkt', 'Event-ID', 'Type', 'Plads', 'Bruger-ID', 'Brugernavn', 'Præmie', 'Status', 'Årsag til afvisning', 'Test'], batches((cursor) => prisma.winner.findMany({ where: { guildId: gid, ...(ev ? { eventId: ev.id } : {}) }, include: { event: { select: { code: true } } }, ...page, ...cur(cursor) }), (r: any) => [r.createdAt, r.event.code, r.eventType, r.place, r.userId, uname(r, r.userId), r.prize, r.status, r.rejectReason, r.isTest]));
      }
      if (kind === 'events') {
        await audit({ guildId: gid, actorId: c.actor.id, action: 'EXPORT_CREATED', targetType: 'EXPORT', targetId: 'events', source: 'dashboard' });
        return await streamCsv(res, `events-${stamp}.csv`, ['Event-ID', 'Type', 'Status', 'Præmie', 'Vindere', 'Vært-ID', 'Start', 'Slut', 'Deltagere', 'Entries', 'Test'], (async function* () {
          let cursor: string | undefined;
          for (;;) {
            const rows = await prisma.event.findMany({ where: { guildId: gid }, ...page, ...cur(cursor) });
            if (!rows.length) return;
            const agg = await prisma.entry.groupBy({ by: ['eventId'], where: { eventId: { in: rows.map((r) => r.id) }, amount: { gt: 0 } }, _count: { _all: true }, _sum: { amount: true } });
            const m = new Map(agg.map((a) => [a.eventId, a]));
            yield rows.map((r) => [r.code, r.type, r.status, r.prize, r.winnerCount, r.hostId, r.startsAt, r.endedAt ?? r.endsAt, m.get(r.id)?._count._all ?? 0, m.get(r.id)?._sum.amount ?? 0, r.isTest]);
            cursor = rows[rows.length - 1].id;
            if (rows.length < 2000) return;
          }
        })());
      }
      if (kind === 'audit') {
        await audit({ guildId: gid, actorId: c.actor.id, action: 'EXPORT_CREATED', targetType: 'EXPORT', targetId: 'audit', source: 'dashboard' });
        return await streamCsv(res, `auditlog-${stamp}.csv`, ['Tidspunkt', 'Handling', 'Hvem (ID)', 'Mål-type', 'Mål', 'Event', 'Før', 'Efter', 'Årsag', 'Kilde'], batches((cursor) => prisma.auditLog.findMany({ where: { guildId: gid, category: { not: 'JOIN' } }, ...page, ...cur(cursor) }), (r: any) => [r.createdAt, r.action, r.actorId, r.targetType, r.targetId, r.eventCode, r.before, r.after, r.reason, r.source]));
      }
      throw new HttpError(404, 'Ukendt eksporttype.');
    } catch (e) {
      next(e);
    }
  },
);

// ───────────── fejlhåndtering ─────────────
apiRouter.use(async (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
  if (err instanceof UserError) return void res.status(400).json({ error: err.message });
  const ref = await logError('web.api', err);
  res.status(500).json({ error: `Der opstod en intern fejl${ref ? ` (reference ${ref})` : ''}.` });
});
