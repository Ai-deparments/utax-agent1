/**
 * Bot javoblaridagi formatlar — web panel (public/js/ui.js) bilan aynan bir xil yorliq va ko'rinish:
 * summa "12 500 000 so‘m", sana "17.09.2026", statuslar o'zbekcha.
 * Barcha funksiyalar HTML-xavfsiz (esc qilingan) qator qaytaradi, agar nomida "raw" bo'lmasa.
 */
import { esc } from './html.mjs';
import { today, addDays, addMonths, monthOf } from '../../core/util.mjs';

const NB = '\u00a0';
/** 12 500 000 (bo'sh joy — bo'linmaydigan, Telegram'da raqam qatorga bo'linib ketmaydi) */
export const fmt = (n, digits = 0) => {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '--';
  return Number(n).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/[\u00a0\u202f\s]/g, NB).replace(/,/g, '.');
};
export const CUR = 'so‘m';
export const money = (n) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '--' : `${fmt(n)}${NB}${CUR}`);
/** +12 000 so‘m / −5 000 so‘m */
export const signed = (n) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '--' : `${Number(n) > 0 ? '+' : Number(n) < 0 ? '−' : ''}${money(Math.abs(Number(n) || 0))}`);
/** 1,2 mlrd / 12,5 mln / 500 ming */
export const short = (n) => {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '--';
  const a = Math.abs(Number(n) || 0), s = Number(n) < 0 ? '−' : '';
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2).replace('.', ',')}${NB}mlrd`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1).replace('.', ',')}${NB}mln`;
  if (a >= 1e3) return `${s}${Math.round(a / 1e3)}${NB}ming`;
  return s + fmt(a);
};
export const pct = (n, digits = 1) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '--' : `${Number(n).toFixed(digits).replace('.', ',')}%`);
/** 2026-09-17 → 17.09.2026 */
export const date = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '--');
/** ISO vaqt → 17.09.2026 14:05 (Toshkent) */
export const dt = (iso) => {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
};
const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
/** 2026-09 → Sentabr 2026 */
export const monthLabel = (p) => { const [y, m] = String(p || '').split('-'); return MONTHS[Number(m) - 1] ? `${MONTHS[Number(m) - 1]} ${y}` : String(p || '--'); };

// ---------- Yorliqlar (web ui.js / app.js bilan bir xil) ----------
export const STATUS_LABEL = {
  DRAFT: 'Qoralama', ACTIVE: 'Faol', ADVANCE_EXPECTED: 'Avans kutilmoqda', ADVANCE_RECEIVED: 'Avans olindi', IN_PROGRESS: 'Jarayonda', SERVICE_COMPLETED: 'Xizmat yakunlandi', FINAL_PAYMENT_EXPECTED: 'Yakuniy to‘lov kutilmoqda', PAID: 'To‘langan', OVERDUE: 'Muddati o‘tgan', CLOSED: 'Yopilgan', CANCELLED: 'Bekor qilingan',
  NOT_STARTED: 'Boshlanmagan', ON_HOLD: 'To‘xtatilgan', COMPLETED: 'Yakunlangan', EXPECTED: 'Kutilmoqda', PARTIAL: 'Qisman to‘langan',
  UNMATCHED: 'Bog‘lanmagan', SUGGESTED: 'Taklif', MATCHED: 'Bog‘langan', IGNORED: 'E’tiborsiz',
  PENDING: 'Kutilmoqda', APPROVED: 'Tasdiqlangan', REJECTED: 'Rad etilgan', POSTPONED: 'Kechiktirilgan', SUBMITTED: 'Yuborilgan', PENDING_APPROVAL: 'Tasdiq kutmoqda', RECOGNIZED: 'Tan olingan',
  CUSTOMER_ADVANCE: 'Mijoz avansi', RECOGNIZED_REVENUE: 'Tan olingan daromad', REFUNDABLE: 'Qaytariladi', REFUNDED: 'Qaytarilgan',
  OPEN: 'Ochiq', DONE: 'Bajarildi', SUPERSEDED: 'Eskirgan', PROPOSED: 'Taklif', EXECUTED: 'Bajarildi', FAILED: 'Xato',
  INFO: 'Ma’lumot', WARNING: 'Ogohlantirish', CRITICAL: 'Kritik', OK: 'Yaxshi', WARN: 'Diqqat', BAD: 'Bajarilmadi', NO_PLAN: 'Reja yo‘q', LOSS: 'Zarar', LOW: 'Past', NO_DATA: 'Ma’lumot yo‘q', HIGH: 'Yuqori', MEDIUM: 'O‘rta',
  INCOME: 'Kirim', EXPENSE: 'Chiqim', RUNNING: 'Ishlamoqda', ERROR: 'Xato', EMPTY: 'Bo‘sh',
};
export const statusLabel = (s) => STATUS_LABEL[s] || s || '--';
const STATUS_ICON = {
  OVERDUE: '🔴', UNMATCHED: '🔴', REJECTED: '🔴', CRITICAL: '🔴', BAD: '🔴', LOSS: '🔴', HIGH: '🔴', FAILED: '🔴', ERROR: '🔴', REFUNDABLE: '🔴',
  PENDING: '🟡', SUGGESTED: '🟡', ADVANCE_EXPECTED: '🟡', FINAL_PAYMENT_EXPECTED: '🟡', PENDING_APPROVAL: '🟡', WARNING: '🟡', WARN: '🟡', LOW: '🟡', MEDIUM: '🟡', EXPECTED: '🟡', OPEN: '🟡', PROPOSED: '🟡', ON_HOLD: '🟡', POSTPONED: '⏸',
  PAID: '🟢', MATCHED: '🟢', APPROVED: '🟢', RECOGNIZED: '🟢', COMPLETED: '🟢', OK: '🟢', DONE: '🟢', EXECUTED: '🟢', SERVICE_COMPLETED: '🟢',
  ACTIVE: '🔵', IN_PROGRESS: '🔵', ADVANCE_RECEIVED: '🔵', PARTIAL: '🔵', INFO: '🔵', SUBMITTED: '🔵',
};
export const statusIcon = (s) => STATUS_ICON[s] || '⚪';
/** 🔴 Muddati o‘tgan */
export const status = (s) => `${statusIcon(s)} ${esc(statusLabel(s))}`;

export const ROLE_LABEL = { FOUNDER: 'Ta’sischi', CEO: 'Bosh direktor', CFO: 'Moliya direktori', FINANCE_MANAGER: 'Moliya menejeri', ACCOUNTANT: 'Buxgalter', SALES: 'Sotuv menejeri', DEPARTMENT_HEAD: 'Bo‘lim rahbari', EMPLOYEE: 'Xodim', AUDITOR: 'Auditor', ADMIN: 'Administrator', AI_AGENT: 'AI agent', EXECUTIVE_DIRECTOR: 'Ijrochi direktor' };
export const roleLabel = (r) => ROLE_LABEL[r] || r || '--';
/** Tasdiqlash zanjiridagi qadam nomi (web approvals.js ROLE) */
export const STEP_LABEL = { DEPARTMENT_HEAD: 'Bo‘lim rahbari', FINANCE_MANAGER: 'Moliya menejeri', CFO: 'Moliya direktori', CEO: 'Bosh direktor', FOUNDER: 'Ta’sischi', ACCOUNTANT: 'Buxgalteriya', EXECUTIVE_DIRECTOR: 'Ijrochi direktor' };
export const stepLabel = (r) => STEP_LABEL[r] || r || '--';
export const APPROVAL_TYPE = { EXPENSE: 'Xarajat', REVENUE_RECOGNITION: 'Daromad', PAYROLL: 'Oylik', CONTRACT_CHANGE: 'Shartnoma', AI_ACTION: 'AI harakati' };
export const approvalType = (t) => APPROVAL_TYPE[t] || t || '--';
export const GROUP_LABEL = { DIRECT: 'To‘g‘ridan-to‘g‘ri xarajatlar', PAYROLL: 'Oylik (xodimlar)', MARKETING: 'Marketing', ADMIN: 'Ma’muriy', IT: 'IT va aloqa', OFFICE: 'Ofis xarajatlari', OTHER_OPEX: 'Boshqa operatsion', UNCATEGORIZED: 'Kategoriyasiz (tasdiqlanmagan)', TAX: 'Soliqlar', OTHER: 'Boshqa' };
export const SEVERITY_ICON = { CRITICAL: '🔴', WARNING: '🟡', INFO: '🔵' };
export const PAYMENT_METHOD = { BANK: 'Bank o‘tkazmasi', CASH: 'Naqd (kassa)', CARD: 'Karta' };

// ---------- Matn bloklari (HTML) ----------
/** "Label: <b>qiymat</b>" — qiymat esc qilinadi */
export const line = (label, value) => `${esc(label)}: <b>${esc(value)}</b>`;
/** Satrlarni birlashtirish (null/false/undefined tashlab yuboriladi); elementlar allaqachon HTML */
export const lines = (...xs) => xs.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false).join('\n');
/** 📊 <b>Sarlavha</b> */
export const title = (icon, text) => `${icon ? icon + ' ' : ''}<b>${esc(text)}</b>`;
export const muted = (text) => `<i>${esc(text)}</i>`;
export const bullet = (html) => `• ${html}`;
/** ▓▓▓▓▓░░░░░ 50% — chiziq 0..100 da kesiladi, foiz haqiqiy (144% ham) */
export const bar = (value, width = 10) => { const raw = Number(value) || 0; const v = Math.max(0, Math.min(100, raw)); const full = Math.round((v / 100) * width); return `${'▓'.repeat(full)}${'░'.repeat(width - full)} ${pct(raw, 0)}`; };
/** Raqamlangan ro'yxat: items.map(fn) → "1. ..." */
export const numbered = (items, fn) => items.map((x, idx) => `${idx + 1}. ${fn(x, idx)}`).join('\n');
/** Qisqartirish (uzun maqsad/izohlar uchun), esc qilinmaydi */
export const clip = (s, n = 60) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// ---------- Kiritilgan matnni tahlil qilish ----------
/** parseAmount yuqori chegarasi: undan katta summa xato yozilgan (ortiqcha nol / ajratgich) deb rad etiladi */
const SUMMA_MAX = 1e13;
/**
 * Summa: "12 500 000", "12500000", "12,5 mln", "1.2 mlrd", "500 ming", "500k", "12 mln so'm", "12 500 000,50" → son yoki null
 *
 * Ajratgich qoidalari (shubhali yozuv → null, taxmin qilinmaydi):
 *  - minglik guruhi bitta sonda BIR XIL ajratgich bilan: "12 500 000" | "12,500,000" | "12.500.000"; "12.500" → 12 500
 *    (1–3 raqam + ajratgich + aynan 3 raqamli guruhlar); aralash guruh ("12 500.000.000") yoki noto'g'ri guruh ("1 2 3", "1234 567") → null;
 *  - kasr: oxirgi "." yoki "," dan keyin 1–2 raqam ("2500000.50", "12,5"); guruhlangan sonda kasr ajratgichi guruh ajratgichidan
 *    FARQLI bo'lishi shart ("12 500 000,50", "12,500,000.50", "12.500.000,50");
 *  - guruhlangan son + boshqa turdagi ajratgich + 3 raqam — bu KASR (minglik emas): "12 500 000.000" → 12 500 000;
 *    3-raqam 0 bo'lmasa tiyin aniqligi yo'qoladi ("100 000 000.123") → null; guruhsiz "1234.500" (kasrmi, minglikmi — noaniq) → null;
 *  - natija 0 dan katta va SUMMA_MAX (1e13) dan oshmasligi kerak.
 */
export function parseAmount(text) {
  const t = String(text ?? '').toLowerCase().replace(/[\u00a0\u202f]/g, ' ').replace(/so['‘ʻ’`]?m|сум|uzs/g, '').trim();
  const m = /^(\d[\d\s.,]*?)\s*(mlrd|млрд|milliard|mln|млн|million|m|ming|минг|тыс|k)?\.?$/.exec(t);
  if (!m) return null;
  const raw = m[1].trim().replace(/\s+/g, ' ');
  const mult = { mlrd: 1e9, млрд: 1e9, milliard: 1e9, mln: 1e6, млн: 1e6, million: 1e6, m: 1e6, ming: 1e3, минг: 1e3, тыс: 1e3, k: 1e3 }[m[2]] || 1;
  /** Minglik guruhlari (bir xil ajratgich): "12 500 000" → 12500000 */
  const guruhli = (s) => (/^\d{1,3}(?:([ .,])\d{3})(?:\1\d{3})*$/.test(s) ? Number(s.replace(/[ .,]/g, '')) : null);
  /** Guruhlangan butun qism + boshqa turdagi kasr ajratgichi: "12 500 000,50", "12 500 000.000" */
  const guruhliKasr = (s) => {
    const g = /^(\d{1,3}(?:([ .,])\d{3})(?:\2\d{3})*)([.,])(\d{1,3})$/.exec(s);
    if (!g || g[2] === g[3]) return null; // "12.500.000.50" — guruh va kasr ajratgichi bir xil → noaniq
    if (g[4].length === 3 && g[4][2] !== '0') return null; // tiyindan (0,01) mayda qism — shubhali
    return Number(`${g[1].replace(/[ .,]/g, '')}.${g[4]}`);
  };
  let value;
  if (mult > 1) {
    // "12,5 mln", "1.2 mlrd", "1,500 mln" (qo'shimcha bilan bitta ajratgich — kasr: 1,5 mln), "1 500 ming"
    if (/^\d+(?:[.,]\d+)?$/.test(raw)) value = Number(raw.replace(',', '.'));
    else value = guruhli(raw) ?? guruhliKasr(raw);
    if (value === null) return null;
    value *= mult;
  } else if (/^\d+$/.test(raw)) value = Number(raw);
  else if ((value = guruhli(raw)) !== null) { /* "12 500 000", "12,500,000", "12.500.000" */ }
  else if (/^\d+[.,]\d{1,2}$/.test(raw)) value = Number(raw.replace(',', '.')); // "2500000.50", "12,5"
  else if ((value = guruhliKasr(raw)) === null) return null;
  const res = Math.round(value * 100) / 100;
  return Number.isFinite(res) && res > 0 && res <= SUMMA_MAX ? res : null;
}

const MONTH_WORDS = { yanvar: 1, fevral: 2, mart: 3, aprel: 4, may: 5, iyun: 6, iyul: 7, avgust: 8, sentabr: 9, sentyabr: 9, oktabr: 10, oktyabr: 10, noyabr: 11, dekabr: 12, январ: 1, феврал: 2, март: 3, апрел: 4, май: 5, мая: 5, июн: 6, июл: 7, август: 8, сентябр: 9, октябр: 10, ноябр: 11, декабр: 12 };
/**
 * Oy: "2026-08", "08.2026", "8", "avgust", "avgust 2026", "o'tgan oy", "shu oy" → "YYYY-MM" yoki null
 */
export function parseMonth(text, base = today()) {
  const t = String(text ?? '').toLowerCase().trim();
  if (!t) return null;
  let m;
  if ((m = /^(20\d{2})-(0[1-9]|1[0-2])$/.exec(t))) return `${m[1]}-${m[2]}`;
  if ((m = /^(0?[1-9]|1[0-2])[./-](20\d{2})$/.exec(t))) return `${m[2]}-${m[1].padStart(2, '0')}`;
  if (/o['‘ʻ’`]?tgan oy|прошл/.test(t)) return addMonths(monthOf(base), -1);
  if (/^(shu|joriy|bu) oy|^текущ/.test(t)) return monthOf(base);
  if ((m = /^(0?[1-9]|1[0-2])$/.exec(t))) return `${base.slice(0, 4)}-${m[1].padStart(2, '0')}`;
  for (const [w, n] of Object.entries(MONTH_WORDS)) {
    if (t.startsWith(w)) { const y = /20\d{2}/.exec(t)?.[0] || base.slice(0, 4); return `${y}-${String(n).padStart(2, '0')}`; }
  }
  return null;
}

/** Sana: "25.09.2026", "25.09", "2026-09-25", "bugun", "ertaga", "indinga", "+3" (kun) → "YYYY-MM-DD" yoki null */
export function parseDate(text, base = today()) {
  const t = String(text ?? '').toLowerCase().trim();
  if (!t) return null;
  if (t === 'bugun') return base;
  if (t === 'ertaga') return addDays(base, 1);
  if (t === 'indinga') return addDays(base, 2);
  let m;
  if ((m = /^\+(\d{1,3})$/.exec(t))) return addDays(base, Number(m[1]));
  let y, mo, d;
  if ((m = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(t))) [y, mo, d] = [m[1], m[2], m[3]];
  else if ((m = /^(\d{1,2})[./](\d{1,2})(?:[./](20\d{2}|\d{2}))?$/.exec(t))) { d = m[1]; mo = m[2]; y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : base.slice(0, 4); }
  else return null;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const chk = new Date(iso + 'T00:00:00Z');
  return !Number.isNaN(chk.getTime()) && chk.toISOString().slice(0, 10) === iso ? iso : null;
}
