import { Client, Guild, GuildMember, TextChannel } from 'discord.js';

let client: Client | null = null;
export const setClient = (c: Client): void => {
  client = c;
};
export const getClient = (): Client => {
  if (!client) throw new Error('Discord client is not ready yet');
  return client;
};

/** Returns a sendable guild text channel or null when missing / not accessible. */
export async function getTextChannel(guildId: string, channelId: string | null | undefined): Promise<TextChannel | null> {
  if (!channelId) return null;
  try {
    const ch = await getClient().channels.fetch(channelId);
    if (!ch || !ch.isTextBased() || ch.isDMBased()) return null;
    if ((ch as TextChannel).guildId !== guildId) return null;
    return ch as unknown as TextChannel;
  } catch {
    return null;
  }
}

export function getGuild(guildId: string): Guild | null {
  return getClient().guilds.cache.get(guildId) ?? null;
}

export async function getMember(guildId: string, userId: string): Promise<GuildMember | null> {
  const g = getGuild(guildId);
  if (!g) return null;
  return g.members.cache.get(userId) ?? (await g.members.fetch(userId).catch(() => null));
}

export const messageUrl = (guildId: string, channelId: string, messageId: string | null | undefined): string =>
  messageId ? `https://discord.com/channels/${guildId}/${channelId}/${messageId}` : `https://discord.com/channels/${guildId}/${channelId}`;
