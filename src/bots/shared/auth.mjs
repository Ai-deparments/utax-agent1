/**
 * Telegram ↔ UTAX foydalanuvchi bog'lash. Shaxsiy chatda chat_id = Telegram user id, shuning uchun
 * bitta bog'lash (users.telegram_user_id) barcha 4 botga amal qiladi. Qaysi botni /start qilgani — bot_chats.
 */
import { nowIso } from '../../core/util.mjs';

const actorOf = (user) => ({ user, ip: 'telegram', source: 'TELEGRAM' });

/** /start KOD → bog'lash. Natija: {ok, user} | {ok:false, reason:'invalid'|'expired'} */
export function linkByCode(app, code, from, botKey) {
  const { db } = app;
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-F0-9]{6,16}$/.test(c)) return { ok: false, reason: 'invalid' };
  const u = db.get('SELECT * FROM users WHERE telegram_link_code=? AND is_active=1', c);
  if (!u) return { ok: false, reason: 'invalid' };
  if (u.telegram_link_expires && u.telegram_link_expires < nowIso()) return { ok: false, reason: 'expired' };
  const tgId = String(from.id);
  const prev = db.get('SELECT id FROM users WHERE telegram_user_id=? AND id<>?', tgId, u.id);
  db.tx(() => {
    if (prev) db.run('UPDATE users SET telegram_user_id=NULL, telegram_chat_id=NULL, telegram_username=NULL, telegram_linked_at=NULL WHERE id=?', prev.id);
    db.run('UPDATE users SET telegram_user_id=?, telegram_chat_id=?, telegram_username=?, telegram_linked_at=?, telegram_link_code=NULL, telegram_link_expires=NULL WHERE id=?', tgId, tgId, from.username || null, nowIso(), u.id);
    db.run('UPDATE bot_chats SET user_id=? WHERE tg_user_id=?', u.id, tgId);
  });
  app.audit(actorOf(u), { action: 'TELEGRAM_LINKED', entity: 'user', entityId: u.id, newValue: { telegram_user_id: tgId, username: from.username || null, bot: botKey, replaced_user_id: prev?.id || null } });
  return { ok: true, user: db.get('SELECT * FROM users WHERE id=?', u.id) };
}

export function userByTelegram(db, tgId) {
  return tgId ? db.get('SELECT * FROM users WHERE telegram_user_id=?', String(tgId)) : null;
}

/** Foydalanuvchi shu botni ishlatdi — bot_chats yangilanadi (signal yuborish uchun kerak) */
export function touchChat(db, botKey, chatId, user, from) {
  const now = nowIso();
  db.run(`INSERT INTO bot_chats (user_id, bot_key, chat_id, tg_user_id, tg_username, started_at, last_seen_at, blocked_at) VALUES (?,?,?,?,?,?,?,NULL)
    ON CONFLICT(bot_key, chat_id) DO UPDATE SET user_id=COALESCE(excluded.user_id, bot_chats.user_id), tg_username=excluded.tg_username, last_seen_at=excluded.last_seen_at, blocked_at=NULL`,
  user?.id ?? null, botKey, String(chatId), String(from?.id ?? chatId), from?.username || null, now, now);
}

export function markChatBlocked(db, botKey, chatId, blocked = true) {
  db.run('UPDATE bot_chats SET blocked_at=? WHERE bot_key=? AND chat_id=?', blocked ? nowIso() : null, botKey, String(chatId));
}

/** Foydalanuvchi qaysi botlarni ochgan (bloklamagan) */
export function startedBots(db, userId) {
  return db.all('SELECT bot_key, chat_id, last_seen_at FROM bot_chats WHERE user_id=? AND blocked_at IS NULL ORDER BY last_seen_at DESC', userId);
}
