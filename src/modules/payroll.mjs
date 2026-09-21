import { badRequest, notFound } from '../core/http.mjs';
import { nowIso, today, round2, parseJson, monthRange, sum } from '../core/util.mjs';

/** KPI & PAYROLL RULE ENGINE — formulalar kpi_rules jadvalida, hard-code emas. */
export function register(app) {
  const { r, db, audit, settings } = app;

  function evalRule(rule, ctxv) {
    const p = parseJson(rule.params, {});
    switch (rule.formula) {
      case 'PCT_OF_DEPT_REVENUE': return round2((ctxv.dept_revenue || 0) * (Number(p.pct) || 0) / 100 / Math.max(1, ctxv.dept_headcount || 1));
      case 'PCT_OF_OWN_REVENUE': return round2((ctxv.own_revenue || 0) * (Number(p.pct) || 0) / 100);
      case 'PER_UNIT': return round2((ctxv.metric_value || 0) * (Number(p.rate) || 0));
      case 'THRESHOLD_BONUS': return (ctxv.metric_value || 0) >= Number(p.target || 0) ? round2(Number(p.bonus) || 0) : 0;
      case 'PCT_OF_FIXED': return round2((ctxv.fixed || 0) * (Number(p.pct) || 0) / 100 * Math.min(1, (ctxv.metric_value || 0) / Math.max(1, Number(p.target || 1))));
      default: return 0;
    }
  }

  const svc = {
    evalRule,
    compute(period, ctx) {
      const { from, to } = monthRange(period);
      const taxPct = Number(settings.get('payroll.income_tax_pct') ?? 12);
      const employees = db.all('SELECT e.*, d.service_type_id, d.name AS department_name FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE e.is_active=1');
      const out = [];
      db.tx(() => {
        for (const emp of employees) {
          const existing = db.get('SELECT * FROM payrolls WHERE period=? AND employee_id=?', period, emp.id);
          if (existing && existing.status !== 'DRAFT') { out.push(existing); continue; }
          const rules = db.all('SELECT * FROM kpi_rules WHERE is_active=1 AND (department_id=? OR department_id IS NULL) AND (service_type_id=? OR service_type_id IS NULL)', emp.department_id, emp.service_type_id);
          const dept_revenue = emp.service_type_id ? app.services.revenue.recognizedInPeriod(from, to, emp.service_type_id) : 0;
          const dept_headcount = db.get('SELECT COUNT(*) n FROM employees WHERE is_active=1 AND department_id=?', emp.department_id).n;
          const own_revenue = emp.user_id ? db.get(`SELECT COALESCE(SUM(rr.amount),0) s FROM revenue_recognition rr JOIN contracts c ON c.id=rr.contract_id WHERE rr.status='RECOGNIZED' AND rr.recognized_at BETWEEN ? AND ? AND c.manager_user_id=?`, from, to, emp.user_id).s : 0;
          let kpi = 0;
          for (const rule of rules) {
            const k = db.get('SELECT * FROM employee_kpis WHERE employee_id=? AND period=? AND kpi_rule_id=?', emp.id, period, rule.id);
            const amt = k?.kpi_amount ?? evalRule(rule, { dept_revenue, dept_headcount, own_revenue, metric_value: k?.metric_value || 0, fixed: emp.fixed_salary });
            kpi += amt;
          }
          const advance = db.get('SELECT COALESCE(SUM(amount),0) s FROM advances WHERE employee_id=? AND period=?', emp.id, period).s;
          const row = { fixed: round2(emp.fixed_salary), kpi: round2(kpi), piece_rate: existing?.piece_rate || 0, bonus: existing?.bonus || 0, penalty: existing?.penalty || 0, advance: round2(advance), certificate_bonus: existing?.certificate_bonus || 0, other: existing?.other || 0 };
          row.gross = round2(row.fixed + row.kpi + row.piece_rate + row.bonus + row.certificate_bonus + row.other - row.penalty);
          row.deductions = round2(row.gross * taxPct / 100);
          row.net = round2(row.gross - row.deductions - row.advance);
          if (existing) db.update('payrolls', existing.id, row);
          else db.insert('payrolls', { period, employee_id: emp.id, ...row, status: 'DRAFT', created_at: nowIso() });
          out.push(db.get('SELECT * FROM payrolls WHERE period=? AND employee_id=?', period, emp.id));
        }
      });
      audit(ctx, { action: 'PAYROLL_COMPUTED', entity: 'payroll', newValue: { period, rows: out.length } });
      return svc.list(period);
    },
    list(period) {
      return db.all(`SELECT p.*, e.name AS employee_name, e.position, d.name AS department_name, e.department_id FROM payrolls p JOIN employees e ON e.id=p.employee_id LEFT JOIN departments d ON d.id=e.department_id WHERE p.period=? ORDER BY d.name, e.name`, period);
    },
    summary(period) {
      const rows = svc.list(period);
      const byDept = {};
      for (const x of rows) { byDept[x.department_name || '—'] ??= { department: x.department_name || '—', gross: 0, net: 0, kpi: 0, n: 0 }; const d = byDept[x.department_name || '—']; d.gross += x.gross; d.net += x.net; d.kpi += x.kpi; d.n++; }
      const apr = db.get("SELECT * FROM approvals WHERE entity_type='PAYROLL' AND title LIKE ? ORDER BY id DESC LIMIT 1", `%${period}%`);
      return { period, rows: rows.length, gross: round2(sum(rows, (x) => x.gross)), net: round2(sum(rows, (x) => x.net)), kpi: round2(sum(rows, (x) => x.kpi)), status: rows.length ? (rows.every((x) => x.status === 'PAID') ? 'PAID' : rows.every((x) => x.status === 'APPROVED') ? 'APPROVED' : rows.some((x) => x.status === 'SUBMITTED') ? 'SUBMITTED' : 'DRAFT') : 'EMPTY', by_department: Object.values(byDept).map((d) => ({ ...d, gross: round2(d.gross), net: round2(d.net), kpi: round2(d.kpi) })), approval: apr ? { ...apr, steps: parseJson(apr.steps, []) } : null };
    },
    submit(period, ctx) {
      const rows = svc.list(period);
      if (!rows.length) throw badRequest('Avval hisoblang');
      if (rows.some((x) => x.status !== 'DRAFT')) throw badRequest('Davr allaqachon yuborilgan');
      const total = round2(sum(rows, (x) => x.net));
      const apr = app.services.approvals.create({ entity_type: 'PAYROLL', entity_id: 0, amount: total, title: `Oylik ${period} — ${rows.length} xodim`, requested_by: ctx.user.id }, ctx);
      db.run("UPDATE payrolls SET status='SUBMITTED', approval_id=? WHERE period=?", apr.id, period);
      db.run('UPDATE approvals SET entity_id=? WHERE id=?', apr.id, apr.id);
      audit(ctx, { action: 'PAYROLL_SUBMITTED', entity: 'payroll', newValue: { period, total }, approvalId: apr.id });
      return svc.summary(period);
    },
    onApprovalDecided(approval, decision, ctx) {
      const rows = db.all('SELECT p.*, e.department_id FROM payrolls p JOIN employees e ON e.id=p.employee_id WHERE p.approval_id=?', approval.id);
      if (!rows.length) return;
      const period = rows[0].period;
      if (decision === 'REJECT') { db.run("UPDATE payrolls SET status='DRAFT', approval_id=NULL WHERE approval_id=?", approval.id); return; }
      const cat = db.get("SELECT id FROM expense_categories WHERE code='PAYROLL'");
      const byDept = {};
      for (const x of rows) { byDept[x.department_id || 0] = (byDept[x.department_id || 0] || 0) + x.net; }
      db.tx(() => {
        for (const [dept, net] of Object.entries(byDept)) {
          const e = app.services.expenses.createDirect({ expense_date: monthRange(period).to, department_id: Number(dept) || null, category_id: cat?.id, amount: round2(net), purpose: `Oylik ${period}`, payment_method: 'BANK', status: 'APPROVED' }, ctx);
          db.run("UPDATE payrolls SET status='APPROVED', expense_id=? WHERE approval_id=? AND employee_id IN (SELECT id FROM employees WHERE COALESCE(department_id,0)=?)", e.id, approval.id, Number(dept));
        }
      });
      app.services.notifications?.notify({ roles: ['ACCOUNTANT', 'CFO'], type: 'PAYROLL_READY', title: `Oylik ${period} tasdiqlandi — to‘lovga tayyor`, body: `Jami: ${round2(sum(rows, (x) => x.net)).toLocaleString('ru-RU')}`, entity_type: 'payroll', entity_id: null, dedupe_key: `payroll-ready:${period}` });
    },
    pendingPayrollReserve() {
      return db.get("SELECT COALESCE(SUM(net),0) s FROM payrolls WHERE status IN ('SUBMITTED','APPROVED')").s;
    },
    /** Buxgalteriya: tasdiqlangan oylikni to'langan deb belgilash (bog'liq xarajatlar ham PAID) */
    markPaid(period, paidAt, ctx) {
      const date = paidAt || today();
      const n = db.run("UPDATE payrolls SET status='PAID', paid_at=? WHERE period=? AND status='APPROVED'", date, period).changes;
      for (const e of db.all('SELECT DISTINCT expense_id FROM payrolls WHERE period=? AND expense_id IS NOT NULL', period)) { const x = db.get('SELECT status FROM expenses WHERE id=?', e.expense_id); if (x?.status === 'APPROVED') app.services.expenses.markPaid(e.expense_id, { paid_at: date }, ctx); }
      audit(ctx, { action: 'PAYROLL_PAID', entity: 'payroll', newValue: { period, rows: n } });
      return svc.summary(period);
    },
    /** Xodimning o'z oyligi va KPI (employees.user_id bo'yicha) — faqat o'ziniki */
    mine(userId, period) {
      const employee = db.get('SELECT e.*, d.name AS department_name FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE e.user_id=? ORDER BY e.is_active DESC, e.id DESC LIMIT 1', userId);
      if (!employee) return null;
      const payroll = period ? db.get('SELECT * FROM payrolls WHERE employee_id=? AND period=?', employee.id, period) : db.get('SELECT * FROM payrolls WHERE employee_id=? ORDER BY period DESC LIMIT 1', employee.id);
      const p = payroll?.period || period || null;
      const kpis = p ? db.all('SELECT k.*, r.code AS rule_code, r.name AS rule_name, r.formula FROM employee_kpis k LEFT JOIN kpi_rules r ON r.id=k.kpi_rule_id WHERE k.employee_id=? AND k.period=? ORDER BY k.id', employee.id, p) : [];
      const advances = p ? db.all('SELECT amount, given_at, note FROM advances WHERE employee_id=? AND period=? ORDER BY given_at', employee.id, p) : [];
      const history = db.all('SELECT period, net, status FROM payrolls WHERE employee_id=? ORDER BY period DESC LIMIT 6', employee.id);
      return { employee, period: p, payroll: payroll || null, kpis, advances, history };
    },
  };
  app.services.payroll = svc;
  app.services.approvals.onDecision('PAYROLL', svc.onApprovalDecided);

  r.get('/api/employees', { perm: ['payroll', 'VIEW'], tags: ['payroll'], summary: 'Xodimlar' }, async () => db.all('SELECT e.*, d.name AS department_name FROM employees e LEFT JOIN departments d ON d.id=e.department_id ORDER BY d.name, e.name'));
  r.post('/api/employees', { perm: ['payroll', 'CREATE'], tags: ['payroll'], summary: 'Xodim qo‘shish' }, async (ctx) => {
    const b = ctx.body || {};
    if (!b.name) throw badRequest('name majburiy');
    const id = db.insert('employees', { user_id: b.user_id || null, name: b.name, department_id: b.department_id || null, position: b.position || null, fixed_salary: round2(b.fixed_salary || 0), hired_at: b.hired_at || today() });
    audit(ctx, { action: 'CREATE', entity: 'employee', entityId: id, newValue: b });
    return db.get('SELECT * FROM employees WHERE id=?', id);
  });
  r.patch('/api/employees/:id', { perm: ['payroll', 'EDIT'], tags: ['payroll'], summary: 'Xodimni tahrirlash (maosh o‘zgarishi audit)' }, async (ctx) => {
    const e = db.get('SELECT * FROM employees WHERE id=?', ctx.params.id);
    if (!e) throw notFound();
    if (ctx.user.role_code === 'AI_AGENT') throw badRequest('AI agent maoshni o‘zgartira olmaydi');
    const upd = {};
    for (const k of ['name', 'department_id', 'position', 'fixed_salary', 'is_active', 'user_id']) if (ctx.body?.[k] !== undefined) upd[k] = ctx.body[k];
    db.update('employees', e.id, upd);
    audit(ctx, { action: upd.fixed_salary !== undefined ? 'SALARY_CHANGED' : 'UPDATE', entity: 'employee', entityId: e.id, oldValue: { fixed_salary: e.fixed_salary }, newValue: upd });
    return db.get('SELECT * FROM employees WHERE id=?', e.id);
  });
  r.get('/api/kpi-rules', { perm: ['payroll', 'VIEW'], tags: ['payroll'], summary: 'KPI qoidalari' }, async () => db.all('SELECT k.*, st.code AS service_code, d.name AS department_name FROM kpi_rules k LEFT JOIN service_types st ON st.id=k.service_type_id LEFT JOIN departments d ON d.id=k.department_id').map((x) => ({ ...x, params: parseJson(x.params, {}) })));
  r.post('/api/kpi-rules', { perm: ['settings', 'EDIT'], tags: ['payroll'], summary: 'KPI qoidasi qo‘shish' }, async (ctx) => {
    const b = ctx.body || {};
    if (!b.code || !b.name || !b.formula) throw badRequest('code, name, formula majburiy');
    const id = db.insert('kpi_rules', { code: b.code, name: b.name, service_type_id: b.service_type_id || null, department_id: b.department_id || null, formula: b.formula, params: JSON.stringify(b.params || {}) });
    audit(ctx, { action: 'CREATE', entity: 'kpi_rule', entityId: id, newValue: b });
    return db.get('SELECT * FROM kpi_rules WHERE id=?', id);
  });
  r.patch('/api/kpi-rules/:id', { perm: ['settings', 'EDIT'], tags: ['payroll'], summary: 'KPI qoidasini tahrirlash' }, async (ctx) => {
    const k = db.get('SELECT * FROM kpi_rules WHERE id=?', ctx.params.id);
    if (!k) throw notFound();
    const upd = {};
    for (const x of ['name', 'service_type_id', 'department_id', 'formula', 'is_active']) if (ctx.body?.[x] !== undefined) upd[x] = ctx.body[x];
    if (ctx.body?.params !== undefined) upd.params = JSON.stringify(ctx.body.params);
    db.update('kpi_rules', k.id, upd);
    audit(ctx, { action: 'UPDATE', entity: 'kpi_rule', entityId: k.id, oldValue: k, newValue: upd });
    return db.get('SELECT * FROM kpi_rules WHERE id=?', k.id);
  });
  r.post('/api/employee-kpis', { perm: ['payroll', 'EDIT'], tags: ['payroll'], summary: 'Xodim KPI metrikasi (period, rule, metric_value)' }, async (ctx) => {
    const b = ctx.body || {};
    if (!b.employee_id || !b.period || !b.kpi_rule_id) throw badRequest('employee_id, period, kpi_rule_id majburiy');
    db.run('INSERT INTO employee_kpis (employee_id, period, kpi_rule_id, metric_value, kpi_amount, note) VALUES (?,?,?,?,?,?) ON CONFLICT(employee_id, period, kpi_rule_id) DO UPDATE SET metric_value=excluded.metric_value, kpi_amount=excluded.kpi_amount, note=excluded.note', b.employee_id, b.period, b.kpi_rule_id, b.metric_value ?? null, b.kpi_amount ?? null, b.note || null);
    audit(ctx, { action: 'KPI_SET', entity: 'employee', entityId: b.employee_id, newValue: b });
    return { ok: true };
  });
  r.get('/api/payroll/:period', { perm: ['payroll', 'VIEW'], tags: ['payroll'], summary: 'Davr oyligi (jadval + xulosa)' }, async (ctx) => ({ ...svc.summary(ctx.params.period), items: svc.list(ctx.params.period).filter((x) => ctx.user.role_code !== 'DEPARTMENT_HEAD' || x.department_id === ctx.user.department_id) }));
  r.post('/api/payroll/:period/compute', { perm: ['payroll', 'CREATE'], tags: ['payroll'], summary: 'Oylikni hisoblash (rule engine)' }, async (ctx) => ({ items: svc.compute(ctx.params.period, ctx), ...svc.summary(ctx.params.period) }));
  r.post('/api/payroll/:period/submit', { perm: ['payroll', 'CREATE'], tags: ['payroll'], summary: 'Tasdiqlashga yuborish (Dept Head → Exec → CFO → Accounting)' }, async (ctx) => svc.submit(ctx.params.period, ctx));
  r.patch('/api/payroll/rows/:id', { perm: ['payroll', 'EDIT'], tags: ['payroll'], summary: 'Bonus/jarima/boshqa tuzatish (DRAFT)' }, async (ctx) => {
    const p = db.get('SELECT * FROM payrolls WHERE id=?', ctx.params.id);
    if (!p) throw notFound();
    if (p.status !== 'DRAFT') throw badRequest('Faqat DRAFT tahrirlanadi');
    const upd = {};
    for (const k of ['kpi', 'piece_rate', 'bonus', 'penalty', 'certificate_bonus', 'other', 'advance']) if (ctx.body?.[k] !== undefined) upd[k] = round2(ctx.body[k]);
    const n = { ...p, ...upd };
    n.gross = round2(n.fixed + n.kpi + n.piece_rate + n.bonus + n.certificate_bonus + n.other - n.penalty);
    n.deductions = round2(n.gross * Number(settings.get('payroll.income_tax_pct') ?? 12) / 100);
    n.net = round2(n.gross - n.deductions - n.advance);
    db.update('payrolls', p.id, { ...upd, gross: n.gross, deductions: n.deductions, net: n.net });
    audit(ctx, { action: 'PAYROLL_ROW_EDIT', entity: 'payroll', entityId: p.id, oldValue: p, newValue: upd });
    return db.get('SELECT * FROM payrolls WHERE id=?', p.id);
  });
  r.post('/api/payroll/:period/mark-paid', { perm: ['payroll', 'EDIT'], tags: ['payroll'], summary: 'To‘langan deb belgilash (buxgalteriya)' }, async (ctx) => svc.markPaid(ctx.params.period, ctx.body?.paid_at, ctx));
}
