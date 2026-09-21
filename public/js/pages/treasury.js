import { get, post } from '../api.js';
import { h, kpiCard, card, fmt, money, short, date, dataTable, kv, formModal, toast, err, today, alert, icon } from '../ui.js';

export default async function render(root, { setTitle, can }) {
  let asOf = today();
  const box = h('div', {});
  const dateInp = h('input', { class: 'input sm', type: 'date', value: asOf, onChange: (e) => { asOf = e.target.value; load(); } });
  async function load() {
    const [t, cash] = await Promise.all([get('/api/treasury?as_of=' + asOf), get('/api/cash-transactions')]);
    setTitle('Pul boshqaruvi', `Bank, kassa, avanslar va ishlatish mumkin bo‘lgan mablag‘ · ${date(t.as_of)}`, [h('span', { class: 'flex gap8 small muted' }, 'Sana:', dateInp), can('treasury', 'CREATE') ? h('button', { class: 'btn', onClick: () => accountForm() }, icon('plus', 15), 'Bank hisobi') : null, can('treasury', 'CREATE') ? h('button', { class: 'btn pri', onClick: () => cashForm() }, icon('plus', 15), 'Kassa operatsiyasi') : null]);
    const r = t.reserved;
    const fm = (lb, v, cls = '') => h('div', {}, h('div', { class: 'lb' }, lb), h('div', { class: 'vl ' + cls }, fmt(v)));
    box.replaceChildren(
      h('div', { class: 'card mb16' }, h('div', { class: 'formula' }, fm('Jami pul (bank + kassa)', t.total_cash), h('div', { class: 'op' }, '−'), fm('Cheklangan pul (mijoz avanslari)', t.restricted_cash), h('div', { class: 'op' }, '−'), fm('Rezerv', r.total), h('div', { class: 'op' }, '='), h('div', { class: 'res' }, h('div', { class: 'lb' }, 'Ishlatish mumkin pul'), h('div', { class: 'vl pri' }, fmt(t.available_cash), h('span', { class: 'small muted', style: { fontWeight: 500 } }, ' so‘m')))),
        h('div', { style: { padding: '0 20px 16px' } }, alert(t.low_liquidity ? 'crit' : 'mint', h('span', {}, h('b', {}, 'Hozir xavfsiz olish mumkin: '), h('b', { style: { fontSize: '16px' } }, money(t.safe_withdrawal)), h('div', { class: 'xs', style: { opacity: .85 } }, 'Ishlatish mumkin pul − 30 kunlik kutilayotgan chiqim + 30 kunlik kutilayotgan kirimning 50 foizi', t.low_liquidity ? ' · Likvidlik chegarasidan past!' : '')), 'wallet'))),
      h('div', { class: 'kpis mb16' },
        kpiCard({ size: 'sm', icon: 'bank', tone: 'green', label: 'Bank qoldig‘i', value: t.bank_balance, sub: `${t.accounts.bank.length} ta hisob` }),
        kpiCard({ size: 'sm', icon: 'cash', tone: 'blue', label: 'Kassa qoldig‘i', value: t.cash_balance, sub: `${t.accounts.cash.length} ta kassa` }),
        kpiCard({ size: 'sm', icon: 'inflow', tone: 'orange', label: 'Mijoz avanslari', value: t.customer_advances, sub: 'Xizmat bajarilmagan — daromad emas' }),
        kpiCard({ size: 'sm', icon: 'layers', tone: 'amber', label: 'Rezerv', value: r.total, sub: 'Majburiyatlar uchun ajratilgan' }),
        kpiCard({ size: 'sm', accent: true, icon: 'wallet', tone: 'green', label: 'Ishlatish mumkin pul', value: t.available_cash, sub: t.low_liquidity ? 'Likvidlik chegarasidan past' : 'Erkin mablag‘' })),
      h('div', { class: 'grid g3 mb16' },
        card('Kutilayotgan pul oqimi', h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Davr'), h('th', { class: 'right' }, 'Kirim'), h('th', { class: 'right' }, 'Chiqim'), h('th', { class: 'right' }, 'Sof'))), h('tbody', {},
          h('tr', {}, h('td', {}, '7 kun'), h('td', { class: 'right pos' }, fmt(t.expected_7d_income)), h('td', { class: 'right neg' }, fmt(t.expected_7d_expense)), h('td', { class: 'right tnum' }, fmt(t.expected_7d_income - t.expected_7d_expense))),
          h('tr', {}, h('td', {}, '30 kun'), h('td', { class: 'right pos' }, fmt(t.expected_30d_income)), h('td', { class: 'right neg' }, fmt(t.expected_30d_expense)), h('td', { class: 'right tnum' }, fmt(t.expected_30d_income - t.expected_30d_expense))),
          h('tr', { class: 'total' }, h('td', {}, 'Muddati o‘tgan debitorlik'), h('td', { class: 'right', colspan: 3 }, fmt(t.overdue_receivable))))), null, { tight: true, sub: 'to‘lov jadvali va xarajatlar bo‘yicha' }),
        card('Rezerv tarkibi', kv([['Tasdiqlangan, to‘lanmagan xarajatlar', money(r.approved_unpaid_expenses)], ['Tasdiqlangan oylik (to‘lanmagan)', money(r.pending_payroll)], ['Xavfsizlik rezervi (sozlama)', money(r.safety_reserve)], [h('b', {}, 'Jami rezerv'), h('b', {}, money(r.total))]])),
        card('Hisoblar', h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Hisob'), h('th', {}, 'Raqam'), h('th', { class: 'right' }, 'Qoldiq'))), h('tbody', {}, ...t.accounts.bank.map((a) => h('tr', {}, h('td', {}, a.bank_name), h('td', { class: 'xs muted' }, a.account_number || '—'), h('td', { class: 'right tnum' }, fmt(a.balance)))), ...t.accounts.cash.map((a) => h('tr', {}, h('td', {}, a.name), h('td', { class: 'xs muted' }, 'kassa'), h('td', { class: 'right tnum' }, fmt(a.balance)))), h('tr', { class: 'total' }, h('td', { colspan: 2 }, 'Jami'), h('td', { class: 'right' }, fmt(t.total_cash))))), null, { tight: true })),
      card('Kassa operatsiyalari', dataTable({ columns: [{ key: 'tx_date', label: 'Sana', date: true }, { key: 'direction', label: 'Yo‘nalish', badge: true }, { key: 'amount', label: 'Summa', money: true }, { key: 'counterparty_name', label: 'Kontragent' }, { key: 'purpose', label: 'Maqsad' }, { key: 'contract_number', label: 'Shartnoma' }, { key: 'cash_account', label: 'Kassa' }], rows: cash, dateKey: 'tx_date', exportName: 'kassa-operatsiyalari' }).el, null, { tight: true }));
  }
  async function cashForm() {
    const [contracts, exps] = await Promise.all([get('/api/contracts'), get('/api/expenses?status=APPROVED')]);
    formModal({ title: 'Kassa operatsiyasi', fields: [
      { name: 'direction', label: 'Yo‘nalish', type: 'select', options: [['INCOME', 'Kirim'], ['EXPENSE', 'Chiqim']], required: true }, { name: 'tx_date', label: 'Sana', type: 'date', value: today(), required: true },
      { name: 'amount', label: 'Summa (so‘m)', type: 'number', required: true }, { name: 'counterparty_name', label: 'Kontragent' },
      { name: 'contract_id', label: 'Shartnoma (kirim uchun)', type: 'select', options: [['', '—'], ...contracts.filter((c) => c.remaining > 0).map((c) => [c.id, `${c.contract_number} ${c.company_name} (qoldiq ${short(c.remaining)})`])] },
      { name: 'expense_id', label: 'Xarajat (chiqim uchun, tasdiqlangan)', type: 'select', options: [['', '—'], ...exps.map((e) => [e.id, `${e.code} ${e.purpose} (${short(e.amount)})`])] },
      { name: 'purpose', label: 'Maqsad', full: true }], submit: async (v) => { await post('/api/cash-transactions', { ...v, cash_account_id: 1, contract_id: v.contract_id || null, expense_id: v.expense_id || null }); toast('Saqlandi', 'ok'); load(); } });
  }
  function accountForm() { formModal({ title: 'Bank hisobi qo‘shish', fields: [{ name: 'bank_name', label: 'Bank nomi', required: true }, { name: 'account_number', label: 'Hisob raqami' }, { name: 'currency', label: 'Valyuta', value: 'UZS' }, { name: 'opening_balance', label: 'Boshlang‘ich qoldiq', type: 'number', value: 0 }, { name: 'opening_date', label: 'Boshlang‘ich sana', type: 'date', value: today() }], submit: async (v) => { await post('/api/banking/accounts', v); toast('Hisob qo‘shildi', 'ok'); load(); } }); }
  root.append(box);
  await load();
}
