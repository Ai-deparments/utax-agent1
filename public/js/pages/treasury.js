import { get, post, patch } from '../api.js';
import { h, kpiCard, card, fmt, money, short, date, dataTable, kv, formModal, toast, err, today, alert, icon } from '../ui.js';

export default async function render(root, { setTitle, can }) {
  let dateTo = today();
  let dateFrom = dateTo.slice(0, 8) + '01';
  const box = h('div', {});
  const onRange = () => { if (!fromInp.value || !toInp.value) return; if (fromInp.value > toInp.value) return toast('Boshlanish sanasi tugash sanasidan keyin bo‘lishi mumkin emas', 'err'); dateFrom = fromInp.value; dateTo = toInp.value; load(); };
  const fromInp = h('input', { class: 'input sm', type: 'date', value: dateFrom, title: 'Boshlanish sanasi', onChange: onRange });
  const toInp = h('input', { class: 'input sm', type: 'date', value: dateTo, title: 'Tugash sanasi', onChange: onRange });
  async function load() {
    const [t, cash] = await Promise.all([get(`/api/treasury?from=${dateFrom}&to=${dateTo}`), get(`/api/cash-transactions?from=${dateFrom}&to=${dateTo}`)]);
    setTitle('Pul boshqaruvi', `Bank, kassa, avanslar va ishlatish mumkin bo‘lgan mablag‘ · ${date(t.as_of)}`, [h('span', { class: 'date-range small muted' }, h('span', { class: 'dr-part' }, 'Sanadan:', fromInp), h('span', { class: 'dr-part' }, 'Sanagacha:', toInp)), can('treasury', 'CREATE') ? h('button', { class: 'btn', onClick: () => accountForm() }, icon('plus', 15), 'Bank hisobi') : null, can('treasury', 'CREATE') ? h('button', { class: 'btn pri', onClick: () => cashForm() }, icon('plus', 15), 'Kassa operatsiyasi') : null]);
    const r = t.reserved;
    const fm = (lb, v, cls = '') => h('div', {}, h('div', { class: 'lb' }, lb), h('div', { class: 'vl ' + cls }, fmt(v)));
    const pd = t.period;
    const pRow = (lb, x) => h('tr', {}, h('td', {}, lb), h('td', { class: 'right pos' }, fmt(x.income)), h('td', { class: 'right neg' }, fmt(x.expense)), h('td', { class: 'right tnum ' + (x.net < 0 ? 'neg' : '') }, fmt(x.net)));
    const periodCard = pd ? h('div', { class: 'mb16' }, card(`Tanlangan davr: ${date(pd.from)} — ${date(pd.to)}`, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Hisob'), h('th', { class: 'right' }, 'Kirim'), h('th', { class: 'right' }, 'Chiqim'), h('th', { class: 'right' }, 'Sof'))), h('tbody', {},
      h('tr', {}, h('td', { class: 'muted' }, 'Davr boshidagi pul'), h('td', { class: 'right tnum', colspan: 3 }, fmt(pd.opening_cash))),
      pRow(`Bank (${pd.bank.count_in} kirim, ${pd.bank.count_out} chiqim)`, pd.bank), pRow(`Kassa (${pd.cash.count_in} kirim, ${pd.cash.count_out} chiqim)`, pd.cash),
      h('tr', { class: 'total' }, h('td', {}, 'Jami'), h('td', { class: 'right' }, fmt(pd.total.income)), h('td', { class: 'right' }, fmt(pd.total.expense)), h('td', { class: 'right' }, fmt(pd.total.net))),
      h('tr', { class: 'total' }, h('td', {}, 'Davr oxiridagi pul'), h('td', { class: 'right', colspan: 3 }, fmt(pd.closing_cash))))), null, { tight: true, sub: 'bank va kassa harakati' })) : null;
    box.replaceChildren(
      periodCard,
      h('div', { class: 'card mb16' }, h('div', { class: 'formula' }, fm('Jami pul (bank + kassa)', t.total_cash), h('div', { class: 'op' }, '−'), fm('Cheklangan pul (mijoz avanslari)', t.restricted_cash), h('div', { class: 'op' }, '−'), fm('Rezerv', r.total), h('div', { class: 'op' }, '='), h('div', { class: 'res' }, h('div', { class: 'lb' }, 'Ishlatish mumkin pul'), h('div', { class: 'vl pri' }, fmt(t.available_cash), h('span', { class: 'small muted', style: { fontWeight: 500 } }, ' so‘m')))),
        h('div', { style: { padding: '0 20px 16px' } }, alert(t.low_liquidity ? 'crit' : 'mint', h('span', {}, h('b', {}, 'Hozir xavfsiz olish mumkin: '), h('b', { style: { fontSize: '16px' } }, money(t.safe_withdrawal)), h('div', { class: 'xs', style: { opacity: .85 } }, 'Ishlatish mumkin pul − 30 kunlik kutilayotgan chiqim + 30 kunlik kutilayotgan kirimning 50 foizi', t.low_liquidity ? ' · Likvidlik chegarasidan past!' : '')), 'wallet'))),
      h('div', { class: 'kpis mb16' },
        kpiCard({ size: 'sm', icon: 'bank', tone: 'green', label: 'Bank qoldig‘i', value: t.bank_balance, sub: `${t.accounts.bank.length} ta hisob` }),
        kpiCard({ size: 'sm', icon: 'cash', tone: 'blue', label: 'Kassa qoldig‘i', value: t.cash_balance, sub: `${t.accounts.cash.length} ta kassa` }),
        kpiCard({ size: 'sm', icon: 'inflow', tone: 'orange', label: 'Mijoz avanslari', value: t.customer_advances, sub: 'Xizmat bajarilmagan — daromad emas' }),
        kpiCard({ size: 'sm', icon: 'layers', tone: 'amber', label: 'Rezerv', value: r.total, sub: 'Majburiyatlar uchun ajratilgan' }),
        kpiCard({ size: 'sm', accent: true, icon: 'wallet', tone: 'green', label: 'Ishlatish mumkin pul', value: t.available_cash, sub: t.low_liquidity ? 'Likvidlik chegarasidan past' : 'Erkin mablag‘' })),
      h('div', { class: 'grid g3 mb16 tr-row' },
        card('Kutilayotgan pul oqimi', h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Davr'), h('th', { class: 'right' }, 'Kirim'), h('th', { class: 'right' }, 'Chiqim'), h('th', { class: 'right' }, 'Sof'))), h('tbody', {},
          h('tr', {}, h('td', {}, '7 kun'), h('td', { class: 'right pos' }, fmt(t.expected_7d_income)), h('td', { class: 'right neg' }, fmt(t.expected_7d_expense)), h('td', { class: 'right tnum' }, fmt(t.expected_7d_income - t.expected_7d_expense))),
          h('tr', {}, h('td', {}, '30 kun'), h('td', { class: 'right pos' }, fmt(t.expected_30d_income)), h('td', { class: 'right neg' }, fmt(t.expected_30d_expense)), h('td', { class: 'right tnum' }, fmt(t.expected_30d_income - t.expected_30d_expense))),
          h('tr', { class: 'total' }, h('td', {}, 'Muddati o‘tgan debitorlik'), h('td', { class: 'right', colspan: 3 }, fmt(t.overdue_receivable))))), null, { tight: true, sub: 'to‘lov jadvali va xarajatlar bo‘yicha' }),
        card('Rezerv tarkibi', kv([['Tasdiqlangan, to‘lanmagan xarajatlar', money(r.approved_unpaid_expenses)], ['Tasdiqlangan oylik (to‘lanmagan)', money(r.pending_payroll)], ['Xavfsizlik rezervi (sozlama)', money(r.safety_reserve)], [h('b', {}, 'Jami rezerv'), h('b', {}, money(r.total))]])),
        card('Hisoblar', h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Hisob'), h('th', {}, 'Raqam'), h('th', { class: 'right' }, 'Qoldiq'), h('th', {}))), h('tbody', {}, ...t.accounts.bank.map((a) => h('tr', {}, h('td', {}, a.bank_name, h('div', { class: 'xs muted' }, `boshlang‘ich qoldiq ${fmt(a.opening_balance)}${a.opening_date ? ' · ' + date(a.opening_date) : ''}`)), h('td', { class: 'xs muted' }, a.account_number || '—'), h('td', { class: 'right tnum' }, fmt(a.balance)), h('td', { class: 'right' }, can('treasury', 'CREATE') ? h('button', { class: 'btn xs ghost', title: 'Tahrirlash', onClick: () => editAcc('bank', a) }, icon('edit', 13)) : null))), ...t.accounts.cash.map((a) => h('tr', {}, h('td', {}, a.name, h('div', { class: 'xs muted' }, `boshlang‘ich qoldiq ${fmt(a.opening_balance)}${a.opening_date ? ' · ' + date(a.opening_date) : ''}`)), h('td', { class: 'xs muted' }, 'kassa'), h('td', { class: 'right tnum' }, fmt(a.balance)), h('td', { class: 'right' }, can('treasury', 'CREATE') ? h('button', { class: 'btn xs ghost', title: 'Tahrirlash', onClick: () => editAcc('cash', a) }, icon('edit', 13)) : null))), h('tr', { class: 'total' }, h('td', { colspan: 2 }, 'Jami'), h('td', { class: 'right' }, fmt(t.total_cash)), h('td', {})))), can('treasury', 'CREATE') ? [h('button', { class: 'btn xs ghost', onClick: () => cashAccForm() }, icon('plus', 13), 'Kassa')] : null, { tight: true })),
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
  function editAcc(kind, a) {
    const isBank = kind === 'bank';
    formModal({ title: (isBank ? 'Bank hisobi: ' : 'Kassa: ') + (isBank ? a.bank_name : a.name), fields: [
      isBank ? { name: 'bank_name', label: 'Bank nomi', value: a.bank_name, required: true } : { name: 'name', label: 'Kassa nomi', value: a.name, required: true },
      isBank ? { name: 'account_number', label: 'Hisob raqami', value: a.account_number || '' } : null,
      { name: 'opening_balance', label: 'Boshlang‘ich qoldiq (so‘m)', type: 'number', value: a.opening_balance ?? 0, hint: 'Boshlang‘ich sanadagi haqiqiy qoldiq (bank ko‘chirmasi / kassa daftaridan)' },
      { name: 'opening_date', label: 'Boshlang‘ich sana', type: 'date', value: a.opening_date || '' }].filter(Boolean),
      submit: async (v) => { await patch(`/api/banking/${isBank ? 'accounts' : 'cash-accounts'}/${a.id}`, v); toast('Saqlandi', 'ok'); load(); } });
  }
  function cashAccForm() { formModal({ title: 'Kassa qo‘shish', fields: [{ name: 'name', label: 'Kassa nomi', required: true }, { name: 'opening_balance', label: 'Boshlang‘ich qoldiq (so‘m)', type: 'number', value: 0 }, { name: 'opening_date', label: 'Boshlang‘ich sana', type: 'date', value: today() }], submit: async (v) => { await post('/api/banking/cash-accounts', v); toast('Kassa qo‘shildi', 'ok'); load(); } }); }
  function accountForm() { formModal({ title: 'Bank hisobi qo‘shish', fields: [{ name: 'bank_name', label: 'Bank nomi', required: true }, { name: 'account_number', label: 'Hisob raqami' }, { name: 'currency', label: 'Valyuta', value: 'UZS' }, { name: 'opening_balance', label: 'Boshlang‘ich qoldiq', type: 'number', value: 0 }, { name: 'opening_date', label: 'Boshlang‘ich sana', type: 'date', value: today() }], submit: async (v) => { await post('/api/banking/accounts', v); toast('Hisob qo‘shildi', 'ok'); load(); } }); }
  root.append(box);
  await load();
}
