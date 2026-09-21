import crypto from 'node:crypto';

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const sum = (arr, f = (x) => x) => round2(arr.reduce((a, x) => a + (Number(f(x)) || 0), 0));
export const pct = (a, b) => (Number(b) ? round2((Number(a) / Number(b)) * 100) : 0);

/** Jarayon vaqt zonasi: config.mjs TZ ni o'rnatadi (APP_TZ, default Asia/Tashkent); util config'siz import qilinsa ham shu default */
export function appTimeZone() {
  return process.env.TZ || process.env.APP_TZ || 'Asia/Tashkent';
}
const sanaFormatlar = new Map();
function sanaFormati(tz) {
  if (!sanaFormatlar.has(tz)) {
    let f = null;
    try { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }); } catch { /* Intl tanimaydigan TZ (masalan POSIX ':/etc/localtime') */ }
    sanaFormatlar.set(tz, f);
  }
  return sanaFormatlar.get(tz);
}
/**
 * Lahzaning mahalliy (jarayon TZ bo'yicha) kalendar sanasi — YYYY-MM-DD.
 * Scheduler dailyAt ham mahalliy vaqtda (setHours) — Toshkent 00:00–04:59 da UTC sana hali kechagi kun bo'lgani uchun
 * toISOString() ishlatilmaydi (01:00 REVENUE / 03:00 backup oldingi sana bilan ishlardi).
 */
export function localDate(d = new Date(), tz = appTimeZone()) {
  const f = sanaFormati(tz);
  if (f) {
    const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Bugungi biznes sana (mahalliy kalendar). Vaqt belgilari (created_at va h.k.) uchun — nowIso() (UTC) */
export function today() {
  return localDate(new Date());
}
export function nowIso() {
  return new Date().toISOString();
}
export function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}
export function monthOf(dateStr) {
  return String(dateStr).slice(0, 7);
}
export function monthRange(period) {
  // period 'YYYY-MM' → {from, to}
  const [y, m] = period.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}` };
}
export function addMonths(period, n) {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
export function monthsBetween(fromDate, toDate) {
  const a = new Date(fromDate + 'T00:00:00Z');
  const b = new Date(toDate + 'T00:00:00Z');
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + 1;
}
/** Davr → {from,to}. period: day|week|month|quarter|year|custom */
export function resolvePeriod(q, base = today()) {
  const p = (q.period || 'month').toLowerCase();
  if (p === 'custom' && q.from && q.to) { const dmy = (d) => d.split('-').reverse().join('.'); return { from: q.from, to: q.to, label: `${dmy(q.from)} — ${dmy(q.to)}` }; }
  if (q.month) {
    const r = monthRange(q.month);
    return { ...r, label: q.month };
  }
  const d = new Date(base + 'T00:00:00Z');
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (p === 'day') return { from: base, to: base, label: base };
  if (p === 'week') {
    const dow = (d.getUTCDay() + 6) % 7;
    const from = addDays(base, -dow);
    return { from, to: addDays(from, 6), label: `Hafta ${from}` };
  }
  if (p === 'quarter') {
    const qs = Math.floor(m / 3) * 3;
    const from = new Date(Date.UTC(y, qs, 1)).toISOString().slice(0, 10);
    const to = new Date(Date.UTC(y, qs + 3, 0)).toISOString().slice(0, 10);
    return { from, to, label: `Q${qs / 3 + 1} ${y}` };
  }
  if (p === 'year') return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
  const r = monthRange(base.slice(0, 7));
  return { ...r, label: base.slice(0, 7) };
}

export const uid = (n = 16) => crypto.randomBytes(n).toString('hex');
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const padCode = (prefix, n, w = 6) => `${prefix}-${String(n).padStart(w, '0')}`;

export function parseJson(v, d = null) {
  if (v === null || v === undefined || v === '') return d;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return d;
  }
}

export function pick(obj, keys) {
  const o = {};
  for (const k of keys) if (obj[k] !== undefined) o[k] = obj[k];
  return o;
}

/** Oddiy matn o'xshashligi (0..1) — kontragent nomi uchun */
export function similarity(a, b) {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const ta = new Set(na.split(' ')), tb = new Set(nb.split(' '));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}
export function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/["'«»“”]/g, '')
    .replace(/\b(mchj|ооо|ooo|xk|чп|yatt|ип|ltd|llc|mchj\.|aj|oaj|xt)\b/g, '')
    .replace(/[^a-z0-9а-яё\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
