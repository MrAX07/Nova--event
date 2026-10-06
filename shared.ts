import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandSubcommandBuilder,
  SlashCommandSubcommandGroupBuilder,
} from 'discord.js';
import { prisma } from '../../db';
import { Level } from '../../shared/constants';
import { hexToInt, isHexColor, isHttpUrl, isValidEmoji, UserError } from '../../shared/text';
import { parseDuration } from '../../shared/time';
import { statusIcon } from '../util';
import type { CommandContext } from '../types';

/** Auto-udfyldning af event-ID'er (kun for staff, kun på denne server). */
export async function autocompleteEvents(i: AutocompleteInteraction, ctx: CommandContext, type?: 'GIVEAWAY' | 'NUMBER'): Promise<void> {
  if (ctx.level < Level.MODERATOR || !i.guildId) return void (await i.respond([]));
  const focused = i.options.getFocused(true);
  const q = String(focused.value).trim();
  if (focused.name === 'skabelon') {
    const t = await prisma.template.findMany({ where: { guildId: i.guildId, name: { contains: q, mode: 'insensitive' } }, take: 25, orderBy: { name: 'asc' } });
    return void (await i.respond(t.map((x) => ({ name: x.name, value: x.name }))));
  }
  const rows = await prisma.event.findMany({
    where: {
      guildId: i.guildId,
      ...(type ? { type } : {}),
      ...(q ? { OR: [{ code: { contains: q.toUpperCase() } }, { prize: { contains: q, mode: 'insensitive' } }] } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 25,
  });
  await i.respond(rows.map((r) => ({ name: `${statusIcon(r.status)} ${r.code} — ${r.prize}`.slice(0, 100), value: r.code })));
}

/** Tilføjer de fælles giveaway-valg (maks. 24 stk.) til en underkommando. */
export function addGiveawayOptions<T extends SlashCommandSubcommandBuilder>(sub: T, opts: { channel?: boolean; template?: boolean; test?: boolean } = {}): T {
  sub.addStringOption((o) => o.setName('praemie').setDescription('Hvad bliver der givet væk?').setMaxLength(250));
  sub.addStringOption((o) => o.setName('varighed').setDescription('Fx 30m, 2t, 1d, 1d12h').setMaxLength(20));
  sub.addIntegerOption((o) => o.setName('vindere').setDescription('Antal vindere (1-50)').setMinValue(1).setMaxValue(50));
  if (opts.channel) sub.addChannelOption((o) => o.setName('kanal').setDescription('Kanal giveawayet sendes i (standard: giveaway-kanalen)'));
  sub.addRoleOption((o) => o.setName('kraev_rolle').setDescription('Deltagere skal have denne rolle'));
  sub.addRoleOption((o) => o.setName('blokeret_rolle').setDescription('Medlemmer med denne rolle må ikke deltage'));
  sub.addIntegerOption((o) => o.setName('min_konto_dage').setDescription('Mindste alder på Discord-konto (dage)').setMinValue(0).setMaxValue(3650));
  sub.addIntegerOption((o) => o.setName('min_server_dage').setDescription('Mindste tid på serveren (dage)').setMinValue(0).setMaxValue(3650));
  sub.addIntegerOption((o) => o.setName('min_beskeder').setDescription('Mindste antal sendte beskeder').setMinValue(0).setMaxValue(1000000));
  sub.addBooleanOption((o) => o.setName('stemmekanal').setDescription('Kræv at deltageren sidder i en stemmekanal'));
  sub.addIntegerOption((o) => o.setName('max_entries').setDescription('Maks. entries pr. bruger (0 = ingen grænse)').setMinValue(0).setMaxValue(1000000));
  sub.addRoleOption((o) => o.setName('bonus_rolle').setDescription('Rolle der giver ekstra entries'));
  sub.addIntegerOption((o) => o.setName('bonus_entries').setDescription('Antal entries for bonus-rollen').setMinValue(1).setMaxValue(1000));
  sub.addStringOption((o) => o.setName('titel').setDescription('Egen titel (kan bruge {prize})').setMaxLength(200));
  sub.addStringOption((o) => o.setName('beskrivelse').setDescription('Egen beskrivelse').setMaxLength(1500));
  sub.addStringOption((o) => o.setName('footer').setDescription('Egen footer-tekst').setMaxLength(100));
  sub.addStringOption((o) => o.setName('thumbnail').setDescription('Link til thumbnail-billede (https://...)').setMaxLength(500));
  sub.addStringOption((o) => o.setName('billede').setDescription('Link til stort billede (https://...)').setMaxLength(500));
  sub.addStringOption((o) => o.setName('farve').setDescription('Hex-farve, fx #e11d2e').setMaxLength(7));
  sub.addStringOption((o) => o.setName('knap_tekst').setDescription('Tekst på deltag-knappen').setMaxLength(80));
  sub.addStringOption((o) => o.setName('knap_emoji').setDescription('Emoji på deltag-knappen').setMaxLength(60));
  sub.addStringOption((o) => o.setName('vinder_besked').setDescription('Egen vinderbesked (kan bruge {winners} {prize})').setMaxLength(1000));
  if (opts.template) sub.addStringOption((o) => o.setName('skabelon').setDescription('Brug en gemt skabelon').setAutocomplete(true));
  if (opts.test) sub.addBooleanOption((o) => o.setName('test').setDescription('Testtilstand: påvirker ikke statistik, ingen roller/DM'));
  return sub;
}

export interface Draft {
  prize?: string;
  durationSec?: number;
  winnerCount?: number;
  channelId?: string;
  config: Record<string, any>;
}

/** Læser de fælles valg fra en kommando og bygger en kladde. */
export function readDraft(i: ChatInputCommandInteraction): Draft {
  const d: Draft = { config: { embed: {} } };
  const g = (n: string) => i.options.getString(n);
  const prize = g('praemie');
  if (prize) d.prize = prize;
  const dur = g('varighed');
  if (dur) {
    const s = parseDuration(dur);
    if (!s) throw new UserError('Ugyldig varighed. Brug fx `30m`, `2t`, `1d` eller `1d12h`.');
    d.durationSec = s;
  }
  const w = i.options.getInteger('vindere');
  if (w) d.winnerCount = w;
  const ch = i.options.getChannel('kanal');
  if (ch) d.channelId = ch.id;
  const c = d.config;
  const rr = i.options.getRole('kraev_rolle');
  if (rr) c.requiredRoles = [rr.id];
  const br = i.options.getRole('blokeret_rolle');
  if (br) c.blacklistedRoles = [br.id];
  const n = (name: string, key: string) => {
    const v = i.options.getInteger(name);
    if (v !== null) c[key] = v;
  };
  n('min_konto_dage', 'minAccountAgeDays');
  n('min_server_dage', 'minServerDays');
  n('min_beskeder', 'minMessages');
  n('max_entries', 'maxEntries');
  const vc = i.options.getBoolean('stemmekanal');
  if (vc !== null) c.voiceRequired = vc;
  const bonusRole = i.options.getRole('bonus_rolle');
  if (bonusRole) c.bonusRoles = [{ roleId: bonusRole.id, entries: i.options.getInteger('bonus_entries') ?? 2 }];
  const e = c.embed as Record<string, any>;
  const set = (opt: string, key: string, check?: (v: string) => boolean, err?: string) => {
    const v = g(opt);
    if (v === null) return;
    if (check && !check(v)) throw new UserError(err ?? `Ugyldig værdi for ${opt}.`);
    e[key] = v;
  };
  set('titel', 'title');
  set('beskrivelse', 'description');
  set('footer', 'footer');
  set('thumbnail', 'thumbnail', isHttpUrl, 'Thumbnail skal være et gyldigt link der starter med https://');
  set('billede', 'image', isHttpUrl, 'Billedet skal være et gyldigt link der starter med https://');
  set('farve', 'color', isHexColor, 'Farven skal være en hex-kode, fx #e11d2e');
  set('knap_tekst', 'buttonLabel');
  set('knap_emoji', 'buttonEmoji', isValidEmoji, 'Knap-emojien er ikke gyldig. Brug én emoji, fx 🎉');
  const wm = g('vinder_besked');
  if (wm) c.winnerMessage = wm;
  return d;
}
export { hexToInt };
export type { SlashCommandSubcommandGroupBuilder };

import type { Event as EventRow } from '@prisma/client';
import { getStats } from '../../services/giveaways';
import { eventInfoEmbed } from '../util';

export async function eventInfo(ev: EventRow, tz: string, showSecret: boolean) {
  const [stats, winners] = await Promise.all([getStats(ev.id), prisma.winner.findMany({ where: { eventId: ev.id }, orderBy: { place: 'asc' } })]);
  return eventInfoEmbed(ev, tz, stats, winners, `<@${ev.hostId}>`, showSecret);
}
