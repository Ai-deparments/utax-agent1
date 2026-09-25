#!/usr/bin/env node
/**
 * Ko'p kompaniyali bank qatlami (CLI). Asosiy mantiq: src/modules/bank-ledger.mjs (web API ham shundan foydalanadi).
 *
 *   node scripts/bank-import.mjs [--db data/finance-erp.db] [--registry data/bank-registry.json] [--preview] <fayl.xls> [<fayl.xls> ...]
 *
 * --registry: foydalanuvchi bergan reyestr (git'ga tushmaydi) — { companies:[{code,name,inn,client_code}],
 *   accounts:[{company_code,account_number,kind,label,bank_name,branch,mfo}], cash:[{account_number,period,opening,inflow,outflow,closing}] }
 * Fayllar: ASBT (Ipoteka) yoki Open Bank (Smart) ko'chirmasi. Nazoratdan o'tmagan fayl import qilinmaydi.
 * Idempotent: bir fayl qayta yuklansa, yozuvlar ikkilanmaydi. Oxirida har hisob bo'yicha tekshiruv jadvali chiqadi.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes(n);
const optNames = new Set(['--db', '--registry']);
const files = args.filter((a, i) => !a.startsWith('--') && !optNames.has(args[i - 1]));
const dbFile = path.resolve(ROOT, opt('--db', process.env.DB_PATH || 'data/finance-erp.db'));
const regFile = opt('--registry', null);

process.env.BOT_MODE = 'off';
process.env.DB_PATH = dbFile;
const { createApp } = await import('../src/server.mjs');
const app = createApp({ dbPath: dbFile });
const L = app.services.bankLedger;
const ctx = { user: null, ip: null, source: 'IMPORT' };
const fmt = (n) => (n === null || n === undefined ? '--' : Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, ' '));
let failed = false;

try {
  console.log(`baza: ${path.relative(ROOT, dbFile)}`);
  if (regFile) {
    const reg = JSON.parse(fs.readFileSync(path.resolve(ROOT, regFile), 'utf8'));
    for (const c of reg.companies || []) L.upsertCompany(c, ctx);
    for (const a of reg.accounts || []) L.upsertAccount(a, ctx);
    for (const c of reg.cash || []) {
      // source_file — kassa raqamlari olingan fayl yo'li (foydalanuvchi bergan Excel); UI'da "Manba: qo'lda" bosilganda yuklab olinadi
      const src = c.source_file ? path.resolve(ROOT, c.source_file) : null;
      L.setCashPeriod({ ...c, source_file: src && fs.existsSync(src) ? { file_name: path.basename(src), file_base64: fs.readFileSync(src).toString('base64') } : undefined }, ctx);
    }
    console.log(`reyestr: ${(reg.companies || []).length} kompaniya, ${(reg.accounts || []).length} hisob, ${(reg.cash || []).length} kassa davri`);
  }
  for (const f of files) {
    const buf = fs.readFileSync(path.resolve(f));
    const name = path.basename(f);
    try {
      const r = L.importStatement(buf, { fileName: name, preview: flag('--preview') }, ctx);
      console.log(`\n${name} [${r.format}] ${r.company} · ${r.label} · ${r.account} · ${r.period_from}..${r.period_to}`);
      console.log(`  ${fmt(r.opening)} + ${fmt(r.inflow)} − ${fmt(r.outflow)} = ${fmt(r.closing)} · ${r.ops} op. (yangi ${r.new_ops}, takror ${r.duplicates})${flag('--preview') ? ' · PREVIEW' : ''}`);
      if (r.internal.length) console.log(`  ichki o‘tkazma: ${r.internal.map((x) => `${x.tx_date} ${x.direction} ${fmt(x.amount)}`).join('; ')}`);
      if (!r.ok) { failed = true; for (const p of r.problems) console.log('  ✗ ' + p); }
    } catch (e) {
      failed = true;
      console.log(`\n${name}: ✗ ${e.message}`);
    }
  }
  // Tekshiruv jadvali: har hisob — boshlang'ich + tushum − xarajat = yakuniy (fayldagi bilan)
  for (const month of L.months().slice(0, 1)) {
    const g = L.summary({ month });
    console.log(`\nTekshiruv · ${month}`);
    console.log(['Hisob', 'Boshlang‘ich', 'Tushum', 'Xarajat', 'Balans', 'Fayldagi', 'Op.', 'Holat'].join(' | '));
    for (const a of g.accounts) console.log([`${a.company_code} ${a.label}`, fmt(a.opening), fmt(a.inflow_gross), fmt(a.outflow_gross), fmt(a.closing), fmt(a.closing_file), a.ops ?? '—', a.has_data ? (a.check_ok ? 'OK' : 'FARQ') : 'ma’lumot yo‘q'].join(' | '));
    for (const scope of [...g.registry.map((c) => ({ company: c.code })), {}]) {
      const s = L.summary({ ...scope, month });
      console.log(`${scope.company || 'GLOBAL'}: ${fmt(s.opening)} + ${fmt(s.inflow)} − ${fmt(s.outflow)} = ${fmt(s.closing)}  (yalpi: +${fmt(s.inflow_gross)} −${fmt(s.outflow_gross)}; ichki chiqarildi: ${fmt(s.internal_in)} / ${fmt(s.internal_out)})`);
    }
  }
} finally {
  app.db.close();
}
process.exit(failed ? 1 : 0);
