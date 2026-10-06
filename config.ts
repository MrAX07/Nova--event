import { ChannelType, SlashCommandBuilder } from 'discord.js';
import { Level, LOG_CATEGORIES, TIMEZONES } from '../../shared/constants';
import { MESSAGE_DEFAULTS, MessageKey, UserError } from '../../shared/text';
import { fmtDuration, isValidTimezone } from '../../shared/time';
import { okEmbed } from '../../services/embeds';
import { getSettings } from '../../services/settings';
import { commitSettings } from '../../services/settingsAdmin';
import type { Command } from '../types';
import { EPH, explainError } from '../util';
import { defaultsModal, endingSoonModal, messageModal, parseDefaultsModal, parseEndingSoon, settingsSummary } from '../settingsUi';

const catChoices = Object.entries(LOG_CATEGORIES).map(([value, name]) => ({ name, value }));
const msgChoices = (Object.keys(MESSAGE_DEFAULTS) as MessageKey[]).map((k) => ({ name: MESSAGE_DEFAULTS[k].label, value: k }));

const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Ændr indstillinger for Nova Events')
  .setDMPermission(false)
  .addSubcommand((s) => s.setName('view').setDescription('Vis alle nuværende indstillinger'))
  .addSubcommand((s) =>
    s
      .setName('channel')
      .setDescription('Sæt standardkanal')
      .addStringOption((o) => o.setName('type').setDescription('Hvilken kanal?').setRequired(true).addChoices({ name: 'Giveaway-kanal', value: 'giveawayChannelId' }, { name: 'Talevent-kanal', value: 'numberChannelId' }, { name: 'Log-kanal (standard)', value: 'logChannelId' }))
      .addChannelOption((o) => o.setName('kanal').setDescription('Kanalen').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('logchannel')
      .setDescription('Giv en logkategori sin egen kanal (tom kanal = brug standard-logkanalen)')
      .addStringOption((o) => o.setName('kategori').setDescription('Hvad skal logges i kanalen?').setRequired(true).addChoices(...catChoices))
      .addChannelOption((o) => o.setName('kanal').setDescription('Kanalen (tom = nulstil)')),
  )
  .addSubcommand((s) =>
    s
      .setName('logs')
      .setDescription('Slå en logkategori til eller fra')
      .addStringOption((o) => o.setName('kategori').setDescription('Kategori').setRequired(true).addChoices(...catChoices))
      .addBooleanOption((o) => o.setName('aktiv').setDescription('Skal den logges?').setRequired(true)),
  )
  .addSubcommand((s) => s.setName('rolelogs').setDescription('Log når medlemmer får/mister vigtige roller').addBooleanOption((o) => o.setName('aktiv').setDescription('Slå til eller fra').setRequired(true)))
  .addSubcommand((s) =>
    s
      .setName('role')
      .setDescription('Tilføj/fjern en rettighedsrolle (kun Ejere)')
      .addStringOption((o) => o.setName('niveau').setDescription('Rettighedsniveau').setRequired(true).addChoices({ name: 'Ejer', value: 'ownerRoleIds' }, { name: 'Højadmin', value: 'highAdminRoleIds' }, { name: 'Eventansvarlig', value: 'eventManagerRoleIds' }, { name: 'Moderator', value: 'moderatorRoleIds' }))
      .addStringOption((o) => o.setName('handling').setDescription('Tilføj eller fjern').setRequired(true).addChoices({ name: 'Tilføj', value: 'add' }, { name: 'Fjern', value: 'remove' }))
      .addRoleOption((o) => o.setName('rolle').setDescription('Rollen').setRequired(true)),
  )
  .addSubcommand((s) => s.setName('winnerrole').setDescription('Sæt vinderrollen (tom = slå fra)').addRoleOption((o) => o.setName('rolle').setDescription('Rollen vindere får')))
  .addSubcommand((s) => s.setName('timezone').setDescription('Sæt serverens tidszone').addStringOption((o) => o.setName('zone').setDescription('Fx Europe/Copenhagen').setRequired(true).setAutocomplete(true)))
  .addSubcommand((s) => s.setName('testmode').setDescription('Testtilstand: nye events påvirker ikke statistik').addBooleanOption((o) => o.setName('aktiv').setDescription('Slå til eller fra').setRequired(true)))
  .addSubcommand((s) => s.setName('defaults').setDescription('Rediger standardindstillinger for giveaways'))
  .addSubcommand((s) => s.setName('endingsoon').setDescription('Rediger tidspunkter for slutter-snart beskeder'))
  .addSubcommand((s) => s.setName('message').setDescription('Tilpas en automatisk besked').addStringOption((o) => o.setName('besked').setDescription('Hvilken besked?').setRequired(true).addChoices(...msgChoices)))
  .addSubcommand((s) =>
    s
      .setName('ticket')
      .setDescription('Indstil ticket-systemet')
      .addChannelOption((o) => o.setName('kategori').setDescription('Kategorien ticket-kanaler oprettes i').addChannelTypes(ChannelType.GuildCategory))
      .addRoleOption((o) => o.setName('support_rolle').setDescription('Ekstra support-rolle (vælg igen for at fjerne)'))
      .addRoleOption((o) => o.setName('praemie_rolle').setDescription('Rolle for præmie-/event-tickets (vælg igen for at fjerne)')),
  )
  .addSubcommand((s) => s.setName('dashboard').setDescription('Slå kontrolpanelet til eller fra').addBooleanOption((o) => o.setName('aktiv').setDescription('Slå til eller fra').setRequired(true)));

export const configCommand: Command = {
  data,
  async autocomplete(i) {
    const q = String(i.options.getFocused()).toLowerCase();
    await i.respond(TIMEZONES.filter((z) => z.toLowerCase().includes(q)).slice(0, 25).map((z) => ({ name: z, value: z })));
  },
  async execute(i, ctx) {
    const sub = i.options.getSubcommand();
    const gid = i.guildId!;
    const s = await getSettings(gid);
    const save = async (patch: Record<string, any>, text: string) => {
      await commitSettings(gid, patch, ctx.actor);
      await i.editReply({ embeds: [okEmbed(text, '⚙️ GEMT')] });
    };

    // kommandoer der åbner en formular må ikke defer'es først
    if (sub === 'defaults' || sub === 'endingsoon' || sub === 'message') {
      const mid = `cfgm:${i.id}`;
      const key = sub === 'message' ? (i.options.getString('besked', true) as MessageKey) : null;
      await i.showModal(sub === 'defaults' ? defaultsModal(mid, s) : sub === 'endingsoon' ? endingSoonModal(mid, s) : messageModal(mid, key!, s));
      const m = await i.awaitModalSubmit({ time: 5 * 60_000, filter: (x) => x.customId === mid && x.user.id === i.user.id }).catch(() => null);
      if (!m) return;
      await m.deferReply({ flags: EPH });
      try {
        const get = (k: string) => m.fields.getTextInputValue(k);
        let patch: Record<string, any>;
        if (sub === 'defaults') patch = { defaults: parseDefaultsModal(get) };
        else if (sub === 'endingsoon') patch = { endingSoonSeconds: parseEndingSoon(get('times')) };
        else {
          const en = get('enabled').trim().toLowerCase();
          if (!['ja', 'nej', 'yes', 'no'].includes(en)) throw new UserError('Skriv `ja` eller `nej` i feltet "Slået til".');
          const messages: Record<string, any> = { ...((s.messages ?? {}) as Record<string, any>) };
          const text = get('text').trim();
          messages[key!] = { enabled: en === 'ja' || en === 'yes', ...(text ? { text } : {}) };
          patch = { messages };
        }
        await commitSettings(gid, patch, ctx.actor);
        await m.editReply({ embeds: [okEmbed(sub === 'message' ? 'Beskeden er gemt.' : 'Indstillingerne er gemt.', '⚙️ GEMT')] });
      } catch (e) {
        await m.editReply({ content: `❌ ${await explainError(e, gid)}` });
      }
      return;
    }

    await i.deferReply({ flags: EPH });
    switch (sub) {
      case 'view':
        await i.editReply({ embeds: [settingsSummary(s)] });
        return;
      case 'channel': {
        const ch = i.options.getChannel('kanal', true);
        await save({ [i.options.getString('type', true)]: ch.id }, `Kanalen er sat til <#${ch.id}>.`);
        return;
      }
      case 'logchannel': {
        const cat = i.options.getString('kategori', true);
        const ch = i.options.getChannel('kanal');
        const per = { ...((s.logChannels ?? {}) as Record<string, string>) };
        if (ch) per[cat] = ch.id;
        else delete per[cat];
        await save({ logChannels: per }, ch ? `**${LOG_CATEGORIES[cat as keyof typeof LOG_CATEGORIES]}** logges nu i <#${ch.id}>.` : `**${LOG_CATEGORIES[cat as keyof typeof LOG_CATEGORIES]}** bruger igen standard-logkanalen.`);
        return;
      }
      case 'logs': {
        const cat = i.options.getString('kategori', true);
        const on = i.options.getBoolean('aktiv', true);
        const list = new Set(s.disabledLogCategories);
        if (on) list.delete(cat);
        else list.add(cat);
        await save({ disabledLogCategories: [...list] }, `**${LOG_CATEGORIES[cat as keyof typeof LOG_CATEGORIES]}** er nu ${on ? 'slået til 🟢' : 'slået fra ⚫'}.`);
        return;
      }
      case 'rolelogs': {
        const on = i.options.getBoolean('aktiv', true);
        await save({ logRoleChanges: on }, `Logning af rolleændringer er ${on ? 'slået til' : 'slået fra'}.`);
        return;
      }
      case 'role': {
        if (ctx.level < Level.OWNER) throw new UserError('Kun Ejere kan ændre rettighedsroller.');
        const field = i.options.getString('niveau', true) as 'ownerRoleIds' | 'highAdminRoleIds' | 'eventManagerRoleIds' | 'moderatorRoleIds';
        const role = i.options.getRole('rolle', true);
        const cur = new Set(s[field]);
        if (i.options.getString('handling', true) === 'add') cur.add(role.id);
        else cur.delete(role.id);
        await save({ [field]: [...cur] }, `<@&${role.id}> er ${cur.has(role.id) ? 'tilføjet til' : 'fjernet fra'} rettighedsniveauet.`);
        return;
      }
      case 'winnerrole': {
        const r = i.options.getRole('rolle');
        await save({ winnerRoleId: r?.id ?? null }, r ? `Vindere får nu <@&${r.id}>.` : 'Vinderrollen er slået fra.');
        return;
      }
      case 'timezone': {
        const z = i.options.getString('zone', true).trim();
        if (!isValidTimezone(z)) throw new UserError('Den tidszone findes ikke. Brug et navn som `Europe/Copenhagen`.');
        await save({ timezone: z }, `Tidszonen er sat til \`${z}\`.`);
        return;
      }
      case 'testmode': {
        const on = i.options.getBoolean('aktiv', true);
        await save({ testMode: on }, on ? '🧪 Testtilstand er **slået til**. Nye events tæller ikke i statistikken, og der gives ingen roller eller DM\'er.' : 'Testtilstand er slået fra.');
        return;
      }
      case 'ticket': {
        const cat = i.options.getChannel('kategori');
        const sr = i.options.getRole('support_rolle');
        const pr = i.options.getRole('praemie_rolle');
        const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
        const patch: Record<string, any> = {};
        if (cat) patch.ticketCategoryId = cat.id;
        if (sr) patch.ticketSupportRoleIds = toggle(s.ticketSupportRoleIds, sr.id);
        if (pr) patch.ticketPrizeRoleIds = toggle(s.ticketPrizeRoleIds, pr.id);
        if (!Object.keys(patch).length) throw new UserError('Vælg mindst én ting at ændre. Send panelet med `/ticket panel`.');
        await save(patch, 'Ticket-indstillingerne er gemt. Send panelet med `/ticket panel`.');
        return;
      }
      case 'dashboard': {
        const on = i.options.getBoolean('aktiv', true);
        await save({ dashboardEnabled: on }, `Kontrolpanelet er ${on ? 'slået til' : 'slået fra'} for denne server.`);
        return;
      }
    }
    void fmtDuration;
  },
};
