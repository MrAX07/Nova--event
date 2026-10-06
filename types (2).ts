import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Guild,
  GuildMember,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { Guild as GuildSettings } from '@prisma/client';
import type { Level } from '../shared/constants';
import type { Actor } from '../services/types';

export interface CommandContext {
  guild: Guild;
  member: GuildMember;
  level: Level;
  settings: GuildSettings;
  actor: Actor;
}

export interface Command {
  data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  execute(i: ChatInputCommandInteraction, ctx: CommandContext): Promise<void>;
  autocomplete?(i: AutocompleteInteraction, ctx: CommandContext): Promise<void>;
}
