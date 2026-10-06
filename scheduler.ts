import { prisma } from '../db';
import { logError } from '../logger';
import { flushActivity } from './activity';
import { endGiveaway, notifyEndingSoon, retryUndrawn, startScheduledGiveaway } from './giveaways';
import { expireNumberEvents, reloadActiveNumberEvents, sendDueHints } from './numberEvents';
import { getSettings } from './settings';

/**
 * Everything time-based is driven by the DATABASE, not by RAM timers.
 * If the bot restarts, the next tick simply continues where it left off.
 */
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = new Date();

    // 1. scheduled giveaways whose start time has come
    const toStart = await prisma.event.findMany({ where: { type: 'GIVEAWAY', status: 'SCHEDULED', startsAt: { lte: now } }, take: 20 });
    for (const ev of toStart) await startScheduledGiveaway(ev).catch((e) => logError('scheduler.start', e, ev.guildId));

    // 2. giveaways that ran out of time
    const toEnd = await prisma.event.findMany({ where: { type: 'GIVEAWAY', status: 'ACTIVE', endsAt: { lte: now } }, take: 20 });
    for (const ev of toEnd) await endGiveaway(ev.guildId, ev.code, null, 'Tiden løb ud').catch((e) => logError('scheduler.end', e, ev.guildId));

    // 3. "ending soon" notices
    const soon = await prisma.event.findMany({ where: { type: 'GIVEAWAY', status: 'ACTIVE', endsAt: { gt: now, lte: new Date(now.getTime() + 3700_000) } }, take: 50 });
    for (const ev of soon) {
      const s = await getSettings(ev.guildId);
      await notifyEndingSoon(ev, s.endingSoonSeconds).catch((e) => logError('scheduler.endingSoon', e, ev.guildId));
    }

    // 4. number events: expiry + hints, then refresh the in-memory channel map
    await expireNumberEvents();
    await sendDueHints();
    await reloadActiveNumberEvents();

    // 5. interrupted draws
    await retryUndrawn();
  } catch (e) {
    await logError('scheduler.tick', e);
  } finally {
    running = false;
  }
}

let timer: NodeJS.Timeout | null = null;
let maintenance: NodeJS.Timeout | null = null;

export async function startScheduler(): Promise<void> {
  await reloadActiveNumberEvents();
  await tick(); // recover immediately after a restart
  timer = setInterval(() => void tick(), 5000);
  maintenance = setInterval(() => {
    flushActivity().catch(() => undefined);
    prisma.webSession.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);
    prisma.errorLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 86400_000) } } }).catch(() => undefined);
  }, 15_000);
}

export async function stopScheduler(): Promise<void> {
  if (timer) clearInterval(timer);
  if (maintenance) clearInterval(maintenance);
  await flushActivity();
}
