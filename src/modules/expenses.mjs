import { badRequest, notFound, forbidden } from '../core/http.mjs';
import { nowIso, today, round2, parseJson, resolvePeriod, padCode, monthOf, addMonths, monthRange } from '../core/util.mjs';

export const EXPENSE_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'POSTPONED', 'PAID', 'CANCELLED'];

export function register(app) {
  const { r, db, audit, settings } = app;

  /** Rule-based kategoriyalash (keywords) — LLM bo'lsa u ham ishlatiladi; past confidence → human confirmation */
  function suggestCategory(text) {
    const t = String(text || '').toLowerCase();
    let best = null;
    for (const c of db.all('SELECT id, code, name, keywords FROM expense_categories WHERE is_active=1')) {
      const kws = parseJson(c.keywords, []) || [];
      let hits = 0;
      for (const k of kws) if (t.includes(String(k).toLowerCase())) hits++;
      if (hits && (!best || hits > best.hits)) best = { ...c, hits };
    }
    if (!best) return { category_id: null, confidence: 0 };
    const confidence = Math.min(0.97, 0.6 + best.hits * 0.15);
    return { category_id: best.id, code: best.code, name: best.name, confidence: round2(confidence) };
  }

  const SELECT = `SELECT e.*, ec.name AS category_name, ec.code AS category_code, ec.pnl_group, d.name AS department_name, u.name AS requested_by_name, c.contract_number,
      ap.status AS approval_status, ap.current_step AS approval_step, ap.steps AS approval_steps
    FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id LEFT JOIN departments d ON d.id=e.department_id
    LEFT JOIN users u ON u.id=e.requested_by LEFT JOIN contracts c ON c.id=e.contract_id LEFT JOIN approvals ap ON ap.id=e.approval_id`;

  const svc = {
    suggestCategory,
    categories() { return db.all('SELECT id, code, name, pnl_group FROM expense_categories WHERE is_active=1 ORDER BY sort, name'); },
    nextCode() {
      const last = db.get("SELECT code FROM expenses WHERE code LIKE 'EXP-%' ORDER BY CAST(substr(code,5) AS INTEGER) DESC LIMIT 1");
      return padCode('EXP', last ? Number(last.code.slice(4)) + 1 : 1);
    },
    list(f = {}, user) {
      const w = ['e.reversed_at IS NULL'], p = [];
      if (f.status) { w.push('e.status=?'); p.push(f.status); }
      if (f.department_id) { w.push('e.department_id=?'); p.push(f.department_id); }
      if (f.category_id) { w.push('e.category_id=?'); p.push(f.category_id); }
      if (f.from) { w.push('e.expense_date>=?'); p.push(f.from); }
      if (f.to) { w.push('e.expense_date<=?'); p.push(f.to); }
      if (f.contract_id) { w.push('e.contract_id=?'); p.push(f.contract_id); }
      if (f.q) { w.push('(e.purpose LIKE ? OR e.code LIKE ? OR e.counterparty LIKE ?)'); p.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`); }
      if (user?.role_code === 'EMPLOYEE') { w.push('e.requested_by=?'); p.push(user.id); }
      if (user?.role_code === 'DEPARTMENT_HEAD' && user.department_id) { w.push('(e.department_id=? OR e.requested_by=?)'); p.push(user.department_id, user.id); }
      return db.all(`${SELECT} WHERE ${w.join(' AND ')} ORDER BY e.expense_date DESC, e.id DESC LIMIT 2000`, ...p).map((e) => ({ ...e, approval_steps: parseJson(e.approval_steps, null) }));
    },
    get(id) { const e = db.get(`${SELECT} WHERE e.id=?`, id); return e ? { ...e, approval_steps: parseJson(e.approval_steps, null) } : null; },
    /** Xodim so'rovi → approval engine */
    request(b, ctx) {
      if (!b.amount || !b.purpose) throw badRequest('amount va purpose majburiy');
      const amount = round2(b.amount);
      const department_id = b.department_id || ctx.user?.department_id || null;
      let category_id = b.category_id || null, category_confidence = category_id ? 1 : null, category_source = category_id ? 'USER' : null;
      if (!category_id) {
        const s = suggestCategory(`${b.purpose} ${b.subcategory || ''} ${b.counterparty || ''}`);
        if (s.category_id && s.confidence >= Number(settings.get('expense.category_confidence_threshold') || 0.8)) { category_id = s.category_id; category_confidence = s.confidence; category_source = 'AI_RULE'; }
        else if (s.category_id) { category_id = s.category_id; category_confidence = s.confidence; category_source = 'AI_RULE_UNCONFIRMED'; }
      }
      const code = svc.nextCode();
      const id = db.tx(() => {
        const id = db.insert('expenses', {
          code, expense_date: b.expense_date || today(), department_id, category_id, subcategory: b.subcategory || null, project: b.project || null, contract_id: b.contract_id || null, service_type_id: b.service_type_id || null,
          requested_by: ctx.user?.id || null, counterparty: b.counterparty || null, amount, currency: b.currency || 'UZS', purpose: b.purpose, required_date: b.required_date || null,
          payment_method: b.payment_method || 'BANK', status: 'PENDING', category_confidence, category_source, created_by: ctx.user?.id || null, created_at: nowIso(),
        });
        const apr = app.services.approvals.create({ entity_type: 'EXPENSE', entity_id: id, amount, title: `${code} · ${b.purpose}`, requested_by: ctx.user?.id, department_id }, ctx);
        db.run('UPDATE expenses SET approval_id=? WHERE id=?', apr.id, id);
        return id;
      });
      audit(ctx, { action: 'EXPENSE_REQUESTED', entity: 'expense', entityId: id, newValue: { code, amount, purpose: b.purpose, department_id } });
      if (amount >= Number(settings.get('expense.large_expense_alert') || Infinity)) app.services.notifications?.notify({ roles: ['CFO', 'CEO'], type: 'LARGE_EXPENSE', severity: 'WARNING', title: `Katta xarajat so‘rovi: ${code}`, body: `${amount.toLocaleString('ru-RU')} — ${b.purpose}`, entity_type: 'expense', entity_id: id, dedupe_key: `large-exp:${id}` });
      return svc.get(id);
    },
    /** To'g'ridan-to'g'ri (buxgalter) — tasdiqlangan yoki to'langan xarajat kiritish */
    createDirect(b, ctx) {
      if (!b.amount || !b.purpose) throw badRequest('amount va purpose majburiy');
      const status = ['APPROVED', 'PAID'].includes(b.status) ? b.status : 'APPROVED';
      const code = b.code || svc.nextCode();
      const id = db.insert('expenses', {
        code, expense_date: b.expense_date || today(), department_id: b.department_id || null, category_id: b.category_id || suggestCategory(b.purpose).category_id, subcategory: b.subcategory || null, project: b.project || null,
        contract_id: b.contract_id || null, service_type_id: b.service_type_id || null, requested_by: b.requested_by || ctx.user?.id || null, counterparty: b.counterparty || null, amount: round2(b.amount), currency: b.currency || 'UZS',
        purpose: b.purpose, required_date: b.required_date || null, payment_method: b.payment_method || 'BANK', status, approver_id: ctx.user?.id || null, approved_at: nowIso(), paid_at: status === 'PAID' ? b.paid_at || b.expense_date || today() : null,
        category_source: b.category_id ? 'USER' : 'AI_RULE', is_recurring: b.is_recurring ? 1 : 0, created_by: ctx.user?.id || null, created_at: nowIso(),
      });
      audit(ctx, { action: 'EXPENSE_CREATED', entity: 'expense', entityId: id, newValue: { code, amount: b.amount, status } });
      return svc.get(id);
    },
    update(id, b, ctx) {
      const e = db.get('SELECT * FROM expenses WHERE id=?', id);
      if (!e) throw notFound();
      if (['PAID'].includes(e.status) && ctx.user.role_code !== 'FOUNDER' && ctx.user.role_code !== 'CFO') throw badRequest('To‘langan xarajat tahrirlanmaydi — reversal qiling');
      const upd = {};
      for (const k of ['expense_date', 'department_id', 'category_id', 'subcategory', 'project', 'contract_id', 'service_type_id', 'counterparty', 'purpose', 'required_date', 'payment_method', 'receipt_path']) if (b[k] !== undefined) upd[k] = b[k];
      if (b.category_id !== undefined) { upd.category_confidence = 1; upd.category_source = 'USER'; }
      if (b.amount !== undefined && e.status === 'PENDING') upd.amount = round2(b.amount);
      upd.updated_at = nowIso();
      db.update('expenses', id, upd);
      audit(ctx, { action: 'UPDATE', entity: 'expense', entityId: id, oldValue: e, newValue: upd });
      return svc.get(id);
    },
    markPaid(id, { bank_transaction_id, cash_transaction_id, paid_at }, ctx) {
      const e = db.get('SELECT * FROM expenses WHERE id=?', id);
      if (!e) throw notFound('Xarajat topilmadi');
      if (e.status !== 'APPROVED' && e.status !== 'PAID') throw badRequest(`Faqat APPROVED xarajat to‘lanadi (hozir ${e.status})`);
      db.run("UPDATE expenses SET status='PAID', paid_at=?, bank_transaction_id=COALESCE(?, bank_transaction_id), cash_transaction_id=COALESCE(?, cash_transaction_id), updated_at=? WHERE id=?", paid_at || today(), bank_transaction_id || null, cash_transaction_id || null, nowIso(), id);
      audit(ctx, { action: 'EXPENSE_PAID', entity: 'expense', entityId: id, newValue: { bank_transaction_id, cash_transaction_id, paid_at } });
    },
    unpay(id, ctx) {
      const e = db.get('SELECT * FROM expenses WHERE id=?', id);
      if (!e) return;
      db.run("UPDATE expenses SET status='APPROVED', paid_at=NULL, bank_transaction_id=NULL, cash_transaction_id=NULL, updated_at=? WHERE id=?", nowIso(), id);
      audit(ctx, { action: 'EXPENSE_UNPAID', entity: 'expense', entityId: id, oldValue: { paid_at: e.paid_at } });
    },
    reverse(id, ctx, reason) {
      const e = db.get('SELECT * FROM expenses WHERE id=?', id);
      if (!e) throw notFound();
      if (ctx.user.role_code === 'AI_AGENT') throw forbidden('AI agent xarajatni o‘chira olmaydi');
      db.run('UPDATE expenses SET reversed_at=?, updated_at=? WHERE id=?', nowIso(), nowIso(), id);
      audit(ctx, { action: 'EXPENSE_REVERSED', entity: 'expense', entityId: id, oldValue: e, newValue: { reason } });
      return { ok: true };
    },
    onApprovalDecided(approval, decision, ctx) {
      const e = db.get('SELECT * FROM expenses WHERE id=?', approval.entity_id);
      if (!e) return;
      if (decision === 'APPROVE') db.run("UPDATE expenses SET status='APPROVED', approver_id=?, approved_at=?, updated_at=? WHERE id=?", ctx.user?.id || null, nowIso(), nowIso(), e.id);
      else db.run("UPDATE expenses SET status='REJECTED', approver_id=?, updated_at=? WHERE id=?", ctx.user?.id || null, nowIso(), e.id);
      audit(ctx, { action: 'EXPENSE_' + (decision === 'APPROVE' ? 'APPROVED' : 'REJECTED'), entity: 'expense', entityId: e.id, approvalId: approval.id });
    },
    /** Davr bo'yicha xarajatlar (accrual: APPROVED+PAID, expense_date bo'yicha) */
    totalsByGroup(from, to) {
      return db.all(`SELECT COALESCE(ec.pnl_group,'OTHER_OPEX') AS pnl_group, COALESCE(SUM(e.amount),0) AS amount, COUNT(*) AS n FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id
        WHERE e.reversed_at IS NULL AND e.status IN ('APPROVED','PAID') AND e.expense_date BETWEEN ? AND ? GROUP BY 1`, from, to);
    },
    totalsByCategory(from, to) {
      return db.all(`SELECT ec.id, ec.code, ec.name, ec.pnl_group, COALESCE(SUM(e.amount),0) AS amount, COUNT(e.id) AS n FROM expense_categories ec LEFT JOIN expenses e ON e.category_id=ec.id AND e.reversed_at IS NULL AND e.status IN ('APPROVED','PAID') AND e.expense_date BETWEEN ? AND ?
        WHERE ec.is_active=1 GROUP BY ec.id ORDER BY amount DESC`, from, to);
    },
    total(from, to) { return db.get("SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE reversed_at IS NULL AND status IN ('APPROVED','PAID') AND expense_date BETWEEN ? AND ?", from, to).s; },
    approvedUnpaid() { return db.get("SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM expenses WHERE reversed_at IS NULL AND status='APPROVED'"); },
    expectedOutflow(from, to) {
      // tasdiqlangan to'lanmagan (required_date oynada yoki muddati o'tgan) + recurring
      const a = db.get("SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE reversed_at IS NULL AND status='APPROVED' AND COALESCE(required_date, expense_date) <= ?", to).s;
      let rec = 0;
      for (const rx of db.all('SELECT * FROM recurring_expenses WHERE is_active=1')) {
        let p = monthOf(from);
        while (p <= monthOf(to)) {
          const day = `${p}-${String(Math.min(28, rx.day_of_month || 1)).padStart(2, '0')}`;
          if (day >= from && day <= to) rec += rx.amount;
          p = addMonths(p, 1);
        }
      }
      return { approved_unpaid: round2(a), recurring: round2(rec), total: round2(a + rec) };
    },
    monthlyTotals(months = 6, asOf = today()) {
      const out = [];
      let p = addMonths(monthOf(asOf), -(months - 1));
      for (let i = 0; i < months; i++) { const { from, to } = monthRange(p); out.push({ period: p, amount: round2(svc.total(from, to)) }); p = addMonths(p, 1); }
      return out;
    },
  };
  app.services.expenses = svc;
  app.services.approvals.onDecision('EXPENSE', svc.onApprovalDecided);
  app.services.approvals.onDecision('REVENUE_RECOGNITION', (a, d, ctx) => app.services.revenue.onApprovalDecided(a, d, ctx));

  r.get('/api/expenses', { perm: ['expenses', 'VIEW'], tags: ['expenses'], summary: 'Xarajatlar', query: ['status', 'department_id', 'category_id', 'from', 'to', 'q'] }, async (ctx) => svc.list(ctx.query, ctx.user));
  r.get('/api/expenses/summary', { perm: ['expenses', 'VIEW'], tags: ['expenses'], summary: 'Xarajat xulosasi: kategoriya/bo‘lim/davr', query: ['period', 'month', 'from', 'to'] }, async (ctx) => {
    const p = resolvePeriod(ctx.query);
    return {
      period: p, total: round2(svc.total(p.from, p.to)), by_group: svc.totalsByGroup(p.from, p.to), by_category: svc.totalsByCategory(p.from, p.to),
      by_department: db.all(`SELECT d.name, COALESCE(SUM(e.amount),0) amount FROM departments d LEFT JOIN expenses e ON e.department_id=d.id AND e.reversed_at IS NULL AND e.status IN ('APPROVED','PAID') AND e.expense_date BETWEEN ? AND ? GROUP BY d.id ORDER BY amount DESC`, p.from, p.to),
      pending: db.get("SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM expenses WHERE reversed_at IS NULL AND status='PENDING'"), approved_unpaid: svc.approvedUnpaid(), monthly: svc.monthlyTotals(6),
    };
  });
  r.get('/api/expenses/categories', { tags: ['expenses'], summary: 'Xarajat kategoriyalari' }, async () => db.all('SELECT * FROM expense_categories ORDER BY sort, name').map((c) => ({ ...c, keywords: parseJson(c.keywords, []) })));
  r.post('/api/expenses/categories', { perm: ['settings', 'EDIT'], tags: ['expenses'], summary: 'Kategoriya qo‘shish' }, async (ctx) => {
    const b = ctx.body || {};
    if (!b.code || !b.name) throw badRequest('code, name majburiy');
    const id = db.insert('expense_categories', { code: b.code.toUpperCase(), name: b.name, parent_id: b.parent_id || null, pnl_group: b.pnl_group || 'OTHER_OPEX', cf_class: b.cf_class || 'OPERATING', is_direct_cost: b.is_direct_cost ? 1 : 0, keywords: JSON.stringify(b.keywords || []), sort: b.sort || 99 });
    audit(ctx, { action: 'CREATE', entity: 'expense_category', entityId: id, newValue: b });
    return db.get('SELECT * FROM expense_categories WHERE id=?', id);
  });
  r.patch('/api/expenses/categories/:id', { perm: ['settings', 'EDIT'], tags: ['expenses'], summary: 'Kategoriyani tahrirlash' }, async (ctx) => {
    const c = db.get('SELECT * FROM expense_categories WHERE id=?', ctx.params.id);
    if (!c) throw notFound();
    const b = ctx.body || {}, upd = {};
    for (const k of ['name', 'pnl_group', 'cf_class', 'is_direct_cost', 'is_active', 'sort', 'parent_id']) if (b[k] !== undefined) upd[k] = b[k];
    if (b.keywords !== undefined) upd.keywords = JSON.stringify(b.keywords);
    db.update('expense_categories', c.id, upd);
    audit(ctx, { action: 'UPDATE', entity: 'expense_category', entityId: c.id, oldValue: c, newValue: upd });
    return db.get('SELECT * FROM expense_categories WHERE id=?', c.id);
  });
  r.post('/api/expenses/categorize', { perm: ['expenses', 'VIEW'], tags: ['expenses'], summary: 'AI kategoriya taklifi {text}' }, async (ctx) => suggestCategory(ctx.body?.text));
  r.post('/api/expenses/request', { perm: ['expenses', 'CREATE'], tags: ['expenses'], summary: 'Xarajat so‘rovi (approval engine ishga tushadi)' }, async (ctx) => svc.request(ctx.body || {}, ctx));
  r.post('/api/expenses', { perm: ['expenses', 'EDIT'], tags: ['expenses'], summary: 'Buxgalter: xarajatni to‘g‘ridan-to‘g‘ri kiritish (APPROVED/PAID)' }, async (ctx) => svc.createDirect(ctx.body || {}, ctx));
  r.get('/api/expenses/:id', { perm: ['expenses', 'VIEW'], tags: ['expenses'], summary: 'Xarajat kartasi' }, async (ctx) => { const e = svc.get(ctx.params.id); if (!e) throw notFound(); return { ...e, audit: db.all("SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.entity='expense' AND a.entity_id=? ORDER BY a.ts DESC", e.id) }; });
  r.patch('/api/expenses/:id', { perm: ['expenses', 'EDIT'], tags: ['expenses'], summary: 'Xarajatni tahrirlash' }, async (ctx) => svc.update(ctx.params.id, ctx.body || {}, ctx));
  r.post('/api/expenses/:id/pay', { perm: ['expenses', 'EDIT'], tags: ['expenses'], summary: 'To‘langan deb belgilash (kassa/bank)' }, async (ctx) => { svc.markPaid(ctx.params.id, ctx.body || {}, ctx); return svc.get(ctx.params.id); });
  r.post('/api/expenses/:id/reverse', { perm: ['expenses', 'DELETE'], tags: ['expenses'], summary: 'Xarajatni reversal qilish (o‘chirish o‘rniga)' }, async (ctx) => svc.reverse(ctx.params.id, ctx, ctx.body?.reason));
  r.get('/api/recurring-expenses', { perm: ['expenses', 'VIEW'], tags: ['expenses'], summary: 'Doimiy xarajatlar (forecast/treasury uchun)' }, async () => db.all('SELECT rx.*, ec.name AS category_name FROM recurring_expenses rx LEFT JOIN expense_categories ec ON ec.id=rx.category_id ORDER BY rx.day_of_month'));
  r.post('/api/recurring-expenses', { perm: ['expenses', 'EDIT'], tags: ['expenses'], summary: 'Doimiy xarajat qo‘shish' }, async (ctx) => {
    const b = ctx.body || {};
    if (!b.name || !b.amount) throw badRequest('name, amount majburiy');
    const id = db.insert('recurring_expenses', { name: b.name, category_id: b.category_id || null, department_id: b.department_id || null, amount: round2(b.amount), day_of_month: b.day_of_month || 1 });
    audit(ctx, { action: 'CREATE', entity: 'recurring_expense', entityId: id, newValue: b });
    return db.get('SELECT * FROM recurring_expenses WHERE id=?', id);
  });
  r.patch('/api/recurring-expenses/:id', { perm: ['expenses', 'EDIT'], tags: ['expenses'], summary: 'Doimiy xarajatni tahrirlash' }, async (ctx) => {
    const x = db.get('SELECT * FROM recurring_expenses WHERE id=?', ctx.params.id);
    if (!x) throw notFound();
    const upd = {};
    for (const k of ['name', 'category_id', 'department_id', 'amount', 'day_of_month', 'is_active']) if (ctx.body?.[k] !== undefined) upd[k] = ctx.body[k];
    db.update('recurring_expenses', x.id, upd);
    audit(ctx, { action: 'UPDATE', entity: 'recurring_expense', entityId: x.id, oldValue: x, newValue: upd });
    return db.get('SELECT * FROM recurring_expenses WHERE id=?', x.id);
  });
}
