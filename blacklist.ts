import { prisma } from '../db';
import { UserError } from '../shared/text';
import { audit } from './audit';
import { touchUser } from './activity';
import type { Actor } from './types';
import { getClient } from './discord';

export async function isBlacklisted(
  guildId: string,
  userId: string,
  eventCode?: string,
): Promise<{ scope: 'global' | 'giveaway'; reason: string | null } | null> {
  const row = await prisma.blacklist.findFirst({
    where: { guildId, userId, OR: [{ eventCode: null }, ...(eventCode ? [{ eventCode }] : [])] },
    orderBy: { eventCode: 'asc' },
  });
  if (!row) return null;
  return { scope: row.eventCode ? 'giveaway' : 'global', reason: row.reason };
}

export async function listBlacklist(guildId: string, userId: string) {
  return prisma.blacklist.findMany({ where: { guildId, userId }, orderBy: { createdAt: 'desc' } });
}

async function checkUser(userId: string): Promise<void> {
  if (!/^\d{15,25}$/.test(userId)) throw new UserError('Det er ikke et gyldigt Discord bruger-ID.');
  try {
    const u = await getClient().users.fetch(userId);
    await touchUser(u);
  } catch {
    throw new UserError('Jeg kunne ikke finde den Discord-bruger.');
  }
}

export async function addBlacklist(p: {
  guildId: string;
  userId: string;
  eventCode?: string | null;
  reason?: string | null;
  actor: Actor;
}): Promise<void> {
  await checkUser(p.userId);
  const eventCode = p.eventCode || null;
  if (eventCode) {
    const ev = await prisma.event.findFirst({ where: { code: eventCode, guildId: p.guildId } });
    if (!ev) throw new UserError(`Event ${eventCode} blev ikke fundet.`);
  }
  const existing = await prisma.blacklist.findFirst({ where: { guildId: p.guildId, userId: p.userId, eventCode } });
  if (existing) throw new UserError(eventCode ? 'Brugeren er allerede blacklistet fra dette giveaway.' : 'Brugeren er allerede på den globale blacklist.');
  await prisma.blacklist.create({
    data: { guildId: p.guildId, userId: p.userId, eventCode, reason: p.reason?.slice(0, 500) || null, addedBy: p.actor.id },
  });
  await audit({
    guildId: p.guildId,
    actorId: p.actor.id,
    action: 'BLACKLIST_ADDED',
    targetType: 'USER',
    targetId: p.userId,
    eventCode,
    before: { blacklisted: false },
    after: { blacklisted: true, scope: eventCode ?? 'global' },
    reason: p.reason ?? null,
    source: p.actor.source,
  });
}

export async function removeBlacklist(p: {
  guildId: string;
  userId: string;
  eventCode?: string | null;
  reason?: string | null;
  actor: Actor;
}): Promise<void> {
  const eventCode = p.eventCode || null;
  const r = await prisma.blacklist.deleteMany({ where: { guildId: p.guildId, userId: p.userId, eventCode } });
  if (r.count === 0) throw new UserError(eventCode ? 'Brugeren er ikke blacklistet fra dette giveaway.' : 'Brugeren er ikke på den globale blacklist.');
  await audit({
    guildId: p.guildId,
    actorId: p.actor.id,
    action: 'BLACKLIST_REMOVED',
    targetType: 'USER',
    targetId: p.userId,
    eventCode,
    before: { blacklisted: true, scope: eventCode ?? 'global' },
    after: { blacklisted: false },
    reason: p.reason ?? null,
    source: p.actor.source,
  });
}
