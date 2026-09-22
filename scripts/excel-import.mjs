#!/usr/bin/env node
/**
 * UTAX Excel moliya jurnalini bazaga import qilish (faqat Excel ma'lumoti — demo/pilot ma'lumot yaratilmaydi).
 *
 *   node scripts/excel-import.mjs <fayl.xlsx> [--db data/finance.db] [--reset] [--dry-run] [--sheet Sheet1] [--report hisobot.json] [--fix-date 69=2026-07-20]
 *
 *   --dry-run  faqat o'qish + tekshiruv + reja (bazaga hech narsa yozilmaydi)
 *   --reset    yangi toza baza: eski fayl (va -wal/-shm) <baza papkasi>/backups/ ga ko'chiriladi (o'chirilmaydi),
 *              keyin faqat tizim ma'lumotnomasi (rollar/ruxsatlar) + Excel ma'lumoti yoziladi
 *   --report   natijani JSON faylga yozish (haqiqiy ma'lumot — git'ga tushmaydigan joyga: data/imports/ .gitignore'da)
 *
 * Xato (tuzilma buzilgan, valyuta, nolga yopilmaydigan guruh) bo'lsa hech narsa yozilmaydi, chiqish kodi 1.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const optNames = new Set(['--db', '--sheet', '--report', '--fix-date']);
const file = args.find((a, i) => !a.startsWith('--') && !optNames.has(args[i - 1]));
if (!file || flag('--help') || flag('-h')) {
  console.log('Foydalanish: node scripts/excel-import.mjs <fayl.xlsx> [--db data/finance.db] [--reset] [--dry-run] [--sheet <varaq>] [--report <fayl.json>]');
  process.exit(file ? 0 : 2);
}
if (!fs.existsSync(file)) { console.error(`Fayl topilmadi: ${file}`); process.exit(2); }

const dryRun = flag('--dry-run'), reset = flag('--reset');
// --db berilsa — shu fayl; aks holda config (DB_PATH, standart data/finance.db). config importidan OLDIN o'rnatiladi.
if (opt('--db')) process.env.DB_PATH = path.resolve(opt('--db'));
process.env.BOT_MODE = 'off';

const { config } = await import('../src/core/config.mjs');
const { parseJournal } = await import('../src/import/excel-journal.mjs');
const { applyJournal, verifyImport, formatReport } = await import('../src/import/apply-journal.mjs');
const dbPath = config.dbPath;

// --fix-date 69=2026-07-20 (bir nechta: 69=...,70=...) — foydalanuvchi tasdiqlagan sana tuzatishi
const dateFixes = {};
for (const pair of String(opt('--fix-date') || '').split(',').filter(Boolean)) {
  const m = /^(\d+)=(\d{4}-\d{2}-\d{2})$/.exec(pair.trim());
  if (!m) { console.error(`--fix-date noto‘g‘ri: ${pair} (kutilgan: qator=YYYY-MM-DD)`); process.exit(2); }
  dateFixes[Number(m[1])] = m[2];
}
const plan = parseJournal(fs.readFileSync(file), { fileName: path.basename(file), sheet: opt('--sheet'), dateFixes });
const writeReport = (obj) => { const p = opt('--report'); if (p) { fs.mkdirSync(path.dirname(path.resolve(p)), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2)); console.log(`\nHisobot (JSON): ${path.resolve(p)}`); } };

if (plan.errors.length || dryRun) {
  console.log(formatReport(plan, null, null, { dryRun: true }));
  writeReport({ plan });
  if (plan.errors.length) { console.error(`\n${plan.errors.length} ta xato — bazaga hech narsa yozilmadi.`); process.exit(1); }
  process.exit(0);
}

if (reset && fs.existsSync(dbPath)) {
  const dir = path.join(path.dirname(dbPath), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(dir, `${path.basename(dbPath, path.extname(dbPath))}-pre-import-${stamp}${path.extname(dbPath) || '.db'}`);
  try {
    for (const sfx of ['', '-wal', '-shm']) if (fs.existsSync(dbPath + sfx)) fs.renameSync(dbPath + sfx, target + sfx);
  } catch (e) {
    console.error(`Bazani ko‘chirib bo‘lmadi (${e.code || e.message}) — server ishlayaptimi? Avval to‘xtating. Hech narsa o‘zgartirilmadi.`);
    process.exit(1);
  }
  console.log(`[reset] Eski baza ko‘chirildi (o‘chirilmadi): ${target}`);
}

const { createApp } = await import('../src/server.mjs');
const app = createApp({ dbPath });
let result;
try {
  result = applyJournal(app, plan);
} catch (e) {
  console.log(formatReport(plan, null, null, { dryRun: true }));
  console.error(`\nIMPORT TO‘XTATILDI (hech narsa yozilmadi): ${e.message}`);
  app.db.close();
  process.exit(1);
}
const verify = verifyImport(app, plan);
console.log(`Baza: ${dbPath}`);
console.log(formatReport(plan, result, verify));
writeReport({ plan, result, verify });
app.db.close();
process.exit(verify.ok ? 0 : 3);
