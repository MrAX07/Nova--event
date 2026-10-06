import { Client, Events, GuildMember, Message, PartialGuildMember } from 'discord.js';
import { info, logError } from '../logger';
import { audit } from '../services/audit';
import { countMessage } from '../services/activity';
import { handleNumberMessage } from '../services/numberEvents';
import { prisma } from '../db';
import { wasBotRoleOp } from '../services/rewards';
import { getSettings } from '../services/settings';
import { handleInteraction } from './handler';
import { registerGuildCommands } from './register';
import { env } from '../env';

const tracked = new Map<string, { at: number; roles: Set<string> }>();

async function trackedRoles(guildId: string): Promise<Set<string>> {
  const hit = tracked.get(guildId);
  if (hit && Date.now() - hit.at < 60_000) return hit.roles;
  const s = await getSettings(guildId);
  const roles = new Set<string>([...s.ownerRoleIds, ...s.highAdminRoleIds, ...s.eventManagerRoleIds, ...s.moderatorRoleIds]);
  if (s.winnerRoleId) roles.add(s.winnerRoleId);
  const evs = await prisma.event.findMany({ where: { guildId, type: 'GIVEAWAY', status: { in: ['ACTIVE', 'PAUSED', 'SCHEDULED'] } }, select: { config: true } });
  for (const e of evs) {
    const c = (e.config ?? {}) as { requiredRoles?: string[]; blacklistedRoles?: string[]; bonusRoles?: { roleId: string }[] };
    c.requiredRoles?.forEach((r) => roles.add(r));
    c.blacklistedRoles?.forEach((r) => roles.add(r));
    c.bonusRoles?.forEach((b) => roles.add(b.roleId));
  }
  tracked.set(guildId, { at: Date.now(), roles });
  return roles;
}

export function wireEvents(client: Client, onReady: () => Promise<void>): void {
  client.once(Events.ClientReady, async (c) => {
    info(`Logget ind som ${c.user.tag} på ${c.guilds.cache.size} server(e)`);
    try {
      if (env.AUTO_REGISTER_COMMANDS) for (const g of c.guilds.cache.values()) await registerGuildCommands(c, g.id);
      for (const g of c.guilds.cache.values()) await getSettings(g.id, g.name);
      await onReady();
    } catch (e) {
      await logError('ready', e);
    }
  });

  client.on(Events.GuildCreate, async (g) => {
    await getSettings(g.id, g.name).catch(() => undefined);
    await registerGuildCommands(client, g.id);
  });

  client.on(Events.InteractionCreate, (i) => void handleInteraction(i));

  client.on(Events.MessageCreate, (m: Message) => {
    if (m.author.bot || !m.guildId) return;
    countMessage(m.guildId, m.author.id);
    handleNumberMessage(m);
  });

  client.on(Events.GuildMemberUpdate, async (oldM: GuildMember | PartialGuildMember, newM: GuildMember) => {
    try {
      const s = await getSettings(newM.guild.id);
      if (!s.logRoleChanges || newM.user.bot) return;
      const before = new Set<string>(oldM.roles?.cache.keys() ?? []);
      const after = new Set<string>(newM.roles.cache.keys());
      const rel = await trackedRoles(newM.guild.id);
      for (const r of after) if (!before.has(r) && rel.has(r) && !wasBotRoleOp(newM.guild.id, newM.id, r)) await audit({ guildId: newM.guild.id, action: 'ROLE_ADDED', targetType: 'USER', targetId: newM.id, after: { role: `<@&${r}>` }, source: 'system' });
      if (oldM.roles) for (const r of before) if (!after.has(r) && rel.has(r)) await audit({ guildId: newM.guild.id, action: 'ROLE_REMOVED', targetType: 'USER', targetId: newM.id, before: { role: `<@&${r}>` }, source: 'system' });
    } catch (e) {
      await logError('guildMemberUpdate', e, newM.guild.id);
    }
  });

  client.on(Events.Error, (e) => void logError('discord.client', e));
  client.on(Events.Warn, (w) => console.warn('[discord warn]', w));
}
