import 'dotenv/config';

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`\n❌ Missing environment variable: ${name}\n   Open your .env file (see .env.example) and fill it in.\n`);
    process.exit(1);
  }
  return v;
}

const redirect = need('DISCORD_REDIRECT_URI');
let redirectUrl: URL;
try {
  redirectUrl = new URL(redirect);
} catch {
  console.error('\n❌ DISCORD_REDIRECT_URI is not a valid URL (example: https://events.example.com/auth/callback)\n');
  process.exit(1);
}

const sessionSecret = need('SESSION_SECRET');
if (sessionSecret.length < 32) {
  console.error('\n❌ SESSION_SECRET must be at least 32 characters long.\n');
  process.exit(1);
}

export const env = {
  DISCORD_TOKEN: need('DISCORD_TOKEN'),
  CLIENT_ID: need('CLIENT_ID'),
  CLIENT_SECRET: need('CLIENT_SECRET'),
  DATABASE_URL: need('DATABASE_URL'),
  DISCORD_REDIRECT_URI: redirect,
  CALLBACK_PATH: redirectUrl.pathname,
  DASHBOARD_URL: redirectUrl.origin,
  SESSION_SECRET: sessionSecret,
  PORT: Number(process.env.PORT ?? 3000) || 3000,
  SECURE_COOKIES: redirectUrl.protocol === 'https:',
  AUTO_REGISTER_COMMANDS: (process.env.AUTO_REGISTER_COMMANDS ?? 'true').toLowerCase() !== 'false',
};
