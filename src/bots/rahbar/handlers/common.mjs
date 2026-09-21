/** Rahbar boti uchun umumiy yordamchilar: ruxsatlar, oy argumenti, oy navigatsiyasi, o'zgarish foizi, ruxsatli tugmalar. */
import { esc } from '../../shared/html.mjs';
import { parseMonth, monthLabel, pct } from '../../shared/format.mjs';
import { BotError } from '../../shared/errors.mjs';
import { today, monthOf, addMonths } from '../../../core/util.mjs';

/** Ruxsatlar — web route'lar bilan bir xil (src/modules/*.mjs) */
export const P = {
  dashboard: ['dashboard', 'VIEW'], treasury: ['treasury', 'VIEW'], pnl: ['pnl', 'VIEW'], cashflow: ['cashflow', 'VIEW'], balance: ['balance', 'VIEW'],
  planfact: ['planfact', 'VIEW'], forecast: ['forecast', 'VIEW'], receivables: ['receivables', 'VIEW'], approvals: ['approvals', 'VIEW'],
  ai: ['ai', 'VIEW'], aiRun: ['ai', 'CREATE'], aiApprove: ['ai', 'APPROVE'], aiReject: ['ai', 'REJECT'],
  export: ['reports', 'EXPORT'], users: ['users', 'VIEW'], usersEdit: ['users', 'EDIT'],
};

const MONTH_RE = /^20\d{2}-(0[1-9]|1[0-2])$/;
export const isMonth = (m) => MONTH_RE.test(String(m || ''));
export const currentMonth = () => monthOf(today());

/** Buyruq argumenti → 'YYYY-MM' (bo'sh → joriy oy; tushunarsiz → BotError) */
export function monthArg(args) {
  const a = String(args || '').trim();
  if (!a) return currentMonth();
  const m = parseMonth(a);
  if (!m) throw new BotError(`📅 Oyni tushunmadim: «${esc(a)}». Masalan: <code>2026-08</code>, <code>avgust</code>, <code>o‘tgan oy</code>.`);
  return m;
}
/** Callback argumenti → 'YYYY-MM' (noto'g'ri qiymat → joriy oy) */
export const monthCb = (v) => (isMonth(v) ? v : currentMonth());

/** ◀️ oldingi oy / keyingi oy ▶️ — kelajak oyiga o'tmaydi */
export function monthNav(prefix, month) {
  const prev = addMonths(month, -1), next = addMonths(month, 1);
  return [{ text: `◀️ ${monthLabel(prev)}`, cb: `${prefix}:${prev}` }, next <= currentMonth() ? { text: `${monthLabel(next)} ▶️`, cb: `${prefix}:${next}` } : null];
}

/** O'tgan oyga nisbatan o'zgarish: " (▲ +4,5%)" / " (▼ −12,7%)"; ma'lumot yo'q → '' */
export function delta(d) {
  if (d === null || d === undefined || Number.isNaN(Number(d))) return '';
  const v = Number(d);
  if (v === 0) return ' <i>(0%)</i>';
  return v > 0 ? ` <i>(▲ +${pct(v)})</i>` : ` <i>(▼ −${pct(Math.abs(v))})</i>`;
}

/** ▓▓▓▓▓▓▓▓▓▓ 110% — to'ldirish 100% da to'xtaydi, foiz haqiqiy qiymat */
export function meter(value, width = 10) {
  const v = Number(value) || 0;
  const full = Math.round((Math.max(0, Math.min(100, v)) / 100) * width);
  return `${'▓'.repeat(full)}${'░'.repeat(width - full)} ${pct(v, 0)}`;
}

/** Tugma faqat ruxsat bo'lsa (aks holda null — klaviaturadan tushib qoladi) */
export const cmdIf = (ctx, perm, text, name, args) => (ctx.can(perm[0], perm[1]) ? { text, cmd: name, ...(args ? { args } : {}) } : null);
export const cbIf = (ctx, perm, text, data) => (ctx.can(perm[0], perm[1]) ? { text, cb: data } : null);
