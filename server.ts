import crypto from 'node:crypto';
import path from 'node:path';
import type { Server } from 'node:http';
import express, { NextFunction, Request, Response } from 'express';
import { env } from '../env';
import { info, logError } from '../logger';
import { createSession, destroySession, getSession, parseCookies, setCookie } from './session';
import { apiRouter } from './routes';
import { snowflakeDate } from '../shared/time';

const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'public');

function limiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, 60_000).unref();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + windowMs });
    else if (++h.n > max) {
      res.setHeader('Retry-After', Math.ceil((h.reset - now) / 1000));
      return void res.status(429).json({ error: 'For mange forespørgsler. Vent et øjeblik og prøv igen.' });
    }
    next();
  };
}

export async function startWeb(): Promise<Server> {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https://cdn.discordapp.com data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (env.SECURE_COOKIES) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  app.use(express.json({ limit: '200kb' }));

  app.get('/healthz', (_req, res) => void res.json({ ok: true }));

  // ───── Discord OAuth2 ─────
  const authLimit = limiter(30, 60_000);
  app.get('/auth/login', authLimit, (_req, res) => {
    const state = crypto.randomBytes(24).toString('hex');
    setCookie(res, 'nova_state', state, 600);
    const q = new URLSearchParams({ client_id: env.CLIENT_ID, response_type: 'code', redirect_uri: env.DISCORD_REDIRECT_URI, scope: 'identify', state, prompt: 'none' });
    res.redirect(`https://discord.com/oauth2/authorize?${q.toString()}`);
  });

  app.get(env.CALLBACK_PATH, authLimit, async (req, res) => {
    try {
      const state = String(req.query.state ?? '');
      const expected = parseCookies(req).nova_state ?? '';
      const ok = state.length > 10 && state.length === expected.length && crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expected));
      setCookie(res, 'nova_state', '', 0);
      const code = String(req.query.code ?? '');
      if (!ok || !code) return void res.redirect('/?fejl=login');
      const tok = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: env.DISCORD_REDIRECT_URI }),
      });
      if (!tok.ok) throw new Error(`Token-udveksling fejlede (${tok.status}). Tjek CLIENT_SECRET og redirect-URL.`);
      const { access_token } = (await tok.json()) as { access_token: string };
      const me = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${access_token}` } });
      if (!me.ok) throw new Error(`Kunne ikke hente brugeren (${me.status})`);
      const u = (await me.json()) as { id: string; username: string; global_name?: string | null; avatar: string | null };
      void snowflakeDate(u.id);
      await createSession(res, { id: u.id, username: u.global_name || u.username, avatar: u.avatar });
      res.redirect('/');
    } catch (e) {
      await logError('web.oauth', e);
      res.redirect('/?fejl=login');
    }
  });

  app.post('/auth/logout', async (req, res) => {
    const s = await getSession(req);
    if (s && req.get('x-nova-csrf') !== s.csrf) return void res.status(403).json({ error: 'Ugyldig anmodning.' });
    await destroySession(req, res);
    res.json({ ok: true });
  });

  // ───── API ─────
  app.use('/api', limiter(400, 60_000), apiRouter);

  // ───── Frontend ─────
  app.use(express.static(PUBLIC_DIR, { maxAge: '1h', index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/auth')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void logError('web.unhandled', err);
    if (!res.headersSent) res.status(500).json({ error: 'Der opstod en intern fejl.' });
  });

  return new Promise((resolve) => {
    const server = app.listen(env.PORT, () => {
      info(`🌐 Kontrolpanel kører på port ${env.PORT} (${env.DASHBOARD_URL})`);
      resolve(server);
    });
  });
}
