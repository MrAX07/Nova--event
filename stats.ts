import { prisma } from '../db';
import { resolveUsers } from './activity';

export type LeaderboardType = 'wins' | 'entries' | 'numberwins' | 'participation';

export async function getUserStats(guildId: string, userId: string) {
  const [entryAgg, activeAgg, winsGiveaway, winsNumber, history, endedEntered] = await Promise.all([
    prisma.entry.aggregate({ where: { guildId, userId, isTest: false, amount: { gt: 0 } }, _count: { _all: true }, _sum: { amount: true } }),
    prisma.entry.aggregate({ where: { guildId, userId, isTest: false, amount: { gt: 0 }, event: { status: { in: ['ACTIVE', 'PAUSED', 'SCHEDULED'] } } }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.winner.count({ where: { guildId, userId, status: 'VALID', eventType: 'GIVEAWAY', isTest: false } }),
    prisma.winner.count({ where: { guildId, userId, status: 'VALID', eventType: 'NUMBER', isTest: false } }),
    prisma.entry.findMany({
      where: { guildId, userId, isTest: false, amount: { gt: 0 } },
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { event: { select: { code: true, prize: true, status: true, winners: { where: { userId, status: 'VALID' }, select: { place: true } } } } },
    }),
    prisma.entry.count({ where: { guildId, userId, isTest: false, amount: { gt: 0 }, event: { status: 'ENDED' } } }),
  ]);
  const totalWins = winsGiveaway + winsNumber;
  return {
    giveawaysEntered: entryAgg._count._all,
    totalEntries: entryAgg._sum.amount ?? 0,
    giveawayWins: winsGiveaway,
    numberWins: winsNumber,
    totalWins,
    winRate: endedEntered > 0 ? Math.min(100, (winsGiveaway / endedEntered) * 100) : 0,
    activeEntries: activeAgg._sum.amount ?? 0,
    activeGiveaways: activeAgg._count._all,
    history: history.map((h) => ({ code: h.event.code, prize: h.event.prize, status: h.event.status, entries: h.amount, won: h.event.winners.length > 0 })),
  };
}

export async function getLeaderboard(guildId: string, type: LeaderboardType, take = 10): Promise<{ userId: string; value: number }[]> {
  if (type === 'wins' || type === 'numberwins') {
    const rows = await prisma.winner.groupBy({
      by: ['userId'],
      where: { guildId, status: 'VALID', isTest: false, ...(type === 'numberwins' ? { eventType: 'NUMBER' } : {}) },
      _count: { _all: true },
      orderBy: { _count: { userId: 'desc' } },
      take,
    });
    return rows.map((r) => ({ userId: r.userId, value: r._count._all }));
  }
  if (type === 'entries') {
    const rows = await prisma.entry.groupBy({ by: ['userId'], where: { guildId, isTest: false, amount: { gt: 0 } }, _sum: { amount: true }, orderBy: { _sum: { amount: 'desc' } }, take });
    return rows.map((r) => ({ userId: r.userId, value: r._sum.amount ?? 0 }));
  }
  const rows = await prisma.entry.groupBy({ by: ['userId'], where: { guildId, isTest: false, amount: { gt: 0 } }, _count: { _all: true }, orderBy: { _count: { userId: 'desc' } }, take });
  return rows.map((r) => ({ userId: r.userId, value: r._count._all }));
}

export async function getGuildStats(guildId: string) {
  const real = { guildId, isTest: false };
  const [totalGiveaways, totalNumber, activeGiveaways, activeNumber, entryAgg, winnersCount, participantsDistinct, topEntrants, topWinners, popular, endedGiveaways] = await Promise.all([
    prisma.event.count({ where: { ...real, type: 'GIVEAWAY' } }),
    prisma.event.count({ where: { ...real, type: 'NUMBER' } }),
    prisma.event.count({ where: { ...real, type: 'GIVEAWAY', status: { in: ['ACTIVE', 'PAUSED'] } } }),
    prisma.event.count({ where: { ...real, type: 'NUMBER', status: 'ACTIVE' } }),
    prisma.entry.aggregate({ where: { ...real, amount: { gt: 0 } }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.winner.count({ where: { ...real, status: 'VALID' } }),
    prisma.entry.groupBy({ by: ['userId'], where: { ...real, amount: { gt: 0 } } }),
    prisma.entry.groupBy({ by: ['userId'], where: { ...real, amount: { gt: 0 } }, _sum: { amount: true }, orderBy: { _sum: { amount: 'desc' } }, take: 5 }),
    prisma.winner.groupBy({ by: ['userId'], where: { ...real, status: 'VALID' }, _count: { _all: true }, orderBy: { _count: { userId: 'desc' } }, take: 5 }),
    prisma.entry.groupBy({ by: ['eventId'], where: { ...real, amount: { gt: 0 } }, _count: { _all: true }, orderBy: { _count: { eventId: 'desc' } }, take: 1 }),
    prisma.event.count({ where: { ...real, type: 'GIVEAWAY', status: 'ENDED' } }),
  ]);
  let mostPopular: { code: string; prize: string; participants: number } | null = null;
  if (popular[0]) {
    const ev = await prisma.event.findUnique({ where: { id: popular[0].eventId }, select: { code: true, prize: true } });
    if (ev) mostPopular = { ...ev, participants: popular[0]._count._all };
  }
  const participations = entryAgg._count._all;
  return {
    totalGiveaways,
    totalNumberEvents: totalNumber,
    activeGiveaways,
    activeNumberEvents: activeNumber,
    totalEntries: entryAgg._sum.amount ?? 0,
    totalParticipations: participations,
    uniqueParticipants: participantsDistinct.length,
    totalWinners: winnersCount,
    averageParticipants: totalGiveaways > 0 ? participations / totalGiveaways : 0,
    averageEndedParticipants: endedGiveaways > 0 ? participations / endedGiveaways : 0,
    mostPopular,
    mostActive: topEntrants.map((r) => ({ userId: r.userId, value: r._sum.amount ?? 0 })),
    mostWins: topWinners.map((r) => ({ userId: r.userId, value: r._count._all })),
  };
}

export { resolveUsers };
