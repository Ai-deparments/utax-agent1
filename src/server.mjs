import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './core/config.mjs';
import { openDb } from './core/db.mjs';
import { migrate } from './core/schema.mjs';
import { Router } from './core/router.mjs';
import { createRbac } from './core/rbac.mjs';
import { createSettings } from './core/settings.mjs';
import { createAudit } from './core/audit.mjs';
import { createScheduler } from './core/scheduler.mjs';
import { buildOpenApi as _buildOpenApi } from './core/openapi.mjs';
import { HttpError, parseUrl, readBody, sendJson, clientIp, rateLimiter } from './core/http.mjs';
import { today } from './core/util.mjs';
import * as auth from './modules/auth.mjs';
import * as users from './modules/users.mjs';
import * as companies from './modules/companies.mjs';
import * as contracts from './modules/contracts.mjs';
import * as revenue from './modules/revenue.mjs';
import * as banking from './modules/banking.mjs';
import * as reconciliation from './modules/reconciliation.mjs';
import * as approvals from './modules/approvals.mjs';
import * as expenses from './modules/expenses.mjs';
import * as receivables from './modules/receivables.mjs';
import * as payroll from './modules/payroll.mjs';
import * as budget from './modules/budget.mjs';
import * as reports from './modules/reports.mjs';
import * as forecast from './modules/forecast.mjs';
import * as notifications from './modules/notifications.mjs';
import * as integrations from './modules/integrations.mjs';
import * as ai from './modules/ai.mjs';
import * as auditMod from './modules/audit.mjs';
import * as settingsMod from './modules/settings.mjs';
import * as botsMod from './modules/bots.mjs';
import { startBots, registerBotJobs, botCatalog } from './bots/index.mjs';
import { ensureOwners } from './bots/shared/owners.mjs';

const MODULES = [auth, users, companies, contracts, revenue, banking, reconciliation, approvals, expenses, receivables, payroll, budget, reports, forecast, notifications, integrations, ai, auditMod, settingsMod, botsMod];

export function createApp({ dbPath = config.dbPath } = {}) {
  const db = openDb(dbPath);
  migrate(db);
  const rbac = createRbac(db);
  rbac.seedDefaults();
  const settings = createSettings(db);
  const audit = createAudit(db);
  const scheduler = createScheduler({ db, log: console });
  const r = new Router();
  const app = { r, db, rbac, settings, audit, scheduler, services: {}, config, bots: null };
  app.botCatalog = () => botCatalog(app);
  for (const m of MODULES) m.register(app);
  registerJobs(app);
  registerBotJobs(app);
  return app;
}

function registerJobs(app) {
  const S = () => app.services;
  const sys = { user: null, ip: null, source: 'SYSTEM' };
  const ag = (code) => ({ name: code.toLowerCase().replace(/_/g, '-'), fn: () => S().ai.runAgent(code) });
  app.scheduler.add({ name: 'recompute-contracts', description: 'Shartnoma statuslarini sanaga ko‘ra yangilash', everyMs: 6 * 3600e3, fn: () => { S().contracts.recomputeAll(); return { ok: true }; } });
  app.scheduler.add({ ...ag('COLLECTION'), dailyAt: '08:00', description: 'Undiruv agenti' });
  app.scheduler.add({ ...ag('DATA_QUALITY'), dailyAt: '08:10', description: 'Ma’lumot sifati' });
  app.scheduler.add({ ...ag('REVENUE'), dailyAt: '01:00', description: 'Obuna tan olish / akt nazorati' });
  app.scheduler.add({ ...ag('CFO'), dailyAt: '08:30', description: 'CFO digest' });
  app.scheduler.add({ ...ag('FORECAST'), dailyAt: '07:00', description: 'Forecast risk' });
  app.scheduler.add({ ...ag('AUDIT_ANOMALY'), dailyAt: '09:00', description: 'Anomaliya' });
  app.scheduler.add({ ...ag('PAYROLL'), dailyAt: '09:30', description: 'Oylik nazorati' });
  app.scheduler.add({ ...ag('RECEIVABLE'), dailyAt: '08:20', description: 'Aging hisoboti' });
  app.scheduler.add({ ...ag('EXPENSE'), dailyAt: '02:00', description: 'Kategoriyalash' });
  app.scheduler.add({ ...ag('APPROVAL'), everyMs: 3600e3, description: 'Tasdiq eslatmalari' });
  app.scheduler.add({ ...ag('CASH_FLOW'), everyMs: 1800e3, description: 'Likvidlik nazorati' });
  app.scheduler.add({ ...ag('BANK'), everyMs: 3600e3, description: 'Bank/ERP sync' });
  app.scheduler.add({ ...ag('RECONCILIATION'), everyMs: 3600e3, description: 'Reconciliation' });
  app.scheduler.add({ name: 'backup', dailyAt: '03:00', description: 'Kunlik zaxira', fn: async () => { fs.mkdirSync(config.backupDir, { recursive: true }); const file = path.join(config.backupDir, `finance-${today()}.db`); try { const { backup } = await import('node:sqlite'); await backup(app.db.raw, file); } catch { app.db.exec(`VACUUM INTO '${file}'`); } const keep = Number(app.settings.get('backup.retention_days') || 60); for (const f of fs.readdirSync(config.backupDir)) { const p = path.join(config.backupDir, f); if (Date.now() - fs.statSync(p).mtimeMs > keep * 86400e3) fs.unlinkSync(p); } return { file }; } });
}

export function buildOpenApi(app) { return _buildOpenApi((app || createApp({ dbPath: ':memory:' })).r); }

// ---------------- HTTP ----------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
// Frontend build versiyasi: public/ ichidagi fayllarning eng oxirgi o‘zgarish vaqti.
// Aktivlar /v/<build>/... orqali beriladi — yangi versiyada URL o‘zgaradi, eski brauzer keshi ishlatilmaydi.
function frontendBuild() {
  let max = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else max = Math.max(max, fs.statSync(f).mtimeMs); } };
  try { walk(config.publicDir); } catch {}
  return Math.floor(max).toString(36);
}
// Telegram Mini App: web.telegram.org ilovani iframe'da ochadi — faqat Telegram domenlariga ruxsat (X-Frame-Options'dan ustun)
const FRAME_ANCESTORS = "frame-ancestors 'self' https://web.telegram.org https://webk.telegram.org https://webz.telegram.org";
function serveStatic(reqPath, res) {
  let versioned = false;
  const vm = /^\/v\/[a-z0-9]+(\/.*)$/.exec(reqPath);
  if (vm) { reqPath = vm[1]; versioned = true; }
  let p = path.normalize(path.join(config.publicDir, reqPath));
  if (!p.startsWith(config.publicDir)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    if (path.extname(reqPath)) { res.writeHead(404); return res.end('Not found'); }
    p = path.join(config.publicDir, 'index.html');
  }
  const ext = path.extname(p);
  if (p === path.join(config.publicDir, 'index.html')) {
    const build = frontendBuild();
    const html = fs.readFileSync(p, 'utf8').replace(/(href|src)="\/(css|js)\//g, `$1="/v/${build}/$2/`).replace('<head>', `<head>\n<meta name="app-build" content="${build}">`);
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store', 'Content-Security-Policy': FRAME_ANCESTORS });
    return res.end(html);
  }
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'no-cache', ...(ext === '.html' ? { 'Content-Security-Policy': FRAME_ANCESTORS } : {}) });
  fs.createReadStream(p).pipe(res);
}
const SWAGGER = `<!doctype html><html><head><meta charset="utf-8"><title>UTAX Finance API</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"></head><body><div id="ui"></div><script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/api/openapi.json',dom_id:'#ui',persistAuthorization:true})</script></body></html>`;

export function createServer(app) {
  const apiLimit = rateLimiter({ windowMs: 60_000, max: 900 });
  let openapiCache = null;
  return http.createServer(async (req, res) => {
    const started = Date.now();
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    const { path: p, query } = parseUrl(req);
    try {
      if (p.startsWith('/telegram/') && req.method === 'POST') {
        if (!app.bots) { res.writeHead(404); return res.end(); }
        return await app.bots.handleWebhook(p.slice('/telegram/'.length).replace(/\/$/, ''), req, res);
      }
      if (!p.startsWith('/api/')) return serveStatic(p === '/' ? '/index.html' : p, res);
      if (p === '/api/health') return sendJson(res, 200, { ok: true, time: new Date().toISOString(), version: '1.0.0', build: frontendBuild() });
      if (p === '/api/openapi.json') { openapiCache ??= _buildOpenApi(app.r); return sendJson(res, 200, openapiCache); }
      if (p === '/api/docs') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(SWAGGER); }
      const ip = clientIp(req);
      if (!apiLimit(ip)) throw new HttpError(429, 'RATE_LIMIT', 'Juda ko‘p so‘rov');
      const m = app.r.match(req.method, p);
      if (!m) throw new HttpError(404, 'NOT_FOUND', 'Endpoint topilmadi');
      const { route, params } = m;
      const ctx = { req, res, params, query, ip, source: req.headers['x-source'] === 'API' ? 'API' : 'WEB', user: null, body: {} };
      if (route.opts.auth !== false) {
        ctx.user = app.services.auth.resolveUser(req);
        if (!ctx.user) throw new HttpError(401, 'UNAUTHORIZED', 'Avtorizatsiya talab qilinadi');
        if (ctx.user.is_agent) ctx.source = 'AI';
        if (route.opts.perm) app.rbac.require(ctx.user, route.opts.perm[0], route.opts.perm[1]);
      }
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) ctx.body = await readBody(req);
      const result = await route.handler(ctx);
      if (res.writableEnded) return;
      sendJson(res, 200, result === undefined ? { ok: true } : result);
    } catch (e) {
      if (res.writableEnded) return;
      if (e.message === 'RATE_LIMIT') return sendJson(res, 429, { error: 'RATE_LIMIT', message: 'Juda ko‘p urinish, 1 daqiqa kuting' });
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.code, message: e.message, details: e.details });
      console.error(`[http] ${req.method} ${p} →`, e);
      sendJson(res, 500, { error: 'INTERNAL', message: config.nodeEnv === 'production' ? 'Ichki xato' : e.message });
    } finally {
      if (p.startsWith('/api/') && config.nodeEnv !== 'test') { const ms = Date.now() - started; if (ms > 800) console.log(`[http] slow ${req.method} ${p} ${ms}ms`); }
    }
  });
}

export async function main() {
  const app = createApp();
  if (config.seedOnEmpty && app.db.get('SELECT COUNT(*) c FROM users').c === 0) {
    console.log('[seed] Baza bo‘sh — Iyul pilot ma’lumotlari yuklanmoqda…');
    const { seed } = await import('./seed/seed.mjs');
    await seed(app);
  }
  app.services.contracts.recomputeAll();
  if (config.botOwnerIds.length) { ensureOwners(app, config.botOwnerIds); console.log(`[bots] egalar (FOUNDER): ${config.botOwnerIds.length} ta Telegram id`); }
  const server = createServer(app);
  server.listen(config.port, config.host, () => {
    console.log(`UTAX Finance CRM → http://${config.host}:${config.port}  (API docs: /api/docs)`);
    app.scheduler.start();
    if (config.botMode === 'off') console.log('[bots] BOT_MODE=off — Telegram botlar o‘chirilgan');
    else startBots(app).catch((e) => console.error('[bots] ishga tushmadi:', e));
  });
  const shutdown = () => { console.log('shutting down'); app.scheduler.stop(); Promise.resolve(app.bots?.stop()).catch(() => {}); server.close(() => { app.db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return { app, server };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
