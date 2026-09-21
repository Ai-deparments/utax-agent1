import { badRequest, notFound } from '../core/http.mjs';
import { nowIso } from '../core/util.mjs';

export function register(app) {
  const { r, db, audit } = app;
  r.get('/api/companies', { perm: ['contracts', 'VIEW'], tags: ['companies'], summary: 'Kontragentlar (mijozlar)' , query: ['q'] }, async (ctx) => {
    const q = ctx.query.q ? `%${ctx.query.q}%` : null;
    return db.all(
      `SELECT c.*, u.name AS manager_name,
        (SELECT COUNT(*) FROM contracts k WHERE k.company_id=c.id) AS contracts_count,
        (SELECT COALESCE(SUM(k.amount),0) FROM contracts k WHERE k.company_id=c.id AND k.contract_status NOT IN ('CANCELLED','DRAFT')) AS contracts_total
       FROM companies c LEFT JOIN users u ON u.id=c.manager_user_id
       WHERE c.is_active=1 ${q ? 'AND (c.name LIKE ? OR c.inn LIKE ?)' : ''} ORDER BY c.name`, ...(q ? [q, q] : []));
  });
  r.post('/api/companies', { perm: ['contracts', 'CREATE'], tags: ['companies'], summary: 'Kontragent yaratish' }, async (ctx) => {
    const b = ctx.body || {};
    if (!b.name) throw badRequest('name majburiy');
    const id = db.insert('companies', { name: b.name.trim(), inn: b.inn || null, phone: b.phone || null, email: b.email || null, address: b.address || null, director: b.director || null, manager_user_id: b.manager_user_id || ctx.user.id, kind: b.kind || 'CLIENT', notes: b.notes || null, created_at: nowIso() });
    audit(ctx, { action: 'CREATE', entity: 'company', entityId: id, newValue: b });
    return db.get('SELECT * FROM companies WHERE id=?', id);
  });
  r.get('/api/companies/:id', { perm: ['contracts', 'VIEW'], tags: ['companies'], summary: 'Kontragent kartasi' }, async (ctx) => {
    const c = db.get('SELECT * FROM companies WHERE id=?', ctx.params.id);
    if (!c) throw notFound();
    return { ...c, contracts: app.services.contracts.list({ company_id: c.id }) };
  });
  r.patch('/api/companies/:id', { perm: ['contracts', 'EDIT'], tags: ['companies'], summary: 'Kontragentni tahrirlash' }, async (ctx) => {
    const c = db.get('SELECT * FROM companies WHERE id=?', ctx.params.id);
    if (!c) throw notFound();
    const upd = {};
    for (const k of ['name', 'inn', 'phone', 'email', 'address', 'director', 'manager_user_id', 'kind', 'notes', 'is_active']) if (ctx.body?.[k] !== undefined) upd[k] = ctx.body[k];
    db.update('companies', c.id, upd);
    audit(ctx, { action: 'UPDATE', entity: 'company', entityId: c.id, oldValue: c, newValue: upd });
    return db.get('SELECT * FROM companies WHERE id=?', c.id);
  });
}
