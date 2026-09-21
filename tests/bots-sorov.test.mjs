/** @utax_sorov_bot — xarajat so'rovi dialogi, o'z so'rovlari, bo'lim tasdig'i, sotuvchi scope, undiruv vazifalari, oylik/KPI. */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBotHarness } from './helpers/bot-harness.mjs';
import { today, addDays } from '../src/core/util.mjs';
import { money, date } from '../src/bots/shared/format.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let H, emp, head, sales, sales2, auditor, ceo;
const dialogOf = (tgId) => H.db.get('SELECT state FROM bot_dialogs WHERE key=?', `sorov:${tgId}`);
const ctxOf = (email) => ({ user: H.user(email), ip: '127.0.0.1', source: 'TEST' });
const msgWith = (r, data) => r.messages.find((m) => (m.reply_markup?.inline_keyboard || []).flat().some((b) => b.callback_data === data));

before(async () => {
  H = await createBotHarness();
  emp = H.link('employee@utax.uz');
  head = H.link('head.marketing@utax.uz');
  sales = H.link('sales@utax.uz');
  sales2 = H.link('sales2@utax.uz');
  auditor = H.link('auditor@utax.uz');
  ceo = H.link('ceo@utax.uz');
  H.started('signal', 'head.marketing@utax.uz');
});
// Factory rate-limit: bitta Telegram id uchun daqiqasiga 30 update — har testda xodim yangi id bilan bog'lanadi
beforeEach(() => { emp = H.link('employee@utax.uz'); });

test('menyu: xodimga faqat ruxsat etilgan bo‘limlar', async () => {
  const r = await H.send('sorov', emp, '/start');
  assert.match(r.text, /Ko‘rib chiqilayotgan so‘rovlaringiz/);
  const labels = r.buttons.map((b) => b.text);
  for (const l of ['➕ Yangi so‘rov', '📋 So‘rovlarim', '💳 Oyligim', '📈 KPI']) assert.ok(labels.includes(l), `${l} bo‘lishi kerak`);
  for (const l of ['✅ Tasdiqlash', '📄 Shartnomalarim', '👥 Qarzdorlarim', '📞 Vazifalarim']) assert.ok(!labels.includes(l), `${l} bo‘lmasligi kerak`);
  const h = await H.send('sorov', head, '/start');
  assert.match(h.text, /Sizning tasdig‘ingizni kutmoqda/);
});

test('yangi: to‘liq oqim → PENDING, bo‘lim rahbari qadami, signal xabari, hujjat saqlanadi', async () => {
  let r = await H.send('sorov', emp, '/yangi');
  assert.match(r.text, /1\/7 · Summa/);
  r = await H.send('sorov', emp, 'sakkiz');
  assert.match(r.text, /Summani tushunmadim/);
  assert.equal(JSON.parse(dialogOf(emp).state).step, 'amount', 'noto‘g‘ri summa — qadam o‘zgarmaydi');
  r = await H.send('sorov', emp, '8 mln');
  assert.match(r.text, /2\/7 · Maqsad/);
  r = await H.send('sorov', emp, 'Test');
  assert.match(r.text, /kamida 5 belgi/);
  r = await H.send('sorov', emp, 'Reklama kampaniyasi oktabr');
  assert.match(r.text, /3\/7 · Kategoriya/);
  const ai = r.buttons[0];
  assert.match(ai.text, /Reklama \(AI taklifi\)/);
  r = await H.click('sorov', emp, ai.callback_data);
  assert.match(r.text, /Kategoriya:<\/b> Reklama/);
  assert.match(r.text, /4\/7 · Kerakli sana/);
  r = await H.click('sorov', emp, 's.date:3');
  assert.match(r.text, /5\/7 · To‘lov usuli/);
  r = await H.click('sorov', emp, 's.pm:BANK');
  assert.match(r.text, /6\/7 · Kontragent/);
  r = await H.click('sorov', emp, 's.skip:cp');
  assert.match(r.text, /7\/7 · Hujjat/);
  r = await H.photo('sorov', emp, { content: 'JPEG-CHEK' });
  assert.match(r.text, /tekshiring/);
  assert.match(r.text, /📎 Hujjat: <b>rasm_/);
  assert.ok(r.button('✅ Yuborish'));
  r = await H.click('sorov', emp, 's.send');
  assert.match(r.by('sorov').text, /So‘rov yuborildi: EXP-\d{6}/);
  assert.match(r.by('sorov').text, /👉 1\. Bo‘lim rahbari/);

  const u = H.user('employee@utax.uz');
  const e = H.db.get('SELECT e.*, ec.code AS cat FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id WHERE e.requested_by=? ORDER BY e.id DESC LIMIT 1', u.id);
  assert.equal(e.status, 'PENDING');
  assert.equal(e.amount, 8e6);
  assert.equal(e.cat, 'ADVERTISING');
  assert.equal(e.required_date, addDays(today(), 3));
  assert.equal(e.payment_method, 'BANK');
  assert.equal(e.department_id, u.department_id);
  assert.ok(e.receipt_path, 'hujjat yo‘li saqlangan');
  const abs = path.resolve(ROOT, e.receipt_path);
  assert.equal(fs.readFileSync(abs, 'utf8'), 'JPEG-CHEK');
  fs.rmSync(abs, { force: true });

  const a = H.S.approvals.get(e.approval_id);
  assert.deepEqual(a.steps.map((s) => s.role), ['DEPARTMENT_HEAD', 'FINANCE_MANAGER']);
  assert.equal(a.current_step, 0);
  const sig = r.by('signal').messages.find((m) => String(m.chat_id) === String(head));
  assert.ok(sig, 'bo‘lim rahbariga signal bot xabari');
  assert.match(sig.text, /Tasdiq kutilmoqda/);
  assert.ok(sig.reply_markup.inline_keyboard.flat().some((b) => b.callback_data === `apr:ok:${a.id}`), 'signal xabarida ✅ tugma');
  assert.equal(dialogOf(emp), null, 'dialog yopildi');
});

test('yangi: /yangi 5 mln — summa qadami o‘tkazib yuboriladi; /bekor yopadi', async () => {
  let r = await H.send('sorov', emp, '/yangi 5 mln');
  assert.match(r.text, /Summa: <b>5 000 000/);
  assert.match(r.text, /2\/7 · Maqsad/);
  r = await H.send('sorov', emp, '/bekor');
  assert.match(r.text, /Bekor qilindi/);
  assert.equal(dialogOf(emp), null);
});

test('bekor: dialog yopilgach keyingi matn dialogga emas, AI yordamchiga ketadi', async () => {
  await H.send('sorov', emp, '/yangi');
  await H.send('sorov', emp, '/bekor');
  const r = await H.send('sorov', emp, '12 mln');
  assert.doesNotMatch(r.text, /2\/7 · Maqsad/);
  assert.equal(dialogOf(emp), null);
});

test('eskirgan tugma: dialog yo‘q bo‘lsa ogohlantiradi', async () => {
  const r = await H.click('sorov', emp, 's.cat:3');
  assert.equal(r.answers.length, 1);
  assert.match(r.answers[0].text, /eskirgan/);
  assert.equal(r.answers[0].show_alert, true);
});

test('o‘tgan bosqich tugmasi qayta ishlamaydi', async () => {
  await H.send('sorov', emp, '/yangi');
  await H.send('sorov', emp, '2 mln');
  await H.send('sorov', emp, 'Ofis uchun suv va choy');
  const r = await H.click('sorov', emp, 's.date:1');
  assert.match(r.answers[0].text, /allaqachon o‘tgan/);
  assert.equal(JSON.parse(dialogOf(emp).state).step, 'category');
  await H.send('sorov', emp, '/bekor');
});

test('yangi: yozilgan sana, naqd, kontragent matni, hujjatsiz; o‘tgan sana rad etiladi', async () => {
  await H.send('sorov', emp, '/yangi');
  await H.send('sorov', emp, '3 500 000');
  await H.send('sorov', emp, 'Ofis uchun kantselyariya tovarlari');
  let r = await H.click('sorov', emp, 's.cat:auto');
  assert.match(r.text, /AI tanlaydi/);
  r = await H.send('sorov', emp, '01.01.2020');
  assert.match(r.text, /O‘tgan sana/);
  const kun = addDays(today(), 10);
  r = await H.send('sorov', emp, date(kun));
  assert.match(r.text, /5\/7/);
  await H.click('sorov', emp, 's.pm:CASH');
  r = await H.send('sorov', emp, 'OFIS MARKET');
  assert.match(r.text, /7\/7/);
  r = await H.click('sorov', emp, 's.skip:file');
  assert.match(r.text, /Naqd \(kassa\)/);
  assert.match(r.text, /OFIS MARKET/);
  assert.match(r.text, /Hujjat: biriktirilmagan/);
  await H.click('sorov', emp, 's.send');
  const e = H.db.get('SELECT e.*, ec.code AS cat FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id WHERE e.requested_by=? ORDER BY e.id DESC LIMIT 1', H.user('employee@utax.uz').id);
  assert.equal(e.amount, 3.5e6);
  assert.equal(e.payment_method, 'CASH');
  assert.equal(e.counterparty, 'OFIS MARKET');
  assert.equal(e.required_date, kun);
  assert.equal(e.receipt_path, null);
  assert.equal(e.cat, 'OFFICE', 'AI (qoidalar) kategoriyani tanladi');
  assert.deepEqual(H.S.approvals.get(e.approval_id).steps.map((s) => s.role), ['DEPARTMENT_HEAD'], '< 5M qoidasi');
});

test('yangi: hujjat bosqichida ruxsat etilmagan fayl turi rad etiladi', async () => {
  await H.send('sorov', emp, '/yangi 1 mln');
  await H.send('sorov', emp, 'Kuryer xizmati');
  await H.click('sorov', emp, 's.cat:auto');
  await H.click('sorov', emp, 's.date:skip');
  await H.click('sorov', emp, 's.pm:BANK');
  await H.click('sorov', emp, 's.skip:cp');
  const r = await H.upload('sorov', emp, { name: 'dastur.exe', content: 'MZ', mime: 'application/x-msdownload' });
  assert.match(r.text, /Faqat rasm, PDF/);
  assert.equal(JSON.parse(dialogOf(emp).state).step, 'receipt');
  await H.send('sorov', emp, '/bekor');
});

test('dialogdan tashqari fayl — /yangi taklif qilinadi', async () => {
  const r = await H.upload('sorov', emp, { name: 'chek.pdf', content: '%PDF', mime: 'application/pdf' });
  assert.match(r.text, /\/yangi/);
});

test('sorovlarim: faqat o‘z so‘rovlari', async () => {
  const u = H.user('employee@utax.uz');
  const own = H.db.all('SELECT id, code FROM expenses WHERE requested_by=? AND approval_id IS NOT NULL AND reversed_at IS NULL', u.id);
  const other = H.db.get("SELECT code FROM expenses WHERE purpose LIKE 'Server klaster%'");
  const r = await H.send('sorov', emp, '/sorovlarim');
  assert.match(r.text, /So‘rovlarim/);
  for (const e of own.slice(-3)) assert.match(r.text, new RegExp(e.code));
  assert.doesNotMatch(r.text, new RegExp(other.code));
  const ids = r.buttons.filter((b) => b.callback_data?.startsWith('s.my:')).map((b) => Number(b.callback_data.split(':')[1]));
  assert.ok(ids.length > 0);
  for (const id of ids) assert.equal(H.db.get('SELECT requested_by FROM expenses WHERE id=?', id).requested_by, u.id);
});

test('s.my: boshqaning so‘rovi ochilmaydi, o‘ziniki — tasdiqlash zanjiri bilan', async () => {
  const other = H.db.get("SELECT id FROM expenses WHERE purpose LIKE 'Server klaster%'");
  let r = await H.click('sorov', emp, `s.my:${other.id}`);
  assert.match(r.answers[0].text, /sizniki emas/);
  assert.equal(r.messages.length, 0);
  const own = H.db.get("SELECT id, code FROM expenses WHERE purpose LIKE 'Korporativ tadbir%'");
  r = await H.click('sorov', emp, `s.my:${own.id}`);
  assert.match(r.text, new RegExp(own.code));
  assert.match(r.text, /Tasdiqlash zanjiri/);
  assert.match(r.text, /Xarajat holati: <b>Rad etilgan<\/b>/);
  assert.match(r.text, /Byudjetdan tashqari/);
});

test('tasdiqlash: bo‘lim rahbari ✅ bosadi → keyingi qadam (moliya menejeri)', async () => {
  const e = H.S.expenses.request({ amount: 8e6, purpose: 'Bo‘lim tasdig‘i testi — banner' }, ctxOf('employee@utax.uz'));
  const r = await H.send('sorov', head, '/tasdiqlash');
  assert.match(r.text, /Xarajat so‘rovlari/);
  assert.match(r.text, new RegExp(e.code));
  const data = `apr:ok:${e.approval_id}`;
  const card = msgWith(r, data);
  assert.ok(card, 'kartada ✅ tugma');
  const c = await H.click('sorov', head, data, { messageId: card.message_id });
  assert.match(c.answers[0].text, /keyingi qadamga/);
  const a = H.S.approvals.get(e.approval_id);
  assert.equal(a.current_step, 1);
  assert.equal(a.status, 'PENDING');
  assert.equal(a.steps[0].source, 'TELEGRAM');
  assert.equal(H.S.expenses.get(e.id).status, 'PENDING');
});

test('ruxsat: xodim /tasdiqlash va /shartnomalarim, auditor /yangi — rad', async () => {
  let r = await H.send('sorov', emp, '/tasdiqlash');
  assert.match(r.text, /Ruxsat yo‘q: «Tasdiqlashlar»/);
  r = await H.send('sorov', emp, '/shartnomalarim');
  assert.match(r.text, /Ruxsat yo‘q: «Shartnomalar»/);
  r = await H.send('sorov', auditor, '/yangi');
  assert.match(r.text, /Ruxsat yo‘q: «Xarajatlar»/);
  const m = await H.send('sorov', auditor, '/start');
  assert.ok(!m.buttons.some((b) => b.text === '➕ Yangi so‘rov'));
});

test('shartnomalarim: SALES faqat o‘z shartnomalarini ko‘radi', async () => {
  const s1 = H.user('sales@utax.uz'), s2 = H.user('sales2@utax.uz');
  const mine = H.S.contracts.list({ manager_user_id: s1.id, active: true });
  const theirs = H.S.contracts.list({ manager_user_id: s2.id, active: true });
  const r = await H.send('sorov', sales, '/shartnomalarim');
  assert.match(r.text, new RegExp(`Faol shartnomalar: <b>${mine.length} ta`));
  for (const c of mine.slice(0, 3)) assert.match(r.text, new RegExp(c.contract_number));
  for (const c of theirs) assert.doesNotMatch(r.text, new RegExp(`${c.contract_number}\\b`));
  const ids = r.buttons.filter((b) => b.callback_data?.startsWith('s.ct:')).map((b) => Number(b.callback_data.split(':')[1]));
  for (const id of ids) assert.equal(H.S.contracts.get(id).manager_user_id, s1.id);
});

test('s.ct: SALES boshqa menejer shartnomasini ocholmaydi, o‘zinikini ochadi', async () => {
  const s1 = H.user('sales@utax.uz'), s2 = H.user('sales2@utax.uz');
  const theirs = H.S.contracts.list({ manager_user_id: s2.id, active: true })[0];
  let r = await H.click('sorov', sales, `s.ct:${theirs.id}`);
  assert.match(r.answers[0].text, /biriktirilmagan/);
  const mine = H.S.contracts.list({ manager_user_id: s1.id, active: true })[0];
  r = await H.click('sorov', sales, `s.ct:${mine.id}`);
  assert.match(r.text, new RegExp(mine.contract_number));
  assert.match(r.text, new RegExp(`Qoldiq: <b>${money(mine.remaining)}`));
  assert.ok(r.buttons.some((b) => b.web_app?.url.includes(`contracts%2F${mine.id}`)), 'web tugma');
});

test('qarzdorlarim: faqat o‘z mijozlari, jami servis bilan teng', async () => {
  const s1 = H.user('sales@utax.uz'), s2 = H.user('sales2@utax.uz');
  const mine = H.S.receivables.list({ manager_user_id: s1.id });
  const theirs = H.S.receivables.list({ manager_user_id: s2.id });
  const onlyTheirs = theirs.map((x) => x.client).filter((c) => !mine.some((m) => m.client === c));
  const total = mine.reduce((s, x) => s + x.debt, 0);
  const r = await H.send('sorov', sales, '/qarzdorlarim');
  assert.match(r.text, new RegExp(`Jami qarz: <b>${money(total)}`));
  assert.ok(onlyTheirs.length > 0);
  for (const c of onlyTheirs) assert.doesNotMatch(r.text, new RegExp(c));
});

test('vazifalarim: aloqa, va’da (dialog) va bajarildi tugmalari', async () => {
  H.S.receivables.runCollectionAgent('2026-09-20');
  const s1 = H.user('sales@utax.uz');
  const tasks = H.S.receivables.listCollections({ status: 'OPEN', assigned_to: s1.id });
  assert.ok(tasks.length >= 2, 'sotuvchida ochiq vazifalar bor');
  let r = await H.send('sorov', sales, '/vazifalarim');
  assert.match(r.text, new RegExp(`Ochiq: <b>${tasks.length} ta`));
  const callBtn = r.buttons.find((b) => b.callback_data?.startsWith('s.col:call:'));
  const id = Number(callBtn.callback_data.split(':')[2]);
  const card = msgWith(r, callBtn.callback_data);

  r = await H.click('sorov', sales, `s.col:call:${id}`, { messageId: card.message_id });
  assert.match(r.answers[0].text, /Aloqa qayd etildi/);
  assert.match(H.db.get('SELECT note FROM collections WHERE id=?', id).note, /📞 .* — aloqa qilindi \(Jasur Tursunov\)/);
  assert.match(r.text, /aloqa qilindi/, 'karta tarix bilan yangilandi');

  r = await H.click('sorov', sales, `s.col:prom:${id}`, { messageId: card.message_id });
  assert.match(r.text, /qachon to‘lashga va’da berdi/);
  assert.equal(JSON.parse(dialogOf(sales).state).name, 's.promise');
  r = await H.send('sorov', sales, 'kecha-bugun');
  assert.match(r.text, /Sanani tushunmadim/);
  const kun = addDays(today(), 5);
  r = await H.send('sorov', sales, date(kun));
  assert.match(r.text, /Va’da qayd etildi/);
  assert.ok(H.db.get('SELECT note FROM collections WHERE id=?', id).note.includes(`🤝 Va’da: ${date(kun)}`));
  assert.equal(dialogOf(sales), null);

  r = await H.click('sorov', sales, `s.col:done:${id}`, { messageId: card.message_id });
  assert.match(r.answers[0].text, /Vazifa yopildi/);
  assert.equal(H.db.get('SELECT status FROM collections WHERE id=?', id).status, 'DONE');
  r = await H.click('sorov', sales, `s.col:call:${id}`);
  assert.match(r.answers[0].text, /allaqachon yopilgan/);
});

test('vazifa: boshqa sotuvchi bosa olmaydi; s.pd tez tugma bilan va’da', async () => {
  const s1 = H.user('sales@utax.uz');
  const task = H.S.receivables.listCollections({ status: 'OPEN', assigned_to: s1.id })[0];
  let r = await H.click('sorov', sales2, `s.col:call:${task.id}`);
  assert.match(r.answers[0].text, /biriktirilmagan/);
  await H.click('sorov', sales, `s.col:prom:${task.id}`);
  r = await H.click('sorov', sales, `s.pd:${task.id}:3`);
  assert.match(r.text, /Va’da qayd etildi/);
  assert.ok(H.db.get('SELECT note FROM collections WHERE id=?', task.id).note.includes(`🤝 Va’da: ${date(addDays(today(), 3))}`));
  assert.equal(dialogOf(sales), null);
});

test('oyligim: vedomost bilan bir xil raqamlar, oy navigatsiyasi, noto‘g‘ri oy', async () => {
  const u = H.user('employee@utax.uz');
  const row = (p) => H.db.get('SELECT p.* FROM payrolls p JOIN employees e ON e.id=p.employee_id WHERE e.user_id=? AND p.period=?', u.id, p);
  const aug = row('2026-08'), jul = row('2026-07');
  let r = await H.send('sorov', emp, '/oyligim 2026-08');
  assert.match(r.text, /Oylik — Avgust 2026/);
  assert.match(r.text, new RegExp(`Qo‘lga: ${money(aug.net)}`));
  assert.match(r.text, new RegExp(`Fiks oylik: <b>${money(aug.fixed)}`));
  assert.match(r.text, /Holat: <b>To‘langan<\/b>/);
  r = await H.send('sorov', emp, '/oyligim');
  assert.match(r.text, /Avgust 2026/, 'argumentsiz — oxirgi hisoblangan oy');
  r = await H.click('sorov', emp, 's.pay:2026-07');
  assert.match(r.text, /Oylik — Iyul 2026/);
  assert.match(r.text, new RegExp(`Qo‘lga: ${money(jul.net)}`));
  r = await H.send('sorov', emp, '/oyligim qachondir');
  assert.match(r.text, /Oyni tushunmadim/);
  r = await H.send('sorov', ceo, '/oyligim');
  assert.match(r.text, /xodim kartangiz topilmadi/);
});

test('kpi: sotuvchining KPI qoidasi va vedomostdagi KPI summasi', async () => {
  const u = H.user('sales@utax.uz');
  const aug = H.db.get('SELECT p.* FROM payrolls p JOIN employees e ON e.id=p.employee_id WHERE e.user_id=? AND p.period=?', u.id, '2026-08');
  const r = await H.send('sorov', sales, '/kpi avgust 2026');
  assert.match(r.text, /KPI — Avgust 2026/);
  assert.match(r.text, new RegExp(`KPI ustama \\(oylik vedomostida\\): <b>${money(aug.kpi)}`));
  assert.match(r.text, /Sotuv KPI/);
});

test('erkin matn: xodim kompaniya balansini so‘rasa — ruxsat yo‘q', async () => {
  const r = await H.send('sorov', emp, 'Bugun qancha pulimiz bor?');
  assert.match(r.text, /ruxsat yo‘q/);
  assert.doesNotMatch(r.text, /ISHLATISH MUMKIN/);
});

test('xatolar jurnali bo‘sh (kutilmagan istisno yo‘q)', () => {
  assert.deepEqual(H.errors, []);
});
