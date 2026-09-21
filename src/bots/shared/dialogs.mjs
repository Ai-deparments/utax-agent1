/**
 * Ko'p qadamli dialog holati (FSM) — bot_dialogs jadvalida, server qayta ishga tushsa ham saqlanadi.
 * Kalit: `${botKey}:${chatId}`. Holat: { name, step, data, started_at }. Muddati: 30 daqiqa harakatsizlik.
 */
import { nowIso } from '../../core/util.mjs';

export function createDialogStore(db, { ttlMs = 30 * 60e3 } = {}) {
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
    purgeExpired() { return db.run('DELETE FROM bot_dialogs WHERE expires_at < ?', nowIso()).changes; },
  };
}
