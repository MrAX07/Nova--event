/** Parser "30m", "2h" (eller "2t"), "1d12h", "90s", "1w". Returnerer sekunder eller null. */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  if (/^\d+$/.test(s)) return null; // bare numbers are ambiguous
  const re = /(\d+)(w|d|h|t|m|s)/g;
  let total = 0;
  let consumed = 0;
  let m: RegExpExecArray | null;
  const mult: Record<string, number> = { w: 604800, d: 86400, h: 3600, t: 3600, m: 60, s: 1 };
  while ((m = re.exec(s))) {
    total += Number(m[1]) * mult[m[2]];
    consumed += m[0].length;
  }
  if (consumed !== s.length || total <= 0) return null;
  return total;
}

export function fmtDuration(sec: number): string {
  sec = Math.max(0, Math.round(sec));
  if (sec === 0) return '0s';
  const parts: string[] = [];
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s && !d) parts.push(`${s}s`);
  return parts.join(' ');
}

export function fmtDurationLong(sec: number): string {
  sec = Math.max(0, Math.round(sec));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const out: string[] = [];
  if (d) out.push(p(d, 'dag', 'dage'));
  if (h) out.push(p(h, 'time', 'timer'));
  if (m) out.push(p(m, 'minut', 'minutter'));
  if (s && !d && !h) out.push(p(s, 'sekund', 'sekunder'));
  return out.join(' ') || '0 sekunder';
}

/** Discord timestamp markdown. */
export const ts = (d: Date | number, style: 'R' | 'f' | 'F' | 't' | 'd' | 'D' = 'R'): string =>
  `<t:${Math.floor((d instanceof Date ? d.getTime() : d) / 1000)}:${style}>`;

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function zoneParts(date: Date, tz: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const o: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return o;
}

function tzOffsetMs(date: Date, tz: string): number {
  const p = zoneParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Converts a wall-clock time in a timezone to a real Date. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffsetMs(new Date(guess), tz);
  let t = guess - off1;
  const off2 = tzOffsetMs(new Date(t), tz);
  if (off2 !== off1) t = guess - off2;
  return new Date(t);
}

/**
 * Accepts "18:00", "6pm", "2026-10-05 18:00", "05/10/2026 18:00" (dd/mm/yyyy) in the server timezone.
 * A bare time that has already passed today means tomorrow.
 */
export function parseLocalDateTime(input: string, tz: string, now = new Date()): Date | null {
  const s = input.trim().toLowerCase();
  const nowP = zoneParts(now, tz);
  let y = nowP.year, mo = nowP.month, d = nowP.day;
  let timePart = s;
  let dateGiven = false;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ t]+(.+)$/);
  if (m) {
    y = +m[1]; mo = +m[2]; d = +m[3]; timePart = m[4]; dateGiven = true;
  } else if ((m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})[ t]+(.+)$/))) {
    d = +m[1]; mo = +m[2]; y = +m[3]; timePart = m[4]; dateGiven = true;
  }
  const t = timePart.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!t) return null;
  let h = +t[1];
  const mi = t[2] ? +t[2] : 0;
  if (t[3]) {
    if (h < 1 || h > 12) return null;
    if (t[3] === 'pm' && h < 12) h += 12;
    if (t[3] === 'am' && h === 12) h = 0;
  }
  if (h > 23 || mi > 59 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  let out = zonedToUtc(y, mo, d, h, mi, tz);
  if (!dateGiven && out.getTime() <= now.getTime()) {
    out = zonedToUtc(y, mo, d + 1, h, mi, tz);
    // d+1 may overflow month; Date.UTC normalises it
  }
  return out;
}

/** "04/10/2026 11:30" in the given timezone. */
export function fmtDateTime(d: Date, tz: string): string {
  try {
    const p = zoneParts(d, tz);
    const z = (n: number) => String(n).padStart(2, '0');
    return `${z(p.day)}/${z(p.month)}/${p.year} ${z(p.hour)}:${z(p.minute)}`;
  } catch {
    return d.toISOString();
  }
}

export function snowflakeDate(id: string): Date {
  return new Date(Number((BigInt(id) >> 22n) + 1420070400000n));
}
