import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import type { Event as EventRow } from '@prisma/client';
import { COLORS } from '../shared/constants';
import { fill, getMessage } from '../shared/text';
import { logError, errMsg } from '../logger';
import { audit } from './audit';
import { getClient, getGuild, messageUrl } from './discord';
import { getSettings } from './settings';

const botRoleOps = new Map<string, number>();
export const markBotRoleOp = (guildId: string, userId: string, roleId: string): void => {
  botRoleOps.set(`${guildId}:${userId}:${roleId}`, Date.now());
  if (botRoleOps.size > 500) {
    const cutoff = Date.now() - 60_000;
    for (const [k, t] of botRoleOps) if (t < cutoff) botRoleOps.delete(k);
  }
};
export const wasBotRoleOp = (guildId: string, userId: string, roleId: string): boolean => {
  const t = botRoleOps.get(`${guildId}:${userId}:${roleId}`);
  return !!t && Date.now() - t < 20_000;
};

export async function grantWinnerRole(ev: EventRow, userId: string): Promise<void> {
  const s = await getSettings(ev.guildId);
  if (!s.winnerRoleId) return;
  const roleId = s.winnerRoleId;
  const fail = async (why: string) => {
    await audit({ guildId: ev.guildId, action: 'ROLE_GRANT_FAILED', targetType: 'USER', targetId: userId, eventCode: ev.code, after: { role: `<@&${roleId}>` }, reason: why, source: 'system' });
    await logError('rewards.grantWinnerRole', new Error(why), ev.guildId);
  };
  try {
    const guild = getGuild(ev.guildId);
    if (!guild) return fail('Serveren er ikke tilgængelig');
    const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
    if (!role) return fail('Den indstillede vinderrolle findes ikke længere.');
    const me = guild.members.me ?? (await guild.members.fetchMe());
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return fail('Jeg mangler rettigheden "Administrer roller".');
    if (role.position >= me.roles.highest.position) return fail('Vinderrollen er højere end (eller lig med) min højeste rolle. Flyt min rolle over den i Serverindstillinger → Roller.');
    if (role.managed) return fail('Vinderrollen styres af en integration og kan ikke tildeles.');
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return fail('Vinderen er ikke længere på serveren.');
    markBotRoleOp(ev.guildId, userId, roleId);
    await member.roles.add(role, `Nova Events vinderrolle (${ev.code})`);
    await audit({ guildId: ev.guildId, action: 'ROLE_GRANTED', targetType: 'USER', targetId: userId, eventCode: ev.code, after: { role: `<@&${roleId}>` }, reason: `Vinder af ${ev.code}`, source: 'system' });
  } catch (e) {
    await fail(errMsg(e));
  }
}

export async function sendWinnerDM(ev: EventRow, userId: string, place: number, prize: string): Promise<void> {
  const s = await getSettings(ev.guildId);
  const m = getMessage(s.messages, 'winnerDM');
  if (!m.enabled) return;
  try {
    const user = await getClient().users.fetch(userId);
    const text = fill(m.text, { id: ev.code, prize, link: messageUrl(ev.guildId, ev.channelId, ev.messageId), place: String(place) });
    await user.send({ embeds: [new EmbedBuilder().setColor(COLORS.GOLD).setDescription(text.slice(0, 4000)).setFooter({ text: getGuild(ev.guildId)?.name ?? 'Nova Events' })] });
  } catch (e) {
    await audit({ guildId: ev.guildId, action: 'WINNER_DM_FAILED', targetType: 'USER', targetId: userId, eventCode: ev.code, reason: 'Brugeren har lukkede DM\'er eller har blokeret botten.', source: 'system' });
  }
}

/** Gives the winner role and sends the DM. Test events skip both (and say so in the log). */
export async function rewardWinner(ev: EventRow, userId: string, place: number, prize: string): Promise<void> {
  if (ev.isTest) return;
  await grantWinnerRole(ev, userId);
  await sendWinnerDM(ev, userId, place, prize);
}
