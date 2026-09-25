import { get } from '../api.js';
import { dateRange, rangeLabel, h, kpiCard, statTile, card, fmt, short, money, badge, date, monthLabel, monthsSelect, emptyState, icon, alert } from '../ui.js';
import { lineChart, barChart, donutChart, hBarChart, planFact } from '../charts.js';
import { erpBanner, bankBlock } from '../bank-ledger.js';

export default async function render(outerRoot, { setTitle, navigate, can, query }) {
  // Sana tanlanmasa — joriy oy va o'tgan oy bilan taqqoslash (avvalgidek); tanlansa — shu davr bo'yicha
  const rng = dateRange({ allowEmpty: true, onChange: () => safeLoad() });
  // Bloklar mustaqil yuklanadi: ERP banneri, bank hisoblari (fayl importi) va asosiy (ERP) ko'rsatkichlar — biri yiqilsa, qolgani ishlaydi
  const erpBox = h('div', {}), bankBox = h('div', { class: 'mb16' }), box = h('div', {});
  outerRoot.append(erpBox, can('treasury') ? bankBox : '', box);
  setTitle('Moliya dashboardi', 'Asosiy ko‘rsatkichlar va moliyaviy holat', [rng.el]);
  let autoMonth = false; // joriy oy bo'sh bo'lsa — ma'lumot bor oxirgi oyga bir marta avtomatik o'tiladi
  const safeLoad = () => load().catch((e) => box.replaceChildren(alert('crit', 'ERP ko‘rsatkichlari yuklanmadi: ' + e.message)));
  async function load() {
  const { from, to } = rng.value;
  const d = await get('/api/dashboard' + (rng.active ? `?from=${from}&to=${to}` : ''));
  const R = !!d.range;
  const root = h('div', {});
  const P = R ? '(davr)' : '(joriy oy)';
  const flowLbl = R ? 'Oldingi davrga nisbatan' : 'O‘tgan oyga nisbatan', balLbl = R ? 'Davr boshiga nisbatan' : 'O‘tgan oyga nisbatan';
  setTitle('Moliya dashboardi', R ? `Asosiy ko‘rsatkichlar va moliyaviy holat · ${rangeLabel(d.range)}` : `Asosiy ko‘rsatkichlar va moliyaviy holat · ${date(d.as_of)}`, [rng.el]);
  const k = d.kpi, dl = d.deltas, sp = d.sparklines;
  // Joriy oyda yozuv bo'lmasa — dashboard bo'sh ko'rinmasligi uchun ma'lumot bor oxirgi oy avtomatik ochiladi
  // (bir marta; foydalanuvchi joriy oyga qaytsa, qayta o'tilmaydi). Raqamlarning o'zi o'zgartirilmaydi.
  const span = d.data_span;
  const lastM = span?.last && span.last.slice(0, 7) < d.as_of.slice(0, 7) ? span.last.slice(0, 7) : null;
  const showMonth = (lm) => {
    const [yy, mm] = lm.split('-').map(Number);
    rng.set(`${lm}-01`, new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10));
    return load();
  };
  if (lastM && !R && !autoMonth) { autoMonth = true; return showMonth(lastM); }
  if (lastM) {
    const alertRow = (text, btn) => root.append(h('div', { class: 'alert info mb16', style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } }, icon('info', 16), h('div', { class: 'grow' }, text), btn));
    if (R && autoMonth) alertRow(`Joriy oyda (${monthLabel(d.as_of.slice(0, 7))}) yozuv yo‘q — oxirgi ma’lumotli davr ko‘rsatilmoqda. Manbadagi so‘nggi yozuv: ${date(span.last)}.`,
      h('button', { class: 'btn sm', onClick: () => { rng.set('', ''); load(); } }, 'Joriy oyni ko‘rsatish'));
    else if (!R) alertRow(`Joriy oyda (${monthLabel(d.as_of.slice(0, 7))}) yozuvlar yo‘q — “joriy oy” ko‘rsatkichlari 0. Oxirgi ma’lumot: ${monthLabel(lastM)} (${date(span.last)} gacha).`,
      h('button', { class: 'btn sm pri', onClick: () => showMonth(lastM) }, `${monthLabel(lastM)} ni ko‘rsatish`));
  }
  const mL = (l) => l.map((x) => monthLabel(x.period));

  root.append(h('div', { class: 'flex between wrap gap8 mb8' }, h('div', { class: 'sec-title' }, 'UTAX · asosiy ko‘rsatkichlar'), badge('SRC_ERP')));
  root.append(h('div', { class: 'kpis mb16' },
    kpiCard({ icon: 'bank', tone: 'green', href: '#/treasury', label: 'Bank qoldig‘i', value: k.bank_balance, delta: dl.bank_balance, deltaLabel: balLbl, spark: sp.bank }),
    kpiCard({ icon: 'cash', tone: 'blue', href: '#/treasury', label: 'Kassa qoldig‘i', value: k.cash_balance, delta: dl.cash_balance, deltaLabel: balLbl, spark: sp.cash }),
    kpiCard({ icon: 'coins', tone: 'green', href: '#/treasury', label: 'Jami pul mablag‘lari', value: k.total_cash, delta: dl.total_cash, deltaLabel: balLbl, spark: sp.total }),
    kpiCard({ icon: 'inflow', tone: 'orange', href: '#/treasury', label: 'Mijoz avanslari (predoplata)', value: k.customer_advances, delta: dl.customer_advances, deltaLabel: balLbl, spark: sp.advances }),
    kpiCard({ icon: 'receipt', tone: 'red', href: '#/expenses', label: `Xarajatlar ${P}`, value: k.expenses_month, delta: dl.expenses_month, deltaLabel: flowLbl, invert: true, spark: sp.expenses })));

  root.append(h('div', { class: 'kpis c6 mb16' },
    kpiCard({ size: 'sm', accent: true, icon: 'wallet', tone: 'green', href: '#/treasury', label: 'Ishlatish mumkin pul', value: k.available_cash, sub: k.low_liquidity ? 'Likvidlik chegarasidan past' : 'Jami pul − avanslar − rezerv' }),
    kpiCard({ size: 'sm', icon: 'trend', tone: 'green', href: '#/pnl', label: `Tan olingan daromad ${P}`, value: k.recognized_revenue, delta: dl.recognized_revenue, deltaLabel: flowLbl }),
    kpiCard({ size: 'sm', icon: 'users', tone: 'blue', href: '#/receivables', label: 'Olinadigan summalar (debitorlik)', value: k.accounts_receivable, delta: dl.accounts_receivable, deltaLabel: balLbl, invert: true }),
    kpiCard({ size: 'sm', icon: 'calendar', tone: 'teal', href: '#/forecast', label: 'Kutilayotgan daromad (30 kun)', value: k.expected_income, sub: 'To‘lov jadvali bo‘yicha' }),
    kpiCard({ size: 'sm', icon: 'calendar', tone: 'amber', href: '#/forecast', label: 'Kutilayotgan xarajat (30 kun)', value: k.expected_expenses, sub: 'Tasdiqlangan + doimiy xarajatlar' }),
    kpiCard({ size: 'sm', icon: 'award', tone: k.net_profit < 0 ? 'red' : 'green', href: '#/pnl', label: `Sof foyda ${P}`, value: k.net_profit, delta: dl.net_profit, deltaLabel: flowLbl })));

  const cfBody = h('div', {}), rvBody = h('div', {});
  let months = 6;
  const drawTrends = async () => {
    const t = R || months === 6 ? { cash_flow: d.charts.cash_flow, pnl: d.charts.pnl_monthly } : await get('/api/reports/trends?months=' + months);
    cfBody.replaceChildren(lineChart({ labels: mL(t.cash_flow), series: [{ name: 'Tushumlar', values: t.cash_flow.map((x) => x.income), area: true }, { name: 'Xarajatlar', values: t.cash_flow.map((x) => x.expense) }, { name: 'Sof pul oqimi', values: t.cash_flow.map((x) => x.net) }], height: 230 }));
    rvBody.replaceChildren(barChart({ labels: mL(t.pnl), series: [{ name: 'Daromadlar (tan olingan)', values: t.pnl.map((x) => x.revenue) }, { name: 'Xarajatlar', values: t.pnl.map((x) => x.expense) }], height: 230 }));
  };
  const sel1 = monthsSelect(months, (v) => { months = v; sel2.value = v; drawTrends(); }), sel2 = monthsSelect(months, (v) => { months = v; sel1.value = v; drawTrends(); });
  root.append(h('div', { class: 'grid g2 mb16' }, card('Pul oqimi dinamikasi', cfBody, R ? null : [sel1], { sub: R ? rangeLabel(d.range) : undefined }), card('Daromad va xarajatlar taqqoslamasi', rvBody, R ? null : [sel2], { sub: R ? rangeLabel(d.range) : undefined })));
  await drawTrends();

  const donut = (items) => items.length ? donutChart({ items: items.map((x) => ({ name: x.name, value: x.amount, color: x.color })), size: 140 }) : emptyState('Ma’lumot yo‘q', 'Joriy oyda yozuvlar mavjud emas', 'pie');
  root.append(h('div', { class: 'grid g3 mb16' },
    card('Pul mablag‘lari tarkibi', donut(d.charts.cash_composition.filter((x) => x.amount > 0)), null, { sub: R ? date(d.as_of) + ' holatiga' : undefined }),
    card('Daromad manbalari', donut(d.charts.revenue_by_service), null, { sub: R ? rangeLabel(d.range) + ', tan olingan' : 'joriy oy, tan olingan' }),
    card('Xarajatlar tuzilmasi', donut(d.charts.expense_structure), null, { sub: R ? rangeLabel(d.range) : 'joriy oy' })));

  const tbl = (heads, rows, mk) => h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ...heads.map(([l, cls]) => h('th', { class: cls || '' }, l)))), h('tbody', {}, ...(rows.length ? rows.map(mk) : [h('tr', {}, h('td', { class: 'empty', colspan: heads.length }, 'Ma’lumot yo‘q'))]))));
  const ind = d.indicators;
  root.append(h('div', { class: 'grid g3 mb16' },
    card('So‘nggi yirik tushumlar', tbl([['Sana'], ['Kontragent'], ['Turi'], ['Summa', 'right']], d.recent_income, (t) => h('tr', { class: 'row click', onClick: () => navigate(t.contract_id ? 'contracts/' + t.contract_id : 'transactions') }, h('td', { class: 'nowrap' }, date(t.tx_date)), h('td', {}, t.counterparty_name || '--', t.contract_number ? h('div', { class: 'xs muted' }, t.contract_number) : null), h('td', {}, t.matching_status === 'MATCHED' ? (t.service_name || 'To‘lov') : badge(t.matching_status)), h('td', { class: 'right tnum' }, fmt(t.amount)))), [h('a', { class: 'btn xs ghost', href: '#/transactions' }, 'Barchasini ko‘rish', icon('arrowRight', 13))], { tight: true }),
    card('So‘nggi yirik xarajatlar', tbl([['Sana'], ['Nomi'], ['Toifa'], ['Summa', 'right']], d.recent_expenses, (e) => h('tr', { class: 'row click', onClick: () => navigate('expenses/' + e.id) }, h('td', { class: 'nowrap' }, date(e.expense_date)), h('td', {}, h('div', { style: { maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, e.purpose)), h('td', {}, e.category || '--'), h('td', { class: 'right tnum' }, fmt(e.amount)))), [h('a', { class: 'btn xs ghost', href: '#/expenses' }, 'Barchasini ko‘rish', icon('arrowRight', 13))], { tight: true }),
    card('Asosiy ko‘rsatkichlar', h('div', { class: 'stat-tiles' },
      statTile({ icon: 'users', tone: 'green', href: '#/contracts', label: 'Faol mijozlar', value: ind.active_clients, delta: ind.new_clients_month || null }),
      statTile({ icon: 'contract', tone: 'blue', href: '#/contracts', label: 'Faol shartnomalar', value: ind.active_contracts, delta: ind.new_contracts_month || null }),
      statTile({ icon: 'activity', tone: 'teal', href: '#/transactions', label: R ? 'Davrdagi tranzaksiyalar' : 'Jami tranzaksiyalar', value: ind.transactions_total, delta: ind.transactions_month || null }),
      statTile({ icon: 'clock', tone: ind.overdue_count ? 'red' : 'green', href: '#/receivables', label: 'Kechiktirilgan to‘lovlar', value: ind.overdue_count, delta: ind.overdue_count - ind.overdue_count_prev || null, invert: true })), null, { sub: R ? 'o‘zgarish — tanlangan davr' : 'o‘zgarish — joriy oy' })));

  const attention = [
    ['#/approvals', 'Tasdiq kutayotgan so‘rovlar', d.pending.approvals.n, money(d.pending.approvals.s), d.pending.approvals.n ? 'PENDING' : 'OK'],
    ['#/transactions/unmatched', 'Bog‘lanmagan bank tranzaksiyalari', d.pending.unmatched_transactions, 'kirim ' + money(d.pending.unmatched_income_amount), d.pending.unmatched_transactions ? 'UNMATCHED' : 'OK'],
    ['#/expenses/pending', 'Xarajat so‘rovlari', d.pending.expense_requests.n, money(d.pending.expense_requests.s), d.pending.expense_requests.n ? 'PENDING' : 'OK'],
    ['#/reports', 'Ma’lumot sifati muammolari', d.pending.data_quality, 'Ma’lumot sifati agenti', d.pending.data_quality ? 'WARNING' : 'OK'],
  ];
  root.append(h('div', { class: 'grid g3' },
    card('Diqqat talab qiladi', h('div', { class: 'list' }, ...attention.map(([href, t, n, s, st]) => h('a', { class: 'li', href }, h('div', { class: 'grow' }, h('div', { class: 't' }, `${t}: ${n} ta`), h('div', { class: 's' }, s)), badge(st))))),
    card('Reja va fakt', planFact(d.charts.plan_fact), [h('a', { class: 'btn xs ghost', href: '#/planfact' }, 'Batafsil', icon('arrowRight', 13))], { sub: R ? rangeLabel(d.range) : monthLabel(d.month) }),
    card('Debitorlik yoshi (aging)', hBarChart({ items: d.charts.aging.map((b) => ({ label: b.label, value: b.amount, sub: b.count + ' ta', color: b.bucket === 'CURRENT' ? 'var(--s1)' : b.bucket === 'NO_DUE' ? 'var(--muted-2)' : b.bucket === '0-7' ? 'var(--warn)' : b.bucket === '8-15' ? 'var(--orange)' : 'var(--crit)' })) }), [h('a', { class: 'btn xs ghost', href: '#/receivables' }, 'Batafsil', icon('arrowRight', 13))])));
  box.replaceChildren(root);
  }
  await Promise.all([
    erpBanner(erpBox, { can }),
    can('treasury') ? bankBlock(bankBox, { can, query }).catch((e) => bankBox.replaceChildren(alert('crit', 'Bank bloki yuklanmadi: ' + e.message))) : null,
    safeLoad(),
  ]);
}
