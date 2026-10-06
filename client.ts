import { Client, GatewayIntentBits, Options, Partials } from 'discord.js';

export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers, // privilegeret – skal slås til i Developer Portal
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent, // privilegeret – skal slås til (bruges til talevents + besked-krav)
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.GuildMember],
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 20,
      ReactionManager: 0,
      PresenceManager: 0,
      GuildMemberManager: { maxSize: 5000, keepOverLimit: (m) => m.id === m.client.user?.id },
    }),
    sweepers: { ...Options.DefaultSweeperSettings, messages: { interval: 300, lifetime: 600 } },
  });
}
