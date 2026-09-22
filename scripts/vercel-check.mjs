#!/usr/bin/env node
/**
 * Vercel'ga qo'yishdan oldin lokal tekshiruv: api/index.mjs funksiyasini Vercel muhitiga o'xshatib ishga tushiradi
 * (VERCEL=1, libSQL drayveri, cron kaliti) va asosiy yo'llarni sinaydi. Haqiqiy baza O'ZGARMAYDI — nusxasi ishlatiladi.
 *   npm run vercel:check            (libsql o'rnatilgan bo'lishi kerak: npm install)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(ROOT, 'data', 'finance.db');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'utax-vercel-'));
const copy = path.join(tmp, 'replica.db');
if (fs.existsSync(src)) fs.copyFileSync(src, copy);

Object.assign(process.env, { VERCEL: '1', DB_PATH: copy, DB_DRIVER: 'libsql', CRON_SECRET: 'check-secret', BOT_MODE: 'off', NODE_ENV: 'production', VERCEL_DEPLOYMENT_ID: 'dpl_check123' });
delete process.env.TURSO_DATABASE_URL;

const { default: handler } = await import('../api/index.mjs');
const srv = http.createServer(handler);
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const B = `http://127.0.0.1:${srv.address().port}`;
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) pass++; else fail++; console.log(`${c ? '✓' : '✗'} ${m}${extra ? ' — ' + extra : ''}`); };
const j = async (r) => { try { return await r.json(); } catch { return null; } };

const h = await j(await fetch(`${B}/api/health`));
ok(h?.ok && h.build === 'dplcheck123', 'health + build ID deploy’dan olinadi', h?.build);
const idx = await (await fetch(`${B}/`)).text();
ok(idx.includes('/v/dplcheck123/js/app.js') && idx.includes('manifest.webmanifest'), 'index.html versiyali aktivlar bilan');
ok((await fetch(`${B}/v/dplcheck123/css/app.css`)).headers.get('cache-control')?.includes('s-maxage'), 'versiyali CSS CDN keshi (s-maxage)');
ok((await fetch(`${B}/sw.js`)).status === 200, 'service worker');
ok((await fetch(`${B}/api/cron/tick`)).status === 401, 'cron kalitsiz → 401');
const cron = await fetch(`${B}/api/cron/tick`, { headers: { authorization: 'Bearer check-secret' } });
const cj = await j(cron);
ok(cron.status === 200 && Array.isArray(cj?.jobs), 'cron kalit bilan → vazifalar bajarildi', `${cj?.ms} ms, ${cj?.jobs?.length} vazifa`);

const login = await j(await fetch(`${B}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'founder@utax.uz', password: 'Utax2026!' }) }));
const tok = login?.access_token || login?.token;
ok(!!tok, 'login (libSQL orqali)');
const H = { authorization: 'Bearer ' + tok };
for (const p of ['/api/dashboard', '/api/treasury', '/api/contracts', '/api/expenses', '/api/reports/pnl?month=2026-07', '/api/reports/cash-flow?month=2026-07', '/api/receivables', '/api/audit', '/api/settings']) {
  const r = await fetch(B + p, { headers: H });
  const body = await r.text();
  ok(r.status === 200 && !body.includes('_metadata'), `GET ${p}`, r.status === 200 ? '' : body.slice(0, 120));
}
const acc = await j(await fetch(`${B}/api/banking/accounts`, { headers: H }));
ok(acc && 'bank' in acc, 'bank/kassa qoldiqlari', `bank ${acc?.bank?.total} · kassa ${acc?.cash?.total}`);
const w = await fetch(`${B}/api/notifications/read`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ all: true }) });
ok(w.status === 200, 'yozish (tranzaksiya) libSQL orqali');

srv.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nNATIJA: ${pass} o‘tdi, ${fail} xato`);
process.exit(fail ? 1 : 0);
