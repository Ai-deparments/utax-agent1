#!/usr/bin/env node
/**
 * ERP xom oynasi (erp_raw) → tizim jadvallariga moslashtirish (bo'lim, xodim, kategoriya, KPI, hisob nomi).
 * Avval `node scripts/erp-full.mjs` bilan erp_raw to'ldirilgan bo'lishi kerak.
 *
 *   node scripts/erp-map.mjs [--db data/finance-erp.db]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const dbFile = path.resolve(ROOT, opt('--db', process.env.DB_PATH || 'data/finance-erp.db'));
process.env.BOT_MODE = 'off'; process.env.DB_PATH = dbFile;
const { createApp } = await import('../src/server.mjs');
const { erpMapAll } = await import('../src/import/erp-map.mjs');
const app = createApp({ dbPath: dbFile });
console.log(`Moslashtirish: ${path.relative(ROOT, dbFile)}`);
const res = erpMapAll(app, { log: (m) => console.log(m) });
const c = (t) => app.db.get(`SELECT COUNT(*) c FROM ${t}`).c;
console.log('\n=== Jadvallar holati ===');
for (const t of ['departments', 'employees', 'expense_categories', 'employee_kpis']) console.log('  ', t.padEnd(20), c(t));
if (Object.keys(res.skipped).length) console.log('  o‘tkazib yuborildi:', JSON.stringify(res.skipped));
app.db.close();
