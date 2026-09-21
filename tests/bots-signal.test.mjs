/** @utax_signal_bot — bildirishnomalar markazi: yetkazish, zaxira bot, sozlamalar, jim soat, quti va tarix. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBotHarness } from './helpers/bot-harness.mjs';
import { money } from '../src/bots/shared/format.mjs';
import { tashkentHHMM, ALERT_TYPES } from '../src/modules/notifications.mjs';

/** Yangi muhit: foydalanuvchi bog'langan va (ixtiyoriy) signal botni ochgan */
async function muhit(email = 'finance@utax.uz', { signal = true } = {}) {
  const H = await createBotHarness();
  const tgId = H.link(email);
  if (signal) H.started('signal', email);
  return { H, tgId, u: H.user(email) };
}
const tgQator = (H, crmId) => H.db.get("SELECT * FROM notifications WHERE parent_id=? AND channel='TELEGRAM'", crmId);
const xabarlar = (H, start, tgId) => H.tg.calls.slice(start).filter((c) => c.method === 'sendMessage' && String(c.params.chat_id) === String(tgId));
const tugmalar = (call) => (call?.params.reply_markup?.inline_keyboard || []).flat();
/** Hozir jim bo'ladigan oraliq (±5 daqiqa, yarim tundan o'tsa ham to'g'ri) */
const hozirJim = () => ({ from: tashkentHHMM(new Date(Date.now() - 5 * 60e3)), to: tashkentHHMM(new Date(Date.now() + 5 * 60e3)) });
const ogohlantirish = (H, u, extra = {}) => H.S.notifications.notify({ user_ids: [u.id], type: 'PAYMENT_OVERDUE', severity: 'WARNING', title: 'Muddati o‘tdi <UTAX-R-00001>', body: 'Qarz 5 000 000 so‘m', ...extra });

test('notify() → TELEGRAM qator yaratiladi va signal orqali yuboriladi (sent_at, bot_key, tg_message_id)', async () => {
  const { H, tgId, u } = await muhit();
  const start = H.tg.calls.length;
  const [crmId] = ogohlantirish(H, u, { entity_type: 'contract', entity_id: 1 });
  await H.app.bots.flush();
  const row = tgQator(H, crmId);
  assert.ok(row, 'TELEGRAM qator bor');
  assert.equal(row.bot_key, 'signal');
  assert.ok(row.sent_at, 'yuborilgan');
  assert.equal(row.tg_chat_id, String(tgId));
  const [msg] = xabarlar(H, start, tgId);
  assert.equal(msg.bot, 'signal');
  assert.equal(String(msg.result.message_id), row.tg_message_id);
  assert.match(msg.params.text, /Muddati o‘tdi &lt;UTAX-R-00001&gt;/, 'HTML escape');
  const kb = tugmalar(msg);
  assert.ok(kb.some((b) => b.callback_data === `nr:${crmId}`), '✅ Ko‘rildi');
  assert.ok(kb.some((b) => b.web_app?.url === 'https://crm.utax.test/?tgp=contracts%2F1'), '🌐 Ochish → shartnoma');
});

test('APPROVAL_WAITING: navbatdagi foydalanuvchiga ✅/❌ tugmalari, qadam egasi bo‘lmaganga — yo‘q', async () => {
  const H = await createBotHarness();
  const head = H.link('head.marketing@utax.uz'); H.started('signal', 'head.marketing@utax.uz');
  const cfo = H.link('cfo@utax.uz'); H.started('signal', 'cfo@utax.uz');
  const emp = { user: H.user('employee@utax.uz'), ip: 'test', source: 'TEST' };
  let start = H.tg.calls.length;
  const e = H.S.expenses.request({ amount: 8e6, purpose: 'Signal test: reklama kampaniyasi' }, emp);
  await H.app.bots.flush();
  const [toHead] = xabarlar(H, start, head);
  assert.ok(toHead, 'bo‘lim rahbariga keldi');
  const kb = tugmalar(toHead);
  assert.ok(kb.some((b) => b.callback_data === `apr:ok:${e.approval_id}`));
  assert.ok(kb.some((b) => b.callback_data === `apr:no:${e.approval_id}`));
  // CFO bu qadamni (DEPARTMENT_HEAD) tasdiqlay olmaydi — tugma chiqmasligi kerak
  start = H.tg.calls.length;
  H.S.notifications.notify({ user_ids: [H.user('cfo@utax.uz').id], type: 'APPROVAL_WAITING', title: 'Tasdiq kutilmoqda', entity_type: 'approval', entity_id: e.approval_id });
  await H.app.bots.flush();
  const [toCfo] = xabarlar(H, start, cfo);
  const kb2 = tugmalar(toCfo);
  assert.ok(!kb2.some((b) => /^apr:/.test(b.callback_data || '')), 'CFO uchun tasdiq tugmasi yo‘q');
  assert.ok(kb2.some((b) => /^nr:/.test(b.callback_data || '')));
});

test('Sozlamada tur o‘chirilsa — CRM yozuvi bor, TELEGRAM qator yaratilmaydi', async () => {
  const { H, u } = await muhit();
  H.S.notifications.setPrefs(u.id, { types: { PAYMENT_OVERDUE: false } }, { user: u, source: 'TEST' });
  const [crmId] = ogohlantirish(H, u);
  await H.app.bots.flush();
  assert.ok(H.db.get("SELECT id FROM notifications WHERE id=? AND channel='CRM'", crmId), 'CRM bor');
  assert.equal(tgQator(H, crmId), null, 'TELEGRAM yo‘q');
  // boshqa tur hali ham keladi
  const [id2] = H.S.notifications.notify({ user_ids: [u.id], type: 'LOW_LIQUIDITY', severity: 'WARNING', title: 'Likvidlik' });
  await H.app.bots.flush();
  assert.ok(tgQator(H, id2)?.sent_at);
});

test('Jim soat: TELEGRAM qator navbatda qoladi (sent_at NULL), Telegram’ga hech narsa ketmaydi', async () => {
  const { H, tgId, u } = await muhit();
  H.S.notifications.setPrefs(u.id, { quiet: hozirJim() }, { user: u, source: 'TEST' });
  const start = H.tg.calls.length;
  const [crmId] = ogohlantirish(H, u);
  await H.app.bots.flush();
  const row = tgQator(H, crmId);
  assert.ok(row, 'qator bor');
  assert.equal(row.sent_at, null);
  assert.equal(xabarlar(H, start, tgId).length, 0);
});

test('CRITICAL jim soatni yorib o‘tadi', async () => {
  const { H, tgId, u } = await muhit();
  H.S.notifications.setPrefs(u.id, { quiet: hozirJim() }, { user: u, source: 'TEST' });
  const start = H.tg.calls.length;
  const [crmId] = H.S.notifications.notify({ user_ids: [u.id], type: 'LOW_LIQUIDITY', severity: 'CRITICAL', title: 'Likvidlik past!' });
  await H.app.bots.flush();
  assert.ok(tgQator(H, crmId).sent_at);
  assert.match(xabarlar(H, start, tgId)[0].params.text, /🔴 <b>Likvidlik past!<\/b>/);
});

test('retryPending(): jim soat olib tashlangach navbatdagi xabar yuboriladi', async () => {
  const { H, tgId, u } = await muhit();
  H.S.notifications.setPrefs(u.id, { quiet: hozirJim() }, { user: u, source: 'TEST' });
  const [crmId] = ogohlantirish(H, u);
  await H.app.bots.flush();
  let res = await H.app.bots.retryPending();
  assert.equal(tgQator(H, crmId).sent_at, null, 'jim soatda retry ham yubormaydi');
  H.S.notifications.setPrefs(u.id, { quiet: null }, { user: u, source: 'TEST' });
  const start = H.tg.calls.length;
  res = await H.app.bots.retryPending();
  assert.ok(res.sent >= 1);
  assert.ok(tgQator(H, crmId).sent_at);
  assert.equal(xabarlar(H, start, tgId).length, 1);
});

test('Signal 403 → foydalanuvchi ochgan boshqa bot (sorov) orqali yetkaziladi, signal bloklangan deb belgilanadi', async () => {
  const { H, tgId, u } = await muhit('employee@utax.uz');
  H.started('sorov', 'employee@utax.uz');
  H.tg.fail({ method: 'sendMessage', bot: 'signal', code: 403, description: 'Forbidden: bot was blocked by the user' });
  const start = H.tg.calls.length;
  const [crmId] = H.S.notifications.notify({ user_ids: [u.id], type: 'APPROVAL_DECIDED', title: '✅ Tasdiqlandi: EXP-1' });
  await H.app.bots.flush();
  const row = tgQator(H, crmId);
  assert.ok(row.sent_at);
  assert.equal(row.bot_key, 'sorov');
  const msgs = xabarlar(H, start, tgId);
  assert.deepEqual(msgs.map((m) => m.bot), ['signal', 'sorov']);
  assert.ok(H.db.get("SELECT blocked_at FROM bot_chats WHERE bot_key='signal' AND chat_id=?", String(tgId)).blocked_at, 'signal bloklangan');
});

test('Hech bir bot ochilmagan + 403 → xato yoziladi, attempts oshadi, keyinroq qayta urinish', async () => {
  const { H, u } = await muhit('employee@utax.uz', { signal: false });
  H.tg.fail({ method: 'sendMessage', bot: 'signal', code: 403, description: "Forbidden: bot can't initiate conversation with a user" });
  const [crmId] = ogohlantirish(H, u);
  await H.app.bots.flush();
  const row = tgQator(H, crmId);
  assert.equal(row.sent_at, null);
  assert.equal(row.attempts, 1);
  assert.match(row.error, /\/start/);
  assert.ok(row.next_try_at > new Date().toISOString(), 'backoff');
});

test('Telegram umuman o‘chirilgan (notifications.telegram_enabled=false) → TELEGRAM qator yo‘q; /test sababini aytadi', async () => {
  const { H, tgId, u } = await muhit();
  H.app.settings.set('notifications.telegram_enabled', false);
  const [crmId] = ogohlantirish(H, u);
  await H.app.bots.flush();
  assert.equal(tgQator(H, crmId), null);
  const r = await H.send('signal', tgId, '/test');
  assert.match(r.text, /tizimda o‘chirilgan/);
});

test('✅ Ko‘rildi (nr:) tugmasi web’dagi CRM bildirishnomasini o‘qilgan qiladi', async () => {
  const { H, tgId, u } = await muhit();
  const [crmId] = ogohlantirish(H, u);
  await H.app.bots.flush();
  const row = tgQator(H, crmId);
  const r = await H.click('signal', tgId, `nr:${crmId}`, { messageId: Number(row.tg_message_id) });
  assert.equal(H.db.get('SELECT is_read FROM notifications WHERE id=?', crmId).is_read, 1);
  assert.equal(r.answers[0].text, '✅ O‘qilgan deb belgilandi');
  assert.equal(r.method('editMessageReplyMarkup').length, 1);
});

test('/oqilmagan: ro‘yxat va raqam tugmalari; g.all hammasini o‘qiydi', async () => {
  const { H, tgId, u } = await muhit();
  H.S.notifications.markRead(u.id, { all: true });
  for (let k = 1; k <= 3; k++) H.S.notifications.notify({ user_ids: [u.id], type: 'REMINDER', title: `Eslatma ${k}` });
  await H.app.bots.flush();
  let r = await H.send('signal', tgId, '/oqilmagan');
  assert.match(r.text, /O‘qilmagan: 3 ta/);
  assert.match(r.text, /Eslatma 1/);
  assert.equal(r.buttons.filter((b) => /^g\.o:\d+$/.test(b.callback_data || '')).length, 3);
  assert.ok(r.button(/Hammasini o‘qilgan/));
  r = await H.click('signal', tgId, 'g.all');
  assert.equal(H.S.notifications.unreadCount(u.id), 0);
  assert.match(r.answers[0].text, /3 ta o‘qildi/);
  r = await H.send('signal', tgId, '/oqilmagan');
  assert.match(r.text, /O‘qilmagan bildirishnoma yo‘q/);
});

test('g.o: o‘z bildirishnomasi — to‘liq karta; boshqaning id si — topilmadi (karta yuborilmaydi)', async () => {
  const { H, tgId, u } = await muhit();
  const boshqa = H.user('cfo@utax.uz');
  const [begona] = H.S.notifications.notify({ user_ids: [boshqa.id], type: 'REMINDER', title: 'Maxfiy: CFO uchun' });
  const [oz] = H.S.notifications.notify({ user_ids: [u.id], type: 'REMINDER', title: 'Mening eslatmam', entity_type: 'expense', entity_id: 3 });
  await H.app.bots.flush();
  let r = await H.click('signal', tgId, `g.o:${begona}`);
  assert.equal(r.answers[0].text, 'Bildirishnoma topilmadi');
  assert.equal(r.answers[0].show_alert, true);
  assert.equal(r.method('sendMessage').length, 0);
  r = await H.click('signal', tgId, `g.o:${oz}`);
  assert.match(r.text, /Mening eslatmam/);
  assert.ok(r.buttons.some((b) => b.callback_data === `nr:${oz}`));
  assert.ok(r.buttons.some((b) => /expenses%2F3/.test(b.web_app?.url || '')));
});

test('/bugun: daraja bo‘yicha soni; CFO — "Ishlatish mumkin" treasury bilan bir xil; xodimda moliya qatori yo‘q', async () => {
  const H = await createBotHarness();
  const cfoTg = H.link('cfo@utax.uz');
  const cfo = H.user('cfo@utax.uz');
  H.S.notifications.notify({ user_ids: [cfo.id], type: 'LOW_LIQUIDITY', severity: 'CRITICAL', title: 'Bugungi kritik signal' });
  await H.app.bots.flush();
  let r = await H.send('signal', cfoTg, '/bugun');
  assert.match(r.text, /🔴 Kritik: <b>\d+<\/b>/);
  assert.match(r.text, /Bugungi kritik signal/);
  assert.ok(r.text.includes(`Ishlatish mumkin: <b>${money(H.S.reports.treasury().available_cash)}</b>`));
  assert.match(r.text, /Navbatingizdagi tasdiqlar: <b>\d+ ta<\/b>/);
  assert.match(r.text, new RegExp(`O‘qilmagan \\(jami\\): <b>${H.S.notifications.unreadCount(cfo.id)} ta</b>`));
  const empTg = H.link('employee@utax.uz');
  r = await H.send('signal', empTg, '/bugun');
  assert.doesNotMatch(r.text, /Ishlatish mumkin/, 'xodim kompaniya pulini ko‘rmaydi');
});

test('/tarix: 15 tadan sahifa, ▶️ tugmasi keyingi sahifani chizadi', async () => {
  const { H, tgId, u } = await muhit('employee@utax.uz');
  for (let k = 1; k <= 20; k++) H.S.notifications.notify({ user_ids: [u.id], type: 'REMINDER', title: `Tarix yozuvi ${k}` });
  await H.app.bots.flush();
  const jami = H.db.get("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND channel='CRM'", u.id).n;
  const sahifalar = Math.ceil(jami / 15);
  let r = await H.send('signal', tgId, '/tarix');
  assert.match(r.text, new RegExp(`jami ${jami} ta`));
  assert.match(r.text, new RegExp(`Sahifa 1/${sahifalar}`));
  assert.equal((r.text.match(/<b>Tarix yozuvi/g) || []).length, 15);
  const keyingi = r.button('▶️');
  assert.equal(keyingi.callback_data, 'g.h:1');
  r = await H.click('signal', tgId, keyingi.callback_data);
  assert.equal(r.method('editMessageText').length, 1);
  assert.match(r.text, new RegExp(`Sahifa 2/${sahifalar}`));
});

test('/sozlama: tur ✅/⬜ almashadi (web prefs bilan bir xil), hammasini yoqish/o‘chirish', async () => {
  const { H, tgId, u } = await muhit();
  let r = await H.send('signal', tgId, '/sozlama');
  assert.match(r.text, new RegExp(`${ALERT_TYPES.length}/${ALERT_TYPES.length}`));
  assert.ok(r.button('✅ Likvidlik past'));
  r = await H.click('signal', tgId, 'g.t:LOW_LIQUIDITY');
  assert.equal(H.S.notifications.prefs(u.id).types.find((t) => t.type === 'LOW_LIQUIDITY').telegram, false);
  assert.ok(r.button('⬜ Likvidlik past'), 'qayta chizildi');
  assert.equal(r.answers[0].text, 'Likvidlik past: o‘chirildi');
  r = await H.click('signal', tgId, 'g.t:LOW_LIQUIDITY');
  assert.equal(H.S.notifications.prefs(u.id).types.find((t) => t.type === 'LOW_LIQUIDITY').telegram, true);
  r = await H.click('signal', tgId, 'g.ta:off');
  assert.ok(H.S.notifications.prefs(u.id).types.every((t) => !t.telegram));
  r = await H.click('signal', tgId, 'g.ta:on');
  assert.ok(H.S.notifications.prefs(u.id).types.every((t) => t.telegram));
  r = await H.click('signal', tgId, 'g.t:NOMALUM');
  assert.equal(r.answers[0].show_alert, true);
  assert.ok(H.db.get("SELECT id FROM audit_logs WHERE action='NOTIFICATION_PREFS' AND entity_id=? AND source='TELEGRAM'", u.id), 'audit');
});

test('/sozlama: jim soat presetlari va o‘chirish', async () => {
  const { H, tgId, u } = await muhit();
  let r = await H.click('signal', tgId, 'g.q:2200-0800');
  let row = H.db.get('SELECT tg_quiet_from f, tg_quiet_to t FROM users WHERE id=?', u.id);
  assert.deepEqual([row.f, row.t], ['22:00', '08:00']);
  assert.match(r.text, /Jim soat: <b>22:00–08:00<\/b>/);
  assert.ok(r.button('● 🌙 22:00–08:00'), 'faol preset belgilangan');
  r = await H.click('signal', tgId, 'g.q:2300-0700');
  row = H.db.get('SELECT tg_quiet_from f, tg_quiet_to t FROM users WHERE id=?', u.id);
  assert.deepEqual([row.f, row.t], ['23:00', '07:00']);
  r = await H.click('signal', tgId, 'g.q:off');
  row = H.db.get('SELECT tg_quiet_from f, tg_quiet_to t FROM users WHERE id=?', u.id);
  assert.deepEqual([row.f, row.t], [null, null]);
  assert.match(r.text, /Jim soat: <b>o‘chiq<\/b>/);
  r = await H.click('signal', tgId, 'g.q:0000-2400');
  assert.equal(r.answers[0].show_alert, true);
});

test('/test: dispetcher orqali yetkaziladi va "✅ Yuborildi"; tur o‘chirilgan bo‘lsa sababini aytadi', async () => {
  const { H, tgId, u } = await muhit();
  let r = await H.send('signal', tgId, '/test');
  const msgs = r.by('signal').texts;
  assert.ok(msgs.some((t) => /🧪 Test bildirishnoma/.test(t)), 'test xabari keldi');
  assert.match(msgs.at(-1), /✅ Yuborildi/);
  H.S.notifications.setPrefs(u.id, { types: { DAILY_DIGEST: false } }, { user: u, source: 'TEST' });
  r = await H.send('signal', tgId, '/test');
  assert.match(r.text, /«Kunlik xulosa» turi o‘chirilgan/);
});

test('/test jim soatda — navbatda turibdi deb javob beradi', async () => {
  const { H, tgId, u } = await muhit();
  H.S.notifications.setPrefs(u.id, { quiet: hozirJim() }, { user: u, source: 'TEST' });
  const r = await H.send('signal', tgId, '/test');
  assert.match(r.text, /jim soat/);
  assert.ok(!r.texts.some((t) => /🧪 Test bildirishnoma/.test(t)));
});

test('AUDITOR: /bugun ishlaydi, /sozlama va sozlama tugmalari yopiq (notifications.EDIT yo‘q — web bilan bir xil)', async () => {
  const { H, tgId } = await muhit('auditor@utax.uz');
  let r = await H.send('signal', tgId, '/bugun');
  assert.match(r.text, /Bugun ·/);
  assert.ok(!r.button('⚙️ Sozlama'), 'sozlama tugmasi ko‘rsatilmaydi');
  r = await H.send('signal', tgId, '/sozlama');
  assert.match(r.text, /⛔ Ruxsat yo‘q/);
  r = await H.click('signal', tgId, 'g.t:LOW_LIQUIDITY');
  assert.equal(r.answers[0].text, '⛔ Bu amal uchun ruxsatingiz yo‘q.');
  assert.equal(r.answers[0].show_alert, true);
  r = await H.click('signal', tgId, 'g.all');
  assert.equal(r.answers[0].show_alert, true);
});

test('/start: o‘qilmaganlar soni, jim soat va o‘chirilgan turlar; /yordam tugmalar izohini beradi', async () => {
  const { H, tgId, u } = await muhit();
  H.S.notifications.setPrefs(u.id, { types: { REMINDER: false, AI_ACTION: false }, quiet: { from: '22:00', to: '08:00' } }, { user: u, source: 'TEST' });
  let r = await H.send('signal', tgId, '/start');
  assert.match(r.text, new RegExp(`O‘qilmagan: <b>${H.S.notifications.unreadCount(u.id)} ta</b>`));
  assert.match(r.text, /Jim soat: <b>22:00–08:00<\/b>/);
  assert.match(r.text, /O‘chirilgan turlar: <b>2 ta<\/b>/);
  for (const t of ['📅 Bugun', '🔔 O‘qilmagan', '🗂 Tarix', '⚙️ Sozlama', '🧪 Test']) assert.ok(r.button(t), t);
  r = await H.send('signal', tgId, '/yordam');
  assert.match(r.text, /Bildirishnomadagi tugmalar/);
  assert.match(r.text, /✅ Ko‘rildi — web paneldagi bildirishnoma ham o‘qilgan/);
  assert.match(r.text, /\/sozlama — Qaysi turlar kelsin/);
});
