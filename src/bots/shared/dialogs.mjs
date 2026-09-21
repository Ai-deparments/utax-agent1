/**
 * Ko'p qadamli dialog holati (FSM) — bot_dialogs jadvalida, server qayta ishga tushsa ham saqlanadi.
 * Kalit: `${botKey}:${chatId}`. Holat: { name, step, data, started_at, tag }. Muddati: 30 daqiqa harakatsizlik.
 * Muddati o'tgan qator darhol o'chirilmaydi: STALE_GRACE_MS (24 soat) davomida saqlanadi — foydalanuvchi qaytib yozsa
 * get() bir marta {expired:true} qaytaradi (bot «⌛ muddati tugagan» deydi, javob AI'ga ketmaydi), keyin o'chadi.
 */
import crypto from 'node:crypto';
import { nowIso, sha256 } from '../../core/util.mjs';

export const STALE_GRACE_MS = 24 * 3600e3;

/** Dialogning qisqa tegi (6 hex) — «✖️ Bekor» tugmasi `x:<teg>` qaysi dialogniki ekanini bildiradi; tegsiz eski yozuvlar uchun started_at'dan */
export const newDialogTag = () => crypto.randomBytes(3).toString('hex');
export function dialogTag(st) {
  if (!st || st.expired) return null;
  if (st.tag) return String(st.tag);
  return sha256(`${st.name}|${st.started_at || ''}`).slice(0, 6);
}

export function createDialogStore(db, { ttlMs = 30 * 60e3, staleGraceMs = STALE_GRACE_MS } = {}) {
  const exp = () => new Date(Date.now() + ttlMs).toISOString();
  return {
    ttlMs,
    get(key) {
      const r = db.get('SELECT state, expires_at FROM bot_dialogs WHERE key=?', key);
      if (!r) return null;
      if (r.expires_at < nowIso()) { db.run('DELETE FROM bot_dialogs WHERE key=?', key); return { expired: true }; }
      try { return JSON.parse(r.state); } catch { return null; }
    },
    set(key, state) {
      db.run('INSERT INTO bot_dialogs (key, state, updated_at, expires_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at, expires_at=excluded.expires_at', key, JSON.stringify(state), nowIso(), exp());
      return state;
    },
    clear(key) { return db.run('DELETE FROM bot_dialogs WHERE key=?', key).changes > 0; },
    /** Foydalanuvchining barcha botlardagi dialoglari (Kill switch / uzish) */
    clearChat(chatId) { return db.run('DELETE FROM bot_dialogs WHERE key LIKE ?', `%:${chatId}`).changes; },
    /** Runtime har daqiqada: muddati grace'dan (24 soat) ham oldin tugaganlar — ogohlantirish uchun yangiroqlari qoladi */
    purgeExpired() { return db.run('DELETE FROM bot_dialogs WHERE expires_at < ?', new Date(Date.now() - staleGraceMs).toISOString()).changes; },
  };
}
