import { badRequest, notFound, forbidden } from '../core/http.mjs';
import { nowIso, parseJson, addDays, today } from '../core/util.mjs';

/**
 * UNIVERSAL APPROVAL ENGINE — limitlar approval_rules jadvalida (admin o'zgartiradi).
 * Har qadam: role → tasdiqlovchi. DEPARTMENT_HEAD = so'rov bo'limi rahbari. FOUNDER har qanday qadamni bajara oladi.
 */
export function register(app) {
  const { r, db, audit } = app;
  const handlers = {};
  const ACT_AS = { FOUNDER: ['CEO', 'CFO', 'FINANCE_MANAGER', 'DEPARTMENT_HEAD', 'ACCOUNTANT', 'EXECUTIVE_DIRECTOR'], CEO: ['EXECUTIVE_DIRECTOR', 'DEPARTMENT_HEAD'], CFO: ['FINANCE_MANAGER', 'ACCOUNTANT'] };

  function pickRule(entityType, amount) {
    const rules = db.all('SELECT * FROM approval_rules WHERE entity_type=? AND is_active=1 ORDER BY sort, min_amount', entityType);
    const rule = rules.find((x) => amount >= x.min_amount && (x.max_amount === null || amount < x.max_amount));
    return rule || rules[rules.length - 1] || null;
  }
  function canAct(user, step, approval) {
    if (!user || user.role_code === 'AI_AGENT') return false; // AI hech qachon tasdiqlamaydi
    if (user.role_code === step.role) {
      if (step.role === 'DEPARTMENT_HEAD' && approval.department_id) {
        const d = db.get('SELECT head_user_id FROM departments WHERE id=?', approval.department_id);
        return !d?.head_user_id || d.head_user_id === user.id;
      }
      return true;
    }
    return (ACT_AS[user.role_code] || []).includes(step.role);
  }

  const svc = {
    onDecision(entityType, fn) { handlers[entityType] = fn; },
    create({ entity_type, entity_id, amount, title, requested_by, department_id }, ctx) {
      const rule = pickRule(entity_type, Number(amount) || 0);
      const stepRoles = rule ? parseJson(rule.steps, []) : ['CFO'];
      const steps = stepRoles.map((role) => ({ role, status: 'PENDING', user_id: null, user_name: null, decided_at: null, comment: null }));
      const id = db.insert('approvals', { entity_type, entity_id, amount: amount ?? null, title: title || `${entity_type} #${entity_id}`, requested_by: requested_by ?? ctx?.user?.id ?? null, department_id: department_id || null, steps: JSON.stringify(steps), current_step: 0, status: 'PENDING', created_at: nowIso(), updated_at: nowIso() });
      audit(ctx, { action: 'APPROVAL_CREATED', entity: 'approval', entityId: id, newValue: { entity_type, entity_id, amount, rule: rule?.name, steps: stepRoles }, approvalId: id });
      app.services.notifications?.notify({ roles: [stepRoles[0]], department_id: stepRoles[0] === 'DEPARTMENT_HEAD' ? department_id : null, type: 'APPROVAL_WAITING', title: `Tasdiq kutilmoqda: ${title}`, body: `Summa: ${Number(amount || 0).toLocaleString('ru-RU')}`, entity_type: 'approval', entity_id: id, dedupe_key: `apr-wait:${id}:0` });
      return db.get('SELECT * FROM approvals WHERE id=?', id);
    },
    decide(id, decision, ctx, comment, opts = {}) {
      const a = db.get('SELECT * FROM approvals WHERE id=?', id);
      if (!a) throw notFound('Approval topilmadi');
      if (!['PENDING', 'POSTPONED'].includes(a.status)) throw badRequest('Approval yakunlangan: ' + a.status);
      if (!['APPROVE', 'REJECT', 'POSTPONE'].includes(decision)) throw badRequest('decision: APPROVE|REJECT|POSTPONE');
      const steps = parseJson(a.steps, []);
      const step = steps[a.current_step];
      if (!step) throw badRequest('Qadam topilmadi');
      if (!canAct(ctx.user, step, a)) throw forbidden(`Bu qadamni ${step.role} tasdiqlaydi (siz: ${ctx.user.role_code})`);
      step.user_id = ctx.user.id; step.user_name = ctx.user.name; step.decided_at = nowIso(); step.comment = comment || null; step.source = ctx.source || 'WEB';
      let status = a.status, current = a.current_step, postponed_until = null;
      if (decision === 'APPROVE') {
        step.status = 'APPROVED';
        if (current + 1 < steps.length) { current++; status = 'PENDING'; }
        else status = 'APPROVED';
      } else if (decision === 'REJECT') { step.status = 'REJECTED'; status = 'REJECTED'; }
      else { step.status = 'POSTPONED'; status = 'POSTPONED'; postponed_until = opts.until || addDays(today(), 3); }
      db.run('UPDATE approvals SET steps=?, current_step=?, status=?, postponed_until=?, decided_at=?, comment=?, updated_at=? WHERE id=?', JSON.stringify(steps), current, status, postponed_until, ['APPROVED', 'REJECTED'].includes(status) ? nowIso() : null, comment || a.comment, nowIso(), id);
      audit(ctx, { action: 'APPROVAL_' + decision, entity: 'approval', entityId: id, oldValue: { step: a.current_step, status: a.status }, newValue: { step: current, status, comment }, approvalId: id });
      const updated = db.get('SELECT * FROM approvals WHERE id=?', id);
      if (status === 'PENDING' && current !== a.current_step) {
        app.services.notifications?.notify({ roles: [steps[current].role], department_id: steps[current].role === 'DEPARTMENT_HEAD' ? a.department_id : null, type: 'APPROVAL_WAITING', title: `Tasdiq kutilmoqda: ${a.title}`, body: `Qadam ${current + 1}/${steps.length}`, entity_type: 'approval', entity_id: id, dedupe_key: `apr-wait:${id}:${current}` });
      }
      if (status === 'APPROVED' || status === 'REJECTED') {
        handlers[a.entity_type]?.(updated, status === 'APPROVED' ? 'APPROVE' : 'REJECT', ctx);
        if (a.requested_by) app.services.notifications?.notify({ user_ids: [a.requested_by], type: 'APPROVAL_DECIDED', severity: status === 'APPROVED' ? 'INFO' : 'WARNING', title: `${status === 'APPROVED' ? '✅ Tasdiqlandi' : '❌ Rad etildi'}: ${a.title}`, body: comment || '', entity_type: 'approval', entity_id: id });
      }
      return svc.get(id);
    },
    get(id) {
      const a = db.get('SELECT a.*, u.name AS requested_by_name, d.name AS department_name FROM approvals a LEFT JOIN users u ON u.id=a.requested_by LEFT JOIN departments d ON d.id=a.department_id WHERE a.id=?', id);
      return a ? { ...a, steps: parseJson(a.steps, []) } : null;
    },
    list(f = {}, user) {
      const w = ['1=1'], p = [];
      if (f.status) { w.push('a.status=?'); p.push(f.status); }
      if (f.entity_type) { w.push('a.entity_type=?'); p.push(f.entity_type); }
      const rows = db.all(`SELECT a.*, u.name AS requested_by_name, d.name AS department_name FROM approvals a LEFT JOIN users u ON u.id=a.requested_by LEFT JOIN departments d ON d.id=a.department_id WHERE ${w.join(' AND ')} ORDER BY a.created_at DESC LIMIT 500`, ...p)
        .map((a) => ({ ...a, steps: parseJson(a.steps, []) }));
      return rows.map((a) => ({ ...a, can_act: ['PENDING', 'POSTPONED'].includes(a.status) && !!a.steps[a.current_step] && canAct(user, a.steps[a.current_step], a), is_mine: a.requested_by === user?.id }));
    },
    pendingFor(user) { return svc.list({ status: 'PENDING' }, user).filter((a) => a.can_act); },
  };
  app.services.approvals = svc;

  r.get('/api/approvals', { perm: ['approvals', 'VIEW'], tags: ['approvals'], summary: 'Tasdiqlashlar (can_act — men tasdiqlay olamanmi)', query: ['status', 'entity_type', 'mine'] }, async (ctx) => {
    let rows = svc.list(ctx.query, ctx.user);
    if (ctx.query.mine === '1') rows = rows.filter((a) => a.can_act);
    if (['EMPLOYEE', 'SALES'].includes(ctx.user.role_code)) rows = rows.filter((a) => a.is_mine);
    return rows;
  });
  r.get('/api/approvals/rules', { perm: ['approvals', 'VIEW'], tags: ['approvals'], summary: 'Approval qoidalari (limitlar)' }, async () => db.all('SELECT * FROM approval_rules ORDER BY entity_type, sort, min_amount').map((x) => ({ ...x, steps: parseJson(x.steps, []) })));
  r.put('/api/approvals/rules', { perm: ['settings', 'EDIT'], tags: ['approvals'], summary: 'Qoidalarni to‘liq almashtirish [{entity_type,min_amount,max_amount,steps,name}]' }, async (ctx) => {
    const rules = ctx.body?.rules;
    if (!Array.isArray(rules)) throw badRequest('rules[] kerak');
    const old = db.all('SELECT * FROM approval_rules');
    db.tx(() => {
      db.run('DELETE FROM approval_rules');
      rules.forEach((x, i) => db.insert('approval_rules', { entity_type: x.entity_type || 'EXPENSE', min_amount: Number(x.min_amount) || 0, max_amount: x.max_amount === null || x.max_amount === '' || x.max_amount === undefined ? null : Number(x.max_amount), steps: JSON.stringify(x.steps || ['CFO']), name: x.name || null, sort: i }));
    });
    audit(ctx, { action: 'APPROVAL_RULES_UPDATED', entity: 'approval_rules', oldValue: old, newValue: rules });
    return db.all('SELECT * FROM approval_rules ORDER BY entity_type, sort').map((x) => ({ ...x, steps: parseJson(x.steps, []) }));
  });
  r.get('/api/approvals/:id', { perm: ['approvals', 'VIEW'], tags: ['approvals'], summary: 'Approval detali' }, async (ctx) => { const a = svc.get(ctx.params.id); if (!a) throw notFound(); return a; });
  r.post('/api/approvals/:id/approve', { perm: ['approvals', 'APPROVE'], tags: ['approvals'], summary: 'Tasdiqlash' }, async (ctx) => svc.decide(ctx.params.id, 'APPROVE', ctx, ctx.body?.comment));
  r.post('/api/approvals/:id/reject', { perm: ['approvals', 'REJECT'], tags: ['approvals'], summary: 'Rad etish' }, async (ctx) => svc.decide(ctx.params.id, 'REJECT', ctx, ctx.body?.comment));
  r.post('/api/approvals/:id/postpone', { perm: ['approvals', 'APPROVE'], tags: ['approvals'], summary: 'Kechiktirish' }, async (ctx) => svc.decide(ctx.params.id, 'POSTPONE', ctx, ctx.body?.comment, { until: ctx.body?.until }));
}
