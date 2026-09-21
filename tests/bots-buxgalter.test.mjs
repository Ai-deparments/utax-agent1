/** @utax_buxgalter_bot — vipiska, bog'lash, kassa, to'lov, akt, shartnoma, oylik, byudjet, integratsiyalar, sifat, eslatma. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createBotHarness } from './helpers/bot-harness.mjs';
import { buildXlsx } from '../src/core/export.mjs';
import { config, ROOT } from '../src/core/config.mjs';
import { today, monthOf, monthRange } from '../src/core/util.mjs';
import { money } from '../src/bots/shared/format.mjs';
import { vipiskaEslatma } from '../src/bots/buxgalter/handlers/eslatma.mjs';

let H, S, db, acc, cfo, fm, sales;
const saqlanganFayllar = [];
const cb = (r, re) => r.buttons.find((b) => re.test(b.callback_data || ''));
const ctxOf = (email) => ({ user: H.user(email), ip: 'test', source: 'TEST' });
const kassaQoldiq = () => S.banking.cashBalance().accounts.find((a) => a.id === 1).balance;
/** Kutilgan natija qattiq yozilmaydi — web bilan bir xil RBAC matritsasidan (admin panelda o'zgaradi) */
const can = (email, resource, action) => H.app.rbac.can(H.user(email), resource, action);
/** Admin rol ruxsatini olib tashlagandek (permissions jadvali) — fn tugagach tiklanadi */
async function ruxsatsiz(role, resource, action, fn) {
  const bor = !!db.get('SELECT id FROM permissions WHERE role_code=? AND resource=? AND action=?', role, resource, action);
  db.run('DELETE FROM permissions WHERE role_code=? AND resource=? AND action=?', role, resource, action);
  H.app.rbac.reload();
  try { return await fn(); } finally {
    if (bor) db.run('INSERT OR IGNORE INTO permissions (role_code, resource, action) VALUES (?,?,?)', role, resource, action);
    H.app.rbac.reload();
  }
}

before(async () => {
  H = await createBotHarness();
  S = H.S; db = H.db;
  acc = H.link('accountant@utax.uz');
  cfo = H.link('cfo@utax.uz');
  fm = H.link('finance@utax.uz');
  sales = H.link('sales@utax.uz');
});
after(() => { for (const f of saqlanganFayllar) fs.rmSync(f, { force: true }); });

test('auditoriya: SALES kira olmaydi; menyu rolga qarab (tugmalar matritsa ruxsatiga mos)', async () => {
  let r = await H.send('buxgalter', sales, '/start');
  assert.match(r.text, /mo‘ljallanmagan/);
  for (const [email, tg] of [['accountant@utax.uz', acc], ['cfo@utax.uz', cfo], ['finance@utax.uz', fm]]) {
    r = await H.send('buxgalter', tg, '/start');
    const tugma = r.buttons.map((b) => b.text).join('|');
    assert.match(tugma, /Vipiska/);
    assert.equal(/Bog‘lash/.test(tugma), can(email, 'reconciliation', 'VIEW'), `${email}: Bog‘lash ↔ reconciliation VIEW`);
    assert.equal(/Kassa/.test(tugma), can(email, 'treasury', 'CREATE'), `${email}: Kassa ↔ treasury CREATE`);
    assert.equal(/Akt/.test(tugma), can(email, 'contracts', 'EDIT'), `${email}: Akt ↔ contracts EDIT`);
    assert.equal(/To‘lov/.test(tugma), can(email, 'expenses', 'EDIT'), `${email}: To‘lov ↔ expenses EDIT`);
  }
  const st = S.reconciliation.stats();
  r = await H.send('buxgalter', acc, '/start');
  assert.match(r.text, new RegExp(`Bog‘lanmagan tranzaksiyalar: <b>${(st.unmatched || 0) + (st.suggested || 0)} ta</b>`));
  // admin ruxsatni olib tashlasa — tugma yo'qoladi (bot = web matritsa)
  await ruxsatsiz('ACCOUNTANT', 'treasury', 'CREATE', async () => {
    r = await H.send('buxgalter', acc, '/start');
    assert.doesNotMatch(r.buttons.map((b) => b.text).join('|'), /Kassa/);
  });
});

test('ruxsat: /kassa va /akt — web matritsasi bilan bir xil; ruxsat olib tashlansa ⛔ (treasury CREATE, contracts EDIT)', async () => {
  let r;
  await ruxsatsiz('ACCOUNTANT', 'treasury', 'CREATE', async () => {
    r = await H.send('buxgalter', acc, '/kassa');
    assert.match(r.text, /⛔ Ruxsat yo‘q: «Pul boshqaruvi» — yaratish/);
  });
  await ruxsatsiz('ACCOUNTANT', 'contracts', 'EDIT', async () => {
    r = await H.send('buxgalter', acc, '/akt');
    assert.match(r.text, /⛔ Ruxsat yo‘q: «Shartnomalar» — tahrirlash/);
  });
  // standart matritsa bo'yicha: ruxsat bo'lsa buyruq ochiladi, bo'lmasa ⛔
  r = await H.send('buxgalter', acc, '/kassa');
  if (can('accountant@utax.uz', 'treasury', 'CREATE')) assert.match(r.text, /Kassa:/); else assert.match(r.text, /⛔ Ruxsat yo‘q/);
  await H.send('buxgalter', acc, '/bekor');
  r = await H.send('buxgalter', acc, '/akt');
  if (can('accountant@utax.uz', 'contracts', 'EDIT')) assert.doesNotMatch(r.text, /⛔/); else assert.match(r.text, /⛔ Ruxsat yo‘q: «Shartnomalar» — tahrirlash/);
  await H.send('buxgalter', acc, '/bekor');
});

test('vipiska: CSV → ko‘rib chiqish → import (shartnoma raqami bo‘yicha auto-match); takroriy fayl o‘tkazib yuboriladi', async () => {
  let r = await H.send('buxgalter', acc, '/vipiska');
  assert.ok(cb(r, /^b\.vp:acc:1$/) && cb(r, /^b\.vp:acc:2$/), 'ikki bank hisobi tanlovi');
  r = await H.click('buxgalter', acc, 'b.vp:acc:1', { messageId: r.last.message_id });
  assert.match(r.text, /CSV.*XLSX/);
  const csv = [
    'sana;summa;kontragent;inn;maqsad',
    '20.09.2026;10000000;TOSHKENT QURILISH INVEST MCHJ;301234567;Oplata po dogovoru UTAX-R-00008',
    '20.09.2026;-2500000;UZBEKTELECOM;;Internet sentabr',
    '20.09.2026;4000000;YANGI MIJOZ MCHJ;399999999;Avans to‘lovi',
  ].join('\n');
  const oldinPaid = S.contracts.get(23).paid;
  r = await H.upload('buxgalter', acc, { name: 'kapitalbank_20.09.csv', content: csv });
  assert.match(r.text, /Qatorlar: <b>3 ta<\/b>/);
  assert.match(r.text, new RegExp(`Kirim: <b>2 ta · ${money(14e6)}</b>`));
  assert.match(r.text, new RegExp(`Chiqim: <b>1 ta · ${money(2.5e6)}</b>`));
  r = await H.click('buxgalter', acc, 'b.vp:ok', { messageId: r.last.message_id });
  assert.match(r.text, /Import yakunlandi/);
  assert.match(r.text, /Yangi: <b>3<\/b>/);
  assert.match(r.text, /Avtomatik bog‘landi: <b>1<\/b>/);
  assert.equal(S.contracts.get(23).paid, oldinPaid + 10e6, 'UTAX-R-00008 ga to‘lov yozildi');
  assert.equal(db.get("SELECT COUNT(*) n FROM bank_transactions WHERE source='TELEGRAM'").n, 3);
  // web Excel yuklash bilan bir xil: Integratsiyalar sahifasidagi EXCEL holati va jurnali
  const excel = db.get("SELECT * FROM integrations WHERE type='EXCEL' ORDER BY is_active DESC, id LIMIT 1");
  assert.match(excel.last_status, /^Yuklandi: 3 yangi, 0 takroriy/);
  const log = db.get('SELECT * FROM integration_sync_logs WHERE integration_id=? ORDER BY id DESC LIMIT 1', excel.id);
  assert.equal(log.rows_new, 3);
  assert.match(log.message, /"source":"TELEGRAM"/);
  assert.ok(cb(r, /^cmd:boglash$/), 'bog‘lash tugmasi');
  // shu faylni qayta yuborish → hammasi takroriy
  await H.send('buxgalter', acc, '/vipiska');
  await H.click('buxgalter', acc, 'b.vp:acc:1');
  await H.upload('buxgalter', acc, { name: 'kapitalbank_20.09.csv', content: csv });
  r = await H.click('buxgalter', acc, 'b.vp:ok');
  assert.match(r.text, /Takroriy \(o‘tkazib yuborildi\): <b>3<\/b>/);
  assert.equal(db.get("SELECT COUNT(*) n FROM bank_transactions WHERE source='TELEGRAM'").n, 3);
});

test('vipiska: XLSX (debet/kredit ustunlari) ham o‘qiladi', async () => {
  const xlsx = buildXlsx({ sheetName: 'Vipiska', header: ['Sana', 'Debet', 'Kredit', 'Kontragent', 'INN', 'Maqsad'], rows: [['21.09.2026', 0, 3000000, 'NUR FARM MCHJ', '302345678', 'To‘lov UTAX-S-00002 bo‘yicha']] });
  await H.send('buxgalter', cfo, '/vipiska');
  await H.click('buxgalter', cfo, 'b.vp:acc:2');
  let r = await H.upload('buxgalter', cfo, { name: 'ipoteka.xlsx', content: xlsx, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  assert.match(r.text, /Qatorlar: <b>1 ta<\/b>/);
  const oldin = S.contracts.get(8).paid;
  r = await H.click('buxgalter', cfo, 'b.vp:ok');
  assert.match(r.text, /Avtomatik bog‘landi: <b>1<\/b>/);
  assert.equal(S.contracts.get(8).paid, oldin + 3e6);
});

test('vipiska: noto‘g‘ri fayl, rasm va ustunsiz CSV — tushunarli xato; /bekor', async () => {
  await H.send('buxgalter', acc, '/vipiska');
  await H.click('buxgalter', acc, 'b.vp:acc:1');
  let r = await H.upload('buxgalter', acc, { name: 'rasm.png', content: 'PNGDATA', mime: 'image/png' });
  assert.match(r.text, /qo‘llab-quvvatlanmaydi/);
  r = await H.photo('buxgalter', acc, { content: 'JPEG' });
  assert.match(r.text, /Rasm emas/);
  r = await H.upload('buxgalter', acc, { name: 'bosh.csv', content: 'a,b,c\n1,2,3' });
  assert.match(r.text, /Ustunlar topilmadi/);
  assert.match(r.text, /Fayldagi sarlavha: <i>a \| b \| c<\/i>/);
  assert.match(r.text, /debet/);
  r = await H.send('buxgalter', acc, '/bekor');
  assert.match(r.text, /Bekor qilindi/);
});

test('boglash: SUGGESTED (INN + summa) → ✅ nomzod → shartnoma to‘landi, keyingi karta chiqadi', async () => {
  const tx = S.banking.createTransaction({ bank_account_id: 1, tx_date: '2026-09-21', amount: 47.5e6, direction: 'INCOME', counterparty_name: 'Buxoro Teks', counterparty_inn: '303456789', purpose: 'Xizmat uchun to‘lov' }, ctxOf('accountant@utax.uz'), { skipMatch: true });
  assert.equal(S.reconciliation.autoMatch(tx.id, ctxOf('accountant@utax.uz')).status, 'SUGGESTED');
  let r = await H.send('buxgalter', fm, '/boglash');
  assert.match(r.text, /Bog‘lash<\/b> · 1\//);
  assert.match(r.text, /UTAX-R-00003/);
  const btn = cb(r, new RegExp(`^b\\.rc:m:${tx.id}:9:`));
  assert.ok(btn, 'Buxoro Teks shartnomasi nomzodi');
  r = await H.click('buxgalter', fm, btn.callback_data, { messageId: r.last.message_id });
  assert.match(r.text, /Bog‘landi/);
  assert.equal(S.contracts.get(9).remaining, 0);
  assert.equal(db.get('SELECT matching_status FROM bank_transactions WHERE id=?', tx.id).matching_status, 'MATCHED');
  assert.ok(r.messages.some((m) => /Bog‘lash<\/b> · 1\//.test(m.text)), 'keyingi tranzaksiya kartasi');
  // eskirgan tugma qayta bosilsa — ikkinchi marta bog'lanmaydi
  r = await H.click('buxgalter', fm, btn.callback_data);
  assert.match(r.answers[0].text, /Allaqachon ko‘rib chiqilgan/);
  assert.equal(db.get('SELECT COUNT(*) n FROM payments WHERE bank_transaction_id=? AND reversed_at IS NULL', tx.id).n, 1);
});

test('boglash: 🚫 e’tiborsiz → sabab (LOAN → moliyaviy faoliyat)', async () => {
  const tx = S.banking.createTransaction({ bank_account_id: 1, tx_date: '2026-09-21', amount: 1234567, direction: 'INCOME', counterparty_name: 'TA’SISCHI', purpose: 'Qarz mablag‘i' }, ctxOf('accountant@utax.uz'), { skipMatch: true });
  S.reconciliation.autoMatch(tx.id, ctxOf('accountant@utax.uz'));
  let r = await H.click('buxgalter', acc, `b.rc:i:${tx.id}:0`);
  const sabablar = r.method('editMessageReplyMarkup')[0]?.reply_markup?.inline_keyboard.flat() || [];
  const loan = sabablar.find((b) => b.callback_data.startsWith(`b.rc:ig:${tx.id}:LOAN:`));
  assert.ok(loan, 'sabab tugmalari');
  r = await H.click('buxgalter', acc, loan.callback_data);
  assert.match(r.text, /E’tiborsiz qoldirildi/);
  const t = db.get('SELECT matching_status, ignore_reason, cf_class FROM bank_transactions WHERE id=?', tx.id);
  assert.deepEqual({ ...t }, { matching_status: 'IGNORED', ignore_reason: 'LOAN', cf_class: 'FINANCING' });
});

test('boglash: ACCOUNTANT da reconciliation APPROVE bor; ruxsat olib qo‘yilsa tugma yo‘qoladi va soxta callback rad etiladi', async () => {
  let r = await H.send('buxgalter', acc, '/boglash');
  assert.ok(cb(r, /^b\.rc:m:/), 'ACCOUNTANT ✅ nomzod tugmalarini ko‘radi (matritsa: reconciliation VCEA)');
  const soxta = cb(r, /^b\.rc:m:/).callback_data;
  db.run("DELETE FROM permissions WHERE role_code='ACCOUNTANT' AND resource='reconciliation' AND action='APPROVE'");
  H.app.rbac.reload();
  try {
    r = await H.send('buxgalter', acc, '/boglash');
    assert.equal(cb(r, /^b\.rc:m:/), undefined, 'APPROVE yo‘q — ✅ tugmalar ko‘rsatilmaydi');
    r = await H.click('buxgalter', acc, soxta);
    assert.match(r.answers.map((a) => a.text).join(' ') + r.text, /⛔/);
    assert.equal(db.get('SELECT matching_status FROM bank_transactions WHERE id=?', Number(soxta.split(':')[2])).matching_status !== 'MATCHED', true);
  } finally {
    db.run("INSERT OR IGNORE INTO permissions (role_code, resource, action) VALUES ('ACCOUNTANT','reconciliation','APPROVE')");
    H.app.rbac.reload();
  }
});

test('kassa: kirim → summa → maqsad → shartnoma → tasdiq → to‘lov shartnomaga yoziladi (CFO)', async () => {
  const oldinPaid = S.contracts.get(25).paid, oldinKassa = kassaQoldiq();
  let r = await H.send('buxgalter', cfo, '/kassa');
  assert.match(r.text, /Operatsiya turi/);
  r = await H.click('buxgalter', cfo, 'b.ks:d:INCOME', { messageId: r.last.message_id });
  assert.match(r.text, /Summani yozing/);
  r = await H.send('buxgalter', cfo, '5 mln');
  assert.match(r.text, /Maqsad/);
  r = await H.send('buxgalter', cfo, 'Naqd to‘lov ofisda');
  assert.match(r.text, /Qaysi shartnoma/);
  r = await H.send('buxgalter', cfo, 'UTAX-R-00009');
  assert.match(r.text, /tasdiqlang/);
  assert.match(r.text, /UTAX-R-00009/);
  assert.match(r.text, new RegExp(`Summa: <b>${money(5e6)}</b>`));
  r = await H.click('buxgalter', cfo, 'b.ks:ok', { messageId: r.last.message_id });
  assert.match(r.text, /kirim yozildi/);
  assert.equal(S.contracts.get(25).paid, oldinPaid + 5e6);
  assert.equal(kassaQoldiq(), oldinKassa + 5e6);
  assert.ok(db.get("SELECT id FROM payments WHERE contract_id=25 AND source='CASH' AND amount=5000000"));
  r = await H.click('buxgalter', cfo, 'b.ks:ok');
  assert.match(r.answers[0].text, /eskirgan/, 'ikkinchi bosish qayta yozmaydi');
});

test('kassa: chiqim, xarajatsiz → kassa qoldig‘i kamayadi', async () => {
  const oldin = kassaQoldiq();
  await H.send('buxgalter', cfo, '/kassa');
  await H.click('buxgalter', cfo, 'b.ks:d:EXPENSE');
  await H.send('buxgalter', cfo, '300 000');
  let r = await H.send('buxgalter', cfo, 'Kantselyariya tovarlari');
  assert.ok(cb(r, /^b\.ks:skip$/), 'xarajatsiz tugmasi');
  r = await H.click('buxgalter', cfo, 'b.ks:skip');
  assert.match(r.text, /bog‘lanmagan chiqim/);
  r = await H.click('buxgalter', cfo, 'b.ks:ok');
  assert.match(r.text, /chiqim yozildi/);
  assert.equal(kassaQoldiq(), oldin - 300000);
});

test('tolov: bank orqali (ACCOUNTANT — expenses EDIT; kassa tugmasi treasury CREATE ga qarab)', async () => {
  let r = await H.send('buxgalter', acc, '/tolov');
  assert.match(r.text, /EXP-000715/);
  assert.match(r.text, /EXP-000713/);
  assert.ok(cb(r, /^b\.pay:b:66$/));
  assert.equal(!!cb(r, /^b\.pay:c:/), can('accountant@utax.uz', 'treasury', 'CREATE'), 'kassadan to‘lash tugmasi ↔ treasury CREATE');
  await ruxsatsiz('ACCOUNTANT', 'treasury', 'CREATE', async () => {
    r = await H.send('buxgalter', acc, '/tolov');
    assert.equal(cb(r, /^b\.pay:c:/), undefined, 'treasury CREATE yo‘q — kassadan to‘lash tugmasi yo‘q');
  });
  r = await H.click('buxgalter', acc, 'b.pay:b:66');
  assert.match(r.text, /Bankdan to‘landi<\/b> deb belgilansinmi/);
  r = await H.click('buxgalter', acc, 'b.pay:yb:66');
  assert.match(r.text, /To‘landi \(bank\): EXP-000715/);
  assert.equal(S.expenses.get(66).status, 'PAID');
  r = await H.click('buxgalter', acc, 'b.pay:yb:66');
  assert.match(r.answers[0].text, /Holat: To‘langan/, 'ikkinchi marta to‘lanmaydi');
  await ruxsatsiz('ACCOUNTANT', 'treasury', 'CREATE', async () => {
    r = await H.click('buxgalter', acc, 'b.pay:yc:64');
    assert.match(r.answers.map((a) => a.text).join(' ') + r.text, /⛔/, 'soxta kassa callback — ruxsat yo‘q');
  });
  assert.equal(S.expenses.get(64).status, 'APPROVED');
});

test('tolov: kassadan (CFO) → kassa chiqimi yaratiladi, xarajat PAID', async () => {
  const oldin = kassaQoldiq();
  let r = await H.click('buxgalter', cfo, 'b.pay:c:64');
  assert.match(r.text, /naqd to‘landi deb yozilsinmi/);
  r = await H.click('buxgalter', cfo, 'b.pay:yc:64');
  assert.match(r.text, /To‘landi \(kassa\): EXP-000713/);
  const e = S.expenses.get(64);
  assert.equal(e.status, 'PAID');
  assert.ok(e.cash_transaction_id, 'kassa tranzaksiyasiga bog‘landi');
  assert.equal(kassaQoldiq(), oldin - 7e6);
  r = await H.send('buxgalter', cfo, '/tolov');
  assert.match(r.text, /To‘lanishi kerak bo‘lgan tasdiqlangan xarajat yo‘q/);
});

test('akt: kichik shartnoma — akt yuklanishi bilan daromad tan olinadi; katta — CFO tasdig‘iga tushadi', async () => {
  const st = db.get("SELECT id FROM service_types WHERE code='REVISION'").id;
  const c = S.contracts.create({ company_id: 1, service_type_id: st, amount: 20e6, contract_date: '2026-09-01', end_date: '2026-09-15', advance_pct: 0, payment_due_date: '2026-09-30' }, ctxOf('finance@utax.uz'));
  assert.equal(S.contracts.setServiceStatus(c.id, 'COMPLETED', ctxOf('finance@utax.uz')).recognition.status, 'BLOCKED');
  let r = await H.send('buxgalter', fm, `/akt ${c.contract_number}`);
  assert.match(r.text, /Akt faylini yuboring/);
  r = await H.upload('buxgalter', fm, { name: 'akt_qabul.pdf', content: '%PDF-1.4 test', mime: 'application/pdf' });
  assert.match(r.text, /Daromad tan olindi/);
  assert.equal(S.contracts.get(c.id).recognized, 20e6);
  const doc = db.get("SELECT * FROM contract_documents WHERE contract_id=? AND doc_type='ACT'", c.id);
  assert.ok(doc?.file_path, 'akt fayli saqlandi');
  const toliq = path.resolve(ROOT, doc.file_path);
  saqlanganFayllar.push(toliq);
  assert.ok(fs.existsSync(toliq));
  // 95 mln (chegara 50 mln) → tasdiq kutadi
  r = await H.send('buxgalter', fm, '/akt UTAX-R-00003');
  r = await H.upload('buxgalter', fm, { name: 'akt_buxoro.pdf', content: '%PDF-1.4', mime: 'application/pdf' });
  saqlanganFayllar.push(path.join(path.dirname(config.uploadsDir), db.get("SELECT file_path FROM contract_documents WHERE contract_id=9 AND doc_type='ACT' ORDER BY id DESC").file_path));
  assert.match(r.text, /tasdig‘ini kutmoqda/);
  assert.ok(S.revenue.listRecognitions({ status: 'PENDING_APPROVAL' }).some((x) => x.contract_id === 9));
});

test('shartnoma: karta, qidiruv ro‘yxati, dialog; CFO xizmatni yakunlaydi (akt yo‘q → BLOCKED)', async () => {
  let r = await H.send('buxgalter', acc, '/shartnoma UTAX-R-00008');
  const c23 = S.contracts.get(23);
  assert.match(r.text, /UTAX-R-00008<\/b> · Toshkent Qurilish Invest/);
  assert.match(r.text, new RegExp(`Qoldiq: <b>${money(c23.remaining)}</b>`));
  assert.equal(cb(r, /^b\.ct:dn:/), undefined, 'ACCOUNTANT xizmat holatini o‘zgartira olmaydi');
  r = await H.send('buxgalter', acc, '/shartnoma Toshkent');
  assert.ok(cb(r, /^b\.ct:v:23$/) && cb(r, /^b\.ct:v:7$/));
  r = await H.click('buxgalter', acc, 'b.ct:v:7');
  assert.match(r.text, /UTAX-A-00003/);
  r = await H.send('buxgalter', acc, '/shartnoma');
  assert.match(r.text, /mijoz nomi yoki INN/);
  r = await H.send('buxgalter', acc, 'Nur Farm');
  assert.match(r.text, /UTAX-S-00002/);
  r = await H.send('buxgalter', cfo, '/shartnoma UTAX-A-00003');
  assert.ok(cb(r, /^b\.ct:dn:7$/));
  r = await H.click('buxgalter', cfo, 'b.ct:dn:7');
  assert.match(r.text, /yakunlandi<\/b> deb belgilansinmi/);
  r = await H.click('buxgalter', cfo, 'b.ct:dy:7');
  assert.match(r.text, /Qabul akti yo‘q/);
  assert.equal(S.contracts.get(7).service_status, 'COMPLETED');
});

test('oylik: hisoblash → tasdiqqa yuborish → (tasdiqlangan) → to‘landi', async () => {
  let r = await H.send('buxgalter', acc, '/oylik 2026-09');
  assert.match(r.text, /hali hisoblanmagan/);
  r = await H.click('buxgalter', acc, 'b.pr:c:2026-09');
  assert.match(r.answers[0].text, /Hisoblandi: 16 xodim/);
  assert.equal(S.payroll.summary('2026-09').status, 'DRAFT');
  assert.ok(cb(r, /^b\.pr:s:2026-09$/));
  r = await H.click('buxgalter', acc, 'b.pr:s:2026-09');
  assert.match(r.text, /tasdiqqa yuborilsinmi/);
  r = await H.click('buxgalter', acc, 'b.pr:sy:2026-09');
  const s = S.payroll.summary('2026-09');
  assert.equal(s.status, 'SUBMITTED');
  assert.ok(s.approval, 'tasdiq zanjiri yaratildi');
  assert.match(r.text, /Tasdiqlash zanjiri/);
  db.run("UPDATE payrolls SET status='APPROVED' WHERE period='2026-09'");
  r = await H.send('buxgalter', acc, '/oylik');
  assert.match(r.text, /Sentabr 2026/, 'standart — oxirgi hisoblangan davr');
  r = await H.click('buxgalter', acc, 'b.pr:p:2026-09');
  r = await H.click('buxgalter', acc, 'b.pr:py:2026-09');
  assert.equal(S.payroll.summary('2026-09').status, 'PAID');
  r = await H.click('buxgalter', acc, 'b.pr:py:2026-09');
  assert.match(r.answers[0].text, /To‘lab bo‘lmaydi/);
});

test('byudjet: servis bilan bir xil fakt, oshganlar ⚠️', async () => {
  const r = await H.send('buxgalter', fm, '/byudjet 2026-09');
  const rows = S.budget.budgets('2026-09');
  const it = rows.find((x) => x.department_name === 'IT bo‘limi');
  assert.ok(it.exceeded);
  assert.match(r.text, /⚠️ <b>IT bo‘limi<\/b>/);
  assert.ok(r.text.includes(`${money(it.fact)} / ${money(it.amount)}`));
  assert.match(r.text, /Byudjetdan oshgan: <b>1<\/b> ta/);
  assert.ok(cb(r, /^b\.bj:2026-08$/));
});

test('integratsiyalar: sinxron tugmasi faqat web’dagi turlarda; xato matni ko‘rsatiladi', async () => {
  const asl = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('tarmoq yo‘q (test)'); };
  try {
    let r = await H.send('buxgalter', acc, '/integratsiyalar');
    assert.match(r.text, /Google Sheets — kassa jadvali/);
    assert.ok(cb(r, /^b\.int:3$/), 'GOOGLE_SHEETS — sinxronlash');
    assert.equal(cb(r, /^b\.int:1$/), undefined, 'EXCEL — qo‘lda');
    r = await H.click('buxgalter', acc, 'b.int:3');
    assert.match(r.text, /sinxronlash xatosi/);
    assert.match(r.text, /tarmoq yo‘q \(test\)/);
    assert.match(S.integrations.get(3).last_status, /^Xato: .*tarmoq yo‘q \(test\)/, 'web bilan bir xil status matni');
  } finally { globalThis.fetch = asl; }
});

test('sifat va xarajatlar: servis raqamlari bilan bir xil', async () => {
  let r = await H.send('buxgalter', acc, '/sifat');
  for (const i of S.reports.dataQuality().issues) assert.ok(r.text.includes(i.title), i.title);
  const { from, to } = monthRange('2026-09');
  r = await H.send('buxgalter', acc, '/xarajatlar 2026-09');
  assert.match(r.text, new RegExp(`Jami \\(tasdiqlangan \\+ to‘langan\\): <b>${money(S.expenses.total(from, to))}</b>`));
  r = await H.click('buxgalter', acc, 'b.xr:2026-08');
  assert.match(r.text, /Avgust 2026/);
  r = await H.send('buxgalter', acc, '/xarajatlar 13-oy');
  assert.match(r.text, /Oy formati/);
});

test('daromad: tan olingan (servis) + tasdiq kartasi (CFO tasdiqlay oladi, buxgalter — yo‘q)', async () => {
  const { from, to } = monthRange(monthOf(today()));
  let r = await H.send('buxgalter', cfo, '/daromad');
  assert.match(r.text, new RegExp(`Tan olingan daromad: <b>${money(S.revenue.recognizedInPeriod(from, to))}</b>`));
  assert.ok(cb(r, /^apr:ok:10$/), 'UTAX-R-00005 tan olish — CFO navbati');
  r = await H.send('buxgalter', acc, '/daromad');
  assert.match(r.text, /Daromad tan olish UTAX-R-00005/);
  assert.equal(cb(r, /^apr:ok:10$/), undefined);
});

test('tasdiqlash (FINANCE_MANAGER) va tushumlar filtri', async () => {
  let r = await H.send('buxgalter', fm, '/tasdiqlash');
  assert.ok(cb(r, /^apr:ok:15$/), 'moliya menejeri qadami');
  r = await H.send('buxgalter', acc, '/tushumlar');
  assert.match(r.text, /Oxirgi kirimlar/);
  r = await H.click('buxgalter', acc, 'b.tx:u');
  assert.match(r.text, /Bog‘lanmagan kirimlar/);
  assert.ok(cb(r, /^b\.tx:a$/));
});

test('erkin matn → AI moliya (transactions VIEW bor)', async () => {
  const r = await H.send('buxgalter', acc, 'Qaysi bank tranzaksiyalari shartnoma bilan bog‘lanmagan?');
  assert.match(r.text, /Bog‘lanmagan tranzaksiyalar: \d+ ta/);
  assert.ok(r.buttons.some((b) => /Web’da ochish/.test(b.text)));
});

test('eslatma job: ish kuni → buxgalterga REMINDER (dedupe), dam olish / vipiska yuklangan kun → yo‘q', () => {
  const job = H.app.scheduler.list().find((j) => j.name === 'bot-buxgalter-vipiska-eslatma');
  assert.equal(job?.schedule, 'daily 17:00');
  const dushanba = new Date('2026-09-28T12:00:00Z');
  const r1 = vipiskaEslatma(H.app, dushanba);
  assert.ok(r1.notified >= 1);
  assert.ok(db.get("SELECT id FROM notifications WHERE type='REMINDER' AND channel='CRM' AND user_id=? AND dedupe_key LIKE 'vipiska:2026-09-28%'", H.user('accountant@utax.uz').id));
  assert.equal(vipiskaEslatma(H.app, dushanba).notified, 0, 'bir kunda bir marta');
  assert.deepEqual(vipiskaEslatma(H.app, new Date('2026-09-26T12:00:00Z')), { skipped: 'dam olish kuni' });
  db.run("UPDATE bank_transactions SET created_at='2026-09-29T06:00:00.000Z' WHERE id=(SELECT MAX(id) FROM bank_transactions WHERE source='TELEGRAM')");
  assert.equal(vipiskaEslatma(H.app, new Date('2026-09-29T12:00:00Z')).skipped, 'bugun vipiska yuklangan');
});
