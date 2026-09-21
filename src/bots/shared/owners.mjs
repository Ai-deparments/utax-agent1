/**
 * Egalar (BOT_OWNER_IDS): shu Telegram id'lar har doim FOUNDER ("Founder / Owner") — barcha 4 botga va barcha buyruqlarga kiradi,
 * web kodisiz avtomatik bog'lanadi. Server ishga tushganda (ensureOwners) va ega botga yozganda (ensureOwner) ta'minlanadi.
 *
 * Qoida: ega HECH QACHON boshqa rolli hisobni FOUNDER ga ko'tarmaydi.
 *   • tg id FOUNDER hisobga bog'langan bo'lsa — shu hisob ishlatiladi;
 *   • aks holda tg id egasining alohida hisobiga (tg<id>@owner.utax.uz, kerak bo'lsa yaratiladi) ko'chiriladi —
 *     eski hisob roli o'zgarmaydi, uning shu Telegram bilan ochilgan sessiyalari yopiladi (OWNER_RELINKED audit).
 * Ega /start KOD bilan faqat allaqachon FOUNDER bo'lgan hisobga bog'lana oladi (auth.mjs linkByCode {owner:true}).
 */
import crypto from 'node:crypto';
import { hashPassword } from '../../core/auth.mjs';
import { nowIso } from '../../core/util.mjs';
import { detachTelegram } from './auth.mjs';

const SYSTEM = { user: null, ip: 'telegram', source: 'SYSTEM' };
const defaultName = (id) => `Ega ${id}`;
const profileName = (p) => [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim();
export const ownerEmail = (tgId) => `tg${tgId}@owner.utax.uz`;

export const isOwnerId = (ownerIds, tgId) => !!tgId && (ownerIds || []).includes(String(tgId));

/** Egasining alohida hisobi (tg<id>@owner.utax.uz) — bo'lmasa yaratiladi (FOUNDER, tasodifiy parol). Qaytaradi: {row, created} */
function dedicatedAccount(app, id, profile) {
  const { db } = app;
  const email = ownerEmail(id);
  const existing = db.get('SELECT * FROM users WHERE lower(email)=lower(?)', email);
  if (existing) return { row: existing, created: false };
  const uid = db.insert('users', {
    email, password_hash: hashPassword(crypto.randomBytes(24).toString('base64url')), name: profileName(profile) || defaultName(id), role_code: 'FOUNDER',
    is_active: 1, created_at: nowIso(),
  });
  app.audit(SYSTEM, { action: 'OWNER_PROVISIONED', entity: 'user', entityId: uid, newValue: { telegram_user_id: id, role: 'FOUNDER', email } });
  return { row: db.get('SELECT * FROM users WHERE id=?', uid), created: true };
}

/** Bitta ega → uning FOUNDER hisobi (bog'langan FOUNDER yoki alohida ega hisobi). Qaytaradi: users qatori */
export function ensureOwner(app, tgId, profile = {}) {
  const { db } = app;
  const id = String(tgId);
  const linked = db.get('SELECT * FROM users WHERE telegram_user_id=?', id);
  let u = linked;
  if (!linked || (linked.role_code !== 'FOUNDER' && linked.email.toLowerCase() !== ownerEmail(id))) {
    const { row: d, created } = dedicatedAccount(app, id, profile);
    db.tx(() => {
      if (linked) detachTelegram(db, linked.id, id); // eski hisob roli o'zgarmaydi; shu Telegram bilan ochilgan sessiyalari yopiladi
      if (d.telegram_user_id && d.telegram_user_id !== id) detachTelegram(db, d.id, d.telegram_user_id);
      db.run('UPDATE users SET telegram_user_id=?, telegram_chat_id=?, telegram_username=COALESCE(?, telegram_username), telegram_linked_at=? WHERE id=?', id, id, profile.username || null, nowIso(), d.id);
      db.run('UPDATE bot_chats SET user_id=? WHERE tg_user_id=?', d.id, id);
    });
    // Boshqa hisobdan ko'chirish yoki uzilgandan keyin qayta ulash — audit (birinchi yaratish OWNER_PROVISIONED bilan yozilgan)
    if (linked || !created) {
      app.audit(SYSTEM, { action: 'OWNER_RELINKED', entity: 'user', entityId: d.id, oldValue: linked ? { user_id: linked.id, role: linked.role_code, email: linked.email } : { user_id: null }, newValue: { user_id: d.id, telegram_user_id: id, role: 'FOUNDER' } });
    }
    u = db.get('SELECT * FROM users WHERE id=?', d.id);
  }
  // FOUNDER/faol holat faqat egasining o'z hisobida (bog'langan FOUNDER yoki alohida ega hisobi) ta'minlanadi
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

/** Server ishga tushganda: barcha egalar tayyor bo'lsin (FOUNDER bildirishnomalari ham ularga boradi) — xuddi shu qoida bilan */
export function ensureOwners(app, ownerIds) {
  return (ownerIds || []).map((id) => ensureOwner(app, id));
}
