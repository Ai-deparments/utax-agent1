import { hashPassword } from '../core/auth.mjs';
import { badRequest, notFound, conflict } from '../core/http.mjs';
import { ACTIONS, RESOURCES, ROLES } from '../core/rbac.mjs';
import { nowIso } from '../core/util.mjs';

export function register(app) {
  const { r, db, audit, rbac } = app;
  const pub = (u) => ({
    id: u.id, email: u.email, name: u.name, role_code: u.role_code, department_id: u.department_id, department: u.department,
    phone: u.phone, is_active: !!u.is_active, totp_enabled: !!u.totp_enabled, telegram_linked: !!u.telegram_user_id, telegram_username: u.telegram_username || null, last_login_at: u.last_login_at, created_at: u.created_at,
  });

  app.services.users = {
    pub,
    get(id) { return db.get('SELECT u.*, d.name AS department FROM users u LEFT JOIN departments d ON d.id=u.department_id WHERE u.id=?', id); },
    list({ active } = {}) { return db.all(`SELECT u.*, d.name AS department FROM users u LEFT JOIN departments d ON d.id=u.department_id ${active === undefined ? '' : 'WHERE u.is_active=?'} ORDER BY u.id`, ...(active === undefined ? [] : [active ? 1 : 0])); },
    byTelegramId(tgId) { return tgId ? db.get('SELECT * FROM users WHERE telegram_user_id=?', String(tgId)) : null; },
    /** Kill switch: bloklangan foydalanuvchi web'ga kira olmaydi, hech bir bot javob bermaydi */
    setActive(id, active, ctx) {
      const u = db.get('SELECT * FROM users WHERE id=?', id);
      if (!u) throw notFound('Foydalanuvchi topilmadi');
      if (!active && u.role_code === 'FOUNDER') throw badRequest('Ta’sischini bloklab bo‘lmaydi');
      if (!active && ctx?.user?.id === u.id) throw badRequest('O‘zingizni bloklay olmaysiz');
      db.run('UPDATE users SET is_active=? WHERE id=?', active ? 1 : 0, u.id);
      if (!active) {
        db.run('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL', nowIso(), u.id);
        if (u.telegram_user_id) db.run("DELETE FROM bot_dialogs WHERE key LIKE ?", `%:${u.telegram_user_id}`);
      }
      audit(ctx, { action: active ? 'USER_UNBLOCKED' : 'USER_BLOCKED', entity: 'user', entityId: u.id, oldValue: { is_active: !!u.is_active }, newValue: { is_active: !!active } });
      return pub(db.get('SELECT u.*, d.name AS department FROM users u LEFT JOIN departments d ON d.id=u.department_id WHERE u.id=?', u.id));
    },
  };

  r.get('/api/users', { perm: ['users', 'VIEW'], tags: ['users'], summary: 'Foydalanuvchilar ro‘yxati' }, async () =>
    db.all('SELECT u.*, d.name AS department FROM users u LEFT JOIN departments d ON d.id=u.department_id ORDER BY u.id').map(pub));

  r.post('/api/users', { perm: ['users', 'CREATE'], tags: ['users'], summary: 'Foydalanuvchi yaratish' }, async (ctx) => {
    const b = ctx.body || {};
    if (!b.email || !b.name || !b.role_code || !b.password) throw badRequest('email, name, role_code, password majburiy');
    if (!ROLES.some((x) => x.code === b.role_code)) throw badRequest('Noma’lum rol');
    if (db.get('SELECT id FROM users WHERE lower(email)=lower(?)', b.email)) throw conflict('Bunday email mavjud');
    const id = db.insert('users', { email: b.email.trim(), password_hash: hashPassword(b.password), name: b.name, role_code: b.role_code, department_id: b.department_id || null, phone: b.phone || null, created_at: nowIso() });
    audit(ctx, { action: 'CREATE', entity: 'user', entityId: id, newValue: { email: b.email, role: b.role_code } });
    return pub(db.get('SELECT * FROM users WHERE id=?', id));
  });

  r.patch('/api/users/:id', { perm: ['users', 'EDIT'], tags: ['users'], summary: 'Foydalanuvchini tahrirlash' }, async (ctx) => {
    const u = db.get('SELECT * FROM users WHERE id=?', ctx.params.id);
    if (!u) throw notFound();
    const b = ctx.body || {};
    const upd = {};
    for (const k of ['name', 'role_code', 'department_id', 'phone', 'is_active']) if (b[k] !== undefined) upd[k] = b[k];
    if (b.password) upd.password_hash = hashPassword(b.password);
    db.update('users', u.id, upd);
    audit(ctx, { action: 'UPDATE', entity: 'user', entityId: u.id, oldValue: { role: u.role_code, active: u.is_active }, newValue: b });
    return pub(db.get('SELECT * FROM users WHERE id=?', u.id));
  });

  r.get('/api/roles', { perm: ['users', 'VIEW'], tags: ['users'], summary: 'Rollar va ruxsat matritsasi' }, async () => ({
    roles: db.all('SELECT * FROM roles ORDER BY rank DESC'), resources: RESOURCES, actions: ACTIONS, matrix: rbac.matrix(),
  }));

  r.put('/api/roles/:code/permissions', { perm: ['settings', 'EDIT'], tags: ['users'], summary: 'Rol ruxsatlarini yangilash {resource: [actions]}' }, async (ctx) => {
    const role = db.get('SELECT * FROM roles WHERE code=?', ctx.params.code);
    if (!role) throw notFound('Rol topilmadi');
    if (role.code === 'FOUNDER') throw badRequest('Founder ruxsatlari o‘zgartirilmaydi');
    const matrix = ctx.body?.matrix || {};
    const old = rbac.matrix()[role.code];
    db.tx(() => {
      db.run('DELETE FROM permissions WHERE role_code=?', role.code);
      for (const [resource, actions] of Object.entries(matrix)) {
        if (!RESOURCES.includes(resource)) continue;
        for (const a of actions) if (ACTIONS.includes(a)) db.run('INSERT OR IGNORE INTO permissions (role_code,resource,action) VALUES (?,?,?)', role.code, resource, a);
      }
    });
    rbac.reload();
    audit(ctx, { action: 'PERMISSIONS_UPDATED', entity: 'role', entityId: null, oldValue: old, newValue: matrix });
    return { ok: true, matrix: rbac.matrix()[role.code] };
  });

  r.get('/api/departments', { tags: ['users'], summary: 'Bo‘limlar' }, async () =>
    db.all('SELECT d.*, u.name AS head_name, st.code AS service_code FROM departments d LEFT JOIN users u ON u.id=d.head_user_id LEFT JOIN service_types st ON st.id=d.service_type_id ORDER BY d.name'));
  r.post('/api/departments', { perm: ['settings', 'EDIT'], tags: ['users'], summary: 'Bo‘lim yaratish' }, async (ctx) => {
    const b = ctx.body || {};
    if (!b.name) throw badRequest('name majburiy');
    const id = db.insert('departments', { code: b.code || b.name.toUpperCase().replace(/\s+/g, '_'), name: b.name, head_user_id: b.head_user_id || null, service_type_id: b.service_type_id || null });
    audit(ctx, { action: 'CREATE', entity: 'department', entityId: id, newValue: b });
    return db.get('SELECT * FROM departments WHERE id=?', id);
  });
  r.patch('/api/departments/:id', { perm: ['settings', 'EDIT'], tags: ['users'], summary: 'Bo‘limni tahrirlash' }, async (ctx) => {
    const d = db.get('SELECT * FROM departments WHERE id=?', ctx.params.id);
    if (!d) throw notFound();
    const b = ctx.body || {};
    const upd = {};
    for (const k of ['name', 'code', 'head_user_id', 'service_type_id', 'is_active']) if (b[k] !== undefined) upd[k] = b[k];
    db.update('departments', d.id, upd);
    audit(ctx, { action: 'UPDATE', entity: 'department', entityId: d.id, oldValue: d, newValue: upd });
    return db.get('SELECT * FROM departments WHERE id=?', d.id);
  });
}
