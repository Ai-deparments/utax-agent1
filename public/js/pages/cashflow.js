import { get, qs } from '../api.js';
import { dateRange, monthStartISO, monthEndISO, h, kpiCard, card, fmt, periodPicker, monthLabel } from '../ui.js';
import { lineChart } from '../charts.js';

export default async function render(root, { setTitle }) {
  let q = { month: new Date().toISOString().slice(0, 7) };
  const rng = dateRange({ from: monthStartISO(), to: monthEndISO(), onChange: (v) => { q = { period: 'custom', from: v.from, to: v.to }; load(); } });
  const body = h('div', {});
  async function load() {
    const c = await get('/api/reports/cash-flow' + qs(q));
    rng.set(c.period.from, c.period.to);
    setTitle('Pul oqimi', `Operatsion · investitsion · moliyaviy faoliyat · ${c.period.label}`, [rng.el]);
    const row = (label, v, cls = '') => h('tr', { class: cls }, h('td', {}, label), h('td', { class: 'right tnum ' + (v < 0 ? 'neg' : '') }, fmt(v)));
    const sec = (label) => h('tr', { class: 'sec' }, h('td', { colspan: 2 }, label));
    body.replaceChildren(
      h('div', { class: 'kpis mb16' }, kpiCard({ size: 'sm', icon: 'wallet', tone: 'gray', label: 'Davr boshidagi pul', value: c.opening_cash }), kpiCard({ size: 'sm', icon: 'arrowDown', tone: 'green', label: 'Kirimlar', value: c.total_inflow }), kpiCard({ size: 'sm', icon: 'arrowUp', tone: 'red', label: 'Chiqimlar', value: c.total_outflow }), kpiCard({ size: 'sm', icon: 'activity', tone: c.net_change < 0 ? 'amber' : 'teal', label: 'Sof o‘zgarish', value: c.net_change }), kpiCard({ size: 'sm', accent: true, icon: 'coins', tone: 'green', label: 'Davr oxiridagi pul', value: c.closing_cash })),
      h('div', { class: 'grid g2 mb16' },
        card('Pul oqimi hisoboti', h('table', { class: 'tbl' }, h('tbody', {}, row('Davr boshidagi pul', c.opening_cash, 'total'), sec('Operatsion faoliyat'), row('+ Kirimlar (mijoz to‘lovlari va boshqa)', c.operating.inflow, 'sub'), row('− Chiqimlar (xarajatlar, oylik, soliqlar)', -c.operating.outflow, 'sub'), row('= Sof operatsion oqim', c.operating.net, 'total'), sec('Investitsion faoliyat'), row('+ Kirimlar', c.investing.inflow, 'sub'), row('− Chiqimlar (jihozlar, investitsiyalar)', -c.investing.outflow, 'sub'), row('= Sof investitsion oqim', c.investing.net, 'total'), sec('Moliyaviy faoliyat'), row('+ Kirimlar (kredit, ta’sischi mablag‘i)', c.financing.inflow, 'sub'), row('− Chiqimlar (dividend, kredit qaytarish)', -c.financing.outflow, 'sub'), row('= Sof moliyaviy oqim', c.financing.net, 'total'), row('Davr oxiridagi pul', c.closing_cash, 'total'))), null, { tight: true, sub: c.period.label }),
        h('div', { class: 'grid', style: { gap: '14px' } }, card('Oylik pul oqimi', lineChart({ labels: c.monthly.map((x) => monthLabel(x.period)), series: [{ name: 'Tushumlar', values: c.monthly.map((x) => x.income), area: true }, { name: 'Xarajatlar', values: c.monthly.map((x) => x.expense) }, { name: 'Sof oqim', values: c.monthly.map((x) => x.net) }], height: 210 }), null, { sub: 'oxirgi 6 oy' }),
          h('div', { class: 'grid g2' }, card('Kirim manbalari', h('table', { class: 'tbl' }, h('tbody', {}, ...(c.inflow_detail.length ? c.inflow_detail.map((x) => row(x.name, x.amount)) : [h('tr', {}, h('td', { class: 'empty' }, 'Kirim yo‘q'))]))), null, { tight: true }), card('Chiqim yo‘nalishlari', h('table', { class: 'tbl' }, h('tbody', {}, ...(c.outflow_detail.length ? c.outflow_detail.map((x) => row(x.name, x.amount)) : [h('tr', {}, h('td', { class: 'empty' }, 'Chiqim yo‘q'))]))), null, { tight: true })))));
  }
  root.append(h('div', { class: 'mb16' }, periodPicker((v) => { q = v; load(); }, q)), body);
  await load();
}
