import { get, qs } from '../api.js';
import { dateRange, monthStartISO, monthEndISO, h, kpiCard, card, fmt, short, badge, periodPicker, dataTable, pct, monthLabel, alert, emptyState } from '../ui.js';
import { barChart, donutChart } from '../charts.js';

export default async function render(root, { setTitle, params }) {
  let q = { month: new Date().toISOString().slice(0, 7) };
  const rng = dateRange({ from: monthStartISO(), to: monthEndISO(), onChange: (v) => { q = { period: 'custom', from: v.from, to: v.to }; load(); } });
  const body = h('div', {});
  let tab = params[0] === 'services' ? 'services' : 'pnl';
  const tabs = h('div', { class: 'tabs mb16' });
  const drawTabs = () => tabs.replaceChildren(...[['pnl', 'Foyda va zarar hisoboti'], ['services', 'Xizmatlar rentabelligi']].map(([k, l]) => h('button', { class: k === tab ? 'active' : '', onClick: () => { tab = k; drawTabs(); load(); } }, l)));
  async function load() {
    if (tab === 'pnl') {
      const p = await get('/api/reports/pnl' + qs(q));
      const t = p.totals;
      rng.set(p.period.from, p.period.to);
      setTitle('Foyda va zarar (P&L)', `Tan olingan daromad − xarajatlar · ${p.period.label}`, [rng.el]);
      body.replaceChildren(
        h('div', { class: 'kpis mb16' }, kpiCard({ size: 'sm', icon: 'trend', tone: 'green', label: 'Daromad', value: t.revenue, sub: p.period.label }), kpiCard({ size: 'sm', icon: 'layers', tone: 'teal', label: 'Yalpi foyda', value: t.gross, sub: `marja ${pct(p.lines[2].margin)}` }), kpiCard({ size: 'sm', icon: 'activity', tone: 'blue', label: 'Operatsion foyda', value: t.operating, sub: `operatsion xarajat ${short(t.opex)}` }), kpiCard({ size: 'sm', accent: true, icon: 'award', tone: t.net < 0 ? 'red' : 'green', label: 'Sof foyda', value: t.net, sub: `marja ${pct(t.net_margin)}` }), kpiCard({ size: 'sm', icon: 'clock', tone: 'gray', label: 'Oldingi davr sof foydasi', value: p.previous.net, sub: `${p.previous.from} → ${p.previous.to}` })),
        h('div', { class: 'grid g2 mb16' },
          card('Foyda va zarar hisoboti', h('table', { class: 'tbl' }, h('tbody', {}, ...p.lines.map((l) => h('tr', { class: l.kind === 'total' ? 'total' : 'sub' }, h('td', {}, l.label), h('td', { class: 'right tnum ' + (l.amount < 0 && l.kind === 'total' ? 'neg' : '') }, fmt(l.amount)), h('td', { class: 'right xs muted', style: { width: '70px' } }, l.margin !== undefined ? l.margin + '%' : ''))))), null, { tight: true, sub: p.period.label }),
          h('div', { class: 'grid', style: { gap: '14px' } }, card('Oylik dinamika', barChart({ labels: p.monthly.map((x) => monthLabel(x.period)), series: [{ name: 'Daromad', values: p.monthly.map((x) => x.revenue) }, { name: 'Xarajat', values: p.monthly.map((x) => x.expense) }, { name: 'Foyda', values: p.monthly.map((x) => x.profit), color: 'var(--s3)' }], height: 200 })), card('Daromad xizmat turlari bo‘yicha', p.by_service.some((s) => s.revenue > 0) ? donutChart({ items: p.by_service.filter((s) => s.revenue > 0).map((s) => ({ name: s.name, value: s.revenue, color: s.color })), size: 130 }) : emptyState('Daromad yo‘q', 'Bu davrda tan olingan daromad mavjud emas', 'pie')))),
        card('Xarajatlar kategoriyalar bo‘yicha', dataTable({ columns: [{ key: 'name', label: 'Kategoriya' }, { key: 'pnl_group', label: 'Guruh', render: (r) => ({ DIRECT: 'To‘g‘ridan-to‘g‘ri', PAYROLL: 'Oylik', MARKETING: 'Marketing', ADMIN: 'Ma’muriy', IT: 'IT', OFFICE: 'Ofis', OTHER_OPEX: 'Boshqa operatsion', TAX: 'Soliq', OTHER: 'Boshqa' })[r.pnl_group] || r.pnl_group }, { key: 'amount', label: 'Summa', money: true }, { key: 'n', label: 'Yozuvlar' }], rows: p.by_category, search: false, exportName: 'xarajat-kategoriyalari', footer: (r) => h('tr', { class: 'total' }, h('td', { colspan: 2 }, 'Jami'), h('td', { class: 'right' }, fmt(r.reduce((s, x) => s + x.amount, 0))), h('td', {})) }).el, null, { tight: true }));
    } else {
      const sp = await get('/api/reports/service-profitability' + qs(q));
      rng.set(sp.period.from, sp.period.to);
      setTitle('Xizmatlar rentabelligi', `Har bir xizmat turi bo‘yicha daromad va foyda · ${sp.period.label}`, [rng.el]);
      body.replaceChildren(
        alert('info', `Har xizmat: daromad − to‘g‘ridan-to‘g‘ri xarajat − bo‘lim oyligi − bo‘lim xarajatlari − taqsimlangan umumiy xarajat (${short(sp.shared_opex)}, daromad ulushiga ko‘ra).`),
        h('div', { class: 'kpis mt16 mb16' }, ...sp.rows.slice(0, 5).map((r) => kpiCard({ size: 'sm', icon: 'briefcase', tone: r.verdict === 'LOSS' ? 'red' : r.verdict === 'LOW' ? 'amber' : r.verdict === 'NO_DATA' ? 'gray' : 'green', label: r.name, value: r.net_profit, sub: `daromad ${short(r.revenue)} · marja ${r.verdict === 'NO_DATA' ? '--' : r.margin + '%'}` }))),
        h('div', { class: 'grid g2 mb16' }, card('Daromad va foyda', barChart({ labels: sp.rows.map((r) => r.name), series: [{ name: 'Daromad', values: sp.rows.map((r) => r.revenue) }, { name: 'Yalpi foyda', values: sp.rows.map((r) => r.gross_profit) }, { name: 'Sof foyda', values: sp.rows.map((r) => r.net_profit), color: 'var(--s3)' }] })), card('Sof marja, %', barChart({ labels: sp.rows.map((r) => r.name), series: [{ name: 'Sof marja', values: sp.rows.map((r) => r.margin) }], money: false, yFmt: (v) => v + '%' }))),
        card('Rentabellik jadvali', dataTable({ columns: [{ key: 'name', label: 'Xizmat' }, { key: 'contracts', label: 'Shartnomalar' }, { key: 'revenue', label: 'Daromad', money: true }, { key: 'direct_expense', label: 'To‘g‘ridan-to‘g‘ri xarajat', money: true }, { key: 'payroll', label: 'Oylik', money: true }, { key: 'dept_opex', label: 'Bo‘lim xarajati', money: true }, { key: 'allocated_opex', label: 'Taqsimlangan xarajat', money: true }, { key: 'gross_profit', label: 'Yalpi foyda', money: true }, { key: 'net_profit', label: 'Sof foyda', money: true }, { key: 'margin', label: 'Marja', pct: true }, { key: 'verdict', label: 'Xulosa', badge: true }], rows: sp.rows, search: false, exportName: 'xizmat-rentabelligi' }).el, null, { tight: true, sub: sp.period.label }));
    }
  }
  drawTabs();
  root.append(h('div', { class: 'flex wrap gap8 mb16' }, periodPicker((v) => { q = v; load(); }, q)), tabs, body);
  await load();
}
