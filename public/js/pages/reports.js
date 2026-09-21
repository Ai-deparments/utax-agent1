import { get, downloadXlsx } from '../api.js';
import { h, card, badge, err, icon, emptyState, alert } from '../ui.js';

export default async function render(root, { setTitle }) {
  setTitle('Hisobotlar', 'Eksport markazi va ma’lumot sifati');
  const month = new Date().toISOString().slice(0, 7);
  const R = [
    ['Shartnomalar', () => get('/api/contracts'), ['contract_number', 'company_name', 'company_inn', 'service_name', 'amount', 'paid', 'remaining', 'contract_date', 'payment_due_date', 'contract_status', 'service_status', 'payment_status', 'manager_name']],
    ['Bank tranzaksiyalari', () => get('/api/transactions'), ['tx_date', 'bank_name', 'direction', 'amount', 'counterparty_name', 'counterparty_inn', 'purpose', 'matching_status', 'confidence', 'matched_contract_number', 'matched_expense_code']],
    ['Debitorlik', () => get('/api/receivables'), ['client', 'inn', 'contract_number', 'service_name', 'manager', 'total', 'paid', 'debt', 'overdue_amount', 'due_date', 'days_overdue', 'bucket']],
    ['Xarajatlar', () => get('/api/expenses'), ['code', 'expense_date', 'department_name', 'category_name', 'purpose', 'counterparty', 'amount', 'status', 'requested_by_name', 'paid_at']],
    ['Foyda va zarar (joriy oy)', async () => (await get('/api/reports/pnl?month=' + month)).lines, ['label', 'amount', 'margin']],
    ['Xizmatlar rentabelligi', async () => (await get('/api/reports/service-profitability?month=' + month)).rows, ['name', 'contracts', 'revenue', 'direct_expense', 'payroll', 'dept_opex', 'allocated_opex', 'gross_profit', 'net_profit', 'margin', 'verdict']],
    ['Pul oqimi (oylik)', async () => (await get('/api/reports/cash-flow?month=' + month)).monthly, ['period', 'income', 'expense', 'net']],
    ['Balans', async () => { const b = await get('/api/reports/balance-sheet'); return [...b.assets.map((x) => ({ section: 'AKTIVLAR', ...x })), ...b.liabilities.map((x) => ({ section: 'MAJBURIYATLAR', ...x })), { section: 'KAPITAL', name: 'Kapital', amount: b.equity }]; }, ['section', 'name', 'amount']],
    ['Reja va fakt (6 oy)', async () => (await get('/api/planfact')).series, ['period', 'revenue_plan', 'revenue_fact', 'expense_plan', 'expense_fact', 'profit_plan', 'profit_fact']],
    ['Daromadni tan olish', () => get('/api/revenue/recognitions'), ['recognized_at', 'period', 'contract_number', 'company_name', 'service_code', 'amount', 'method', 'status']],
    ['Undiruv vazifalari', () => get('/api/collections'), ['task_date', 'stage', 'client', 'contract_number', 'due_date', 'debt', 'status', 'assigned_name']],
    ['Audit jurnali', () => get('/api/audit'), ['ts', 'user_name', 'role', 'action', 'entity', 'entity_id', 'source']],
  ];
  const dq = await get('/api/reports/data-quality');
  const link = (x) => (x.entity === 'contract' ? '#/contracts/' + x.id : x.entity === 'transaction' ? '#/transactions/unmatched' : x.entity === 'expense' ? '#/expenses/' + x.id : x.entity === 'approval' ? '#/approvals/' + x.id : '#/settings');
  const dqCard = card('Ma’lumot sifati', dq.issues.length ? h('div', { class: 'list' }, ...dq.issues.map((i) => h('div', { class: 'li', style: { flexDirection: 'column', alignItems: 'stretch' } }, h('div', { class: 'flex gap8' }, badge(i.severity), h('b', {}, i.title), h('span', { class: 'muted' }, `(${i.count})`)), h('div', { class: 'small mt8 chips' }, ...i.items.slice(0, 12).map((x) => h('a', { class: 'chip', href: link(x) }, x.label)), i.count > 12 ? h('span', { class: 'muted' }, `+${i.count - 12}`) : null)))) : alert('good', 'Ma’lumot sifati muammolari yo‘q'), null, { sub: `${dq.total} ta muammo · ${dq.checked_at}` });
  root.append(h('div', { class: 'grid g2' },
    card('Eksport markazi', h('div', { class: 'list' }, ...R.map(([name, fn, keys]) => h('div', { class: 'li', style: { alignItems: 'center' } }, h('div', { class: 'grow t' }, name), h('button', { class: 'btn xs', onClick: async (e) => { e.target.disabled = true; try { const rows = await fn(); await downloadXlsx(name, keys.map((k) => ({ key: k, label: k })), rows); } catch (x) { err(x); } finally { e.target.disabled = false; } } }, icon('download', 13), 'Excel')))), [h('button', { class: 'btn xs ghost', onClick: () => window.print() }, icon('printer', 13), 'PDF')], { sub: 'Excel / PDF' }),
    dqCard));
}
