#!/usr/bin/env node
/**
 * UTAXERP → baza (CLI). Asosiy mantiq: src/import/erp-sync.mjs (scheduler ham shundan foydalanadi).
 *
 *   ERP_TOKEN=<jwt> node scripts/erp-import.mjs [--db data/finance-erp.db] [--base https://api.utaxerp.uz] [--reset]
 *   (yoki --token-file <fayl>; standart .erp-token)
 *
 * Idempotent: qayta ishlaganda faqat yangi/o'zgargan yozuvlar. --reset: eski bazani backups/ ga ko'chiradi.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/core/config.mjs'; // .env ni yuklaydi (ERP_TOKEN, ERP_BASE)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes(n);
const base = (opt('--base', config.erp.base));
const dbFile = path.resolve(ROOT, opt('--db', process.env.DB_PATH || 'data/finance-erp.db'));
const tokenFile = opt('--token-file', path.join(ROOT, '.erp-token'));
const { pickErpToken } = await import('../src/import/erp-sync.mjs');
const fileToken = fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : '';
// Muddati o'tmagan token tanlanadi: `.env` dagi eski nusxa yangisini bosib ketmasin
const picked = pickErpToken([{ name: path.basename(tokenFile), token: fileToken }, { name: 'ERP_TOKEN / .env', token: process.env.ERP_TOKEN || config.erp.token }]);
if (!picked.token) { console.error(`ERP tokeni yaroqsiz: ${picked.reason}`); process.exit(2); }
const token = picked.token;
console.log(`token: ${picked.name}${picked.exp ? ` · muddati ${new Date(picked.exp * 1000).toISOString().slice(0, 16).replace('T', ' ')}` : ''}`);

process.env.BOT_MODE = 'off';
process.env.DB_PATH = dbFile;

if (flag('--reset') && fs.existsSync(dbFile)) {
  const dir = path.join(path.dirname(dbFile), 'backups'); fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const sfx of ['', '-wal', '-shm']) if (fs.existsSync(dbFile + sfx)) fs.renameSync(dbFile + sfx, path.join(dir, `${path.basename(dbFile, '.db')}-pre-erp-${stamp}.db${sfx.slice(4)}`));
  console.log('[reset] eski baza backups/ ga ko‘chirildi');
}

const { createApp } = await import('../src/server.mjs');
const { erpSync } = await import('../src/import/erp-sync.mjs');
const app = createApp({ dbPath: dbFile });
console.log(`ERP: ${base} · baza: ${path.relative(ROOT, dbFile)}`);
const { res, verify } = await erpSync(app, { token, base, log: (m) => console.log(m) });

console.log('\n=== Yozildi ===');
console.log(`  bank hisob: ${res.accounts} · kassa: ${res.cash} · kompaniya: ${res.companies} · shartnoma: ${res.contracts} · kirim: ${res.income}${res.dup ? ` · takror(o‘tkazildi): ${res.dup}` : ''}`);
console.log('=== ERP ↔ baza ===');
console.log(`  ${verify.income_count_ok ? 'OK ' : 'FARQ'} kirim soni: ERP ${verify.erp.income} | baza ${res.income + res.dup}`);
console.log(`  ${verify.income_sum_ok ? 'OK ' : 'FARQ'} kirim summasi: ERP ${verify.erp.income_sum.toLocaleString('ru-RU')} | baza ${verify.db.income_sum.toLocaleString('ru-RU')}`);
console.log(`  shartnoma: ERP ${verify.erp.contracts} | yozildi ${res.contracts}`);
app.db.close();
console.log(`\nTayyor. Ishga tushirish:  DB_PATH=${path.relative(ROOT, dbFile)} npm start`);
process.exit(verify.ok ? 0 : 3);
