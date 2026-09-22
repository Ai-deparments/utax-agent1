/**
 * Vercel serverless funksiyasi — butun ilova (web + API + Telegram webhook + cron) shu bitta funksiya orqali.
 * vercel.json barcha yo'llarni shu yerga yo'naltiradi. Oddiy server (npm start) o'zgarmagan — bu faqat qo'shimcha kirish nuqtasi.
 *
 * Muhit o'zgaruvchilari (Vercel → Settings → Environment Variables):
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN — doimiy baza (majburiy; aks holda ma'lumot /tmp da va yo'qoladi)
 *   JWT_SECRET, SECRETS_KEY             — lokal .env dagi bilan bir xil (integratsiya sirlari shu kalit bilan shifrlangan)
 *   CRON_SECRET                         — Vercel Cron → /api/cron/tick
 *   GEMINI_API_KEY, BOT_*_TOKEN, WEBHOOK_SECRET, ADMIN_EMAIL/ADMIN_PASSWORD — ixtiyoriy
 */
import { config } from '../src/core/config.mjs';
import { createApp, createHandler, prepareApp } from '../src/server.mjs';
import { startBots } from '../src/bots/index.mjs';

let ready = null; // bitta instansiya ichida qayta ishlatiladi (cold start'da bir marta)
let lastSync = 0;

async function init() {
  if (!process.env.TURSO_DATABASE_URL && !process.env.LIBSQL_URL) {
    console.warn('[vercel] TURSO_DATABASE_URL berilmagan — baza /tmp da, har ishga tushishda YO‘QOLADI. Faqat sinov uchun.');
  }
  const app = await prepareApp(createApp());
  if (config.botMode === 'webhook') {
    // Webhook rejimida doimiy jarayon kerak emas: Telegram update'larni POST /telegram/<bot> ga yuboradi
    try { await startBots(app); } catch (e) { console.error('[bots] ishga tushmadi:', e.message); }
  }
  return { app, handler: createHandler(app) };
}

export default async function handler(req, res) {
  try {
    ready ??= init();
    const { app, handler: h } = await ready;
    // Boshqa instansiyalar yozgan o'zgarishlarni tortib olish (sqlite'da hech narsa qilmaydi). Juda tez-tez emas — 1 soniyada bir marta
    if (Date.now() - lastSync > 1000) { lastSync = Date.now(); try { app.db.sync(); } catch (e) { console.error('[db] sync:', e.message); } }
    return await h(req, res);
  } catch (e) {
    ready = null; // keyingi so'rovda qayta urinib ko'radi
    console.error('[vercel] init xatosi:', e);
    if (!res.headersSent) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json; charset=utf-8'); }
    res.end(JSON.stringify({ error: 'INIT_FAILED', message: 'Server ishga tushmadi — Vercel loglarini tekshiring (TURSO_DATABASE_URL, JWT_SECRET, SECRETS_KEY)' }));
  }
}
