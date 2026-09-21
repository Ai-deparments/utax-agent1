/**
 * @utax_buxgalter_bot — moliya bo'limi operatsiyalari (FOUNDER, CFO, FINANCE_MANAGER, ACCOUNTANT).
 * Web bilan bir xil servislar va RBAC: Tushumlar (vipiska, bog'lash), Pul boshqaruvi (kassa), Xarajatlar (to'lov),
 * Shartnomalar (karta, akt), Daromad, KPI va oylik, Reja/Fakt (byudjet), Integratsiyalar, ma'lumot sifati, Tasdiqlashlar.
 * Erkin matn — AI moliya yordamchisi (default, web "AI moliya" bilan bir xil).
 */
import { esc } from '../shared/html.mjs';
import { lines, line, money, roleLabel } from '../shared/format.mjs';
import vipiska from './handlers/vipiska.mjs';
import boglash from './handlers/boglash.mjs';
import kassa from './handlers/kassa.mjs';
import xarajat from './handlers/xarajat.mjs';
import shartnoma from './handlers/shartnoma.mjs';
import oylik from './handlers/oylik.mjs';
import nazorat from './handlers/nazorat.mjs';
import vipiskaEslatmasi from './handlers/eslatma.mjs';

const QISMLAR = [vipiska, boglash, kassa, xarajat, shartnoma, oylik, nazorat];
const TARTIB = ['vipiska', 'boglash', 'tushumlar', 'kassa', 'tolov', 'xarajatlar', 'daromad', 'akt', 'shartnoma', 'oylik', 'byudjet', 'integratsiyalar', 'sifat', 'tasdiqlash'];
const barcha = QISMLAR.flatMap((q) => q.commands || []);

/** /start: salomlashish + bugungi ish navbati (faqat ruxsat etilgan ko'rsatkichlar) */
function startText(ctx) {
  const navbat = [];
  if (ctx.can('reconciliation', 'VIEW')) { const st = ctx.S.reconciliation.stats(); const n = (st.unmatched || 0) + (st.suggested || 0); navbat.push(line('🔗 Bog‘lanmagan tranzaksiyalar', `${n} ta`)); }
  if (ctx.can('expenses', 'EDIT')) { const t = ctx.S.expenses.approvedUnpaid(); navbat.push(line('💸 To‘lanishi kerak', `${t.n} ta · ${money(t.s)}`)); }
  if (ctx.can('approvals', 'VIEW')) navbat.push(line('✅ Sizning tasdig‘ingizni kutmoqda', `${ctx.S.approvals.pendingFor(ctx.user).length} ta`));
  return lines(
    `👋 Assalomu alaykum, <b>${esc(ctx.user.name)}</b>!`,
    `<b>UTAX Buxgalter</b> · ${esc(roleLabel(ctx.user.role_code))}`,
    '',
    navbat.length ? '<b>Bugungi navbat:</b>' : null,
    ...navbat,
    '',
    'Bo‘limni tanlang yoki savolingizni oddiy matn bilan yozing:',
  );
}

export default {
  key: 'buxgalter',
  username: 'utax_buxgalter_bot',
  title: 'UTAX Buxgalter',
  about: 'Moliya bo‘limi uchun: bank vipiskasi, tranzaksiyalarni bog‘lash, kassa, to‘lovlar, daromad va oylik — web panel bilan bir xil raqamlar.',
  short: 'UTAX buxgalteriya boti: vipiska, bog‘lash, kassa, to‘lov',
  audience: ['FOUNDER', 'CFO', 'FINANCE_MANAGER', 'ACCOUNTANT'],
  commands: TARTIB.map((nom) => barcha.find((c) => c.name === nom)),
  callbacks: Object.assign({}, ...QISMLAR.map((q) => q.callbacks || {})),
  dialogs: Object.assign({}, ...QISMLAR.map((q) => q.dialogs || {})),
  jobs: [vipiskaEslatmasi],
  startText,
  helpExtra: () => lines(
    '',
    '<b>Qisqa yo‘riqnoma:</b>',
    '📥 /vipiska → hisob → CSV/XLSX fayl → ✅ Import (takroriylar o‘tkaziladi, kirimlar avtomatik bog‘lanadi)',
    '🔗 /boglash → nomzodni tanlang yoki 🚫 e’tiborsiz (sabab bilan)',
    '📄 /shartnoma UTAX-R-00001 · /akt UTAX-R-00001 — karta va qabul akti',
    '📅 Oy argumenti: <code>/xarajatlar avgust</code>, <code>/oylik 2026-08</code>, <code>/byudjet o‘tgan oy</code>',
  ),
};
