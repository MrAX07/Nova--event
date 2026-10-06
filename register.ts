import { Client } from 'discord.js';
import { logError } from '../logger';
import { commands } from './commands';

export async function registerGuildCommands(client: Client, guildId: string): Promise<void> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  try {
    await guild.commands.set(commands.map((c) => c.data.toJSON()));
  } catch (e) {
    await logError('registerCommands', e, guildId);
  }
}

export async function registerAllGuilds(client: Client): Promise<void> {
  for (const id of client.guilds.cache.keys()) await registerGuildCommands(client, id);
}
