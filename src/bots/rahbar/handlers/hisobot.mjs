/** /hisobot [oy] — Excel (XLSX) hisobotlar; web /api/export/xlsx bilan bir xil ruxsat (reports EXPORT) va audit. */
import { lines, title, muted, monthLabel, statusLabel } from '../../shared/format.mjs';
import { T } from '../../shared/texts.mjs';
import { buildXlsx } from '../../../core/export.mjs';
import { round2 } from '../../../core/util.mjs';
import { P, monthArg, monthCb, monthNav } from './common.mjs';

const n = (v) => round2(Number(v) || 0);

/** Hisobot turlari: kerakli ko'rish ruxsati + ma'lumot yig'uvchi (raqamlar faqat servislardan) */
const KINDS = {
  pnl: {
    label: '📈 Foyda va zarar', perm: P.pnl, monthly: true,
    build(S, month) {
      const p = S.reports.pnl({ month });
      const rows = p.lines.map((l) => [l.label, n(l.amount), l.margin ?? '']);
      rows.push(['', '', ''], ['Xarajatlar kategoriyalar bo‘yicha', '', '']);
      for (const c of p.by_category) rows.push([c.name, n(c.amount), '']);
      rows.push(['', '', ''], ['Daromad xizmatlar bo‘yicha', '', '']);
      for (const s of p.by_service) rows.push([s.name, n(s.revenue), '']);
      rows.push(['', '', ''], [`Oldingi davr (${p.previous.from} – ${p.previous.to}) sof foyda`, n(p.previous.net), '']);
      return { title: `Foyda va zarar ${month}`, sheet: `P&L ${month}`, file: `foyda-zarar-${month}.xlsx`, header: ['Ko‘rsatkich', 'Summa (so‘m)', 'Marja, %'], rows };
    },
  },
  cf: {
    label: '🔄 Pul oqimi', perm: P.cashflow, monthly: true,
    build(S, month) {
      const cf = S.reports.cashFlow({ month });
      const rows = [
        ['Davr boshidagi pul', '', '', n(cf.opening_cash)],
        ['Operatsion faoliyat', n(cf.operating.inflow), n(cf.operating.outflow), n(cf.operating.net)],
        ['Investitsion faoliyat', n(cf.investing.inflow), n(cf.investing.outflow), n(cf.investing.net)],
        ['Moliyaviy faoliyat', n(cf.financing.inflow), n(cf.financing.outflow), n(cf.financing.net)],
        ['Jami', n(cf.total_inflow), n(cf.total_outflow), n(cf.net_change)],
        ['Davr oxiridagi pul', '', '', n(cf.closing_cash)],
        ['', '', '', ''], ['Kirimlar tafsiloti', '', '', ''],
        ...cf.inflow_detail.map((x) => [x.name, n(x.amount), '', '']),
        ['', '', '', ''], ['Chiqimlar tafsiloti', '', '', ''],
        ...cf.outflow_detail.map((x) => [x.name, '', n(x.amount), '']),
      ];
      return { title: `Pul oqimi ${month}`, sheet: `Cash flow ${month}`, file: `pul-oqimi-${month}.xlsx`, header: ['Bo‘lim', 'Kirim (so‘m)', 'Chiqim (so‘m)', 'Sof (so‘m)'], rows };
    },
  },
  svc: {
    label: '🧩 Xizmatlar rentabelligi', perm: P.pnl, monthly: true,
    build(S, month) {
      const sp = S.reports.serviceProfitability({ month });
      const rows = sp.rows.map((r) => [r.name, n(r.revenue), n(r.direct_expense), n(r.payroll), n(r.dept_opex), n(r.allocated_opex), n(r.gross_profit), n(r.net_profit), n(r.margin), statusLabel(r.verdict), Number(r.contracts) || 0]);
      return { title: `Xizmatlar rentabelligi ${month}`, sheet: `Xizmatlar ${month}`, file: `xizmatlar-${month}.xlsx`, header: ['Xizmat', 'Daromad', 'To‘g‘ridan-to‘g‘ri', 'Oylik', 'Bo‘lim OPEX', 'Taqsimlangan OPEX', 'Yalpi foyda', 'Sof foyda', 'Marja, %', 'Xulosa', 'Shartnomalar'], rows };
    },
  },
  ar: {
    label: '👥 Debitorlik (bugun)', perm: P.receivables, monthly: false,
    build(S) {
      const list = S.receivables.list();
      const rows = list.map((x) => [x.client, x.inn || '', x.contract_number, x.service_name || x.service_code || '', x.manager || '', n(x.total), n(x.paid), n(x.debt), n(x.overdue_amount), x.due_date || '', Number(x.days_overdue) || 0, x.bucket === 'CURRENT' ? 'Muddati kelmagan' : `${x.bucket} kun`]);
      const day = new Date().toISOString().slice(0, 10);
      return { title: `Debitorlik ${day}`, sheet: `Debitorlik ${day}`, file: `debitorlik-${day}.xlsx`, header: ['Mijoz', 'INN', 'Shartnoma', 'Xizmat', 'Mas’ul', 'Shartnoma summasi', 'To‘langan', 'Qarz', 'Muddati o‘tgan', 'Keyingi muddat', 'Kechikish (kun)', 'Aging'], rows };
    },
  },
};

function menuCard(ctx, month) {
  const allowed = Object.entries(KINDS).filter(([, k]) => ctx.can(...k.perm));
  const html = allowed.length
    ? lines(title('📑', `Hisobotlar — ${monthLabel(month)}`), 'Excel (XLSX) faylni tanlang — raqamlar web paneldagi hisobotlar bilan bir xil.', muted('Debitorlik — bugungi holat bo‘yicha.'))
    : lines(title('📑', 'Hisobotlar'), 'Sizning rolingizda eksport qilinadigan hisobot yo‘q.');
  const buttons = allowed.map(([key, k]) => [{ text: k.label, cb: `r.xls:${key}:${k.monthly ? month : 'now'}` }]);
  buttons.push(monthNav('r.rep', month), [{ text: '🌐 Hisobotlar', web: 'reports' }]);
  return { html, buttons };
}

async function hisobot(ctx) {
  const c = menuCard(ctx, monthArg(ctx.args));
  return ctx.reply(c.html, { buttons: c.buttons });
}

/** r.xls:<tur>:<oy|now> — faylni yig'ib yuborish */
async function exportXls(ctx) {
  const [kind, arg] = ctx.cbArgs;
  const k = KINDS[kind];
  if (!k) return ctx.answer(T.expired, true);
  ctx.need(...P.export);
  ctx.need(...k.perm);
  const month = monthCb(arg);
  await ctx.answer('📑 Fayl tayyorlanmoqda…');
  const r = k.build(ctx.S, month);
  const buf = buildXlsx({ sheetName: r.sheet.slice(0, 31), header: r.header, rows: r.rows });
  await ctx.sendDocument(buf, r.file, `📑 ${r.title} — UTAX Finance`);
  ctx.app.audit(ctx.actor, { action: 'EXPORT', entity: 'report', newValue: { title: r.title, rows: r.rows.length, format: 'xlsx', bot: 'rahbar' } });
  return null;
}

export const commands = [
  { name: 'hisobot', desc: 'Excel hisobotlar (P&L, pul oqimi, debitorlik)', usage: '/hisobot [oy]', button: '📑 Hisobot', perm: P.export, run: hisobot },
];

export const callbacks = {
  'r.rep': { perm: P.export, run: (ctx) => { const c = menuCard(ctx, monthCb(ctx.cbArgs[0])); return ctx.edit(c.html, { buttons: c.buttons }); } },
  'r.xls': { perm: P.export, run: exportXls },
};
