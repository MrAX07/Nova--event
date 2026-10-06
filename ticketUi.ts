import { ActionRowBuilder, ButtonInteraction, GuildMember, ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle } from 'discord.js';
import { UserError } from '../shared/text';
import { errEmbed, infoEmbed, okEmbed } from '../services/embeds';
import { getMemberLevel } from '../services/permissions';
import { getSettings } from '../services/settings';
import { claimTicket, closeTicket, findTicketByChannel, isTicketStaff, openTicket } from '../services/tickets';
import { EPH, explainError } from './util';

const input = (id: string, label: string, style: TextInputStyle, required: boolean, max: number, placeholder?: string) => {
  const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max);
  if (placeholder) t.setPlaceholder(placeholder);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(t);
};

async function staffCheck(member: GuildMember, type: 'SUPPORT' | 'PRIZE'): Promise<boolean> {
  const s = await getSettings(member.guild.id);
  return isTicketStaff(s, type, [...member.roles.cache.keys()], await getMemberLevel(member), member.guild.ownerId === member.id);
}

export async function handleTicketButton(i: ButtonInteraction): Promise<void> {
  if (!i.inGuild() || !i.guild) return;
  const id = i.customId;
  if (id === 'tk:open:support') {
    await i.showModal(
      new ModalBuilder().setCustomId('tk:modal:support').setTitle('Support-ticket').addComponents(
        input('subject', 'Emne', TextInputStyle.Short, true, 100, 'Kort overskrift'),
        input('details', 'Beskriv hvad du har brug for hjælp til', TextInputStyle.Paragraph, true, 1500),
      ),
    );
    return;
  }
  if (id === 'tk:open:prize') {
    await i.showModal(
      new ModalBuilder().setCustomId('tk:modal:prize').setTitle('Præmie / Event-ansvarlig').addComponents(
        input('event', 'Event-ID (fx EVENT-82941)', TextInputStyle.Short, true, 20),
        input('prize', 'Hvad vandt du? (præmie)', TextInputStyle.Short, true, 200, 'Fx $10.000.000'),
        input('details', 'Ekstra information (valgfrit)', TextInputStyle.Paragraph, false, 1500),
      ),
    );
    return;
  }
  const member = await i.guild.members.fetch(i.user.id).catch(() => null);
  if (!member) return;
  const ticket = await findTicketByChannel(i.guild.id, i.channelId);
  if (!ticket) {
    await i.reply({ embeds: [errEmbed('Denne ticket er ikke længere åben.')], flags: EPH });
    return;
  }
  const staff = await staffCheck(member, ticket.type);
  if (id === 'tk:claim') {
    await i.deferReply({ flags: EPH });
    try {
      if (!staff) throw new UserError('Kun staff kan overtage tickets.');
      await claimTicket(ticket, i.user.id);
      await i.editReply({ embeds: [okEmbed('Du har overtaget ticketen. 🙋')] });
    } catch (e) {
      await i.editReply({ embeds: [errEmbed(await explainError(e, i.guildId))] });
    }
    return;
  }
  if (id === 'tk:close') {
    if (!staff && ticket.userId !== i.user.id) {
      await i.reply({ embeds: [errEmbed('Kun ticketens ejer eller staff kan lukke den.')], flags: EPH });
      return;
    }
    await i.showModal(new ModalBuilder().setCustomId('tk:closem').setTitle('Luk ticket').addComponents(input('reason', 'Årsag (valgfri)', TextInputStyle.Short, false, 300)));
  }
}

export async function handleTicketModal(i: ModalSubmitInteraction): Promise<void> {
  if (!i.inGuild() || !i.guild) return;
  await i.deferReply({ flags: EPH });
  try {
    const member = await i.guild.members.fetch(i.user.id).catch(() => null);
    if (!member) throw new UserError('Jeg kunne ikke finde dig på serveren.');
    const f = (k: string) => {
      try {
        return i.fields.getTextInputValue(k).trim();
      } catch {
        return '';
      }
    };
    if (i.customId === 'tk:modal:support') {
      const t = await openTicket({ guild: i.guild, member, type: 'SUPPORT', subject: f('subject'), details: f('details') });
      await i.editReply({ embeds: [okEmbed(`Din ticket er oprettet: <#${t.channelId}>`, '🎫 TICKET OPRETTET')] });
    } else if (i.customId === 'tk:modal:prize') {
      const t = await openTicket({ guild: i.guild, member, type: 'PRIZE', subject: `Præmie: ${f('prize')}`, details: f('details'), eventCode: f('event'), prize: f('prize') });
      await i.editReply({ embeds: [okEmbed(`Din præmie-ticket er oprettet: <#${t.channelId}>`, '🏆 TICKET OPRETTET')] });
    } else if (i.customId === 'tk:closem') {
      const ticket = await findTicketByChannel(i.guild.id, i.channelId!);
      if (!ticket) throw new UserError('Denne ticket er ikke længere åben.');
      if (!(await staffCheck(member, ticket.type)) && ticket.userId !== i.user.id) throw new UserError('Kun ticketens ejer eller staff kan lukke den.');
      await i.editReply({ embeds: [infoEmbed('🔒 Lukker ticketten og gemmer samtalen…')] });
      await closeTicket(i.guild.id, ticket, i.user.id, f('reason') || null);
    }
  } catch (e) {
    await i.editReply({ embeds: [errEmbed(await explainError(e, i.guildId))] });
  }
}
