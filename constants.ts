export enum Level {
  USER = 0,
  MODERATOR = 1,
  EVENT_MANAGER = 2,
  HIGH_ADMIN = 3,
  OWNER = 4,
}

export const LEVEL_NAMES: Record<number, string> = {
  0: 'Bruger',
  1: 'Moderator',
  2: 'Eventansvarlig',
  3: 'Højadmin',
  4: 'Ejer',
};

/** Minimum level for every action. Unknown actions default to High Admin (safe default). */
export const ACTION_LEVEL: Record<string, Level> = {
  'giveaway.start': Level.EVENT_MANAGER,
  'giveaway.schedule': Level.EVENT_MANAGER,
  'giveaway.preview': Level.EVENT_MANAGER,
  'giveaway.end': Level.EVENT_MANAGER,
  'giveaway.cancel': Level.EVENT_MANAGER,
  'giveaway.pause': Level.EVENT_MANAGER,
  'giveaway.resume': Level.EVENT_MANAGER,
  'giveaway.edit': Level.HIGH_ADMIN,
  'giveaway.customize': Level.HIGH_ADMIN,
  'giveaway.reroll': Level.HIGH_ADMIN,
  'giveaway.delete': Level.HIGH_ADMIN,
  'giveaway.list': Level.MODERATOR,
  'giveaway.info': Level.MODERATOR,
  'giveaway.template.list': Level.EVENT_MANAGER,
  'giveaway.template.create': Level.HIGH_ADMIN,
  'giveaway.template.delete': Level.HIGH_ADMIN,
  'numberevent.start': Level.EVENT_MANAGER,
  'numberevent.stop': Level.EVENT_MANAGER,
  'numberevent.reroll': Level.HIGH_ADMIN,
  'numberevent.status': Level.MODERATOR,
  'numberevent.history': Level.MODERATOR,
  'entries': Level.HIGH_ADMIN,
  'blacklist.add': Level.HIGH_ADMIN,
  'blacklist.remove': Level.HIGH_ADMIN,
  'blacklist.check': Level.MODERATOR,
  'stats': Level.MODERATOR,
  'event.info': Level.MODERATOR,
  'event.search': Level.MODERATOR,
  'userstats.others': Level.MODERATOR,
  'config.role': Level.OWNER,
  'config': Level.HIGH_ADMIN,
  'setup': Level.HIGH_ADMIN,
  'leaderboard': Level.USER,
  'userstats': Level.USER,
  'ticket.panel': Level.HIGH_ADMIN,
  'ticket.list': Level.MODERATOR,
  'ticket': Level.USER,
};

export function levelFor(key: string): Level {
  const parts = key.split('.');
  while (parts.length) {
    const k = parts.join('.');
    if (k in ACTION_LEVEL) return ACTION_LEVEL[k];
    parts.pop();
  }
  return Level.HIGH_ADMIN;
}

export const LOG_CATEGORIES = {
  GIVEAWAY: 'Giveaway-logs',
  NUMBER: 'Talevent-logs',
  ENTRY: 'Entry-logs (manuelle ændringer)',
  JOIN: 'Entry-logs (deltagelser via knap – mange beskeder)',
  WINNER: 'Vinder-logs',
  SETTINGS: 'Indstillings-logs',
  ADMIN: 'Admin-logs (roller, rettigheder, blacklist, eksport)',
  TICKET: 'Ticket-logs',
  ERROR: 'Fejl-logs',
} as const;
export type LogCategory = keyof typeof LOG_CATEGORIES;

const PREFIX_TO_CATEGORY: Record<string, LogCategory> = {
  GIVEAWAY: 'GIVEAWAY',
  NUMBER: 'NUMBER',
  ENTRY: 'ENTRY',
  JOIN: 'JOIN',
  WINNER: 'WINNER',
  SETTINGS: 'SETTINGS',
  TICKET: 'TICKET',
  ERROR: 'ERROR',
  ROLE: 'ADMIN',
  BLACKLIST: 'ADMIN',
  PERMISSION: 'ADMIN',
  EXPORT: 'ADMIN',
};

export function categoryOf(action: string): LogCategory {
  return PREFIX_TO_CATEGORY[action.split('_')[0]] ?? 'ADMIN';
}

export const COLORS = {
  BRAND: 0xe11d2e,
  PAUSED: 0xffb454,
  ENDED: 0x6b7280,
  CANCELLED: 0xef4444,
  SCHEDULED: 0x38bdf8,
  GOLD: 0xffc857,
  OK: 0x22c55e,
  ERR: 0xef4444,
  INFO: 0x5865f2,
} as const;

export const TIMEZONES = [
  'UTC', 'Europe/Copenhagen', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Madrid', 'Europe/Stockholm',
  'Europe/Oslo', 'Europe/Helsinki', 'Europe/Moscow', 'Europe/Istanbul', 'America/New_York', 'America/Chicago',
  'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo', 'America/Toronto', 'Asia/Dubai', 'Asia/Kolkata',
  'Asia/Bangkok', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland', 'Africa/Johannesburg',
];
