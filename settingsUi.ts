import { ActionRowBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import type { Guild as GuildSettings } from '@prisma/client';
import { env } from '../env';
import { COLORS, LOG_CATEGORIES } from '../shared/constants';
import { MESSAGE_DEFAULTS, MessageKey, UserError, getMessage } from '../shared/text';
import { fmtDuration, parseDuration } from '../shared/time';
import { GiveawayDefaults, readDefaults } from '../services/settings';

const row = (id: string, label: string, value: string, opts: { style?: TextInputStyle; max?: number; required?: boolean; placeholder?: string } = {}) => {
  const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(opts.style ?? TextInputStyle.Short).setRequired(opts.required ?? true).setMaxLength(opts.max ?? 100);
  if (value) t.setValue(value.slice(0, opts.max ?? 100));
  if (opts.placeholder) t.setPlaceholder(opts.placeholder);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(t);
};

export function defaultsModal(customId: string, s: GuildSettings): ModalBuilder {
  const d = readDefaults(s);
  return new ModalBuilder().setCustomId(customId).setTitle('Standard for giveaways').addComponents(
    row('duration', 'Standard varighed (fx 1t, 30m, 1d)', fmtDuration(d.durationSec).replace(/ /g, '').replace('h', 't')),
    row('winners', 'Antal vindere (1-50)', String(d.winnerCount)),
    row('perClick', 'Entries pr. klik (normalt 1)', String(d.entriesPerClick)),
    row('max', 'Maks. entries pr. bruger (0 = ingen grænse)', String(d.maxEntries)),
    row('mode', 'Bonus-roller: "hoejeste" eller "sum"', d.bonusMode === 'stack' ? 'sum' : 'hoejeste'),
  );
}

export function parseDefaultsModal(get: (k: string) => string): GiveawayDefaults {
  const duration = parseDuration(get('duration'));
  if (!duration || duration < 10 || duration > 90 * 86400) throw new UserError('Ugyldig varighed. Brug fx `1t`, `30m` eller `1d` (10 sekunder til 90 dage).');
  const int = (k: string, lo: number, hi: number, name: string) => {
    const v = Number(get(k));
    if (!Number.isInteger(v) || v < lo || v > hi) throw new UserError(`${name} skal være et helt tal mellem ${lo} og ${hi}.`);
    return v;
  };
  const mode = get('mode').trim().toLowerCase();
  if (!['hoejeste', 'højeste', 'sum', 'highest', 'stack'].includes(mode)) throw new UserError('Bonus-tilstand skal være `hoejeste` eller `sum`.');
  return {
    durationSec: duration,
    winnerCount: int('winners', 1, 50, 'Antal vindere'),
    entriesPerClick: int('perClick', 1, 1000, 'Entries pr. klik'),
    maxEntries: int('max', 0, 1_000_000, 'Maks. entries'),
    bonusMode: mode === 'sum' || mode === 'stack' ? 'stack' : 'highest',
  };
}

export function endingSoonModal(customId: string, s: GuildSettings): ModalBuilder {
  return new ModalBuilder().setCustomId(customId).setTitle('Slutter-snart besked').addComponents(
    row('times', 'Tider, adskilt med komma (tom = slået fra)', s.endingSoonSeconds.map((n) => fmtDuration(n).replace(/ /g, '').replace('h', 't')).join(', '), { required: false, placeholder: '5m, 1m, 30s' }),
  );
}

export function parseEndingSoon(input: string): number[] {
  const t = input.trim();
  if (!t || /^(slukket|fra|off|nej)$/i.test(t)) return [];
  const out = t.split(/[,;]+/).map((p) => parseDuration(p));
  if (out.some((n) => !n || n < 5 || n > 86400)) throw new UserError('Ugyldige tider. Brug fx `5m, 1m, 30s` (mellem 5 sekunder og 24 timer).');
  return [...new Set(out as number[])].sort((a, b) => b - a).slice(0, 6);
}

export function messageModal(customId: string, key: MessageKey, s: GuildSettings): ModalBuilder {
  const m = getMessage(s.messages, key);
  return new ModalBuilder().setCustomId(customId).setTitle(m.label.slice(0, 45)).addComponents(
    row('text', `Tekst (tom = standard) – ${m.vars}`.slice(0, 45), m.text, { style: TextInputStyle.Paragraph, max: 1500, required: false }),
    row('enabled', 'Slået til? (ja/nej)', m.enabled ? 'ja' : 'nej', { max: 3 }),
  );
}

export function settingsSummary(s: GuildSettings): EmbedBuilder {
  const ch = (id: string | null) => (id ? `<#${id}>` : '*ikke sat*');
  const roles = (ids: string[]) => (ids.length ? ids.map((r) => `<@&${r}>`).join(' ') : '*ikke sat*');
  const d = readDefaults(s);
  const per = (s.logChannels ?? {}) as Record<string, string>;
  const logLines = Object.keys(LOG_CATEGORIES).map((k) => {
    const off = s.disabledLogCategories.includes(k);
    const target = per[k] ? `<#${per[k]}>` : s.logChannelId ? `<#${s.logChannelId}>` : '—';
    return `${off ? '⚫' : '🟢'} ${LOG_CATEGORIES[k as keyof typeof LOG_CATEGORIES]}: ${off ? 'slået fra' : target}`;
  });
  const enabled = (Object.keys(MESSAGE_DEFAULTS) as MessageKey[]).filter((k) => getMessage(s.messages, k).enabled).length;
  return new EmbedBuilder()
    .setColor(COLORS.BRAND)
    .setTitle('⚙️ Nova Events – indstillinger')
    .addFields(
      { name: 'Kanaler', value: `🎁 Giveaways: ${ch(s.giveawayChannelId)}\n🎯 Talevents: ${ch(s.numberChannelId)}\n📜 Log (standard): ${ch(s.logChannelId)}` },
      { name: 'Logkategorier', value: logLines.join('\n') + `\n${s.logRoleChanges ? '🟢' : '⚫'} Log rolleændringer på medlemmer` },
      { name: 'Rettigheder', value: `👑 Ejer: ${roles(s.ownerRoleIds)}\n🛡️ Højadmin: ${roles(s.highAdminRoleIds)}\n🎪 Eventansvarlig: ${roles(s.eventManagerRoleIds)}\n🔍 Moderator: ${roles(s.moderatorRoleIds)}` },
      { name: 'Tickets', value: `Kategori: ${s.ticketCategoryId ? `<#${s.ticketCategoryId}>` : '*ikke sat*'}\nSupport-roller: ${roles(s.ticketSupportRoleIds)}\nPræmie-roller: ${roles(s.ticketPrizeRoleIds)}` },
      { name: 'Vinderrolle', value: s.winnerRoleId ? `<@&${s.winnerRoleId}>` : '*ikke sat*', inline: true },
      { name: 'Tidszone', value: `\`${s.timezone}\``, inline: true },
      { name: 'Testtilstand', value: s.testMode ? '🧪 Til' : 'Fra', inline: true },
      { name: 'Giveaway-standarder', value: `Varighed ${fmtDuration(d.durationSec)} • ${d.winnerCount} vinder(e) • ${d.entriesPerClick} entry pr. klik • maks. ${d.maxEntries || '∞'} • bonus: ${d.bonusMode === 'stack' ? 'sum' : 'højeste'}` },
      { name: 'Annonceringer', value: `${enabled}/${Object.keys(MESSAGE_DEFAULTS).length} beskeder er slået til\nSlutter-snart: ${s.endingSoonSeconds.length ? s.endingSoonSeconds.map(fmtDuration).join(', ') : 'slået fra'}` },
      { name: 'Kontrolpanel', value: `${s.dashboardEnabled ? '🟢 Aktivt' : '⚫ Slået fra'} — ${env.DASHBOARD_URL}` },
    );
}
