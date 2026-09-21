/** /foyda, /xizmatlar, /pul_oqimi, /balans, /reja, /prognoz — web: Foyda va zarar, Pul oqimi, Balans, Reja/Fakt, Prognoz. */
import { esc } from '../../shared/html.mjs';
import { money, signed, pct, date, lines, line, title, muted, bullet, statusLabel, monthLabel } from '../../shared/format.mjs';
import { BotError } from '../../shared/errors.mjs';
import { P, monthArg, monthCb, monthNav, meter, cmdIf } from './common.mjs';

// ---------- Foyda va zarar ----------
function pnlCard(ctx, month) {
  const p = ctx.S.reports.pnl({ month });
  const rows = p.lines
    .filter((l) => l.kind === 'total' || Math.abs(Number(l.amount) || 0) > 0.005)
    .map((l) => (l.kind === 'total'
      ? `<b>${esc(l.label)}: ${esc(money(l.amount))}</b>${l.margin !== undefined ? ` <i>(marja ${esc(pct(l.margin))})</i>` : ''}`
      : `${esc(l.label)}: ${esc(money(Math.abs(l.amount)))}`));
  const services = (p.by_service || []).filter((s) => s.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const cats = (p.by_category || []).slice(0, 5);
  const html = lines(
    title('📈', `Foyda va zarar — ${monthLabel(month)}`),
    muted(`${date(p.period.from)} – ${date(p.period.to)} · tan olingan daromad − xarajatlar (accrual)`),
    '',
    ...rows,
    '',
    `${line('Oldingi davr sof foydasi', money(p.previous.net))} <i>(${esc(date(p.previous.from))} – ${esc(date(p.previous.to))}: daromad ${esc(money(p.previous.revenue))}, xarajat ${esc(money(p.previous.expense))})</i>`,
    services.length ? '\n<b>🧩 Xizmatlar bo‘yicha daromad</b>' : null,
    ...services.map((s) => bullet(line(s.name, money(s.revenue)))),
    cats.length ? '\n<b>💸 Eng katta xarajatlar</b>' : null,
    ...cats.map((c) => bullet(line(c.name, money(c.amount)))),
  );
  return { html, buttons: [monthNav('r.pnl', month), [{ text: '🧩 Xizmatlar rentabelligi', cb: `r.svc:${month}` }], [{ text: '🌐 Foyda va zarar', web: 'pnl' }]] };
}

// ---------- Xizmatlar rentabelligi ----------
const VERDICT_ICON = { OK: '✅', LOW: '⚠️', LOSS: '❌', NO_DATA: '—' };
function svcCard(ctx, month) {
  const sp = ctx.S.reports.serviceProfitability({ month });
  const html = lines(
    title('🧩', `Xizmatlar rentabelligi — ${monthLabel(month)}`),
    line('Jami tan olingan daromad', money(sp.total_revenue)),
    line('Taqsimlangan umumiy OPEX', money(sp.shared_opex)),
    '',
    ...sp.rows.map((r) => lines(
      `${VERDICT_ICON[r.verdict] || '—'} <b>${esc(r.name)}</b> — sof foyda <b>${esc(money(r.net_profit))}</b> <i>(marja ${esc(pct(r.margin))} · ${esc(statusLabel(r.verdict))})</i>`,
      `    daromad ${esc(money(r.revenue))} · to‘g‘ridan ${esc(money(r.direct_expense))} · oylik ${esc(money(r.payroll))} · OPEX ${esc(money((Number(r.dept_opex) || 0) + (Number(r.allocated_opex) || 0)))}`,
    )),
    '',
    muted('✅ foydali · ⚠️ marja 15% dan past · ❌ zarar · — ma’lumot yo‘q'),
  );
  return { html, buttons: [monthNav('r.svc', month), [{ text: '📈 Foyda va zarar', cb: `r.pnl:${month}` }], [{ text: '🌐 Foyda va zarar', web: 'pnl' }]] };
}

// ---------- Pul oqimi ----------
function cfCard(ctx, month) {
  const cf = ctx.S.reports.cashFlow({ month });
  const act = (label, x) => line(label, `+${money(x.inflow)} / −${money(x.outflow)} = ${signed(x.net)}`);
  const html = lines(
    title('🔄', `Pul oqimi — ${monthLabel(month)}`),
    muted(`${date(cf.period.from)} – ${date(cf.period.to)} · bank + kassa`),
    '',
    line('Davr boshidagi pul', money(cf.opening_cash)),
    act('Operatsion faoliyat', cf.operating),
    act('Investitsion faoliyat', cf.investing),
    act('Moliyaviy faoliyat', cf.financing),
    line('Jami', `kirim ${money(cf.total_inflow)} · chiqim ${money(cf.total_outflow)}`),
    `<b>Davr oxiridagi pul: ${esc(money(cf.closing_cash))}</b> <i>(o‘zgarish ${esc(signed(cf.net_change))})</i>`,
    cf.inflow_detail?.length ? '\n<b>💚 Kirimlar</b>' : null,
    ...(cf.inflow_detail || []).slice(0, 6).map((x) => bullet(line(x.name, money(x.amount)))),
    cf.outflow_detail?.length ? '\n<b>💸 Chiqimlar</b>' : null,
    ...(cf.outflow_detail || []).slice(0, 8).map((x) => bullet(line(x.name, money(x.amount)))),
  );
  return { html, buttons: [monthNav('r.cf', month), [{ text: '🌐 Pul oqimi', web: 'cashflow' }]] };
}

// ---------- Balans ----------
async function balans(ctx) {
  const b = ctx.S.reports.balance();
  const html = lines(
    `${title('⚖️', 'Boshqaruv balansi')} · ${esc(date(b.as_of))}`,
    '',
    '<b>Aktivlar</b>',
    ...b.assets.map((a) => bullet(line(a.name, money(a.amount)))),
    line('Jami aktivlar', money(b.total_assets)),
    '',
    '<b>Majburiyatlar</b>',
    ...b.liabilities.map((a) => bullet(line(a.name, money(a.amount)))),
    line('Jami majburiyatlar', money(b.total_liabilities)),
    '',
    `${b.equity >= 0 ? '🟢' : '🔴'} <b>Sof aktivlar (kapital): ${esc(money(b.equity))}</b>`,
    '',
    muted(`Memo: shartnomalar bo‘yicha qoldiq ${money(b.memo?.contract_backlog_receivable)} — ${b.memo?.note || ''}`),
  );
  return ctx.reply(html, {
    buttons: [
      [cmdIf(ctx, P.cashflow, '🔄 Pul oqimi', 'pul_oqimi'), cmdIf(ctx, P.treasury, '💰 Pul', 'pul')],
      [{ text: '🌐 Balans', web: 'balance' }],
    ],
  });
}

// ---------- Reja / Fakt ----------
// web public/js/pages/planfact.js NAMES bilan bir xil (key — servis kaliti, name — o'zbekcha yorliq)
const PF_NAME = { Revenue: 'Daromad', Expense: 'Xarajat', Profit: 'Foyda', Cash: 'Pul qoldig‘i', Collection: 'Undirish' };
const PF_ICON = { OK: '🟢', WARN: '🟡', BAD: '🔴', NO_PLAN: '⚪' };
function pfCard(ctx, month) {
  const pf = ctx.S.budget.planFact(month);
  const tol = Number(ctx.settings.get('planfact.tolerance_pct') || 10);
  const html = lines(
    title('🎯', `Reja / Fakt — ${monthLabel(month)}`),
    muted(`Ruxsat etilgan og‘ish: ${tol}% · xarajatda rejadan kam bo‘lishi yaxshi`),
    '',
    ...pf.items.map((it) => {
      const name = PF_NAME[it.key] || PF_NAME[it.name] || it.name;
      if (it.status === 'NO_PLAN') return lines(`${PF_ICON.NO_PLAN} <b>${esc(name)}</b>: fakt ${esc(money(it.fact))}`, '    <i>reja kiritilmagan</i>');
      return lines(
        `${PF_ICON[it.status] || '⚪'} <b>${esc(name)}</b>: fakt ${esc(money(it.fact))} / reja ${esc(money(it.plan))}`,
        `    ${esc(meter(it.pct))} · farq ${esc(signed(it.diff))} · ${esc(statusLabel(it.status))}`,
      );
    }),
  );
  return { html, buttons: [monthNav('r.pf', month), [{ text: '🌐 Reja / Fakt', web: 'planfact' }]] };
}

// ---------- Prognoz ----------
const SCENARIOS = [['conservative', '🐢 Ehtiyotkor'], ['base', '⚖️ Asosiy'], ['optimistic', '🚀 Optimistik']];
const RISK = { HIGH: '🔴 Yuqori', MEDIUM: '🟡 O‘rta', LOW: '🟢 Past' };
const HORIZONS = [7, 30, 90, 180];

function daysArg(args) {
  const a = String(args || '').trim();
  if (!a) return 30;
  const m = /^(\d{1,3})\s*(kun|k|d)?$/i.exec(a);
  const n = m ? Number(m[1]) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 365) throw new BotError('🔮 Gorizontni kunlarda yozing (1–365), masalan: <code>/prognoz 90</code>.');
  return n;
}

function fcCard(ctx, days) {
  const f = ctx.S.forecast.compute(days);
  const b = f.scenarios.base?.breakdown || {};
  const html = lines(
    `${title('🔮', `Prognoz — ${days} kun`)} <i>(${esc(date(f.as_of))} → ${esc(date(f.to))})</i>`,
    line('Hozirgi pul', money(f.cash_now)),
    line('Ishlatish mumkin', money(f.available_now)),
    `Risk: <b>${esc(RISK[f.risk] || f.risk)}</b>`,
    '',
    ...SCENARIOS.map(([key, label]) => {
      const s = f.scenarios[key];
      if (!s) return null;
      return lines(`<b>${esc(label)}</b>`, `    kirim ${esc(money(s.inflow))} · chiqim ${esc(money(s.outflow))}`, `    → pul <b>${esc(money(s.projected_cash))}</b> · ishlatish mumkin ${esc(money(s.projected_available))}`);
    }),
    '',
    '<b>Asosiy senariy tarkibi</b>',
    bullet(line('Muddati keladigan to‘lovlar', money(b.due_in_horizon))),
    bullet(line('Muddati o‘tgan qarzlar', money(b.overdue))),
    bullet(line('Pipeline (qoralama shartnomalar)', money(b.pipeline))),
    bullet(line('Tasdiqlangan, to‘lanmagan xarajatlar', money(b.approved_unpaid))),
    bullet(line('Doimiy xarajatlar', money(b.recurring))),
    bullet(line('Oylik', money(b.payroll))),
    bullet(line('O‘zgaruvchan OPEX', money(b.variable_opex))),
  );
  return { html, buttons: [HORIZONS.map((d) => ({ text: d === days ? `• ${d} kun •` : `${d} kun`, cb: `r.fc:${d}` })), [{ text: '🌐 Prognoz', web: 'forecast' }]] };
}

const replyCard = (ctx, card) => ctx.reply(card.html, { buttons: card.buttons });
const editCard = (ctx, card) => ctx.edit(card.html, { buttons: card.buttons });

export const commands = [
  { name: 'foyda', desc: 'Foyda va zarar (P&L)', usage: '/foyda [oy]', button: '📈 Foyda', perm: P.pnl, run: (ctx) => replyCard(ctx, pnlCard(ctx, monthArg(ctx.args))) },
  { name: 'xizmatlar', desc: 'Xizmatlar rentabelligi', usage: '/xizmatlar [oy]', button: '🧩 Xizmatlar', perm: P.pnl, run: (ctx) => replyCard(ctx, svcCard(ctx, monthArg(ctx.args))) },
  { name: 'pul_oqimi', desc: 'Pul oqimi (cash flow)', usage: '/pul_oqimi [oy]', button: '🔄 Pul oqimi', perm: P.cashflow, run: (ctx) => replyCard(ctx, cfCard(ctx, monthArg(ctx.args))) },
  { name: 'balans', desc: 'Boshqaruv balansi', button: '⚖️ Balans', perm: P.balance, run: balans },
  { name: 'reja', desc: 'Reja / Fakt', usage: '/reja [oy]', button: '🎯 Reja/Fakt', perm: P.planfact, run: (ctx) => replyCard(ctx, pfCard(ctx, monthArg(ctx.args))) },
  { name: 'prognoz', desc: 'Pul prognozi (3 senariy)', usage: '/prognoz [kun]', button: '🔮 Prognoz', perm: P.forecast, run: (ctx) => replyCard(ctx, fcCard(ctx, daysArg(ctx.args))) },
];

export const callbacks = {
  'r.pnl': { perm: P.pnl, run: (ctx) => editCard(ctx, pnlCard(ctx, monthCb(ctx.cbArgs[0]))) },
  'r.svc': { perm: P.pnl, run: (ctx) => editCard(ctx, svcCard(ctx, monthCb(ctx.cbArgs[0]))) },
  'r.cf': { perm: P.cashflow, run: (ctx) => editCard(ctx, cfCard(ctx, monthCb(ctx.cbArgs[0]))) },
  'r.pf': { perm: P.planfact, run: (ctx) => editCard(ctx, pfCard(ctx, monthCb(ctx.cbArgs[0]))) },
  'r.fc': {
    perm: P.forecast,
    run: (ctx) => {
      const d = Number(ctx.cbArgs[0]);
      return editCard(ctx, fcCard(ctx, HORIZONS.includes(d) || d === 365 ? d : 30));
    },
  },
};
