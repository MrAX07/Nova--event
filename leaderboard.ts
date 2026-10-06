import { ActionRowBuilder, ComponentType, EmbedBuilder, SlashCommandBuilder, StringSelectMenuBuilder } from 'discord.js';
import { COLORS } from '../../shared/constants';
import { LeaderboardType, getLeaderboard } from '../../services/stats';
import type { Command } from '../types';

const TYPES: Record<LeaderboardType, { title: string; unit: string; label: string }> = {
  wins: { title: '🏆 GIVEAWAY-VINDERE', unit: 'sejre', label: 'Flest sejre' },
  entries: { title: '🎟️ FLEST ENTRIES', unit: 'entries', label: 'Flest entries' },
  numberwins: { title: '🎯 TALEVENT-VINDERE', unit: 'sejre', label: 'Flest talevent-sejre' },
  participation: { title: '🙌 MEST AKTIVE DELTAGERE', unit: 'giveaways', label: 'Flest deltagelser' },
};

async function render(guildId: string, type: LeaderboardType) {
  const rows = await getLeaderboard(guildId, type, 10);
  const medal = (n: number) => (n === 0 ? '🥇' : n === 1 ? '🥈' : n === 2 ? '🥉' : `**${n + 1}.**`);
  const text = rows.length ? rows.map((r, n) => `${medal(n)} <@${r.userId}> — ${r.value.toLocaleString('da-DK')} ${TYPES[type].unit}`).join('\n') : 'Der er ingen data endnu.';
  return new EmbedBuilder().setColor(COLORS.BRAND).setTitle(TYPES[type].title).setDescription(text).setFooter({ text: 'Nova Events • testevents tæller ikke med' });
}

export const leaderboardCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Se ranglisterne')
    .setDMPermission(false)
    .addStringOption((o) =>
      o.setName('type').setDescription('Hvilken rangliste?').addChoices(...(Object.entries(TYPES).map(([value, t]) => ({ name: t.label, value })) as { name: string; value: string }[])),
    ),
  async execute(i) {
    let type = (i.options.getString('type') ?? 'wins') as LeaderboardType;
    await i.deferReply();
    const menu = (cur: LeaderboardType) =>
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(`lb:${i.id}`).setPlaceholder('Skift rangliste').addOptions(Object.entries(TYPES).map(([value, t]) => ({ label: t.label, value, default: value === cur }))),
      );
    const msg = await i.editReply({ embeds: [await render(i.guildId!, type)], components: [menu(type)] });
    const col = msg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 2 * 60_000, filter: (c) => c.customId === `lb:${i.id}` });
    col.on('collect', async (c) => {
      if (c.user.id !== i.user.id) return void (await c.reply({ content: 'Brug `/leaderboard` selv for at skifte rangliste.', flags: 64 }));
      type = c.values[0] as LeaderboardType;
      await c.update({ embeds: [await render(i.guildId!, type)], components: [menu(type)] });
    });
    col.on('end', () => void i.editReply({ components: [] }).catch(() => undefined));
  },
};
