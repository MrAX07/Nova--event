import { ActionRowBuilder, ChatInputCommandInteraction, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { prisma } from '../../db';
import { Level } from '../../shared/constants';
import { UserError } from '../../shared/text';
import { fmtDurationLong, parseDuration } from '../../shared/time';
import { errEmbed, infoEmbed, okEmbed } from '../../services/embeds';
import { requireEvent } from '../../services/entries';
import { rerollNumberEvent, startNumberEvent, stopNumberEvent } from '../../services/numberEvents';
import type { Command, CommandContext } from '../types';
import { EPH, confirmAction, eventLine, explainError } from '../util';
import { autocompleteEvents, eventInfo } from './shared';

const idOpt = (o: any) => o.setName('id').setDescription('Event-ID').setRequired(true).setAutocomplete(true);

const data = new SlashCommandBuilder()
  .setName('numberevent')
  .setDescription('Talevents: skriv det skjulte tal først')
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('start')
      .setDescription('Start et talevent med et skjult tal')
      .addStringOption((o) => o.setName('praemie').setDescription('Præmien, fx $10.000.000').setRequired(true).setMaxLength(250))
      .addIntegerOption((o) => o.setName('min').setDescription('Mindste tal (standard 1)').setMinValue(-1_000_000_000).setMaxValue(1_000_000_000))
      .addIntegerOption((o) => o.setName('max').setDescription('Største tal (standard 10000)').setMinValue(-1_000_000_000).setMaxValue(1_000_000_000))
      .addChannelOption((o) => o.setName('kanal').setDescription('Kanalen der overvåges (standard: talevent-kanalen)'))
      .addStringOption((o) => o.setName('varighed').setDescription('Fx 10m, 1t (standard 10m)').setMaxLength(20))
      .addIntegerOption((o) => o.setName('vindere').setDescription('Antal vindere (1-10)').setMinValue(1).setMaxValue(10))
      .addStringOption((o) => o.setName('praemier').setDescription('Præmie pr. plads, adskilt med | (fx $10M|$5M|$2M)').setMaxLength(600))
      .addIntegerOption((o) => o.setName('hints').setDescription('Antal hints (0-10)').setMinValue(0).setMaxValue(10))
      .addStringOption((o) => o.setName('hint_interval').setDescription('Tid mellem hints, fx 2m').setMaxLength(20))
      .addIntegerOption((o) => o.setName('hint_interval_stoerrelse').setDescription('Størrelse på første hint-interval (halveres for hvert hint)').setMinValue(2))
      .addBooleanOption((o) => o.setName('hoejere_lavere').setDescription('Svar "højere/lavere" på forkerte gæt'))
      .addBooleanOption((o) => o.setName('manuelt_tal').setDescription('Vælg selv tallet i en privat formular'))
      .addBooleanOption((o) => o.setName('skjul_interval').setDescription('Skjul min/max-intervallet i beskeden'))
      .addBooleanOption((o) => o.setName('test').setDescription('Testtilstand: påvirker ikke statistik')),
  )
  .addSubcommand((s) => s.setName('stop').setDescription('Stop et talevent').addStringOption(idOpt))
  .addSubcommand((s) =>
    s
      .setName('reroll')
      .setDescription('Diskvalificér en vinder og genåbn eventet')
      .addStringOption(idOpt)
      .addUserOption((o) => o.setName('bruger').setDescription('Vinderen der skal erstattes'))
      .addIntegerOption((o) => o.setName('plads').setDescription('Pladsen der skal erstattes').setMinValue(1).setMaxValue(10))
      .addStringOption((o) => o.setName('varighed').setDescription('Hvor længe eventet genåbnes (standard 5m)').setMaxLength(20))
      .addStringOption((o) => o.setName('aarsag').setDescription('Årsag (vises i loggen)').setMaxLength(300)),
  )
  .addSubcommand((s) => s.setName('status').setDescription('Se status').addStringOption((o) => o.setName('id').setDescription('Event-ID (tom = alle aktive)').setAutocomplete(true)))
  .addSubcommand((s) => s.setName('history').setDescription('Se tidligere talevents'));

async function launch(i: ChatInputCommandInteraction, ctx: CommandContext, secret: number | null, reply: (p: any) => Promise<unknown>) {
  const dur = i.options.getString('varighed');
  const durationSec = dur ? parseDuration(dur) : 600;
  if (!durationSec) throw new UserError('Ugyldig varighed. Brug fx `10m` eller `1t`.');
  const hi = i.options.getString('hint_interval');
  const hintInterval = hi ? parseDuration(hi) : null;
  if (hi && !hintInterval) throw new UserError('Ugyldig hint-interval. Brug fx `2m`.');
  const ch = i.options.getChannel('kanal');
  const ev = await startNumberEvent({
    guildId: i.guildId!,
    actor: ctx.actor,
    channelId: ch?.id ?? ctx.settings.numberChannelId ?? i.channelId,
    prize: i.options.getString('praemie', true),
    min: i.options.getInteger('min') ?? 1,
    max: i.options.getInteger('max') ?? 10000,
    number: secret,
    durationSec,
    winnerCount: i.options.getInteger('vindere') ?? 1,
    prizes: (i.options.getString('praemier') ?? '').split('|'),
    hintCount: i.options.getInteger('hints') ?? 0,
    hintIntervalSec: hintInterval,
    hintRange: i.options.getInteger('hint_interval_stoerrelse'),
    higherLower: i.options.getBoolean('hoejere_lavere') ?? false,
    showRange: !(i.options.getBoolean('skjul_interval') ?? false),
    test: i.options.getBoolean('test') ?? false,
  });
  await reply({ embeds: [okEmbed(`Talevent **${ev.code}** er startet i <#${ev.channelId}>.\nVarighed: ${fmtDurationLong(ev.durationSec)}${ev.isTest ? '\n🧪 Testtilstand' : ''}`, '🎯 TALEVENT STARTET')] });
}

export const numberEventCommand: Command = {
  data,
  async autocomplete(i, ctx) {
    await autocompleteEvents(i, ctx, 'NUMBER');
  },
  async execute(i, ctx) {
    const sub = i.options.getSubcommand();
    const gid = i.guildId!;
    if (sub === 'start') {
      if (i.options.getBoolean('manuelt_tal')) {
        const min = i.options.getInteger('min') ?? 1;
        const max = i.options.getInteger('max') ?? 10000;
        const modalId = `nmod:${i.id}`;
        const modal = new ModalBuilder().setCustomId(modalId).setTitle('Hemmeligt tal').addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder().setCustomId('number').setLabel(`Skriv tallet (${min} til ${max})`).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(12),
          ),
        );
        await i.showModal(modal);
        const sub2 = await i.awaitModalSubmit({ time: 5 * 60_000, filter: (m) => m.customId === modalId && m.user.id === i.user.id }).catch(() => null);
        if (!sub2) return;
        await sub2.deferReply({ flags: EPH });
        try {
          const raw = sub2.fields.getTextInputValue('number').trim();
          if (!/^-?\d+$/.test(raw)) throw new UserError('Tallet skal være et helt tal.');
          await launch(i, ctx, Number(raw), (p) => sub2.editReply(p));
        } catch (e) {
          await sub2.editReply({ embeds: [errEmbed(await explainError(e, gid))] });
        }
        return;
      }
      await i.deferReply({ flags: EPH });
      await launch(i, ctx, null, (p) => i.editReply(p));
      return;
    }
    if (sub === 'stop') {
      const ev = await requireEvent(gid, i.options.getString('id', true), 'NUMBER');
      if (!(await confirmAction(i, { title: 'Stop talevent', description: `Vil du stoppe **${ev.code}** (${ev.prize})? Tallet bliver afsløret i kanalen.` }))) return;
      await stopNumberEvent(gid, ev.code, ctx.actor);
      await i.editReply({ embeds: [okEmbed(`**${ev.code}** er stoppet.`, '🛑 TALEVENT STOPPET')], components: [] });
      return;
    }
    if (sub === 'reroll') {
      const ev = await requireEvent(gid, i.options.getString('id', true), 'NUMBER');
      const dur = i.options.getString('varighed');
      const durationSec = dur ? parseDuration(dur) : 300;
      if (!durationSec) throw new UserError('Ugyldig varighed. Brug fx `5m`.');
      if (!(await confirmAction(i, { title: 'Reroll talevent', description: `Vil du diskvalificere en vinder af **${ev.code}** og genåbne eventet i ${fmtDurationLong(durationSec)}?`, confirmLabel: 'Ja, genåbn' }))) return;
      await rerollNumberEvent(gid, ev.code, ctx.actor, { userId: i.options.getUser('bruger')?.id, place: i.options.getInteger('plads'), durationSec, reason: i.options.getString('aarsag') });
      await i.editReply({ embeds: [okEmbed(`**${ev.code}** er genåbnet.`, '🔄 TALEVENT GENÅBNET')], components: [] });
      return;
    }
    await i.deferReply({ flags: EPH });
    if (sub === 'status') {
      const code = i.options.getString('id');
      if (code) {
        const ev = await requireEvent(gid, code, 'NUMBER');
        await i.editReply({ embeds: [await eventInfo(ev, ctx.settings.timezone, ctx.level >= Level.HIGH_ADMIN)] });
      } else {
        const rows = await prisma.event.findMany({ where: { guildId: gid, type: 'NUMBER', status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, take: 15 });
        await i.editReply({ embeds: [infoEmbed(rows.length ? rows.map((r) => eventLine(r)).join('\n') : 'Der kører ingen talevents lige nu.', '🎯 Aktive talevents')] });
      }
      return;
    }
    const rows = await prisma.event.findMany({ where: { guildId: gid, type: 'NUMBER' }, orderBy: { createdAt: 'desc' }, take: 15 });
    await i.editReply({ embeds: [infoEmbed(rows.length ? rows.map((r) => eventLine(r, r.winnersFound ? `${r.winnersFound} vinder(e)` : undefined)).join('\n') : 'Ingen talevents endnu.', '📚 Talevent-historik')] });
  },
};
