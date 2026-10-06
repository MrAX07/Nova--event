import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { COLORS } from '../../shared/constants';
import { listBlacklist, addBlacklist, removeBlacklist } from '../../services/blacklist';
import { okEmbed } from '../../services/embeds';
import { requireEvent } from '../../services/entries';
import type { Command } from '../types';
import { EPH, confirmAction } from '../util';
import { autocompleteEvents } from './shared';

const withGiveaway = (s: any) => s.addStringOption((o: any) => o.setName('giveaway').setDescription('Giveaway-ID (tom = alle giveaways)').setAutocomplete(true));

export const blacklistCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Bloker brugere fra giveaways')
    .setDMPermission(false)
    .addSubcommand((s) =>
      withGiveaway(s.setName('add').setDescription('Tilføj en bruger til blacklisten').addUserOption((o) => o.setName('user').setDescription('Brugeren').setRequired(true))).addStringOption((o) =>
        o.setName('reason').setDescription('Årsag').setMaxLength(300),
      ),
    )
    .addSubcommand((s) => withGiveaway(s.setName('remove').setDescription('Fjern en bruger fra blacklisten').addUserOption((o) => o.setName('user').setDescription('Brugeren').setRequired(true))))
    .addSubcommand((s) => s.setName('check').setDescription('Tjek om en bruger er blacklistet').addUserOption((o) => o.setName('user').setDescription('Brugeren').setRequired(true))),
  async autocomplete(i, ctx) {
    await autocompleteEvents(i, ctx, 'GIVEAWAY');
  },
  async execute(i, ctx) {
    const sub = i.options.getSubcommand();
    const gid = i.guildId!;
    const user = i.options.getUser('user', true);
    const code = i.options.getString('giveaway');
    const eventCode = code ? (await requireEvent(gid, code, 'GIVEAWAY')).code : null;
    if (sub === 'check') {
      await i.deferReply({ flags: EPH });
      const rows = await listBlacklist(gid, user.id);
      const e = new EmbedBuilder().setColor(rows.length ? COLORS.ERR : COLORS.OK).setTitle('🚫 BLACKLIST-TJEK').addFields({ name: 'Bruger', value: `<@${user.id}>` }, {
        name: 'Status',
        value: rows.length ? rows.map((r) => `• ${r.eventCode ? `**${r.eventCode}**` : '**Alle giveaways**'}${r.reason ? ` — ${r.reason}` : ''} (af <@${r.addedBy}>)`).join('\n') : 'Ikke blacklistet ✅',
      });
      await i.editReply({ embeds: [e] });
      return;
    }
    if (sub === 'add') {
      if (!(await confirmAction(i, { title: 'Blacklist bruger', description: `Vil du blacklist <@${user.id}> ${eventCode ? `fra **${eventCode}**` : 'fra **alle** giveaways'}?` }))) return;
      await addBlacklist({ guildId: gid, userId: user.id, eventCode, reason: i.options.getString('reason'), actor: ctx.actor });
      await i.editReply({ embeds: [okEmbed(`<@${user.id}> er blacklistet ${eventCode ? `fra **${eventCode}**` : 'fra alle giveaways'}.`, '🚫 BLACKLISTET')], components: [] });
      return;
    }
    await i.deferReply({ flags: EPH });
    await removeBlacklist({ guildId: gid, userId: user.id, eventCode, actor: ctx.actor });
    await i.editReply({ embeds: [okEmbed(`<@${user.id}> er fjernet fra blacklisten.`, '✅ FJERNET')] });
  },
};
