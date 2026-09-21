/**
 * Pul oqimi xavfsizligi (review #17–#20, L6, L8, L9, L11): bitta xarajat faqat bir marta to'lanadi — kassa (/kassa, /tolov),
 * bank bog'lash (/boglash) va web API bir xil servis himoyasidan o'tadi; eskirgan karta/dialog, parallel bosish va reversal
 * qilingan xarajat pul chiqimi yaratmaydi. Qo'shimcha: vipiska eslatmasi manbalari, summa tahlili, ro'yxat cheklovlari.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBotHarness } from './helpers/bot-harness.mjs';
import { createServer } from '../src/server.mjs';
import { today, addDays } from '../src/core/util.mjs';
import { money, parseAmount } from '../src/bots/shared/format.mjs';
import { vipiskaEslatma } from '../src/bots/buxgalter/handlers/eslatma.mjs';

let H, S, db, cfo, acc, fm, server, base;
before(async () => {
  H = await createBotHarness();
  S = H.S; db = H.db;
  cfo = H.link('cfo@utax.uz');
  acc = H.link('accountant@utax.uz');
  fm = H.link('finance@utax.uz');
  server = createServer(H.app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); });

const ctxOf = (email) => ({ user: H.user(email), ip: 'test', source: 'TEST' });
const cb = (r, re) => r.buttons.find((b) => re.test(b.callback_data || ''));
const kassaQoldiq = () => S.banking.cashBalance().accounts.find((a) => a.id === 1).balance;
const kassaQatorlari = (expenseId) => db.all('SELECT * FROM cash_transactions WHERE expense_id=? AND reversed_at IS NULL', expenseId);
const javob = (r) => r.answers.map((a) => a.text).join(' | ');

// Har test o'z xarajatini yaratadi: summalar bir-biridan >1% farq qiladi (reconciliation summa tolerantligi), seed xarajatlari bilan kesishmaydi
let seq = 0;
function yangiXarajat({ amount, payment_method = 'BANK', counterparty, purpose } = {}) {
  seq++;
  return S.expenses.createDirect({
    amount: amount ?? 3_100_000 + seq * 170_000, purpose: purpose ?? `Pul xavfsizligi sinovi ${seq}`, counterparty: counterparty ?? `SINOV-${seq} MCHJ`,
    payment_method, status: 'APPROVED', expense_date: today(), required_date: today(),
  }, ctxOf('accountant@utax.uz'));
}
function bankChiqimi({ amount, counterparty = 'BOSHQA KONTRAGENT', purpose = 'Hisob-faktura bo‘yicha', tx_date = today() }) {
  const r = S.banking.createTransaction({ bank_account_id: 1, tx_date, amount, direction: 'EXPENSE', counterparty_name: counterparty, purpose }, ctxOf('accountant@utax.uz'), { skipMatch: true });
  S.reconciliation.autoMatch(r.id, ctxOf('accountant@utax.uz'));
  return db.get('SELECT * FROM bank_transactions WHERE id=?', r.id);
}
/** /kassa → 🔴 Chiqim → summa → maqsad → xarajat tanlash → tasdiq kartasi (b.ks:ok oldi) */
async function kassaTasdiqKartasi(tg, e) {
  await H.send('buxgalter', tg, '/bekor');
  await H.send('buxgalter', tg, '/kassa');
  await H.click('buxgalter', tg, 'b.ks:d:EXPENSE');
  await H.send('buxgalter', tg, String(e.amount));
  await H.send('buxgalter', tg, `Naqd to‘lov ${e.code}`);
  const r = await H.click('buxgalter', tg, `b.ks:ex:${e.id}`);
  assert.match(r.text, /Kassa operatsiyasi — tasdiqlang/);
  assert.ok(cb(r, /^b\.ks:ok$/), 'tasdiq tugmasi');
  return r;
}
/** Bitta getUpdates partiyasidagidek: turli chatlarning callback'lari parallel (bot.enqueue, kutmasdan) */
let updSeq = 9_000_000;
async function parallelBosish(pairs) {
  const bot = H.app.bots.get('buxgalter');
  const now = Math.floor(Date.now() / 1000);
  await Promise.all(pairs.map(([tg, data]) => bot.enqueue({ update_id: ++updSeq, callback_query: { id: `par${updSeq}`, from: { id: Number(tg), is_bot: false, first_name: 'Test' }, data, message: { message_id: 1, date: now, chat: { id: Number(tg), type: 'private' }, text: 'x' } } })));
  await H.app.bots.flush();
}
const login = async (email) => (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Utax2026!' }) })).json()).access_token;
const api = async (token, path, { method = 'GET', body } = {}) => {
  const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};

// ---------- #17 kassa: eskirgan tasdiq kartasi ----------
test('#17 kassa: tasdiq kartasi ochiq turganda xarajat /tolov (kassa) orqali to‘landi → eski «✅ Saqlash» rad etiladi, ikkinchi chiqim yo‘q', async () => {
  const e = yangiXarajat();
  await kassaTasdiqKartasi(cfo, e);
  const oldin = kassaQoldiq();
  // boshqa foydalanuvchi shu xarajatni /tolov → 💵 kassadan to'laydi
  await H.click('buxgalter', acc, `b.pay:c:${e.id}`);
  let r = await H.click('buxgalter', acc, `b.pay:yc:${e.id}`);
  assert.match(r.text, /To‘landi \(kassa\)/);
  assert.equal(kassaQoldiq(), oldin - e.amount);
  // eski karta
  r = await H.click('buxgalter', cfo, 'b.ks:ok');
  assert.match(javob(r), /allaqachon to‘langan/);
  assert.match(r.text, /Kassa chiqimi yozilmadi/);
  assert.equal(kassaQatorlari(e.id).length, 1, 'xarajat uchun bitta kassa chiqimi');
  assert.equal(kassaQoldiq(), oldin - e.amount, 'kassadan bir marta chiqdi');
  // dialog tozalandi — qayta bosish ham yozmaydi
  r = await H.click('buxgalter', cfo, 'b.ks:ok');
  assert.match(javob(r), /eskirgan/);
  assert.equal(kassaQatorlari(e.id).length, 1);
});

test('#17 kassa: karta ochiq turganda xarajat web orqali bankdan to‘landi yoki bank chiqimiga bog‘landi → kassa chiqimi yozilmaydi', async () => {
  const e1 = yangiXarajat();
  await kassaTasdiqKartasi(cfo, e1);
  S.expenses.markPaid(e1.id, { paid_at: today() }, ctxOf('finance@utax.uz')); // web: POST /api/expenses/:id/pay
  let r = await H.click('buxgalter', cfo, 'b.ks:ok');
  assert.match(javob(r), /allaqachon to‘langan/);
  assert.equal(kassaQatorlari(e1.id).length, 0);

  const e2 = yangiXarajat();
  await kassaTasdiqKartasi(cfo, e2);
  const tx = bankChiqimi({ amount: e2.amount });
  S.reconciliation.confirmExpense(tx.id, e2.id, ctxOf('accountant@utax.uz'));
  r = await H.click('buxgalter', cfo, 'b.ks:ok');
  assert.match(javob(r), /allaqachon to‘langan/);
  assert.equal(kassaQatorlari(e2.id).length, 0, 'bankdan to‘langan xarajatga kassa chiqimi yozilmadi');
  assert.equal(S.expenses.get(e2.id).bank_transaction_id, tx.id);
  assert.equal(S.expenses.get(e2.id).cash_transaction_id, null);
});

test('#17/#19 kassa: reversal qilingan xarajat — tanlashda ham, eski kartada ham rad etiladi', async () => {
  const e = yangiXarajat();
  await kassaTasdiqKartasi(cfo, e);
  S.expenses.reverse(e.id, ctxOf('cfo@utax.uz'), 'sinov: xato kiritilgan');
  let r = await H.click('buxgalter', cfo, 'b.ks:ok');
  assert.match(javob(r), /bekor qilingan \(reversal\)/);
  assert.equal(kassaQatorlari(e.id).length, 0);
  assert.equal(db.get('SELECT status FROM expenses WHERE id=?', e.id).status, 'APPROVED', 'reversal qilingan xarajat PAID bo‘lmadi');
  // tanlash bosqichida (soxta/eskirgan b.ks:ex tugmasi)
  await H.send('buxgalter', cfo, '/kassa');
  await H.click('buxgalter', cfo, 'b.ks:d:EXPENSE');
  await H.send('buxgalter', cfo, String(e.amount));
  await H.send('buxgalter', cfo, 'Reversal sinovi');
  r = await H.click('buxgalter', cfo, `b.ks:ex:${e.id}`);
  assert.match(javob(r), /bekor qilingan/);
  assert.doesNotMatch(r.text, /tasdiqlang/);
  await H.send('buxgalter', cfo, '/bekor');
});

test('#17 kassa: ikki chat bir xarajatni parallel «✅ Saqlash» qiladi → faqat bitta kassa chiqimi', async () => {
  const e = yangiXarajat();
  await kassaTasdiqKartasi(cfo, e);
  await kassaTasdiqKartasi(fm, e);
  const oldin = kassaQoldiq();
  await parallelBosish([[cfo, 'b.ks:ok'], [fm, 'b.ks:ok']]);
  assert.equal(kassaQatorlari(e.id).length, 1);
  assert.equal(kassaQoldiq(), oldin - e.amount);
  assert.equal(S.expenses.get(e.id).status, 'PAID');
});

// ---------- #19 /tolov: parallel bosish va reversal ----------
test('#19 tolov: ikki buxgalter bitta partiyada «💵 Kassadan to‘landi» ni bosadi → bitta kassa chiqimi', async () => {
  const e = yangiXarajat();
  const oldin = kassaQoldiq();
  await parallelBosish([[acc, `b.pay:yc:${e.id}`], [fm, `b.pay:yc:${e.id}`]]);
  assert.equal(kassaQatorlari(e.id).length, 1, 'ikkinchi bosish kassa chiqimi yaratmadi');
  assert.equal(kassaQoldiq(), oldin - e.amount);
  assert.equal(db.get("SELECT COUNT(*) n FROM audit_logs WHERE action='EXPENSE_PAID' AND entity='expense' AND entity_id=?", e.id).n, 1);
});

test('#19 tolov: reversal qilingan xarajat eski kartadan to‘lanmaydi (kassa ham, bank ham)', async () => {
  const e = yangiXarajat();
  let r = await H.send('buxgalter', acc, '/tolov');
  assert.ok(cb(r, new RegExp(`^b\\.pay:c:${e.id}$`)), '/tolov kartasi');
  S.expenses.reverse(e.id, ctxOf('cfo@utax.uz'), 'sinov');
  const oldin = kassaQoldiq();
  r = await H.click('buxgalter', acc, `b.pay:c:${e.id}`);
  assert.match(javob(r), /Bekor qilingan \(reversal\)/);
  r = await H.click('buxgalter', acc, `b.pay:yc:${e.id}`);
  assert.match(javob(r), /Bekor qilingan/);
  r = await H.click('buxgalter', acc, `b.pay:yb:${e.id}`);
  assert.match(javob(r), /Bekor qilingan/);
  assert.equal(kassaQatorlari(e.id).length, 0);
  assert.equal(kassaQoldiq(), oldin);
  assert.equal(db.get('SELECT status FROM expenses WHERE id=?', e.id).status, 'APPROVED');
});

test('#17/#19 servis: createCashTransaction PAID/reversal/boshqa holatdagi xarajatni rad etadi; tekshiruvdan keyin holat o‘zgarsa — ROLLBACK', () => {
  const kassa = (e) => ({ cash_account_id: 1, tx_date: today(), amount: e.amount, direction: 'EXPENSE', purpose: e.code, expense_id: e.id });
  const c = ctxOf('cfo@utax.uz');
  const e1 = yangiXarajat();
  S.banking.createCashTransaction(kassa(e1), c);
  assert.throws(() => S.banking.createCashTransaction(kassa(e1), c), /allaqachon to‘langan/);
  assert.equal(kassaQatorlari(e1.id).length, 1);
  const e2 = yangiXarajat();
  S.expenses.reverse(e2.id, c, 'sinov');
  assert.throws(() => S.banking.createCashTransaction(kassa(e2), c), /bekor qilingan/);
  const e3 = S.expenses.request({ amount: 1_234_000, purpose: 'Tasdiqlanmagan so‘rov' }, ctxOf('accountant@utax.uz'));
  assert.throws(() => S.banking.createCashTransaction(kassa(e3), c), /Faqat tasdiqlangan/);
  assert.throws(() => S.banking.createCashTransaction({ ...kassa(e1), expense_id: 999999 }, c), /topilmadi/);
  // Poyga: oldindan tekshiruvdan keyin (boshqa jarayon) xarajatni to'ladi — shartli UPDATE 0 qator → xato, kassa qatori qolmaydi
  const e4 = yangiXarajat();
  const soni = db.get('SELECT COUNT(*) n FROM cash_transactions').n;
  const asl = db.tx;
  db.tx = (fn) => { db.tx = asl; db.run("UPDATE expenses SET status='PAID', paid_at=? WHERE id=?", today(), e4.id); return asl(fn); };
  try { assert.throws(() => S.banking.createCashTransaction(kassa(e4), c), /holati o‘zgardi/); } finally { db.tx = asl; }
  assert.equal(db.get('SELECT COUNT(*) n FROM cash_transactions').n, soni, 'ROLLBACK: kassa chiqimi yozilmadi');
  assert.equal(S.expenses.get(e4.id).cash_transaction_id, null);
  // xarajatsiz kassa chiqimi va kirim — oldingidek ishlaydi
  const t = S.banking.createCashTransaction({ cash_account_id: 1, tx_date: today(), amount: 10_000, direction: 'EXPENSE', purpose: 'Xarajatsiz' }, c);
  assert.equal(t.expense_id, null);
});

test('#17/#19 web: POST /api/cash-transactions to‘langan yoki reversal xarajatga 400 qaytaradi (bot bilan bir xil himoya)', async () => {
  const token = await login('cfo@utax.uz');
  const e = yangiXarajat();
  const body = { cash_account_id: 1, tx_date: today(), amount: e.amount, direction: 'EXPENSE', purpose: 'web', expense_id: e.id };
  let r = await api(token, '/api/cash-transactions', { method: 'POST', body });
  assert.equal(r.status, 200);
  r = await api(token, '/api/cash-transactions', { method: 'POST', body });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /allaqachon to‘langan/);
  assert.equal(kassaQatorlari(e.id).length, 1);
  const e2 = yangiXarajat();
  S.expenses.reverse(e2.id, ctxOf('founder@utax.uz'), 'sinov'); // reversal (web: expenses DELETE)
  r = await api(token, '/api/cash-transactions', { method: 'POST', body: { ...body, expense_id: e2.id } });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /bekor qilingan/);
});

// ---------- #18 /boglash: eskirgan karta ----------
test('#18 boglash: karta ochiq turganda xarajat kassadan to‘landi → eski «✅ EXP» tugmasi rad etiladi, tx bog‘lanmaydi', async () => {
  const e = yangiXarajat({ counterparty: 'HOSTING LLC' });
  const tx = bankChiqimi({ amount: e.amount, counterparty: 'HOSTING LLC', purpose: 'Server ijarasi' });
  let r = await H.click('buxgalter', fm, `b.rc:v:${tx.id}:0`);
  const btn = cb(r, new RegExp(`^b\\.rc:e:${tx.id}:${e.id}:`));
  assert.ok(btn, 'kartada xarajat nomzodi');
  await H.click('buxgalter', acc, `b.pay:yc:${e.id}`);
  assert.ok(S.expenses.get(e.id).cash_transaction_id, 'kassadan to‘landi');
  r = await H.click('buxgalter', fm, btn.callback_data);
  assert.match(javob(r), /kassadan to‘langan/);
  assert.match(r.text, /Bog‘lash<\/b>/, 'karta yangi nomzodlar bilan qayta chizildi');
  assert.doesNotMatch(r.text, /Xarajatga bog‘landi/);
  const t = db.get('SELECT matching_status, matched_expense_id FROM bank_transactions WHERE id=?', tx.id);
  assert.notEqual(t.matching_status, 'MATCHED');
  assert.equal(t.matched_expense_id, null);
  assert.equal(S.expenses.get(e.id).bank_transaction_id, null, 'bank + kassa bir vaqtda bog‘lanmadi');
  assert.ok(!S.reconciliation.suggest(tx.id).candidates.some((c) => c.expense_id === e.id), 'kassadan to‘langan xarajat nomzod emas');
});

test('#18 servis: confirmExpense — kassadan to‘langan, reversal, boshqa tranzaksiyaga bog‘langan xarajat rad etiladi; o‘sha tx qayta tasdiqlanadi', () => {
  const c = ctxOf('accountant@utax.uz');
  // kassadan to'langan
  const e1 = yangiXarajat();
  S.banking.createCashTransaction({ cash_account_id: 1, tx_date: today(), amount: e1.amount, direction: 'EXPENSE', purpose: 'naqd', expense_id: e1.id }, c);
  const tx1 = bankChiqimi({ amount: e1.amount });
  assert.throws(() => S.reconciliation.confirmExpense(tx1.id, e1.id, c), /kassadan to‘langan/);
  // reversal
  const e2 = yangiXarajat();
  const tx2 = bankChiqimi({ amount: e2.amount });
  S.expenses.reverse(e2.id, ctxOf('cfo@utax.uz'), 'sinov');
  assert.throws(() => S.reconciliation.confirmExpense(tx2.id, e2.id, c), /bekor qilingan/);
  // bitta xarajat — ikki bank chiqimi: birinchisi bog'lanadi, ikkinchisi rad etiladi
  const e3 = yangiXarajat();
  const a = bankChiqimi({ amount: e3.amount, purpose: 'birinchi' }), b = bankChiqimi({ amount: e3.amount, purpose: 'ikkinchi' });
  S.reconciliation.confirmExpense(a.id, e3.id, c);
  assert.throws(() => S.reconciliation.confirmExpense(b.id, e3.id, c), /boshqa bank tranzaksiyasiga bog‘langan/);
  assert.equal(S.expenses.get(e3.id).bank_transaction_id, a.id, 'bank_transaction_id ustidan yozilmadi');
  assert.notEqual(db.get('SELECT matching_status FROM bank_transactions WHERE id=?', b.id).matching_status, 'MATCHED');
  // tasdiqlanmagan (PENDING)
  const e4 = S.expenses.request({ amount: 2_222_000, purpose: 'Kutilayotgan so‘rov' }, c);
  const tx4 = bankChiqimi({ amount: 2_222_000 });
  assert.throws(() => S.reconciliation.confirmExpense(tx4.id, e4.id, c), /Faqat tasdiqlangan/);
  // o'sha tranzaksiyaning o'zi (xarajatda allaqachon shu tx id) — qayta tasdiqlash mumkin
  const e5 = yangiXarajat();
  const tx5 = bankChiqimi({ amount: e5.amount });
  db.run("UPDATE expenses SET status='PAID', paid_at=?, bank_transaction_id=? WHERE id=?", today(), tx5.id, e5.id);
  const m = S.reconciliation.confirmExpense(tx5.id, e5.id, c);
  assert.equal(m.matching_status, 'MATCHED');
  assert.equal(m.matched_expense_id, e5.id);
  // poyga: tekshiruvdan keyin xarajat kassadan to'landi → UPDATE 0 qator → ROLLBACK, tx bog'lanmaydi
  const e6 = yangiXarajat();
  const tx6 = bankChiqimi({ amount: e6.amount });
  const asl = db.tx;
  db.tx = (fn) => { db.tx = asl; db.run("UPDATE expenses SET status='PAID', cash_transaction_id=-1 WHERE id=?", e6.id); return asl(fn); };
  try { assert.throws(() => S.reconciliation.confirmExpense(tx6.id, e6.id, c), /holati o‘zgardi/); } finally { db.tx = asl; }
  assert.notEqual(db.get('SELECT matching_status FROM bank_transactions WHERE id=?', tx6.id).matching_status, 'MATCHED');
});

test('#18 web: POST /api/reconciliation/match kassadan to‘langan xarajatga 400 (web va bot bir xil)', async () => {
  const token = await login('accountant@utax.uz');
  const e = yangiXarajat();
  await api(token, '/api/cash-transactions', { method: 'POST', body: { cash_account_id: 1, tx_date: today(), amount: e.amount, direction: 'EXPENSE', purpose: 'naqd', expense_id: e.id } });
  const tx = bankChiqimi({ amount: e.amount });
  const r = await api(token, '/api/reconciliation/match', { method: 'POST', body: { transaction_id: tx.id, expense_id: e.id } });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /kassadan to‘langan/);
  assert.equal(S.expenses.get(e.id).bank_transaction_id, null);
});

test('#18 unmatch: kassadan ham to‘langan (eski buzilgan) xarajatning bank bog‘lanishi olinsa — kassa to‘lovi yo‘qolmaydi, xarajat PAID qoladi', () => {
  const c = ctxOf('accountant@utax.uz');
  const e = yangiXarajat();
  const tx = bankChiqimi({ amount: e.amount });
  S.reconciliation.confirmExpense(tx.id, e.id, c);
  const kassa = S.banking.createCashTransaction({ cash_account_id: 1, tx_date: today(), amount: 1, direction: 'EXPENSE', purpose: 'eski buzilgan holat' }, c);
  db.run('UPDATE expenses SET cash_transaction_id=? WHERE id=?', kassa.id, e.id); // tuzatishdan oldingi ma'lumot: bank + kassa birga
  S.reconciliation.unmatch(tx.id, c, 'sinov');
  const x = S.expenses.get(e.id);
  assert.equal(x.status, 'PAID');
  assert.equal(x.cash_transaction_id, kassa.id);
  assert.equal(x.bank_transaction_id, null);
});

// ---------- #20 /tolov → 🏦 bankdan to'landi → keyingi vipiska ----------
test('#20 tolov (bank) → vipiska: chiqim shu xarajatga avtomatik bog‘lanadi (faqat bank_transaction_id to‘ldiriladi); matn haqiqatga mos', async () => {
  const e = yangiXarajat({ counterparty: 'SOFT LLC', purpose: 'Litsenziya yangilash' });
  await H.click('buxgalter', acc, `b.pay:b:${e.id}`);
  let r = await H.click('buxgalter', acc, `b.pay:yb:${e.id}`);
  assert.match(r.text, /To‘landi \(bank\)/);
  assert.match(r.text, /bu xarajatga bog‘lanadi/);
  assert.doesNotMatch(r.text, /solishtiriladi/);
  const paidAt = S.expenses.get(e.id).paid_at;
  assert.equal(S.expenses.get(e.id).status, 'PAID');
  const res = S.banking.importRows(1, [{ tx_date: addDays(today(), -1), amount: e.amount, direction: 'EXPENSE', counterparty_name: 'SOFT LLC', purpose: `${e.code} Litsenziya yangilash` }], ctxOf('accountant@utax.uz'), 'TELEGRAM');
  assert.equal(res.auto_matched, 1, 'bankdan to‘landi deb belgilangan xarajat nomzod bo‘ldi');
  const x = S.expenses.get(e.id);
  const tx = db.get('SELECT * FROM bank_transactions WHERE matched_expense_id=? ORDER BY id DESC LIMIT 1', e.id);
  assert.equal(tx.matching_status, 'MATCHED');
  assert.equal(x.bank_transaction_id, tx.id);
  assert.equal(x.status, 'PAID');
  assert.equal(x.paid_at, paidAt, 'to‘langan sana o‘zgarmadi — faqat bank bog‘lanishi qo‘shildi');
  // noto'g'ri bog'lash bekor qilinsa — xarajat to'lanmagan (APPROVED) ga qaytmaydi, yana nomzod bo'ladi
  S.reconciliation.unmatch(tx.id, ctxOf('accountant@utax.uz'), 'sinov');
  const y = S.expenses.get(e.id);
  assert.equal(y.status, 'PAID');
  assert.equal(y.bank_transaction_id, null);
  assert.ok(S.reconciliation.suggest(tx.id).candidates.some((c) => c.expense_id === e.id && c.status === 'PAID'));
  // /boglash kartasida qo'lda ham tanlanadi
  r = await H.click('buxgalter', fm, `b.rc:v:${tx.id}:0`);
  assert.match(r.text, /bankdan to‘landi deb belgilangan/);
  const btn = cb(r, new RegExp(`^b\\.rc:e:${tx.id}:${e.id}:`));
  assert.ok(btn);
  r = await H.click('buxgalter', fm, btn.callback_data);
  assert.match(r.text, /Xarajatga bog‘landi/);
  assert.equal(S.expenses.get(e.id).bank_transaction_id, tx.id);
});

test('#20 tolov (bank): to‘lov usuli «Naqd» bo‘lgan xarajat bankdan to‘landi deb belgilansa — usul BANK bo‘ladi va vipiska bog‘lanadi', async () => {
  const e = yangiXarajat({ payment_method: 'CASH', counterparty: 'KANS TOVAR', purpose: 'Kantselyariya' });
  await H.click('buxgalter', acc, `b.pay:yb:${e.id}`);
  assert.equal(S.expenses.get(e.id).payment_method, 'BANK');
  const tx = bankChiqimi({ amount: e.amount, counterparty: 'KANS TOVAR', purpose: `${e.code} kantselyariya` });
  assert.equal(tx.matching_status, 'MATCHED');
  assert.equal(tx.matched_expense_id, e.id);
  // web /pay bilan (usul ko'rsatilmagan) naqd xarajat — bank chiqimiga bog'lanmaydi (kassada to'langan bo'lishi mumkin)
  const n = yangiXarajat({ payment_method: 'CASH' });
  S.expenses.markPaid(n.id, { paid_at: today() }, ctxOf('accountant@utax.uz'));
  const tx2 = bankChiqimi({ amount: n.amount });
  assert.ok(!S.reconciliation.suggest(tx2.id).candidates.some((c) => c.expense_id === n.id));
  assert.throws(() => S.reconciliation.confirmExpense(tx2.id, n.id, ctxOf('accountant@utax.uz')), /to‘lov usuli bank emas/);
});

// ---------- L6 vipiska eslatmasi ----------
test('L6 eslatma: web Excel yuklash, 1C/Sheets sinxroni va webhook ham «bugun vipiska yuklangan» deb hisoblanadi; qo‘lda kiritilgan — yo‘q', () => {
  const yukla = (source, kun) => {
    const res = S.banking.importRows(1, [{ tx_date: kun, amount: 777_000 + kun.length + source.length, direction: 'EXPENSE', counterparty_name: `ESLATMA ${source}`, purpose: `sinov ${source} ${kun}` }], ctxOf('accountant@utax.uz'), source);
    assert.equal(res.created, 1);
    db.run('UPDATE bank_transactions SET created_at=? WHERE id=(SELECT MAX(id) FROM bank_transactions)', `${kun}T06:00:00.000Z`);
  };
  const kunlar = { EXCEL: '2026-10-07', ONE_C: '2026-10-08', GOOGLE_SHEETS: '2026-10-09', WEBHOOK: '2026-10-12' }; // ish kunlari
  for (const [source, kun] of Object.entries(kunlar)) {
    yukla(source, kun);
    assert.equal(vipiskaEslatma(H.app, new Date(`${kun}T12:00:00Z`)).skipped, 'bugun vipiska yuklangan', source);
  }
  // qo'lda kiritilgan tranzaksiya — vipiska emas
  const r = S.banking.createTransaction({ bank_account_id: 1, tx_date: '2026-10-13', amount: 12_345, direction: 'EXPENSE', purpose: 'qo‘lda' }, ctxOf('accountant@utax.uz'), { skipMatch: true });
  db.run("UPDATE bank_transactions SET created_at='2026-10-13T06:00:00.000Z' WHERE id=?", r.id);
  assert.notEqual(vipiskaEslatma(H.app, new Date('2026-10-13T12:00:00Z')).skipped, 'bugun vipiska yuklangan');
});

// ---------- L8 parseAmount ----------
test('L8 parseAmount: aralash ajratgichlar aniq qoida bilan, shubhali — null; yuqori chegara 1e13', () => {
  const ok = {
    '12 500 000': 12_500_000, '12,500,000': 12_500_000, '12.500.000': 12_500_000, '12.500': 12_500, '12500000': 12_500_000,
    '12 500 000.000': 12_500_000, '12 500 000,50': 12_500_000.5, '12,500,000.50': 12_500_000.5, '12.500.000,50': 12_500_000.5, '12 500 000.120': 12_500_000.12,
    '2500000.50': 2_500_000.5, '12,5': 12.5, '12,5 mln': 12_500_000, '1.2 mlrd': 1_200_000_000, '1,500 mln': 1_500_000, '1 500 ming': 1_500_000, '500k': 500_000,
    "500 ming so'm": 500_000, '2 500 000.': 2_500_000, '10 000 000 000 000': 1e13,
  };
  for (const [s, v] of Object.entries(ok)) assert.equal(parseAmount(s), v, s);
  for (const s of ['100 000 000.123', '12 500.000.000', '12.500.000.50', '1 2 3', '1234 567', '1234.500', '25 000 000 000 000', '10 000 000 000 001', '1 5 mln', 'abc', '0', '']) assert.equal(parseAmount(s), null, s);
});

test('L8 kassa: juda katta summa rad etiladi; «12 500 000.000» 1000 barobar oshmaydi', async () => {
  await H.send('buxgalter', cfo, '/bekor');
  await H.send('buxgalter', cfo, '/kassa');
  await H.click('buxgalter', cfo, 'b.ks:d:EXPENSE');
  let r = await H.send('buxgalter', cfo, '25 000 000 000 000');
  assert.match(r.text, /Summani tushunmadim/);
  r = await H.send('buxgalter', cfo, '2 000 000 000 000');
  assert.match(r.text, /Summa juda katta/);
  r = await H.send('buxgalter', cfo, '12 500 000.000');
  assert.match(r.text, new RegExp(`Summa: <b>${money(12_500_000)}</b>`));
  await H.send('buxgalter', cfo, '/bekor');
});

// ---------- L9 / L11 ro'yxatlar ----------
test('L9 GET /api/revenue/recognitions: cheklovsiz (eksport kesilmaydi), limit/offset bilan sahifalanadi', async () => {
  const c = db.get('SELECT id FROM contracts ORDER BY id LIMIT 1');
  db.tx(() => { for (let i = 0; i < 5100; i++) db.insert('revenue_recognition', { contract_id: c.id, amount: 1, recognized_at: '2001-01-15', period: '2001-01', method: 'STRAIGHT_LINE', status: 'RECOGNIZED', created_at: new Date().toISOString() }); });
  const jami = db.get('SELECT COUNT(*) n FROM revenue_recognition').n;
  assert.equal(S.revenue.listRecognitions({}).length, jami);
  const token = await login('accountant@utax.uz');
  let r = await api(token, '/api/revenue/recognitions?from=2001-01-01&to=2001-12-31');
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 5100, '5000 da kesilmadi');
  r = await api(token, '/api/revenue/recognitions?limit=10&offset=5');
  assert.equal(r.body.length, 10);
  assert.deepEqual(r.body.map((x) => x.id), S.revenue.listRecognitions({}).slice(5, 15).map((x) => x.id));
  assert.equal(S.revenue.listRecognitions({ offset: jami - 3 }).length, 3, 'limitsiz offset');
  r = await api(token, '/api/revenue/recognitions?limit=100000000000000000000000&offset=abc');
  assert.equal(r.status, 200, 'juda katta / noto‘g‘ri limit — 500 emas');
  assert.equal(r.body.length, jami);
  assert.equal(S.revenue.listRecognitions({ status: 'PENDING_APPROVAL', limit: 15 }).length <= 15, true);
});

test('L11 GET /api/transactions?statuses=... — 500 emas; vergulli ro‘yxat va massiv bir xil ishlaydi', async () => {
  const token = await login('accountant@utax.uz');
  let r = await api(token, '/api/transactions?statuses=UNMATCHED');
  assert.equal(r.status, 200);
  assert.ok(r.body.length > 0 && r.body.every((t) => t.matching_status === 'UNMATCHED'));
  r = await api(token, '/api/transactions?statuses=UNMATCHED,SUGGESTED');
  assert.equal(r.status, 200);
  const kutilgan = S.banking.listTransactions({ statuses: ['UNMATCHED', 'SUGGESTED'] }).map((t) => t.id);
  assert.deepEqual(r.body.map((t) => t.id), kutilgan);
  assert.ok(r.body.every((t) => ['UNMATCHED', 'SUGGESTED'].includes(t.matching_status)));
  r = await api(token, '/api/transactions?statuses=');
  assert.equal(r.status, 200, 'bo‘sh parametr — filtrsiz');
  assert.equal(r.body.length, S.banking.listTransactions({}).length);
  r = await api(token, '/api/transactions?statuses=UNMATCHED&limit=1.5');
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 1);
});
