/**
 * Telegram auth xavfsizligi (review topilmalari): ega (BOT_OWNER_IDS) eskalatsiyasi, Mini App sessiyalari / 2FA / limitlar,
 * bog'lash kodlari (eski muddatsiz, tasdiq kartasi, brute-force), web PATCH /api/users/:id → setActive.
 * Har test — tuzatilgan xato qaytmasligi uchun. Tarmoqqa chiqmaydi: in-memory baza, soxta Telegram, tasodifiy port.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp, createServer } from '../src/server.mjs';
import { seed } from './fixtures/demo-seed.mjs';
import { startBots } from '../src/bots/index.mjs';
import { createTelegramApi } from '../src/bots/shared/telegram-api.mjs';
import { webLinks } from '../src/bots/shared/keyboards.mjs';
import { ensureOwner, ensureOwners, ownerEmail } from '../src/bots/shared/owners.mjs';
import { linkByCode, linkCodeHash, LINK_CODE_RE } from '../src/bots/shared/auth.mjs';
import { signInitData } from '../src/bots/shared/webapp-auth.mjs';
import { createFakeTelegram, Reply, TEST_TOKENS } from './helpers/bot-harness.mjs';
import { config } from '../src/core/config.mjs';
import { openDb } from '../src/core/db.mjs';
import { MIGRATIONS, migrate } from '../src/core/schema.mjs';
import { totpSecret, totpCode } from '../src/core/auth.mjs';

const PASSWORD = 'Utax2026!';
const OWNER = '9700000001';
const OWNER_B = '9700000004';

// Mini App endpointi config.bots tokenlari bilan tekshiradi — test tokenlari (har test fayli alohida jarayonda)
const savedBots = { ...config.bots };
Object.assign(config.bots, TEST_TOKENS);

const nowSec = () => Math.floor(Date.now() / 1000);
const initFor = (tgId, { token = TEST_TOKENS.rahbar, ageSec = 0, startParam } = {}) =>
  signInitData({ auth_date: nowSec() - ageSec, query_id: 'Q', user: { id: Number(tgId), first_name: 'T' }, ...(startParam ? { start_param: startParam } : {}) }, token);

async function makeEnv({ ownerIds = [] } = {}) {
  const app = createApp({ dbPath: ':memory:' });
  await seed(app, { log: () => {} });
  app.settings.set('notifications.telegram_enabled', true);
  if (ownerIds.length) ensureOwners(app, ownerIds); // server.mjs main() kabi
  const tg = createFakeTelegram(TEST_TOKENS);
  await startBots(app, {
    tokens: TEST_TOKENS, mode: 'off', retryEveryMs: 0, log: { info() {}, log() {}, warn() {}, error() {} }, links: webLinks({ webappUrl: 'https://crm.utax.test' }),
    ownerIds, rateLimit: { windowMs: 60000, max: 10000 }, apiFactory: (t) => createTelegramApi(t, { fetchImpl: tg.fetchImpl, sleepImpl: async () => {} }),
  });
  const server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let upd = 1;
  const from = (id) => ({ id: Number(id), is_bot: false, first_name: 'Test', username: `u${id}` });
  const run = async (botKey, update) => { const s = tg.calls.length; await app.bots.get(botKey).handleUpdate(update); await app.bots.flush(); return new Reply(tg.calls.slice(s)); };
  const E = {
    app, db: app.db, tg,
    user: (email) => app.db.get('SELECT * FROM users WHERE email=?', email),
    link(email, tgId) { app.db.run('UPDATE users SET telegram_user_id=?, telegram_chat_id=? WHERE email=?', String(tgId), String(tgId), email); return String(tgId); },
    /** Web «Ulash» bilan bir xil yozuv (12 hex, muddat bilan) */
    setCode(email, code = crypto.randomBytes(6).toString('hex').toUpperCase(), ttlMs = 3600e3) {
      app.db.run('UPDATE users SET telegram_link_code=?, telegram_link_expires=? WHERE email=?', code, new Date(Date.now() + ttlMs).toISOString(), email);
      return code;
    },
    send: (botKey, tgId, text) => run(botKey, { update_id: upd++, message: { message_id: upd, date: nowSec(), chat: { id: Number(tgId), type: 'private' }, from: from(tgId), text } }),
    click: (botKey, tgId, data) => run(botKey, { update_id: upd++, callback_query: { id: `cb${upd}`, from: from(tgId), data, message: { message_id: 1, date: nowSec(), chat: { id: Number(tgId), type: 'private' }, text: 'x' } } }),
    async http(method, p, body, token) {
      const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    async login(email) { const r = await E.http('POST', '/api/auth/login', { email, password: PASSWORD }); assert.equal(r.status, 200, `login ${email}`); return r.body; },
    mini: (tgId, opts) => E.http('POST', '/api/auth/telegram-webapp', { init_data: initFor(tgId, opts) }),
    refresh: (rt) => E.http('POST', '/api/auth/refresh', { refresh_token: rt }),
    lastSession: (email) => app.db.get('SELECT source, tg_user_id FROM sessions WHERE user_id=? ORDER BY id DESC LIMIT 1', E.user(email).id),
    close: () => new Promise((r) => server.close(r)),
  };
  return E;
}

let E;
before(async () => { E = await makeEnv({ ownerIds: [OWNER, OWNER_B] }); });
after(async () => { await E?.close(); Object.assign(config.bots, savedBots); });

// ---------- 1) CRITICAL: ega eskalatsiyasi ----------
test('CRITICAL ega /start KOD: xodimning havolasi xodimni FOUNDER qilmaydi — rad + audit, ega o‘z hisobida qoladi', async () => {
  const own = E.user(ownerEmail(OWNER));
  assert.equal(own.telegram_user_id, OWNER, 'startapda ega hisobi tayyor');
  const emp = await E.login('employee@utax.uz');
  const link = await E.http('POST', '/api/auth/telegram-link', null, emp.access_token);
  assert.match(link.body.code, /^[A-F0-9]{12}$/, 'kod 12 hex (uid(6))');
  const r = await E.send('sorov', OWNER, `/start ${link.body.code}`);
  assert.match(r.text, /ega sifatida avtomatik bog‘langansiz/);
  const after = E.user('employee@utax.uz');
  assert.equal(after.role_code, 'EMPLOYEE');
  assert.equal(after.telegram_user_id, null);
  assert.equal(E.db.get('SELECT telegram_user_id FROM users WHERE id=?', own.id).telegram_user_id, OWNER);
  assert.ok(E.db.get("SELECT id FROM audit_logs WHERE action='TELEGRAM_LINK_REJECTED' AND entity_id=? AND new_value LIKE '%owner_foreign_code%'", after.id));
  assert.ok(!E.db.get("SELECT id FROM audit_logs WHERE action='OWNER_ROLE_ENFORCED' AND entity_id=?", after.id));
  // xodim o'z paroli bilan — hali ham EMPLOYEE, admin API yopiq; ega yana yozsa ham o'zgarmaydi
  const again = await E.login('employee@utax.uz');
  assert.equal(again.user.role_code, 'EMPLOYEE');
  assert.equal((await E.http('PUT', '/api/roles/EMPLOYEE/permissions', { matrix: { users: ['VIEW', 'EDIT'] } }, again.access_token)).status, 403);
  await E.send('signal', OWNER, '/start');
  assert.equal(E.user('employee@utax.uz').role_code, 'EMPLOYEE');
});

test('CRITICAL ensureOwner: tg boshqa rolli hisobda — rol o‘zgarmaydi, tg ega hisobiga ko‘chadi (OWNER_RELINKED), shu Telegram sessiyalari yopiladi', async () => {
  const OWN2 = '9700000002';
  E.link('head.it@utax.uz', OWN2);
  const mini = await E.mini(OWN2);
  assert.equal(mini.status, 200);
  const u = ensureOwner(E.app, OWN2, { first_name: 'Ega', username: 'ega2' });
  assert.equal(u.email, ownerEmail(OWN2));
  assert.equal(u.role_code, 'FOUNDER');
  assert.equal(u.telegram_user_id, OWN2);
  const head = E.user('head.it@utax.uz');
  assert.equal(head.role_code, 'DEPARTMENT_HEAD', 'boshqa rolli hisob FOUNDER ga ko‘tarilmaydi');
  assert.equal(head.telegram_user_id, null);
  const a = E.db.get("SELECT old_value FROM audit_logs WHERE action='OWNER_RELINKED' AND entity_id=?", u.id);
  assert.equal(JSON.parse(a.old_value).user_id, head.id);
  assert.equal((await E.refresh(mini.body.refresh_token)).status, 401, 'eski hisobning Mini App refresh tokeni yopildi');
  assert.equal((await E.http('GET', '/api/auth/me', null, mini.body.access_token)).status, 401, 'access token ham darhol');
  assert.equal(ensureOwner(E.app, OWN2).id, u.id, 'takror — o‘sha ega hisobi');
});

test('CRITICAL ensureOwners (server ishga tushishi) ham shu qoida: boshqa rol ko‘tarilmaydi; FOUNDER hisob (oldin ko‘tarilgan ham) — o‘zi qoladi', async () => {
  const app = createApp({ dbPath: ':memory:' });
  await seed(app, { log: () => {} });
  const A = '9700000011', B = '9700000012';
  app.db.run('UPDATE users SET telegram_user_id=?, telegram_chat_id=? WHERE email=?', A, A, 'head.legal@utax.uz');
  app.db.run("UPDATE users SET role_code='FOUNDER', telegram_user_id=?, telegram_chat_id=? WHERE email=?", B, B, 'head.marketing@utax.uz');
  const [a, b] = ensureOwners(app, [A, B]);
  assert.equal(a.email, ownerEmail(A));
  const legal = app.db.get('SELECT role_code, telegram_user_id FROM users WHERE email=?', 'head.legal@utax.uz');
  assert.deepEqual({ ...legal }, { role_code: 'DEPARTMENT_HEAD', telegram_user_id: null });
  assert.ok(app.db.get("SELECT id FROM audit_logs WHERE action='OWNER_RELINKED' AND entity_id=?", a.id));
  assert.equal(b.email, 'head.marketing@utax.uz', 'FOUNDER hisobga bog‘langan — ko‘chirilmaydi');
  assert.equal(app.db.get('SELECT COUNT(*) n FROM users WHERE email=?', ownerEmail(B)).n, 0);
});

test('CRITICAL ega: FOUNDER hisob kodi qabul qilinadi — tasdiq kartasi orqali; keyin ega shu FOUNDER hisobda qoladi', async () => {
  assert.equal(E.user(ownerEmail(OWNER_B)).telegram_user_id, OWNER_B);
  const code = E.setCode('founder@utax.uz');
  let r = await E.send('rahbar', OWNER_B, `/start ${code}`);
  assert.match(r.text, /hisobiga bog‘lansinmi/);
  r = await E.click('rahbar', OWNER_B, r.button(/Ha, bog‘lash/).callback_data);
  assert.match(r.text, /Bog‘landi/);
  assert.equal(E.user('founder@utax.uz').telegram_user_id, OWNER_B);
  assert.equal(E.user(ownerEmail(OWNER_B)).telegram_user_id, null);
  await E.send('signal', OWNER_B, '/start');
  assert.equal(E.user('founder@utax.uz').telegram_user_id, OWNER_B, 'FOUNDER hisobdan ko‘chirilmaydi');
  E.db.run('UPDATE users SET telegram_user_id=NULL, telegram_chat_id=NULL WHERE email=?', 'founder@utax.uz');
});

test('CRITICAL ega uzilgach qayta yozsa — o‘z hisobiga qayta ulanadi va audit yoziladi (OWNER_RELINKED, user_id: null)', async () => {
  const mini = await E.mini(OWNER, { token: TEST_TOKENS.signal });
  assert.equal(mini.body.user.email, ownerEmail(OWNER));
  assert.equal((await E.http('POST', '/api/auth/telegram-unlink', {}, mini.body.access_token)).status, 200);
  assert.equal(E.user(ownerEmail(OWNER)).telegram_user_id, null);
  const maxId = E.db.get('SELECT MAX(id) m FROM audit_logs').m;
  await E.send('rahbar', OWNER, '/start');
  assert.equal(E.user(ownerEmail(OWNER)).telegram_user_id, OWNER);
  const a = E.db.get("SELECT old_value FROM audit_logs WHERE id>? AND action='OWNER_RELINKED' AND entity_id=?", maxId, E.user(ownerEmail(OWNER)).id);
  assert.deepEqual(JSON.parse(a.old_value), { user_id: null });
});

// ---------- 2) HIGH: unlink / re-link Mini App sessiyalarini yopadi ----------
test('HIGH telegram-unlink: Mini App sessiyalari (refresh + access) yopiladi, parol sessiyasi qoladi; rotatsiya manbani meros oladi', async () => {
  const TG = '9710000001';
  E.link('finance@utax.uz', TG);
  const mini = await E.mini(TG);
  assert.equal(mini.status, 200);
  assert.deepEqual({ ...E.lastSession('finance@utax.uz') }, { source: 'TELEGRAM', tg_user_id: TG });
  const rot = await E.refresh(mini.body.refresh_token);
  assert.equal(rot.status, 200);
  assert.deepEqual({ ...E.lastSession('finance@utax.uz') }, { source: 'TELEGRAM', tg_user_id: TG }, 'rotatsiyadan keyin ham Telegram sessiyasi');
  assert.equal((await E.http('GET', '/api/auth/me', null, mini.body.access_token)).status, 200, 'rotatsiya parallel so‘rovdagi access tokenni o‘ldirmaydi');
  const web = await E.login('finance@utax.uz');
  assert.equal(E.lastSession('finance@utax.uz').source, 'WEB');
  assert.equal((await E.http('POST', '/api/auth/telegram-unlink', {}, web.access_token)).status, 200);
  assert.equal((await E.refresh(rot.body.refresh_token)).status, 401);
  assert.equal((await E.http('GET', '/api/auth/me', null, rot.body.access_token)).status, 401);
  assert.equal((await E.http('GET', '/api/auth/me', null, mini.body.access_token)).status, 401);
  assert.equal((await E.http('GET', '/api/auth/me', null, web.access_token)).status, 200, 'parol sessiyasi ishlayveradi');
  const un = E.db.get("SELECT new_value FROM audit_logs WHERE action='TELEGRAM_UNLINKED' AND entity_id=? ORDER BY id DESC", E.user('finance@utax.uz').id);
  assert.ok(JSON.parse(un.new_value).revoked_sessions >= 1);
  assert.equal((await E.refresh(web.refresh_token)).status, 200);
});

test('HIGH qayta bog‘lash: tg boshqa hisobga o‘tsa — eski hisob sessiyasi yopiladi; hisob yangi Telegram’ga ko‘chsa — eski Telegram sessiyasi yopiladi', async () => {
  const T1 = '9710000002', T2 = '9710000003';
  E.link('accountant@utax.uz', T1);
  const accMini = await E.mini(T1);
  assert.equal(accMini.status, 200);
  let r = await E.send('sorov', T1, `/start ${E.setCode('head.revision@utax.uz')}`);
  r = await E.click('sorov', T1, r.button(/Ha, bog‘lash/).callback_data);
  assert.equal(E.user('head.revision@utax.uz').telegram_user_id, T1);
  assert.equal(E.user('accountant@utax.uz').telegram_user_id, null);
  assert.equal((await E.refresh(accMini.body.refresh_token)).status, 401, 'eski hisob (accountant) Mini App sessiyasi yopildi');
  const hrMini = await E.mini(T1);
  assert.equal(hrMini.body.user.email, 'head.revision@utax.uz');
  r = await E.send('signal', T2, `/start ${E.setCode('head.revision@utax.uz')}`);
  assert.match(r.text, /Bog‘landi/);
  assert.equal(E.user('head.revision@utax.uz').telegram_user_id, T2);
  assert.equal((await E.refresh(hrMini.body.refresh_token)).status, 401, 'T1 bilan ochilgan sessiya yopildi');
  assert.equal((await E.mini(T1)).status, 401, 'T1 endi bog‘lanmagan');
});

test('HIGH himoya qatlami: Telegram sessiyasi faqat shu tg hali bog‘langan bo‘lsa yangilanadi (sessiya yopilmagan yo‘l bo‘lsa ham)', async () => {
  const TG = '9710000004';
  E.link('sales@utax.uz', TG);
  const mini = await E.mini(TG);
  E.db.run("UPDATE users SET telegram_user_id='9710000099' WHERE email='sales@utax.uz'"); // sessiyani yopmaydigan to'g'ridan-to'g'ri o'zgarish
  assert.equal((await E.http('GET', '/api/auth/me', null, mini.body.access_token)).status, 401);
  assert.equal((await E.refresh(mini.body.refresh_token)).status, 401);
  E.db.run('UPDATE users SET telegram_user_id=NULL WHERE email=?', 'sales@utax.uz');
});

// ---------- 3) MEDIUM: Mini App 2FA va initData muddati ----------
test('MEDIUM Mini App 2FA: totp yoqilgan → {requires_2fa, temp_token} (token yo‘q); kod bilan → TELEGRAM sessiyasi; uzilgach temp token rad', async () => {
  const TG = '9720000001';
  const secret = totpSecret();
  E.db.run('UPDATE users SET totp_secret=?, totp_enabled=1, telegram_user_id=?, telegram_chat_id=? WHERE email=?', secret, TG, TG, 'cfo@utax.uz');
  const r = await E.mini(TG, { startParam: 'approvals' });
  assert.equal(r.status, 200);
  assert.equal(r.body.requires_2fa, true);
  assert.ok(r.body.temp_token);
  assert.equal(r.body.access_token, undefined);
  assert.equal(r.body.refresh_token, undefined);
  assert.equal(r.body.user, undefined);
  assert.equal(r.body.start_param, 'approvals');
  const valid = new Set([-1, 0, 1].map((i) => totpCode(secret, Date.now() + i * 30000)));
  let wrong = '000000';
  while (valid.has(wrong)) wrong = String(Number(wrong) + 1).padStart(6, '0');
  assert.equal((await E.http('POST', '/api/auth/2fa/verify', { temp_token: r.body.temp_token, code: wrong })).status, 401);
  const ok = await E.http('POST', '/api/auth/2fa/verify', { temp_token: r.body.temp_token, code: totpCode(secret) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.email, 'cfo@utax.uz');
  assert.deepEqual({ ...E.lastSession('cfo@utax.uz') }, { source: 'TELEGRAM', tg_user_id: TG });
  assert.ok(E.db.get("SELECT id FROM audit_logs WHERE action='LOGIN_TELEGRAM_WEBAPP' AND entity_id=? AND new_value LIKE '%two_factor%'", E.user('cfo@utax.uz').id));
  const pending = await E.mini(TG);
  assert.equal((await E.http('POST', '/api/auth/telegram-unlink', {}, ok.body.access_token)).status, 200);
  assert.equal((await E.http('POST', '/api/auth/2fa/verify', { temp_token: pending.body.temp_token, code: totpCode(secret) })).status, 401, 'temp token Telegram’ga bog‘langan');
  assert.equal((await E.http('GET', '/api/auth/me', null, ok.body.access_token)).status, 401);
});

test('MEDIUM Mini App: initData 1 soatdan eski — rad; 50 daqiqalik — qabul', async () => {
  const TG = '9720000002';
  E.link('head.audit@utax.uz', TG);
  assert.equal((await E.mini(TG, { ageSec: 3700 })).status, 401);
  assert.equal((await E.mini(TG, { ageSec: 3000 })).status, 200);
});

// ---------- 4) MEDIUM: muddatsiz eski kodlar ----------
test('MEDIUM eski kodlar: v4 migratsiya muddatsiz kodni tozalaydi, sessions.source/tg_user_id qo‘shiladi; linkByCode muddatsiz kodni eskirgan deb rad etadi', () => {
  const db = openDb(':memory:');
  db.exec(MIGRATIONS[0].sql);
  db.run('INSERT INTO schema_migrations (version,name,applied_at) VALUES (1,?,?)', MIGRATIONS[0].name, new Date().toISOString());
  db.run("INSERT INTO roles (code,name,rank) VALUES ('CFO','CFO',85)");
  db.run("INSERT INTO users (email,password_hash,name,role_code,created_at,telegram_link_code) VALUES ('cfo@x','h','CFO','CFO','2026-01-01T00:00:00Z','9F3A11C2')");
  migrate(db);
  assert.ok(db.all('SELECT version FROM schema_migrations').some((r) => r.version === 4));
  assert.equal(db.get("SELECT telegram_link_code FROM users WHERE email='cfo@x'").telegram_link_code, null);
  const cols = db.all('PRAGMA table_info(sessions)').map((c) => c.name);
  assert.ok(cols.includes('source') && cols.includes('tg_user_id'));
  db.run("UPDATE users SET telegram_link_code='ABCDEF123456', telegram_link_expires=NULL WHERE email='cfo@x'");
  const res = linkByCode({ db, audit: () => {} }, 'ABCDEF123456', { id: 424242, username: 'x' }, 'buxgalter');
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'expired');
  assert.equal(db.get("SELECT telegram_user_id FROM users WHERE email='cfo@x'").telegram_user_id, null);
  db.close();
});

test('MEDIUM eski kod bot orqali: muddatsiz kod → «muddati tugagan», bog‘lanmaydi', async () => {
  E.db.run("UPDATE users SET telegram_link_code='C0DE12345678', telegram_link_expires=NULL WHERE email='sales2@utax.uz'");
  const r = await E.send('buxgalter', '9770000001', '/start C0DE12345678');
  assert.match(r.text, /muddati tugagan/);
  assert.equal(E.user('sales2@utax.uz').telegram_user_id, null);
});

// ---------- 5) MEDIUM: mavjud bog'lanishni jim almashtirmaslik ----------
test('MEDIUM /start KOD: tg boshqa hisobga bog‘langan → tasdiq kartasi (lnk, ≤64 bayt, kod xeshi); ✖️ — o‘zgarmaydi; ✅ — bog‘lanadi + eski hisobga CRM bildirishnoma', async () => {
  const T = '9730000001';
  E.link('head.legal@utax.uz', T);
  const legal = E.user('head.legal@utax.uz');
  const code = E.setCode('head.marketing@utax.uz');
  let r = await E.send('sorov', T, `/start ${code}`);
  assert.match(r.text, /Aziza Mirzayeva<\/b> · Bo‘lim rahbari hisobiga bog‘lansinmi/);
  assert.match(r.text, /Joriy bog‘lanish \(<b>Kamola Saidova<\/b>/);
  assert.equal(E.user('head.legal@utax.uz').telegram_user_id, T, 'tasdiqsiz almashtirilmaydi');
  const yes = r.button(/Ha, bog‘lash/), no = r.button(/Bekor/);
  assert.equal(yes.callback_data, `lnk:ok:${linkCodeHash(code)}`);
  assert.equal(no.callback_data, `lnk:no:${linkCodeHash(code)}`);
  assert.ok(Buffer.byteLength(yes.callback_data) <= 64);
  assert.ok(!yes.callback_data.includes(code), 'kodning o‘zi tugmada yo‘q');
  r = await E.click('sorov', T, no.callback_data);
  assert.match(r.text, /bekor qilindi/);
  assert.equal(E.user('head.legal@utax.uz').telegram_user_id, T);
  r = await E.click('sorov', T, yes.callback_data);
  assert.match(r.text, /Tasdiq muddati tugagan/, 'bekordan keyin eski tugma ishlamaydi');
  assert.equal(E.user('head.marketing@utax.uz').telegram_user_id, null);
  r = await E.send('sorov', T, `/start ${code}`);
  r = await E.click('sorov', T, r.button(/Ha, bog‘lash/).callback_data);
  assert.match(r.text, /Bog‘landi/);
  assert.equal(E.user('head.marketing@utax.uz').telegram_user_id, T);
  assert.equal(E.user('head.legal@utax.uz').telegram_user_id, null);
  assert.ok(E.db.get("SELECT id FROM notifications WHERE user_id=? AND channel='CRM' AND title='Telegram hisobingiz uzildi'", legal.id), 'eski hisob egasiga CRM bildirishnoma');
  const a = E.db.get("SELECT new_value FROM audit_logs WHERE action='TELEGRAM_LINKED' AND entity_id=? ORDER BY id DESC", E.user('head.marketing@utax.uz').id);
  assert.equal(JSON.parse(a.new_value).replaced_user_id, legal.id);
});

test('MEDIUM tasdiq kartasi: soxta xesh va 10 daqiqadan keyin — eskirgan; joriy rol bot auditoriyasida bo‘lmasa ham tasdiqlash ishlaydi', async () => {
  const T = '9730000002';
  E.link('auditor@utax.uz', T); // AUDITOR — rahbar botida emas
  const code = E.setCode('ceo@utax.uz');
  let r = await E.send('rahbar', T, `/start ${code}`);
  const yes = r.button(/Ha, bog‘lash/);
  r = await E.click('rahbar', T, `lnk:ok:${'0'.repeat(32)}`);
  assert.match(r.text, /Tasdiq muddati tugagan/);
  const key = `lnkp:${T}`;
  const st = JSON.parse(E.db.get('SELECT value FROM bot_state WHERE key=?', key).value);
  E.db.run('UPDATE bot_state SET value=? WHERE key=?', JSON.stringify({ ...st, at: new Date(Date.now() - 11 * 60e3).toISOString() }), key);
  r = await E.click('rahbar', T, yes.callback_data);
  assert.match(r.text, /Tasdiq muddati tugagan/);
  assert.equal(E.user('auditor@utax.uz').telegram_user_id, T);
  assert.equal(E.user('ceo@utax.uz').telegram_user_id, null);
  r = await E.send('rahbar', T, `/start ${code}`);
  r = await E.click('rahbar', T, r.button(/Ha, bog‘lash/).callback_data);
  assert.match(r.text, /Bog‘landi/);
  assert.equal(E.user('ceo@utax.uz').telegram_user_id, T);
  assert.ok(!/mo‘ljallanmagan/.test(r.text), 'CEO sifatida rahbar botiga kiradi');
});

// ---------- 6) MEDIUM: web PATCH /api/users/:id ----------
test('MEDIUM web PATCH is_active → setActive: sessiyalar yopiladi, ta’sischi/o‘zini bloklash taqiqlangan, audit; rol o‘zgarsa bot dialoglari tozalanadi; parol auditga yozilmaydi', async () => {
  const admin = await E.login('admin@utax.uz');
  const sales = await E.login('sales@utax.uz');
  const sid = E.user('sales@utax.uz').id;
  let p = await E.http('PATCH', `/api/users/${sid}`, { is_active: false }, admin.access_token);
  assert.equal(p.status, 200);
  assert.equal(p.body.is_active, false);
  assert.ok(E.db.get("SELECT id FROM audit_logs WHERE action='USER_BLOCKED' AND entity_id=?", sid));
  assert.equal((await E.refresh(sales.refresh_token)).status, 401);
  p = await E.http('PATCH', `/api/users/${sid}`, { is_active: true }, admin.access_token);
  assert.equal(p.body.is_active, true);
  assert.ok(E.db.get("SELECT id FROM audit_logs WHERE action='USER_UNBLOCKED' AND entity_id=?", sid));
  assert.equal((await E.refresh(sales.refresh_token)).status, 401, 'blokdan chiqarilgach eski sessiya qaytmaydi');
  const kills = () => E.db.get("SELECT COUNT(*) n FROM audit_logs WHERE action IN ('USER_BLOCKED','USER_UNBLOCKED') AND entity_id=?", sid).n;
  const before = kills();
  assert.equal((await E.http('PATCH', `/api/users/${sid}`, { name: 'Jasur Tursunov', is_active: true }, admin.access_token)).status, 200);
  assert.equal(kills(), before, 'forma is_active ni o‘zgartirmasdan yuborsa — setActive chaqirilmaydi');

  const fid = E.user('founder@utax.uz').id;
  p = await E.http('PATCH', `/api/users/${fid}`, { is_active: false }, admin.access_token);
  assert.equal(p.status, 400);
  assert.match(p.body.message, /Ta’sischini bloklab bo‘lmaydi/);
  p = await E.http('PATCH', `/api/users/${fid}`, { role_code: 'EMPLOYEE', is_active: 0 }, admin.access_token);
  assert.ok([400, 403].includes(p.status), 'bitta so‘rovda tushirib-bloklab bo‘lmaydi (ADMIN ta’sischi rolini o‘zgartira olmaydi — 403)');
  assert.deepEqual({ ...E.db.get('SELECT role_code, is_active FROM users WHERE id=?', fid) }, { role_code: 'FOUNDER', is_active: 1 });
  p = await E.http('PATCH', `/api/users/${E.user('admin@utax.uz').id}`, { is_active: false }, admin.access_token);
  assert.equal(p.status, 400);
  assert.match(p.body.message, /O‘zingizni bloklay olmaysiz/);
  assert.equal((await E.http('PATCH', `/api/users/${sid}`, { role_code: 'SUPERUSER' }, admin.access_token)).status, 400);

  const T = E.link('sales@utax.uz', '9740000001');
  E.db.run('INSERT INTO bot_dialogs (key, state, updated_at, expires_at) VALUES (?,?,?,?)', `sorov:${T}`, '{"name":"x"}', new Date().toISOString(), new Date(Date.now() + 600e3).toISOString());
  assert.equal((await E.http('PATCH', `/api/users/${sid}`, { role_code: 'EMPLOYEE' }, admin.access_token)).status, 200);
  assert.equal(E.db.get('SELECT COUNT(*) n FROM bot_dialogs WHERE key=?', `sorov:${T}`).n, 0, 'rol o‘zgardi — ochiq dialog o‘chdi');
  assert.equal((await E.http('PATCH', `/api/users/${sid}`, { password: 'YangiParol2026!x', role_code: 'SALES' }, admin.access_token)).status, 200);
  const a = E.db.get("SELECT new_value FROM audit_logs WHERE action='UPDATE' AND entity='user' AND entity_id=? ORDER BY id DESC", sid);
  assert.ok(!a.new_value.includes('YangiParol2026'), 'parol audit jurnalida yo‘q');
  assert.match(a.new_value, /password_changed/);
});

// ---------- 7) MEDIUM: Mini App limitlari ----------
test('MEDIUM Mini App limit: bitta IP’dan 12 xil xodim kiradi (IP 60/daq); bitta Telegram hisobi 10/daq; 2FA kodi 5/daq', async () => {
  const F = await makeEnv();
  try {
    const emails = ['ceo@utax.uz', 'cfo@utax.uz', 'finance@utax.uz', 'accountant@utax.uz', 'sales@utax.uz', 'sales2@utax.uz', 'head.revision@utax.uz', 'head.audit@utax.uz', 'head.legal@utax.uz', 'head.marketing@utax.uz', 'head.it@utax.uz', 'employee@utax.uz'];
    const ids = emails.map((em, i) => F.link(em, 9750000000 + i));
    const st = [];
    for (const id of ids) st.push((await F.mini(id)).status);
    assert.deepEqual(st, ids.map(() => 200), 'ofis NAT: 10 dan ko‘p xodim bir IP’dan');
    let calls = ids.length;
    for (let i = 0; i < 9; i++, calls++) assert.equal((await F.mini(ids[0])).status, 200);
    assert.equal((await F.mini(ids[0])).status, 429, 'bitta tg id — 11-chi urinish');
    calls++;
    // 2FA kodi: foydalanuvchiga 5/daq
    const secret = totpSecret();
    const TG = F.link('auditor@utax.uz', 9751000000);
    F.db.run('UPDATE users SET totp_secret=?, totp_enabled=1 WHERE email=?', secret, 'auditor@utax.uz');
    const t = await F.mini(TG);
    calls++;
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await F.http('POST', '/api/auth/2fa/verify', { temp_token: t.body.temp_token, code: 'abc' })).status);
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
    // IP bo'yicha umumiy chegara — 60/daq
    let first429 = null;
    for (let n = calls + 1; n <= 61 && first429 === null; n++) if ((await F.http('POST', '/api/auth/telegram-webapp', { init_data: 'user=%7B%7D&hash=00' })).status === 429) first429 = n;
    assert.equal(first429, 61);
  } finally { await F.close(); }
});

// ---------- 8) LOW: noto'g'ri kodlar — audit va brute-force blok ----------
test('LOW noto‘g‘ri kodlar: TELEGRAM_LINK_FAILED audit (10 daq dedupe), 5 xato → 1 soat blok (4 bot uchun umumiy); blokda to‘g‘ri kod ham rad; blokdan keyin ishlaydi', async () => {
  const T = '9760000001';
  const audits = () => E.db.all("SELECT new_value FROM audit_logs WHERE action='TELEGRAM_LINK_FAILED' AND new_value LIKE ? ORDER BY id", `%"tg_user_id":"${T}"%`);
  const bots = ['sorov', 'signal', 'rahbar', 'buxgalter'];
  for (let i = 0; i < 4; i++) assert.match((await E.send(bots[i], T, `/start ${(0xA00000000000 + i).toString(16).toUpperCase()}`)).text, /Kod noto‘g‘ri/);
  assert.equal(audits().length, 1, 'dedupe: 10 daqiqada bitta yozuv');
  let r = await E.send('sorov', T, '/start DEADBEEF0005');
  assert.match(r.text, /Juda ko‘p noto‘g‘ri kod/);
  const rows = audits();
  assert.equal(rows.length, 2, 'blok boshlanishi — alohida audit');
  const last = JSON.parse(rows.at(-1).new_value);
  assert.equal(last.failures, 5);
  assert.ok(Date.parse(last.blocked_until) > Date.now() + 55 * 60e3);
  const code = E.setCode('sales2@utax.uz');
  r = await E.send('signal', T, `/start ${code}`);
  assert.match(r.text, /Juda ko‘p noto‘g‘ri kod/, 'boshqa botda ham blok (umumiy)');
  assert.equal(E.user('sales2@utax.uz').telegram_user_id, null);
  const key = `lnkfail:${T}`;
  const st = JSON.parse(E.db.get('SELECT value FROM bot_state WHERE key=?', key).value);
  E.db.run('UPDATE bot_state SET value=? WHERE key=?', JSON.stringify({ ...st, blocked_until: new Date(Date.now() - 1000).toISOString() }), key);
  r = await E.send('signal', T, `/start ${code}`);
  assert.match(r.text, /Bog‘landi/);
  assert.equal(E.user('sales2@utax.uz').telegram_user_id, T);
  assert.ok(!E.db.get('SELECT value FROM bot_state WHERE key=?', key), 'muvaffaqiyatli bog‘lash hisoblagichni tozalaydi');
});

test('LOW kod formati: LINK_CODE_RE — 12 hex (yangi) va 8 hex (oldingi, 24 soat ichida); 6 / 16 / hex bo‘lmagan — yo‘q', () => {
  assert.ok(LINK_CODE_RE.test('A1B2C3D4E5F6'));
  assert.ok(LINK_CODE_RE.test('a1b2c3d4e5f6'));
  assert.ok(LINK_CODE_RE.test('A1B2C3D4'));
  assert.ok(!LINK_CODE_RE.test('A1B2C3'));
  assert.ok(!LINK_CODE_RE.test('A1B2C3D4E5F6A7B8'));
  assert.ok(!LINK_CODE_RE.test('A1B2C3D4E5FZ'));
});
