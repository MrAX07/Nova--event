import { env } from './env';
import { prisma } from './db';
import { info, logError } from './logger';
import { createClient } from './bot/client';
import { wireEvents } from './bot/events';
import { setClient } from './services/discord';
import { startScheduler, stopScheduler } from './services/scheduler';
import { startWeb } from './web/server';

async function main(): Promise<void> {
  info('Starter Nova Events…');
  await prisma.$connect();

  const client = createClient();
  setClient(client);
  wireEvents(client, async () => {
    await startScheduler();
    info('✅ Planlægger kører – giveaways og talevents er genoptaget fra databasen.');
  });

  const server = await startWeb();
  await client.login(env.DISCORD_TOKEN);

  let closing = false;
  const shutdown = async (sig: string) => {
    if (closing) return;
    closing = true;
    info(`Modtog ${sig} – lukker pænt ned…`);
    try {
      await stopScheduler();
      server.close();
      await client.destroy();
      await prisma.$disconnect();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

process.on('unhandledRejection', (e) => void logError('unhandledRejection', e));
process.on('uncaughtException', (e) => void logError('uncaughtException', e));

main().catch(async (e) => {
  console.error('❌ Nova Events kunne ikke starte:', e);
  process.exit(1);
});
