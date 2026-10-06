import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  Interaction,
  MessageFlags,
} from 'discord.js';
import type { Event as EventRow } from '@prisma/client';
import { COLORS } from '../shared/constants';
import { fmtDateTime, ts } from '../shared/time';
import { truncate } from '../shared/text';
import { errEmbed, infoEmbed } from '../services/embeds';

export const EPH = MessageFlags.Ephemeral;

type Replyable = Pick<Interaction, 'id'> & { deferred: boolean; replied: boolean } & Record<string, any>;

/** Replies, or edits the reply if one was already started. */
export async function respond(i: Replyable, payload: Record<string, any>): Promise<void> {
  if (i.deferred || i.replied) await i.editReply(payload);
  else await i.reply({ flags: EPH, ...payload });
}

/** Shows a confirm / cancel prompt (ephemeral). Resolves true only if the same user presses Confirm. */
export async function confirmAction(
  i: ChatInputCommandInteraction,
  opts: { title: string; description: string; confirmLabel?: string; danger?: boolean },
): Promise<boolean> {
  const yes = `cf:yes:${i.id}`;
  const no = `cf:no:${i.id}`;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(yes).setLabel(opts.confirmLabel ?? 'Bekræft').setStyle(opts.danger === false ? ButtonStyle.Primary : ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(no).setLabel('Annuller').setStyle(ButtonStyle.Secondary),
  );
  const e = new EmbedBuilder().setColor(COLORS.PAUSED).setTitle(`⚠️ ${opts.title}`).setDescription(opts.description).setFooter({ text: 'Denne bekræftelse udløber om 60 sekunder.' });
  await i.reply({ embeds: [e], components: [row], flags: EPH });
  const msg = await i.fetchReply();
  try {
    const b = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 60_000, filter: (x) => x.user.id === i.user.id && (x.customId === yes || x.customId === no) });
    if (b.customId === yes) {
      await b.update({ embeds: [infoEmbed('⏳ Arbejder på det…')], components: [] });
      return true;
    }
    await b.update({ embeds: [infoEmbed('Annulleret. Intet blev ændret.')], components: [] });
    return false;
  } catch {
    await i.editReply({ embeds: [infoEmbed('Tiden udløb. Intet blev ændret.')], components: [] }).catch(() => undefined);
    return false;
  }
}

const STATUS_ICON: Record<string, string> = { ACTIVE: '🟢', PAUSED: '⏸️', SCHEDULED: '⏰', ENDED: '🏁', CANCELLED: '🛑' };
export const STATUS_DA: Record<string, string> = { ACTIVE: 'Aktiv', PAUSED: 'Pauset', SCHEDULED: 'Planlagt', ENDED: 'Afsluttet', CANCELLED: 'Annulleret' };
export const statusDa = (s: string): string => STATUS_DA[s] ?? s;
export const statusIcon = (s: string): string => STATUS_ICON[s] ?? '•';

export function eventLine(ev: EventRow, extra?: string): string {
  const when = ev.status === 'ACTIVE' && ev.endsAt ? `slutter ${ts(ev.endsAt)}` : ev.status === 'SCHEDULED' ? `starter ${ts(ev.startsAt)}` : ev.endedAt ? `sluttede ${ts(ev.endedAt)}` : statusDa(ev.status);
  return `${statusIcon(ev.status)} \`${ev.code}\` ${ev.type === 'NUMBER' ? '🎯' : '🎁'} **${truncate(ev.prize, 40)}** • ${when}${ev.isTest ? ' • 🧪' : ''}${extra ? ` • ${extra}` : ''}`;
}

export function eventInfoEmbed(
  ev: EventRow,
  tz: string,
  stats: { entries: number; participants: number },
  winners: { userId: string; place: number | null; status: string; rejectReason: string | null }[],
  host: string,
  showSecret: boolean,
): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(ev.status === 'ACTIVE' ? COLORS.BRAND : ev.status === 'CANCELLED' ? COLORS.CANCELLED : ev.status === 'PAUSED' ? COLORS.PAUSED : COLORS.ENDED)
    .setTitle(`${ev.type === 'NUMBER' ? '🎯' : '🎁'} ${ev.code}${ev.isTest ? ' 🧪' : ''}`)
    .addFields(
      { name: 'Præmie', value: truncate(ev.prize, 500) },
      { name: 'Status', value: `${statusIcon(ev.status)} ${statusDa(ev.status)}`, inline: true },
      { name: 'Type', value: ev.type === 'NUMBER' ? 'Talevent' : 'Giveaway', inline: true },
      { name: 'Vindere', value: String(ev.winnerCount), inline: true },
      { name: 'Deltagere', value: stats.participants.toLocaleString('en-US'), inline: true },
      { name: 'Entries', value: stats.entries.toLocaleString('en-US'), inline: true },
      { name: 'Vært', value: host, inline: true },
      { name: 'Kanal', value: `<#${ev.channelId}>`, inline: true },
      { name: 'Start', value: fmtDateTime(ev.startsAt, tz), inline: true },
      { name: 'Slut', value: ev.endedAt ? fmtDateTime(ev.endedAt, tz) : ev.endsAt ? fmtDateTime(ev.endsAt, tz) : '—', inline: true },
    );
  if (showSecret && ev.type === 'NUMBER' && ev.status === 'ACTIVE') e.addFields({ name: '🔒 Hemmeligt tal (kun staff)', value: `||${ev.secretNumber}||` });
  if (ev.type === 'NUMBER' && ev.status !== 'ACTIVE') e.addFields({ name: 'Tal', value: `\`${ev.secretNumber}\`` });
  const valid = winners.filter((w) => w.status === 'VALID');
  const rejected = winners.filter((w) => w.status === 'REJECTED');
  if (valid.length) e.addFields({ name: 'Vindere', value: truncate(valid.map((w) => `${w.place ? `#${w.place} ` : ''}<@${w.userId}>`).join('\n'), 1000) });
  if (rejected.length) e.addFields({ name: 'Afvist', value: truncate(rejected.map((w) => `<@${w.userId}> — ${w.rejectReason ?? 'afvist'}`).join('\n'), 1000) });
  return e;
}

export { errEmbed };

import { logError } from '../logger';
import { UserError } from '../shared/text';

/** Gør en fejl til en tekst vi trygt kan vise. Ukendte fejl logges og får en reference. */
export async function explainError(e: unknown, guildId?: string | null): Promise<string> {
  if (e instanceof UserError) return e.message;
  const ref = await logError('kommando', e, guildId);
  return `Noget gik galt${ref ? ` (reference \`${ref}\`)` : ''}. Prøv igen – hvis det bliver ved, så kontakt en højadmin.`;
}
