import type { Event as EventRow } from '@prisma/client';
import { prisma } from '../db';
import { UserError } from '../shared/text';
import { audit } from './audit';
import { touchUser } from './activity';
import { getClient } from './discord';
import type { Actor } from './types';

export function normalizeCode(input: string): string {
  const t = input.trim().toUpperCase();
  const m = t.match(/^(?:EVENT-?)?(\d{3,12})$/);
  return m ? `EVENT-${m[1]}` : t;
}

export async function requireEvent(guildId: string, input: string, type?: 'GIVEAWAY' | 'NUMBER'): Promise<EventRow> {
  const code = normalizeCode(input);
  const ev = await prisma.event.findFirst({ where: { code, guildId } });
  if (!ev) throw new UserError(`Jeg kunne ikke finde event **${code}** på denne server.`);
  if (type && ev.type !== type) throw new UserError(`**${code}** er et ${ev.type === 'GIVEAWAY' ? 'giveaway' : 'talevent'}, ikke et ${type === 'GIVEAWAY' ? 'giveaway' : 'talevent'}.`);
  return ev;
}

export async function modifyEntries(p: {
  guildId: string;
  code: string;
  userId: string;
  mode: 'add' | 'remove' | 'set';
  amount: number;
  reason?: string | null;
  actor: Actor;
}): Promise<{ before: number; after: number; delta: number; event: EventRow }> {
  if (!Number.isInteger(p.amount) || p.amount < (p.mode === 'set' ? 0 : 1) || p.amount > 1_000_000) {
    throw new UserError(p.mode === 'set' ? 'Antal skal være et helt tal fra 0 til 1.000.000.' : 'Antal skal være et helt tal fra 1 til 1.000.000.');
  }
  if (!/^\d{15,25}$/.test(p.userId)) throw new UserError('Det er ikke et gyldigt Discord bruger-ID.');
  const ev = await requireEvent(p.guildId, p.code, 'GIVEAWAY');
  if (ev.status === 'ENDED' || ev.status === 'CANCELLED') throw new UserError(`**${ev.code}** er ${ev.status === 'ENDED' ? 'afsluttet' : 'annulleret'}, så entries kan ikke længere ændres.`);
  let user;
  try {
    user = await getClient().users.fetch(p.userId);
  } catch {
    throw new UserError('Jeg kunne ikke finde den Discord-bruger.');
  }
  if (user.bot) throw new UserError('Bots kan ikke have entries.');
  const reason = p.reason?.trim().slice(0, 500) || null;

  const result = await prisma.$transaction(async (tx) => {
    // Lock the event row so two admins can never overwrite each other's change.
    await tx.$queryRaw`SELECT 1 FROM "Event" WHERE "id" = ${ev.id} FOR UPDATE`;
    const cur = await tx.entry.findUnique({ where: { eventId_userId: { eventId: ev.id, userId: p.userId } } });
    const before = cur?.amount ?? 0;
    const after = p.mode === 'add' ? before + p.amount : p.mode === 'remove' ? Math.max(0, before - p.amount) : p.amount;
    if (after > 10_000_000) throw new UserError('Det ville overskride maksimum på 10.000.000 entries for én bruger.');
    await tx.entry.upsert({
      where: { eventId_userId: { eventId: ev.id, userId: p.userId } },
      create: { eventId: ev.id, guildId: p.guildId, userId: p.userId, amount: after, isTest: ev.isTest },
      update: { amount: after },
    });
    await tx.entryTransaction.create({
      data: {
        guildId: p.guildId,
        eventId: ev.id,
        eventCode: ev.code,
        userId: p.userId,
        type: p.mode === 'add' ? 'ADD' : p.mode === 'remove' ? 'REMOVE' : 'SET',
        delta: after - before,
        before,
        after,
        actorId: p.actor.id,
        reason,
        isTest: ev.isTest,
      },
    });
    return { before, after };
  });

  await touchUser(user);
  await audit({
    guildId: p.guildId,
    actorId: p.actor.id,
    action: p.mode === 'add' ? 'ENTRY_ADDED' : p.mode === 'remove' ? 'ENTRY_REMOVED' : 'ENTRY_SET',
    targetType: 'USER',
    targetId: p.userId,
    eventCode: ev.code,
    before: { entries: result.before },
    after: { entries: result.after },
    reason,
    source: p.actor.source,
  });
  return { ...result, delta: result.after - result.before, event: ev };
}
