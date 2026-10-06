import { blacklistCommand } from './blacklist';
import { configCommand } from './config';
import { entriesCommand } from './entries';
import { eventCommand } from './event';
import { giveawayCommand } from './giveaway';
import { leaderboardCommand } from './leaderboard';
import { numberEventCommand } from './numberevent';
import { setupCommand } from './setup';
import { statsCommand } from './stats';
import { ticketCommand } from './ticket';
import { userStatsCommand } from './userstats';
import type { Command } from '../types';

export const commands: Command[] = [
  giveawayCommand,
  entriesCommand,
  numberEventCommand,
  userStatsCommand,
  leaderboardCommand,
  blacklistCommand,
  statsCommand,
  eventCommand,
  setupCommand,
  configCommand,
  ticketCommand,
];
export const commandMap = new Map(commands.map((c) => [c.data.name, c]));
