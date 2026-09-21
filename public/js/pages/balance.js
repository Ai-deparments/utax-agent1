import { get } from '../api.js';
import { h, kpiCard, card, fmt, date, today, alert, dateRange, rangeLabel, addDaysISO } from '../ui.js';

export default async function render(root, { setTitle }) {
  const body = h('div', {});
  // Sana tanlanmasa — bugungi balans (avvalgidek); oraliq tanlansa — davr boshi va oxiri taqqoslanadi
  const rng = dateRange({ allowEmpty: true, onChange: () => load() });
  async function load() {
    const { from, to } = rng.value;
    const b = await get('/api/reports/balance-sheet?as_of=' + (rng.active ? to : today()));
    const s = rng.active ? await get('/api/reports/balance-sheet?as_of=' + addDaysISO(from, -1)) : null;
    setTitle('Balans', s ? `Boshqaruv balansi · ${rangeLabel(rng.value)} davridagi o‘zgarish` : `Boshqaruv balansi · ${date(b.as_of)}`, [rng.el]);
    const chg = (end, start) => { const d = end - start; return h('span', { class: 'tnum ' + (d > 0 ? 'pos' : d < 0 ? 'neg' : 'muted') }, (d > 0 ? '+' : '') + fmt(d)); };
    const tbl = (rows, total, label, sRows, sTotal) => s
      ? h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Qator'), h('th', { class: 'right' }, 'Davr boshida'), h('th', { class: 'right' }, 'Davr oxirida'), h('th', { class: 'right' }, 'O‘zgarish'))),
        h('tbody', {}, ...rows.map((r, i) => h('tr', {}, h('td', {}, r.name), h('td', { class: 'right tnum' }, fmt(sRows[i].amount)), h('td', { class: 'right tnum' }, fmt(r.amount)), h('td', { class: 'right' }, chg(r.amount, sRows[i].amount)))),
          h('tr', { class: 'total' }, h('td', {}, label), h('td', { class: 'right' }, fmt(sTotal)), h('td', { class: 'right' }, fmt(total)), h('td', { class: 'right' }, chg(total, sTotal)))))
      : h('table', { class: 'tbl' }, h('tbody', {}, ...rows.map((r) => h('tr', {}, h('td', {}, r.name), h('td', { class: 'right tnum' }, fmt(r.amount)))), h('tr', { class: 'total' }, h('td', {}, label), h('td', { class: 'right' }, fmt(total)))));
    const eqRows = s
      ? h('table', { class: 'tbl' }, h('tbody', {}, h('tr', { class: 'total' }, h('td', {}, 'Kapital'), h('td', { class: 'right' }, fmt(s.equity)), h('td', { class: 'right' }, fmt(b.equity)), h('td', { class: 'right' }, chg(b.equity, s.equity))), h('tr', { class: 'total' }, h('td', {}, 'Jami majburiyatlar va kapital'), h('td', { class: 'right' }, fmt(s.total_liabilities + s.equity)), h('td', { class: 'right' }, fmt(b.total_liabilities + b.equity)), h('td', { class: 'right' }, chg(b.total_liabilities + b.equity, s.total_liabilities + s.equity)))))
      : h('table', { class: 'tbl' }, h('tbody', {}, h('tr', { class: 'total' }, h('td', {}, 'Kapital'), h('td', { class: 'right' }, fmt(b.equity))), h('tr', { class: 'total' }, h('td', {}, 'Jami majburiyatlar va kapital'), h('td', { class: 'right' }, fmt(b.total_liabilities + b.equity)))));
    const sub = (def, end, start) => (s ? `davr boshida ${fmt(start)} · ${end - start >= 0 ? '+' : ''}${fmt(end - start)}` : def);
    body.replaceChildren(
      h('div', { class: 'kpis mb16' }, kpiCard({ size: 'sm', icon: 'layers', tone: 'green', label: 'Jami aktivlar', value: b.total_assets, sub: s ? sub('', b.total_assets, s.total_assets) : undefined }), kpiCard({ size: 'sm', icon: 'receipt', tone: 'orange', label: 'Jami majburiyatlar', value: b.total_liabilities, sub: s ? sub('', b.total_liabilities, s.total_liabilities) : undefined }), kpiCard({ size: 'sm', accent: true, icon: 'scale', tone: b.equity < 0 ? 'red' : 'green', label: 'Kapital', value: b.equity, sub: sub('aktivlar − majburiyatlar', b.equity, s?.equity) }), kpiCard({ size: 'sm', icon: 'inflow', tone: 'amber', label: 'Mijoz avanslari', value: b.liabilities[0].amount, sub: sub('kelgusi davr daromadi', b.liabilities[0].amount, s?.liabilities[0].amount) }), kpiCard({ size: 'sm', icon: 'contract', tone: 'blue', label: 'Shartnoma qoldig‘i', value: b.memo.contract_backlog_receivable, sub: 'balansdan tashqari' })),
      h('div', { class: 'grid g2 mb16' }, card('Aktivlar', tbl(b.assets, b.total_assets, 'Jami aktivlar', s?.assets, s?.total_assets), null, { tight: true, sub: s ? `${date(addDaysISO(from, -1))} → ${date(to)}` : undefined }), card('Majburiyatlar va kapital', h('div', {}, tbl(b.liabilities, b.total_liabilities, 'Jami majburiyatlar', s?.liabilities, s?.total_liabilities), eqRows), null, { tight: true, sub: s ? `${date(addDaysISO(from, -1))} → ${date(to)}` : undefined })),
      alert('info', 'Debitorlik balansda faqat tan olingan (xizmat bajarilgan), lekin puli kelmagan qism sifatida ko‘rsatiladi. Shartnoma bo‘yicha qoldiqning bajarilmagan qismi balansga kirmaydi.'));
  }
  root.append(body);
  await load();
}
