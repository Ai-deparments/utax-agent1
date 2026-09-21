import { badRequest, notFound } from '../core/http.mjs';
import { nowIso, today, round2, parseJson, monthOf, monthRange, addMonths, monthsBetween, resolvePeriod, sum } from '../core/util.mjs';

/**
 * REVENUE RECOGNITION ENGINE
 *  Cash Received ≠ Revenue Recognized.
 *  revenue_events  — pul holati: CUSTOMER_ADVANCE | RECOGNIZED_REVENUE | REFUNDABLE | REFUNDED
 *  revenue_recognition — accrual tan olish yozuvlari (P&L manbai), status RECOGNIZED | PENDING_APPROVAL | REJECTED
 */
export function register(app) {
  const { r, db, audit, settings } = app;

  const ruleOf = (contract) => parseJson(db.get('SELECT recognition_rule FROM service_types WHERE id=?', contract.service_type_id)?.recognition_rule, { method: 'ON_COMPLETION' });
  const recognizedTotal = (cid) => db.get("SELECT COALESCE(SUM(amount),0) s FROM revenue_recognition WHERE contract_id=? AND status='RECOGNIZED'", cid).s;
  const cashRecognized = (cid) => db.get("SELECT COALESCE(SUM(amount),0) s FROM revenue_events WHERE contract_id=? AND state='RECOGNIZED_REVENUE'", cid).s;

  /** Avans eventlarini tan olingan summaga qadar RECOGNIZED holatiga o'tkazish (FIFO, kerak bo'lsa split) */
  function flipAdvances(cid, amount) {
    let left = round2(amount);
    for (const ev of db.all("SELECT * FROM revenue_events WHERE contract_id=? AND state='CUSTOMER_ADVANCE' ORDER BY event_date, id", cid)) {
      if (left <= 0.005) break;
      if (ev.amount <= left + 0.005) {
        db.run("UPDATE revenue_events SET state='RECOGNIZED_REVENUE', state_changed_at=? WHERE id=?", nowIso(), ev.id);
        left = round2(left - ev.amount);
      } else {
        db.run('UPDATE revenue_events SET amount=? WHERE id=?', round2(ev.amount - left), ev.id);
        db.insert('revenue_events', { contract_id: cid, payment_id: ev.payment_id, amount: left, state: 'RECOGNIZED_REVENUE', event_date: ev.event_date, state_changed_at: nowIso(), note: 'split', created_at: nowIso() });
        left = 0;
      }
    }
  }

  const svc = {
    ruleOf,
    /** To'lov yozilganda — pul holatini aniqlash */
    onPaymentRecorded(payment, ctx) {
      const c = db.get('SELECT * FROM contracts WHERE id=?', payment.contract_id);
      const rule = ruleOf(c);
      const amt = round2(payment.amount);
      if (rule.method === 'ON_PAYMENT') {
        const rec = svc.recognize({ contract_id: c.id, amount: amt, date: payment.paid_at, method: 'ON_PAYMENT', ctx, silent: true });
        db.insert('revenue_events', { contract_id: c.id, payment_id: payment.id, amount: amt, state: rec.status === 'RECOGNIZED' ? 'RECOGNIZED_REVENUE' : 'CUSTOMER_ADVANCE', event_date: payment.paid_at, created_at: nowIso() });
        return;
      }
      const room = round2(recognizedTotal(c.id) - cashRecognized(c.id)); // tan olingan, lekin pul kelmagan qism (AR)
      if (room >= amt) {
        db.insert('revenue_events', { contract_id: c.id, payment_id: payment.id, amount: amt, state: 'RECOGNIZED_REVENUE', event_date: payment.paid_at, note: 'AR collection', created_at: nowIso() });
      } else {
        if (room > 0.005) db.insert('revenue_events', { contract_id: c.id, payment_id: payment.id, amount: room, state: 'RECOGNIZED_REVENUE', event_date: payment.paid_at, note: 'AR collection', created_at: nowIso() });
        db.insert('revenue_events', { contract_id: c.id, payment_id: payment.id, amount: round2(amt - Math.max(0, room)), state: 'CUSTOMER_ADVANCE', event_date: payment.paid_at, created_at: nowIso() });
      }
    },
    /** To'lov bekor qilinganda eventlarni olib tashlash (audit bilan) */
    onPaymentReversed(payment, ctx) {
      const evs = db.all('SELECT * FROM revenue_events WHERE payment_id=?', payment.id);
      db.run('DELETE FROM revenue_events WHERE payment_id=?', payment.id);
      audit(ctx, { action: 'REVENUE_EVENTS_REVERSED', entity: 'payment', entityId: payment.id, oldValue: evs });
    },
    /** Xizmat yakunlanganda — qoida bo'yicha tan olish */
    onServiceCompleted(contract, ctx) {
      const rule = ruleOf(contract);
      if (rule.method !== 'ON_COMPLETION' && rule.method !== 'ON_ACCEPTANCE') return null;
      const requireAct = rule.require_acceptance_document ?? settings.get('revenue.require_acceptance_document');
      if (requireAct && !contract.act_count) {
        app.services.notifications?.notify({ roles: ['CFO', 'FINANCE_MANAGER', 'ACCOUNTANT'], type: 'MISSING_DOCUMENT', severity: 'WARNING', title: `Akt yo‘q: ${contract.contract_number}`, body: 'Xizmat yakunlandi, lekin qabul akti biriktirilmagan — daromad tan olinmadi.', entity_type: 'contract', entity_id: contract.id, dedupe_key: `act-missing:${contract.id}` });
        return { status: 'BLOCKED', reason: 'ACCEPTANCE_DOCUMENT_MISSING' };
      }
      const remaining = round2(contract.amount - recognizedTotal(contract.id) - db.get("SELECT COALESCE(SUM(amount),0) s FROM revenue_recognition WHERE contract_id=? AND status='PENDING_APPROVAL'", contract.id).s);
      if (remaining <= 0.005) return { status: 'ALREADY_RECOGNIZED' };
      return svc.recognize({ contract_id: contract.id, amount: remaining, date: contract.service_completed_at || today(), method: 'ON_COMPLETION', ctx });
    },
    /** Tan olish — chegara oshsa human approval (AI safety) */
    recognize({ contract_id, amount, date, method, ctx, note, silent }) {
      const c = db.get('SELECT * FROM contracts WHERE id=?', contract_id);
      if (!c) throw notFound('Shartnoma topilmadi');
      amount = round2(amount);
      if (amount <= 0) throw badRequest('Summa musbat bo‘lishi kerak');
      const total = recognizedTotal(contract_id);
      if (total + amount > c.amount + 0.005) throw badRequest(`Tan olish shartnoma summasidan oshadi (${total + amount} > ${c.amount})`);
      date = date || today();
      const threshold = Number(settings.get('revenue.approval_threshold') || 0);
      const isAgent = ctx?.user?.role_code === 'AI_AGENT';
      const needsApproval = amount >= threshold || isAgent;
      const id = db.insert('revenue_recognition', { contract_id, amount, recognized_at: date, period: monthOf(date), method, status: needsApproval ? 'PENDING_APPROVAL' : 'RECOGNIZED', note: note || null, created_by: ctx?.user?.id || null, created_at: nowIso() });
      if (needsApproval) {
        const apr = app.services.approvals.create({ entity_type: 'REVENUE_RECOGNITION', entity_id: id, amount, title: `Daromad tan olish ${c.contract_number} — ${amount.toLocaleString('ru-RU').replace(/\u00a0/g, ' ')} ${c.currency === 'UZS' ? 'so‘m' : c.currency}`, requested_by: ctx?.user?.id || null }, ctx);
        db.run('UPDATE revenue_recognition SET approval_id=? WHERE id=?', apr.id, id);
        audit(ctx, { action: 'REVENUE_RECOGNITION_PROPOSED', entity: 'revenue_recognition', entityId: id, newValue: { contract_id, amount, method }, approvalId: apr.id });
        if (!silent) app.services.notifications?.notify({ roles: ['CFO'], type: 'APPROVAL_WAITING', title: `Tasdiq kutilmoqda: daromad ${c.contract_number}`, body: `${amount.toLocaleString('ru-RU')} ${c.currency === 'UZS' ? 'so‘m' : c.currency} tan olish uchun tasdiq kerak`, entity_type: 'approval', entity_id: apr.id });
        return { id, status: 'PENDING_APPROVAL', approval_id: apr.id, amount };
      }
      flipAdvances(contract_id, amount);
      audit(ctx, { action: 'REVENUE_RECOGNIZED', entity: 'revenue_recognition', entityId: id, newValue: { contract_id, amount, method, date } });
      app.services.contracts.recompute(contract_id);
      return { id, status: 'RECOGNIZED', amount };
    },
    /** Approval callback */
    onApprovalDecided(approval, decision, ctx) {
      const rec = db.get('SELECT * FROM revenue_recognition WHERE id=?', approval.entity_id);
      if (!rec || rec.status !== 'PENDING_APPROVAL') return;
      if (decision === 'APPROVE') {
        db.run("UPDATE revenue_recognition SET status='RECOGNIZED' WHERE id=?", rec.id);
        flipAdvances(rec.contract_id, rec.amount);
        audit(ctx, { action: 'REVENUE_RECOGNIZED', entity: 'revenue_recognition', entityId: rec.id, newValue: { amount: rec.amount }, approvalId: approval.id });
        app.services.contracts.recompute(rec.contract_id);
      } else if (decision === 'REJECT') {
        db.run("UPDATE revenue_recognition SET status='REJECTED' WHERE id=?", rec.id);
        audit(ctx, { action: 'REVENUE_RECOGNITION_REJECTED', entity: 'revenue_recognition', entityId: rec.id, approvalId: approval.id });
      }
    },
    /** Reversal (tuzatish) — o'chirilmaydi, qarama-qarshi yozuv */
    reverse(recId, ctx, reason) {
      const rec = db.get('SELECT * FROM revenue_recognition WHERE id=?', recId);
      if (!rec || rec.status !== 'RECOGNIZED') throw badRequest('Faqat tan olingan yozuv reversal qilinadi');
      const id = db.insert('revenue_recognition', { contract_id: rec.contract_id, amount: -rec.amount, recognized_at: today(), period: monthOf(today()), method: 'REVERSAL', status: 'RECOGNIZED', note: `Reversal of #${rec.id}: ${reason || ''}`, created_by: ctx?.user?.id || null, created_at: nowIso() });
      // pul eventlarini avansga qaytarish
      let left = rec.amount;
      for (const ev of db.all("SELECT * FROM revenue_events WHERE contract_id=? AND state='RECOGNIZED_REVENUE' ORDER BY event_date DESC, id DESC", rec.contract_id)) {
        if (left <= 0.005) break;
        if (ev.amount <= left + 0.005) { db.run("UPDATE revenue_events SET state='CUSTOMER_ADVANCE', state_changed_at=? WHERE id=?", nowIso(), ev.id); left = round2(left - ev.amount); }
        else { db.run('UPDATE revenue_events SET amount=? WHERE id=?', round2(ev.amount - left), ev.id); db.insert('revenue_events', { contract_id: rec.contract_id, payment_id: ev.payment_id, amount: left, state: 'CUSTOMER_ADVANCE', event_date: ev.event_date, note: 'reversal split', created_at: nowIso() }); left = 0; }
      }
      audit(ctx, { action: 'REVENUE_REVERSED', entity: 'revenue_recognition', entityId: id, oldValue: rec, newValue: { reason } });
      app.services.contracts.recompute(rec.contract_id);
      return db.get('SELECT * FROM revenue_recognition WHERE id=?', id);
    },
    /** Obuna (STRAIGHT_LINE) — oylik tan olish, scheduler tomonidan */
    runStraightLine(asOf = today(), ctx) {
      const out = [];
      const rows = db.all(`SELECT c.*, st.recognition_rule FROM contracts c JOIN service_types st ON st.id=c.service_type_id WHERE c.contract_status NOT IN ('DRAFT','CANCELLED') AND c.start_date IS NOT NULL AND c.end_date IS NOT NULL`);
      for (const c of rows) {
        const rule = parseJson(c.recognition_rule, {});
        if (rule.method !== 'STRAIGHT_LINE') continue;
        const months = Math.max(1, monthsBetween(c.start_date, c.end_date));
        const perMonth = round2(c.amount / months);
        let p = monthOf(c.start_date);
        const lastP = monthOf(c.end_date), curP = monthOf(asOf);
        while (p <= lastP && p <= curP) {
          const exists = db.get("SELECT id FROM revenue_recognition WHERE contract_id=? AND period=? AND method='STRAIGHT_LINE' AND status<>'REJECTED'", c.id, p);
          if (!exists) {
            const isLast = p === lastP;
            const already = recognizedTotal(c.id);
            const amt = isLast ? round2(c.amount - already) : perMonth;
            const date = p === curP ? asOf : monthRange(p).to;
            if (amt > 0.005) out.push({ contract: c.contract_number, period: p, ...svc.recognize({ contract_id: c.id, amount: amt, date, method: 'STRAIGHT_LINE', ctx: ctx || { source: 'SYSTEM' }, silent: true }) });
          }
          p = addMonths(p, 1);
        }
      }
      return out;
    },
    /** Sana holatiga pozitsiya: har shartnoma bo'yicha shu sanagacha kelgan to'lov va tan olingan daromad.
     *  avans = Σ max(0, to'langan − tan olingan − qaytarilgan); debitorlik (tan olingan, puli kelmagan) = Σ max(0, tan olingan − to'langan) */
    positionAsOf(asOf) {
      return db.get(`SELECT COALESCE(SUM(MAX(0, paid - rec - refunded)),0) advances, COALESCE(SUM(MAX(0, rec - paid)),0) ar FROM (
        SELECT c.id,
          COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.contract_id=c.id AND p.reversed_at IS NULL AND p.paid_at<=?),0) AS paid,
          COALESCE((SELECT SUM(rr.amount) FROM revenue_recognition rr WHERE rr.contract_id=c.id AND rr.status='RECOGNIZED' AND rr.recognized_at<=?),0) AS rec,
          COALESCE((SELECT SUM(re.amount) FROM revenue_events re WHERE re.contract_id=c.id AND re.state='REFUNDED' AND substr(COALESCE(re.state_changed_at, re.event_date),1,10)<=?),0) AS refunded
        FROM contracts c)`, asOf, asOf, asOf);
    },
    /** asOf berilmasa — joriy holat (revenue_events); berilsa — o'sha sanadagi holat */
    advancesBalance(asOf) {
      if (!asOf) return db.get("SELECT COALESCE(SUM(amount),0) s FROM revenue_events WHERE state='CUSTOMER_ADVANCE'").s;
      return round2(svc.positionAsOf(asOf).advances);
    },
    recognizedInPeriod(from, to, serviceTypeId) {
      return db.get(`SELECT COALESCE(SUM(rr.amount),0) s FROM revenue_recognition rr JOIN contracts c ON c.id=rr.contract_id WHERE rr.status='RECOGNIZED' AND rr.recognized_at BETWEEN ? AND ?` + (serviceTypeId ? ' AND c.service_type_id=?' : ''), from, to, ...(serviceTypeId ? [serviceTypeId] : [])).s;
    },
    /** Expected revenue = faol shartnomalar backlog (tan olinmagan qism) */
    expectedRevenue() {
      return db.get(`SELECT COALESCE(SUM(c.amount - COALESCE((SELECT SUM(rr.amount) FROM revenue_recognition rr WHERE rr.contract_id=c.id AND rr.status='RECOGNIZED'),0)),0) s FROM contracts c WHERE c.contract_status NOT IN ('DRAFT','CANCELLED','CLOSED')`).s;
    },
    monthlySeries(months = 6, asOf = today()) {
      const out = [];
      let p = addMonths(monthOf(asOf), -(months - 1));
      for (let i = 0; i < months; i++) {
        const { from, to } = monthRange(p);
        const recognized = svc.recognizedInPeriod(from, to);
        const expected = db.get(`SELECT COALESCE(SUM(ps.amount),0) s FROM payment_schedules ps JOIN contracts c ON c.id=ps.contract_id WHERE ps.due_date BETWEEN ? AND ? AND c.contract_status NOT IN ('DRAFT','CANCELLED')`, from, to).s;
        const cash = db.get('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE reversed_at IS NULL AND paid_at BETWEEN ? AND ?', from, to).s;
        out.push({ period: p, recognized: round2(recognized), expected: round2(expected), cash_received: round2(cash) });
        p = addMonths(p, 1);
      }
      return out;
    },
    /**
     * Tan olish yozuvlari {status, from, to, limit?, offset?}. limit berilmasa — cheklovsiz (web «Hisobotlar» eksporti
     * kesilmasligi uchun, refaktordan oldingi xulq); bot/AI kerak bo'lsa o'zi limit beradi. offset — sahifalash uchun.
     */
    listRecognitions(q = {}) {
      const w = ['1=1'], p = [];
      if (q.status) { w.push('rr.status=?'); p.push(q.status); }
      if (q.from) { w.push('rr.recognized_at>=?'); p.push(q.from); }
      if (q.to) { w.push('rr.recognized_at<=?'); p.push(q.to); }
      const butun = (v) => Math.min(1e9, Number.parseInt(v, 10) || 0); // SQL ga faqat oqilona butun son tushadi
      const limit = butun(q.limit), offset = butun(q.offset);
      // SQLite: OFFSET faqat LIMIT bilan ishlaydi — limitsiz sahifa uchun LIMIT -1
      const sahifa = limit > 0 || offset > 0 ? ` LIMIT ${limit > 0 ? limit : -1}${offset > 0 ? ` OFFSET ${offset}` : ''}` : '';
      return db.all(`SELECT rr.*, c.contract_number, co.name AS company_name, st.code AS service_code FROM revenue_recognition rr JOIN contracts c ON c.id=rr.contract_id JOIN companies co ON co.id=c.company_id JOIN service_types st ON st.id=c.service_type_id WHERE ${w.join(' AND ')} ORDER BY rr.recognized_at DESC, rr.id DESC${sahifa}`, ...p);
    },
  };
  app.services.revenue = svc;

  r.get('/api/revenue/summary', { perm: ['revenue', 'VIEW'], tags: ['revenue'], summary: 'Daromad xulosasi: tan olingan, avanslar, kutilayotgan', query: ['period', 'month', 'from', 'to'] }, async (ctx) => {
    const p = resolvePeriod(ctx.query);
    const byService = db.all(`SELECT st.code, st.name, st.color, COALESCE(SUM(rr.amount),0) AS recognized FROM service_types st LEFT JOIN contracts c ON c.service_type_id=st.id LEFT JOIN revenue_recognition rr ON rr.contract_id=c.id AND rr.status='RECOGNIZED' AND rr.recognized_at BETWEEN ? AND ? GROUP BY st.id ORDER BY st.sort`, p.from, p.to);
    return {
      period: p, recognized: round2(svc.recognizedInPeriod(p.from, p.to)), customer_advances: round2(svc.advancesBalance()), expected_revenue: round2(svc.expectedRevenue()),
      pending_approval: db.get("SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM revenue_recognition WHERE status='PENDING_APPROVAL'"),
      by_service: byService, monthly: svc.monthlySeries(6),
      cash_received: round2(db.get('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE reversed_at IS NULL AND paid_at BETWEEN ? AND ?', p.from, p.to).s),
    };
  });
  r.get('/api/revenue/recognitions', { perm: ['revenue', 'VIEW'], tags: ['revenue'], summary: 'Tan olish yozuvlari (limit berilmasa — hammasi)', query: ['status', 'from', 'to', 'limit', 'offset'] }, async (ctx) => svc.listRecognitions(ctx.query));
  r.get('/api/revenue/events', { perm: ['revenue', 'VIEW'], tags: ['revenue'], summary: 'Pul holati eventlari (advance/recognized/refund)', query: ['state'] }, async (ctx) =>
    db.all(`SELECT re.*, c.contract_number, co.name AS company_name FROM revenue_events re JOIN contracts c ON c.id=re.contract_id JOIN companies co ON co.id=c.company_id ${ctx.query.state ? 'WHERE re.state=?' : ''} ORDER BY re.event_date DESC, re.id DESC`, ...(ctx.query.state ? [ctx.query.state] : [])));
  r.post('/api/revenue/recognize', { perm: ['revenue', 'CREATE'], tags: ['revenue'], summary: 'Qo‘lda / milestone tan olish' }, async (ctx) => {
    const b = ctx.body || {};
    return svc.recognize({ contract_id: b.contract_id, amount: b.amount, date: b.date, method: b.method || 'MILESTONE', note: b.note, ctx });
  });
  r.post('/api/revenue/recognitions/:id/reverse', { perm: ['revenue', 'EDIT'], tags: ['revenue'], summary: 'Tan olishni reversal qilish (tuzatish)' }, async (ctx) => svc.reverse(ctx.params.id, ctx, ctx.body?.reason));
  r.post('/api/revenue/run-straight-line', { perm: ['revenue', 'CREATE'], tags: ['revenue'], summary: 'Obuna shartnomalari uchun oylik tan olishni ishga tushirish' }, async (ctx) => svc.runStraightLine(ctx.body?.as_of || today(), ctx));
  r.post('/api/revenue/refund', { perm: ['revenue', 'EDIT'], tags: ['revenue'], summary: 'Avansni qaytarishga belgilash (REFUNDABLE → REFUNDED)' }, async (ctx) => {
    const { contract_id, amount, state } = ctx.body || {};
    if (!contract_id || !amount) throw badRequest('contract_id, amount majburiy');
    let left = round2(amount);
    const target = state === 'REFUNDED' ? 'REFUNDED' : 'REFUNDABLE';
    const fromState = target === 'REFUNDED' ? 'REFUNDABLE' : 'CUSTOMER_ADVANCE';
    db.tx(() => {
      for (const ev of db.all('SELECT * FROM revenue_events WHERE contract_id=? AND state=? ORDER BY event_date', contract_id, fromState)) {
        if (left <= 0.005) break;
        if (ev.amount <= left + 0.005) { db.run('UPDATE revenue_events SET state=?, state_changed_at=? WHERE id=?', target, nowIso(), ev.id); left = round2(left - ev.amount); }
        else { db.run('UPDATE revenue_events SET amount=? WHERE id=?', round2(ev.amount - left), ev.id); db.insert('revenue_events', { contract_id, payment_id: ev.payment_id, amount: left, state: target, event_date: ev.event_date, state_changed_at: nowIso(), note: 'refund split', created_at: nowIso() }); left = 0; }
      }
    });
    if (left > 0.005) throw badRequest(`Yetarli ${fromState} summa yo‘q (qoldi ${left})`);
    audit(ctx, { action: 'REFUND_' + target, entity: 'contract', entityId: contract_id, newValue: { amount } });
    return { ok: true, state: target, amount };
  });
}
