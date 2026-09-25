#!/usr/bin/env node
/**
 * Lokal bazadagi biznes ma'lumotini Turso'ga (Vercel ishlatadigan baza) yuborish.
 *
 *   node scripts/turso-push.mjs [--db data/finance-erp.db] [--dry]
 *
 * Nega kerak: Vercel funksiyasida 60 soniya chegarasi bor, ERP'dan to'liq tortish esa undan uzoq
 * (urinishlar "Task timed out" va keyin "database is locked" bilan tugagan). Shuning uchun ERP sinxroni
 * lokalda (yoki doimiy serverda) ishlaydi, natija esa shu skript bilan Turso'ga ko'chiriladi.
 *
 * Talab: `.env` da TURSO_DATABASE_URL va TURSO_AUTH_TOKEN.
 * Ko'chirilmaydi: erp_raw (o'n minglab xom yozuv, saytda ishlatilmaydi), users/sessions (Vercel o'z
 * adminini ADMIN_EMAIL dan yaratadi), roles/permissions (startda avtomatik), integrations (sirlari
 * Vercel'dagi SECRETS_KEY bilan shifrlangan), audit/notifications (operatsion).
 *
 * Idempotent: INSERT OR REPLACE — qayta ishga tushirsangiz takror yozuv qo'shilmaydi.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/core/config.mjs';
import { openDb } from '../src/core/db.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const dry = args.includes('--dry');
const dbFile = path.resolve(ROOT, opt('--db', 'data/finance-erp.db'));

/** FK tartibida: ota jadval oldin */
const TABLES = [
  'service_types', 'expense_categories', 'departments', 'companies', 'employees',
  'contracts', 'payments', 'bank_accounts', 'cash_accounts', 'bank_transactions',
  'cash_transactions', 'collections', 'employee_kpis', 'forecasts',
  // Ko'p kompaniyali bank qatlami (bank ko'chirmalari, kassa yig'indisi, manba fayllari) — git'ga emas, faqat shu yo'l bilan serverga boradi
  'own_companies', 'own_accounts', 'bank_statements', 'bank_statement_lines', 'cash_period_entries', 'source_files',
];
const CHUNK = 100; // bitta so'rovda 100 qator — tarmoq safarlari kam bo'lsin

if (!config.db?.remoteUrl && !process.env.TURSO_DATABASE_URL) {
  console.error('TURSO_DATABASE_URL yo‘q — .env ga qo‘ying (TURSO_AUTH_TOKEN bilan birga).');
  process.exit(1);
}

const local = openDb(dbFile, { remote: null });
const remote = openDb(path.join(ROOT, 'data', '.turso-push.db'));
if (!remote.remote) { console.error('Masofaviy (Turso) ulanish ochilmadi — TURSO_* qiymatlarini tekshiring.'); process.exit(1); }

console.log(`manba: ${path.relative(ROOT, dbFile)} → Turso${dry ? ' (dry-run, yozilmaydi)' : ''}\n`);
let total = 0;
const t0 = Date.now();

for (const t of TABLES) {
  let rows;
  try { rows = local.all(`SELECT * FROM ${t}`); } catch { console.log(`  ${t.padEnd(22)} — manbada yo‘q`); continue; }
  if (!rows.length) { console.log(`  ${t.padEnd(22)} — bo‘sh`); continue; }
  let before;
  try { before = remote.get(`SELECT COUNT(*) c FROM ${t}`).c; } catch { console.log(`  ${t.padEnd(22)} — Turso'da jadval yo‘q, o‘tkazildi`); continue; }
  if (dry) { console.log(`  ${t.padEnd(22)} ${rows.length} qator (Turso'da hozir ${before})`); total += rows.length; continue; }
  const cols = Object.keys(rows[0]);
  const one = `(${cols.map(() => '?').join(',')})`;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    remote.run(`INSERT OR REPLACE INTO ${t} (${cols.join(',')}) VALUES ${part.map(() => one).join(',')}`, ...part.flatMap((r) => cols.map((c) => r[c])));
  }
  const after = remote.get(`SELECT COUNT(*) c FROM ${t}`).c;
  console.log(`  ${t.padEnd(22)} ${rows.length} yuborildi · Turso: ${before} → ${after}`);
  total += rows.length;
}

console.log(`\n${dry ? 'Yuborilishi kerak' : 'Yuborildi'}: ${total} yozuv · ${Math.round((Date.now() - t0) / 1000)} s`);
