/** En fejl hvis besked er sikker at vise til personen der udløste den. */
export class UserError extends Error {}

export function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

export const truncate = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);
export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

const EMOJI_RE = /^(?:<a?:[A-Za-z0-9_]{2,32}:\d{17,20}>|\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*)$/u;
export const isValidEmoji = (s: string): boolean => EMOJI_RE.test(s);

export function isHexColor(s: string): boolean {
  return /^#?[0-9a-fA-F]{6}$/.test(s.trim());
}
export const hexToInt = (s: string): number => parseInt(s.trim().replace('#', ''), 16);

export type MessageKey =
  | 'giveawayStarted'
  | 'endingSoon'
  | 'giveawayEnded'
  | 'winnerSelected'
  | 'giveawayNoWinners'
  | 'winnerDM'
  | 'numberStarted'
  | 'numberWinner'
  | 'numberExpired';

export interface MessageDef {
  label: string;
  enabled: boolean;
  text: string;
  vars: string;
}

export const MESSAGE_DEFAULTS: Record<MessageKey, MessageDef> = {
  giveawayStarted: {
    label: 'Giveaway startet',
    enabled: true,
    text: '🎉 **Nyt giveaway!** Tryk på knappen herunder for at deltage.',
    vars: '{prize} {id} {winners} {ends} {host} {link}',
  },
  endingSoon: {
    label: 'Giveaway slutter snart',
    enabled: true,
    text: '⏳ **{prize}** slutter {ends}! Sidste chance for at deltage → {link}',
    vars: '{prize} {id} {winners} {ends} {link}',
  },
  giveawayEnded: {
    label: 'Giveaway afsluttet',
    enabled: true,
    text: '🏁 Giveawayet om **{prize}** er slut!',
    vars: '{prize} {id} {winners} {link}',
  },
  winnerSelected: {
    label: 'Vinder fundet (offentlig besked)',
    enabled: true,
    text: '🏆 Tillykke {winners}! Du har vundet **{prize}**!',
    vars: '{prize} {id} {winners} {link}',
  },
  giveawayNoWinners: {
    label: 'Ingen gyldig vinder',
    enabled: true,
    text: '😔 Der kunne ikke findes en gyldig vinder til **{prize}**.',
    vars: '{prize} {id} {link}',
  },
  winnerDM: {
    label: 'Vinder-DM',
    enabled: true,
    text: '🏆 **DU VANDT!**\n\n**Giveaway:**\n{id}\n\n**Præmie:**\n{prize}\n\nTillykke! Åbn en **præmie-ticket** på serveren for at hente din præmie.',
    vars: '{prize} {id} {link} {place}',
  },
  numberStarted: {
    label: 'Talevent startet',
    enabled: true,
    text: '🎯 Et nyt **talevent** er startet! Skriv det rigtige tal i denne kanal.',
    vars: '{prize} {id} {min} {max} {ends}',
  },
  numberWinner: {
    label: 'Talevent-vinder',
    enabled: true,
    text: '🏆 {winner} gættede tallet **{number}** og vinder **{prize}**!',
    vars: '{winner} {number} {prize} {place} {id}',
  },
  numberExpired: {
    label: 'Talevent udløbet',
    enabled: true,
    text: '⌛ Tiden er gået! Tallet var **{number}**. Ingen gættede det i tide.',
    vars: '{number} {prize} {id}',
  },
};

export function getMessage(stored: unknown, key: MessageKey): MessageDef {
  const base = MESSAGE_DEFAULTS[key];
  const o = (stored && typeof stored === 'object' ? (stored as Record<string, any>)[key] : null) as
    | { enabled?: boolean; text?: string }
    | null;
  return {
    ...base,
    enabled: typeof o?.enabled === 'boolean' ? o.enabled : base.enabled,
    text: typeof o?.text === 'string' && o.text.trim() ? o.text : base.text,
  };
}

/** Flattens nested objects to dotted keys so two config objects can be compared key by key. */
function flatten(obj: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out[prefix] = JSON.stringify(obj ?? null);
  }
  return out;
}

/** Returns only the keys that differ, as { before, after } (values are JSON-ish strings/values). */
export function diffJson(a: unknown, b: unknown): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const fa = flatten(a);
  const fb = flatten(b);
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
    if (fa[k] !== fb[k]) {
      before[k] = fa[k] === undefined ? null : JSON.parse(fa[k]);
      after[k] = fb[k] === undefined ? null : JSON.parse(fb[k]);
    }
  }
  return { before, after };
}
