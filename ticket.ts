import { ChannelType, SlashCommandBuilder } from 'discord.js';
import { prisma } from '../../db';
import { UserError } from '../../shared/text';
import { fmtDateTime } from '../../shared/time';
import { Level } from '../../shared/constants';
import { errEmbed, infoEmbed, okEmbed } from '../../services/embeds';
import { claimTicket, closeTicket, findTicketByChannel, isTicketStaff, postTicketPanel, setTicketUser } from '../../services/tickets';
import type { Command } from '../types';
import { EPH } from '../util';

const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Ticket-system (support og præmier)')
  .setDMPermission(false)
  .addSubcommand((s) => s.setName('panel').setDescription('Send ticket-panelet med knapper til en kanal').addChannelOption((o) => o.setName('kanal').setDescription('Kanalen panelet sendes i (standard: denne)').addChannelTypes(ChannelType.GuildText)))
  .addSubcommand((s) => s.setName('claim').setDescription('Overtag denne ticket (staff)'))
  .addSubcommand((s) => s.setName('close').setDescription('Luk denne ticket').addStringOption((o) => o.setName('aarsag').setDescription('Årsag').setMaxLength(300)))
  .addSubcommand((s) => s.setName('add').setDescription('Tilføj en bruger til denne ticket (staff)').addUserOption((o) => o.setName('user').setDescription('Brugeren').setRequired(true)))
  .addSubcommand((s) => s.setName('remove').setDescription('Fjern en bruger fra denne ticket (staff)').addUserOption((o) => o.setName('user').setDescription('Brugeren').setRequired(true)))
  .addSubcommand((s) => s.setName('list').setDescription('Vis åbne tickets'));

export const ticketCommand: Command = {
  data,
  async execute(i, ctx) {
    const sub = i.options.getSubcommand();
    const gid = i.guildId!;
    await i.deferReply({ flags: EPH });
    if (sub === 'panel') {
      const ch = i.options.getChannel('kanal');
      await postTicketPanel(gid, ch?.id ?? i.channelId, ctx.actor.id);
      await i.editReply({ embeds: [okEmbed('Ticket-panelet er sendt. 🎫\nTip: Sæt ticket-kategori og roller med `/config ticket`.', '🎫 PANEL SENDT')] });
      return;
    }
    if (sub === 'list') {
      const rows = await prisma.ticket.findMany({ where: { guildId: gid, status: 'OPEN' }, orderBy: { number: 'desc' }, take: 20 });
      await i.editReply({ embeds: [infoEmbed(rows.length ? rows.map((t) => `${t.type === 'PRIZE' ? '🏆' : '🛠️'} **#${t.number}** ${t.channelId ? `<#${t.channelId}>` : ''} — <@${t.userId}> — ${t.subject.slice(0, 50)}${t.claimedBy ? ` (🙋 <@${t.claimedBy}>)` : ''}\n> ${fmtDateTime(t.createdAt, ctx.settings.timezone)}`).join('\n') : 'Der er ingen åbne tickets.', '🎫 Åbne tickets')] });
      return;
    }
    const ticket = await findTicketByChannel(gid, i.channelId);
    if (!ticket) throw new UserError('Denne kommando skal bruges inde i en åben ticket-kanal.');
    const roleIds = [...ctx.member.roles.cache.keys()];
    const staff = isTicketStaff(ctx.settings, ticket.type, roleIds, ctx.level, ctx.guild.ownerId === ctx.member.id);
    if (sub === 'close') {
      if (!staff && ticket.userId !== i.user.id) throw new UserError('Kun ticketens ejer eller staff kan lukke den.');
      await i.editReply({ embeds: [infoEmbed('🔒 Lukker ticketten og gemmer samtalen…')] });
      await closeTicket(gid, ticket, i.user.id, i.options.getString('aarsag'));
      return;
    }
    if (!staff) throw new UserError('Kun staff kan bruge den kommando i en ticket.');
    if (sub === 'claim') {
      await claimTicket(ticket, i.user.id);
      await i.editReply({ embeds: [okEmbed('Du har overtaget ticketen.')] });
      return;
    }
    const user = i.options.getUser('user', true);
    await setTicketUser(gid, ticket, user.id, sub === 'add', i.user.id);
    await i.editReply({ embeds: [okEmbed(sub === 'add' ? `<@${user.id}> er tilføjet.` : `<@${user.id}> er fjernet.`)] });
    void errEmbed;
    void Level;
  },
};
