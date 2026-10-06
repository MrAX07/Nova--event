import { ButtonInteraction, ChatInputCommandInteraction, Interaction, PermissionFlagsBits } from 'discord.js';
import { Level, LEVEL_NAMES, levelFor } from '../shared/constants';
import { errEmbed } from '../services/embeds';
import { handleEnter, handleMyEntries } from '../services/giveaways';
import { getMemberLevel, canBootstrap } from '../services/permissions';
import { getSettings } from '../services/settings';
import { touchUser } from '../services/activity';
import { commandMap } from './commands';
import type { CommandContext } from './types';
import { EPH, explainError, respond } from './util';
import { handleTicketButton, handleTicketModal } from './ticketUi';

async function buildContext(i: ChatInputCommandInteraction | Interaction): Promise<CommandContext | null> {
  if (!i.guild || !i.guildId) return null;
  const member = await i.guild.members.fetch(i.user.id).catch(() => null);
  if (!member) return null;
  const settings = await getSettings(i.guildId, i.guild.name);
  const level = await getMemberLevel(member);
  return { guild: i.guild, member, level, settings, actor: { id: i.user.id, level, source: 'discord' } };
}

export async function handleInteraction(i: Interaction): Promise<void> {
  try {
    if (i.isChatInputCommand()) return await handleCommand(i);
    if (i.isAutocomplete()) {
      const cmd = commandMap.get(i.commandName);
      const ctx = await buildContext(i);
      if (!cmd?.autocomplete || !ctx) return void (await i.respond([]));
      await cmd.autocomplete(i, ctx);
      return;
    }
    if (i.isButton()) return await handleButton(i);
    if (i.isModalSubmit() && i.customId.startsWith('tk:')) return await handleTicketModal(i);
  } catch (e) {
    if (i.isAutocomplete()) return void (await i.respond([]).catch(() => undefined));
    if (i.isRepliable()) {
      const text = await explainError(e, i.guildId);
      await respond(i as any, { embeds: [errEmbed(text)], components: [], content: undefined }).catch(() => undefined);
    }
  }
}

async function handleCommand(i: ChatInputCommandInteraction): Promise<void> {
  if (!i.inGuild() || !i.guild) {
    await i.reply({ content: 'Nova Events virker kun på servere.', flags: EPH });
    return;
  }
  const cmd = commandMap.get(i.commandName);
  if (!cmd) return;
  const ctx = await buildContext(i);
  if (!ctx) {
    await i.reply({ embeds: [errEmbed('Jeg kunne ikke finde dig på serveren. Prøv igen om lidt.')], flags: EPH });
    return;
  }
  const key = [i.commandName, i.options.getSubcommandGroup(false), i.options.getSubcommand(false)].filter(Boolean).join('.');
  let need = levelFor(key);
  if (key === 'userstats') need = Level.USER; // egne tal: tjekkes i kommandoen selv
  const bootstrap = (i.commandName === 'setup' || i.commandName === 'config') && canBootstrap(ctx.member, ctx.settings);
  const admin = ctx.member.permissions.has(PermissionFlagsBits.Administrator);
  void admin;
  if (ctx.level < need && !bootstrap) {
    await i.reply({
      embeds: [errEmbed(`Du har ikke adgang til \`/${key.replace(/\./g, ' ')}\`.\nDet kræver **${LEVEL_NAMES[need]}** eller højere – du er **${LEVEL_NAMES[ctx.level]}**.`)],
      flags: EPH,
    });
    return;
  }
  void touchUser(i.user);
  await cmd.execute(i, ctx);
}

async function handleButton(i: ButtonInteraction): Promise<void> {
  if (i.customId.startsWith('tk:')) return handleTicketButton(i);
  if (!i.customId.startsWith('gw:')) return; // andre knapper håndteres af deres egne collectors
  if (!i.inGuild()) return;
  if (i.customId.startsWith('gw:enter:')) return handleEnter(i);
  if (i.customId.startsWith('gw:info:')) return handleMyEntries(i);
}
