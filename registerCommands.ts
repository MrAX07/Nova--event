import { Client, GatewayIntentBits } from 'discord.js';
import { env } from './env';
import { registerAllGuilds } from './bot/register';

/** Manuel registrering: npm run commands:register */
async function main() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(env.DISCORD_TOKEN);
  await new Promise<void>((r) => client.once('ready', () => r()));
  await registerAllGuilds(client);
  console.log(`✅ Slash-kommandoer registreret på ${client.guilds.cache.size} server(e).`);
  await client.destroy();
  process.exit(0);
}
main().catch((e) => {
  console.error('❌ Kunne ikke registrere kommandoer:', e);
  process.exit(1);
});
