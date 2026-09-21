/**
 * Egalar (BOT_OWNER_IDS): shu Telegram id'lar har doim FOUNDER ("Founder / Owner") — barcha 4 botga va barcha buyruqlarga kiradi,
 * web kodisiz avtomatik bog'lanadi. Server ishga tushganda (ensureOwners) va ega botga birinchi yozganda (ensureOwner) ta'minlanadi.
 * Ega boshqa rolli hisobga bog'langan bo'lsa — rol FOUNDER ga ko'tariladi (audit bilan).
 */
import crypto from 'node:crypto';
import { hashPassword } from '../../core/auth.mjs';
import { nowIso } from '../../core/util.mjs';

const SYSTEM = { user: null, ip: 'telegram', source: 'SYSTEM' };
const defaultName = (id) => `Ega ${id}`;
const profileName = (p) => [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim();

export const isOwnerId = (ownerIds, tgId) => !!tgId && (ownerIds || []).includes(String(tgId));

/** Bitta ega: bog'langan foydalanuvchini FOUNDER qiladi yoki yangi FOUNDER foydalanuvchi yaratadi. Qaytaradi: users qatori */
export function ensureOwner(app, tgId, profile = {}) {
  const { db } = app;
  const id = String(tgId);
  let u = db.get('SELECT * FROM users WHERE telegram_user_id=?', id);
  if (!u) {
    const email = `tg${id}@owner.utax.uz`;
    const existing = db.get('SELECT * FROM users WHERE lower(email)=lower(?)', email);
    if (existing) {
      db.run('UPDATE users SET telegram_user_id=?, telegram_chat_id=?, telegram_username=COALESCE(?, telegram_username), telegram_linked_at=? WHERE id=?', id, id, profile.username || null, nowIso(), existing.id);
      u = db.get('SELECT * FROM users WHERE id=?', existing.id);
    } else {
      const uid = db.insert('users', {
        email, password_hash: hashPassword(crypto.randomBytes(24).toString('base64url')), name: profileName(profile) || defaultName(id), role_code: 'FOUNDER',
        telegram_user_id: id, telegram_chat_id: id, telegram_username: profile.username || null, telegram_linked_at: nowIso(), is_active: 1, created_at: nowIso(),
      });
      app.audit(SYSTEM, { action: 'OWNER_PROVISIONED', entity: 'user', entityId: uid, newValue: { telegram_user_id: id, role: 'FOUNDER', email } });
      return db.get('SELECT * FROM users WHERE id=?', uid);
    }
  }
  const upd = {};
  if (u.role_code !== 'FOUNDER') upd.role_code = 'FOUNDER';
  if (!u.is_active) upd.is_active = 1;
  if (Object.keys(upd).length) {
    db.update('users', u.id, upd);
    app.audit(SYSTEM, { action: 'OWNER_ROLE_ENFORCED', entity: 'user', entityId: u.id, oldValue: { role: u.role_code, is_active: !!u.is_active }, newValue: { role: 'FOUNDER', is_active: true, telegram_user_id: id } });
  }
  const pname = profileName(profile);
  if (pname && u.name === defaultName(id)) db.run('UPDATE users SET name=? WHERE id=?', pname, u.id);
  if (profile.username && profile.username !== u.telegram_username) db.run('UPDATE users SET telegram_username=? WHERE id=?', profile.username, u.id);
  return db.get('SELECT * FROM users WHERE id=?', u.id);
}

/** Server ishga tushganda: barcha egalar tayyor bo'lsin (FOUNDER bildirishnomalari ham ularga boradi) */
export function ensureOwners(app, ownerIds) {
  return (ownerIds || []).map((id) => ensureOwner(app, id));
}
