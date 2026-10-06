import { SlashCommandBuilder } from 'discord.js';
import { prisma } from '../../db';
import { Level } from '../../shared/constants';
import { infoEmbed } from '../../services/embeds';
import { requireEvent } from '../../services/entries';
import type { Command } from '../types';
import { EPH, eventLine } from '../util';
import { autocompleteEvents, eventInfo } from './shared';

export const eventCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Find og se events')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('info').setDescription('Se alt om et event').addStringOption((o) => o.setName('id').setDescription('Event-ID, fx EVENT-82941').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) =>
      s
        .setName('search')
        .setDescription('Søg i gamle og nye events')
        .addStringOption((o) => o.setName('soeg').setDescription('Søg i præmie eller ID').setMaxLength(100))
        .addStringOption((o) => o.setName('type').setDescription('Type').addChoices({ name: 'Giveaways', value: 'GIVEAWAY' }, { name: 'Talevents', value: 'NUMBER' }))
        .addStringOption((o) =>
          o.setName('status').setDescription('Status').addChoices({ name: 'Aktive', value: 'ACTIVE' }, { name: 'Pausede', value: 'PAUSED' }, { name: 'Planlagte', value: 'SCHEDULED' }, { name: 'Afsluttede', value: 'ENDED' }, { name: 'Annullerede', value: 'CANCELLED' }),
        ),
    ),
  async autocomplete(i, ctx) {
    await autocompleteEvents(i, ctx);
  },
  async execute(i, ctx) {
    await i.deferReply({ flags: EPH });
    const gid = i.guildId!;
    if (i.options.getSubcommand() === 'info') {
      const ev = await requireEvent(gid, i.options.getString('id', true));
      await i.editReply({ embeds: [await eventInfo(ev, ctx.settings.timezone, ctx.level >= Level.HIGH_ADMIN)] });
      return;
    }
    const q = i.options.getString('soeg')?.trim();
    const rows = await prisma.event.findMany({
      where: {
        guildId: gid,
        ...(i.options.getString('type') ? { type: i.options.getString('type') as any } : {}),
        ...(i.options.getString('status') ? { status: i.options.getString('status') as any } : {}),
        ...(q ? { OR: [{ code: { contains: q.toUpperCase() } }, { prize: { contains: q, mode: 'insensitive' as const } }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 15,
    });
    await i.editReply({ embeds: [infoEmbed(rows.length ? rows.map((r) => eventLine(r)).join('\n') : 'Ingen events matcher din søgning.', '🔎 Søgeresultater')] });
  },
};
