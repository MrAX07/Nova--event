import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ComponentType,
  EmbedBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { Guild as GuildSettings } from '@prisma/client';
import { env } from '../../env';
import { COLORS, Level, TIMEZONES } from '../../shared/constants';
import { MESSAGE_DEFAULTS, MessageKey, UserError, getMessage } from '../../shared/text';
import { isValidTimezone } from '../../shared/time';
import { getSettings } from '../../services/settings';
import { commitSettings } from '../../services/settingsAdmin';
import { explainError, EPH } from '../util';
import { canBootstrap } from '../../services/permissions';
import { defaultsModal, endingSoonModal, parseDefaultsModal, parseEndingSoon, settingsSummary } from '../settingsUi';
import type { Command } from '../types';

type Kind = 'channel' | 'roles' | 'role' | 'timezone' | 'defaults' | 'announcements' | 'dashboard';
interface Step {
  key: string;
  kind: Kind;
  title: string;
  desc: string;
  perm?: boolean;
}

const STEPS: Step[] = [
  { key: 'giveawayChannelId', kind: 'channel', title: 'Giveaway-kanal', desc: 'Hvor skal giveaways sendes som standard?' },
  { key: 'numberChannelId', kind: 'channel', title: 'Talevent-kanal', desc: 'Hvilken kanal skal botten overvåge til talevents som standard?' },
  { key: 'logChannelId', kind: 'channel', title: 'Log-kanal', desc: 'Her logges **alt**: entries, vindere, roller, ændringer og fejl.\nSenere kan du give hver kategori sin egen kanal med `/config logchannel`.' },
  { key: 'ownerRoleIds', kind: 'roles', title: 'Ejer-roller', desc: 'Roller med **fuld adgang**. (Serverens ejer er altid Ejer.)', perm: true },
  { key: 'highAdminRoleIds', kind: 'roles', title: 'Højadmin-roller', desc: 'Må ændre entries, redigere/afslutte/reroll giveaways, styre talevents og indstillinger.', perm: true },
  { key: 'eventManagerRoleIds', kind: 'roles', title: 'Eventansvarlig-roller', desc: 'Må oprette giveaways, pause/genoptage/afslutte og starte talevents. **Må ikke** ændre entries.', perm: true },
  { key: 'moderatorRoleIds', kind: 'roles', title: 'Moderator-roller', desc: 'Må se events, deltagere og grundlæggende statistik.', perm: true },
  { key: 'winnerRoleId', kind: 'role', title: 'Vinderrolle (valgfri)', desc: 'Rollen vindere automatisk får. Min rolle skal ligge **over** den i rollelisten.' },
  { key: 'timezone', kind: 'timezone', title: 'Tidszone', desc: 'Bruges til planlagte giveaways og tidsstempler i loggen.' },
  { key: 'defaults', kind: 'defaults', title: 'Standard for giveaways', desc: 'Varighed, antal vindere, entries pr. klik, maks. entries og bonus-tilstand.' },
  { key: 'announcements', kind: 'announcements', title: 'Annonceringer', desc: 'Vælg hvilke automatiske beskeder der skal sendes. Tekster kan ændres med `/config message`.' },
  { key: 'dashboard', kind: 'dashboard', title: 'Kontrolpanel', desc: `Her logger du ind: **${env.DASHBOARD_URL}**\nLog ind med Discord – du ser kun servere hvor du har adgang.` },
];

const SNAP_KEYS = ['giveawayChannelId', 'numberChannelId', 'logChannelId', 'ownerRoleIds', 'highAdminRoleIds', 'eventManagerRoleIds', 'moderatorRoleIds', 'winnerRoleId', 'timezone', 'defaults', 'messages', 'endingSoonSeconds', 'dashboardEnabled'];

export const setupCommand: Command = {
  data: new SlashCommandBuilder().setName('setup').setDescription('Guidet opsætning af Nova Events').setDMPermission(false),
  async execute(i, ctx) {
    if (ctx.level < Level.HIGH_ADMIN && !canBootstrap(ctx.member, ctx.settings)) throw new UserError('Kun højadmins og ejere kan køre opsætningen. (Før første opsætning kan en Discord-administrator også gøre det.)');
    const canPerm = ctx.level >= Level.OWNER || canBootstrap(ctx.member, ctx.settings);
    const gid = i.guildId!;
    let step = 0;
    let s = await getSettings(gid);
    const startedWith = s;

    const render = () => {
      const st = STEPS[step];
      const e = new EmbedBuilder()
        .setColor(COLORS.BRAND)
        .setTitle(`⚙️ Opsætning ${step + 1}/${STEPS.length} — ${st.title}`)
        .setDescription(st.desc)
        .setFooter({ text: 'Dine valg gemmes med det samme. Du kan altid ændre dem senere med /config.' });
      const comps: ActionRowBuilder<any>[] = [];
      const locked = st.perm && !canPerm;
      if (locked) e.addFields({ name: '🔒 Låst', value: 'Kun **Ejere** kan ændre rettighedsroller. Spring videre.' });
      else if (st.kind === 'channel') {
        const cur = s[st.key as keyof GuildSettings] as string | null;
        e.addFields({ name: 'Nu', value: cur ? `<#${cur}>` : '*ikke sat*' });
        comps.push(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId('su:val').setPlaceholder('Vælg en kanal').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1)));
      } else if (st.kind === 'roles' || st.kind === 'role') {
        const cur = st.kind === 'roles' ? (s[st.key as keyof GuildSettings] as string[]) : s.winnerRoleId ? [s.winnerRoleId] : [];
        e.addFields({ name: 'Nu', value: cur.length ? cur.map((r) => `<@&${r}>`).join(' ') : '*ikke sat*' });
        comps.push(new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId('su:val').setPlaceholder(st.kind === 'roles' ? 'Vælg op til 5 roller' : 'Vælg en rolle').setMinValues(1).setMaxValues(st.kind === 'roles' ? 5 : 1)));
        comps.push(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('su:clear').setLabel('Ryd').setStyle(ButtonStyle.Secondary)));
      } else if (st.kind === 'timezone') {
        e.addFields({ name: 'Nu', value: `\`${s.timezone}\`` });
        comps.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId('su:tz').setPlaceholder('Vælg tidszone').addOptions(TIMEZONES.map((z) => ({ label: z, value: z, default: z === s.timezone })))));
        comps.push(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('su:tzmodal').setLabel('Anden tidszone…').setStyle(ButtonStyle.Secondary)));
      } else if (st.kind === 'defaults') {
        comps.push(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('su:defmodal').setLabel('Rediger standarder').setStyle(ButtonStyle.Primary)));
      } else if (st.kind === 'announcements') {
        const keys = Object.keys(MESSAGE_DEFAULTS) as MessageKey[];
        comps.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId('su:ann').setPlaceholder('Vælg beskeder der skal være slået til').setMinValues(0).setMaxValues(keys.length).addOptions(keys.map((k) => ({ label: MESSAGE_DEFAULTS[k].label, value: k, default: getMessage(s.messages, k).enabled })))));
        comps.push(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('su:endmodal').setLabel('Slutter-snart tider').setStyle(ButtonStyle.Secondary)));
      } else if (st.kind === 'dashboard') {
        comps.push(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('su:dash').setLabel(s.dashboardEnabled ? 'Kontrolpanel: TIL (klik for at slå fra)' : 'Kontrolpanel: FRA (klik for at slå til)').setStyle(s.dashboardEnabled ? ButtonStyle.Success : ButtonStyle.Danger)));
      }
      const last = step === STEPS.length - 1;
      comps.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId('su:back').setLabel('Tilbage').setStyle(ButtonStyle.Secondary).setDisabled(step === 0),
          last
            ? new ButtonBuilder().setCustomId('su:done').setLabel('Afslut opsætning ✅').setStyle(ButtonStyle.Success)
            : new ButtonBuilder().setCustomId('su:skip').setLabel(locked ? 'Næste' : 'Spring over / næste').setStyle(ButtonStyle.Secondary),
        ),
      );
      return { embeds: [e], components: comps };
    };

    await i.reply({ ...render(), flags: EPH });
    const msg = await i.fetchReply();
    const collector = msg.createMessageComponentCollector({ time: 20 * 60_000, filter: (c) => c.user.id === i.user.id });
    const save = async (patch: Record<string, any>) => {
      s = await commitSettings(gid, patch, ctx.actor, 'Opsætningsguide');
    };

    collector.on('collect', async (c) => {
      try {
        const st = STEPS[step];
        const id = c.customId;
        if (id === 'su:back') step = Math.max(0, step - 1);
        else if (id === 'su:skip') step = Math.min(STEPS.length - 1, step + 1);
        else if (id === 'su:val' && (c.isChannelSelectMenu() || c.isRoleSelectMenu())) {
          if (st.perm && !canPerm) return void (await c.deferUpdate());
          if (st.kind === 'channel') await save({ [st.key]: c.values[0] });
          else if (st.kind === 'roles') await save({ [st.key]: c.values });
          else await save({ winnerRoleId: c.values[0] });
          step = Math.min(STEPS.length - 1, step + 1);
        } else if (id === 'su:clear') await save(st.kind === 'roles' ? { [st.key]: [] } : { winnerRoleId: null });
        else if (id === 'su:tz' && c.isStringSelectMenu()) {
          await save({ timezone: c.values[0] });
          step++;
        } else if (id === 'su:ann' && c.isStringSelectMenu()) {
          const on = new Set(c.values);
          const messages: Record<string, any> = { ...((s.messages ?? {}) as Record<string, any>) };
          for (const k of Object.keys(MESSAGE_DEFAULTS)) messages[k] = { ...(messages[k] ?? {}), enabled: on.has(k) };
          await save({ messages });
        } else if (id === 'su:dash') await save({ dashboardEnabled: !s.dashboardEnabled });
        else if (id === 'su:tzmodal' || id === 'su:defmodal' || id === 'su:endmodal') {
          const mid = `sum:${c.id}`;
          const modal =
            id === 'su:defmodal'
              ? defaultsModal(mid, s)
              : id === 'su:endmodal'
                ? endingSoonModal(mid, s)
                : new ModalBuilder().setCustomId(mid).setTitle('Tidszone').addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('tz').setLabel('IANA-tidszone (fx Europe/Copenhagen)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60)),
                  );
          await c.showModal(modal);
          const sub = await c.awaitModalSubmit({ time: 5 * 60_000, filter: (m) => m.customId === mid && m.user.id === i.user.id }).catch(() => null);
          if (!sub) return;
          try {
            const get = (k: string) => sub.fields.getTextInputValue(k);
            if (id === 'su:defmodal') await save({ defaults: parseDefaultsModal(get) as any });
            else if (id === 'su:endmodal') await save({ endingSoonSeconds: parseEndingSoon(get('times')) });
            else {
              const tz = get('tz').trim();
              if (!isValidTimezone(tz)) throw new UserError('Den tidszone findes ikke. Brug et navn som `Europe/Copenhagen`.');
              await save({ timezone: tz });
              step++;
            }
            if (sub.isFromMessage()) await sub.update(render());
          } catch (e) {
            await sub.reply({ content: `❌ ${await explainError(e, gid)}`, flags: EPH });
          }
          return;
        } else if (id === 'su:done') {
          await save({ setupDone: true });
          collector.stop('done');
          await c.update({ embeds: [new EmbedBuilder().setColor(COLORS.OK).setTitle('✅ Opsætningen er færdig!').setDescription(`Nova Events er klar. Prøv \`/giveaway start\` eller log ind i kontrolpanelet:\n**${env.DASHBOARD_URL}**`), settingsSummary(s)], components: [] });
          return;
        }
        await c.update(render());
      } catch (e) {
        const text = `❌ ${await explainError(e, gid)}`;
        if (c.replied || c.deferred) await c.followUp({ content: text, flags: EPH }).catch(() => undefined);
        else await c.reply({ content: text, flags: EPH }).catch(() => undefined);
      }
    });
    collector.on('end', (_c, reason) => {
      if (reason === 'time') void i.editReply({ components: [], embeds: [new EmbedBuilder().setColor(COLORS.ENDED).setDescription('⌛ Opsætningen udløb. Det du nåede at vælge er gemt – kør `/setup` igen for at fortsætte.')] }).catch(() => undefined);
    });
    void startedWith;
    void SNAP_KEYS;
  },
};
