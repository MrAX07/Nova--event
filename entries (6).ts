import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { prisma } from '../../db';
import { COLORS } from '../../shared/constants';
import { fmtDateTime } from '../../shared/time';
import { infoEmbed } from '../../services/embeds';
import { modifyEntries, requireEvent } from '../../services/entries';
import type { Command } from '../types';
import { EPH, confirmAction, eventLine, statusIcon } from '../util';
import { autocompleteEvents } from './shared';

const withCore = (s: any, set: boolean) =>
  s
    .addUserOption((o: any) => o.setName('user').setDescription('Brugeren').setRequired(true))
    .addIntegerOption((o: any) => o.setName('amount').setDescription(set ? 'Nyt antal entries' : 'Antal entries').setRequired(true).setMinValue(set ? 0 : 1).setMaxValue(1_000_000))
    .addStringOption((o: any) => o.setName('giveaway').setDescription('Giveaway-ID, fx EVENT-82941').setRequired(true).setAutocomplete(true))
    .addStringOption((o: any) => o.setName('reason').setDescription('Årsag (vises i loggen)').setMaxLength(300));

const data = new SlashCommandBuilder()
  .setName('entries')
  .setDescription('Ret entries manuelt (kun højadmins og ejere)')
  .setDMPermission(false)
  .addSubcommand((s) => withCore(s.setName('add').setDescription('Tilføj entries til en bruger'), false))
  .addSubcommand((s) => withCore(s.setName('remove').setDescription('Fjern entries fra en bruger'), false))
  .addSubcommand((s) => withCore(s.setName('set').setDescription('Sæt en brugers entries til et bestemt tal'), true))
  .addSubcommand((s) =>
    s
      .setName('check')
      .setDescription('Se en brugers entries')
      .addUserOption((o) => o.setName('user').setDescription('Brugeren').setRequired(true))
      .addStringOption((o) => o.setName('giveaway').setDescription('Giveaway-ID (tom = alle aktive)').setAutocomplete(true)),
  );

export const entriesCommand: Command = {
  data,
  async autocomplete(i, ctx) {
    await autocompleteEvents(i, ctx, 'GIVEAWAY');
  },
  async execute(i, ctx) {
    const sub = i.options.getSubcommand();
    const gid = i.guildId!;
    const user = i.options.getUser('user', true);

    if (sub === 'check') {
      await i.deferReply({ flags: EPH });
      const code = i.options.getString('giveaway');
      if (code) {
        const ev = await requireEvent(gid, code, 'GIVEAWAY');
        const [entry, tx] = await Promise.all([
          prisma.entry.findUnique({ where: { eventId_userId: { eventId: ev.id, userId: user.id } } }),
          prisma.entryTransaction.findMany({ where: { eventId: ev.id, userId: user.id }, orderBy: { createdAt: 'desc' }, take: 5 }),
        ]);
        const e = new EmbedBuilder()
          .setColor(COLORS.BRAND)
          .setTitle('🎟️ ENTRIES')
          .addFields(
            { name: '👤 Bruger', value: `<@${user.id}>`, inline: true },
            { name: '🎟️ Entries', value: String(entry?.amount ?? 0), inline: true },
            { name: 'Giveaway', value: `${statusIcon(ev.status)} ${ev.code}`, inline: true },
            { name: 'Seneste ændringer', value: tx.length ? tx.map((t) => `\`${fmtDateTime(t.createdAt, ctx.settings.timezone)}\` ${t.delta >= 0 ? '+' : ''}${t.delta} (${t.before} → ${t.after})${t.actorId ? ` af <@${t.actorId}>` : ' (deltog selv)'}`).join('\n') : 'Ingen ændringer endnu.' },
          );
        await i.editReply({ embeds: [e] });
      } else {
        const rows = await prisma.entry.findMany({ where: { guildId: gid, userId: user.id, amount: { gt: 0 }, event: { status: { in: ['ACTIVE', 'PAUSED', 'SCHEDULED'] } } }, include: { event: true }, take: 15 });
        await i.editReply({ embeds: [infoEmbed(rows.length ? rows.map((r) => eventLine(r.event, `**${r.amount}** entries`)).join('\n') : `<@${user.id}> har ingen entries i aktive giveaways.`, '🎟️ Aktive entries')] });
      }
      return;
    }

    const amount = i.options.getInteger('amount', true);
    const code = i.options.getString('giveaway', true);
    const reason = i.options.getString('reason');
    if (sub !== 'add') {
      const ev = await requireEvent(gid, code, 'GIVEAWAY');
      const text = sub === 'remove' ? `Vil du fjerne **${amount}** entries fra <@${user.id}> i **${ev.code}**?` : `Vil du sætte <@${user.id}>s entries i **${ev.code}** til **${amount}**?`;
      if (!(await confirmAction(i, { title: sub === 'remove' ? 'Fjern entries' : 'Sæt entries', description: `${text}\nÆndringen bliver logget.` }))) return;
    } else {
      await i.deferReply({ flags: EPH });
    }
    const r = await modifyEntries({ guildId: gid, code, userId: user.id, mode: sub as 'add' | 'remove' | 'set', amount, reason, actor: ctx.actor });
    const e = new EmbedBuilder()
      .setColor(COLORS.OK)
      .setTitle('🎟️ ENTRIES OPDATERET')
      .addFields(
        { name: 'Bruger', value: `<@${user.id}>`, inline: true },
        { name: 'Ændring', value: `${r.delta >= 0 ? '+' : ''}${r.delta} entries`, inline: true },
        { name: 'Før', value: String(r.before), inline: true },
        { name: 'Nu', value: String(r.after), inline: true },
        { name: 'Giveaway', value: r.event.code, inline: true },
        { name: 'Årsag', value: reason || 'Ingen årsag angivet' },
      )
      .setFooter({ text: 'Ændringen er gemt i auditloggen.' });
    await i.editReply({ embeds: [e], components: [] });
  },
};
