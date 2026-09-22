/**
 * Bitta yozuvli moliya jurnali (har operatsiya bitta qator: "Договор", "Поступление БАНК", "Расход Банк з/п",
 * "Расход Касса <matn>", "Расход Трансфер в КАССУ") → import rejasi → baza; Excel ↔ baza yig'indilari mos.
 * Test ma'lumoti to'qima (faqat shu test uchun).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildXlsx } from '../src/core/export.mjs';
import { parseJournal, singleEntryAccount } from '../src/import/excel-journal.mjs';

process.env.BOT_MODE = 'off';
const header = ["Dogovor No", 'Sana', 'Uchish kuni', 'Qaytish kuni', "To'lov kuni", 'Valyuta', 'Summa', 'Shyot nomi', 'Kontragent', 'Napravleniye'];
const JUL1 = 46204; // 2026-07-01
const row = (no, pay, sum, acc, cp, dir) => [no, null, null, null, pay, null, sum, acc, cp, dir];
const rows = [
  row(1, null, 100000000, 'Договор', 'ALFA TEST', 'Ревизия'),
  row(2, null, 5000000, 'Договор', 'BETA TEST', 'Экспресс'),
  row(1, JUL1 + 2, 40000000, 'Поступление БАНК', 'ALFA TEST', 'Ревизия'),
  row(1, JUL1 + 9, 10000000, 'Поступление КАССА', 'ALFA TEST', 'Ревизия'),
  row(3, JUL1 + 3, 7000000, 'Поступление КАССА', 'GAMMA TEST', 'Прочий'),
  row(4, JUL1 + 4, 20000000, 'Расход Трансфер в КАССУ', 'bankdan kassaga'),
  row(5, JUL1 + 4, 3000000, 'Расход КАССА ДИВИДЕНД', 'Test ta’sischi'),
  row(6, 23943, 500000, 'Расход Касса Kondisioner usta', 'Kondisioner usta'), // 1965-yil — shubhali sana
  row(7, JUL1 + 5, 12000000, 'Расход Банк з/п', 'з/п'),
  row(8, JUL1 + 5, 9000000, 'Расход Банк ДИВИДЕНД', 'Учредитель'),
  row(9, JUL1 + 6, 4000000, 'Расход Банк возврат', 'возврат'),
  row(10, JUL1 + 6, 1500, 'Расход Банк комиссия банка', 'комиссия банка'),
];
const xlsx = buildXlsx({ sheetName: 'Лист1', header, rows });

test('singleEntryAccount: hisob nomidan tur/yo‘nalish/modda', () => {
  assert.deepEqual(singleEntryAccount('Договор'), { kind: 'CONTRACT' });
  assert.deepEqual(singleEntryAccount('Расход Трансфер в КАССУ'), { kind: 'TRANSFER', from: 'BANK', to: 'CASH' });
  assert.deepEqual(singleEntryAccount('Поступление БАНК'), { kind: 'MONEY', side: 'BANK', dir: 'INCOME', item: null });
  assert.deepEqual(singleEntryAccount('Расход Банк з/п'), { kind: 'MONEY', side: 'BANK', dir: 'EXPENSE', item: 'з/п' });
  assert.equal(singleEntryAccount('Расход Касса Чоршанба ош').item, 'Чоршанба ош');
  assert.equal(singleEntryAccount('Дебитор'), null);
});

test('bitta yozuvli jurnal: reja to‘g‘ri, shubhali sana karantinga tushadi', () => {
  const plan = parseJournal(xlsx, { fileName: 't.xlsx' });
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.meta.format, 'SINGLE_ENTRY');
  assert.equal(plan.contracts.length, 2);
  const alfa = plan.contracts.find((c) => c.company === 'ALFA TEST');
  assert.equal(alfa.amount, 100000000);
  assert.equal(alfa.service, 'Ревизия');
  assert.equal(alfa.contract_date, null, 'faylda shartnoma sanasi yo‘q — to‘qilmaydi');
  assert.deepEqual(alfa.payments.map((p) => [p.side, p.date, p.amount]), [['BANK', '2026-07-03', 40000000], ['CASH', '2026-07-10', 10000000]]);
  assert.equal(plan.incomes.length, 1);
  assert.equal(plan.transfers.length, 1);
  assert.deepEqual(plan.nonExpenses.map((x) => x.kind).sort(), ['DIVIDEND', 'DIVIDEND', 'REFUND']);
  assert.deepEqual(plan.expenses.map((e) => e.category_key).sort(), ['з/п', 'комиссия банка']);
  assert.equal(plan.quarantine.length, 1);
  assert.equal(plan.quarantine[0].date, '1965-07-20');
});

test('--fix-date: foydalanuvchi tasdiqlagan sana qo‘llanadi va ogohlantirishda ko‘rsatiladi', () => {
  const plan = parseJournal(xlsx, { fileName: 't.xlsx', dateFixes: { 9: '2026-07-20' } }); // qator 9 = No 6
  assert.equal(plan.quarantine.length, 0);
  const e = plan.expenses.find((x) => x.no === 6);
  assert.equal(e.date, '2026-07-20');
  assert.equal(e.category_key, null, 'kassa erkin matni — kategoriyasiz');
  assert.ok(plan.warnings.some((w) => /1965-07-20 → 2026-07-20/.test(w.message)));
});

test('bitta yozuvli jurnal bazaga yoziladi, Excel ↔ baza mos', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utax-se-'));
  const dbPath = path.join(dir, 't.db');
  const { createApp } = await import('../src/server.mjs');
  const { applyJournal, verifyImport } = await import('../src/import/apply-journal.mjs');
  const app = createApp({ dbPath });
  try {
    const plan = parseJournal(xlsx, { fileName: 't.xlsx', dateFixes: { 9: '2026-07-20' } });
    const res = applyJournal(app, plan);
    assert.equal(res.created.contracts, 2);
    assert.equal(res.created.payments, 2);
    const v = verifyImport(app, plan);
    assert.equal(v.ok, true, JSON.stringify(v.checks?.filter?.((c) => !c.ok)));
    const alfa = app.db.get("SELECT c.* FROM contracts c JOIN companies co ON co.id=c.company_id WHERE co.name='ALFA TEST'");
    assert.equal(alfa.contract_date, null);
    // Foydalanuvchi hisoblarni qayta nomlaydi va boshlang'ich qoldiq kiritadi → qayta import yangi hisob ochmaydi, takror yozmaydi
    app.db.run("UPDATE bank_accounts SET bank_name='UTAX BANK', opening_balance=1000, opening_date='2026-07-01'");
    app.db.run("UPDATE cash_accounts SET name='Asosiy kassa', opening_balance=500, opening_date='2026-07-01'");
    const again = applyJournal(app, plan);
    assert.equal(again.created.contracts, 0);
    assert.equal(again.created.expenses, 0);
    assert.equal(again.created.bank_accounts + again.created.cash_accounts, 0);
    assert.equal(again.created.bank_transactions + again.created.cash_transactions, 0);
    assert.equal(app.db.get('SELECT COUNT(*) n FROM bank_accounts').n, 1);
    assert.equal(app.db.get('SELECT COUNT(*) n FROM cash_accounts').n, 1);
  } finally {
    app.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('web: /api/integrations/ledger-upload bitta yozuvli jurnalni tanib, preview + import qiladi (qayta yuklash takrorlanmaydi)', async () => {
  const { createBotHarness } = await import('./helpers/bot-harness.mjs');
  const { createServer } = await import('../src/server.mjs');
  const H = await createBotHarness();
  const server = createServer(H.app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const lr = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'cfo@utax.uz', password: 'Utax2026!' }) });
    const token = (await lr.json()).access_token;
    const post = async (body) => { const r = await fetch(`${base}/api/integrations/ledger-upload`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
    const payload = { xlsx_base64: xlsx.toString('base64'), file_name: 'iyul-test.xlsx' };
    const p = await post({ ...payload, preview: true });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.equal(p.body.format, 'SINGLE_ENTRY');
    assert.equal(p.body.sales, 2);
    assert.equal(p.body.sales_amount, 105000000);
    assert.equal(p.body.transfers, 1);
    assert.ok(p.body.skipped.some((s) => /1965-07-20/.test(s.reason)), '1965 sanali qator karantin sifatida ko‘rsatiladi');
    const r = await post(payload);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.created.contracts, 2);
    assert.equal(r.body.verify_ok, true);
    const again = await post(payload);
    assert.equal(again.body.created.contracts, 0);
    assert.equal(again.body.created.bank + again.body.created.cash, 0);
    assert.ok(again.body.duplicates > 0);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
