import { get } from '../api.js';
import { h, kpiCard, statTile, card, fmt, short, money, badge, date, monthLabel, monthsSelect, emptyState, icon } from '../ui.js';
import { lineChart, barChart, donutChart, hBarChart, planFact } from '../charts.js';

export default async function render(root, { setTitle, navigate }) {
  const d = await get('/api/dashboard');
  setTitle('Moliya dashboardi', `Asosiy ko‘rsatkichlar va moliyaviy holat · ${date(d.as_of)}`);
  const k = d.kpi, dl = d.deltas, sp = d.sparklines;
  const mL = (l) => l.map((x) => monthLabel(x.period));

  root.append(h('div', { class: 'kpis mb16' },
    kpiCard({ icon: 'bank', tone: 'green', label: 'Bank qoldig‘i', value: k.bank_balance, delta: dl.bank_balance, spark: sp.bank }),
    kpiCard({ icon: 'cash', tone: 'blue', label: 'Kassa qoldig‘i', value: k.cash_balance, delta: dl.cash_balance, spark: sp.cash }),
    kpiCard({ icon: 'coins', tone: 'green', label: 'Jami pul mablag‘lari', value: k.total_cash, delta: dl.total_cash, spark: sp.total }),
    kpiCard({ icon: 'inflow', tone: 'orange', label: 'Mijoz avanslari (predoplata)', value: k.customer_advances, delta: dl.customer_advances, spark: sp.advances }),
    kpiCard({ icon: 'receipt', tone: 'red', label: 'Xarajatlar (joriy oy)', value: k.expenses_month, delta: dl.expenses_month, invert: true, spark: sp.expenses })));

  root.append(h('div', { class: 'kpis c6 mb16' },
    kpiCard({ size: 'sm', accent: true, icon: 'wallet', tone: 'green', label: 'Ishlatish mumkin pul', value: k.available_cash, sub: k.low_liquidity ? 'Likvidlik chegarasidan past' : 'Jami pul − avanslar − rezerv' }),
    kpiCard({ size: 'sm', icon: 'trend', tone: 'green', label: 'Tan olingan daromad (joriy oy)', value: k.recognized_revenue, delta: dl.recognized_revenue }),
    kpiCard({ size: 'sm', icon: 'users', tone: 'blue', label: 'Olinadigan summalar (debitorlik)', value: k.accounts_receivable, delta: dl.accounts_receivable, invert: true }),
    kpiCard({ size: 'sm', icon: 'calendar', tone: 'teal', label: 'Kutilayotgan daromad (30 kun)', value: k.expected_income, sub: 'To‘lov jadvali bo‘yicha' }),
    kpiCard({ size: 'sm', icon: 'calendar', tone: 'amber', label: 'Kutilayotgan xarajat (30 kun)', value: k.expected_expenses, sub: 'Tasdiqlangan + doimiy xarajatlar' }),
    kpiCard({ size: 'sm', icon: 'award', tone: k.net_profit < 0 ? 'red' : 'green', label: 'Sof foyda (joriy oy)', value: k.net_profit, delta: dl.net_profit })));

  const cfBody = h('div', {}), rvBody = h('div', {});
  let months = 6;
  const drawTrends = async () => {
    const t = months === 6 ? { cash_flow: d.charts.cash_flow, pnl: d.charts.pnl_monthly } : await get('/api/reports/trends?months=' + months);
    cfBody.replaceChildren(lineChart({ labels: mL(t.cash_flow), series: [{ name: 'Tushumlar', values: t.cash_flow.map((x) => x.income), area: true }, { name: 'Xarajatlar', values: t.cash_flow.map((x) => x.expense) }, { name: 'Sof pul oqimi', values: t.cash_flow.map((x) => x.net) }], height: 230 }));
    rvBody.replaceChildren(barChart({ labels: mL(t.pnl), series: [{ name: 'Daromadlar (tan olingan)', values: t.pnl.map((x) => x.revenue) }, { name: 'Xarajatlar', values: t.pnl.map((x) => x.expense) }], height: 230 }));
  };
  const sel1 = monthsSelect(months, (v) => { months = v; sel2.value = v; drawTrends(); }), sel2 = monthsSelect(months, (v) => { months = v; sel1.value = v; drawTrends(); });
  root.append(h('div', { class: 'grid g2 mb16' }, card('Pul oqimi dinamikasi', cfBody, [sel1]), card('Daromad va xarajatlar taqqoslamasi', rvBody, [sel2])));
  await drawTrends();

  const donut = (items) => items.length ? donutChart({ items: items.map((x) => ({ name: x.name, value: x.amount, color: x.color })), size: 140 }) : emptyState('Ma’lumot yo‘q', 'Joriy oyda yozuvlar mavjud emas', 'pie');
  root.append(h('div', { class: 'grid g3 mb16' },
    card('Pul mablag‘lari tarkibi', donut(d.charts.cash_composition.filter((x) => x.amount > 0))),
    card('Daromad manbalari', donut(d.charts.revenue_by_service), null, { sub: 'joriy oy, tan olingan' }),
    card('Xarajatlar tuzilmasi', donut(d.charts.expense_structure), null, { sub: 'joriy oy' })));

  const tbl = (heads, rows, mk) => h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ...heads.map(([l, cls]) => h('th', { class: cls || '' }, l)))), h('tbody', {}, ...(rows.length ? rows.map(mk) : [h('tr', {}, h('td', { class: 'empty', colspan: heads.length }, 'Ma’lumot yo‘q'))]))));
  const ind = d.indicators;
  root.append(h('div', { class: 'grid g3 mb16' },
    card('So‘nggi yirik tushumlar', tbl([['Sana'], ['Kontragent'], ['Turi'], ['Summa', 'right']], d.recent_income, (t) => h('tr', { class: 'row click', onClick: () => navigate(t.contract_id ? 'contracts/' + t.contract_id : 'transactions') }, h('td', { class: 'nowrap' }, date(t.tx_date)), h('td', {}, t.counterparty_name || '—', t.contract_number ? h('div', { class: 'xs muted' }, t.contract_number) : null), h('td', {}, t.matching_status === 'MATCHED' ? (t.service_name || 'To‘lov') : badge(t.matching_status)), h('td', { class: 'right tnum' }, fmt(t.amount)))), [h('a', { class: 'btn xs ghost', href: '#/transactions' }, 'Barchasini ko‘rish', icon('arrowRight', 13))], { tight: true }),
    card('So‘nggi yirik xarajatlar', tbl([['Sana'], ['Nomi'], ['Toifa'], ['Summa', 'right']], d.recent_expenses, (e) => h('tr', { class: 'row click', onClick: () => navigate('expenses/' + e.id) }, h('td', { class: 'nowrap' }, date(e.expense_date)), h('td', {}, h('div', { style: { maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, e.purpose)), h('td', {}, e.category || '—'), h('td', { class: 'right tnum' }, fmt(e.amount)))), [h('a', { class: 'btn xs ghost', href: '#/expenses' }, 'Barchasini ko‘rish', icon('arrowRight', 13))], { tight: true }),
    card('Asosiy ko‘rsatkichlar', h('div', { class: 'stat-tiles' },
      statTile({ icon: 'users', tone: 'green', label: 'Faol mijozlar', value: ind.active_clients, delta: ind.new_clients_month || null }),
      statTile({ icon: 'contract', tone: 'blue', label: 'Faol shartnomalar', value: ind.active_contracts, delta: ind.new_contracts_month || null }),
      statTile({ icon: 'activity', tone: 'teal', label: 'Jami tranzaksiyalar', value: ind.transactions_total, delta: ind.transactions_month || null }),
      statTile({ icon: 'clock', tone: ind.overdue_count ? 'red' : 'green', label: 'Kechiktirilgan to‘lovlar', value: ind.overdue_count, delta: ind.overdue_count - ind.overdue_count_prev || null, invert: true })), null, { sub: 'o‘zgarish — joriy oy' })));

  const attention = [
    ['#/approvals', 'Tasdiq kutayotgan so‘rovlar', d.pending.approvals.n, money(d.pending.approvals.s), d.pending.approvals.n ? 'PENDING' : 'OK'],
    ['#/transactions/unmatched', 'Bog‘lanmagan bank tranzaksiyalari', d.pending.unmatched_transactions, 'kirim ' + money(d.pending.unmatched_income_amount), d.pending.unmatched_transactions ? 'UNMATCHED' : 'OK'],
    ['#/expenses/pending', 'Xarajat so‘rovlari', d.pending.expense_requests.n, money(d.pending.expense_requests.s), d.pending.expense_requests.n ? 'PENDING' : 'OK'],
    ['#/reports', 'Ma’lumot sifati muammolari', d.pending.data_quality, 'Ma’lumot sifati agenti', d.pending.data_quality ? 'WARNING' : 'OK'],
  ];
  root.append(h('div', { class: 'grid g3' },
    card('Diqqat talab qiladi', h('div', { class: 'list' }, ...attention.map(([href, t, n, s, st]) => h('a', { class: 'li', href }, h('div', { class: 'grow' }, h('div', { class: 't' }, `${t}: ${n} ta`), h('div', { class: 's' }, s)), badge(st))))),
    card('Reja va fakt', planFact(d.charts.plan_fact), [h('a', { class: 'btn xs ghost', href: '#/planfact' }, 'Batafsil', icon('arrowRight', 13))], { sub: monthLabel(d.month) }),
    card('Debitorlik yoshi (aging)', hBarChart({ items: d.charts.aging.map((b) => ({ label: b.label, value: b.amount, sub: b.count + ' ta', color: b.bucket === 'CURRENT' ? 'var(--s1)' : b.bucket === '0-7' ? 'var(--warn)' : b.bucket === '8-15' ? 'var(--orange)' : 'var(--crit)' })) }), [h('a', { class: 'btn xs ghost', href: '#/receivables' }, 'Batafsil', icon('arrowRight', 13))])));
}
