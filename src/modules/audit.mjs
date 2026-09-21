export function register(app) {
  const { r, db } = app;
  r.get('/api/audit', { perm: ['audit', 'VIEW'], tags: ['audit'], summary: 'Audit log', query: ['entity', 'entity_id', 'user_id', 'action', 'from', 'to', 'q'] }, async (ctx) => {
    const w = ['1=1'], p = [];
    const q = ctx.query;
    if (q.entity) { w.push('a.entity=?'); p.push(q.entity); }
    if (q.entity_id) { w.push('a.entity_id=?'); p.push(q.entity_id); }
    if (q.user_id) { w.push('a.user_id=?'); p.push(q.user_id); }
    if (q.action) { w.push('a.action = ?'); p.push(q.action); }
    if (q.from) { w.push('a.ts>=?'); p.push(q.from); }
    if (q.to) { w.push('a.ts<=?'); p.push(q.to + 'T23:59:59'); }
    if (q.q) { w.push('(a.action LIKE ? OR a.entity LIKE ? OR a.new_value LIKE ? OR a.old_value LIKE ?)'); p.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
    return db.all(`SELECT a.*, u.name AS user_name, u.email AS user_email FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE ${w.join(' AND ')} ORDER BY a.ts DESC, a.id DESC LIMIT 1000`, ...p);
  });
  r.get('/api/audit/stats', { perm: ['audit', 'VIEW'], tags: ['audit'], summary: 'Audit statistikasi' }, async () => ({
    total: db.get('SELECT COUNT(*) n FROM audit_logs').n,
    by_action: db.all('SELECT action, COUNT(*) n FROM audit_logs GROUP BY action ORDER BY n DESC LIMIT 20'),
    by_user: db.all('SELECT COALESCE(u.name, a.role) name, COUNT(*) n FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id GROUP BY 1 ORDER BY n DESC LIMIT 20'),
    ai_actions: db.get("SELECT COUNT(*) n FROM audit_logs WHERE ai_agent_code IS NOT NULL").n,
  }));
}
