import { get, downloadXlsx, qs } from '../api.js';
import { h, card, badge, err, icon, emptyState, alert, dateRange, rangeLabel } from '../ui.js';

export default async function render(root, { setTitle }) {
  const month = new Date().toISOString().slice(0, 7);
  // Sana tanlanmasa — avvalgidek (barcha ma'lumot / joriy oy); tanlansa — har bir hisobot shu oraliq bo'yicha
  const rng = dateRange({ allowEmpty: true, onChange: () => draw() });
  const P = (f, t) => (f ? `?period=custom&from=${f}&to=${t}` : '?month=' + month);
  const inR = (d, f, t) => !f || (d && String(d).slice(0, 10) >= f && String(d).slice(0, 10) <= t);
  const R = [
    ['Shartnomalar', (f, t) => get('/api/contracts' + qs({ from: f, to: t })), ['contract_number', 'company_name', 'company_inn', 'service_name', 'amount', 'paid', 'remaining', 'contract_date', 'payment_due_date', 'contract_status', 'service_status', 'payment_status', 'manager_name'], 'shartnoma sanasi'],
    ['Bank tranzaksiyalari', (f, t) => get('/api/transactions' + qs({ from: f, to: t })), ['tx_date', 'bank_name', 'direction', 'amount', 'counterparty_name', 'counterparty_inn', 'purpose', 'matching_status', 'confidence', 'matched_contract_number', 'matched_expense_code'], 'tranzaksiya sanasi'],
    ['Debitorlik', (f, t) => get('/api/receivables' + qs({ due_from: f, due_to: t })), ['client', 'inn', 'contract_number', 'service_name', 'manager', 'total', 'paid', 'debt', 'range_amount', 'overdue_amount', 'due_date', 'days_overdue', 'bucket'], 'to‘lov muddati'],
    ['Xarajatlar', (f, t) => get('/api/expenses' + qs({ from: f, to: t })), ['code', 'expense_date', 'department_name', 'category_name', 'purpose', 'counterparty', 'amount', 'status', 'requested_by_name', 'paid_at'], 'xarajat sanasi'],
    ['Foyda va zarar', async (f, t) => (await get('/api/reports/pnl' + P(f, t))).lines, ['label', 'amount', 'margin'], 'davr'],
    ['Xizmatlar rentabelligi', async (f, t) => (await get('/api/reports/service-profitability' + P(f, t))).rows, ['name', 'contracts', 'revenue', 'direct_expense', 'payroll', 'dept_opex', 'allocated_opex', 'gross_profit', 'net_profit', 'margin', 'verdict'], 'davr'],
    ['Pul oqimi', async (f, t) => { const c = await get('/api/reports/cash-flow' + P(f, t)); if (!f) return c.monthly; return [['Davr boshidagi pul', c.opening_cash], ['Operatsion kirim', c.operating.inflow], ['Operatsion chiqim', -c.operating.outflow], ['Investitsion kirim', c.investing.inflow], ['Investitsion chiqim', -c.investing.outflow], ['Moliyaviy kirim', c.financing.inflow], ['Moliyaviy chiqim', -c.financing.outflow], ['Davr oxiridagi pul', c.closing_cash]].map(([name, amount]) => ({ name, amount })); }, (f) => (f ? ['name', 'amount'] : ['period', 'income', 'expense', 'net']), 'davr'],
    ['Balans', async (f, t) => { const b = await get('/api/reports/balance-sheet' + (t ? '?as_of=' + t : '')); return [...b.assets.map((x) => ({ section: 'AKTIVLAR', ...x })), ...b.liabilities.map((x) => ({ section: 'MAJBURIYATLAR', ...x })), { section: 'KAPITAL', name: 'Kapital', amount: b.equity }]; }, ['section', 'name', 'amount'], 'tugash sanasidagi holat'],
    ['Reja va fakt', async (f, t) => { const pf = await get('/api/planfact' + qs({ from: f, to: t })); return f ? pf.items.map((i) => ({ name: i.name, plan: i.plan, fact: i.fact, pct: i.pct, diff: i.diff })) : pf.series; }, (f) => (f ? ['name', 'plan', 'fact', 'pct', 'diff'] : ['period', 'revenue_plan', 'revenue_fact', 'expense_plan', 'expense_fact', 'profit_plan', 'profit_fact']), 'davr'],
    ['Daromadni tan olish', (f, t) => get('/api/revenue/recognitions' + qs({ from: f, to: t })), ['recognized_at', 'period', 'contract_number', 'company_name', 'service_code', 'amount', 'method', 'status'], 'tan olish sanasi'],
    ['Undiruv vazifalari', async (f, t) => (await get('/api/collections')).filter((x) => inR(x.task_date, f, t)), ['task_date', 'stage', 'client', 'contract_number', 'due_date', 'debt', 'status', 'assigned_name'], 'vazifa sanasi'],
    ['Audit jurnali', (f, t) => get('/api/audit' + qs({ from: f, to: t })), ['ts', 'user_name', 'role', 'action', 'entity', 'entity_id', 'source'], 'harakat sanasi'],
  ];
  const dq = await get('/api/reports/data-quality');
  const link = (x) => (x.entity === 'contract' ? '#/contracts/' + x.id : x.entity === 'transaction' ? '#/transactions/unmatched' : x.entity === 'expense' ? '#/expenses/' + x.id : x.entity === 'approval' ? '#/approvals/' + x.id : '#/settings');
  const dqCard = card('Ma’lumot sifati', dq.issues.length ? h('div', { class: 'list' }, ...dq.issues.map((i) => h('div', { class: 'li', style: { flexDirection: 'column', alignItems: 'stretch' } }, h('div', { class: 'flex gap8' }, badge(i.severity), h('b', {}, i.title), h('span', { class: 'muted' }, `(${i.count})`)), h('div', { class: 'small mt8 chips' }, ...i.items.slice(0, 12).map((x) => h('a', { class: 'chip', href: link(x) }, x.label)), i.count > 12 ? h('span', { class: 'muted' }, `+${i.count - 12}`) : null)))) : alert('good', 'Ma’lumot sifati muammolari yo‘q'), null, { sub: `${dq.total} ta muammo · ${dq.checked_at}` });
  const grid = h('div', { class: 'grid g2' });
  function draw() {
    const { from: f, to: t } = rng.value;
    setTitle('Hisobotlar', `Eksport markazi va ma’lumot sifati · ${rangeLabel(rng.value)}`, [rng.el]);
    grid.replaceChildren(
      card('Eksport markazi', h('div', { class: 'list' }, ...R.map(([name, fn, keys, basis]) => h('div', { class: 'li', style: { alignItems: 'center' } }, h('div', { class: 'grow' }, h('div', { class: 't' }, name), f ? h('div', { class: 's' }, `${rangeLabel(rng.value)} · ${basis}`) : null), h('button', { class: 'btn xs', onClick: async (e) => { e.target.disabled = true; try { const rows = await fn(f, t); const k = typeof keys === 'function' ? keys(f) : keys; await downloadXlsx(f ? `${name} ${f}_${t}` : name, k.map((x) => ({ key: x, label: x })), rows); } catch (x) { err(x); } finally { e.target.disabled = false; } } }, icon('download', 13), 'Excel')))), [h('button', { class: 'btn xs ghost', onClick: () => window.print() }, icon('printer', 13), 'PDF')], { sub: f ? rangeLabel(rng.value) : 'Excel / PDF' }),
      dqCard);
  }
  draw();
  root.append(grid);
}
