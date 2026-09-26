#!/usr/bin/env node
/**
 * UTAXERP → TO'LIQ tortish (barcha modellar → erp_raw) + kontragentlarni boyitish (INN/nom/manzil/telefon).
 * Asosiy mantiq: src/import/erp-sync.mjs → erpFullMirror (kunlik scheduler ham shundan foydalanadi).
 *
 *   node scripts/erp-full.mjs [--db data/finance-erp.db] [--base https://api.utaxerp.uz] [--only a,b] [--skip a,b]
 *
 * Token: ERP_TOKEN env yoki .erp-token. Faqat o'qish — ERP'ga hech narsa yozilmaydi.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/core/config.mjs'; // .env ni yuklaydi (ERP_TOKEN, ERP_BASE)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const base = opt('--base', config.erp.base);
const dbFile = path.resolve(ROOT, opt('--db', process.env.DB_PATH || 'data/finance-erp.db'));
const tokenFile = path.join(ROOT, '.erp-token');
// `config.erp.token` — muddati o'tmaganini tanlaydi (.env yoki seyf). Bu yerda `process.env.ERP_TOKEN`
// ni oldinga qo'yib bo'lmaydi: u `.env` dagi eski nusxa bo'lib, seyfdagi yangi tokenni bosib ketardi.
const token = (config.erp.token || (fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : ''));
if (!token) { console.error('ERP_TOKEN yo‘q (.erp-token yoki env)'); process.exit(2); }
if (config.erp.tokenSource) console.log(`token: ${config.erp.tokenSource === 'vault' ? 'seyf' : '.env'}${config.erp.tokenExpiresAt ? ` · muddati ${config.erp.tokenExpiresAt.slice(0, 10)}` : ''}`);
process.env.BOT_MODE = 'off';
process.env.DB_PATH = dbFile;

const { createApp } = await import('../src/server.mjs');
const { erpFullMirror } = await import('../src/import/erp-sync.mjs');
const app = createApp({ dbPath: dbFile });
console.log(`ERP: ${base} · baza: ${path.relative(ROOT, dbFile)}`);
const r = await erpFullMirror(app, { token, base, log: (m) => console.log(m), only: (opt('--only', '') || '').split(',').filter(Boolean), skip: (opt('--skip', '') || '').split(',').filter(Boolean) });

console.log('\n=== NATIJA ===');
console.log(`  modellar: ${r.ok}/${r.models} · erp_raw yozuvlari: ${r.rows.toLocaleString('ru-RU')}`);
if (r.failed.length) console.log(`  ruxsat yo‘q / xato: ${r.failed.join(', ')}`);
console.log(`  kontragent boyitildi: ${r.enriched} · INN: ${r.innSet} · nomi aniqlandi: ${r.renamed}`);
console.log(`  kontragentlarda INN: ${app.db.get("SELECT COUNT(*) c FROM companies WHERE inn IS NOT NULL AND inn<>''").c}/${app.db.get('SELECT COUNT(*) c FROM companies').c}`);
app.db.close();
