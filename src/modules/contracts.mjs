import { badRequest, notFound, conflict } from '../core/http.mjs';
import { nowIso, today, round2, addDays, daysBetween, parseJson, pct } from '../core/util.mjs';

export const CONTRACT_STATUSES = ['DRAFT', 'ACTIVE', 'ADVANCE_EXPECTED', 'ADVANCE_RECEIVED', 'IN_PROGRESS', 'SERVICE_COMPLETED', 'FINAL_PAYMENT_EXPECTED', 'PAID', 'OVERDUE', 'CLOSED', 'CANCELLED'];
export const SERVICE_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];
const MANUAL = new Set(['DRAFT', 'CLOSED', 'CANCELLED']);

export function register(app) {
  const { r, db, audit } = app;

  const BASE_SELECT = `SELECT c.*, co.name AS company_name, co.inn AS company_inn, st.code AS service_code, st.name AS service_name, st.color AS service_color,
      u.name AS manager_name,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.contract_id=c.id AND p.reversed_at IS NULL),0) AS paid,
      COALESCE((SELECT SUM(rr.amount) FROM revenue_recognition rr WHERE rr.contract_id=c.id AND rr.status='RECOGNIZED'),0) AS recognized,
      COALESCE((SELECT SUM(re.amount) FROM revenue_events re WHERE re.contract_id=c.id AND re.state='CUSTOMER_ADVANCE'),0) AS advance_balance,
      (SELECT COUNT(*) FROM contract_documents cd WHERE cd.contract_id=c.id) AS documents_count,
      (SELECT COUNT(*) FROM contract_documents cd WHERE cd.contract_id=c.id AND cd.doc_type='ACT') AS act_count
    FROM contracts c JOIN companies co ON co.id=c.company_id JOIN service_types st ON st.id=c.service_type_id LEFT JOIN users u ON u.id=c.manager_user_id`;

  function decorate(c, asOf = today()) {
    const paid = round2(c.paid), amount = round2(c.amount);
    const remaining = round2(Math.max(0, amount - paid));
    const dueDate = paid < c.advance_amount - 0.005 && c.advance_amount > 0 ? c.advance_due_date || c.payment_due_date : c.payment_due_date;
    const overdueDays = remaining > 0 && dueDate && dueDate < asOf && !MANUAL.has(c.contract_status) ? daysBetween(dueDate, asOf) : 0;
    return { ...c, paid, remaining, paid_pct: pct(paid, amount), next_due_date: dueDate || null, overdue_days: overdueDays, receivable: remaining };
  }

  function nextNumber(serviceTypeId) {
    const st = db.get('SELECT prefix FROM service_types WHERE id=?', serviceTypeId);
    if (!st) throw badRequest('Xizmat turi topilmadi');
    const prefix = `UTAX-${st.prefix}-`;
    const last = db.get(`SELECT contract_number FROM contracts WHERE contract_number LIKE ? ORDER BY CAST(substr(contract_number, ?) AS INTEGER) DESC LIMIT 1`, prefix + '%', prefix.length + 1);
    const n = last ? Number(last.contract_number.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(n).padStart(5, '0')}`;
  }

  /** Statusni to'lov + xizmat holatidan qayta hisoblash (biznes qoida) */
  function recompute(id, ctx) {
    const c = db.get(BASE_SELECT + ' WHERE c.id=?', id);
    if (!c) return null;
    const d = decorate(c);
    let payment_status;
    if (d.remaining <= 0.005) payment_status = 'PAID';
    else if (d.overdue_days > 0) payment_status = 'OVERDUE';
    else payment_status = d.paid > 0 ? 'PARTIAL' : 'EXPECTED';
    if (c.contract_status === 'CANCELLED') payment_status = 'CANCELLED';

    let contract_status = c.contract_status;
    if (!MANUAL.has(c.contract_status)) {
      if (c.service_status === 'COMPLETED') {
        contract_status = d.remaining <= 0.005 ? 'PAID' : d.overdue_days > 0 ? 'OVERDUE' : 'FINAL_PAYMENT_EXPECTED';
      } else if (c.service_status === 'IN_PROGRESS' || c.service_status === 'ON_HOLD') {
        contract_status = d.overdue_days > 0 ? 'OVERDUE' : 'IN_PROGRESS';
      } else if (c.advance_amount > 0) {
        if (d.paid >= c.advance_amount - 0.005) contract_status = d.remaining <= 0.005 ? 'PAID' : 'ADVANCE_RECEIVED';
        else contract_status = d.overdue_days > 0 ? 'OVERDUE' : 'ADVANCE_EXPECTED';
      } else contract_status = d.remaining <= 0.005 ? 'PAID' : d.overdue_days > 0 ? 'OVERDUE' : 'ACTIVE';
    }
    if (contract_status !== c.contract_status || payment_status !== c.payment_status) {
      db.run('UPDATE contracts SET contract_status=?, payment_status=?, updated_at=? WHERE id=?', contract_status, payment_status, nowIso(), id);
      if (ctx) audit(ctx, { action: 'STATUS_RECOMPUTED', entity: 'contract', entityId: id, oldValue: { contract_status: c.contract_status, payment_status: c.payment_status }, newValue: { contract_status, payment_status } });
    }
    // schedule statuslari
    for (const s of db.all('SELECT * FROM payment_schedules WHERE contract_id=? ORDER BY due_date', id)) {
      let st = 'EXPECTED';
      const paidUpTo = db.get('SELECT COALESCE(SUM(amount),0) s FROM payment_schedules WHERE contract_id=? AND due_date<=? AND id<=?', id, s.due_date, s.id).s;
      if (d.paid >= paidUpTo - 0.005) st = 'PAID';
      else if (s.due_date < today()) st = 'OVERDUE';
      if (c.contract_status === 'CANCELLED') st = 'CANCELLED';
      if (st !== s.status) db.run('UPDATE payment_schedules SET status=? WHERE id=?', st, s.id);
    }
    return { contract_status, payment_status };
  }

  const svc = {
    decorate, recompute, nextNumber,
    get(id) {
      const c = db.get(BASE_SELECT + ' WHERE c.id=?', id);
      return c ? decorate(c) : null;
    },
    byNumber(num) {
      const c = db.get(BASE_SELECT + ' WHERE c.contract_number=?', num);
      return c ? decorate(c) : null;
    },
    list(f = {}) {
      const w = [], p = [];
      if (f.company_id) { w.push('c.company_id=?'); p.push(f.company_id); }
      if (f.service_type_id) { w.push('c.service_type_id=?'); p.push(f.service_type_id); }
      if (f.service_code) { w.push('st.code=?'); p.push(f.service_code); }
      if (f.status) { w.push('c.contract_status=?'); p.push(f.status); }
      if (f.manager_user_id) { w.push('c.manager_user_id=?'); p.push(f.manager_user_id); }
      if (f.from) { w.push('c.contract_date>=?'); p.push(f.from); }
      if (f.to) { w.push('c.contract_date<=?'); p.push(f.to); }
      if (f.q) { w.push('(c.contract_number LIKE ? OR co.name LIKE ? OR co.inn LIKE ? OR c.title LIKE ?)'); p.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`); }
      if (f.active) w.push("c.contract_status NOT IN ('DRAFT','CANCELLED','CLOSED')");
      const rows = db.all(BASE_SELECT + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' ORDER BY c.contract_date DESC, c.id DESC', ...p);
      return rows.map((c) => decorate(c));
    },
    create(b, ctx) {
      if (!b.company_id || !b.service_type_id || !b.amount || !b.contract_date) throw badRequest('company_id, service_type_id, amount, contract_date majburiy');
      if (!db.get('SELECT id FROM companies WHERE id=?', b.company_id)) throw badRequest('Kontragent topilmadi');
      const amount = round2(b.amount);
      const advance_pct = Number(b.advance_pct ?? 0);
      const advance_amount = b.advance_amount !== undefined && b.advance_amount !== null && b.advance_amount !== '' ? round2(b.advance_amount) : round2((amount * advance_pct) / 100);
      const number = b.contract_number?.trim() || nextNumber(b.service_type_id);
      if (db.get('SELECT id FROM contracts WHERE contract_number=?', number)) throw conflict('Shartnoma raqami band: ' + number);
      // Muddatlar faqat foydalanuvchi/Excel bergan bo'lsa — tizim o'zi taxmin qilmaydi (CLAUDE.md 1-qoida)
      const advance_due_date = b.advance_due_date || null;
      const payment_due_date = b.payment_due_date || null;
      const id = db.tx(() => {
        const id = db.insert('contracts', {
          contract_number: number, company_id: b.company_id, service_type_id: b.service_type_id, title: b.title || null, amount, currency: b.currency || 'UZS',
          contract_date: b.contract_date, start_date: b.start_date || null, end_date: b.end_date || null,
          advance_pct, advance_amount, expected_final_payment: round2(amount - advance_amount), advance_due_date, payment_due_date,
          manager_user_id: b.manager_user_id || ctx?.user?.id || null, contract_status: b.contract_status === 'DRAFT' ? 'DRAFT' : 'ACTIVE',
          service_status: b.service_status || 'NOT_STARTED', payment_status: 'EXPECTED', comments: b.comments || null, created_by: ctx?.user?.id || null, created_at: nowIso(),
        });
        if (advance_amount > 0 && advance_due_date) db.insert('payment_schedules', { contract_id: id, kind: 'ADVANCE', due_date: advance_due_date, amount: advance_amount });
        if (amount - advance_amount > 0.005 && payment_due_date) db.insert('payment_schedules', { contract_id: id, kind: 'FINAL', due_date: payment_due_date, amount: round2(amount - advance_amount) });
        return id;
      });
      recompute(id);
      audit(ctx, { action: 'CREATE', entity: 'contract', entityId: id, newValue: { contract_number: number, amount, company_id: b.company_id } });
      return svc.get(id);
    },
    update(id, b, ctx) {
      const c = db.get('SELECT * FROM contracts WHERE id=?', id);
      if (!c) throw notFound('Shartnoma topilmadi');
      const upd = {};
      for (const k of ['title', 'company_id', 'service_type_id', 'currency', 'contract_date', 'start_date', 'end_date', 'advance_pct', 'advance_due_date', 'payment_due_date', 'manager_user_id', 'comments']) if (b[k] !== undefined) upd[k] = b[k];
      if (b.amount !== undefined && round2(b.amount) !== round2(c.amount)) {
        // Shartnoma summasini o'zgartirish — muhim moliyaviy o'zgarish, audit + approval talab (AI uchun taqiq)
        if (ctx?.user?.role_code === 'AI_AGENT') throw badRequest('AI agent shartnoma summasini o‘zgartira olmaydi');
        upd.amount = round2(b.amount);
      }
      if (b.advance_amount !== undefined) upd.advance_amount = round2(b.advance_amount);
      else if (upd.amount !== undefined || upd.advance_pct !== undefined) upd.advance_amount = round2(((upd.amount ?? c.amount) * (upd.advance_pct ?? c.advance_pct)) / 100);
      if (upd.amount !== undefined || upd.advance_amount !== undefined) upd.expected_final_payment = round2((upd.amount ?? c.amount) - (upd.advance_amount ?? c.advance_amount));
      upd.updated_at = nowIso();
      db.tx(() => {
        db.update('contracts', id, upd);
        if (upd.amount !== undefined || upd.advance_amount !== undefined || upd.payment_due_date || upd.advance_due_date) {
          const n = db.get('SELECT * FROM contracts WHERE id=?', id);
          db.run("DELETE FROM payment_schedules WHERE contract_id=? AND status IN ('EXPECTED','OVERDUE')", id);
          const paidSched = db.get("SELECT COALESCE(SUM(amount),0) s FROM payment_schedules WHERE contract_id=? AND status='PAID'", id).s;
          const adv = round2(n.advance_amount - Math.min(paidSched, n.advance_amount));
          if (adv > 0) db.insert('payment_schedules', { contract_id: id, kind: 'ADVANCE', due_date: n.advance_due_date || n.contract_date, amount: adv });
          const fin = round2(n.amount - n.advance_amount - Math.max(0, paidSched - n.advance_amount));
          if (fin > 0.005) db.insert('payment_schedules', { contract_id: id, kind: 'FINAL', due_date: n.payment_due_date, amount: fin });
        }
      });
      recompute(id);
      audit(ctx, { action: 'UPDATE', entity: 'contract', entityId: id, oldValue: c, newValue: upd });
      return svc.get(id);
    },
    setContractStatus(id, status, ctx) {
      if (!CONTRACT_STATUSES.includes(status)) throw badRequest('Noma’lum status');
      const c = db.get('SELECT * FROM contracts WHERE id=?', id);
      if (!c) throw notFound();
      if (status === 'CANCELLED' && c.recognized > 0) throw badRequest('Daromad tan olingan shartnoma bekor qilinmaydi — reversal qiling');
      db.run('UPDATE contracts SET contract_status=?, updated_at=? WHERE id=?', status, nowIso(), id);
      audit(ctx, { action: 'CONTRACT_STATUS', entity: 'contract', entityId: id, oldValue: c.contract_status, newValue: status });
      if (!MANUAL.has(status)) recompute(id, ctx);
      return svc.get(id);
    },
    setServiceStatus(id, status, ctx, opts = {}) {
      if (!SERVICE_STATUSES.includes(status)) throw badRequest('Noma’lum xizmat statusi');
      const c = db.get('SELECT * FROM contracts WHERE id=?', id);
      if (!c) throw notFound();
      const upd = { service_status: status, updated_at: nowIso() };
      if (status === 'COMPLETED') upd.service_completed_at = opts.completed_at || today();
      db.update('contracts', id, upd);
      audit(ctx, { action: 'SERVICE_STATUS', entity: 'contract', entityId: id, oldValue: c.service_status, newValue: status });
      let recognition = null;
      if (status === 'COMPLETED') recognition = app.services.revenue.onServiceCompleted(svc.get(id), ctx);
      recompute(id, ctx);
      return { contract: svc.get(id), recognition };
    },
    addDocument(id, b, ctx) {
      if (!db.get('SELECT id FROM contracts WHERE id=?', id)) throw notFound();
      if (!b.doc_type || !b.name) throw badRequest('doc_type va name majburiy');
      const did = db.insert('contract_documents', { contract_id: id, doc_type: b.doc_type, name: b.name, file_path: b.file_path || null, doc_date: b.doc_date || today(), uploaded_by: ctx?.user?.id || null, created_at: nowIso() });
      audit(ctx, { action: 'DOCUMENT_ADDED', entity: 'contract', entityId: id, newValue: { doc_type: b.doc_type, name: b.name } });
      // Akt qo'shilganda — kutilayotgan tan olishni qayta urinib ko'rish
      const c = svc.get(id);
      if (c.service_status === 'COMPLETED' && b.doc_type === 'ACT') app.services.revenue.onServiceCompleted(c, ctx);
      return db.get('SELECT * FROM contract_documents WHERE id=?', did);
    },
    detail(id) {
      const c = svc.get(id);
      if (!c) return null;
      return {
        ...c,
        schedules: db.all('SELECT * FROM payment_schedules WHERE contract_id=? ORDER BY due_date', id),
        payments: db.all('SELECT p.*, bt.counterparty_name, bt.purpose FROM payments p LEFT JOIN bank_transactions bt ON bt.id=p.bank_transaction_id WHERE p.contract_id=? ORDER BY p.paid_at', id),
        documents: db.all('SELECT d.*, u.name AS uploaded_by_name FROM contract_documents d LEFT JOIN users u ON u.id=d.uploaded_by WHERE d.contract_id=? ORDER BY d.doc_date', id),
        revenue_events: db.all('SELECT * FROM revenue_events WHERE contract_id=? ORDER BY event_date', id),
        recognitions: db.all('SELECT * FROM revenue_recognition WHERE contract_id=? ORDER BY recognized_at', id),
        expenses: db.all('SELECT e.id, e.code, e.expense_date, e.amount, e.purpose, e.status, ec.name AS category FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id WHERE e.contract_id=? AND e.reversed_at IS NULL', id),
        collections: db.all('SELECT * FROM collections WHERE contract_id=? ORDER BY task_date DESC', id),
        audit: db.all("SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.entity='contract' AND a.entity_id=? ORDER BY a.ts DESC LIMIT 50", id),
        recognition_rule: parseJson(db.get('SELECT recognition_rule FROM service_types WHERE id=?', c.service_type_id)?.recognition_rule, {}),
      };
    },
    recomputeAll() { for (const c of db.all('SELECT id FROM contracts')) recompute(c.id); },
  };
  app.services.contracts = svc;

  // ---------------- ROUTES ----------------
  r.get('/api/contracts', { perm: ['contracts', 'VIEW'], tags: ['contracts'], summary: 'Shartnomalar ro‘yxati', query: ['q', 'status', 'service_code', 'company_id', 'manager_user_id', 'from', 'to'] }, async (ctx) => {
    const f = { ...ctx.query };
    if (ctx.user.role_code === 'SALES') f.manager_user_id = ctx.user.id; // scope
    return svc.list(f);
  });
  r.get('/api/contracts/meta', { perm: ['contracts', 'VIEW'], tags: ['contracts'], summary: 'Statuslar, xizmat turlari' }, async () => ({
    contract_statuses: CONTRACT_STATUSES, service_statuses: SERVICE_STATUSES,
    service_types: db.all('SELECT * FROM service_types WHERE is_active=1 ORDER BY sort'), managers: db.all("SELECT id,name FROM users WHERE is_active=1 AND role_code IN ('SALES','FINANCE_MANAGER','CFO','CEO','FOUNDER','DEPARTMENT_HEAD') ORDER BY name"),
  }));
  r.post('/api/contracts', { perm: ['contracts', 'CREATE'], tags: ['contracts'], summary: 'Shartnoma yaratish' }, async (ctx) => svc.create(ctx.body || {}, ctx));
  r.get('/api/contracts/:id', { perm: ['contracts', 'VIEW'], tags: ['contracts'], summary: 'Shartnoma kartasi (to‘lovlar, hujjatlar, revenue)' }, async (ctx) => {
    const d = svc.detail(ctx.params.id);
    if (!d) throw notFound('Shartnoma topilmadi');
    return d;
  });
  r.patch('/api/contracts/:id', { perm: ['contracts', 'EDIT'], tags: ['contracts'], summary: 'Shartnomani tahrirlash' }, async (ctx) => svc.update(ctx.params.id, ctx.body || {}, ctx));
  r.post('/api/contracts/:id/status', { perm: ['contracts', 'EDIT'], tags: ['contracts'], summary: 'Shartnoma statusini qo‘lda o‘rnatish (DRAFT/ACTIVE/CLOSED/CANCELLED)' }, async (ctx) => svc.setContractStatus(ctx.params.id, ctx.body?.status, ctx));
  r.post('/api/contracts/:id/service-status', { perm: ['contracts', 'EDIT'], tags: ['contracts'], summary: 'Xizmat statusi (COMPLETED → revenue recognition trigger)' }, async (ctx) => svc.setServiceStatus(ctx.params.id, ctx.body?.status, ctx, ctx.body || {}));
  r.post('/api/contracts/:id/documents', { perm: ['contracts', 'EDIT'], tags: ['contracts'], summary: 'Hujjat qo‘shish (ACT = qabul akti)' }, async (ctx) => svc.addDocument(ctx.params.id, ctx.body || {}, ctx));
  r.post('/api/contracts/:id/schedules', { perm: ['contracts', 'EDIT'], tags: ['contracts'], summary: 'To‘lov jadvali qatorini qo‘shish' }, async (ctx) => {
    const b = ctx.body || {};
    if (!b.due_date || !b.amount) throw badRequest('due_date, amount majburiy');
    const id = db.insert('payment_schedules', { contract_id: ctx.params.id, kind: b.kind || 'INSTALLMENT', due_date: b.due_date, amount: round2(b.amount), note: b.note || null });
    audit(ctx, { action: 'SCHEDULE_ADDED', entity: 'contract', entityId: Number(ctx.params.id), newValue: b });
    recompute(ctx.params.id);
    return db.get('SELECT * FROM payment_schedules WHERE id=?', id);
  });
  r.get('/api/service-types', { tags: ['contracts'], summary: 'Xizmat turlari (recognition/payment/KPI qoidalari bilan)' }, async () =>
    db.all('SELECT * FROM service_types ORDER BY sort').map((s) => ({ ...s, recognition_rule: parseJson(s.recognition_rule, {}), payment_rule: parseJson(s.payment_rule, {}), kpi_rule: parseJson(s.kpi_rule, {}), expense_rule: parseJson(s.expense_rule, {}), collection_rule: parseJson(s.collection_rule, {}) })));
  r.post('/api/service-types', { perm: ['settings', 'EDIT'], tags: ['contracts'], summary: 'Yangi xizmat turi' }, async (ctx) => {
    const b = ctx.body || {};
    if (!b.code || !b.name || !b.prefix) throw badRequest('code, name, prefix majburiy');
    const id = db.insert('service_types', { code: b.code.toUpperCase(), name: b.name, prefix: b.prefix.toUpperCase(), recognition_rule: JSON.stringify(b.recognition_rule || { method: 'ON_COMPLETION', require_acceptance_document: true }), payment_rule: JSON.stringify(b.payment_rule || { advance_pct: 50, due_days: 10 }), kpi_rule: JSON.stringify(b.kpi_rule || {}), expense_rule: JSON.stringify(b.expense_rule || {}), collection_rule: JSON.stringify(b.collection_rule || {}), color: b.color || null, sort: b.sort || 99 });
    audit(ctx, { action: 'CREATE', entity: 'service_type', entityId: id, newValue: b });
    return db.get('SELECT * FROM service_types WHERE id=?', id);
  });
  r.patch('/api/service-types/:id', { perm: ['settings', 'EDIT'], tags: ['contracts'], summary: 'Xizmat turi qoidalarini o‘zgartirish' }, async (ctx) => {
    const s = db.get('SELECT * FROM service_types WHERE id=?', ctx.params.id);
    if (!s) throw notFound();
    const b = ctx.body || {}, upd = {};
    for (const k of ['name', 'color', 'is_active', 'sort']) if (b[k] !== undefined) upd[k] = b[k];
    for (const k of ['recognition_rule', 'payment_rule', 'kpi_rule', 'expense_rule', 'collection_rule']) if (b[k] !== undefined) upd[k] = JSON.stringify(b[k]);
    db.update('service_types', s.id, upd);
    audit(ctx, { action: 'UPDATE', entity: 'service_type', entityId: s.id, oldValue: s, newValue: upd });
    return db.get('SELECT * FROM service_types WHERE id=?', s.id);
  });
}
