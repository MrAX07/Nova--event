import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { COLORS } from '../../shared/constants';
import { getGuildStats } from '../../services/stats';
import type { Command } from '../types';
import { EPH } from '../util';

const list = (rows: { userId: string; value: number }[], unit: string) =>
  rows.length ? rows.map((r, n) => `${n + 1}. <@${r.userId}> — ${r.value.toLocaleString('da-DK')} ${unit}`).join('\n') : '—';

export const statsCommand: Command = {
  data: new SlashCommandBuilder().setName('stats').setDescription('Se serverens event-statistik').setDMPermission(false),
  async execute(i) {
    await i.deferReply({ flags: EPH });
    const s = await getGuildStats(i.guildId!);
    const e = new EmbedBuilder()
      .setColor(COLORS.BRAND)
      .setTitle('📈 NOVA EVENTS STATISTIK')
      .addFields(
        { name: '🎁 Giveaways', value: `${s.totalGiveaways} (${s.activeGiveaways} aktive)`, inline: true },
        { name: '🎯 Talevents', value: `${s.totalNumberEvents} (${s.activeNumberEvents} aktive)`, inline: true },
        { name: '🏆 Vindere i alt', value: String(s.totalWinners), inline: true },
        { name: '👥 Unikke deltagere', value: s.uniqueParticipants.toLocaleString('da-DK'), inline: true },
        { name: '🎟️ Entries i alt', value: s.totalEntries.toLocaleString('da-DK'), inline: true },
        { name: '📊 Gns. deltagere', value: s.averageParticipants.toFixed(1), inline: true },
        { name: '🔥 Mest populære giveaway', value: s.mostPopular ? `\`${s.mostPopular.code}\` ${s.mostPopular.prize} — ${s.mostPopular.participants} deltagere` : '—' },
        { name: '⚡ Mest aktive', value: list(s.mostActive, 'entries'), inline: true },
        { name: '🥇 Flest sejre', value: list(s.mostWins, 'sejre'), inline: true },
      )
      .setFooter({ text: 'Testevents er ikke med i tallene' });
    await i.editReply({ embeds: [e] });
  },
};
