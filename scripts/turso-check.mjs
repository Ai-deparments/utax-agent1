/**
 * Turso bazasiga qarshi barcha asosiy API yo'llarini tekshirish (HTTP'siz, to'g'ridan-to'g'ri handler).
 * Maqsad: Turso SQL parseri rad etadigan yana boshqa so'rovlar bor-yo'qligini topish.
 * prepareApp CHAQIRILMAYDI — u .env dagi ADMIN_EMAIL bilan yangi foydalanuvchi yaratib yuborardi.
 */
import '../src/core/config.mjs';
import { createApp } from '../src/server.mjs';

const app = createApp();
if (!app.db.remote) { console.error('XATO: masofaviy (Turso) ulanish emas'); process.exit(1); }

const user = app.db.get("SELECT * FROM users WHERE role_code='FOUNDER' AND is_active=1");
if (!user) { console.error('XATO: FOUNDER foydalanuvchi topilmadi'); process.exit(1); }
console.log(`baza: Turso · foydalanuvchi: ${user.email}\n`);

const MONTH = '2026-08';
const PATHS = [
  '/api/dashboard', '/api/treasury', '/api/banking/accounts', '/api/contracts', '/api/companies',
  '/api/payments', '/api/receivables', '/api/expenses', '/api/employees', '/api/departments',
  '/api/payroll', `/api/reports/pnl?month=${MONTH}`, `/api/reports/cash-flow?month=${MONTH}`,
  '/api/reports/balance', '/api/reports/planfact', '/api/reports/forecast', '/api/reports/data-quality',
  '/api/approvals', '/api/notifications', '/api/audit', '/api/settings', '/api/integrations',
  '/api/ai/agents', '/api/collections',
];

const size = (v) => (Array.isArray(v) ? `${v.length} ta` : v && typeof v === 'object' ? `${Object.keys(v).length} maydon` : String(v));
let ok = 0; const bad = []; const upper = [];

// Turso kalit so'z bo'lgan SQL taxalluslarini KATTA HARFDA qaytaradi (masalan `MIN(d) first` → FIRST).
// Bunday kalit frontendga mos kelmaydi va jimgina buziladi — javoblarni skanerdan o'tkazamiz.
const scanKeys = (v, path, depth = 0) => {
  if (!v || typeof v !== 'object' || depth > 4) return;
  if (Array.isArray(v)) { if (v.length) scanKeys(v[0], `${path}[0]`, depth + 1); return; }
  for (const [k, val] of Object.entries(v)) {
    if (/^[A-Z][A-Z_0-9]*$/.test(k) && k.length > 1) upper.push(`${path}.${k}`);
    scanKeys(val, `${path}.${k}`, depth + 1);
  }
};

for (const full of PATHS) {
  const [p, qs] = full.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  const m = app.r.match('GET', p);
  if (!m) { bad.push([full, 'ROUTE YO‘Q']); continue; }
  const ctx = { req: { headers: {} }, res: { writableEnded: false }, params: m.params, query, ip: '127.0.0.1', source: 'WEB', user, body: {} };
  try {
    const out = await m.route.handler(ctx);
    ok++;
    scanKeys(out, full);
    let extra = '';
    if (Array.isArray(out)) extra = `${out.length} qator`;
    else if (out && typeof out === 'object') {
      const rows = out.rows || out.items || out.data;
      extra = Array.isArray(rows) ? `${rows.length} qator` : Object.keys(out).slice(0, 6).map((k) => `${k}=${size(out[k])}`).join(' · ');
    }
    console.log(`  OK   ${full.padEnd(38)} ${extra}`);
  } catch (e) {
    bad.push([full, e.message]);
    console.log(`  XATO ${full.padEnd(38)} ${e.message.slice(0, 110)}`);
  }
}

console.log(`\nNATIJA: ${ok} ta o‘tdi, ${bad.length} ta xato`);
if (bad.length) { console.log('\nXatolar:'); for (const [p, e] of bad) console.log(` - ${p}\n   ${e.slice(0, 200)}`); }
if (upper.length) { console.log(`\n⚠ KATTA HARFLI kalitlar (Turso kalit-so'z taxallusi): ${upper.length} ta`); for (const u of upper) console.log('   ' + u); }
else console.log('\nKatta harfli kalit topilmadi — kalit-so’z taxallusi muammosi yo’q');
