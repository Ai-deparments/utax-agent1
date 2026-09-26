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
/** Butun son sozlama: buzuq yoki chegaradan kichik qiymat — defaultga tushadi (bitta noto'g'ri env tizimni yiqitmasin) */
const intEnv = (k, d, min = 1) => { const n = Number(env(k, d)); return Number.isInteger(n) && n >= min ? n : d; };
const TEST_MODE = !!process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test';
// Fon vazifalari (scheduler dailyAt: 01:00 revenue, 03:00 backup, 08:30 digest) server qaysi zonada bo'lishidan qat'i nazar Toshkent vaqtida.
// util.today() ham shu zonadagi kalendar sanani qaytaradi — dailyAt vaqti va "bugun" sanasi bir xil zonada (UTC sana emas).
if (!process.env.TZ) process.env.TZ = env('APP_TZ', 'Asia/Tashkent');

// Vercel (serverless): diskka faqat /tmp ga yozish mumkin va u vaqtinchalik. Doimiy baza — Turso (TURSO_DATABASE_URL).
export const ON_VERCEL = !!process.env.VERCEL;
const VERCEL_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '';
const TMP = (p) => path.join('/tmp', 'utax', p);

export const config = {
  port: Number(env('PORT', 8100)),
  host: env('HOST', '127.0.0.1'),
  nodeEnv: env('NODE_ENV', 'development'),
  dbPath: ON_VERCEL ? env('DB_PATH', TMP('replica.db')) : path.resolve(ROOT, env('DB_PATH', './data/finance.db')),
  jwtSecret: env('JWT_SECRET', 'dev-secret-change-me-please-32-bytes-min'),
  accessTtl: Number(env('ACCESS_TOKEN_TTL', 900)),
  refreshTtl: Number(env('REFRESH_TOKEN_TTL', 604800)),
  secretsKey: env('SECRETS_KEY', 'dev-secrets-key-change-me'),
  // Javob keshi (ms). Faqat og'ir GET hisobotlari uchun; har qanday yozuv keshni tozalaydi.
  // Vercel'da har SQL alohida tarmoq so'rovi (~27 ms) — shuning uchun u yerda standart holda yoqiq.
  // 0 — o'chiq. Lokalda kerak emas (baza shu yerda), shuning uchun standart 0.
  responseCacheMs: Number(env('RESPONSE_CACHE_MS', ON_VERCEL ? 30000 : 0)),
  // AI (erkin matn): Gemini asosiy, xato/limit bo'lsa Groq; ikkalasi ham bo'lmasa — qoidalar dvigateli (src/modules/ai.mjs)
  ai: {
    geminiKey: env('GEMINI_API_KEY', ''),
    groqKey: env('GROQ_API_KEY', ''),
    geminiModel: env('GEMINI_MODEL', 'gemini-3.6-flash'),
    geminiFallbackModels: String(env('GEMINI_FALLBACK_MODELS', 'gemini-3.5-flash,gemini-flash-latest')).split(/[\s,;]+/).filter(Boolean),
    groqModel: env('GROQ_MODEL', 'openai/gpt-oss-120b'),
    // Groq limitlari (TPM) har model uchun alohida — asosiy model limitga yetsa shu model bilan davom etadi
    groqFallbackModel: env('GROQ_FALLBACK_MODEL', 'openai/gpt-oss-20b'),
    maxTools: intEnv('AI_MAX_TOOLS', 8),
    geminiRpm: intEnv('GEMINI_RPM', 12),
    maskNames: env('AI_MASK_NAMES', 'true') !== 'false',
    memoryTurns: intEnv('AI_MEMORY_TURNS', 6),
    memoryHours: intEnv('AI_MEMORY_HOURS', 12),
    timeoutMs: intEnv('AI_TIMEOUT_MS', 25000, 1000),
    // `node --test` ostida haqiqiy LLM hech qachon chaqirilmaydi (testlar tarmoqsiz); majburlash: AI_LIVE_IN_TESTS=1
    live: !TEST_MODE || env('AI_LIVE_IN_TESTS', '') === '1',
  },
  // Telegram botlar (src/bots). TELEGRAM_BOT_TOKEN — eski yagona bot kaliti, rahbar botiga fallback.
  // UTAXERP (api.utaxerp.uz) — moliya ma'lumoti manbai. Token FAQAT .env da (git'ga tushmaydi):
  // repoga va tashkilotga ruxsati bor xodimgagina shaxsiy kanal orqali beriladi.
  erp: {
    token: env('ERP_TOKEN', ''),
    base: env('ERP_BASE', 'https://api.utaxerp.uz'),
    syncMs: intEnv('ERP_SYNC_MS', 3600000, 60000),
    fullAt: env('ERP_FULL_AT', '04:00'),
    autoRegister: env('ERP_AUTO_REGISTER', '1') !== '0',
  },
  bots: {
    rahbar: env('BOT_RAHBAR_TOKEN', env('TELEGRAM_BOT_TOKEN', '')),
    buxgalter: env('BOT_BUXGALTER_TOKEN', ''),
    sorov: env('BOT_SOROV_TOKEN', ''),
    signal: env('BOT_SIGNAL_TOKEN', ''),
  },
  // Egalar: Telegram user id'lar (FOUNDER roli, barcha botlar, avtomatik bog'lanadi)
  botOwnerIds: String(env('BOT_OWNER_IDS', '')).split(/[\s,;]+/).filter((x) => /^\d{5,15}$/.test(x)),
  // Vercel'da polling mumkin emas (doimiy jarayon yo'q) — standart webhook (PUBLIC_URL bo'lsa), aks holda off
  botMode: env('BOT_MODE', ON_VERCEL ? (env('PUBLIC_URL', VERCEL_URL) ? 'webhook' : 'off') : 'polling'), // polling | webhook | off
  publicUrl: env('PUBLIC_URL', ON_VERCEL ? VERCEL_URL : ''), // webhook uchun https manzil
  webappUrl: env('WEBAPP_URL', ON_VERCEL ? VERCEL_URL : ''), // botlardagi "Web'da ochish" tugmalari (https bo'lsa Telegram Mini App)
  webhookSecret: env('WEBHOOK_SECRET', ''),
  telegramAlertChat: env('TELEGRAM_ALERT_CHAT_ID', ''),
  emailWebhook: env('EMAIL_WEBHOOK_URL', ''),
  // Demo (pilot) ma'lumot faqat aniq so'ralganda: SEED_ON_EMPTY=true. Standart — bo'sh baza bo'sh qoladi (haqiqiy ma'lumot: npm run import:excel)
  seedOnEmpty: env('SEED_ON_EMPTY', 'false') === 'true',
  // Web uchun birinchi administrator (FOUNDER): server ishga tushganda yaratiladi/yangilanadi (src/core/bootstrap.mjs). Parol logga chiqmaydi
  admin: { email: env('ADMIN_EMAIL', ''), password: env('ADMIN_PASSWORD', ''), name: env('ADMIN_NAME', '') },
  publicDir: path.join(ROOT, 'public'),
  uploadsDir: ON_VERCEL ? TMP('uploads') : path.join(ROOT, 'uploads'),
  backupDir: ON_VERCEL ? TMP('backups') : path.join(ROOT, 'data', 'backups'),
  // Vercel Cron → GET /api/cron/tick (Authorization: Bearer CRON_SECRET)
  cronSecret: env('CRON_SECRET', ''),
};
