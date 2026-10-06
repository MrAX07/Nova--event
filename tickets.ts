import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Guild,
  GuildMember,
  OverwriteResolvable,
  PermissionFlagsBits,
  TextChannel,
} from 'discord.js';
import type { Guild as GuildSettings, Ticket } from '@prisma/client';
import { prisma } from '../db';
import { errMsg, logError } from '../logger';
import { COLORS, Level } from '../shared/constants';
import { UserError, truncate } from '../shared/text';
import { fmtDateTime } from '../shared/time';
import { audit } from './audit';
import { getClient, getGuild } from './discord';
import { normalizeCode } from './entries';
import { getSettings } from './settings';

export const TICKET_LABEL = { SUPPORT: '🛠️ Support', PRIZE: '🏆 Præmie / Event-ansvarlig' } as const;
const MAX_OPEN_PER_TYPE = 1;
const MAX_OPEN_TOTAL = 3;

/** Roller der må se og håndtere tickets af en bestemt type. */
export function staffRoleIds(s: GuildSettings, type: 'SUPPORT' | 'PRIZE'): string[] {
  const common = [...s.ownerRoleIds, ...s.highAdminRoleIds];
  const list = type === 'SUPPORT' ? [...common, ...s.moderatorRoleIds, ...s.eventManagerRoleIds, ...s.ticketSupportRoleIds] : [...common, ...s.eventManagerRoleIds, ...s.ticketPrizeRoleIds];
  return [...new Set(list)];
}

export function isTicketStaff(s: GuildSettings, type: 'SUPPORT' | 'PRIZE', roleIds: string[], level: Level, isGuildOwner = false): boolean {
  if (isGuildOwner || level >= Level.HIGH_ADMIN) return true;
  const staff = staffRoleIds(s, type);
  return roleIds.some((r) => staff.includes(r));
}

export interface OpenTicketInput {
  guild: Guild;
  member: GuildMember;
  type: 'SUPPORT' | 'PRIZE';
  subject: string;
  details: string;
  eventCode?: string | null;
  prize?: string | null;
}

export async function openTicket(p: OpenTicketInput): Promise<Ticket> {
  const s = await getSettings(p.guild.id);
  const open = await prisma.ticket.findMany({ where: { guildId: p.guild.id, userId: p.member.id, status: 'OPEN' }, select: { type: true, channelId: true } });
  if (open.filter((t) => t.type === p.type).length >= MAX_OPEN_PER_TYPE) {
    const ex = open.find((t) => t.type === p.type);
    throw new UserError(`Du har allerede en åben ${p.type === 'SUPPORT' ? 'support' : 'præmie'}-ticket${ex?.channelId ? `: <#${ex.channelId}>` : ''}. Luk den først.`);
  }
  if (open.length >= MAX_OPEN_TOTAL) throw new UserError(`Du kan højst have ${MAX_OPEN_TOTAL} åbne tickets ad gangen.`);

  // Præmie-ticket: tjek om brugeren faktisk er registreret som vinder
  let eventCode: string | null = null;
  let verified = false;
  let prize = p.prize?.trim().slice(0, 250) || null;
  if (p.type === 'PRIZE' && p.eventCode?.trim()) {
    eventCode = normalizeCode(p.eventCode);
    const ev = await prisma.event.findFirst({ where: { guildId: p.guild.id, code: eventCode } });
    if (!ev) throw new UserError(`Jeg kunne ikke finde eventet **${eventCode}**. Tjek ID'et (fx EVENT-82941) og prøv igen.`);
    const win = await prisma.winner.findFirst({ where: { eventId: ev.id, userId: p.member.id, status: 'VALID' } });
    if (win) {
      verified = true;
      prize = win.prize ?? ev.prize;
    } else if (!prize) prize = ev.prize;
  }

  const counter = await prisma.guild.update({ where: { id: p.guild.id }, data: { ticketCounter: { increment: 1 } }, select: { ticketCounter: true } });
  const number = counter.ticketCounter;
  const me = p.guild.members.me ?? (await p.guild.members.fetchMe());
  const staff = staffRoleIds(s, p.type).filter((r) => p.guild.roles.cache.has(r));
  const allow = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];
  const overwrites: OverwriteResolvable[] = [
    { id: p.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: p.member.id, allow },
    { id: me.id, allow: [...allow, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
    ...staff.map((id) => ({ id, allow })),
  ];
  const parent = s.ticketCategoryId && p.guild.channels.cache.get(s.ticketCategoryId)?.type === ChannelType.GuildCategory ? s.ticketCategoryId : undefined;

  let channel: TextChannel;
  try {
    channel = await p.guild.channels.create({
      name: `${p.type === 'PRIZE' ? 'praemie' : 'support'}-${String(number).padStart(4, '0')}`,
      type: ChannelType.GuildText,
      parent,
      topic: `${TICKET_LABEL[p.type]} • ${p.member.user.username} • ${truncate(p.subject, 80)}`,
      permissionOverwrites: overwrites,
      reason: `Nova Events ticket #${number}`,
    });
  } catch (e) {
    throw new UserError(`Jeg kunne ikke oprette ticket-kanalen: ${errMsg(e)}. Jeg skal have rettighederne "Administrer kanaler" og "Administrer roller".`);
  }

  const ticket = await prisma.ticket.create({
    data: { guildId: p.guild.id, number, type: p.type, channelId: channel.id, userId: p.member.id, subject: p.subject.slice(0, 200), details: p.details.slice(0, 1800), eventCode, prize, verified },
  });

  const e = new EmbedBuilder()
    .setColor(p.type === 'PRIZE' ? COLORS.GOLD : COLORS.BRAND)
    .setTitle(`${TICKET_LABEL[p.type]} — ticket #${number}`)
    .setDescription(truncate(`**${p.subject}**\n\n${p.details || '*Ingen yderligere beskrivelse.*'}`, 3500))
    .addFields({ name: 'Oprettet af', value: `<@${p.member.id}>`, inline: true }, { name: 'Status', value: '🟢 Åben', inline: true });
  if (p.type === 'PRIZE') {
    e.addFields(
      { name: '🏆 Præmie', value: prize ?? '*ikke angivet*', inline: true },
      { name: '🔢 Event', value: eventCode ?? '*ikke angivet*', inline: true },
      { name: 'Vinder-tjek', value: eventCode ? (verified ? '✅ Brugeren er registreret som vinder af dette event.' : '⚠️ Brugeren er **ikke** registreret som vinder af dette event. Kontrollér før præmien udleveres.') : '⚠️ Intet event-ID angivet.' },
    );
  }
  e.setFooter({ text: 'Nova Events • brug knapperne herunder' }).setTimestamp(new Date());
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('tk:claim').setLabel('Overtag ticket').setEmoji('🙋').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('tk:close').setLabel('Luk ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger),
  );
  const pingRoles = (p.type === 'PRIZE' ? [...s.ticketPrizeRoleIds, ...s.eventManagerRoleIds] : s.ticketSupportRoleIds).filter((r) => p.guild.roles.cache.has(r));
  await channel
    .send({
      content: `<@${p.member.id}>${pingRoles.length ? ' ' + [...new Set(pingRoles)].map((r) => `<@&${r}>`).join(' ') : ''}`,
      embeds: [e],
      components: [row],
      allowedMentions: { users: [p.member.id], roles: pingRoles },
    })
    .catch((er) => logError('tickets.welcome', er, p.guild.id));

  await audit({
    guildId: p.guild.id,
    actorId: p.member.id,
    action: 'TICKET_OPENED',
    targetType: 'CHANNEL',
    targetId: channel.id,
    eventCode,
    after: { nummer: number, type: p.type === 'PRIZE' ? 'Præmie' : 'Support', emne: truncate(p.subject, 100), ...(p.type === 'PRIZE' ? { præmie: prize ?? '—', vinderVerificeret: verified } : {}) },
  });
  return ticket;
}

export async function claimTicket(ticket: Ticket, userId: string): Promise<void> {
  const r = await prisma.ticket.updateMany({ where: { id: ticket.id, status: 'OPEN', claimedBy: null }, data: { claimedBy: userId } });
  if (r.count !== 1) {
    const cur = await prisma.ticket.findUnique({ where: { id: ticket.id } });
    throw new UserError(cur?.claimedBy ? `Ticketten er allerede overtaget af <@${cur.claimedBy}>.` : 'Ticketten er ikke åben.');
  }
  const ch = ticket.channelId ? getGuild(ticket.guildId)?.channels.cache.get(ticket.channelId) : null;
  if (ch?.isTextBased()) await (ch as TextChannel).send({ embeds: [new EmbedBuilder().setColor(COLORS.OK).setDescription(`🙋 <@${userId}> har overtaget denne ticket.`)], allowedMentions: { parse: [] } }).catch(() => undefined);
  await audit({ guildId: ticket.guildId, actorId: userId, action: 'TICKET_CLAIMED', targetType: 'CHANNEL', targetId: ticket.channelId, after: { nummer: ticket.number } });
}

export async function buildTranscript(channel: TextChannel, tz: string): Promise<string> {
  const lines: string[] = [];
  let before: string | undefined;
  for (let page = 0; page < 10; page++) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    for (const m of batch.values()) {
      const att = m.attachments.size ? ' ' + [...m.attachments.values()].map((a) => `[vedhæftning: ${a.url}]`).join(' ') : '';
      const emb = m.embeds.length && !m.content ? ' [embed]' : '';
      lines.push(`[${fmtDateTime(m.createdAt, tz)}] ${m.author.username}${m.author.bot ? ' (bot)' : ''}: ${m.content}${emb}${att}`.replace(/\n/g, '\n    '));
    }
    before = batch.last()?.id;
    if (batch.size < 100) break;
  }
  return lines.reverse().join('\n');
}

export async function closeTicket(guildId: string, ticket: Ticket, closedBy: string, reason: string | null, source: 'discord' | 'dashboard' = 'discord'): Promise<void> {
  const guild = getGuild(guildId);
  const s = await getSettings(guildId);
  const channel = ticket.channelId ? ((guild?.channels.cache.get(ticket.channelId) ?? (await guild?.channels.fetch(ticket.channelId).catch(() => null))) as TextChannel | null | undefined) : null;
  let transcript = '';
  if (channel && channel.isTextBased()) transcript = await buildTranscript(channel, s.timezone).catch(() => '');
  const r = await prisma.ticket.updateMany({
    where: { id: ticket.id, status: 'OPEN' },
    data: { status: 'CLOSED', closedBy, closeReason: reason?.slice(0, 300) || null, closedAt: new Date(), transcript: transcript.slice(0, 400_000) || null },
  });
  if (r.count !== 1) throw new UserError('Ticketten er allerede lukket.');

  const header = `Ticket #${ticket.number} (${ticket.type === 'PRIZE' ? 'Præmie' : 'Support'}) — ${ticket.subject}\nOprettet af: ${ticket.userId}\nLukket af: ${closedBy}\nÅrsag: ${reason ?? '—'}\n${'─'.repeat(40)}\n`;
  const file = new AttachmentBuilder(Buffer.from(header + (transcript || '(ingen beskeder)'), 'utf8'), { name: `ticket-${String(ticket.number).padStart(4, '0')}.txt` });
  await audit({
    guildId,
    actorId: closedBy,
    action: 'TICKET_CLOSED',
    targetType: 'CHANNEL',
    targetId: ticket.channelId,
    eventCode: ticket.eventCode,
    before: { status: 'Åben' },
    after: {
      status: 'Lukket',
      nummer: ticket.number,
      type: ticket.type === 'PRIZE' ? 'Præmie' : 'Support',
      emne: truncate(ticket.subject, 120),
      oprettetAf: `<@${ticket.userId}>`,
      ...(ticket.claimedBy ? { overtagetAf: `<@${ticket.claimedBy}>` } : {}),
      ...(ticket.prize ? { præmie: ticket.prize } : {}),
    },
    reason,
    source,
    files: [file],
  });

  // Send en kopi til brugeren (hvis DM'er er åbne)
  try {
    const user = await getClient().users.fetch(ticket.userId);
    await user.send({ embeds: [new EmbedBuilder().setColor(COLORS.ENDED).setTitle(`Din ticket #${ticket.number} er lukket`).setDescription(`Årsag: ${reason || 'Ingen angivet'}\nHer er en kopi af samtalen.`)], files: [file] });
  } catch {
    /* DM'er lukket – det er fint */
  }

  if (channel) {
    await channel.send({ embeds: [new EmbedBuilder().setColor(COLORS.ENDED).setDescription('🔒 Ticketten er lukket. Kanalen slettes om 8 sekunder…')] }).catch(() => undefined);
    setTimeout(() => void channel.delete(`Ticket #${ticket.number} lukket`).catch((e) => logError('tickets.delete', e, guildId)), 8000);
  }
}

export async function setTicketUser(guildId: string, ticket: Ticket, userId: string, add: boolean, actorId: string): Promise<void> {
  const guild = getGuild(guildId);
  const ch = ticket.channelId ? guild?.channels.cache.get(ticket.channelId) : null;
  if (!ch || ch.type !== ChannelType.GuildText) throw new UserError('Ticket-kanalen findes ikke længere.');
  if (userId === ticket.userId) throw new UserError('Ticketens ejer kan ikke fjernes.');
  if (add) await ch.permissionOverwrites.edit(userId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
  else await ch.permissionOverwrites.delete(userId);
  await ch.send({ embeds: [new EmbedBuilder().setColor(COLORS.BRAND).setDescription(add ? `➕ <@${userId}> er tilføjet til ticketten af <@${actorId}>.` : `➖ <@${userId}> er fjernet fra ticketten af <@${actorId}>.`)], allowedMentions: { users: add ? [userId] : [] } }).catch(() => undefined);
  await audit({ guildId, actorId, action: add ? 'TICKET_USER_ADDED' : 'TICKET_USER_REMOVED', targetType: 'USER', targetId: userId, after: { ticket: ticket.number } });
}

export async function postTicketPanel(guildId: string, channelId: string, actorId: string): Promise<void> {
  const guild = getGuild(guildId);
  const ch = guild?.channels.cache.get(channelId);
  if (!ch || ch.type !== ChannelType.GuildText) throw new UserError('Vælg en almindelig tekstkanal til ticket-panelet.');
  const e = new EmbedBuilder()
    .setColor(COLORS.BRAND)
    .setTitle('🎫 Support & præmier')
    .setDescription('Brug knapperne herunder til at åbne en privat ticket.\n\n🛠️ **Support** – spørgsmål, problemer eller hjælp fra staff.\n🏆 **Præmie / Event-ansvarlig** – hent din præmie efter en gevinst, eller kontakt event-ansvarlige om et event. Husk dit **event-ID** (fx `EVENT-82941`) og hvad du har vundet.')
    .setFooter({ text: 'Nova Events' });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('tk:open:support').setLabel('Support').setEmoji('🛠️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('tk:open:prize').setLabel('Præmie / Event-ansvarlig').setEmoji('🏆').setStyle(ButtonStyle.Success),
  );
  await (ch as TextChannel).send({ embeds: [e], components: [row] }).catch((er) => {
    throw new UserError(`Jeg kunne ikke sende panelet: ${errMsg(er)}`);
  });
  await audit({ guildId, actorId, action: 'TICKET_PANEL', targetType: 'CHANNEL', targetId: channelId });
}

export async function findTicketByChannel(guildId: string, channelId: string): Promise<Ticket | null> {
  return prisma.ticket.findFirst({ where: { guildId, channelId, status: 'OPEN' } });
}
