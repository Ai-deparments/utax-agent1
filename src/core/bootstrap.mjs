import { hashPassword, verifyPassword } from './auth.mjs';
import { nowIso } from './util.mjs';

/**
 * Web uchun birinchi administrator (FOUNDER) — .env dagi ADMIN_EMAIL / ADMIN_PASSWORD dan (demo foydalanuvchilar o'rniga).
 *  - foydalanuvchi yo'q → yaratiladi (parol majburiy, kamida 8 belgi);
 *  - bor → faol va FOUNDER qilinadi; ADMIN_PASSWORD berilgan va joriy parolga mos kelmasa — yangilanadi, ochiq sessiyalar yopiladi;
 *  - ADMIN_PASSWORD bo'sh bo'lsa mavjud parolga tegilmaydi.
 * Parol hech qachon logga/natijaga chiqmaydi.
 * @returns {{ action: 'created'|'updated'|'unchanged'|'skipped', email?: string, reason?: string }}
 */
export function ensureBootstrapAdmin(app, { email, password, name } = {}) {
  const db = app.db;
  const em = String(email || '').trim().toLowerCase();
  if (!em) return { action: 'skipped', reason: 'ADMIN_EMAIL berilmagan' };
  if (!/^[^\s@]+@[^\s@]+$/.test(em)) return { action: 'skipped', reason: 'ADMIN_EMAIL noto‘g‘ri' };
  const pw = password ? String(password) : '';
  if (pw && pw.length < 8) return { action: 'skipped', reason: 'ADMIN_PASSWORD kamida 8 belgi bo‘lishi kerak' };
  const ctx = { user: null, source: 'SYSTEM', ip: null };
  const u = db.get('SELECT * FROM users WHERE lower(email)=?', em);
  if (!u) {
    if (!pw) return { action: 'skipped', reason: 'ADMIN_PASSWORD berilmagan — administrator yaratilmadi' };
    const id = db.insert('users', { email: em, password_hash: hashPassword(pw), name: String(name || '').trim() || 'Administrator', role_code: 'FOUNDER', department_id: null, phone: null, created_at: nowIso() });
    app.audit(ctx, { action: 'CREATE', entity: 'user', entityId: id, newValue: { email: em, role_code: 'FOUNDER', source: 'ADMIN_EMAIL' } });
    return { action: 'created', email: em };
  }
  const upd = {};
  if (u.role_code !== 'FOUNDER') upd.role_code = 'FOUNDER';
  if (!u.is_active) upd.is_active = 1;
  const pwChanged = !!pw && !verifyPassword(pw, u.password_hash);
  if (pwChanged) upd.password_hash = hashPassword(pw);
  if (!Object.keys(upd).length) return { action: 'unchanged', email: em };
  db.tx(() => {
    db.update('users', u.id, upd);
    if (pwChanged) db.run('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL', nowIso(), u.id);
  });
  app.audit(ctx, { action: 'UPDATE', entity: 'user', entityId: u.id, oldValue: { role_code: u.role_code, is_active: u.is_active }, newValue: { role_code: 'FOUNDER', is_active: 1, password_changed: pwChanged, source: 'ADMIN_EMAIL' } });
  return { action: 'updated', email: em };
}
