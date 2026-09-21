/** Buxgalter boti uchun umumiy yordamchilar: oy argumenti, oy navigatsiyasi, shartnoma qidirish, yorliqlar. */
import { today, monthOf, addMonths } from '../../../core/util.mjs';
import { BotError } from '../../shared/errors.mjs';
import { parseMonth, monthLabel, money, bar, pct } from '../../shared/format.mjs';

export const oyTekshir = (p) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(p || ''));

/** Buyruq argumentidan oy: bo'sh → joriy oy; noto'g'ri → BotError */
export function oyArg(args, standart = monthOf(today())) {
  const a = String(args || '').trim();
  if (!a) return standart;
  const m = parseMonth(a);
  if (!m) throw new BotError('📅 Oy formati: <code>2026-08</code>, <code>08.2026</code>, <code>avgust</code> yoki <code>o‘tgan oy</code>.');
  return m;
}

/** ◀️ oldingi oy / keyingi oy ▶️ (kelajak oylar ko'rsatilmaydi) */
export function oyNav(prefiks, period) {
  const oldin = addMonths(period, -1), keyin = addMonths(period, 1);
  const row = [{ text: `◀️ ${monthLabel(oldin)}`, cb: `${prefiks}:${oldin}` }];
  if (keyin <= monthOf(today())) row.push({ text: `${monthLabel(keyin)} ▶️`, cb: `${prefiks}:${keyin}` });
  return row;
}

/** Shartnoma qidirish: aniq raqam bo'lsa — faqat o'sha, aks holda raqam/mijoz/INN bo'yicha */
export function shartnomaQidir(S, q, { faqatQarzli = false } = {}) {
  const t = String(q || '').trim();
  if (!t) return [];
  let rows = S.contracts.list({ q: t });
  const aniq = rows.find((c) => c.contract_number.toLowerCase() === t.toLowerCase());
  if (aniq) rows = [aniq];
  if (faqatQarzli) rows = rows.filter((c) => c.remaining > 0.005 && !['CANCELLED', 'CLOSED', 'DRAFT'].includes(c.contract_status));
  return rows;
}

/** ▓▓▓▓▓░░░░░ 144% — chiziq 100% da to'xtaydi, foiz esa haqiqiy (byudjet oshishi, ortiqcha to'lov) */
export const chiziq = (p) => `${bar(p).split(' ')[0]} ${pct(p, 0)}`;

export const yonalish = (d) => (d === 'INCOME' ? '🟢 Kirim' : '🔴 Chiqim');
export const imzoliSumma = (d, amount) => `${d === 'INCOME' ? '+' : '−'}${money(amount)}`;
/** Bank hisobi nomi: "Kapitalbank · …9001" */
export const hisobNomi = (a) => `${a.bank_name}${a.account_number ? ` · …${String(a.account_number).replace(/\s/g, '').slice(-4)}` : ''}`;

/** Bog'lash sabablari (web transactions.js REASON bilan bir xil) */
const SABAB = {
  'contract number': 'shartnoma raqami', 'contract number in purpose': 'maqsadda shartnoma raqami', INN: 'INN', 'counterparty name': 'kontragent nomi',
  'amount = remaining': 'summa = qoldiq', 'amount = advance': 'summa = avans', 'amount = schedule': 'summa = jadval', 'amount ≤ remaining': 'summa ≤ qoldiq',
  'amount > remaining': 'summa > qoldiq', 'date near due': 'sana muddatga yaqin', amount: 'summa', counterparty: 'kontragent', purpose: 'maqsad', date: 'sana', 'expense code': 'xarajat kodi',
};
export const sabablar = (arr) => (arr || []).map((x) => SABAB[x] || x).join(', ');
