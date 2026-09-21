/**
 * Telegram runtime tuzatishlari (review #13–#16, L4, L5, L7) — soxta Telegram, tarmoqsiz:
 *   #13 dispatch va retryPending bitta yozuvni ikki marta yubormaydi (atomik band qilish)
 *   #14 polling offset bot id'ga bog'langan — token boshqa botga almashsa yangi bot "kar" bo'lmaydi
 *   #15 ishga tushishdagi xato (getMe/setWebhook) fon rejimida backoff bilan qayta urinadi; 401/404 da to'xtaydi
 *   #16 muddati o'tgan dialogga yozilgan javob AI'ga ketmaydi; purgeExpired 24 soat grace bilan
 *   L4  noto'g'ri yozilgan / ruxsatsiz buyruq ochiq dialogni o'chirmaydi
 *   L5  eski xabardagi «✖️ Bekor» boshqa (joriy) dialogni o'chirmaydi (x:<dialog teg>)
 *   L7  rad etish sababi dialogi: so'rov shu orada hal qilinsa dialog yopiladi
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createBotHarness, createFakeTelegram, TEST_TOKENS } from './helpers/bot-harness.mjs';
import { createTelegramApi } from '../src/bots/shared/telegram-api.mjs';
import { webLinks } from '../src/bots/shared/keyboards.mjs';
import { createDialogStore, dialogTag, STALE_GRACE_MS } from '../src/bots/shared/dialogs.mjs';
import { startBots } from '../src/bots/index.mjs';
import { T } from '../src/bots/shared/texts.mjs';
import { createApp } from '../src/server.mjs';
import { seed } from './fixtures/demo-seed.mjs';
import { ROOT } from '../src/core/config.mjs';

const quiet = { info() {}, log() {}, warn() {}, error() {} };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Shart bajarilguncha kutish (ko'pi bilan `ms`); qaytaradi: bajarildimi */
async function until(fn, ms = 3000) {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) return false; await wait(5); }
  return true;
}
/** Soxta Telegram'dagi getUpdates darhol [] qaytarmasin (polling sikli bo'sh aylanmasin) — abort bilan to'xtaydi */
const slowUpdates = (fetchImpl, ms = 10) => async (url, init = {}) => {
  if (/\/getUpdates$/.test(url)) {
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      init.signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
    });
  }
  return fetchImpl(url, init);
};

async function makeApp() {
  const app = createApp({ dbPath: ':memory:' });
  await seed(app, { log: () => {} });
  app.settings.set('notifications.telegram_enabled', true);
  return app;
}
const botsOpts = (fetchImpl, extra = {}) => ({
  mode: 'off', retryEveryMs: 0, log: quiet, links: webLinks({}), ownerIds: [], rateLimit: { windowMs: 60000, max: 10000 },
  apiFactory: (t) => createTelegramApi(t, { fetchImpl, sleepImpl: async () => {} }),
  ...extra,
});

let H;
before(async () => { H = await createBotHarness(); });
const ctxOf = (email) => ({ user: H.user(email), ip: '127.0.0.1', source: 'TEST' });
/** app.services.ai.chat ni vaqtincha almashtirish — LLM'ga ketgan savollarni sanash */
function spyAi() {
  const ai = H.S.ai;
  const orig = ai.chat;
  const s = { calls: [], restore: () => { ai.chat = orig; } };
  ai.chat = async (q) => { s.calls.push(q); return { answer: 'AI javobi' }; };
  return s;
}

// ---------- #13 ----------
test('#13 dispatch va retryPending bir vaqtda — bitta yozuv bitta sendMessage (atomik band qilish)', async () => {
  const app = await makeApp();
  const tg = createFakeTelegram(TEST_TOKENS);
  let delay = 0;
  const fetchImpl = async (url, init) => { if (delay && /\/sendMessage$/.test(url)) await wait(delay); return tg.fetchImpl(url, init); };
  const bots = await startBots(app, { tokens: { signal: TEST_TOKENS.signal }, ...botsOpts(fetchImpl) });
  const cfo = app.db.get("SELECT * FROM users WHERE email='cfo@utax.uz'");
  app.db.run('UPDATE users SET telegram_user_id=?, telegram_chat_id=?, tg_quiet_from=NULL, tg_quiet_to=NULL WHERE id=?', '5130001', '5130001', cfo.id);
  try {
    delay = 150; // sekin tarmoq / 429 kutishi o'rnida
    app.services.notifications.notify({ user_ids: [cfo.id], type: 'LOW_LIQUIDITY', severity: 'WARNING', title: 'Dup #13' });
    await wait(30); // dispatch → deliver sendMessage kutyapti
    const res = await Promise.all([bots.retryPending(), bots.retryPending()]); // runtime tick'lari ustma-ust
    await bots.flush();
    const sent = tg.calls.filter((c) => c.method === 'sendMessage' && String(c.params.chat_id) === '5130001' && /Dup #13/.test(c.params.text));
    assert.equal(sent.length, 1, `bitta xabar bo‘lishi kerak, yuborildi: ${sent.length}`);
    assert.deepEqual(res.map((r) => r.sent), [0, 0], 'retryPending band qilingan yozuvni yubormaydi');
    const row = app.db.get("SELECT * FROM notifications WHERE channel='TELEGRAM' AND user_id=? AND title='Dup #13'", cfo.id);
    assert.ok(row.sent_at);
    assert.equal(row.attempts, 1);
    assert.equal(row.next_try_at, null, 'yuborilgach band belgisi tozalanadi');
    assert.equal(row.tg_message_id, String(sent[0].result.message_id));

    // Jarayon yuborish o'rtasida yiqilgan (band muddati o'tgan) yozuv — qayta olinadi va bir marta yuboriladi
    delay = 0;
    const tid = app.db.insert('notifications', { user_id: cfo.id, channel: 'TELEGRAM', type: 'LOW_LIQUIDITY', severity: 'WARNING', title: 'Band eskirgan', attempts: 0, bot_key: 'signal', next_try_at: new Date(Date.now() - 1000).toISOString(), created_at: new Date().toISOString() });
    const [a, b] = await Promise.all([bots.deliver(tid), bots.deliver(tid)]);
    assert.deepEqual([a, b].sort(), [false, true]);
    assert.equal(tg.calls.filter((c) => c.method === 'sendMessage' && /Band eskirgan/.test(c.params.text)).length, 1);
    // Band qilingan (next_try_at kelajakda) yozuvni deliver olmaydi
    const busy = app.db.insert('notifications', { user_id: cfo.id, channel: 'TELEGRAM', type: 'LOW_LIQUIDITY', severity: 'WARNING', title: 'Band', attempts: 0, bot_key: 'signal', next_try_at: new Date(Date.now() + 60e3).toISOString(), created_at: new Date().toISOString() });
    assert.equal(await bots.deliver(busy), false);
    assert.equal(tg.calls.filter((c) => c.method === 'sendMessage' && /<b>Band<\/b>/.test(c.params.text)).length, 0);
  } finally {
    await bots.stop();
  }
});

// ---------- #14 ----------
/** Telegram offset semantikasi: har bot o'z update_id ketma-ketligi; offset'dan kichiklari tasdiqlangan → unutiladi */
function offsetTelegram() {
  const bots = new Map();
  const calls = [];
  let mid = 1;
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
  async function fetchImpl(url, init = {}) {
    const m = /\/bot([^/]+)\/(\w+)$/.exec(new URL(url).pathname);
    const b = m && bots.get(m[1]);
    if (!b) return json({ ok: false, error_code: 401, description: 'Unauthorized' }, 401);
    const method = m[2];
    const p = init.body ? JSON.parse(init.body) : {};
    calls.push({ bot: b.id, method, params: p });
    if (method === 'getMe') return json({ ok: true, result: { id: b.id, is_bot: true, first_name: 'B', username: b.username } });
    if (method === 'getUpdates') {
      const offset = Number(p.offset || 0);
      if (offset > 0) b.queue = b.queue.filter((u) => u.update_id >= offset);
      const out = b.queue.filter((u) => u.update_id >= offset);
      if (out.length) return json({ ok: true, result: out });
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 10);
        init.signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
      });
      return json({ ok: true, result: [] });
    }
    if (method === 'sendMessage') return json({ ok: true, result: { message_id: mid++, date: 1, chat: { id: p.chat_id, type: 'private' }, text: p.text } });
    return json({ ok: true, result: true });
  }
  return {
    fetchImpl, calls,
    add: (token, id, username) => bots.set(token, { id, username, queue: [] }),
    push: (token, update) => bots.get(token).queue.push(update),
  };
}
const startUpd = (id, chat) => ({ update_id: id, message: { message_id: id, date: 1, chat: { id: chat, type: 'private' }, from: { id: chat, is_bot: false, first_name: 'T' }, text: '/start' } });

test('#14 polling offset bot id’ga bog‘liq: token boshqa botga almashsa yangi bot update’larni oladi, o‘sha bot qayta ishga tushsa offset saqlanadi', async () => {
  const app = await makeApp();
  const tg = offsetTelegram();
  const OLD = '111:OLD-rahbar', NEW = '222:NEW-rahbar';
  tg.add(OLD, 111, 'eski_bot');
  tg.add(NEW, 222, 'utax_rahbar_bot');
  const all = [];
  const run = async (token) => { const b = await startBots(app, { tokens: { rahbar: token }, ...botsOpts(tg.fetchImpl, { mode: 'polling' }) }); all.push(b); return b; };
  try {
    // 1) eski yagona bot (TELEGRAM_BOT_TOKEN → rahbar), update_id ~800 mln
    tg.push(OLD, startUpd(800000000, 5140001));
    let bots = await run(OLD);
    assert.ok(await until(() => bots.state.get('offset:rahbar') === '800000001'), 'eski bot offseti yozildi');
    await bots.stop();

    // 2) BOT_RAHBAR_TOKEN yangi @utax_rahbar_bot ga o'rnatildi (update_id ~300 mln)
    tg.push(NEW, startUpd(300000000, 5140002));
    tg.push(NEW, startUpd(300000001, 5140002));
    bots = await run(NEW);
    const ok = await until(() => bots.get('rahbar').handled >= 2);
    const first = tg.calls.find((c) => c.bot === 222 && c.method === 'getUpdates');
    assert.ok(ok, `yangi bot "kar": handled=${bots.get('rahbar').handled}, birinchi offset=${first?.params.offset}`);
    assert.equal(first.params.offset, 0, 'boshqa botning offseti ishlatilmadi');
    assert.ok(await until(() => bots.state.get('offset:rahbar') === '300000002'));
    await bots.stop();

    // 3) o'sha bot qayta ishga tushdi — saqlangan offset'dan davom etadi (qayta ishlanmaydi)
    const from = tg.calls.length;
    bots = await run(NEW);
    assert.ok(await until(() => tg.calls.slice(from).some((c) => c.method === 'getUpdates')));
    assert.equal(tg.calls.slice(from).find((c) => c.method === 'getUpdates').params.offset, 300000002);
    assert.equal(bots.get('rahbar').handled, 0);
  } finally {
    for (const b of all) await b.stop();
  }
});

test('#14 eski (bot id’siz) offset yozuvi: boshqa botniki bo‘lishi mumkin — 0 dan boshlanadi, bot id belgilanadi', async () => {
  const app = await makeApp();
  const tg = offsetTelegram();
  const NEW = '333:NEW-signal';
  tg.add(NEW, 333, 'utax_signal_bot');
  app.db.run("INSERT INTO bot_state (key, value, updated_at) VALUES ('offset:signal', '999999999', ?)", new Date().toISOString());
  tg.push(NEW, startUpd(1000, 5140003));
  const bots = await startBots(app, { tokens: { signal: NEW }, ...botsOpts(tg.fetchImpl, { mode: 'polling' }) });
  try {
    assert.ok(await until(() => bots.get('signal').handled >= 1), 'eski offset yangi botni kar qilmadi');
    assert.equal(tg.calls.find((c) => c.method === 'getUpdates').params.offset, 0);
    assert.equal(bots.state.get('offset-bot:signal'), '333');
    assert.ok(await until(() => bots.state.get('offset:signal') === '1001'));
  } finally {
    await bots.stop();
  }
});

// ---------- #15 ----------
test('#15 getMe tarmoq xatosi: startBots bloklanmaydi, fon rejimida qayta urinadi, tarmoq tiklangach polling boshlanadi', async () => {
  const app = await makeApp();
  const tg = createFakeTelegram(TEST_TOKENS);
  let down = true;
  let getMe = 0;
  const fetchImpl = slowUpdates(async (url, init) => {
    if (/\/getMe$/.test(url)) getMe++;
    if (down) throw new TypeError('fetch failed (ENOTFOUND api.telegram.org)');
    return tg.fetchImpl(url, init);
  });
  const t0 = Date.now();
  const bots = await startBots(app, { tokens: { signal: TEST_TOKENS.signal }, ...botsOpts(fetchImpl, { mode: 'polling', startRetry: { minMs: 20, maxMs: 40 } }) });
  try {
    assert.ok(Date.now() - t0 < 1000, 'startBots qayta urinishlarni kutmaydi');
    let st = bots.status().find((s) => s.key === 'signal');
    assert.equal(st.running, false);
    assert.match(st.last_error, /^init: .*fetch failed.*qayta urinish/, st.last_error);
    assert.ok(st.next_retry_at, 'keyingi urinish vaqti holatda');
    assert.ok(await until(() => getMe >= 6), 'fon rejimida qayta urinmoqda'); // har urinish = 3 fetch (api retries)
    assert.equal(bots.get('signal').running, false);
    down = false;
    assert.ok(await until(() => bots.get('signal').running), 'tarmoq tiklangach ishga tushdi');
    assert.ok(await until(() => tg.calls.some((c) => c.bot === 'signal' && c.method === 'getUpdates')), 'polling boshlandi');
    st = bots.status().find((s) => s.key === 'signal');
    assert.equal(st.last_error, null);
    assert.equal(st.next_retry_at, null);
    assert.ok(st.started_at);
    // ishlayotgan bot orqali yuborish ham tiklandi
    const ceo = app.db.get("SELECT id FROM users WHERE email='ceo@utax.uz'").id;
    app.db.run('UPDATE users SET telegram_user_id=? WHERE id=?', '5150001', ceo);
    assert.equal((await bots.send('signal', ceo, 'salom')).ok, true);
  } finally {
    const s0 = Date.now();
    await bots.stop();
    assert.ok(Date.now() - s0 < 1000, 'stop() tez');
  }
});

test('#15 401 (token yaroqsiz) — qayta urinilmaydi; stop() qayta urinish kutilayotganda ham tez', async () => {
  const app = await makeApp();
  const tg = createFakeTelegram(TEST_TOKENS);
  let getMe = 0;
  const fetchImpl = async (url, init) => { if (/\/getMe$/.test(url)) getMe++; return tg.fetchImpl(url, init); };
  const bots = await startBots(app, { tokens: { rahbar: '4040:YAROQSIZ' }, ...botsOpts(fetchImpl, { mode: 'polling', startRetry: { minMs: 10, maxMs: 20 } }) });
  try {
    await wait(80);
    const st = bots.status().find((s) => s.key === 'rahbar');
    assert.equal(st.running, false);
    assert.equal(getMe, 1, 'bir marta urinildi');
    assert.match(st.last_error, /401/);
    assert.doesNotMatch(st.last_error, /qayta urinish/);
  } finally {
    await bots.stop();
  }

  // tarmoq uzoq yo'q: qayta urinish kutilayotganda stop()
  const bots2 = await startBots(app, { tokens: { rahbar: TEST_TOKENS.rahbar }, ...botsOpts(async () => { throw new TypeError('fetch failed'); }, { mode: 'polling', startRetry: { minMs: 60000, maxMs: 60000 } }) });
  const s0 = Date.now();
  await bots2.stop();
  assert.ok(Date.now() - s0 < 500, `stop() ${Date.now() - s0} ms`);
});

test('#15 webhook: setWebhook 5xx → qayta urinib o‘rnatadi; PUBLIC_URL https emas → urinmaydi (sozlama xatosi)', async () => {
  const app = await makeApp();
  const tg = createFakeTelegram(TEST_TOKENS);
  tg.fail({ method: 'setWebhook', code: 502, description: 'Bad Gateway', times: 3 }); // birinchi urinish (3 ta so'rov) yiqiladi
  const opts = { mode: 'webhook', webhookSecret: 'sir-15', startRetry: { minMs: 20, maxMs: 40 } };
  const bots = await startBots(app, { tokens: { rahbar: TEST_TOKENS.rahbar }, ...botsOpts(tg.fetchImpl, { ...opts, publicUrl: 'https://crm.utax.test' }) });
  try {
    assert.equal(bots.get('rahbar').running, false);
    assert.match(bots.status()[0].last_error, /^webhook: .*502.*qayta urinish/);
    assert.ok(await until(() => bots.get('rahbar').running), 'webhook qayta urinishda o‘rnatildi');
    assert.ok(tg.calls.some((c) => c.method === 'setWebhook' && !c.failed && c.params.url === 'https://crm.utax.test/telegram/rahbar'));
    assert.equal(tg.calls.filter((c) => c.method === 'getMe').length, 1, 'init qayta chaqirilmaydi — faqat setWebhook');
  } finally {
    await bots.stop();
  }

  const tg2 = createFakeTelegram(TEST_TOKENS);
  const b2 = await startBots(app, { tokens: { rahbar: TEST_TOKENS.rahbar }, ...botsOpts(tg2.fetchImpl, { ...opts, publicUrl: 'http://crm.utax.test' }) });
  try {
    await wait(60);
    assert.equal(b2.get('rahbar').running, false);
    assert.match(b2.status()[0].last_error, /PUBLIC_URL/);
    assert.equal(tg2.calls.filter((c) => c.method === 'setWebhook').length, 0);
    assert.equal(tg2.calls.filter((c) => c.method === 'getMe').length, 1, 'sozlama xatosida qayta urinilmaydi');
  } finally {
    await b2.stop();
  }
});

// ---------- #16 ----------
test('#16 muddati o‘tgan dialogga javob AI’ga ketmaydi: runtime purge’dan keyin ham «⌛ muddati tugagan» chiqadi', async () => {
  const emp = H.link('employee@utax.uz');
  const key = `sorov:${emp}`;
  await H.send('sorov', emp, '/yangi');
  await H.send('sorov', emp, '12 500 000');
  assert.equal(H.app.bots.dialogs.get(key)?.step, 'purpose');
  H.db.run('UPDATE bot_dialogs SET expires_at=? WHERE key=?', new Date(Date.now() - 60e3).toISOString(), key);
  assert.equal(H.app.bots.dialogs.purgeExpired(), 0, 'grace ichida — o‘chirilmaydi'); // runtime har daqiqada yurgizadi
  const spy = spyAi();
  try {
    const r = await H.send('sorov', emp, 'Oktabr uchun Telegram Ads reklama kampaniyasi');
    assert.deepEqual(r.texts, [T.staleDialog], 'faqat ogohlantirish');
    assert.equal(spy.calls.length, 0, 'dialog javobi LLM’ga ketmadi');
    assert.equal(H.db.get('SELECT key FROM bot_dialogs WHERE key=?', key), null, 'ogohlantirish bir marta');
    await H.send('sorov', emp, 'Mening so‘rovlarim qanday holatda?');
    assert.equal(spy.calls.length, 1, 'keyingi erkin matn — odatdagidek AI');
    // fayl ham eskirgan dialogga tushmaydi
    await H.send('sorov', emp, '/yangi');
    H.db.run('UPDATE bot_dialogs SET expires_at=? WHERE key=?', new Date(Date.now() - 60e3).toISOString(), key);
    const f = await H.photo('sorov', emp);
    assert.deepEqual(f.texts, [T.staleDialog]);
  } finally {
    spy.restore();
  }
});

test('#16 purgeExpired: faqat 24 soatdan (grace) oldin tugaganlar o‘chiriladi; get() eskirganni bir marta xabar qiladi', () => {
  const d = createDialogStore(H.db);
  assert.equal(STALE_GRACE_MS, 24 * 3600e3);
  d.set('t16:1', { name: 'a', step: 's', data: {} });
  d.set('t16:2', { name: 'a', step: 's', data: {} });
  H.db.run("UPDATE bot_dialogs SET expires_at=? WHERE key='t16:1'", new Date(Date.now() - 60e3).toISOString());
  H.db.run("UPDATE bot_dialogs SET expires_at=? WHERE key='t16:2'", new Date(Date.now() - STALE_GRACE_MS - 60e3).toISOString());
  assert.equal(d.purgeExpired(), 1);
  assert.deepEqual(d.get('t16:1'), { expired: true });
  assert.equal(d.get('t16:1'), null);
  assert.equal(d.get('t16:2'), null);
});

// ---------- L4 ----------
test('L4 noto‘g‘ri yozilgan yoki ruxsatsiz buyruq ochiq dialogni o‘chirmaydi; ruxsatli buyruq — yopadi', async () => {
  const emp = H.link('employee@utax.uz');
  const key = `sorov:${emp}`;
  await H.send('sorov', emp, '/yangi');
  await H.send('sorov', emp, '12 500 000');
  let r = await H.send('sorov', emp, '/bekr');
  assert.match(r.text, /buyrug‘i bu botda yo‘q/);
  assert.match(r.text, /Ochiq amal saqlanib qoldi/);
  assert.equal(H.app.bots.dialogs.get(key)?.step, 'purpose', 'typo dialogni o‘chirmadi');
  assert.equal(H.app.rbac.can(H.user('employee@utax.uz'), 'approvals', 'APPROVE'), false);
  r = await H.send('sorov', emp, '/tasdiqlash');
  assert.match(r.text, /Ruxsat yo‘q/);
  assert.equal(H.app.bots.dialogs.get(key)?.step, 'purpose', 'ruxsatsiz buyruq dialogni o‘chirmadi');
  await H.click('sorov', emp, 'cmd:tasdiqlash'); // menyu tugmasi orqali ham
  assert.equal(H.app.bots.dialogs.get(key)?.step, 'purpose');
  r = await H.send('sorov', emp, 'Oktabr uchun Telegram Ads reklama kampaniyasi');
  assert.match(r.text, /Kategoriya/, 'dialog davom etdi');
  await H.send('sorov', emp, '/sorovlarim'); // ruxsatli boshqa buyruq
  assert.equal(H.app.bots.dialogs.get(key), null, 'ruxsatli buyruq dialogni yopdi');
  // /bekor — faqat amal qilayotgan dialog uchun «bekor qilindi»
  await H.send('sorov', emp, '/yangi');
  H.db.run('UPDATE bot_dialogs SET expires_at=? WHERE key=?', new Date(Date.now() - 60e3).toISOString(), key);
  assert.match((await H.send('sorov', emp, '/bekor')).text, /Bekor qilinadigan ochiq amal yo‘q/);
});

// ---------- L5 ----------
test('L5 eski xabardagi «✖️ Bekor» joriy (boshqa) dialogni o‘chirmaydi; o‘z dialogining tugmasi bekor qiladi; teg’siz eski format', async () => {
  const emp = H.link('employee@utax.uz');
  const key = `sorov:${emp}`;
  const r1 = await H.send('sorov', emp, '/yangi');
  const oldX = r1.button(/Bekor/).callback_data;
  assert.match(oldX, /^x:[0-9a-f]{6}$/, oldX);
  assert.equal(oldX, `x:${dialogTag(H.app.bots.dialogs.get(key))}`);
  await H.send('sorov', emp, '/yangi 3 mln');
  const r3 = await H.send('sorov', emp, 'Oktabr uchun Telegram Ads reklama kampaniyasi');
  assert.equal(H.app.bots.dialogs.get(key)?.step, 'category');
  const curX = r3.button(/Bekor/).callback_data;
  assert.notEqual(curX, oldX);
  assert.ok(Buffer.byteLength(curX) <= 64);

  let c = await H.click('sorov', emp, oldX, { messageId: r1.last.message_id });
  assert.equal(H.app.bots.dialogs.get(key)?.step, 'category', 'eski tugma yangi dialogni o‘chirmadi');
  assert.match(c.answers[0].text, /eskirgan/);
  assert.ok(c.method('editMessageReplyMarkup').some((p) => p.message_id === r1.last.message_id && !p.reply_markup), 'eski xabar tugmalari olib tashlandi');

  c = await H.click('sorov', emp, 'x'); // deploydan oldingi xabarlar / dialogdan tashqari tugma (teg'siz)
  assert.equal(H.app.bots.dialogs.get(key)?.step, 'category', 'teg’siz x ochiq dialogni o‘chirmaydi');
  assert.match(c.answers[0].text, /\/bekor/);

  c = await H.click('sorov', emp, curX, { messageId: r3.last.message_id });
  assert.equal(H.app.bots.dialogs.get(key), null, 'o‘z dialogining tugmasi bekor qildi');
  assert.match(c.answers[0].text, /Bekor qilindi/);

  c = await H.click('sorov', emp, 'x');
  assert.equal(c.answers[0].text, 'Yopildi', 'dialog yo‘q — faqat tugmalar yopiladi');
  c = await H.click('sorov', emp, curX);
  assert.equal(c.answers[0].text, 'Yopildi');
});

test('L5 buxgalter /kassa (handler o‘zgarmagan, cb:"x") — factory tugmani joriy dialog tegi bilan yuboradi', async () => {
  const acc = H.link('accountant@utax.uz');
  const r = await H.send('buxgalter', acc, '/kassa');
  const x = r.button(/Bekor/).callback_data;
  assert.equal(x, `x:${dialogTag(H.app.bots.dialogs.get(`buxgalter:${acc}`))}`);
  const c = await H.click('buxgalter', acc, x, { messageId: r.last.message_id });
  assert.match(c.answers[0].text, /Bekor qilindi/);
  assert.equal(H.app.bots.dialogs.get(`buxgalter:${acc}`), null);
  // dialogdan tashqari yuborilgan x (masalan AI tasdiq qatori) — teg'siz qoladi
  const ceo = H.link('ceo@utax.uz');
  const e = H.S.expenses.request({ amount: 151234999, purpose: 'L5 AI tasdiq qatori' }, ctxOf('accountant@utax.uz'));
  H.S.approvals.decide(e.approval_id, 'APPROVE', ctxOf('cfo@utax.uz'), 'web');
  const ai = await H.send('rahbar', ceo, '151234999 so‘mlik so‘rovni tasdiqla');
  const bx = ai.buttons.find((b) => /Bekor/.test(b.text));
  assert.ok(bx, ai.text);
  assert.equal(bx.callback_data, 'x', 'dialog yo‘q — teg qo‘shilmaydi');
});

// ---------- L7 ----------
test('L7 rad etish sababi: so‘rov shu orada keyingi qadamga o‘tsa dialog yopiladi, keyingi matn xato bilan qaytmaydi', async () => {
  const cfo = H.link('cfo@utax.uz');
  const key = `rahbar:${cfo}`;
  const e = H.S.expenses.request({ amount: 151234001, purpose: 'L7 server uskunasi' }, ctxOf('accountant@utax.uz'));
  const id = e.approval_id;
  const card = await H.click('rahbar', cfo, `apr:no:${id}`, { messageId: 4242 });
  assert.match(card.text, /rad etish sababini/);
  assert.equal(H.app.bots.dialogs.get(key)?.name, 'apr.reject');
  H.S.approvals.decide(id, 'APPROVE', ctxOf('cfo@utax.uz'), 'web orqali'); // shu orada web'da (CFO qadami → CEO)
  let r = await H.send('rahbar', cfo, 'Byudjetda yo‘q');
  assert.equal(H.app.bots.dialogs.get(key), null, 'dialog yopildi');
  assert.match(r.text, /Rad etish oynasi yopildi/);
  assert.doesNotMatch(r.text, /Approval yakunlangan|Xatolik/);
  assert.ok(r.method('editMessageText').some((p) => p.message_id === 4242 && !p.reply_markup), 'eski karta yangilandi, tugmalarsiz');
  assert.equal(H.S.approvals.get(id).status, 'PENDING', 'rad etilmadi');
  const spy = spyAi();
  try {
    r = await H.send('rahbar', cfo, 'Bugun kassada qancha pul bor?');
    assert.equal(spy.calls.length, 1, 'keyingi matn AI’ga (rad etish sababi emas)');
  } finally {
    spy.restore();
  }
});

test('L7 so‘rov yakunlangan: matn ham, tayyor sabab tugmasi (aprr) ham dialogni yopadi; ochiq so‘rovda odatdagidek rad etiladi', async () => {
  const cfo = H.link('cfo@utax.uz');
  const key = `rahbar:${cfo}`;
  const e1 = H.S.expenses.request({ amount: 151234002, purpose: 'L7 yakunlangan 1' }, ctxOf('accountant@utax.uz'));
  await H.click('rahbar', cfo, `apr:no:${e1.approval_id}`);
  H.S.approvals.decide(e1.approval_id, 'REJECT', ctxOf('cfo@utax.uz'), 'web');
  let r = await H.send('rahbar', cfo, 'ok');
  assert.equal(H.app.bots.dialogs.get(key), null);
  assert.match(r.text, /allaqachon hal qilingan/);

  const e2 = H.S.expenses.request({ amount: 151234003, purpose: 'L7 yakunlangan 2' }, ctxOf('accountant@utax.uz'));
  await H.click('rahbar', cfo, `apr:no:${e2.approval_id}`);
  H.S.approvals.decide(e2.approval_id, 'REJECT', ctxOf('cfo@utax.uz'), 'web');
  r = await H.click('rahbar', cfo, `aprr:${e2.approval_id}:1`);
  assert.equal(H.app.bots.dialogs.get(key), null, 'aprr xato bersa ham dialog yopiladi');
  assert.match(r.answers[0].text, /hal qilingan/);

  const e3 = H.S.expenses.request({ amount: 151234004, purpose: 'L7 ochiq' }, ctxOf('accountant@utax.uz'));
  await H.click('rahbar', cfo, `apr:no:${e3.approval_id}`);
  r = await H.send('rahbar', cfo, 'ab');
  assert.match(r.text, /kamida 3 belgi/);
  assert.equal(H.app.bots.dialogs.get(key)?.name, 'apr.reject', 'qisqa sabab — dialog saqlanadi');
  r = await H.send('rahbar', cfo, 'Byudjetda ko‘zda tutilmagan');
  assert.match(r.text, /rad etildi/);
  assert.equal(H.S.approvals.get(e3.approval_id).status, 'REJECTED');
  assert.equal(H.app.bots.dialogs.get(key), null);
});

// ---------- docs ----------
test('docs/BOTS.md: egalar qoidasi (FOUNDER ga ko‘tarilmaydi, OWNER_RELINKED) va signal /test — notifications EDIT', () => {
  const md = fs.readFileSync(path.join(ROOT, 'docs', 'BOTS.md'), 'utf8');
  assert.ok(!/FOUNDER` ga ko'tariladi|OWNER_ROLE_ENFORCED` audit\)/.test(md), 'eski qoida («rol FOUNDER ga ko‘tariladi») qolmadi');
  assert.ok(/OWNER_RELINKED/.test(md), 'OWNER_RELINKED audit');
  assert.ok(/tg<id>@owner\.utax\.uz/.test(md), 'egasining alohida hisobi');
  assert.ok(/faqat[^\n]*FOUNDER[^\n]*hisob/.test(md), 'ega /start KOD — faqat FOUNDER hisob');
  assert.ok(/tasdiq kartasi/.test(md), 'bog‘lanishni almashtirish — tasdiq kartasi');
  assert.ok(/\| `\/test` \| notifications EDIT \|/.test(md), 'signal /test — notifications EDIT');
});
