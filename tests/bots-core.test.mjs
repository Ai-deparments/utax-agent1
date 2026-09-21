/** Bot yadrosi: HTML/format, Mini App imzosi, tugmalar, Telegram klient, bog'lash, egalar, RBAC, AI, tasdiqlar, bildirishnomalar, webhook, web API. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBotHarness, createFakeTelegram, TEST_TOKENS } from './helpers/bot-harness.mjs';
import { esc, mdToHtml, splitHtml, stripTags } from '../src/bots/shared/html.mjs';
import { parseAmount, parseMonth, parseDate, money, date } from '../src/bots/shared/format.mjs';
import { verifyInitData, signInitData } from '../src/bots/shared/webapp-auth.mjs';
import { webLinks, toReplyMarkup } from '../src/bots/shared/keyboards.mjs';
import { createTelegramApi, TelegramError } from '../src/bots/shared/telegram-api.mjs';
import { createBot } from '../src/bots/shared/bot-factory.mjs';
import { createDialogStore } from '../src/bots/shared/dialogs.mjs';
import { createStateStore, startBots } from '../src/bots/index.mjs';
import { ensureOwner } from '../src/bots/shared/owners.mjs';
import { createApp, createServer } from '../src/server.mjs';
import { seed } from './fixtures/demo-seed.mjs';

let H, server, base;
before(async () => {
  H = await createBotHarness();
  server = createServer(H.app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); });

const ctxOf = (email) => ({ user: H.user(email), ip: '127.0.0.1', source: 'TEST' });
const tags = (html) => { const st = []; for (const m of html.matchAll(/<(\/?)([a-z-]+)[^>]*>/gi)) { if (m[1]) { assert.equal(st.pop(), m[2].toLowerCase(), 'teg tartibi'); } else st.push(m[2].toLowerCase()); } return st; };

// ---------- HTML / format ----------
test('html: esc va markdown → Telegram HTML (ai javoblari)', () => {
  assert.equal(esc('<b>&"'), '&lt;b&gt;&amp;"');
  const h = mdToHtml('**Jami:** 5 < 7 & `kod`\n- birinchi\n# Sarlavha\n[havola](https://utax.uz?a=1&b=2)');
  assert.match(h, /<b>Jami:<\/b> 5 &lt; 7 &amp; <code>kod<\/code>/);
  assert.match(h, /• birinchi/);
  assert.match(h, /<b>Sarlavha<\/b>/);
  assert.match(h, /<a href="https:\/\/utax\.uz\?a=1&amp;b=2">havola<\/a>/);
  assert.equal(stripTags('<b>a</b> &lt;x&gt;'), 'a <x>');
});

test('html: uzun matn 4096 chegarasida bo‘laklanadi, teglar har bo‘lakda yopiladi va qayta ochiladi', () => {
  const html = `<b>${'Qator matni juda uzun &amp; tekshiruv. '.repeat(40)}</b>\n` + Array.from({ length: 120 }, (_, i) => `<i>${i}</i> — ${'x'.repeat(50)}`).join('\n');
  const parts = splitHtml(html, 1000);
  assert.ok(parts.length > 3);
  for (const p of parts) {
    assert.ok(p.length <= 1000, `bo‘lak ${p.length}`);
    assert.deepEqual(tags(p), [], 'barcha teglar yopilgan');
    assert.ok(!/&[a-z]*$/i.test(p.replace(/<[^>]*>$/g, '')), 'entity o‘rtasidan kesilmagan');
  }
  assert.equal(parts.map(stripTags).join('').replace(/\s/g, '').length, stripTags(html).replace(/\s/g, '').length, 'matn yo‘qolmagan');
});

test('format: summa/oy/sana tahlili va web bilan bir xil ko‘rinish', () => {
  assert.equal(parseAmount('12 500 000'), 12500000);
  assert.equal(parseAmount('12,5 mln'), 12500000);
  assert.equal(parseAmount('1.2 mlrd'), 1200000000);
  assert.equal(parseAmount("500 ming so'm"), 500000);
  assert.equal(parseAmount('12.500.000'), 12500000);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('0'), null);
  assert.equal(parseMonth('2026-08'), '2026-08');
  assert.equal(parseMonth('avgust 2025'), '2025-08');
  assert.equal(parseMonth('08.2026'), '2026-08');
  assert.equal(parseDate('25.09.2026'), '2026-09-25');
  assert.equal(parseDate('31.02.2026'), null);
  assert.equal(money(12500000).replace(/ /g, ' '), '12 500 000 so‘m');
  assert.equal(date('2026-09-17'), '17.09.2026');
});

// ---------- Mini App imzo ----------
test('Mini App initData: to‘g‘ri imzo qabul, o‘zgartirilgan / eskirgan / boshqa token rad', () => {
  const token = TEST_TOKENS.rahbar;
  const fields = { auth_date: Math.floor(Date.now() / 1000), query_id: 'Q1', user: { id: 777, first_name: 'Ali' }, start_param: 'contracts' };
  const data = signInitData(fields, token);
  const ok = verifyInitData(data, token);
  assert.equal(ok.user.id, 777);
  assert.equal(ok.start_param, 'contracts');
  assert.equal(verifyInitData(data.replace('Ali', 'Vali'), token), null, 'o‘zgartirilgan');
  assert.equal(verifyInitData(data, TEST_TOKENS.signal), null, 'boshqa bot tokeni');
  assert.equal(verifyInitData(signInitData({ ...fields, auth_date: Math.floor(Date.now() / 1000) - 3 * 86400 }, token), token), null, 'eskirgan');
  // signature maydoni bilan (yangi Telegram mijozlari) — satrga kirmagan variant ham qabul
  const withSig = new URLSearchParams(signInitData(fields, token));
  withSig.set('signature', 'abc');
  assert.equal(verifyInitData(withSig.toString(), token).user.id, 777);
});

// ---------- tugmalar ----------
test('web havolalar: localhost → tugma yo‘q, http → URL, https → Mini App; ruxsatsiz sahifa tugmasi tushib qoladi', () => {
  assert.equal(webLinks({ webappUrl: 'http://127.0.0.1:8100' }).enabled, false);
  const http = webLinks({ webappUrl: 'http://crm.example.uz/' });
  assert.equal(http.url('contracts/5'), 'http://crm.example.uz/#/contracts/5');
  assert.equal(http.miniApp, false);
  const https = webLinks({ publicUrl: 'https://crm.utax.uz' });
  assert.equal(https.appUrl('#/contracts/5'), 'https://crm.utax.uz/?tgp=contracts%2F5');
  const mk = toReplyMarkup([[{ text: 'A', cb: 'r.x:1' }, { text: 'Pul', web: 'treasury' }], [{ text: 'Profil', web: 'settings/profile' }], [{ text: 'Buyruq', cmd: 'holat', args: '2026-08' }], null], https, (r) => r !== 'treasury');
  assert.deepEqual(mk.inline_keyboard[0], [{ text: 'A', callback_data: 'r.x:1' }], 'treasury ruxsatsiz — tugma yo‘q');
  assert.deepEqual(mk.inline_keyboard[1][0].web_app, { url: 'https://crm.utax.uz/?tgp=settings%2Fprofile' });
  assert.equal(mk.inline_keyboard[2][0].callback_data, 'cmd:holat:2026-08');
  assert.throws(() => toReplyMarkup([[{ text: 'x', cb: 'z'.repeat(65) }]], https), /64/);
  assert.equal(toReplyMarkup([[{ text: 'Pul', web: 'treasury' }]], webLinks({})), undefined, 'manzil yo‘q — klaviatura yo‘q');
});

// ---------- Telegram klient ----------
test('Telegram klient: 429 da retry_after kutadi, 5xx qayta urinadi, xato matnida token yo‘q', async () => {
  const tg = createFakeTelegram({ rahbar: 'SECRET:TOKEN' });
  const waits = [];
  const api = createTelegramApi('SECRET:TOKEN', { fetchImpl: tg.fetchImpl, sleepImpl: async (ms) => { waits.push(ms); } });
  tg.fail({ method: 'sendMessage', code: 429, description: 'Too Many Requests: retry after 3', parameters: { retry_after: 3 } });
  const m = await api.sendMessage(1, 'salom');
  assert.ok(m.message_id);
  assert.deepEqual(waits, [3000]);
  tg.fail({ method: 'getMe', code: 502, description: 'Bad Gateway' });
  assert.equal((await api.getMe()).username, 'utax_rahbar_bot');
  tg.fail({ method: 'sendMessage', code: 400, description: "Bad Request: can't parse entities: SECRET:TOKEN" });
  await assert.rejects(api.sendMessage(1, '<b>'), (e) => e instanceof TelegramError && e.isParseError && !e.message.includes('SECRET:TOKEN'));
  tg.fail({ method: 'sendMessage', code: 403, description: 'Forbidden: bot was blocked by the user' });
  await assert.rejects(api.sendMessage(1, 'x'), (e) => e.isUnreachable);
});

// ---------- factory (maxsus test boti) ----------
function testBot(overrides = {}, ownerIds = [], rateMax = 100) {
  const tg = createFakeTelegram({ test: 'T:1' });
  const def = {
    key: 'test', username: 'utax_test_bot', title: 'Test', about: 'Test bot', audience: ['FOUNDER', 'CEO', 'CFO', 'EMPLOYEE'],
    commands: [
      { name: 'pul', desc: 'Pul', perm: ['treasury', 'VIEW'], run: (ctx) => ctx.reply(`pul:${ctx.args}`) },
      { name: 'soz', desc: 'Dialog', run: (ctx) => { ctx.dialog.start('t.d', { n: 1 }, 'a'); return ctx.reply('yozing'); } },
      { name: 'xato', desc: 'Xato', run: () => { throw new Error('ichki xato tafsiloti'); } },
    ],
    dialogs: { 't.d': { onText: (ctx, st) => { ctx.dialog.clear(); return ctx.reply(`olindi:${ctx.text}:${st.data.n}`); } } },
    ...overrides,
  };
  const app = H.app;
  const bot = createBot(def, { app, api: createTelegramApi('T:1', { fetchImpl: tg.fetchImpl, sleepImpl: async () => {} }), dialogs: createDialogStore(app.db), state: createStateStore(app.db), registry: { usernameOf: (k) => `utax_${k}_bot`, suggestFor: () => [] }, links: webLinks({}), log: { warn() {}, error() {}, info() {} }, ownerIds, rateLimit: { windowMs: 60000, max: rateMax } });
  let uid = 100000;
  const send = async (tgId, text) => { const start = tg.calls.length; await bot.handleUpdate({ update_id: ++uid, message: { message_id: uid, date: Math.floor(Date.now() / 1000), chat: { id: tgId, type: 'private' }, from: { id: tgId, is_bot: false, first_name: 'T' }, text } }); return tg.calls.slice(start).filter((c) => c.method === 'sendMessage').map((c) => c.params.text).join('\n'); };
  return { bot, tg, send };
}

test('factory: RBAC — web matritsasi bilan bir xil (EMPLOYEE treasury ko‘ra olmaydi), ruxsatli rol ishlaydi', async () => {
  const { send } = testBot();
  const emp = H.link('employee@utax.uz');
  const cfo = H.link('cfo@utax.uz');
  assert.match(await send(emp, '/pul'), /Ruxsat yo‘q: «Pul boshqaruvi»/);
  assert.equal(await send(cfo, '/pul@utax_test_bot 2026-08'), 'pul:2026-08');
  assert.match(await send(cfo, '/yoq'), /buyrug‘i bu botda yo‘q/);
});

test('factory: dialog, /bekor, kutilmagan xato foydalanuvchiga stack ko‘rsatmaydi va audit qilinadi', async () => {
  const { send } = testBot();
  const ceo = H.link('ceo@utax.uz');
  await send(ceo, '/soz');
  assert.equal(await send(ceo, 'salom'), 'olindi:salom:1');
  await send(ceo, '/soz');
  assert.match(await send(ceo, '/bekor'), /Bekor qilindi/);
  assert.match(await send(ceo, '/bekor'), /Bekor qilinadigan ochiq amal yo‘q/);
  const out = await send(ceo, '/xato');
  assert.match(out, /Xatolik yuz berdi/);
  assert.ok(!out.includes('ichki xato tafsiloti'));
  assert.ok(H.db.get("SELECT id FROM audit_logs WHERE action='BOT_ERROR' AND new_value LIKE '%ichki xato%'"));
});

test('factory: update dedupe va rate limit (spam kesiladi)', async () => {
  const { bot, tg } = testBot({}, [], 5);
  const cfo = H.link('cfo@utax.uz');
  const upd = { update_id: 555, message: { message_id: 1, date: 1, chat: { id: cfo, type: 'private' }, from: { id: cfo, first_name: 'C' }, text: '/pul' } };
  const before = tg.calls.length;
  await bot.handleUpdate(upd);
  await bot.handleUpdate(upd);
  assert.equal(tg.calls.slice(before).filter((c) => c.method === 'sendMessage').length, 1, 'bir update bir marta');
  for (let i = 0; i < 8; i++) await bot.handleUpdate({ ...upd, update_id: 600 + i });
  const texts = tg.calls.slice(before).filter((c) => c.method === 'sendMessage').map((c) => c.params.text);
  assert.ok(texts.some((t) => /Juda ko‘p so‘rov/.test(t)));
  assert.ok(texts.filter((t) => t.startsWith('pul:')).length <= 5);
});

test('factory: guruh chatida ishlamaydi', async () => {
  const { bot, tg } = testBot();
  const before = tg.calls.length;
  await bot.handleUpdate({ update_id: 999, message: { message_id: 1, date: 1, chat: { id: -100, type: 'group' }, from: { id: 1, first_name: 'G' }, text: '/pul' } });
  assert.match(tg.calls.slice(before).find((c) => c.method === 'sendMessage').params.text, /faqat shaxsiy chatda/);
});

// ---------- bog'lash / auth ----------
test('bog‘lash: web kodi bilan /start KOD → bog‘landi; qayta ishlatib bo‘lmaydi; eskirgan kod rad', async () => {
  const u = H.user('accountant@utax.uz');
  H.db.run('UPDATE users SET telegram_user_id=NULL WHERE id=?', u.id);
  H.db.run("UPDATE users SET telegram_link_code='A1B2C3D4', telegram_link_expires=? WHERE id=?", new Date(Date.now() + 3600e3).toISOString(), u.id);
  let r = await H.send('buxgalter', 8100001, '/start A1B2C3D4');
  assert.match(r.text, /Bog‘landi!/);
  assert.equal(H.user('accountant@utax.uz').telegram_user_id, '8100001');
  assert.ok(H.db.get("SELECT id FROM audit_logs WHERE action='TELEGRAM_LINKED' AND entity_id=?", u.id));
  r = await H.send('buxgalter', 8100002, '/start A1B2C3D4');
  assert.match(r.text, /Kod noto‘g‘ri/);
  H.db.run("UPDATE users SET telegram_link_code='EEEE1111', telegram_link_expires=? WHERE id=?", new Date(Date.now() - 1000).toISOString(), H.user('sales2@utax.uz').id);
  r = await H.send('sorov', 8100003, '/start EEEE1111');
  assert.match(r.text, /muddati tugagan/);
});

test('auth: bog‘lanmagan → yo‘riqnoma + audit; noto‘g‘ri bot → mos botlar; bloklangan → rad', async () => {
  let r = await H.send('rahbar', 8200001, 'salom');
  assert.match(r.text, /bog‘lanmagan/);
  assert.match(r.text, /Sozlamalar → Profil → Telegram botlar/);
  assert.ok(H.db.get("SELECT id FROM audit_logs WHERE action='TELEGRAM_ACCESS_DENIED' AND new_value LIKE '%8200001%'"));
  const sales = H.link('sales@utax.uz');
  r = await H.send('rahbar', sales, '/start');
  assert.match(r.text, /Sotuv menejeri/);
  assert.ok(r.buttons.some((b) => /t\.me\/utax_sorov_bot/.test(b.url || '')));
  H.db.run('UPDATE users SET is_active=0 WHERE email=?', 'sales@utax.uz');
  r = await H.send('sorov', sales, '/start');
  assert.match(r.text, /bloklangan/);
  H.db.run('UPDATE users SET is_active=1 WHERE email=?', 'sales@utax.uz');
});

test('egalar (BOT_OWNER_IDS): yangi id → FOUNDER yaratiladi, bog‘langan boshqa rol ko‘tarilmaydi — ega o‘z hisobiga ko‘chadi', () => {
  const u = ensureOwner(H.app, '9123456789', { first_name: 'Ega', last_name: 'Bir', username: 'ega1' });
  assert.equal(u.role_code, 'FOUNDER');
  assert.equal(u.name, 'Ega Bir');
  assert.equal(u.telegram_user_id, '9123456789');
  assert.equal(ensureOwner(H.app, '9123456789').id, u.id, 'takror chaqiruv yangi foydalanuvchi yaratmaydi');
  const tg = H.link('head.it@utax.uz', 9123456790);
  const up = ensureOwner(H.app, String(tg));
  assert.equal(up.role_code, 'FOUNDER');
  assert.equal(up.email, `tg${tg}@owner.utax.uz`, 'ega alohida hisobiga ko‘chirildi');
  assert.equal(H.user('head.it@utax.uz').role_code, 'DEPARTMENT_HEAD', 'boshqa rolli hisob FOUNDER ga ko‘tarilmaydi');
  assert.ok(H.db.get("SELECT id FROM audit_logs WHERE action='OWNER_RELINKED' AND entity_id=?", up.id));
});

test('egalar: ro‘yxatdagi id botga birinchi yozganda kodsiz FOUNDER bo‘lib kiradi', async () => {
  const { send } = testBot({ audience: ['FOUNDER'] }, ['9555000111']);
  assert.equal(await send(9555000111, '/pul 1'), 'pul:1');
  const u = H.db.get('SELECT * FROM users WHERE telegram_user_id=?', '9555000111');
  assert.equal(u.role_code, 'FOUNDER');
  assert.ok(H.db.get("SELECT id FROM audit_logs WHERE action='OWNER_PROVISIONED' AND entity_id=?", u.id));
  assert.match(await send(9555000112, '/pul 1'), /bog‘lanmagan/, 'ro‘yxatda yo‘q id — oddiy tartib');
});

// ---------- AI ----------
test('AI erkin matn: web RBAC — xodim kompaniya pulini ko‘ra olmaydi, CFO ko‘radi (+ web tugma)', async () => {
  const emp = H.link('employee@utax.uz');
  let r = await H.send('sorov', emp, 'Bugun qancha pulimiz bor?');
  assert.match(r.text, /ruxsat yo‘q/);
  assert.ok(!/ISHLATISH MUMKIN/.test(r.text));
  const cfo = H.link('cfo@utax.uz');
  r = await H.send('rahbar', cfo, 'Bugun qancha pulimiz bor?');
  assert.match(r.text, /ISHLATISH MUMKIN/);
  assert.ok(r.button(/Web’da ochish/)?.web_app?.url.includes('tgp=treasury'));
});

// ---------- tasdiqlar + bildirishnomalar ----------
test('tasdiq oqimi: so‘rov → bo‘lim rahbariga signal (✅/❌) → tasdiq → keyingi qadam → rad (sabab) → so‘rovchiga qaror', async () => {
  const emp = H.link('employee@utax.uz'), head = H.link('head.marketing@utax.uz'), fin = H.link('finance@utax.uz');
  for (const e of ['employee@utax.uz', 'head.marketing@utax.uz', 'finance@utax.uz']) H.started('signal', e);
  const e = H.S.expenses.request({ amount: 8e6, purpose: 'Bot test reklama kampaniyasi' }, ctxOf('employee@utax.uz'));
  await H.app.bots.flush();
  const tgHead = H.db.get("SELECT * FROM notifications WHERE channel='TELEGRAM' AND user_id=? AND entity_id=? AND type='APPROVAL_WAITING'", H.user('head.marketing@utax.uz').id, e.approval_id);
  assert.ok(tgHead.sent_at, 'signal orqali yuborildi');
  assert.equal(tgHead.bot_key, 'signal');
  const sent = H.tg.calls.find((c) => c.bot === 'signal' && c.method === 'sendMessage' && String(c.params.chat_id) === String(head) && c.params.text.includes('Bot test reklama'));
  const kb = sent.params.reply_markup.inline_keyboard.flat();
  assert.ok(kb.some((b) => b.callback_data === `apr:ok:${e.approval_id}`));

  let r = await H.click('signal', head, `apr:ok:${e.approval_id}`, { messageId: Number(tgHead.tg_message_id) });
  assert.match(r.answers[0].text, /keyingi qadamga/);
  assert.equal(H.S.approvals.get(e.approval_id).current_step, 1);
  assert.equal(H.S.approvals.get(e.approval_id).steps[0].source, 'TELEGRAM');

  r = await H.click('signal', head, `apr:ok:${e.approval_id}`, { messageId: Number(tgHead.tg_message_id) });
  assert.match(r.answers[0].text, /Moliya menejeri/, 'o‘z qadami emas');

  r = await H.click('signal', fin, `apr:no:${e.approval_id}`);
  assert.match(r.text, /rad etish sababini/);
  r = await H.send('signal', fin, 'Hujjat yetarli emas');
  assert.equal(H.S.expenses.get(e.id).status, 'REJECTED');
  assert.equal(H.S.approvals.get(e.approval_id).comment, 'Hujjat yetarli emas');
  const decided = H.db.get("SELECT * FROM notifications WHERE channel='TELEGRAM' AND user_id=? AND type='APPROVAL_DECIDED' AND entity_id=?", H.user('employee@utax.uz').id, e.approval_id);
  assert.ok(decided?.sent_at, 'so‘rovchiga qaror yuborildi');

  r = await H.click('signal', emp, `nr:${decided.parent_id}`, { messageId: Number(decided.tg_message_id) });
  assert.equal(H.db.get('SELECT is_read FROM notifications WHERE id=?', decided.parent_id).is_read, 1, 'web’da ham o‘qilgan');
});

test('bildirishnoma sozlamalari: tur o‘chirilsa Telegram yo‘q (CRM bor); jim soat → navbatda; CRITICAL jim soatni yorib o‘tadi', async () => {
  const email = 'ceo@utax.uz';
  H.link(email);
  H.started('signal', email);
  const u = H.user(email);
  H.S.notifications.setPrefs(u.id, { types: { BUDGET_EXCEEDED: false } }, ctxOf(email));
  H.S.notifications.notify({ user_ids: [u.id], type: 'BUDGET_EXCEEDED', title: 'T1' });
  assert.ok(H.db.get("SELECT id FROM notifications WHERE user_id=? AND channel='CRM' AND title='T1'", u.id));
  assert.equal(H.db.get("SELECT id FROM notifications WHERE user_id=? AND channel='TELEGRAM' AND title='T1'", u.id), null);

  H.S.notifications.setPrefs(u.id, { quiet: { from: '00:00', to: '23:59' } }, ctxOf(email));
  H.S.notifications.notify({ user_ids: [u.id], type: 'DAILY_DIGEST', title: 'T2' });
  H.S.notifications.notify({ user_ids: [u.id], type: 'LOW_LIQUIDITY', severity: 'CRITICAL', title: 'T3' });
  await H.app.bots.flush();
  const t2 = H.db.get("SELECT * FROM notifications WHERE user_id=? AND channel='TELEGRAM' AND title='T2'", u.id);
  const t3 = H.db.get("SELECT * FROM notifications WHERE user_id=? AND channel='TELEGRAM' AND title='T3'", u.id);
  assert.equal(t2.sent_at, null, 'jim soatda kutadi');
  assert.ok(t3.sent_at, 'CRITICAL darhol');
  await H.app.bots.retryPending();
  assert.equal(H.db.get('SELECT sent_at FROM notifications WHERE id=?', t2.id).sent_at, null, 'jim soat davom etmoqda');
  H.S.notifications.setPrefs(u.id, { quiet: null }, ctxOf(email));
  await H.app.bots.retryPending();
  assert.ok(H.db.get('SELECT sent_at FROM notifications WHERE id=?', t2.id).sent_at, 'jim soat tugagach yuborildi');
});

test('yetkazish zaxirasi: signal bloklangan (403) → foydalanuvchi ochgan boshqa bot; hech biri bo‘lmasa xato va qayta urinish', async () => {
  const email = 'head.audit@utax.uz';
  const tgId = H.link(email);
  H.started('signal', email);
  H.started('sorov', email);
  const u = H.user(email);
  H.tg.fail({ method: 'sendMessage', bot: 'signal', chatId: tgId, code: 403, description: 'Forbidden: bot was blocked by the user' });
  H.S.notifications.notify({ user_ids: [u.id], type: 'DAILY_DIGEST', title: 'Zaxira test' });
  await H.app.bots.flush();
  const n = H.db.get("SELECT * FROM notifications WHERE user_id=? AND channel='TELEGRAM' AND title='Zaxira test'", u.id);
  assert.equal(n.bot_key, 'sorov');
  assert.ok(H.db.get("SELECT blocked_at FROM bot_chats WHERE bot_key='signal' AND user_id=?", u.id).blocked_at);

  const email2 = 'head.legal@utax.uz';
  const tg2 = H.link(email2);
  H.tg.fail({ method: 'sendMessage', bot: 'signal', chatId: tg2, code: 403, description: "Forbidden: bot can't initiate conversation with a user" });
  H.S.notifications.notify({ user_ids: [H.user(email2).id], type: 'DAILY_DIGEST', title: 'Hech kim' });
  await H.app.bots.flush();
  const n2 = H.db.get("SELECT * FROM notifications WHERE user_id=? AND channel='TELEGRAM' AND title='Hech kim'", H.user(email2).id);
  assert.equal(n2.sent_at, null);
  assert.equal(n2.attempts, 1);
  assert.match(n2.error, /\/start kerak/);
});

test('AI tasdiqlash taklifi: "… so‘rovni tasdiqla" → ✅ tugma → umumiy apr: orqali tasdiqlanadi (CFO qadami)', async () => {
  const cfo = H.link('cfo@utax.uz');
  const e = H.S.expenses.request({ amount: 151234567, purpose: 'Server klaster uskunasi' }, ctxOf('accountant@utax.uz'));
  assert.deepEqual(H.S.approvals.get(e.approval_id).steps.map((x) => x.role), ['CFO', 'CEO']);
  const r = await H.send('rahbar', cfo, '151234567 so‘mlik so‘rovni tasdiqla');
  const ok = r.button(/^✅ Tasdiqlash$/);
  assert.ok(ok, r.text);
  assert.equal(ok.callback_data, `apr:ok:${e.approval_id}`);
  const c = await H.click('rahbar', cfo, ok.callback_data);
  assert.match(c.answers[0].text, /keyingi qadamga/);
  assert.equal(H.S.approvals.get(e.approval_id).current_step, 1);
});

// ---------- webhook ----------
test('webhook: maxfiy sarlavha noto‘g‘ri → 401, to‘g‘ri → 200 va update ishlanadi', async () => {
  const app = createApp({ dbPath: ':memory:' });
  await seed(app, { log: () => {} });
  const tg = createFakeTelegram(TEST_TOKENS);
  await startBots(app, { tokens: { rahbar: TEST_TOKENS.rahbar }, mode: 'webhook', webhookSecret: 'sir-123', publicUrl: 'https://crm.utax.test', retryEveryMs: 0, log: { info() {}, warn() {}, error() {} }, apiFactory: (t) => createTelegramApi(t, { fetchImpl: tg.fetchImpl, sleepImpl: async () => {} }), links: webLinks({}), ownerIds: [] });
  assert.ok(tg.calls.some((c) => c.method === 'setWebhook' && c.params.url === 'https://crm.utax.test/telegram/rahbar' && c.params.secret_token === 'sir-123'));
  const srv = createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  try {
    const body = JSON.stringify({ update_id: 1, message: { message_id: 1, date: 1, chat: { id: 4242, type: 'private' }, from: { id: 4242, first_name: 'W' }, text: '/start' } });
    let res = await fetch(`${url}/telegram/rahbar`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'notogri' }, body });
    assert.equal(res.status, 401);
    res = await fetch(`${url}/telegram/rahbar`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'sir-123' }, body });
    assert.equal(res.status, 200);
    for (let i = 0; i < 100 && !tg.calls.some((c) => c.method === 'sendMessage'); i++) await new Promise((r) => setTimeout(r, 10));
    assert.match(tg.calls.find((c) => c.method === 'sendMessage').params.text, /bog‘lanmagan/);
    res = await fetch(`${url}/telegram/yoq`, { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'sir-123' }, body });
    assert.equal(res.status, 404);
  } finally {
    await app.bots.stop();
    await new Promise((r) => srv.close(r));
  }
});

// ---------- web API ----------
const login = async (email) => (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Utax2026!' }) })).json()).access_token;
const api = async (token, path, { method = 'GET', body } = {}) => { const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, body: await res.json().catch(() => null) }; };

test('web API: bog‘lash kodi faqat rolga mos botlar havolasini beradi; /start bilan bog‘lanadi; uzish ishlaydi', async () => {
  const token = await login('sales2@utax.uz');
  const r = await api(token, '/api/auth/telegram-link', { method: 'POST' });
  assert.equal(r.status, 200);
  assert.match(r.body.code, /^[A-F0-9]{12}$/);
  assert.deepEqual(r.body.links.map((l) => l.key).sort(), ['signal', 'sorov']);
  assert.ok(r.body.links[0].url.endsWith(`?start=${r.body.code}`));
  const out = await H.send('sorov', 8300001, `/start ${r.body.code}`);
  assert.match(out.text, /Bog‘landi/);
  const me = await api(token, '/api/bots');
  assert.equal(me.body.me.linked, true);
  assert.equal(me.body.bots.find((b) => b.key === 'sorov').started !== null, true);
  assert.equal(me.body.bots.find((b) => b.key === 'rahbar').allowed, false);
  assert.equal(me.body.bots[0].last_error, undefined, 'admin maydonlari oddiy foydalanuvchiga ko‘rinmaydi');
  assert.equal((await api(token, '/api/auth/telegram-unlink', { method: 'POST' })).status, 200);
  assert.equal(H.user('sales2@utax.uz').telegram_user_id, null);
});

test('web API: Telegram Mini App login — imzoli initData → sessiya; bog‘lanmagan / soxta → 401', async () => {
  const tgId = H.link('finance@utax.uz');
  const good = signInitData({ auth_date: Math.floor(Date.now() / 1000), user: { id: Number(tgId), first_name: 'F' }, start_param: 'approvals' }, TEST_TOKENS.buxgalter);
  // config.bots (.env) emas, test tokenlari bilan imzolangan — shuning uchun faqat .env dagi tokenlar bilan tekshiruv muvaffaqiyatsiz bo'lishi kerak
  const res = await fetch(`${base}/api/auth/telegram-webapp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ init_data: good }) });
  assert.equal(res.status, 401, 'boshqa token bilan imzolangan initData qabul qilinmaydi');
  const bad = await fetch(`${base}/api/auth/telegram-webapp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ init_data: 'user=%7B%7D&hash=00' }) });
  assert.equal(bad.status, 401);
});

test('web API: AI chat ham RBAC bilan (xodim — pul ma’lumoti yopiq)', async () => {
  const token = await login('employee@utax.uz');
  const r = await api(token, '/api/ai/chat', { method: 'POST', body: { message: 'Kassada qancha pul bor?' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.denied, true);
  assert.match(r.body.answer, /ruxsat yo‘q/);
});

test('web API: bildirishnoma sozlamalari GET/PUT; noto‘g‘ri jim soat 400', async () => {
  const token = await login('head.revision@utax.uz');
  let r = await api(token, '/api/notifications/prefs');
  assert.equal(r.status, 200);
  assert.ok(r.body.types.length >= 16);
  r = await api(token, '/api/notifications/prefs', { method: 'PUT', body: { types: { DAILY_DIGEST: false }, quiet: { from: '22:00', to: '08:00' } } });
  assert.equal(r.body.types.find((t) => t.type === 'DAILY_DIGEST').telegram, false);
  assert.deepEqual(r.body.quiet, { from: '22:00', to: '08:00' });
  r = await api(token, '/api/notifications/prefs', { method: 'PUT', body: { quiet: { from: '25:00', to: '08:00' } } });
  assert.equal(r.status, 400);
});
