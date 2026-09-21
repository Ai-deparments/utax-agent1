import { get } from '../api.js';
import { dateRange, addDaysISO, today, h, kpiCard, card, fmt, money, short, badge, date, dataTable, segmented, kv } from '../ui.js';
import { lineChart, barChart } from '../charts.js';

export default async function render(root, { setTitle }) {
  let days = 30;
  const body = h('div', {});
  const segBox = h('div', { class: 'mb16' });
  const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
  // Standart: bugundan +30 kun (avvalgidek). Oraliq: boshlanish sanasidan tugash sanasigacha prognoz
  const rng = dateRange({ from: today(), to: addDaysISO(today(), 30), onChange: (v) => { const d = dayDiff(v.from, v.to); if (d < 1) return; days = d; load(); } });
  const NAMES = { conservative: 'Konservativ', base: 'Bazaviy', optimistic: 'Optimistik' };
  async function load() {
    const asOf = rng.value.from;
    const [f, all] = await Promise.all([get(`/api/forecast?days=${days}&as_of=${asOf}`), get('/api/forecast/all?as_of=' + asOf)]);
    segBox.replaceChildren(segmented([[7, '7 kun'], [30, '30 kun'], [90, '90 kun'], [180, '6 oy'], [365, '12 oy']], days, (v) => { days = v; rng.set(rng.value.from, addDaysISO(rng.value.from, v)); load(); }));
    const sc = f.scenarios;
    setTitle('Prognoz', `Pul oqimi prognozi · ${days} kun · ${date(f.as_of)} → ${date(f.to)}`, [rng.el]);
    const scCard = (key, s) => card(NAMES[key], h('div', {}, h('div', { class: 'xs muted mb8' }, `undirish ${Math.round(s.assumptions.collection_rate * 100)}% · muddati o‘tganlar ${Math.round(s.assumptions.overdue_rate * 100)}% · xarajat ×${s.assumptions.expense_factor}`), kv([['Kirim', h('span', { class: 'pos' }, '+' + fmt(s.inflow))], ['Chiqim', h('span', { class: 'neg' }, '−' + fmt(s.outflow))], ['Sof oqim', h('b', {}, fmt(s.net))], ['Prognoz pul qoldig‘i', h('b', { style: { fontSize: '17px' } }, fmt(s.projected_cash))], ['Prognoz ishlatish mumkin pul', h('span', { class: s.projected_available < 0 ? 'neg' : '' }, fmt(s.projected_available))]])), null, { sub: key === 'base' ? 'asosiy' : '' });
    body.replaceChildren(
      h('div', { class: 'kpis mb16' }, kpiCard({ size: 'sm', icon: 'coins', tone: 'green', label: 'Hozirgi pul', value: f.cash_now }), kpiCard({ size: 'sm', icon: 'wallet', tone: 'green', label: 'Hozirgi ishlatish mumkin pul', value: f.available_now }), kpiCard({ size: 'sm', icon: 'calendar', tone: 'blue', label: 'Gorizont', value: `${days} kun`, sub: `${date(f.as_of)} → ${date(f.to)}` }), kpiCard({ size: 'sm', accent: true, icon: 'lineChart', tone: 'green', label: 'Bazaviy prognoz pul qoldig‘i', value: sc.base.projected_cash }), kpiCard({ size: 'sm', icon: 'alert', tone: f.risk === 'HIGH' ? 'red' : f.risk === 'MEDIUM' ? 'amber' : 'green', label: 'Likvidlik riski', value: badge(f.risk === 'HIGH' ? 'HIGH' : f.risk === 'MEDIUM' ? 'MEDIUM' : 'OK', { HIGH: 'Yuqori', MEDIUM: 'O‘rta', LOW: 'Past' }[f.risk]), sub: 'konservativ senariy bo‘yicha' })),
      h('div', { class: 'grid g3 mb16' }, scCard('conservative', sc.conservative), scCard('base', sc.base), scCard('optimistic', sc.optimistic)),
      h('div', { class: 'grid g2 mb16' }, f.cash_now === null ? card('Pul qoldig‘i prognozi', h('div', { class: 'muted small' }, 'Bank/kassa boshlang‘ich qoldig‘i kiritilmagan — qoldiq prognozi: --'), null, { sub: 'bazaviy senariy' }) : card('Pul qoldig‘i prognozi', lineChart({ labels: f.series.map((x) => date(x.to).slice(0, 5)), series: [{ name: 'Pul qoldig‘i', values: f.series.map((x) => x.cash), area: true }] }), null, { sub: 'bazaviy senariy' }), card('Davrlar bo‘yicha kirim va chiqim', barChart({ labels: f.series.map((x) => date(x.to).slice(0, 5)), series: [{ name: 'Kirim', values: f.series.map((x) => x.inflow), color: 'var(--s1)' }, { name: 'Chiqim', values: f.series.map((x) => x.outflow), color: 'var(--s2)' }] }), null, { sub: 'bazaviy senariy' })),
      h('div', { class: 'grid g2' }, card('Prognoz manbalari', h('table', { class: 'tbl' }, h('tbody', {}, ...Object.entries(sc.base.breakdown).map(([k, v]) => h('tr', {}, h('td', {}, { due_in_horizon: 'To‘lov jadvali bo‘yicha (gorizontda)', overdue: 'Muddati o‘tgan qarzlar', pipeline: 'Yangi shartnomalar (qoralama) avansi', approved_unpaid: 'Tasdiqlangan, to‘lanmagan xarajatlar', recurring: 'Doimiy xarajatlar', payroll: 'Oylik (taxminiy)', variable_opex: 'O‘zgaruvchan xarajatlar (3 oy o‘rtacha)' }[k] || k), h('td', { class: 'right tnum' }, fmt(v)))))), null, { tight: true, sub: 'bazaviy senariy' }),
        card('Barcha gorizontlar', dataTable({ columns: [{ key: 'days', label: 'Kun' }, { key: 'to', label: 'Sanagacha', date: true }, { key: 'c', label: 'Konservativ', money: true }, { key: 'b', label: 'Bazaviy', money: true }, { key: 'o', label: 'Optimistik', money: true }, { key: 'risk', label: 'Risk', render: (r) => badge(r.risk === 'HIGH' ? 'HIGH' : r.risk === 'MEDIUM' ? 'MEDIUM' : 'OK', { HIGH: 'Yuqori', MEDIUM: 'O‘rta', LOW: 'Past' }[r.risk]) }], rows: all.map((x) => ({ days: x.days, to: x.to, c: x.conservative.projected_cash, b: x.base.projected_cash, o: x.optimistic.projected_cash, risk: x.risk })), search: false, hideToolbar: true }).el, null, { tight: true, sub: 'prognoz pul qoldig‘i' })));
  }
  root.append(segBox, body);
  await load();
}
