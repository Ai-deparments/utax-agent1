/**
 * Review qoldiqlari (4 ta): web dashboard debitorligi SALES scope'ida; expenses.markPaid reversal/ikki marta to'lashga qarshi;
 * bank autoMatch — «bankdan to'landi» (PAID) eski xarajat yangi APPROVED xarajatning avtomatik bog'lanishini bo'lmaydi;
 * FOUNDER rolini faqat FOUNDER beradi/o'zgartiradi.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBotHarness } from './helpers/bot-harness.mjs';
import { createServer } from '../src/server.mjs';
import { today, addDays } from '../src/core/util.mjs';

let H, S, db, server, base;
before(async () => {
  H = await createBotHarness();
  S = H.S; db = H.db;
  server = createServer(H.app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); });

const ctxOf = (email) => ({ user: H.user(email), ip: 'test', source: 'TEST' });
let seq = 0;
const xarajat = (extra = {}) => { seq++; return S.expenses.createDirect({ amount: 7_300_000 + seq * 410_000, purpose: `Qoldiq sinovi ${seq}`, counterparty: `QOLDIQ-${seq} MCHJ`, payment_method: 'BANK', status: 'APPROVED', expense_date: today(), ...extra }, ctxOf('accountant@utax.uz')); };
async function login(email) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Utax2026!' }) });
  return (await r.json()).access_token;
}
async function http(method, path, body, token) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}

test('dashboard: SALES debitorlik KPI va top qarzdorlari faqat o‘z shartnomalari (web /api/dashboard ham)', async () => {
  const sales = H.user('sales@utax.uz');
  const own = S.receivables.summary(today(), S.receivables.scopeFor(sales));
  const all = S.receivables.summary(today());
  assert.ok(all.total_receivable > own.total_receivable, 'seed’da boshqa sotuvchilarning qarzi ham bor');
  const d = S.reports.dashboard(null, sales);
  assert.equal(d.kpi.accounts_receivable, own.total_receivable);
  const ownClients = new Set(own.top_debtors.map((x) => x.client ?? x.company_name ?? x.name));
  for (const t of d.receivables.top) assert.ok(ownClients.has(t.client ?? t.company_name ?? t.name), 'begona mijoz top’da bo‘lmasin');
  // CFO — butun kompaniya
  assert.equal(S.reports.dashboard(null, H.user('cfo@utax.uz')).kpi.accounts_receivable, all.total_receivable);
  const w = await http('GET', '/api/dashboard', null, await login('sales@utax.uz'));
  assert.equal(w.status, 200);
  assert.equal(w.body.kpi.accounts_receivable, own.total_receivable);
});

test('markPaid: reversal qilingan va allaqachon to‘langan xarajat qayta to‘lanmaydi (web /pay 400)', async () => {
  const e = xarajat();
  db.run('UPDATE expenses SET reversed_at=? WHERE id=?', new Date().toISOString(), e.id);
  assert.throws(() => S.expenses.markPaid(e.id, {}, ctxOf('accountant@utax.uz')), /bekor qilingan/);
  assert.equal(db.get('SELECT status FROM expenses WHERE id=?', e.id).status, 'APPROVED');

  const e2 = xarajat();
  S.expenses.markPaid(e2.id, {}, ctxOf('accountant@utax.uz'));
  assert.equal(db.get('SELECT status FROM expenses WHERE id=?', e2.id).status, 'PAID');
  assert.throws(() => S.expenses.markPaid(e2.id, {}, ctxOf('accountant@utax.uz')), /allaqachon to‘langan/);
  const w = await http('POST', `/api/expenses/${e2.id}/pay`, {}, await login('accountant@utax.uz'));
  assert.equal(w.status, 400);
});

test('autoMatch: eski PAID (bankdan to‘landi) xarajat yangi APPROVED xarajatning kod bo‘yicha avtomatik bog‘lanishini buzmaydi', () => {
  for (const [kun, maqsad] of [[3, (c) => c], [35, (c) => `${c} Ofis ijarasi`]]) {
    seq++;
    const amount = 21_000_000 + seq * 530_000, counterparty = `IJARA-${seq} MCHJ`;
    const eski = S.expenses.createDirect({ amount, purpose: 'Ofis ijarasi', counterparty, payment_method: 'BANK', status: 'APPROVED', expense_date: addDays(today(), -kun) }, ctxOf('accountant@utax.uz'));
    S.expenses.markPaid(eski.id, { paid_at: addDays(today(), -kun) }, ctxOf('accountant@utax.uz')); // PAID, bank tranzaksiyasiga bog'lanmagan
    const yangi = S.expenses.createDirect({ amount, purpose: 'Ofis ijarasi', counterparty, payment_method: 'BANK', status: 'APPROVED', expense_date: today() }, ctxOf('accountant@utax.uz'));
    const r = S.banking.createTransaction({ bank_account_id: 1, tx_date: today(), amount, direction: 'EXPENSE', counterparty_name: counterparty, purpose: maqsad(yangi.code) }, ctxOf('accountant@utax.uz'));
    const tx = db.get('SELECT * FROM bank_transactions WHERE id=?', r.id);
    assert.equal(tx.matching_status, 'MATCHED', `${kun} kun oldin to‘langan eski xarajat bilan ham yangi xarajat avtomatik bog‘lansin`);
    assert.equal(db.get('SELECT bank_transaction_id FROM expenses WHERE id=?', yangi.id).bank_transaction_id, r.id);
    assert.equal(db.get('SELECT bank_transaction_id FROM expenses WHERE id=?', eski.id).bank_transaction_id, null);
  }
});

test('FOUNDER rolini faqat FOUNDER beradi/o‘zgartiradi: ADMIN o‘zini ham, boshqani ham ta’sischi qila olmaydi (403)', async () => {
  const admin = await login('admin@utax.uz');
  const adminId = H.user('admin@utax.uz').id, empId = H.user('employee@utax.uz').id, fid = H.user('founder@utax.uz').id;
  assert.equal((await http('PATCH', `/api/users/${adminId}`, { role_code: 'FOUNDER' }, admin)).status, 403);
  assert.equal((await http('PATCH', `/api/users/${empId}`, { role_code: 'FOUNDER' }, admin)).status, 403);
  assert.equal((await http('PATCH', `/api/users/${fid}`, { role_code: 'EMPLOYEE' }, admin)).status, 403);
  assert.equal((await http('POST', '/api/users', { email: 'yangi.founder@utax.uz', name: 'X', role_code: 'FOUNDER', password: 'Parol-12345' }, admin)).status, 403);
  assert.equal(H.user('admin@utax.uz').role_code, 'ADMIN');
  assert.equal(H.user('founder@utax.uz').role_code, 'FOUNDER');
  // ADMIN oddiy rollarni o'zgartira oladi; FOUNDER esa FOUNDER bera oladi
  assert.equal((await http('PATCH', `/api/users/${empId}`, { role_code: 'SALES' }, admin)).status, 200);
  const founder = await login('founder@utax.uz');
  assert.equal((await http('PATCH', `/api/users/${empId}`, { role_code: 'FOUNDER' }, founder)).status, 200);
  assert.equal((await http('PATCH', `/api/users/${empId}`, { role_code: 'EMPLOYEE' }, founder)).status, 200);
});
