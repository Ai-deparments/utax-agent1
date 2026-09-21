import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');

// .env yuklash (tashqi paketsiz)
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
// Fon vazifalari (scheduler dailyAt: 08:30 digest, 17:00 eslatma) server qaysi zonada bo'lishidan qat'i nazar Toshkent vaqtida
if (!process.env.TZ) process.env.TZ = env('APP_TZ', 'Asia/Tashkent');

export const config = {
  port: Number(env('PORT', 8100)),
  host: env('HOST', '127.0.0.1'),
  nodeEnv: env('NODE_ENV', 'development'),
  dbPath: path.resolve(ROOT, env('DB_PATH', './data/finance.db')),
  jwtSecret: env('JWT_SECRET', 'dev-secret-change-me-please-32-bytes-min'),
  accessTtl: Number(env('ACCESS_TOKEN_TTL', 900)),
  refreshTtl: Number(env('REFRESH_TOKEN_TTL', 604800)),
  secretsKey: env('SECRETS_KEY', 'dev-secrets-key-change-me'),
  anthropicKey: env('ANTHROPIC_API_KEY', ''),
  aiModel: env('AI_MODEL', 'claude-opus-5'),
  // Telegram botlar (src/bots). TELEGRAM_BOT_TOKEN — eski yagona bot kaliti, rahbar botiga fallback.
  bots: {
    rahbar: env('BOT_RAHBAR_TOKEN', env('TELEGRAM_BOT_TOKEN', '')),
    buxgalter: env('BOT_BUXGALTER_TOKEN', ''),
    sorov: env('BOT_SOROV_TOKEN', ''),
    signal: env('BOT_SIGNAL_TOKEN', ''),
  },
  // Egalar: Telegram user id'lar (FOUNDER roli, barcha botlar, avtomatik bog'lanadi)
  botOwnerIds: String(env('BOT_OWNER_IDS', '')).split(/[\s,;]+/).filter((x) => /^\d{5,15}$/.test(x)),
  botMode: env('BOT_MODE', 'polling'), // polling | webhook | off
  publicUrl: env('PUBLIC_URL', ''), // webhook uchun https manzil
  webappUrl: env('WEBAPP_URL', ''), // botlardagi "Web'da ochish" tugmalari (https bo'lsa Telegram Mini App)
  webhookSecret: env('WEBHOOK_SECRET', ''),
  telegramAlertChat: env('TELEGRAM_ALERT_CHAT_ID', ''),
  emailWebhook: env('EMAIL_WEBHOOK_URL', ''),
  seedOnEmpty: env('SEED_ON_EMPTY', 'true') === 'true',
  publicDir: path.join(ROOT, 'public'),
  uploadsDir: path.join(ROOT, 'uploads'),
  backupDir: path.join(ROOT, 'data', 'backups'),
};
