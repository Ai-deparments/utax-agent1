/**
 * Ko'p kompaniyali bank qatlami: .xls o'quvchi → ASBT / Open Bank ko'chirmasi → reyestr bo'yicha import →
 * kompaniya/hisob/global kesimlari, ichki o'tkazmalar, kassa, idempotentlik, rad etish holatlari, ERP holati.
 * Test ma'lumoti to'qima (faqat shu test uchun): kompaniyalar AAA/BBB, INN 111111111/222222222.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildXls } from './helpers/xls-writer.mjs';
import { buildXlsx } from '../src/core/export.mjs';
import { readXls, isXls } from '../src/import/xls-reader.mjs';
import { parseBankStatement, bankAmount } from '../src/import/bank-statement.mjs';

process.env.BOT_MODE = 'off';

const A1 = '20208000100000000001'; // AAA · Alfa bank (ASBT)
const A2 = '20208000100000000002'; // AAA · Beta bank (Open Bank)
const B1 = '20208000200000000001'; // BBB · Alfa bank (ASBT)
const SALARY = '23106000100000000001'; // AAA oylik kartasi — reyestrda yo'q, ichki EMAS

/** ASBT: 1 operatsiya = 3 qator. ops: [date, doc, op, corrAcc, corrInn, debit, credit, name, purpose] */
function asbt({ account, inn, client = '00000001', company, opening, ops, closing, turnover }) {
  const s = (n) => (n ? n.toLocaleString('en-US', { minimumFractionDigits: 2 }) : 0);
  const dr = ops.reduce((a, o) => a + (o[5] || 0), 0), cr = ops.reduce((a, o) => a + (o[6] || 0), 0);
  return buildXls([
    ['04 августа 2026 г. 16:36', null, null, 'Cправка о работе счета'],
    [`Лицевой счет No ${account}`],
    [`Клиент: ${client} ИНН: ${inn}`],
    [company],
    ['Период с 01.07.2026 по 31.07.2026'],
    ['Входящий остаток на 01.07.2026', null, null, null, s(opening)],
    ['Дата проводки', 'N документа', 'Оп', 'Корреспондент: Банк/Счет/ИНН Наименование Назначение платежа', 'Дебет', 'Кредит'],
    ...ops.flatMap(([d, doc, op, acc, cinn, debit, credit, name, purpose]) => [
      [d, doc, op, `МФО:00001 Счет:${acc} ИНН:${cinn || ''}`, s(debit), s(credit)],
      ['10:00:00', null, null, name],
      [null, null, null, purpose],
    ]),
    ['Сумма оборотов', null, null, null, s(turnover?.debit ?? dr), s(turnover?.credit ?? cr)],
    ['Количество оборотов', null, null, null, ops.filter((o) => o[5]).length, ops.filter((o) => o[6]).length],
    [`Исходящий остаток за 31.07.2026`, null, null, null, s(closing)],
    ['00001 ТЕСТ Ш., "ALFA TEST BANK" ФИЛИАЛИ'],
  ]);
}
/** Open Bank (FlexCube): 1 operatsiya = 1 qator. ops: [dateTime, doc, corrAcc, name, debit, credit, purpose] */
function flex({ account, inn, opening, closing, ops, asXlsx = false }) {
  const dr = ops.reduce((a, o) => a + o[4], 0), cr = ops.reduce((a, o) => a + o[5], 0);
  const rows = [
    [null, null, null, null, null, null, null, null, '"Beta Test Bank" AJ, FlexCube'],
    ['Hisob-varaq aylanmasi bo‘yicha hisobot'],
    ['Bank:', null, '"Beta Test Bank" AJ  (00002)'],
    ['Mijoz:', null, `AAA TEST MCHJ (${inn})`],
    ['Hisobvaraq:', null, account],
    ['Davr:', null, '01.07.2026 - 31.07.2026'],
    ['Hisobot davri boshiga qoldiq:', null, opening, null, 'Hisobot davri oxiriga qoldiq:', null, closing],
    ['Sana', 'Hujjat raqami', 'Hisobvaraq', 'Hisobvaraq nomi', 'Bank kodi', 'Bank nomi', 'Debet', 'Kredit', 'Toʻlov mazmuni'],
    ...ops.map(([d, doc, acc, name, debit, credit, purpose]) => [d, doc, acc, name, '00001', 'TEST BANK', debit, credit, purpose]),
    ['Jami hisobot davrida aylanma:', null, null, null, null, null, dr, cr],
  ];
  return asXlsx ? buildXlsx({ sheetName: 'Account Turnover', header: rows[0], rows: rows.slice(1) }) : buildXls(rows, { sheetName: 'Account Turnover' });
}

const fileA1 = asbt({ account: A1, inn: '111111111', company: 'ООО "AAA TEST"', opening: 1000.5, closing: 1000.5 + 500 + 300 - 200 - 100.25 - 50,
  ops: [
    ['02.07.2026', '1', '21', '20208000900000000009', '999999999', 0, 500, 'MIJOZ TEST', '00111 Oplata'],
    ['14.07.2026', '2', '21', A2, '111111111', 0, 300, 'AAA TEST', '00642 Perevod'],
    ['15.07.2026', '3', '21', SALARY, '111111111', 200, 0, 'AAA TEST', '00633 Oylik'],
    ['16.07.2026', '4', '21', B1, '222222222', 100.25, 0, 'BBB TEST', '00111 Xizmat'],
    ['17.07.2026', 'OK1', '06', '45249000000000000001', '', 50, 0, 'Komissiya', '00667 Komissiya'],
  ] });
const fileA2 = flex({ account: A2, inn: '111111111', opening: 700, closing: 700 + 40 - 300,
  ops: [
    ['01.07.2026 16:48', '0000000074', '20208000900000000008', 'MIJOZ 2', 0, 40, '00111 avans'],
    ['14.07.2026 13:09', '0000000026', A1, 'AAA TEST', 300, 0, '00642-00642-Perevod'],
  ] });
const fileB1 = asbt({ account: B1, inn: '222222222', client: '00000002', company: 'ООО "BBB TEST"', opening: 10, closing: 10 + 100.25,
  ops: [['16.07.2026', '9', '21', A1, '111111111', 0, 100.25, 'AAA TEST', '00111 Xizmat']] });

test('xls o‘quvchi: CFB + BIFF8 (SST CONTINUE, NUMBER), kirill matn', () => {
  const long = 'Ж'.repeat(9000);
  const buf = buildXls([['Салом', null, 1.5], [null, long], [42]], { sheetName: 'asbt' });
  assert.ok(isXls(buf));
  const x = readXls(buf);
  assert.equal(x.sheet, 'asbt');
  assert.deepEqual(x.rows.map((r) => r.r), [1, 2, 3]);
  assert.equal(x.rows[0].cells[0].v, 'Салом');
  assert.equal(x.rows[0].cells[2].v, 1.5);
  assert.equal(x.rows[1].cells[1].v, long);
  assert.equal(x.rows[2].cells[0].v, 42);
  assert.throws(() => readXls(Buffer.from('not an xls file at all, just text......')), /XLS emas/);
});

test('bankAmount: bank formatidagi summalar', () => {
  assert.equal(bankAmount('37,521,972.67'), 37521972.67);
  assert.equal(bankAmount('1 234,56'), 1234.56);
  assert.equal(bankAmount(344856000), 344856000);
  assert.equal(bankAmount(''), 0);
  assert.ok(Number.isNaN(bankAmount('abc')));
});

test('ASBT: 3 qatorli operatsiya, rekvizitlar, nazorat', () => {
  const p = parseBankStatement(fileA1, { fileName: 'a1.xls' });
  assert.equal(p.format, 'ASBT');
  assert.equal(p.account, A1);
  assert.equal(p.inn, '111111111');
  assert.equal(p.opening, 1000.5);
  assert.equal(p.lines.length, 5);
  const l = p.lines[0];
  assert.deepEqual([l.tx_date, l.tx_time, l.doc_no, l.op_code, l.corr_account, l.corr_inn, l.corr_mfo, l.corr_name, l.purpose, l.direction, l.amount],
    ['2026-07-02', '10:00:00', '1', '21', '20208000900000000009', '999999999', '00001', 'MIJOZ TEST', '00111 Oplata', 'IN', 500]);
  assert.equal(p.lines[4].corr_inn, null, 'bo‘sh INN — null (taxmin qilinmaydi)');
  assert.equal(p.ok, true, JSON.stringify(p.checks.filter((c) => !c.ok)));
});

test('Open Bank: sarlavha bloki, "Jami" qatori tranzaksiya emas; .xlsx ham o‘qiladi', () => {
  for (const buf of [fileA2, flex({ account: A2, inn: '111111111', opening: 700, closing: 440, asXlsx: true, ops: [['01.07.2026 16:48', '74', '20208000900000000008', 'MIJOZ 2', 0, 40, '00111 avans'], ['14.07.2026 13:09', '26', A1, 'AAA TEST', 300, 0, '00642-00642-Perevod']] })]) {
    const p = parseBankStatement(buf);
    assert.equal(p.format, 'FLEXCUBE');
    assert.equal(p.account, A2);
    assert.equal(p.inn, '111111111');
    assert.equal(p.mfo, '00002');
    assert.equal(p.lines.length, 2);
    assert.equal(p.lines[1].op_code, '00642');
    assert.equal(p.lines[1].direction, 'OUT');
    assert.equal(p.ok, true, JSON.stringify(p.checks.filter((c) => !c.ok)));
  }
});

test('nazorat: yakuniy qoldiq mos kelmasa — ok=false, farq ko‘rsatiladi', () => {
  const bad = asbt({ account: A1, inn: '111111111', company: 'X', opening: 100, closing: 999, ops: [['02.07.2026', '1', '21', '20208000900000000009', '', 0, 50, 'X', 'p']] });
  const p = parseBankStatement(bad);
  assert.equal(p.ok, false);
  assert.ok(p.checks.some((c) => !c.ok && /yakuniy/.test(c.name) && /farq/.test(c.detail)));
  const badTurn = asbt({ account: A1, inn: '111111111', company: 'X', opening: 100, closing: 150, turnover: { debit: 0, credit: 60 }, ops: [['02.07.2026', '1', '21', '20208000900000000009', '', 0, 50, 'X', 'p']] });
  assert.equal(parseBankStatement(badTurn).ok, false);
  assert.throws(() => parseBankStatement(buildXls([['boshqa fayl']])), /formati tanilmadi/);
});

async function withApp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utax-bl-'));
  const { createApp } = await import('../src/server.mjs');
  const app = createApp({ dbPath: path.join(dir, 't.db') });
  try { await fn(app); } finally { app.db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}
const ctx = { user: null, ip: null, source: 'TEST' };
function seedRegistry(L) {
  L.upsertCompany({ code: 'AAA', name: 'ООО "AAA TEST"', inn: '111111111' }, ctx);
  L.upsertCompany({ code: 'BBB', name: 'ООО "BBB TEST"', inn: '222222222' }, ctx);
  L.upsertAccount({ company_code: 'AAA', account_number: A1, kind: 'BANK', label: 'Alfa bank' }, ctx);
  L.upsertAccount({ company_code: 'AAA', account_number: A2, kind: 'BANK', label: 'Beta bank' }, ctx);
  L.upsertAccount({ company_code: 'AAA', account_number: 'KASSA-AAA', kind: 'CASH', label: 'Kassa (naqd)' }, ctx);
  L.upsertAccount({ company_code: 'BBB', account_number: B1, kind: 'BANK', label: 'Alfa bank' }, ctx);
}

test('summary: ma’lumot yo‘q bazada ham javob to‘liq shaklda (sources: [], raqamlar null) — PR #16 dagi xato qaytmasin', () => withApp((app) => {
  const L = app.services.bankLedger;
  const shape = ['month', 'months', 'level', 'registry', 'has_data', 'missing', 'opening', 'inflow', 'outflow', 'closing', 'inflow_gross', 'outflow_gross', 'internal_in', 'internal_out', 'internal_excluded', 'check_ok', 'sources', 'accounts'];
  // 1) reyestr ham bo'sh; 2) reyestr bor, lekin ko'chirma yuklanmagan
  for (const step of [() => {}, () => seedRegistry(L)]) {
    step();
    const s = L.summary({});
    for (const k of shape) assert.ok(k in s, `javobda "${k}" bo‘lishi kerak`);
    assert.deepEqual(s.sources, []);
    assert.deepEqual(s.accounts, []);
    assert.equal(s.has_data, false);
    assert.equal(s.opening, null, 'qoldiq noma’lum — 0 emas');
    assert.equal(s.month, null);
  }
  assert.deepEqual(L.summary({ company: 'AAA' }).missing.sort(), ['Alfa bank', 'Beta bank', 'Kassa (naqd)']);
}));

test('import: reyestrda yo‘q hisob / INN mos emas — rad etiladi, bazaga hech narsa yozilmaydi', () => withApp((app) => {
  const L = app.services.bankLedger;
  assert.throws(() => L.importStatement(fileA1, {}, ctx), /reyestrda yo‘q/);
  L.upsertCompany({ code: 'AAA', name: 'AAA', inn: '333333333' }, ctx);
  L.upsertAccount({ company_code: 'AAA', account_number: A1, kind: 'BANK', label: 'Alfa bank' }, ctx);
  assert.throws(() => L.importStatement(fileA1, {}, ctx), /INN 111111111/);
  const pv = L.importStatement(fileA1, { preview: true }, ctx);
  assert.equal(pv.ok, false);
  assert.equal(app.db.get('SELECT COUNT(*) n FROM bank_statement_lines').n, 0);
}));

test('kesimlar: hisob / kompaniya / global; ichki o‘tkazma faqat doira ichida chiqariladi; kassa qo‘shiladi; qayta import takrorlamaydi', () => withApp((app) => {
  const L = app.services.bankLedger;
  seedRegistry(L);
  for (const [f, n] of [[fileA1, 'a1.xls'], [fileA2, 'a2.xls'], [fileB1, 'b1.xls']]) assert.equal(L.importStatement(f, { fileName: n }, ctx).imported, true);
  assert.throws(() => L.setCashPeriod({ account_number: 'KASSA-AAA', period: '2026-07', opening: 100, inflow: 50, outflow: 30, closing: 999 }, ctx), /Nazorat/);
  L.setCashPeriod({ account_number: 'KASSA-AAA', period: '2026-07', opening: 100, inflow: 50, outflow: 30, closing: 120 }, ctx);

  const internal = app.db.all('SELECT corr_account, is_internal FROM bank_statement_lines WHERE is_internal=1').map((x) => x.corr_account).sort();
  assert.deepEqual(internal, [A1, A1, A2, B1], 'oylik kartasi (2310…) ichki emas');

  // Hisob darajasi: ichki o'tkazma saqlanadi (bank vypiskasiga mos)
  const acc = L.summary({ company: 'aaa', account: A1, month: '2026-07' });
  assert.equal(acc.level, 'account');
  assert.deepEqual([acc.opening, acc.inflow, acc.outflow, acc.closing], [1000.5, 800, 350.25, 1450.25]);
  assert.equal(acc.internal_in, 300);
  assert.equal(acc.check_ok, true);

  // Kompaniya: A1↔A2 o'tkazmasi (300) chiqariladi; AAA→BBB (100.25) — boshqa kompaniyaga, qoladi; kassa qo'shiladi
  const aaa = L.summary({ company: 'AAA', month: '2026-07' });
  assert.equal(aaa.opening, 1000.5 + 700 + 100);
  assert.equal(aaa.inflow_gross, 800 + 40 + 50);
  assert.equal(aaa.inflow, 800 + 40 + 50 - 300);
  assert.equal(aaa.outflow, 350.25 + 300 + 30 - 300);
  assert.equal(aaa.closing, 1450.25 + 440 + 120);
  assert.equal(aaa.check_ok, true);
  assert.deepEqual(aaa.sources, ['BANK_FILE', 'MANUAL']);

  // Global: AAA↔BBB o'tkazmasi ham ichki
  const g = L.summary({ month: '2026-07' });
  assert.equal(g.level, 'global');
  assert.equal(g.internal_in, 300 + 100.25);
  assert.equal(g.inflow, g.inflow_gross - 400.25);
  assert.equal(g.closing, aaa.closing + 110.25);
  assert.equal(Math.round((g.opening + g.inflow - g.outflow) * 100), Math.round(g.closing * 100), 'net: boshlang‘ich + tushum − xarajat = balans');

  // "Barcha bank hisoblari": barcha kompaniyalar banklari, kassasiz, yalpi (ichki o'tkazmalar chiqarilmaydi) — qaysi kompaniya tanlangan bo'lmasin
  for (const company of ['AAA', 'global']) {
    const banks = L.summary({ company, account: 'banks', month: '2026-07' });
    assert.equal(banks.level, 'banks');
    assert.deepEqual(banks.accounts.map((a) => a.account_number).sort(), [A1, A2, B1].sort());
    assert.equal(banks.opening, 1000.5 + 700 + 10);
    assert.equal(banks.inflow, 800 + 40 + 100.25);
    assert.equal(banks.outflow, 350.25 + 300);
    assert.equal(banks.internal_excluded, false);
    assert.equal(banks.internal_in, 300 + 100.25);
    assert.equal(banks.closing, 1450.25 + 440 + 110.25);
  }

  // Drill-down kartadagi raqam bilan bir xil
  const lines = L.lines({ company: 'AAA', month: '2026-07', direction: 'IN', net: 1 });
  assert.equal(lines.rows.reduce((s, x) => s + x.amount, 0), 800 + 40 - 300);
  assert.equal(L.lines({ company: 'AAA', account: A1, month: '2026-07', direction: 'IN' }).rows.length, 2);

  // Manba fayllari: bank ko'chirmasi asl nusxasi va kassa uchun berilgan fayl saqlanadi
  const a1 = acc.accounts[0].statement.source_file;
  assert.equal(a1.file_name, 'a1.xls');
  const stored = app.db.get('SELECT content_b64 FROM source_files WHERE entity=? AND entity_id=?', a1.entity, a1.entity_id);
  assert.equal(stored.content_b64, fileA1.toString('base64'), 'yuklab olinadigan fayl — aynan import qilingan fayl');
  L.setCashPeriod({ account_number: 'KASSA-AAA', period: '2026-07', opening: 100, inflow: 50, outflow: 30, source_file: { file_name: 'kassa.xlsx', file_base64: Buffer.from('xlsx').toString('base64') } }, ctx);
  assert.equal(L.summary({ company: 'AAA', month: '2026-07' }).accounts.find((x) => x.kind === 'CASH').source_file.file_name, 'kassa.xlsx');

  // Qayta import — ikkilanmaydi
  const again = L.importStatement(fileA1, { fileName: 'a1.xls' }, ctx);
  assert.equal(again.new_ops, 0);
  assert.equal(again.duplicates, 5);
  assert.equal(app.db.get('SELECT COUNT(*) n FROM bank_statement_lines').n, 5 + 2 + 1);
  assert.deepEqual(L.months(), ['2026-07']);
  assert.throws(() => L.summary({ company: 'zzz' }), /topilmadi/);
}));

test('ERP holati: token muddati; eskirgan token qabul qilinmaydi; .env eski tokeni UI dagini almashtirmaydi', () => withApp(async (app) => {
  const { jwtExpiry } = await import('../src/modules/bank-ledger.mjs');
  const { ensureErpIntegration } = await import('../src/server.mjs');
  const { encryptSecret } = await import('../src/core/auth.mjs');
  const { config } = await import('../src/core/config.mjs');
  const jwt = (exp) => `x.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.y`;
  const past = Math.floor(Date.now() / 1000) - 3600, future = Math.floor(Date.now() / 1000) + 30 * 86400;
  assert.equal(jwtExpiry('bad'), null);
  const L = app.services.bankLedger;
  assert.equal(L.erpStatus().connected, false);
  app.db.insert('integrations', { type: 'UTAXERP', name: 'ERP', config: '{}', secret_config: encryptSecret(JSON.stringify({ api_key: jwt(past) })), is_active: 1, last_sync_at: '2026-09-24T18:08:27.624Z', created_at: new Date().toISOString() });
  const s = L.erpStatus();
  assert.equal(s.token_expired, true);
  assert.equal(s.stale, true);
  assert.ok(!JSON.stringify(s).includes(jwt(past)), 'token javobda qaytmaydi');
  assert.throws(() => L.setErpToken(jwt(past), ctx), /muddati allaqachon/);
  assert.throws(() => L.setErpToken('abc', ctx), /JWT/);
  assert.equal(L.setErpToken(jwt(future), ctx).ok, true);
  assert.equal(L.erpStatus().stale, false);
  const saved = { ...config.erp };
  try {
    Object.assign(config.erp, { token: jwt(past), autoRegister: true });
    ensureErpIntegration(app);
    assert.equal(L.erpStatus().token_expired, false, '.env dagi eskirgan token yangisini bosib ketmadi');
  } finally { Object.assign(config.erp, saved); }
}));

test('web: /api/bank-ledger — preview, import, summary (company=), rad etish 400', async () => {
  const { createBotHarness } = await import('./helpers/bot-harness.mjs');
  const { createServer } = await import('../src/server.mjs');
  const H = await createBotHarness();
  seedRegistry(H.app.services.bankLedger);
  const server = createServer(H.app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const lr = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'cfo@utax.uz', password: 'Utax2026!' }) });
    const token = (await lr.json()).access_token;
    const call = async (method, p, body) => { const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
    const payload = { file_base64: fileA2.toString('base64'), file_name: 'a2.xls' };
    const pv = await call('POST', '/api/bank-ledger/import', { ...payload, preview: true });
    assert.equal(pv.status, 200, JSON.stringify(pv.body));
    assert.equal(pv.body.ok, true);
    assert.equal(pv.body.new_ops, 2);
    const im = await call('POST', '/api/bank-ledger/import', payload);
    assert.equal(im.body.imported, true);
    const bad = await call('POST', '/api/bank-ledger/import', { file_base64: asbt({ account: '20208000999999999999', inn: '1', company: 'X', opening: 0, closing: 0, ops: [] }).toString('base64') });
    assert.equal(bad.status, 400);
    const sm = await call('GET', '/api/bank-ledger/summary?company=aaa&month=2026-07');
    assert.equal(sm.status, 200);
    assert.equal(sm.body.level, 'company');
    assert.equal(sm.body.accounts.find((a) => a.account_number === A2).closing, 440);
    assert.ok(sm.body.missing.includes('Alfa bank'), 'yuklanmagan hisob "ma’lumot yo‘q" — qoldiq taxmin qilinmaydi');
    assert.equal(sm.body.opening, null);
    const src = sm.body.accounts.find((a) => a.account_number === A2).statement.source_file;
    const dl = await fetch(`${base}/api/bank-ledger/source-files/${src.entity}/${src.entity_id}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(dl.status, 200);
    assert.match(dl.headers.get('content-disposition'), /a2\.xls/);
    assert.deepEqual(Buffer.from(await dl.arrayBuffer()), fileA2, 'yuklab olingan fayl asl fayl bilan bayt-bayt bir xil');
    assert.equal((await fetch(`${base}/api/bank-ledger/source-files/bank_statement/9999`, { headers: { authorization: `Bearer ${token}` } })).status, 404);
    const er = await call('GET', '/api/bank-ledger/erp-status');
    assert.equal(er.status, 200);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
