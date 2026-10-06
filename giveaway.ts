import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { prisma } from '../../db';
import { Level } from '../../shared/constants';
import { UserError, isHttpUrl, isHexColor, isValidEmoji } from '../../shared/text';
import { fmtDurationLong, parseDuration, parseLocalDateTime, ts } from '../../shared/time';
import { errEmbed, giveawayEmbed, giveawayRow, infoEmbed, normalizeGiveawayConfig, okEmbed } from '../../services/embeds';
import {
  GiveawayPatch,
  cancelGiveaway,
  createGiveaway,
  editGiveaway,
  endGiveaway,
  makePreviewEvent,
  pauseGiveaway,
  requireEvent,
  rerollGiveaway,
  resumeGiveaway,
} from '../../services/giveaways';
import { readDefaults } from '../../services/settings';
import { TemplateData, deleteTemplate, getTemplate, listTemplates, saveTemplate } from '../../services/templates';
import type { Command, CommandContext } from '../types';
import { EPH, confirmAction, eventLine, explainError } from '../util';
import { addGiveawayOptions, autocompleteEvents, eventInfo, readDraft } from './shared';

const idOpt = (o: any) => o.setName('id').setDescription('Event-ID (fx EVENT-82941)').setRequired(true).setAutocomplete(true);

const data = new SlashCommandBuilder()
  .setName('giveaway')
  .setDescription('Administrer giveaways')
  .setDMPermission(false)
  .addSubcommand((s) => addGiveawayOptions(s.setName('start').setDescription('Start et nyt giveaway'), { channel: true, template: true, test: true }))
  .addSubcommand((s) =>
    addGiveawayOptions(
      s
        .setName('schedule')
        .setDescription('Planlæg et giveaway til en bestemt tid')
        .addStringOption((o) => o.setName('start').setDescription('Starttid, fx 18:00 eller 2026-10-05 18:00 (serverens tidszone)').setRequired(true).setMaxLength(30)),
      { channel: true, template: true, test: true },
    ),
  )
  .addSubcommand((s) => addGiveawayOptions(s.setName('preview').setDescription('Se præcis hvordan giveawayet kommer til at se ud'), { template: true, test: true }))
  .addSubcommand((s) => s.setName('end').setDescription('Afslut et giveaway nu og træk vindere').addStringOption(idOpt))
  .addSubcommand((s) => s.setName('cancel').setDescription('Annuller et giveaway (ingen vindere)').addStringOption(idOpt))
  .addSubcommand((s) => s.setName('pause').setDescription('Sæt et giveaway på pause').addStringOption(idOpt))
  .addSubcommand((s) => s.setName('resume').setDescription('Genoptag et pauset giveaway').addStringOption(idOpt))
  .addSubcommand((s) =>
    s
      .setName('reroll')
      .setDescription('Træk en eller flere nye vindere')
      .addStringOption(idOpt)
      .addIntegerOption((o) => o.setName('antal').setDescription('Antal nye vindere (standard 1)').setMinValue(1).setMaxValue(50))
      .addUserOption((o) => o.setName('erstat').setDescription('Erstat denne vinder med en ny'))
      .addBooleanOption((o) => o.setName('tillad_afviste').setDescription('Tillad tidligere afviste brugere (standard: nej)')),
  )
  .addSubcommand((s) =>
    s
      .setName('edit')
      .setDescription('Rediger et aktivt, pauset eller planlagt giveaway')
      .addStringOption(idOpt)
      .addStringOption((o) => o.setName('praemie').setDescription('Ny præmie').setMaxLength(250))
      .addIntegerOption((o) => o.setName('vindere').setDescription('Nyt antal vindere').setMinValue(1).setMaxValue(50))
      .addStringOption((o) => o.setName('slutter_om').setDescription('Ny tid til slut fra nu, fx 2t').setMaxLength(20))
      .addStringOption((o) => o.setName('titel').setDescription('Ny titel').setMaxLength(200))
      .addStringOption((o) => o.setName('beskrivelse').setDescription('Ny beskrivelse').setMaxLength(1500))
      .addStringOption((o) => o.setName('footer').setDescription('Ny footer').setMaxLength(100))
      .addStringOption((o) => o.setName('thumbnail').setDescription('Nyt thumbnail-link').setMaxLength(500))
      .addStringOption((o) => o.setName('billede').setDescription('Nyt billede-link').setMaxLength(500))
      .addStringOption((o) => o.setName('farve').setDescription('Ny hex-farve').setMaxLength(7))
      .addStringOption((o) => o.setName('knap_tekst').setDescription('Ny knaptekst').setMaxLength(80))
      .addStringOption((o) => o.setName('knap_emoji').setDescription('Ny knap-emoji').setMaxLength(60))
      .addStringOption((o) => o.setName('vinder_besked').setDescription('Ny vinderbesked').setMaxLength(1000))
      .addRoleOption((o) => o.setName('kraev_rolle').setDescription('Tilføj/fjern påkrævet rolle (vælg igen for at fjerne)'))
      .addRoleOption((o) => o.setName('blokeret_rolle').setDescription('Tilføj/fjern blokeret rolle (vælg igen for at fjerne)'))
      .addRoleOption((o) => o.setName('bonus_rolle').setDescription('Rolle med bonus-entries'))
      .addIntegerOption((o) => o.setName('bonus_entries').setDescription('Entries for bonus-rollen (0 fjerner den)').setMinValue(0).setMaxValue(1000))
      .addIntegerOption((o) => o.setName('max_entries').setDescription('Maks. entries pr. bruger (0 = ingen grænse)').setMinValue(0).setMaxValue(1000000))
      .addIntegerOption((o) => o.setName('min_konto_dage').setDescription('Mindste kontoalder (dage)').setMinValue(0).setMaxValue(3650))
      .addIntegerOption((o) => o.setName('min_server_dage').setDescription('Mindste tid på serveren (dage)').setMinValue(0).setMaxValue(3650))
      .addIntegerOption((o) => o.setName('min_beskeder').setDescription('Mindste antal beskeder').setMinValue(0).setMaxValue(1000000)),
  )
  .addSubcommand((s) =>
    s
      .setName('customize')
      .setDescription('Tilpas udseendet med en formular')
      .addStringOption(idOpt)
      .addStringOption((o) =>
        o.setName('del').setDescription('Hvad vil du tilpasse?').setRequired(true).addChoices({ name: 'Embed (titel, tekst, footer, billeder)', value: 'embed' }, { name: 'Knap og vinderbesked', value: 'knap' }),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('list')
      .setDescription('Vis giveaways')
      .addStringOption((o) =>
        o.setName('status').setDescription('Filter (standard: aktive)').addChoices(
          { name: 'Aktive, pausede og planlagte', value: 'live' },
          { name: 'Afsluttede', value: 'ENDED' },
          { name: 'Annullerede', value: 'CANCELLED' },
          { name: 'Alle', value: 'all' },
        ),
      ),
  )
  .addSubcommand((s) => s.setName('info').setDescription('Vis alle detaljer om et giveaway').addStringOption(idOpt))
  .addSubcommandGroup((g) =>
    g
      .setName('template')
      .setDescription('Giveaway-skabeloner')
      .addSubcommand((s) =>
        addGiveawayOptions(
          s.setName('create').setDescription('Gem en skabelon').addStringOption((o) => o.setName('navn').setDescription('Skabelonens navn, fx VIP').setRequired(true).setMaxLength(32)),
        ),
      )
      .addSubcommand((s) => s.setName('list').setDescription('Vis alle skabeloner'))
      .addSubcommand((s) =>
        s.setName('delete').setDescription('Slet en skabelon').addStringOption((o) => o.setName('skabelon').setDescription('Skabelonens navn').setRequired(true).setAutocomplete(true)),
      ),
  );

const mergeConfig = (a: any = {}, b: any = {}) => ({ ...a, ...b, embed: { ...(a.embed ?? {}), ...(b.embed ?? {}) } });

async function buildInput(i: ChatInputCommandInteraction, ctx: CommandContext) {
  const draft = readDraft(i);
  let base: TemplateData | null = null;
  const tn = i.options.getString('skabelon');
  if (tn) base = (await getTemplate(i.guildId!, tn)).data;
  const prize = draft.prize ?? base?.prize;
  if (!prize) throw new UserError('Du skal angive en præmie (eller bruge en skabelon der indeholder en).');
  const d = readDefaults(ctx.settings);
  return {
    guildId: i.guildId!,
    actor: ctx.actor,
    prize,
    durationSec: draft.durationSec ?? base?.durationSec ?? d.durationSec,
    winnerCount: draft.winnerCount ?? base?.winnerCount ?? d.winnerCount,
    channelId: draft.channelId ?? ctx.settings.giveawayChannelId ?? i.channelId,
    config: mergeConfig(base?.config, draft.config),
    test: i.options.getBoolean('test') ?? false,
  };
}

async function handleStart(i: ChatInputCommandInteraction, ctx: CommandContext) {
  await i.deferReply({ flags: EPH });
  const ev = await createGiveaway(await buildInput(i, ctx));
  await i.editReply({ embeds: [okEmbed(`Giveaway **${ev.code}** er startet i <#${ev.channelId}> og slutter ${ts(ev.endsAt!, 'R')}.${ev.isTest ? '\n🧪 Testtilstand er slået til for dette giveaway.' : ''}`, '🎁 GIVEAWAY STARTET')] });
}

async function handleSchedule(i: ChatInputCommandInteraction, ctx: CommandContext) {
  await i.deferReply({ flags: EPH });
  const when = parseLocalDateTime(i.options.getString('start', true), ctx.settings.timezone);
  if (!when) throw new UserError('Jeg kunne ikke forstå starttiden. Brug fx `18:00` eller `2026-10-05 18:00`.');
  if (when.getTime() < Date.now() + 5000) throw new UserError('Starttiden skal ligge i fremtiden.');
  const ev = await createGiveaway({ ...(await buildInput(i, ctx)), startsAt: when });
  await i.editReply({ embeds: [okEmbed(`Giveaway **${ev.code}** er planlagt til ${ts(when, 'F')} (${ts(when, 'R')}) i <#${ev.channelId}>.\nTidszone: \`${ctx.settings.timezone}\``, '⏰ GIVEAWAY PLANLAGT')] });
}

async function handlePreview(i: ChatInputCommandInteraction, ctx: CommandContext) {
  await i.deferReply({ flags: EPH });
  const inp = await buildInput(i, ctx);
  const cfg = normalizeGiveawayConfig(inp.config, readDefaults(ctx.settings));
  const ev = makePreviewEvent({ ...inp, hostId: i.user.id, config: cfg });
  await i.editReply({
    content: '👀 **Forhåndsvisning** – sådan kommer giveawayet til at se ud (knapperne er slået fra her):',
    embeds: [giveawayEmbed(ev, { entries: 0, participants: 0 })],
    components: [giveawayRow(ev, true)],
  });
}

async function handleEdit(i: ChatInputCommandInteraction, actor: CommandContext['actor']) {
  await i.deferReply({ flags: EPH });
  const ev = await requireEvent(i.guildId!, i.options.getString('id', true), 'GIVEAWAY');
  const cur = normalizeGiveawayConfig(ev.config);
  const patch: GiveawayPatch = { config: { embed: {} } };
  const s = (n: string) => i.options.getString(n);
  const embed = patch.config!.embed as Record<string, any>;
  const prize = s('praemie');
  if (prize) patch.prize = prize;
  const w = i.options.getInteger('vindere');
  if (w) patch.winnerCount = w;
  const ends = s('slutter_om');
  if (ends) {
    const sec = parseDuration(ends);
    if (!sec) throw new UserError('Ugyldig varighed. Brug fx `30m`, `2t` eller `1d`.');
    patch.endsInSec = sec;
  }
  for (const [opt, key] of [['titel', 'title'], ['beskrivelse', 'description'], ['footer', 'footer'], ['knap_tekst', 'buttonLabel']] as const) {
    const v = s(opt);
    if (v) embed[key] = v;
  }
  const th = s('thumbnail');
  if (th) { if (!isHttpUrl(th)) throw new UserError('Thumbnail skal være et gyldigt https-link.'); embed.thumbnail = th; }
  const im = s('billede');
  if (im) { if (!isHttpUrl(im)) throw new UserError('Billedet skal være et gyldigt https-link.'); embed.image = im; }
  const col = s('farve');
  if (col) { if (!isHexColor(col)) throw new UserError('Farven skal være en hex-kode, fx #e11d2e'); embed.color = col; }
  const em = s('knap_emoji');
  if (em) { if (!isValidEmoji(em)) throw new UserError('Knap-emojien er ikke gyldig.'); embed.buttonEmoji = em; }
  const wm = s('vinder_besked');
  if (wm) patch.config!.winnerMessage = wm;
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const rr = i.options.getRole('kraev_rolle');
  if (rr) patch.config!.requiredRoles = toggle(cur.requiredRoles, rr.id);
  const br = i.options.getRole('blokeret_rolle');
  if (br) patch.config!.blacklistedRoles = toggle(cur.blacklistedRoles, br.id);
  const bonus = i.options.getRole('bonus_rolle');
  if (bonus) {
    const n = i.options.getInteger('bonus_entries') ?? 2;
    const rest = cur.bonusRoles.filter((b) => b.roleId !== bonus.id);
    patch.config!.bonusRoles = n > 0 ? [...rest, { roleId: bonus.id, entries: n }] : rest;
  }
  for (const [opt, key] of [['max_entries', 'maxEntries'], ['min_konto_dage', 'minAccountAgeDays'], ['min_server_dage', 'minServerDays'], ['min_beskeder', 'minMessages']] as const) {
    const v = i.options.getInteger(opt);
    if (v !== null) patch.config![key] = v;
  }
  const hasChange = patch.prize || patch.winnerCount || patch.endsInSec || Object.keys(embed).length || Object.keys(patch.config!).length > 1;
  if (!hasChange) throw new UserError('Du har ikke valgt noget at ændre.');
  const upd = await editGiveaway(i.guildId!, ev.code, patch, actor);
  await i.editReply({ embeds: [okEmbed(`**${upd.code}** er opdateret.`, '✏️ GIVEAWAY REDIGERET')] });
}

async function handleCustomize(i: ChatInputCommandInteraction, ctx: CommandContext) {
  const ev = await requireEvent(i.guildId!, i.options.getString('id', true), 'GIVEAWAY');
  if (ev.status === 'ENDED' || ev.status === 'CANCELLED') throw new UserError('Afsluttede giveaways kan ikke redigeres.');
  const cfg = normalizeGiveawayConfig(ev.config);
  const part = i.options.getString('del', true);
  const modalId = `gwmod:${i.id}`;
  const input = (id: string, label: string, style: TextInputStyle, value: string | null, max: number) => {
    const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(false).setMaxLength(max);
    if (value) t.setValue(value.slice(0, max));
    return new ActionRowBuilder<TextInputBuilder>().addComponents(t);
  };
  const modal = new ModalBuilder().setCustomId(modalId).setTitle(part === 'embed' ? 'Tilpas embed' : 'Tilpas knap og vinderbesked');
  if (part === 'embed') {
    modal.addComponents(
      input('title', 'Titel (tom = standard)', TextInputStyle.Short, cfg.embed.title, 200),
      input('description', 'Beskrivelse', TextInputStyle.Paragraph, cfg.embed.description, 1500),
      input('footer', 'Footer', TextInputStyle.Short, cfg.embed.footer, 100),
      input('thumbnail', 'Thumbnail-link (https://...)', TextInputStyle.Short, cfg.embed.thumbnail, 500),
      input('image', 'Billede-link (https://...)', TextInputStyle.Short, cfg.embed.image, 500),
    );
  } else {
    modal.addComponents(
      input('buttonLabel', 'Knaptekst', TextInputStyle.Short, cfg.embed.buttonLabel, 80),
      input('buttonEmoji', 'Knap-emoji', TextInputStyle.Short, cfg.embed.buttonEmoji, 60),
      input('color', 'Farve (hex, fx #e11d2e)', TextInputStyle.Short, cfg.embed.color, 7),
      input('winnerMessage', 'Vinderbesked ({winners} {prize})', TextInputStyle.Paragraph, cfg.winnerMessage, 1000),
    );
  }
  await i.showModal(modal);
  const sub = await i.awaitModalSubmit({ time: 5 * 60_000, filter: (m) => m.customId === modalId && m.user.id === i.user.id }).catch(() => null);
  if (!sub) return;
  await sub.deferReply({ flags: EPH });
  try {
    const val = (k: string) => sub.fields.getTextInputValue(k).trim();
    const embed: Record<string, any> = {};
    const config: Record<string, any> = { embed };
    if (part === 'embed') {
      for (const k of ['title', 'description', 'footer', 'thumbnail', 'image']) embed[k] = val(k) || null;
      for (const k of ['thumbnail', 'image']) if (embed[k] && !isHttpUrl(embed[k])) throw new UserError(`${k === 'image' ? 'Billedet' : 'Thumbnail'} skal være et gyldigt https-link.`);
    } else {
      embed.buttonLabel = val('buttonLabel') || null;
      embed.buttonEmoji = val('buttonEmoji') || null;
      embed.color = val('color') || null;
      config.winnerMessage = val('winnerMessage') || null;
      if (embed.buttonEmoji && !isValidEmoji(embed.buttonEmoji)) throw new UserError('Knap-emojien er ikke gyldig. Brug én emoji, fx 🎉');
      if (embed.color && !isHexColor(embed.color)) throw new UserError('Farven skal være en hex-kode, fx #e11d2e');
    }
    await editGiveaway(i.guildId!, ev.code, { config }, ctx.actor);
    await sub.editReply({ embeds: [okEmbed(`**${ev.code}** er opdateret. Beskeden i kanalen er blevet ændret.`, '🎨 TILPASNING GEMT')] });
  } catch (e) {
    await sub.editReply({ embeds: [errEmbed(await explainError(e, i.guildId))] });
  }
}

export const giveawayCommand: Command = {
  data,
  async autocomplete(i, ctx) {
    await autocompleteEvents(i, ctx, 'GIVEAWAY');
  },
  async execute(i, ctx) {
    const group = i.options.getSubcommandGroup(false);
    const sub = i.options.getSubcommand();
    const gid = i.guildId!;
    if (group === 'template') {
      if (sub === 'create') {
        await i.deferReply({ flags: EPH });
        const draft = readDraft(i);
        await saveTemplate(gid, i.options.getString('navn', true), { prize: draft.prize, durationSec: draft.durationSec, winnerCount: draft.winnerCount, config: draft.config }, ctx.actor);
        await i.editReply({ embeds: [okEmbed(`Skabelonen **${i.options.getString('navn', true)}** er gemt. Brug den med \`/giveaway start skabelon:${i.options.getString('navn', true)}\`.`, '📋 SKABELON GEMT')] });
      } else if (sub === 'list') {
        await i.deferReply({ flags: EPH });
        const t = await listTemplates(gid);
        await i.editReply({ embeds: [infoEmbed(t.length ? t.map((x) => `• **${x.name}**`).join('\n') : 'Der er ingen skabeloner endnu. Opret en med `/giveaway template create`.', '📋 Skabeloner')] });
      } else {
        await i.deferReply({ flags: EPH });
        await deleteTemplate(gid, i.options.getString('skabelon', true), ctx.actor);
        await i.editReply({ embeds: [okEmbed('Skabelonen er slettet.')] });
      }
      return;
    }
    switch (sub) {
      case 'start': return handleStart(i, ctx);
      case 'schedule': return handleSchedule(i, ctx);
      case 'preview': return handlePreview(i, ctx);
      case 'edit': return handleEdit(i, ctx.actor);
      case 'customize': return handleCustomize(i, ctx);
      case 'end': {
        const ev = await requireEvent(gid, i.options.getString('id', true), 'GIVEAWAY');
        if (!(await confirmAction(i, { title: 'Afslut giveaway', description: `Vil du afslutte **${ev.code}** (${ev.prize}) nu?\nVinderne trækkes med det samme.` }))) return;
        const winners = await endGiveaway(gid, ev.code, ctx.actor, 'Afsluttet manuelt');
        await i.editReply({ embeds: [okEmbed(winners.length ? `**${ev.code}** er afsluttet. Vindere: ${winners.map((w) => `<@${w}>`).join(', ')}` : `**${ev.code}** er afsluttet, men der kunne ikke findes en gyldig vinder.`, '🏁 GIVEAWAY AFSLUTTET')], components: [] });
        return;
      }
      case 'cancel': {
        const ev = await requireEvent(gid, i.options.getString('id', true), 'GIVEAWAY');
        if (!(await confirmAction(i, { title: 'Annuller giveaway', description: `Vil du annullere **${ev.code}** (${ev.prize})?\nDer trækkes ingen vindere.` }))) return;
        await cancelGiveaway(gid, ev.code, ctx.actor);
        await i.editReply({ embeds: [okEmbed(`**${ev.code}** er annulleret.`, '🛑 GIVEAWAY ANNULLERET')], components: [] });
        return;
      }
      case 'pause': {
        await i.deferReply({ flags: EPH });
        const ev = await pauseGiveaway(gid, i.options.getString('id', true), ctx.actor);
        await i.editReply({ embeds: [okEmbed(`**${ev.code}** er sat på pause. Der er ${fmtDurationLong(ev.remainingSec ?? 0)} tilbage.`, '⏸️ PAUSET')] });
        return;
      }
      case 'resume': {
        await i.deferReply({ flags: EPH });
        const ev = await resumeGiveaway(gid, i.options.getString('id', true), ctx.actor);
        await i.editReply({ embeds: [okEmbed(`**${ev.code}** er genoptaget og slutter ${ts(ev.endsAt!, 'R')}.`, '▶️ GENOPTAGET')] });
        return;
      }
      case 'reroll': {
        const ev = await requireEvent(gid, i.options.getString('id', true), 'GIVEAWAY');
        const replace = i.options.getUser('erstat');
        const count = i.options.getInteger('antal') ?? 1;
        if (!(await confirmAction(i, { title: 'Reroll vindere', description: replace ? `Vil du erstatte <@${replace.id}> som vinder af **${ev.code}**?` : `Vil du trække **${count}** ny(e) vinder(e) til **${ev.code}**?`, confirmLabel: 'Ja, reroll' }))) return;
        const winners = await rerollGiveaway(gid, ev.code, ctx.actor, { count, allowRejected: i.options.getBoolean('tillad_afviste') ?? false, replaceUserId: replace?.id });
        await i.editReply({ embeds: [okEmbed(`Nye vindere: ${winners.map((w) => `<@${w}>`).join(', ')}`, '🔄 REROLL GENNEMFØRT')], components: [] });
        return;
      }
      case 'list': {
        await i.deferReply({ flags: EPH });
        const f = i.options.getString('status') ?? 'live';
        const rows = await prisma.event.findMany({
          where: { guildId: gid, type: 'GIVEAWAY', ...(f === 'live' ? { status: { in: ['ACTIVE', 'PAUSED', 'SCHEDULED'] as any } } : f === 'all' ? {} : { status: f as any }) },
          orderBy: { createdAt: 'desc' },
          take: 15,
        });
        await i.editReply({ embeds: [infoEmbed(rows.length ? rows.map((r) => eventLine(r)).join('\n') : 'Ingen giveaways fundet.', '🎁 Giveaways')] });
        return;
      }
      case 'info': {
        await i.deferReply({ flags: EPH });
        const ev = await requireEvent(gid, i.options.getString('id', true), 'GIVEAWAY');
        await i.editReply({ embeds: [await eventInfo(ev, ctx.settings.timezone, ctx.level >= Level.HIGH_ADMIN)] });
        return;
      }
    }
  },
};

