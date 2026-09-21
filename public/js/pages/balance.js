import { get } from '../api.js';
import { h, kpiCard, card, fmt, date, today, alert } from '../ui.js';

export default async function render(root, { setTitle }) {
  let asOf = today();
  const body = h('div', {});
  const dateInp = h('input', { class: 'input sm', type: 'date', value: asOf, onChange: (e) => { asOf = e.target.value; load(); } });
  async function load() {
    const b = await get('/api/reports/balance-sheet?as_of=' + asOf);
    setTitle('Balans', `Boshqaruv balansi · ${date(b.as_of)}`, [h('span', { class: 'flex gap8 small muted' }, 'Sana:', dateInp)]);
    const tbl = (rows, total, label) => h('table', { class: 'tbl' }, h('tbody', {}, ...rows.map((r) => h('tr', {}, h('td', {}, r.name), h('td', { class: 'right tnum' }, fmt(r.amount)))), h('tr', { class: 'total' }, h('td', {}, label), h('td', { class: 'right' }, fmt(total)))));
    body.replaceChildren(
      h('div', { class: 'kpis mb16' }, kpiCard({ size: 'sm', icon: 'layers', tone: 'green', label: 'Jami aktivlar', value: b.total_assets }), kpiCard({ size: 'sm', icon: 'receipt', tone: 'orange', label: 'Jami majburiyatlar', value: b.total_liabilities }), kpiCard({ size: 'sm', accent: true, icon: 'scale', tone: b.equity < 0 ? 'red' : 'green', label: 'Kapital', value: b.equity, sub: 'aktivlar − majburiyatlar' }), kpiCard({ size: 'sm', icon: 'inflow', tone: 'amber', label: 'Mijoz avanslari', value: b.liabilities[0].amount, sub: 'kelgusi davr daromadi' }), kpiCard({ size: 'sm', icon: 'contract', tone: 'blue', label: 'Shartnoma qoldig‘i', value: b.memo.contract_backlog_receivable, sub: 'balansdan tashqari' })),
      h('div', { class: 'grid g2 mb16' }, card('Aktivlar', tbl(b.assets, b.total_assets, 'Jami aktivlar'), null, { tight: true }), card('Majburiyatlar va kapital', h('div', {}, tbl(b.liabilities, b.total_liabilities, 'Jami majburiyatlar'), h('table', { class: 'tbl' }, h('tbody', {}, h('tr', { class: 'total' }, h('td', {}, 'Kapital'), h('td', { class: 'right' }, fmt(b.equity))), h('tr', { class: 'total' }, h('td', {}, 'Jami majburiyatlar va kapital'), h('td', { class: 'right' }, fmt(b.total_liabilities + b.equity)))))), null, { tight: true })),
      alert('info', 'Debitorlik balansda faqat tan olingan (xizmat bajarilgan), lekin puli kelmagan qism sifatida ko‘rsatiladi. Shartnoma bo‘yicha qoldiqning bajarilmagan qismi balansga kirmaydi.'));
  }
  root.append(body);
  await load();
}
