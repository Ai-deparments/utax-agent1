/**
 * UTAX Telegram botlari runtime — 4 bot bitta jarayonda, bitta baza va bitta RBAC bilan (web panel bilan umumiy).
 *   @utax_rahbar_bot    — rahbariyat (src/bots/rahbar)
 *   @utax_buxgalter_bot — moliya/buxgalteriya operatsiyalari (src/bots/buxgalter)
 *   @utax_sorov_bot     — xarajat so'rovlari va xodimning o'z ma'lumotlari (src/bots/sorov)
 *   @utax_signal_bot    — bildirishnomalar markazi (src/bots/signal)
 * Rejim: BOT_MODE=polling (lokal) | webhook (prod, PUBLIC_URL https + WEBHOOK_SECRET) | off.
 */
import crypto from 'node:crypto';
import { config } from '../core/config.mjs';
import { readBody } from '../core/http.mjs';
import { nowIso } from '../core/util.mjs';
import { createTelegramApi } from './shared/telegram-api.mjs';
import { createBot, ALLOWED_UPDATES } from './shared/bot-factory.mjs';
import { createDialogStore } from './shared/dialogs.mjs';
import { createDispatcher } from './shared/dispatcher.mjs';
import { webLinks } from './shared/keyboards.mjs';
import rahbar from './rahbar/bot.mjs';
import buxgalter from './buxgalter/bot.mjs';
import sorov from './sorov/bot.mjs';
import signal from './signal/bot.mjs';

export const BOT_DEFS = [rahbar, buxgalter, sorov, signal];
export const TOKEN_ENV = { rahbar: 'BOT_RAHBAR_TOKEN', buxgalter: 'BOT_BUXGALTER_TOKEN', sorov: 'BOT_SOROV_TOKEN', signal: 'BOT_SIGNAL_TOKEN' };

/** bot_state: polling offset, chat buyruqlar xeshi va h.k. */
export function createStateStore(db) {
  return {
    get: (key) => db.get('SELECT value FROM bot_state WHERE key=?', key)?.value ?? null,
    set: (key, value) => db.run('INSERT INTO bot_state (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at', key, String(value), nowIso()),
  };
}

/** Botlar katalogi (web: Sozlamalar → Telegram botlar; bog'lash havolalari). Botlar ishlamasa ham statik ma'lumot qaytadi. */
export function botCatalog(app) {
  return BOT_DEFS.map((d) => {
    const run = app.bots?.get(d.key);
    return {
      key: d.key, title: d.title, about: d.about, short: d.short || null, username: run?.username || d.username,
      configured: !!config.bots[d.key], running: !!run?.running, allowed_roles: [...d.audience],
      commands: d.commands.filter((c) => !c.hidden).map((c) => ({ name: c.name, desc: c.desc, usage: c.usage || null, perm: c.perm || null, roles: c.roles || null })),
    };
  });
}

/** Bot definitsiyalaridagi fon vazifalari (masalan 17:00 vipiska eslatmasi) — scheduler'ga */
export function registerBotJobs(app) {
  for (const d of BOT_DEFS) for (const j of d.jobs || []) {
    app.scheduler.add({ name: `bot-${d.key}-${j.name}`, description: j.description, dailyAt: j.dailyAt, everyMs: j.everyMs, fn: () => j.run(app) });
  }
}

const sleep = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

/**
 * @param opts.tokens      {rahbar, buxgalter, sorov, signal} (default: .env)
 * @param opts.mode        polling | webhook | off (off — faqat yuborish, update qabul qilinmaydi; testlar)
 * @param opts.apiFactory  (token, key) => Telegram API (testlarda soxta fetch bilan)
 */
export async function startBots(app, { tokens = config.bots, mode = config.botMode, apiFactory = (token) => createTelegramApi(token), log = console, links = webLinks(config), retryEveryMs = 60000, publicUrl = config.publicUrl, webhookSecret = config.webhookSecret, ownerIds = config.botOwnerIds, rateLimit } = {}) {
  const dialogs = createDialogStore(app.db);
  const state = createStateStore(app.db);
  const bots = new Map();
  const abort = new AbortController();
  let stopped = false;
  let timer = null;
  const pollers = [];

  const registry = {
    get: (key) => bots.get(key),
    list: () => [...bots.values()],
    usernameOf: (key) => bots.get(key)?.username || BOT_DEFS.find((d) => d.key === key)?.username || key,
    /** Rol uchun mos botlar (noto'g'ri botga yozganda maslahat) */
    suggestFor: (role, exceptKey) => BOT_DEFS.filter((d) => d.key !== exceptKey && d.audience.includes(role)).map((d) => ({ key: d.key, title: d.title, username: registry.usernameOf(d.key) })),
  };

  for (const def of BOT_DEFS) {
    const token = tokens?.[def.key];
    if (!token) { if (mode !== 'off') log.warn?.(`[bots] ${def.key}: ${TOKEN_ENV[def.key]} bo‘sh — bot o‘chiq`); continue; }
    bots.set(def.key, createBot(def, { app, api: apiFactory(token, def.key), dialogs, state, registry, links, log, ownerIds, ...(rateLimit ? { rateLimit } : {}) }));
  }
  const dispatcher = createDispatcher(app, registry, { log });

  async function poll(bot) {
    const key = `offset:${bot.key}`;
    let offset = Number(state.get(key) || 0);
    while (!stopped) {
      try {
        const updates = await bot.api.getUpdates({ offset, timeout: 25, allowed_updates: ALLOWED_UPDATES }, { timeoutMs: 40000, retries: 0, signal: abort.signal });
        bot.lastPollAt = nowIso();
        if (bot.lastError?.startsWith('poll:')) bot.lastError = null;
        for (const u of updates || []) { offset = Math.max(offset, u.update_id + 1); bot.enqueue(u); }
        if (updates?.length) state.set(key, offset);
      } catch (e) {
        if (stopped) break;
        bot.lastError = `poll: ${e.message}`.slice(0, 300);
        if (e.code === 401 || e.code === 404) { log.error?.(`[bots] ${bot.key}: token yaroqsiz (${e.code}) — polling to‘xtatildi`); bot.running = false; break; }
        if (e.code === 409) log.warn?.(`[bots] ${bot.key}: 409 — boshqa jarayon getUpdates qilyapti yoki webhook o‘rnatilgan`);
        await sleep(e.code === 409 ? 15000 : 5000, abort.signal);
      }
    }
  }

  async function setWebhook(bot) {
    const base = String(publicUrl || '').replace(/\/+$/, '');
    if (!/^https:\/\//.test(base) || !webhookSecret) { log.error?.('[bots] webhook: PUBLIC_URL (https) va WEBHOOK_SECRET kerak'); bot.running = false; return; }
    try { await bot.api.setWebhook(`${base}/telegram/${bot.key}`, webhookSecret, ALLOWED_UPDATES); log.info?.(`[bots] ${bot.key}: webhook o‘rnatildi`); }
    catch (e) { bot.lastError = `webhook: ${e.message}`; bot.running = false; log.error?.(`[bots] ${bot.key}: webhook o‘rnatilmadi: ${e.message}`); }
  }

  const facade = {
    mode, links, dialogs, state,
    get: registry.get,
    list: registry.list,
    catalog: () => botCatalog(app),
    running: () => registry.list().some((b) => b.running),
    dispatch: (id) => dispatcher.dispatch(id),
    deliver: (id) => dispatcher.deliver(id),
    flush: () => dispatcher.flush(),
    retryPending: (o) => dispatcher.retryPending(o),
    alertChat: (n) => dispatcher.alertChat(n),
    formatNotification: (n, user) => dispatcher.format(n, user),
    /** Foydalanuvchiga (users.id) shu bot orqali xabar */
    async send(botKey, userId, html, opts = {}) {
      const bot = bots.get(botKey);
      const u = app.db.get('SELECT * FROM users WHERE id=?', userId);
      if (!bot?.running) return { ok: false, error: 'Bot ishlamayapti' };
      if (!u?.telegram_user_id) return { ok: false, error: 'Telegram bog‘lanmagan' };
      try { const m = await bot.send(u.telegram_user_id, html, { ...opts, canView: (r) => app.rbac.can(u, r, 'VIEW') }); return { ok: true, message_id: m?.message_id ?? null }; }
      catch (e) { return { ok: false, error: e.description || e.message }; }
    },
    status() {
      return BOT_DEFS.map((d) => {
        const b = bots.get(d.key);
        return { key: d.key, title: d.title, username: b?.username || d.username, configured: !!tokens?.[d.key], running: !!b?.running, mode, started_at: b?.startedAt || null, last_update_at: b?.lastUpdateAt || null, last_poll_at: b?.lastPollAt || null, last_error: b?.lastError || null, handled: b?.handled || 0 };
      });
    },
    /** POST /telegram/<bot> — Telegram webhook (X-Telegram-Bot-Api-Secret-Token tekshiriladi) */
    async handleWebhook(key, req, res) {
      const bot = bots.get(key);
      if (!bot || mode !== 'webhook') { res.writeHead(404); return res.end(); }
      const got = Buffer.from(String(req.headers['x-telegram-bot-api-secret-token'] || ''));
      const want = Buffer.from(String(webhookSecret || ''));
      if (!want.length || got.length !== want.length || !crypto.timingSafeEqual(got, want)) { res.writeHead(401); return res.end(); }
      let update = null;
      try { const body = await readBody(req, 2 * 1024 * 1024); update = body?.raw ? JSON.parse(body.raw.toString('utf8')) : body; } catch { update = null; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      if (update && typeof update.update_id === 'number') bot.enqueue(update);
      return null;
    },
    async stop() {
      stopped = true;
      abort.abort();
      if (timer) clearInterval(timer);
      await Promise.allSettled(pollers);
      await dispatcher.flush();
    },
  };
  app.bots = facade;

  await Promise.all(registry.list().map(async (bot) => {
    try {
      await bot.init({ mode });
      bot.running = true;
      bot.startedAt = nowIso();
      if (mode !== 'off') log.info?.(`[bots] @${bot.username} (${bot.key}) ishga tushdi — ${mode}`);
    } catch (e) {
      bot.lastError = `init: ${e.message}`.slice(0, 300);
      log.error?.(`[bots] ${bot.key} ishga tushmadi: ${e.message}`);
    }
  }));

  if (mode === 'polling') for (const bot of registry.list()) if (bot.running) pollers.push(poll(bot));
  if (mode === 'webhook') for (const bot of registry.list()) if (bot.running) await setWebhook(bot);
  if (mode !== 'off' && retryEveryMs) {
    timer = setInterval(() => { dispatcher.retryPending().catch((e) => log.warn?.(`[bots] retry: ${e.message}`)); try { dialogs.purgeExpired(); } catch {} }, retryEveryMs);
    timer.unref();
    setTimeout(() => dispatcher.retryPending().catch(() => {}), 3000).unref();
  }
  return facade;
}
