#!/usr/bin/env node
/**
 * Sir skaneri (paketsiz) — CI va pre-push'da ishlaydi. Repo ochiq bo'lishi mumkin: token, kalit, baza yoki moliyaviy fayl
 * git'ga tushsa, qizil bo'ladi.
 *
 *   node scripts/secret-scan.mjs            — git'dagi (tracked) barcha fayllar
 *   node scripts/secret-scan.mjs --staged   — faqat commit'ga tayyorlangan o'zgarishlar
 *
 * Topilgan qiymat to'liq chiqarilmaydi (niqoblanadi). Yolg'on signal bo'lsa — qatorga `secret-scan: allow` izohini qo'shing.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const PATTERNS = [
  ['JWT token', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/],
  ['Telegram bot token', /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}\b/],
  ['Google API kaliti', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Groq API kaliti', /\bgsk_[A-Za-z0-9]{40,}\b/],
  ['Anthropic API kaliti', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI API kaliti', /\bsk-(proj-)?[A-Za-z0-9]{32,}\b/],
  ['AWS kaliti', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Private key', /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ['64 belgili hex kalit (DATA_VAULT_KEY/SECRETS_KEY)', /(?:KEY|SECRET)\s*[=:]\s*['"]?[0-9a-f]{64}\b/i],
];
// Git'ga umuman tushmasligi kerak bo'lgan fayllar
const FORBIDDEN = [
  [/(^|\/)\.env$|(^|\/)\.env\.(?!example$)[^/]+$/, '.env fayli'],
  [/(^|\/)\.erp-token$/, 'ERP token fayli'],
  [/^ERP\//, 'ERP papkasi (token rasmlari)'],
  [/\.(db|sqlite|sqlite3)(-wal|-shm)?$/, 'baza fayli'],
  [/(^|\/)data\/bank-registry\.json$/, 'bank reyestri (hisob raqamlari)'],
  [/\.(xlsx|xlsm|xls)$/, 'Excel fayli (shifrlanmagan moliyaviy ma’lumot)'],
];
const SKIP = [/^package-lock\.json$/, /^public\/icons\//, /\.(png|jpe?g|gif|ico|webp|woff2?|pdf|enc)$/i];

const staged = process.argv.includes('--staged');
const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const files = (staged ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']) : git(['ls-files'])).split('\n').filter(Boolean);
const mask = (s) => (s.length <= 10 ? '***' : `${s.slice(0, 6)}…${s.slice(-3)} (${s.length} belgi)`);
const problems = [];

for (const f of files) {
  const bad = FORBIDDEN.find(([re]) => re.test(f));
  if (bad) { problems.push(`${f}: ${bad[1]} git'da bo'lmasligi kerak`); continue; }
  if (SKIP.some((re) => re.test(f)) || !fs.existsSync(f)) continue;
  const text = staged ? git(['show', `:${f}`]) : fs.readFileSync(f, 'utf8');
  if (text.includes('\u0000')) continue; // binar fayl
  text.split('\n').forEach((line, i) => {
    if (line.includes('secret-scan: allow')) return;
    for (const [name, re] of PATTERNS) {
      const m = re.exec(line);
      if (m) problems.push(`${f}:${i + 1}: ${name} — ${mask(m[0])}`);
    }
  });
}

if (problems.length) {
  console.error(`✗ Sir skaneri: ${problems.length} ta muammo\n  ` + problems.join('\n  '));
  console.error('\nSirni kodga yozmang — .env / Vercel env / shifrlangan seyf (data/vault) ishlating. Token chiqib ketgan bo‘lsa — darhol revoke qiling.');
  process.exit(1);
}
console.log(`✓ Sir skaneri: ${files.length} fayl, muammo yo'q`);
