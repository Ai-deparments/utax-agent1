import { badRequest, notFound } from '../core/http.mjs';
import { nowIso, today, round2, addDays, daysBetween, sum } from '../core/util.mjs';

export function register(app) {
  const { r, db, audit, settings } = app;

  function bucketOf(days) {
    if (days <= 0) return 'CURRENT';
    if (days <= 7) return '0-7';
    if (days <= 15) return '8-15';
    if (days <= 30) return '16-30';
    if (days <= 60) return '31-60';
    return '60+';
  }
  const svc = {
    bucketOf,
    list(f = {}, asOf = today()) {
      const critDays = Number(settings.get('collection.critical_days') || 15);
      let rows = app.services.contracts.list({ active: true, service_code: f.service, manager_user_id: f.manager_user_id, company_id: f.company_id }).filter((c) => c.remaining > 0.005);
      rows = rows.map((c) => {
        // To'lovlarni jadvalga FIFO taqsimlash → to'lanmagan qismlar (portions) va ularning muddati
        const schedules = db.all('SELECT * FROM payment_schedules WHERE contract_id=? ORDER BY due_date, id', c.id);
        let paidLeft = c.paid;
        const portions = [];
        for (const s of schedules) { const alloc = Math.min(paidLeft, s.amount); paidLeft = round2(paidLeft - alloc); const unpaid = round2(s.amount - alloc); if (unpaid > 0.005) portions.push({ due: s.due_date, amount: unpaid, kind: s.kind }); }
        const covered = round2(sum(portions, (p) => p.amount));
        if (c.remaining - covered > 0.005) portions.push({ due: c.payment_due_date || c.next_due_date || null, amount: round2(c.remaining - covered), kind: 'REMAINDER' });
        const overdueP = portions.filter((p) => p.due && p.due < asOf);
        const overdue_amount = round2(sum(overdueP, (p) => p.amount));
        const days_overdue = overdueP.length ? daysBetween(overdueP.reduce((m, p) => (p.due < m ? p.due : m), overdueP[0].due), asOf) : 0;
        const dated = portions.filter((p) => p.due).sort((a, b) => a.due.localeCompare(b.due));
        const due_date = dated[0]?.due || null;
        const due_amount = round2(sum(dated.filter((p) => p.due === due_date), (p) => p.amount));
        const inWin = (n) => round2(sum(portions.filter((p) => p.due && p.due >= asOf && p.due <= addDays(asOf, n)), (p) => p.amount));
        return {
          id: c.id, contract_id: c.id, contract_number: c.contract_number, company_id: c.company_id, client: c.company_name, inn: c.company_inn, service_code: c.service_code, service_name: c.service_name,
          manager: c.manager_name, manager_user_id: c.manager_user_id, total: c.amount, paid: c.paid, debt: c.remaining, overdue_amount, current_amount: round2(c.remaining - overdue_amount),
          due_date, due_amount, days_overdue, bucket: overdue_amount > 0 ? bucketOf(days_overdue) : 'CURRENT', contract_status: c.contract_status, service_status: c.service_status, recognized: c.recognized,
          is_critical: overdue_amount > 0 && days_overdue >= critDays, days_to_due: due_date ? daysBetween(asOf, due_date) : null, due_today: round2(sum(portions.filter((p) => p.due === asOf), (p) => p.amount)), due_7d: inWin(7), due_30d: inWin(30), portions,
        };
      });
      const flt = f.filter || f.range;
      if (flt === 'today') rows = rows.filter((x) => x.due_today > 0);
      else if (flt === 'overdue') rows = rows.filter((x) => x.overdue_amount > 0);
      else if (flt === '7') rows = rows.filter((x) => x.due_7d > 0);
      else if (flt === '30') rows = rows.filter((x) => x.due_30d > 0);
      else if (flt === '60+') rows = rows.filter((x) => x.days_overdue > 60);
      else if (flt === 'critical') rows = rows.filter((x) => x.is_critical);
      if (f.min_amount) rows = rows.filter((x) => x.debt >= Number(f.min_amount));
      if (f.max_amount) rows = rows.filter((x) => x.debt <= Number(f.max_amount));
      if (f.q) { const q = f.q.toLowerCase(); rows = rows.filter((x) => `${x.client} ${x.contract_number} ${x.inn || ''}`.toLowerCase().includes(q)); }
      return rows.sort((a, b) => b.days_overdue - a.days_overdue || b.overdue_amount - a.overdue_amount || b.debt - a.debt);
    },
    aging(asOf = today()) {
      const rows = svc.list({}, asOf);
      const buckets = ['CURRENT', '0-7', '8-15', '16-30', '31-60', '60+'].map((b) => ({ bucket: b, label: b === 'CURRENT' ? 'Muddati kelmagan' : b + ' kun',
        amount: round2(b === 'CURRENT' ? sum(rows, (x) => x.current_amount) : sum(rows.filter((x) => x.bucket === b), (x) => x.overdue_amount)), count: b === 'CURRENT' ? rows.filter((x) => x.current_amount > 0).length : rows.filter((x) => x.bucket === b).length }));
      return { as_of: asOf, buckets, total: round2(sum(rows, (x) => x.debt)), overdue: round2(sum(rows, (x) => x.overdue_amount)) };
    },
    summary(asOf = today()) {
      const rows = svc.list({}, asOf);
      const overdue = rows.filter((x) => x.overdue_amount > 0), critical = rows.filter((x) => x.is_critical);
      return {
        total_receivable: round2(sum(rows, (x) => x.debt)), overdue: round2(sum(overdue, (x) => x.overdue_amount)), critical: round2(sum(critical, (x) => x.overdue_amount)),
        expected_7d: round2(sum(rows, (x) => x.due_7d)), expected_30d: round2(sum(rows, (x) => x.due_30d)), count: rows.length, overdue_count: overdue.length, critical_count: critical.length,
        top_debtors: rows.slice(0, 10).map(({ portions, ...x }) => x), open_tasks: db.get("SELECT COUNT(*) n FROM collections WHERE status='OPEN'").n,
      };
    },
    /** COLLECTION AI AGENT — T-7 … T+15 bosqichlar, vazifa + bildirishnoma */
    runCollectionAgent(asOf = today(), ctx) {
      const stages = settings.get('collection.stages') || [];
      const created = [];
      for (const rcv of svc.list({}, asOf)) {
        if (!rcv.due_date) continue;
        const diff = daysBetween(rcv.due_date, asOf); // musbat = muddati o'tgan
        const reached = stages.filter((s) => s.days <= diff);
        if (!reached.length) continue;
        const st = reached[reached.length - 1];
        const exists = db.get('SELECT id FROM collections WHERE contract_id=? AND stage=? AND due_date=?', rcv.contract_id, st.code, rcv.due_date);
        if (exists) continue;
        db.run("UPDATE collections SET status='SUPERSEDED' WHERE contract_id=? AND due_date=? AND status='OPEN'", rcv.contract_id, rcv.due_date);
        const id = db.insert('collections', { contract_id: rcv.contract_id, stage: st.code, due_date: rcv.due_date, debt: rcv.due_amount || rcv.debt, task_date: asOf, status: 'OPEN', assigned_to: rcv.manager_user_id || null, note: st.label, created_at: nowIso() });
        created.push({ id, contract: rcv.contract_number, client: rcv.client, stage: st.code, debt: rcv.due_amount || rcv.debt });
        const sev = diff >= Number(settings.get('collection.critical_days') || 15) ? 'CRITICAL' : diff > 0 ? 'WARNING' : 'INFO';
        app.services.notifications?.notify({ user_ids: rcv.manager_user_id ? [rcv.manager_user_id] : [], roles: diff >= 7 ? ['FINANCE_MANAGER', 'CFO'] : ['FINANCE_MANAGER'], type: diff > 0 ? 'PAYMENT_OVERDUE' : 'PAYMENT_UPCOMING', severity: sev,
          title: `${st.code} ${st.label}: ${rcv.client}`, body: `${rcv.contract_number} — to‘lov ${(rcv.due_amount || rcv.debt).toLocaleString('ru-RU')} UZS (jami qarz ${rcv.debt.toLocaleString('ru-RU')}), muddat ${rcv.due_date}${diff > 0 ? ` (${diff} kun o‘tdi)` : ''}`, entity_type: 'contract', entity_id: rcv.contract_id, dedupe_key: `coll:${rcv.contract_id}:${st.code}:${rcv.due_date}` });
        audit(ctx || { source: 'SYSTEM' }, { action: 'COLLECTION_TASK', entity: 'contract', entityId: rcv.contract_id, newValue: { stage: st.code, due_amount: rcv.due_amount, debt: rcv.debt }, aiAgentCode: 'COLLECTION' });
      }
      return { as_of: asOf, created: created.length, tasks: created };
    },
  };
  app.services.receivables = svc;

  r.get('/api/receivables', { perm: ['receivables', 'VIEW'], tags: ['receivables'], summary: 'Debitorlik jadvali', query: ['filter', 'service', 'manager_user_id', 'company_id', 'min_amount', 'max_amount', 'q', 'as_of'] }, async (ctx) => svc.list(ctx.query, ctx.query.as_of || today()).map(({ portions, ...x }) => x));
  r.get('/api/receivables/aging', { perm: ['receivables', 'VIEW'], tags: ['receivables'], summary: 'Aging: 0–7, 8–15, 16–30, 31–60, 60+' }, async (ctx) => svc.aging(ctx.query.as_of || today()));
  r.get('/api/receivables/summary', { perm: ['receivables', 'VIEW'], tags: ['receivables'], summary: 'TOTAL / OVERDUE / CRITICAL + kutilayotgan 7/30 kun' }, async (ctx) => svc.summary(ctx.query.as_of || today()));
  r.get('/api/collections', { perm: ['collections', 'VIEW'], tags: ['receivables'], summary: 'Undiruv vazifalari', query: ['status'] }, async (ctx) =>
    db.all(`SELECT k.*, c.contract_number, co.name AS client, u.name AS assigned_name FROM collections k JOIN contracts c ON c.id=k.contract_id JOIN companies co ON co.id=c.company_id LEFT JOIN users u ON u.id=k.assigned_to WHERE ${ctx.query.status ? 'k.status=?' : "k.status<>'SUPERSEDED'"} ORDER BY k.task_date DESC, k.id DESC LIMIT 500`, ...(ctx.query.status ? [ctx.query.status] : [])));
  r.patch('/api/collections/:id', { perm: ['collections', 'EDIT'], tags: ['receivables'], summary: 'Vazifa holati/izoh' }, async (ctx) => {
    const k = db.get('SELECT * FROM collections WHERE id=?', ctx.params.id);
    if (!k) throw notFound();
    const upd = {};
    if (ctx.body?.status) { upd.status = ctx.body.status; if (ctx.body.status === 'DONE') upd.done_at = nowIso(); }
    if (ctx.body?.note !== undefined) upd.note = ctx.body.note;
    if (ctx.body?.assigned_to !== undefined) upd.assigned_to = ctx.body.assigned_to;
    db.update('collections', k.id, upd);
    audit(ctx, { action: 'COLLECTION_UPDATED', entity: 'collection', entityId: k.id, oldValue: k, newValue: upd });
    return db.get('SELECT * FROM collections WHERE id=?', k.id);
  });
  r.post('/api/collections/run', { perm: ['collections', 'CREATE'], tags: ['receivables'], summary: 'Collection agentni ishga tushirish' }, async (ctx) => svc.runCollectionAgent(ctx.body?.as_of || today(), ctx));
}
