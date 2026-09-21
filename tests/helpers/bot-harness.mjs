/**
 * Botlar uchun test muhiti: in-memory baza + pilot seed, 4 bot soxta Telegram server bilan (tarmoqqa chiqmaydi).
 * Haqiqiy createTelegramApi ishlatiladi — faqat fetch almashtiriladi, shuning uchun API klient ham test qilinadi.
 *
 *   const H = await createBotHarness();
 *   const ceo = H.link('ceo@utax.uz');                 // Telegram id bog'lash (web oqimisiz)
 *   const r = await H.send('rahbar', ceo, '/holat');   // shu update'da yuborilgan barcha API chaqiruvlari
 *   r.text; r.buttons; r.button(/Tasdiqlash/)
 *   const r2 = await H.click('rahbar', ceo, r.button(/Tasdiqlash/).callback_data, { messageId: r.last.message_id });
 *   await H.upload('buxgalter', acc, { name: 'vipiska.csv', content: Buffer.from(csv) });
 */
import { createApp } from '../../src/server.mjs';
import { seed } from '../../src/seed/seed.mjs';
import { startBots } from '../../src/bots/index.mjs';
import { createTelegramApi } from '../../src/bots/shared/telegram-api.mjs';
import { webLinks } from '../../src/bots/shared/keyboards.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../../src/core/config.mjs';

// Testlarda ctx.saveFile haqiqiy uploads/ ga emas, vaqtinchalik papkaga yozadi
config.uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utax-bot-uploads-'));
process.on('exit', () => { try { fs.rmSync(config.uploadsDir, { recursive: true, force: true }); } catch {} });

export const TEST_TOKENS = { rahbar: '1001:TEST-rahbar', buxgalter: '1002:TEST-buxgalter', sorov: '1003:TEST-sorov', signal: '1004:TEST-signal' };

/** Soxta Telegram Bot API (fetch darajasida) */
export function createFakeTelegram(tokens = TEST_TOKENS) {
  const byToken = Object.fromEntries(Object.entries(tokens).map(([k, t]) => [t, k]));
  const calls = [];
  const files = new Map();
  const failures = [];
  let msgId = 1000;
  let fileSeq = 1;
  const now = () => Math.floor(Date.now() / 1000);
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

  function respond(bot, method, p) {
    switch (method) {
      case 'getMe': return { id: 900 + Object.keys(tokens).indexOf(bot), is_bot: true, first_name: `UTAX ${bot}`, username: `utax_${bot}_bot` };
      case 'sendMessage': return { message_id: ++msgId, date: now(), chat: { id: Number(p.chat_id), type: 'private' }, text: p.text, reply_markup: p.reply_markup };
      case 'sendDocument': return { message_id: ++msgId, date: now(), chat: { id: Number(p.chat_id), type: 'private' }, document: { file_name: p.document?.name || 'fayl', file_size: p.document?.size || 0 } };
      case 'editMessageText': return { message_id: Number(p.message_id), date: now(), chat: { id: Number(p.chat_id), type: 'private' }, text: p.text, reply_markup: p.reply_markup };
      case 'getFile': { const f = files.get(p.file_id); return f ? { file_id: p.file_id, file_unique_id: p.file_id, file_size: f.content.length, file_path: f.path } : undefined; }
      case 'getUpdates': return [];
      default: return true;
    }
  }

  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    let m = /^\/file\/bot([^/]+)\/(.+)$/.exec(u.pathname);
    if (m) {
      const f = [...files.values()].find((x) => x.path === decodeURIComponent(m[2]));
      if (!f) return new Response('not found', { status: 404 });
      return new Response(f.content, { status: 200, headers: { 'content-length': String(f.content.length) } });
    }
    m = /^\/bot([^/]+)\/(\w+)$/.exec(u.pathname);
    if (!m) return json({ ok: false, error_code: 404, description: 'Not Found' }, 404);
    const bot = byToken[m[1]];
    if (!bot) return json({ ok: false, error_code: 401, description: 'Unauthorized' }, 401);
    const method = m[2];
    let params = {};
    if (init.body instanceof FormData) {
      for (const [k, v] of init.body.entries()) params[k] = typeof v === 'string' ? (tryJson(v)) : { name: v.name, size: v.size };
    } else if (init.body) params = JSON.parse(init.body);
    const call = { bot, method, params };
    calls.push(call);
    const fi = failures.findIndex((f) => f.method === method && (!f.bot || f.bot === bot) && (!f.chatId || String(f.chatId) === String(params.chat_id)));
    if (fi >= 0) {
      const f = failures[fi];
      if (--f.times <= 0) failures.splice(fi, 1);
      call.failed = f.code;
      return json({ ok: false, error_code: f.code, description: f.description, ...(f.parameters ? { parameters: f.parameters } : {}) }, f.code >= 500 ? f.code : 200);
    }
    const result = respond(bot, method, params);
    if (result === undefined) return json({ ok: false, error_code: 400, description: 'Bad Request: invalid file_id' });
    call.result = result;
    return json({ ok: true, result });
  }

  return {
    fetchImpl, calls, files,
    /** Keyingi mos chaqiruvni xato bilan qaytarish: {method, code, description, bot?, chatId?, times?} */
    fail(f) { failures.push({ times: 1, ...f }); },
    addFile(content, name = 'fayl') { const id = `F${fileSeq++}`; files.set(id, { path: `documents/${id}_${name}`, content: Buffer.from(content) }); return id; },
  };
}
const tryJson = (v) => { if (/^[[{]/.test(v)) { try { return JSON.parse(v); } catch {} } return v; };

/** Bir update davomidagi API chaqiruvlari ustidan qulay o'qish */
export class Reply {
  constructor(calls) { this.calls = calls; }
  /** sendMessage + editMessageText (matnli xabarlar) */
  get messages() { return this.calls.filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText').map((c) => ({ bot: c.bot, method: c.method, chat_id: c.params.chat_id, text: c.params.text, reply_markup: c.params.reply_markup, message_id: c.result?.message_id })); }
  get texts() { return this.messages.map((m) => m.text); }
  get text() { return this.texts.join('\n---\n'); }
  /** Oxirgi yuborilgan xabar: {text, reply_markup, message_id, chat_id} */
  get last() { const c = this.calls.filter((x) => x.method === 'sendMessage').at(-1); return c ? { ...c.params, message_id: c.result?.message_id } : undefined; }
  /** Barcha inline tugmalar (tekis ro'yxat): yangi xabarlar, tahrirlar va ctx.setButtons (editMessageReplyMarkup) */
  get buttons() { return [...this.messages, ...this.calls.filter((c) => c.method === 'editMessageReplyMarkup').map((c) => c.params)].flatMap((m) => (m.reply_markup?.inline_keyboard || []).flat()); }
  button(re) { return this.buttons.find((b) => (re instanceof RegExp ? re.test(b.text) : b.text === re)); }
  get answers() { return this.calls.filter((c) => c.method === 'answerCallbackQuery').map((c) => c.params); }
  get documents() { return this.calls.filter((c) => c.method === 'sendDocument').map((c) => c.params); }
  by(bot) { return new Reply(this.calls.filter((c) => c.bot === bot)); }
  method(name) { return this.calls.filter((c) => c.method === name).map((c) => c.params); }
}

export async function createBotHarness({ seedData = true, webappUrl = 'https://crm.utax.test' } = {}) {
  const app = createApp({ dbPath: ':memory:' });
  if (seedData) await seed(app, { log: () => {} });
  const tg = createFakeTelegram(TEST_TOKENS);
  const errors = [];
  const log = { info() {}, log() {}, warn() {}, error: (...a) => errors.push(a.map(String).join(' ')) };
  // Sinov uchun Telegram xabarlari yoqilgan bo'lsin
  app.settings.set('notifications.telegram_enabled', true);
  await startBots(app, {
    tokens: TEST_TOKENS, mode: 'off', log, retryEveryMs: 0, links: webLinks({ webappUrl }), ownerIds: [], rateLimit: { windowMs: 60000, max: 10000 },
    apiFactory: (token) => createTelegramApi(token, { fetchImpl: tg.fetchImpl, sleepImpl: async () => {} }),
  });
  let updateId = 1;
  let tgSeq = 7000000;
  const nowSec = () => Math.floor(Date.now() / 1000);
  async function run(botKey, update) {
    const start = tg.calls.length;
    const bot = app.bots.get(botKey);
    if (!bot) throw new Error(`bot yo'q: ${botKey}`);
    await bot.handleUpdate(update);
    await app.bots.flush();
    return new Reply(tg.calls.slice(start));
  }
  const fromOf = (tgId) => ({ id: Number(tgId), is_bot: false, first_name: 'Test', username: `user${tgId}` });

  const H = {
    app, tg, db: app.db, S: app.services, errors,
    /** Foydalanuvchini Telegram id ga bog'lash (web oqimisiz). Qaytaradi: tgId */
    link(email, tgId = ++tgSeq) {
      const n = app.db.run('UPDATE users SET telegram_user_id=?, telegram_chat_id=?, telegram_username=?, telegram_linked_at=? WHERE email=?', String(tgId), String(tgId), `user${tgId}`, new Date().toISOString(), email).changes;
      if (!n) throw new Error(`foydalanuvchi yo'q: ${email}`);
      return tgId;
    },
    user: (email) => app.db.get('SELECT * FROM users WHERE email=?', email),
    /** Foydalanuvchi botni /start qilgan deb belgilash (bot_chats) — signal yetkazish uchun */
    started(botKey, email) {
      const u = H.user(email);
      const now = new Date().toISOString();
      app.db.run('INSERT INTO bot_chats (user_id, bot_key, chat_id, tg_user_id, started_at, last_seen_at) VALUES (?,?,?,?,?,?) ON CONFLICT(bot_key, chat_id) DO UPDATE SET user_id=excluded.user_id, blocked_at=NULL, last_seen_at=excluded.last_seen_at', u.id, botKey, u.telegram_user_id, u.telegram_user_id, now, now);
    },
    send: (botKey, tgId, text) => run(botKey, { update_id: updateId++, message: { message_id: updateId, date: nowSec(), chat: { id: Number(tgId), type: 'private' }, from: fromOf(tgId), text } }),
    click: (botKey, tgId, data, { messageId = 1, date = nowSec(), text = 'x' } = {}) => run(botKey, { update_id: updateId++, callback_query: { id: `cb${updateId}`, from: fromOf(tgId), data, message: { message_id: messageId, date, chat: { id: Number(tgId), type: 'private' }, text } } }),
    upload: (botKey, tgId, { name = 'fayl.csv', content = '', mime = 'text/csv', caption } = {}) => {
      const fileId = tg.addFile(content, name);
      return run(botKey, { update_id: updateId++, message: { message_id: updateId, date: nowSec(), chat: { id: Number(tgId), type: 'private' }, from: fromOf(tgId), document: { file_id: fileId, file_unique_id: fileId, file_name: name, mime_type: mime, file_size: Buffer.byteLength(content) }, ...(caption ? { caption } : {}) } });
    },
    photo: (botKey, tgId, { content = 'JPEG', caption } = {}) => {
      const fileId = tg.addFile(content, 'photo.jpg');
      return run(botKey, { update_id: updateId++, message: { message_id: updateId, date: nowSec(), chat: { id: Number(tgId), type: 'private' }, from: fromOf(tgId), photo: [{ file_id: fileId, file_unique_id: fileId, width: 90, height: 90, file_size: Buffer.byteLength(content) }], ...(caption ? { caption } : {}) } });
    },
    raw: (botKey, update) => run(botKey, { update_id: updateId++, ...update }),
    /** Oxirgi N ta API chaqiruv (debug) */
    tail: (n = 10) => tg.calls.slice(-n),
  };
  return H;
}
