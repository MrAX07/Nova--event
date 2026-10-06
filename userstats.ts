import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { COLORS, Level } from '../../shared/constants';
import { UserError, truncate } from '../../shared/text';
import { getUserStats } from '../../services/stats';
import type { Command } from '../types';
import { EPH, statusIcon } from '../util';

export const userStatsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('userstats')
    .setDescription('Se statistik for dig selv (eller en anden, hvis du er staff)')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('user').setDescription('Brugeren (tom = dig selv)')),
  async execute(i, ctx) {
    const target = i.options.getUser('user') ?? i.user;
    if (target.id !== i.user.id && ctx.level < Level.MODERATOR) throw new UserError('Du kan kun se din egen statistik.');
    await i.deferReply({ flags: EPH });
    const s = await getUserStats(i.guildId!, target.id);
    const hist = s.history.length
      ? s.history.map((h) => `${statusIcon(h.status)} \`${h.code}\` ${truncate(h.prize, 28)} — ${h.entries} entries${h.won ? ' 🏆' : ''}`).join('\n')
      : 'Ingen deltagelser endnu.';
    const e = new EmbedBuilder()
      .setColor(COLORS.BRAND)
      .setTitle('📊 BRUGERSTATISTIK')
      .setThumbnail(target.displayAvatarURL({ size: 128 }))
      .addFields(
        { name: '👤 Bruger', value: `<@${target.id}>`, inline: true },
        { name: '🎁 Giveaways deltaget i', value: String(s.giveawaysEntered), inline: true },
        { name: '🎟️ Entries i alt', value: s.totalEntries.toLocaleString('da-DK'), inline: true },
        { name: '🏆 Giveaways vundet', value: String(s.giveawayWins), inline: true },
        { name: '🎯 Talevents vundet', value: String(s.numberWins), inline: true },
        { name: '🥇 Sejre i alt', value: String(s.totalWins), inline: true },
        { name: '📊 Win rate', value: `${s.winRate.toFixed(1)}%`, inline: true },
        { name: '🎟️ Aktive entries', value: `${s.activeEntries.toLocaleString('da-DK')} (i ${s.activeGiveaways} giveaways)`, inline: true },
        { name: '📜 Seneste giveaways', value: hist },
      );
    await i.editReply({ embeds: [e] });
  },
};
