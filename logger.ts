import { prisma } from './db';

type ErrorHook = (guildId: string, scope: string, message: string) => Promise<void>;
let hook: ErrorHook | null = null;
export const setErrorHook = (fn: ErrorHook) => {
  hook = fn;
};

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return String(e);
  } catch {
    return 'Unknown error';
  }
}

/** Logs to console + database (+ the Discord log channel). Never throws. Returns a short error reference. */
export async function logError(scope: string, err: unknown, guildId?: string | null): Promise<string | null> {
  console.error(`[${scope}]`, err);
  try {
    const row = await prisma.errorLog.create({
      data: {
        guildId: guildId ?? null,
        scope: scope.slice(0, 100),
        message: errMsg(err).slice(0, 1000),
        stack: err instanceof Error ? (err.stack ?? '').slice(0, 4000) : null,
      },
    });
    if (guildId && hook) hook(guildId, scope, errMsg(err)).catch(() => undefined);
    return row.id.slice(-8);
  } catch (e) {
    console.error('[logger] could not write error log', e);
    return null;
  }
}

export const info = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
