import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, ON_VERCEL } from './core/config.mjs';
import { openDb } from './core/db.mjs';
import { migrate } from './core/schema.mjs';
import { Router } from './core/router.mjs';
import { createRbac } from './core/rbac.mjs';
import { createSettings } from './core/settings.mjs';
import { createAudit } from './core/audit.mjs';
import { createScheduler } from './core/scheduler.mjs';
import { buildOpenApi as _buildOpenApi } from './core/openapi.mjs';
import { HttpError, parseUrl, readBody, sendJson, clientIp, rateLimiter, sendBuffer, setGzip, responseCache } from './core/http.mjs';
import { today, parseJson, nowIso } from './core/util.mjs';
import { decryptSecret, encryptSecret } from './core/auth.mjs';
import * as auth from './modules/auth.mjs';
import * as users from './modules/users.mjs';
import * as companies from './modules/companies.mjs';
import * as contracts from './modules/contracts.mjs';
import * as revenue from './modules/revenue.mjs';
import * as banking from './modules/banking.mjs';
import * as bankLedger from './modules/bank-ledger.mjs';
import { jwtExpiry } from './modules/bank-ledger.mjs';
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

const MODULES = [auth, users, companies, contracts, revenue, banking, bankLedger, reconciliation, approvals, expenses, receivables, payroll, budget, reports, forecast, notifications, integrations, ai, auditMod, settingsMod, botsMod];

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
  // Serverless (Vercel): ERP sinxroni funksiyaning 60 s chegarasiga sig'maydi — urinish "Task timed out"
  // bilan uziladi va yarim qolgan yozuv bazani qulflaydi. U yerda sinxron doimiy serverda/lokalda
  // ishlaydi, natija `npm run turso:push` bilan ko'chiriladi (DEPLOY-VERCEL.md §5.2).
  const ERP_SKIP = { skipped: 'serverless: ERP sinxroni lokal/doimiy serverda ishlaydi (erp:setup → turso:push)' };
  app.scheduler.add({ name: 'erp-sync', everyMs: config.erp.syncMs, description: 'UTAXERP moliya sync (avtomatik)', fn: async () => {
    if (ON_VERCEL) return ERP_SKIP;
    const integ = app.db.get("SELECT * FROM integrations WHERE type='UTAXERP' AND is_active=1 ORDER BY id DESC LIMIT 1");
    if (!integ) return { skipped: 'UTAXERP integratsiyasi ulanmagan' };
    const cfg = parseJson(integ.config, {});
    let sec = {}; try { sec = parseJson(decryptSecret(integ.secret_config), {}); } catch { return { error: 'token deshifrlanmadi' }; }
    const token = sec.api_key || sec.token;
    if (!token) return { skipped: 'token yo‘q' };
    const { erpSync } = await import('./import/erp-sync.mjs');
    let out;
    try { out = await erpSync(app, { token, base: cfg.base_url || 'https://api.utaxerp.uz' }); }
    catch (e) {
      // Xato bazaga yoziladi — dashboard "ERP tokeni eskirgan" bannerini shundan ko'rsatadi; oxirgi muvaffaqiyatli ma'lumot joyida qoladi.
      // 401 (token eskirgan) — har daqiqada qayta urinilmaydi: last_run yoziladi, keyingi urinish odatiy oraliqda (token yangilansa darhol).
      app.db.run("INSERT INTO settings (key,value,updated_at) VALUES ('scheduler.erp_last_error',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at", JSON.stringify({ at: nowIso(), message: e.message }), nowIso());
      if (/HTTP 401/.test(e.message)) return { error: e.message };
      throw e;
    }
    const { res, verify } = out;
    app.db.run("DELETE FROM settings WHERE key='scheduler.erp_last_error'");
    app.db.run('UPDATE integrations SET last_sync_at=?, last_status=? WHERE id=?', nowIso(), `+${res.income} kirim · ${res.contracts} yangi shartnoma${verify.ok ? '' : ' · SOLISHTIRUV FARQ'}`, integ.id);
    return { ...res, verify_ok: verify.ok };
  } });
  app.scheduler.add({ name: 'erp-full', dailyAt: config.erp.fullAt, description: 'UTAXERP to‘liq oyna (erp_raw) + kontragent INN boyitish', fn: async () => {
    if (ON_VERCEL) return ERP_SKIP;
    const integ = app.db.get("SELECT * FROM integrations WHERE type='UTAXERP' AND is_active=1 ORDER BY id DESC LIMIT 1");
    if (!integ) return { skipped: 'UTAXERP integratsiyasi ulanmagan' };
    const cfg = parseJson(integ.config, {});
    if (cfg.full_mirror === false) return { skipped: 'to‘liq oyna o‘chirilgan (full_mirror=false)' };
    let sec = {}; try { sec = parseJson(decryptSecret(integ.secret_config), {}); } catch { return { error: 'token deshifrlanmadi' }; }
    const token = sec.api_key || sec.token;
    if (!token) return { skipped: 'token yo‘q' };
    const { erpFullMirror } = await import('./import/erp-sync.mjs');
    const r = await erpFullMirror(app, { token, base: cfg.base_url || 'https://api.utaxerp.uz' });
    const { erpMapAll } = await import('./import/erp-map.mjs');
    const mapped = erpMapAll(app);
    return { ...r, mapped };
  } });
  app.scheduler.add({ name: 'backup', dailyAt: '03:00', description: 'Kunlik zaxira', fn: async () => { if (app.db.remote) return { skipped: 'Turso bazasi o‘z zaxirasini saqlaydi (point-in-time restore)' }; fs.mkdirSync(config.backupDir, { recursive: true }); const file = path.join(config.backupDir, `finance-${today()}.db`); if (app.db.driver === 'sqlite') { try { const { backup } = await import('node:sqlite'); await backup(app.db.raw, file); } catch { app.db.exec(`VACUUM INTO '${file}'`); } } else app.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`); const keep = Number(app.settings.get('backup.retention_days') || 60); for (const f of fs.readdirSync(config.backupDir)) { const p = path.join(config.backupDir, f); if (Date.now() - fs.statSync(p).mtimeMs > keep * 86400e3) fs.unlinkSync(p); } return { file }; } });
}

export function buildOpenApi(app) { return _buildOpenApi((app || createApp({ dbPath: ':memory:' })).r); }

// ---------------- HTTP ----------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
// Frontend build versiyasi: public/ ichidagi fayllarning eng oxirgi o‘zgarish vaqti.
// Aktivlar /v/<build>/... orqali beriladi — yangi versiyada URL o‘zgaradi, eski brauzer keshi ishlatilmaydi.
function frontendBuild() {
  // Vercel'da fayl vaqtlari deploylar orasida bir xil bo'lishi mumkin — versiya deploy ID'dan olinadi
  const dep = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA;
  if (dep) return dep.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(-12) || 'vercel';
  let max = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else max = Math.max(max, fs.statSync(f).mtimeMs); } };
  try { walk(config.publicDir); } catch {}
  return Math.floor(max).toString(36);
}
// Telegram Mini App: web.telegram.org ilovani iframe'da ochadi — faqat Telegram domenlariga ruxsat (X-Frame-Options'dan ustun)
const FRAME_ANCESTORS = "frame-ancestors 'self' https://web.telegram.org https://webk.telegram.org https://webz.telegram.org";
const TEXT_EXT = new Set(['.js', '.mjs', '.css', '.html', '.json', '.svg', '.webmanifest', '.map', '.txt']);
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
    return sendBuffer(res, 200, Buffer.from(html, 'utf8'), { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store', 'Content-Security-Policy': FRAME_ANCESTORS });
  }
  const head = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': versioned ? 'public, max-age=31536000, s-maxage=31536000, immutable' : 'no-cache', ...(ext === '.html' ? { 'Content-Security-Policy': FRAME_ANCESTORS } : {}) };
  // Matnli aktivlar (js/css/svg/json) siqiladi; rasm va shrift allaqachon siqilgan — oqim bilan beriladi
  if (TEXT_EXT.has(ext)) return sendBuffer(res, 200, fs.readFileSync(p), head);
  res.writeHead(200, head);
  fs.createReadStream(p).pipe(res);
}
const SWAGGER = `<!doctype html><html><head><meta charset="utf-8"><title>UTAX Finance API</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"></head><body><div id="ui"></div><script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/api/openapi.json',dom_id:'#ui',persistAuthorization:true})</script></body></html>`;

export function createServer(app) {
  return http.createServer(createHandler(app));
}

/** HTTP so'rov ishlovchisi — oddiy server (createServer) va Vercel funksiyasi (api/index.mjs) uchun umumiy */
export function createHandler(app) {
  const apiLimit = rateLimiter({ windowMs: 60_000, max: 900 });
  const rcache = responseCache(config.responseCacheMs);
  app.responseCache = rcache; // import/seed kabi to'g'ridan-to'g'ri yozuvlar ham tozalay olsin
  let openapiCache = null;
  return async (req, res) => {
    // Javobni siqish (sendJson/serveStatic shuni tekshiradi) — Vercel funksiya javobini o'zi siqmaydi
    setGzip(res, /gzip/.test(String(req.headers['accept-encoding'] || '')));
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
      // Shu so'rov davomida bir xil o'qishni takrorlamaslik uchun bo'sh kesh (yozuv bo'lsa o'zi tozalanadi)
      app.db.cacheScope(true);
      if (p === '/api/health') return sendJson(res, 200, { ok: true, time: new Date().toISOString(), version: '1.0.0', build: frontendBuild() });
      // Vercel Cron (yoki tashqi cron): vaqti kelgan fon vazifalarini bajaradi. Holat bazada saqlanadi — takroran ishga tushmaydi
      if (p === '/api/cron/tick') {
        if (!config.cronSecret || req.headers.authorization !== `Bearer ${config.cronSecret}`) throw new HttpError(401, 'UNAUTHORIZED', 'Cron kaliti noto‘g‘ri');
        const started = Date.now();
        const tickRes = await app.scheduler.tick({ budgetMs: 45000 });
        // Serverless'da bot intervallari ishonchli ishlamaydi — yuborilmay qolgan Telegram xabarlari cron bilan qayta yuboriladi
        try { await app.bots?.retryPending?.(); app.bots?.dialogs?.purgeExpired?.(); } catch (e) { console.warn('[cron] bot retry:', e.message); }
        return sendJson(res, 200, { ok: true, ms: Date.now() - started, ...tickRes, jobs: app.scheduler.list().map((j) => ({ name: j.name, last_run: j.last_run })) });
      }
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
      // Javob keshi: faqat GET va faqat `cache: true` belgilangan og'ir hisobotlar uchun.
      // Huquq tekshiruvidan KEYIN — kalitga foydalanuvchi id'si kiradi (ko'lam aralashmaydi).
      const ck = rcache.enabled && req.method === 'GET' && route.opts.cache ? rcache.key(p, query, ctx.user?.id) : null;
      if (ck) {
        const hit = rcache.get(ck);
        if (hit !== null) { res.setHeader('X-Cache', 'HIT'); return sendJson(res, 200, hit); }
      }
      const result = await route.handler(ctx);
      if (res.writableEnded) return;
      // Yozuv bo'lsa kesh eskiradi — butunlay tozalanadi (oddiy va xavfsiz)
      if (req.method !== 'GET' && rcache.enabled) rcache.clear();
      if (ck) { rcache.set(ck, result === undefined ? { ok: true } : result); res.setHeader('X-Cache', 'MISS'); }
      sendJson(res, 200, result === undefined ? { ok: true } : result);
    } catch (e) {
      if (res.writableEnded) return;
      if (e.message === 'RATE_LIMIT') return sendJson(res, 429, { error: 'RATE_LIMIT', message: 'Juda ko‘p urinish, 1 daqiqa kuting' });
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.code, message: e.message, details: e.details });
      console.error(`[http] ${req.method} ${p} →`, e);
      sendJson(res, 500, { error: 'INTERNAL', message: config.nodeEnv === 'production' ? 'Ichki xato' : e.message });
    } finally {
      app.db.cacheScope(false); // so'rov tugadi — kesh saqlanmaydi (fon vazifalari doim yangi o'qiydi)
      if (p.startsWith('/api/') && config.nodeEnv !== 'test') { const ms = Date.now() - started; if (ms > 800) console.log(`[http] slow ${req.method} ${p} ${ms}ms`); }
    }
  };
}

/** Ishga tushirishdagi umumiy qadamlar (server va Vercel funksiyasi uchun) */
export async function prepareApp(app) {
  if (config.seedOnEmpty && app.db.get('SELECT COUNT(*) c FROM users').c === 0) {
    console.log('[seed] Baza bo‘sh — tizim tuzilmasi yaratilmoqda (biznes ma’lumotlari faqat Excel orqali)…');
    const { seed } = await import('./seed/seed.mjs');
    await seed(app);
  }
  if (config.admin.email) {
    const { ensureBootstrapAdmin } = await import('./core/bootstrap.mjs');
    const a = ensureBootstrapAdmin(app, config.admin);
    console.log(`[admin] ADMIN_EMAIL: ${a.action}${a.reason ? ' — ' + a.reason : ''}`);
  }
  // Serverless (Vercel): har sovuq startda barcha shartnomani qayta hisoblash — eng qimmat qadam
  // (353 shartnomada sekundlar, masofaviy bazada undan ham ko'p) va u har instansiyada takrorlanadi.
  // Natija bazada saqlanadi, shuning uchun bu ishni `recompute-contracts` cron vazifasi bajaradi.
  if (!ON_VERCEL) app.services.contracts.recomputeAll();
  if (config.botOwnerIds.length) { ensureOwners(app, config.botOwnerIds); console.log(`[bots] egalar (FOUNDER): ${config.botOwnerIds.length} ta Telegram id`); }
  ensureErpIntegration(app);
  return app;
}

/**
 * .env dagi ERP_TOKEN bo'yicha UTAXERP integratsiyasini avtomatik ro'yxatga oladi/yangilaydi.
 * Token bazada shifrlangan holda saqlanadi (SECRETS_KEY). Token .env dan chiqmaydi — git'da yo'q.
 * Shu tufayli yangi xodim faqat .env ni qo'yadi, qolganini tizim o'zi qiladi (soatlik + kunlik sync).
 */
export function ensureErpIntegration(app) {
  const { token, base, autoRegister, tokenSource } = config.erp;
  if (!token || !autoRegister) return null;
  const src = tokenSource === 'vault' ? 'seyfdagi shifrlangan token' : '.env dagi ERP_TOKEN';
  const cur = app.db.get("SELECT * FROM integrations WHERE type='UTAXERP' ORDER BY id DESC LIMIT 1");
  const cfg = { base_url: base, endpoint: '/api/inOutMoney/find-many', mode: 'prisma', auth_type: 'bearer', since_field: 'date',
    field_map: { date: 'date', amount: 'value', direction: 'inOrOut', purpose: 'comment', id: 'id' }, page_size: 200, days_back: 900, bank_account_id: 1, full_mirror: true };
  const secret = encryptSecret(JSON.stringify({ api_key: token }));
  if (cur) {
    let same = false, dbToken = null;
    try { dbToken = parseJson(decryptSecret(cur.secret_config), {}).api_key; same = dbToken === token && parseJson(cur.config, {}).base_url === base && cur.is_active; } catch {}
    if (same) return cur.id;
    // UI orqali ("Tokenni yangilash") kiritilgan token manbadagidan yangiroq bo'lsa — eskisi bilan almashtirilmaydi
    const envExp = jwtExpiry(token), dbExp = jwtExpiry(dbToken);
    if (dbExp && (!envExp || dbExp > envExp)) return cur.id;
    app.db.run('UPDATE integrations SET config=?, secret_config=?, is_active=1 WHERE id=?', JSON.stringify(cfg), secret, cur.id);
    console.log(`[erp] UTAXERP integratsiyasi yangilandi (${src}) — sync har ${Math.round(config.erp.syncMs / 60000)} daq, to‘liq ${config.erp.fullAt}`);
    return cur.id;
  }
  const id = app.db.insert('integrations', { type: 'UTAXERP', name: `UTAXERP (${base.replace(/^https?:\/\//, '')})`, config: JSON.stringify(cfg), secret_config: secret, is_active: 1, created_at: nowIso() });
  console.log(`[erp] UTAXERP integratsiyasi ulandi (${src}) — sync har ${Math.round(config.erp.syncMs / 60000)} daq, to‘liq ${config.erp.fullAt}`);
  return id;
}

export async function main() {
  const app = await prepareApp(createApp());
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
