/**
 * Dashboard standart davri: /api/dashboard?auto=1 — mavjud ma'lumotning birinchi sanasidan oxirgisigacha (auto_range = data_span).
 * Web shu oraliqni sana tanlagichga qo'yadi va tashqaridagi sanalarni o'chiradi. Avval faqat oxirgi oy tanlanardi
 * (ERP'da avgustda 1 ta yozuv bo'lsa, butun dashboard avgustni ko'rsatardi, bank bloki esa iyulni).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.BOT_MODE = 'off';

test('dashboard auto=1: standart davr = data_span (birinchi → oxirgi sana), bank ko‘chirmasi sanalari ham hisobga olinadi', async () => {
  const { createBotHarness } = await import('./helpers/bot-harness.mjs');
  const { createServer } = await import('../src/server.mjs');
  const H = await createBotHarness();
  const db = H.app.db;
  // Bank ko'chirmasi qatori (to'qima) — boshqa manbalardan keyingi sana bilan: data_span oxiri shu bo'lishi kerak
  const span0 = H.app.services.reports.dataSpan();
  const cid = db.insert('own_companies', { code: 'TST', name: 'TEST', created_at: new Date().toISOString() });
  const aid = db.insert('own_accounts', { company_id: cid, account_number: '20208000100000000099', kind: 'BANK', label: 'Test bank', created_at: new Date().toISOString() });
  db.insert('bank_statement_lines', { account_id: aid, tx_date: '2099-01-15', amount: 1, direction: 'IN', uniq_key: 'tst-1', created_at: new Date().toISOString() });
  const span = H.app.services.reports.dataSpan();
  assert.equal(span.last, '2099-01-15', 'bank ko‘chirmasi sanasi data_span ga kiradi');
  assert.equal(span.first, span0.first);

  const server = createServer(H.app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const lr = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'cfo@utax.uz', password: 'Utax2026!' }) });
    const token = (await lr.json()).access_token;
    const get = (p) => fetch(base + p, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
    const d = await get('/api/dashboard?auto=1');
    assert.deepEqual(d.auto_range, { from: span.first, to: span.last });
    assert.deepEqual(d.range, { from: span.first, to: span.last }, 'KPI’lar shu oraliq bo‘yicha hisoblanadi');
    assert.deepEqual(d.data_span, span, 'web sana tanlagichga min/max uchun data_span oladi');
    const plain = await get('/api/dashboard');
    assert.equal(plain.auto_range, undefined, 'auto’siz — joriy oy rejimi (avvalgidek)');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
