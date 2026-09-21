/**
 * Telegram ↔ UTAX foydalanuvchi bog'lash. Shaxsiy chatda chat_id = Telegram user id, shuning uchun
 * bitta bog'lash (users.telegram_user_id) barcha 4 botga amal qiladi. Qaysi botni /start qilgani — bot_chats.
 *
 * Xavfsizlik qoidalari (web bilan bir xil servis darajasida):
 *   • kod — 12 hex (web: uid(6)), 24 soat, bir martalik; muddati yo'q (eski) kod — eskirgan hisoblanadi
 *   • noto'g'ri kod: TELEGRAM_LINK_FAILED audit (tg id bo'yicha 10 daqiqada bir marta), 5 ta xato → 1 soat blok (4 bot uchun umumiy, bot_state)
 *   • tg id boshqa hisobga bog'langan bo'lsa — darhol emas, tasdiq kartasi orqali (lnk:ok|no:<kod xeshi>, 10 daqiqa)
 *   • bog'lanish boshqa hisobga o'tsa yoki uzilsa — shu Telegram bilan ochilgan Mini App sessiyalari (sessions.source='TELEGRAM') yopiladi
 *   • ega (BOT_OWNER_IDS) faqat allaqachon FOUNDER bo'lgan hisob kodini qabul qiladi (owners.mjs)
 */
import { nowIso, sha256 } from '../../core/util.mjs';

const actorOf = (user) => ({ user, ip: 'telegram', source: 'TELEGRAM' });

/** 12 hex — yangi kodlar (uid(6)); 8 hex — oldingi (uid(4)) kodlar, 24 soatlik muddati tugaguncha amal qiladi */
export const LINK_CODE_RE = /^[A-F0-9]{8,12}$/i;
export const LINK_FAIL_MAX = 5;
export const LINK_FAIL_WINDOW_MS = 3600e3;
export const LINK_BLOCK_MS = 3600e3;
export const LINK_AUDIT_DEDUPE_MS = 10 * 60e3;
export const LINK_CONFIRM_TTL_MS = 10 * 60e3;

/** Tasdiq tugmasidagi kod xeshi (kodning o'zi Telegram tarixida qolmaydi); lnk:ok:<32 hex> = 39 bayt ≤ 64 */
export const linkCodeHash = (code) => sha256(`tglink:${String(code || '').trim().toUpperCase()}`).slice(0, 32);

// ---------- bot_state yordamchilari (4 bot bitta bazada — holat umumiy) ----------
const stateGet = (db, key) => {
  const v = db.get('SELECT value FROM bot_state WHERE key=?', key)?.value;
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
};
const stateSet = (db, key, obj) => db.run('INSERT INTO bot_state (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at', key, JSON.stringify(obj), nowIso());
const stateDel = (db, key) => db.run('DELETE FROM bot_state WHERE key=?', key);
const failKey = (tgId) => `lnkfail:${tgId}`;
const pendingKey = (tgId) => `lnkp:${tgId}`;

/** Shu tg id uchun bog'lash bloklanganmi → blok tugash vaqti (ISO) | null */
export function linkBlockedUntil(db, tgId, now = Date.now()) {
  const st = stateGet(db, failKey(String(tgId)));
  return st?.blocked_until && Date.parse(st.blocked_until) > now ? st.blocked_until : null;
}

/** Noto'g'ri/eskirgan kod: hisoblagich (+ 5 ta → 1 soat blok) va audit (10 daqiqada bir marta; blok boshlanishi — har doim) */
function recordLinkFailure(app, from, botKey, reason) {
  const { db } = app;
  const tgId = String(from.id);
  const now = Date.now();
  let st = stateGet(db, failKey(tgId)) || {};
  if (reason !== 'blocked') {
    if (!st.first_at || now - Date.parse(st.first_at) > LINK_FAIL_WINDOW_MS || (st.blocked_until && Date.parse(st.blocked_until) <= now)) st = { n: 0, first_at: new Date(now).toISOString(), audited_at: st.audited_at || null };
    st.n = (st.n || 0) + 1;
  }
  const blockStarts = reason !== 'blocked' && st.n >= LINK_FAIL_MAX && !st.blocked_until;
  if (blockStarts) st.blocked_until = new Date(now + LINK_BLOCK_MS).toISOString();
  const auditNow = blockStarts || !st.audited_at || now - Date.parse(st.audited_at) >= LINK_AUDIT_DEDUPE_MS;
  if (auditNow) st.audited_at = new Date(now).toISOString();
  stateSet(db, failKey(tgId), st);
  if (auditNow) {
    app.audit({ user: null, ip: 'telegram', source: 'TELEGRAM' }, {
      action: 'TELEGRAM_LINK_FAILED', entity: 'bot',
      newValue: { bot: botKey, reason, tg_user_id: tgId, tg_username: from.username || null, failures: st.n || 0, blocked_until: st.blocked_until || null },
    });
  }
  return st.blocked_until && Date.parse(st.blocked_until) > now ? st.blocked_until : null;
}

// ---------- sessiyalar ----------
/** Telegram (Mini App) orqali ochilgan sessiyalarni yopish; tgUserId berilsa — faqat shu Telegram hisobi bilan ochilganlari */
export function revokeTelegramSessions(db, userId, tgUserId = null) {
  if (!userId) return 0;
  const byTg = tgUserId !== null && tgUserId !== undefined;
  return db.run(`UPDATE sessions SET revoked_at=? WHERE user_id=? AND source='TELEGRAM' AND revoked_at IS NULL${byTg ? ' AND tg_user_id=?' : ''}`, nowIso(), userId, ...(byTg ? [String(tgUserId)] : [])).changes;
}

/**
 * tg id ni hisobdan uzish (bog'lanish boshqa hisobga o'tganda yoki web'da «Uzish»): Telegram maydonlari tozalanadi,
 * shu Telegram bilan ochilgan Mini App sessiyalari yopiladi, ochiq bot dialoglari o'chadi, bot_chats egasi bo'shatiladi.
 */
export function detachTelegram(db, userId, tgUserId) {
  const tg = tgUserId ? String(tgUserId) : null;
  db.run('UPDATE users SET telegram_user_id=NULL, telegram_chat_id=NULL, telegram_username=NULL, telegram_linked_at=NULL WHERE id=?', userId);
  if (tg) {
    db.run('UPDATE bot_chats SET user_id=NULL WHERE user_id=? AND tg_user_id=?', userId, tg);
    db.run('DELETE FROM bot_dialogs WHERE key LIKE ?', `%:${tg}`);
  }
  return revokeTelegramSessions(db, userId, tg);
}

// ---------- bog'lash ----------
function applyLink(app, u, from, botKey, prev) {
  const { db } = app;
  const tgId = String(from.id);
  const oldTg = u.telegram_user_id && u.telegram_user_id !== tgId ? u.telegram_user_id : null;
  db.tx(() => {
    if (prev) detachTelegram(db, prev.id, tgId);
    if (oldTg) detachTelegram(db, u.id, oldTg); // hisob yangi Telegram'ga ko'chmoqda — eski Telegram sessiyalari/dialoglari yopiladi
    db.run('UPDATE users SET telegram_user_id=?, telegram_chat_id=?, telegram_username=?, telegram_linked_at=?, telegram_link_code=NULL, telegram_link_expires=NULL WHERE id=?', tgId, tgId, from.username || null, nowIso(), u.id);
    db.run('UPDATE bot_chats SET user_id=? WHERE tg_user_id=?', u.id, tgId);
    stateDel(db, failKey(tgId));
    stateDel(db, pendingKey(tgId));
  });
  app.audit(actorOf(u), { action: 'TELEGRAM_LINKED', entity: 'user', entityId: u.id, newValue: { telegram_user_id: tgId, username: from.username || null, bot: botKey, replaced_user_id: prev?.id || null, previous_telegram_user_id: oldTg } });
  if (prev) {
    // Eski hisob egasiga CRM bildirishnoma (Telegram endi unga bog'lanmagan — faqat web'da ko'rinadi)
    try {
      app.services?.notifications?.notify({
        user_ids: [prev.id], type: 'REMINDER', severity: 'WARNING',
        title: 'Telegram hisobingiz uzildi',
        body: `Telegram${from.username ? ` (@${from.username})` : ''} endi boshqa UTAX foydalanuvchisiga bog‘landi. Agar buni siz qilmagan bo‘lsangiz — rahbariyatga xabar bering va Sozlamalar → Profil → Telegram botlar orqali qayta ulang.`,
      });
    } catch { /* bildirishnoma bog'lashni to'xtatmaydi */ }
  }
  return { ok: true, user: db.get('SELECT * FROM users WHERE id=?', u.id), prev: prev || null };
}

/** Kod amal qiladimi (faol hisob, muddati bor va o'tmagan). Qaytaradi: {user} | {reason} */
function findByCode(db, code) {
  const c = String(code || '').trim().toUpperCase();
  if (!LINK_CODE_RE.test(c)) return { reason: 'invalid' };
  const u = db.get('SELECT * FROM users WHERE telegram_link_code=? AND is_active=1', c);
  if (!u) return { reason: 'invalid' };
  if (!u.telegram_link_expires || u.telegram_link_expires < nowIso()) return { reason: 'expired' };
  return { user: u, code: c };
}

/**
 * /start KOD → bog'lash.
 * @param opts.owner  tg id — ega (BOT_OWNER_IDS): faqat FOUNDER hisob kodi qabul qilinadi
 * @returns {ok:true, user, prev}
 *        | {ok:false, reason:'invalid'|'expired', blocked_until}
 *        | {ok:false, reason:'blocked', blocked_until}
 *        | {ok:false, reason:'owner_foreign', target}
 *        | {ok:false, reason:'confirm', target, current, hash}  — tg id boshqa hisobga bog'langan: tasdiq kartasi kerak
 */
export function linkByCode(app, code, from, botKey, { owner = false } = {}) {
  const { db } = app;
  const tgId = String(from.id);
  const blocked = linkBlockedUntil(db, tgId);
  if (blocked) { recordLinkFailure(app, from, botKey, 'blocked'); return { ok: false, reason: 'blocked', blocked_until: blocked }; }
  const found = findByCode(db, code);
  if (!found.user) return { ok: false, reason: found.reason, blocked_until: recordLinkFailure(app, from, botKey, found.reason) };
  const u = found.user;
  if (owner && u.role_code !== 'FOUNDER') {
    app.audit({ user: null, ip: 'telegram', source: 'TELEGRAM' }, { action: 'TELEGRAM_LINK_REJECTED', entity: 'user', entityId: u.id, newValue: { reason: 'owner_foreign_code', bot: botKey, tg_user_id: tgId, tg_username: from.username || null, target_role: u.role_code } });
    return { ok: false, reason: 'owner_foreign', target: u };
  }
  const prev = db.get('SELECT * FROM users WHERE telegram_user_id=? AND id<>?', tgId, u.id);
  if (prev) {
    const hash = linkCodeHash(found.code);
    stateSet(db, pendingKey(tgId), { h: hash, uid: u.id, at: nowIso(), bot: botKey });
    return { ok: false, reason: 'confirm', target: u, current: prev, hash };
  }
  return applyLink(app, u, from, botKey, null);
}

/**
 * Tasdiq kartasi tugmasi (lnk:ok:<hash>): kutilayotgan bog'lash shu tg id uchun, 10 daqiqa ichida, kod hali o'zgarmagan bo'lsa bajariladi.
 * @returns {ok:true, user, prev} | {ok:false, reason:'expired'|'owner_foreign'}
 */
export function confirmPendingLink(app, from, hash, botKey, { owner = false } = {}) {
  const { db } = app;
  const tgId = String(from.id);
  const st = stateGet(db, pendingKey(tgId));
  if (!st || !hash || st.h !== String(hash)) return { ok: false, reason: 'expired' };
  stateDel(db, pendingKey(tgId)); // bir martalik
  if (Date.now() - Date.parse(st.at) > LINK_CONFIRM_TTL_MS) return { ok: false, reason: 'expired' };
  const u = db.get('SELECT * FROM users WHERE id=? AND is_active=1', st.uid);
  if (!u?.telegram_link_code || linkCodeHash(u.telegram_link_code) !== st.h) return { ok: false, reason: 'expired' };
  if (!u.telegram_link_expires || u.telegram_link_expires < nowIso()) return { ok: false, reason: 'expired' };
  if (owner && u.role_code !== 'FOUNDER') return { ok: false, reason: 'owner_foreign', target: u };
  const prev = db.get('SELECT * FROM users WHERE telegram_user_id=? AND id<>?', tgId, u.id);
  return applyLink(app, u, from, botKey, prev);
}

/** Tasdiq kartasi «✖️ Bekor» — kutilayotgan bog'lash o'chiriladi, joriy bog'lanish o'zgarmaydi */
export function cancelPendingLink(db, tgId) {
  return db.run('DELETE FROM bot_state WHERE key=?', pendingKey(String(tgId))).changes > 0;
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
