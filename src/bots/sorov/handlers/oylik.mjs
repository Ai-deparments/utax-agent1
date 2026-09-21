/**
 * /oyligim, /kpi — xodimning FAQAT o'z oyligi va KPI'si (payroll.mine: employees.user_id = men).
 * Raqamlar oylik vedomostidan (payrolls) — web «KPI va oylik» bilan bir xil manba.
 */
import { esc } from '../../shared/html.mjs';
import { money, date, line, lines, muted, monthLabel, statusIcon, statusLabel, parseMonth } from '../../shared/format.mjs';
import { btn } from '../../shared/keyboards.mjs';
import { addMonths, monthOf, today } from '../../../core/util.mjs';

const KARTA_YOQ = '🔎 Sizning xodim kartangiz topilmadi. Oylik ma’lumotlari xodimlar ro‘yxatiga bog‘langan bo‘lishi kerak — HR yoki buxgalteriyaga murojaat qiling.';
const OY_XATO = '📅 Oyni tushunmadim. Masalan: <code>2026-08</code>, <code>avgust</code> yoki <code>o‘tgan oy</code>.';

/** Argumentdan oy: bo'sh → null (oxirgi hisoblangan oy), noto'g'ri → false */
function oyArg(args) {
  if (!args) return null;
  return parseMonth(args) || false;
}

/** Oy navigatsiyasi: ◀️ oldingi · keyingi ▶️ (joriy oydan keyin emas) */
function oyTugmalari(prefix, period) {
  if (!period) return [];
  const oldingi = addMonths(period, -1), keyingi = addMonths(period, 1);
  return [[btn.cb(`◀️ ${monthLabel(oldingi)}`, `${prefix}:${oldingi}`), keyingi <= monthOf(today()) ? btn.cb(`${monthLabel(keyingi)} ▶️`, `${prefix}:${keyingi}`) : null]];
}

function oylikKartasi(ctx, period) {
  const m = ctx.S.payroll.mine(ctx.user.id, period || undefined);
  if (!m) return { html: KARTA_YOQ, buttons: [] };
  const e = m.employee;
  const kim = `${esc(e.name)}${e.position ? ` · ${esc(e.position)}` : ''}${e.department_name ? ` (${esc(e.department_name)})` : ''}`;
  const tarix = m.history.length ? ['', '<b>Oxirgi oylar:</b>', ...m.history.map((h) => `${statusIcon(h.status)} ${esc(monthLabel(h.period))} — ${money(h.net)} · ${esc(statusLabel(h.status).toLowerCase())}`)] : [];
  const p = m.payroll;
  const buttons = [...oyTugmalari('s.pay', m.period), [btn.cb('📈 KPI', `s.kpi:${m.period || monthOf(today())}`), btn.web('🌐 KPI va oylik', 'payroll')]];
  if (!p) {
    return { html: lines(`💳 <b>Oylik — ${esc(monthLabel(m.period || monthOf(today())))}</b>`, kim, '', '📭 Bu oy uchun oylik hali hisoblanmagan.', ...tarix), buttons };
  }
  const html = lines(
    `💳 <b>Oylik — ${esc(monthLabel(p.period))}</b>`,
    kim,
    '',
    line('Fiks oylik', money(p.fixed)),
    line('KPI ustama', money(p.kpi)),
    p.piece_rate ? line('Ishbay', money(p.piece_rate)) : null,
    p.bonus ? line('Bonus', money(p.bonus)) : null,
    p.certificate_bonus ? line('Sertifikat bonusi', money(p.certificate_bonus)) : null,
    p.other ? line('Boshqa to‘lovlar', money(p.other)) : null,
    p.penalty ? line('Jarima', `−${money(p.penalty)}`) : null,
    `= Hisoblangan (gross): <b>${money(p.gross)}</b>`,
    p.deductions ? line('Ushlanma (daromad solig‘i)', `−${money(p.deductions)}`) : null,
    p.advance ? line('Avans', `−${money(p.advance)}`) : null,
    `💰 <b>Qo‘lga: ${money(p.net)}</b>`,
    `${line('Holat', statusLabel(p.status))}${p.paid_at ? ` · ${esc(date(p.paid_at))}` : ''}`,
    m.advances.length ? ['', '<b>Avanslar:</b>', ...m.advances.map((a) => `• ${esc(date(a.given_at))} — ${money(a.amount)}${a.note ? ` (${esc(a.note)})` : ''}`)] : null,
    ...tarix,
  );
  return { html, buttons };
}

function kpiKartasi(ctx, period) {
  const m = ctx.S.payroll.mine(ctx.user.id, period || undefined);
  if (!m) return { html: KARTA_YOQ, buttons: [] };
  const e = m.employee;
  const davr = m.period || period || monthOf(today());
  // Xodim bo'limiga tegishli KPI qoidalari (payroll.compute aynan shu qoidalar bo'yicha hisoblaydi)
  const qoidalar = ctx.db.all('SELECT name FROM kpi_rules WHERE is_active=1 AND (department_id=? OR department_id IS NULL) ORDER BY id', e.department_id);
  const jami = m.kpis.reduce((s, k) => s + (Number(k.kpi_amount) || 0), 0);
  const html = lines(
    `📈 <b>KPI — ${esc(monthLabel(davr))}</b>`,
    `${esc(e.name)}${e.department_name ? ` (${esc(e.department_name)})` : ''}`,
    '',
    m.payroll ? line('KPI ustama (oylik vedomostida)', money(m.payroll.kpi)) : muted('Bu oy uchun oylik hali hisoblanmagan.'),
    m.kpis.length
      ? ['', '<b>Metrikalar:</b>', ...m.kpis.map((k) => `• ${esc(k.rule_name || k.rule_code || 'KPI')}: ${esc(k.metric_value ?? '—')} → <b>${money(k.kpi_amount)}</b>${k.note ? ` <i>(${esc(k.note)})</i>` : ''}`), line('Metrikalar jami', money(jami))]
      : muted('Qo‘lda kiritilgan metrika yo‘q — KPI qoidalar bo‘yicha avtomatik hisoblangan.'),
    qoidalar.length ? ['', '<b>Sizga tegishli KPI qoidalari:</b>', ...qoidalar.map((q) => `• ${esc(q.name)}`)] : null,
  );
  return { html, buttons: [...oyTugmalari('s.kpi', davr), [btn.cb('💳 Oylik', `s.pay:${davr}`), btn.web('🌐 KPI va oylik', 'payroll')]] };
}

export async function oyligim(ctx) {
  const oy = oyArg(ctx.args);
  if (oy === false) return ctx.reply(OY_XATO);
  const k = oylikKartasi(ctx, oy);
  return ctx.reply(k.html, { buttons: k.buttons });
}

export async function kpi(ctx) {
  const oy = oyArg(ctx.args);
  if (oy === false) return ctx.reply(OY_XATO);
  const k = kpiKartasi(ctx, oy);
  return ctx.reply(k.html, { buttons: k.buttons });
}

const OY_RE = /^20\d{2}-(0[1-9]|1[0-2])$/;
export const oylikCallbacks = {
  /** s.pay:<YYYY-MM> — boshqa oyning oyligi (xabar joyida yangilanadi) */
  's.pay': async (ctx) => {
    const oy = ctx.cbArgs[0];
    if (!OY_RE.test(oy || '')) return ctx.answer('Noto‘g‘ri oy', true);
    const k = oylikKartasi(ctx, oy);
    await ctx.edit(k.html, { buttons: k.buttons });
    return ctx.answer();
  },
  /** s.kpi:<YYYY-MM> */
  's.kpi': async (ctx) => {
    const oy = ctx.cbArgs[0];
    if (!OY_RE.test(oy || '')) return ctx.answer('Noto‘g‘ri oy', true);
    const k = kpiKartasi(ctx, oy);
    await ctx.edit(k.html, { buttons: k.buttons });
    return ctx.answer();
  },
};
