/** MVP ACCEPTANCE (TZ §45): 15 savolga real, tekshiriladigan raqamlar bilan javob. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.mjs';
import { seed } from './fixtures/demo-seed.mjs'; // to'qima test ma'lumotlari — faqat testlar uchun
import { monthRange, monthOf, today } from '../src/core/util.mjs';

let app, S, db, cfo;
before(async () => { app = createApp({ dbPath: ':memory:' }); await seed(app, { log: () => {} }); S = app.services; db = app.db; cfo = { user: db.get("SELECT * FROM users WHERE email='cfo@utax.uz'"), ip: '127.0.0.1' }; });
const num = (v) => { assert.equal(typeof v, 'number'); assert.ok(Number.isFinite(v)); return v; };

test('1. Bankda qancha pul bor? = Σ(opening + kirim − chiqim) bank hisoblari', () => {
  const t = S.reports.treasury(); num(t.bank_balance);
  const manual = db.all('SELECT id, opening_balance FROM bank_accounts').reduce((s, a) => s + a.opening_balance + db.get("SELECT COALESCE(SUM(CASE WHEN direction='INCOME' THEN amount ELSE -amount END),0) m FROM bank_transactions WHERE bank_account_id=? AND reversed_at IS NULL AND tx_date<=?", a.id, today()).m, 0);
  assert.equal(t.bank_balance, Math.round(manual * 100) / 100);
});
test('2. Kassada qancha pul bor?', () => { const t = S.reports.treasury(); num(t.cash_balance); assert.ok(t.cash_balance > 0); });
test('3. Shundan qanchasi predoplata? = Σ CUSTOMER_ADVANCE eventlari', () => { const t = S.reports.treasury(); assert.equal(t.customer_advances, db.get("SELECT COALESCE(SUM(amount),0) s FROM revenue_events WHERE state='CUSTOMER_ADVANCE'").s); });
test('4. Haqiqatan qancha pulni ishlata olamiz? = total − advances − reserved', () => { const t = S.reports.treasury(); assert.equal(t.available_cash, Math.round((t.total_cash - t.restricted_cash - t.reserved.total) * 100) / 100); });
test('5. Shu oy qancha daromad tan olindi? = Σ revenue_recognition (RECOGNIZED) joriy oy', () => { const { from, to } = monthRange(monthOf(today())); const v = num(S.revenue.recognizedInPeriod(from, to)); assert.equal(v, db.get("SELECT COALESCE(SUM(amount),0) s FROM revenue_recognition WHERE status='RECOGNIZED' AND recognized_at BETWEEN ? AND ?", from, to).s); });
test('6. Shu oy qancha xarajat bo‘ldi? = Σ APPROVED+PAID xarajatlar', () => { const { from, to } = monthRange(monthOf(today())); const v = num(S.expenses.total(from, to)); assert.equal(v, db.get("SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE reversed_at IS NULL AND status IN ('APPROVED','PAID') AND expense_date BETWEEN ? AND ?", from, to).s); });
test('7. Sof foyda qancha? (P&L)', () => { const p = S.reports.pnl({ period: 'month' }); num(p.totals.net); assert.equal(p.totals.net, Math.round((p.totals.revenue - p.totals.direct - p.totals.opex - p.totals.taxes - p.totals.other) * 100) / 100); });
test('8. Kim bizdan qancha qarzdor? (jadval, Σ = total receivable)', () => { const rows = S.receivables.list(); assert.ok(rows.length > 0); const s = S.receivables.summary(); assert.equal(s.total_receivable, Math.round(rows.reduce((a, x) => a + x.debt, 0) * 100) / 100); for (const r of rows) { assert.ok(r.client && r.contract_number); num(r.debt); } });
test('9. Qaysi qarzdorlik muddati o‘tgan? (aging)', () => { const rows = S.receivables.list({ filter: 'overdue' }); assert.ok(rows.length > 0); for (const r of rows) assert.ok(r.days_overdue > 0 && r.overdue_amount > 0); const ag = S.receivables.aging(); assert.equal(ag.overdue, Math.round(rows.reduce((a, x) => a + x.overdue_amount, 0) * 100) / 100); });
test('10. Keyingi 7/30 kunda qancha pul tushishi kerak?', () => { const s = S.receivables.summary(); num(s.expected_7d); num(s.expected_30d); assert.ok(s.expected_30d >= s.expected_7d); });
test('11. Keyingi 7/30 kunda qancha pul chiqadi?', () => { const t = S.reports.treasury(); num(t.expected_7d_expense); num(t.expected_30d_expense); assert.ok(t.expected_30d_expense >= t.expected_7d_expense); });
test('12. Qaysi xizmat eng ko‘p foyda keltiryapti?', () => { const sp = S.reports.serviceProfitability({ month: '2026-08' }); assert.ok(sp.rows.length >= 4); assert.ok(sp.rows[0].net_profit >= sp.rows[1].net_profit); for (const r of sp.rows) { num(r.revenue); num(r.net_profit); assert.ok(['OK', 'LOW', 'LOSS', 'NO_DATA'].includes(r.verdict)); } });
test('13. Plan necha foiz bajarildi?', () => { const pf = S.budget.planFact('2026-08'); assert.equal(pf.items.length, 5); for (const i of pf.items) { num(i.plan); num(i.fact); num(i.pct); } });
test('14. Qaysi bank tranzaksiyalari shartnoma bilan bog‘lanmagan?', () => { const rows = db.all("SELECT * FROM bank_transactions WHERE matching_status IN ('UNMATCHED','SUGGESTED') AND reversed_at IS NULL"); assert.ok(rows.length > 0); const st = S.reconciliation.stats(); assert.equal(rows.length, (st.unmatched || 0) + (st.suggested || 0)); });
test('15. Qaysi xarajatlar tasdiq kutmoqda?', () => { const rows = S.expenses.list({ status: 'PENDING' }, cfo.user); assert.ok(rows.length > 0); for (const r of rows) assert.ok(r.approval_id && r.code.startsWith('EXP-')); });
test('AI Finance: 15 savolga rule-based router javob beradi (raqam bilan)', async () => {
  const qs = ['Bankda qancha pul bor?', 'Kassada qancha pul bor?', 'Shundan qanchasi predoplata?', 'Haqiqatan qancha pulni ishlata olamiz?', 'Shu oy qancha daromad tan olindi?', 'Shu oy qancha xarajat bo‘ldi?', 'Sof foyda qancha?', 'Kim bizdan qancha qarzdor?', 'Qaysi qarzdorlik muddati o‘tgan?', 'Keyingi 7 kunda qancha pul tushishi kerak?', 'Keyingi 30 kunda qancha pul chiqadi?', 'Qaysi xizmat eng ko‘p foyda keltiryapti?', 'Plan necha foiz bajarildi?', 'Qaysi bank tranzaksiyalari shartnoma bilan bog‘lanmagan?', 'Qaysi xarajatlar tasdiq kutmoqda?'];
  const expected = ['CASH', 'CASH', 'CASH', 'CASH', 'REVENUE', 'EXPENSES', 'PROFIT', 'DEBTORS', 'OVERDUE', 'EXPECTED_INCOME', 'EXPECTED_EXPENSES', 'SERVICE_PROFIT', 'PLAN', 'UNMATCHED', 'APPROVALS'];
  for (let i = 0; i < qs.length; i++) { const r = await S.ai.chat(qs[i], cfo, { channel: 'TEST' }); assert.equal(r.intent, expected[i], `"${qs[i]}" → ${r.intent}`); assert.match(r.answer, /\d/, 'javobda raqam bor'); }
});
