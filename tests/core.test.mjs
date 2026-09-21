import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.mjs';
import { seed } from '../src/seed/seed.mjs';

let app, S, db, cfo, acc, founder, sales;
const ctx = (email) => ({ user: db.get('SELECT * FROM users WHERE email=?', email), ip: '127.0.0.1', source: 'TEST' });
before(async () => { app = createApp({ dbPath: ':memory:' }); await seed(app, { log: () => {} }); S = app.services; db = app.db; cfo = ctx('cfo@utax.uz'); acc = ctx('accountant@utax.uz'); founder = ctx('founder@utax.uz'); sales = ctx('sales@utax.uz'); });

test('BANKDAGI PUL ≠ DAROMAD ≠ AVAILABLE: available = total − advances − reserved', () => {
  const t = S.reports.treasury();
  assert.equal(t.total_cash, Math.round((t.bank_balance + t.cash_balance) * 100) / 100);
  assert.equal(t.available_cash, Math.round((t.total_cash - t.restricted_cash - t.reserved.total) * 100) / 100);
  assert.ok(t.customer_advances > 0, 'avanslar mavjud');
  assert.ok(t.available_cash < t.total_cash, 'available < total');
});

test('Revenue recognition: avans → CUSTOMER_ADVANCE, xizmat yakunlanib akt bo‘lsa → RECOGNIZED', () => {
  const co = db.get('SELECT id FROM companies LIMIT 1');
  const st = db.get("SELECT id FROM service_types WHERE code='REVISION'");
  const c = S.contracts.create({ company_id: co.id, service_type_id: st.id, amount: 30e6, contract_date: '2026-09-01', end_date: '2026-09-20', advance_pct: 50, payment_due_date: '2026-09-30' }, sales);
  assert.match(c.contract_number, /^UTAX-R-\d{5}$/);
  const tx = S.banking.createTransaction({ bank_account_id: 1, tx_date: '2026-09-02', amount: 15e6, direction: 'INCOME', counterparty_name: 'X', purpose: `Oplata ${c.contract_number}` }, acc, { skipMatch: true });
  const m = S.reconciliation.autoMatch(tx.id, acc);
  assert.equal(m.status, 'MATCHED', 'shartnoma raqami bo‘yicha auto-match');
  let d = S.contracts.get(c.id);
  assert.equal(d.paid, 15e6); assert.equal(d.recognized, 0); assert.equal(d.advance_balance, 15e6); assert.equal(d.contract_status, 'ADVANCE_RECEIVED');
  // aktsiz yakunlash → BLOCKED
  let r = S.contracts.setServiceStatus(c.id, 'COMPLETED', sales, { completed_at: '2026-09-15' });
  assert.equal(r.recognition.status, 'BLOCKED');
  S.contracts.addDocument(c.id, { doc_type: 'ACT', name: 'Akt' }, sales);
  d = S.contracts.get(c.id);
  assert.equal(d.recognized, 30e6, 'chegaradan past → darhol tan olindi');
  assert.equal(d.advance_balance, 0, 'avans RECOGNIZED_REVENUE ga o‘tdi');
  assert.equal(d.remaining, 15e6); assert.equal(d.contract_status, 'FINAL_PAYMENT_EXPECTED');
});

test('Material recognition (≥ threshold) → CFO approval talab qilinadi; AI agent tasdiqlay olmaydi', () => {
  const co = db.get('SELECT id FROM companies LIMIT 1');
  const st = db.get("SELECT id FROM service_types WHERE code='AUDIT'");
  const c = S.contracts.create({ company_id: co.id, service_type_id: st.id, amount: 90e6, contract_date: '2026-09-01', end_date: '2026-09-20', advance_pct: 0, payment_due_date: '2026-09-30' }, sales);
  S.contracts.addDocument(c.id, { doc_type: 'ACT', name: 'Akt' }, sales);
  const r = S.contracts.setServiceStatus(c.id, 'COMPLETED', sales, { completed_at: '2026-09-15' });
  assert.equal(r.recognition.status, 'PENDING_APPROVAL');
  assert.equal(S.contracts.get(c.id).recognized, 0);
  const ai = { user: { id: null, role_code: 'AI_AGENT', name: 'bot' }, source: 'AI' };
  assert.throws(() => S.approvals.decide(r.recognition.approval_id, 'APPROVE', ai), /tasdiqlaydi/);
  S.approvals.decide(r.recognition.approval_id, 'APPROVE', cfo, 'ok');
  assert.equal(S.contracts.get(c.id).recognized, 90e6);
});

test('Reconciliation: INN + summa (raqamsiz) → SUGGESTED, human confirm kerak; AI agent confirm qila olmaydi', () => {
  const c = S.contracts.list({ active: true }).find((x) => x.remaining > 0 && x.company_inn);
  const tx = S.banking.createTransaction({ bank_account_id: 1, tx_date: '2026-09-19', amount: c.remaining, direction: 'INCOME', counterparty_name: c.company_name, counterparty_inn: c.company_inn, purpose: 'Oplata za uslugi' }, acc, { skipMatch: true });
  const m = S.reconciliation.autoMatch(tx.id, acc);
  assert.equal(m.status, 'SUGGESTED'); assert.ok(m.confidence >= 60 && m.confidence < 95);
  assert.throws(() => S.reconciliation.confirm(tx.id, c.id, { user: { role_code: 'AI_AGENT' } }), /AI agent/);
  S.reconciliation.confirm(tx.id, c.id, cfo);
  assert.equal(S.contracts.get(c.id).remaining, 0);
  // unmatch → reversal, o‘chirish emas
  S.reconciliation.unmatch(tx.id, cfo, 'test');
  assert.equal(S.contracts.get(c.id).remaining, c.remaining);
  assert.ok(db.get('SELECT COUNT(*) n FROM payments WHERE bank_transaction_id=? AND reversed_at IS NOT NULL', tx.id).n === 1);
});

test('Approval engine: limitlar qoidadan (5–20M → Dept Head → Finance), employee → dept head → finance', () => {
  const emp = ctx('employee@utax.uz');
  const e = S.expenses.request({ amount: 8e6, purpose: 'Test reklama kampaniyasi', required_date: '2026-10-01' }, emp);
  const a = S.approvals.get(e.approval_id);
  assert.deepEqual(a.steps.map((s) => s.role), ['DEPARTMENT_HEAD', 'FINANCE_MANAGER']);
  assert.throws(() => S.approvals.decide(a.id, 'APPROVE', ctx('finance@utax.uz')), /DEPARTMENT_HEAD/);
  S.approvals.decide(a.id, 'APPROVE', ctx('head.marketing@utax.uz'));
  assert.equal(S.expenses.get(e.id).status, 'PENDING');
  S.approvals.decide(a.id, 'APPROVE', ctx('finance@utax.uz'));
  assert.equal(S.expenses.get(e.id).status, 'APPROVED');
  assert.ok(db.get("SELECT COUNT(*) n FROM audit_logs WHERE entity='approval' AND entity_id=?", a.id).n >= 3, 'har qadam audit');
});

test('P&L identity: net = revenue − direct − opex − tax − other; oylik payroll P&L da', () => {
  const p = S.reports.pnl({ month: '2026-08' });
  const t = p.totals;
  assert.equal(t.net, Math.round((t.revenue - t.direct - t.opex - t.taxes - t.other) * 100) / 100);
  assert.ok(t.revenue > 0 && t.opex > 0);
});

test('Data quality agent: akt yo‘q shartnoma va bog‘lanmagan tranzaksiyalarni topadi', () => {
  const dq = S.reports.dataQuality();
  assert.ok(dq.issues.some((i) => i.code === 'COMPLETED_NO_ACT'));
  assert.ok(dq.issues.some((i) => i.code === 'TX_UNMATCHED'));
});

test('Collection agent: T-bosqichlar, dublikat yaratmaydi', () => {
  const r1 = S.receivables.runCollectionAgent('2026-09-20');
  const r2 = S.receivables.runCollectionAgent('2026-09-20');
  assert.equal(r2.created, 0);
  assert.ok(db.get("SELECT COUNT(*) n FROM collections WHERE stage='T+15'").n > 0);
});

test('Financial history o‘chirilmaydi: tranzaksiya reversal qarama-qarshi yozuv yaratadi', () => {
  const tx = db.get("SELECT * FROM bank_transactions WHERE matching_status='IGNORED' LIMIT 1");
  const r = S.banking.reverseTransaction(tx.id, cfo, 'test');
  assert.ok(db.get('SELECT id FROM bank_transactions WHERE id=?', tx.id), 'asl yozuv joyida');
  assert.equal(db.get('SELECT direction FROM bank_transactions WHERE id=?', r.reversal_id).direction, tx.direction === 'INCOME' ? 'EXPENSE' : 'INCOME');
});
