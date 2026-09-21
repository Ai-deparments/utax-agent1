import { badRequest, notFound } from '../core/http.mjs';
import { nowIso, round2, similarity, daysBetween } from '../core/util.mjs';

/**
 * AUTO RECONCILIATION ENGINE — bank tranzaksiyasi ↔ shartnoma / xarajat.
 * Ball: contract number (60) + INN (25) + summa (15) + kontragent nomi (10) + sana (5) → max 99.
 * >= auto_match_threshold va yagona nomzod → avtomatik MATCHED (audit bilan), aks holda SUGGESTED (human approval).
 */
export function register(app) {
  const { r, db, audit, settings } = app;
  /** match_reason belgisi: xarajat bog'lashdan oldin «Bankdan to‘landi» deb belgilangan edi (unmatch uni APPROVED ga qaytarmaydi) */
  const OLDIN_TOLANGAN = 'oldin to‘langan deb belgilangan';

  /**
   * Bank chiqimini shu xarajatga bog'lab bo'lmasligi sababi (mumkin bo'lsa — null). scoreExpense nomzodlari, confirmExpense va bot bir xil qoidada:
   *  - APPROVED, hech qaysi tranzaksiyaga bog'lanmagan → bog'lanadi (xarajat PAID bo'ladi);
   *  - PAID, lekin bank/kassa tranzaksiyasi yo'q va to'lov usuli BANK («Bankdan to‘landi» belgisi) → faqat bank_transaction_id to'ldiriladi;
   *  - shu tranzaksiyaning o'ziga bog'langan → qayta tasdiqlash mumkin;
   *  - reversal, kassadan to'langan, boshqa bank tranzaksiyasiga bog'langan yoki boshqa holat → rad etiladi.
   */
  function expenseLinkBlockReason(e, tx) {
    if (!e) return 'Xarajat topilmadi';
    if (e.reversed_at) return `Xarajat ${e.code} bekor qilingan (reversal) — bog‘lanmaydi`;
    if (e.cash_transaction_id) return `Xarajat ${e.code} kassadan to‘langan — bank chiqimiga bog‘lanmaydi`;
    if (e.bank_transaction_id && e.bank_transaction_id !== tx?.id) return `Xarajat ${e.code} boshqa bank tranzaksiyasiga bog‘langan`;
    if (e.status === 'APPROVED') return null;
    if (e.status === 'PAID') return e.bank_transaction_id === tx?.id || e.payment_method === 'BANK' ? null : `Xarajat ${e.code} allaqachon to‘langan (to‘lov usuli bank emas) — bank chiqimiga bog‘lanmaydi`;
    return `Faqat tasdiqlangan xarajat bog‘lanadi (${e.code} hozir: ${e.status})`;
  }

  /**
   * To'lov maqsadida shartnoma raqami bormi. Faqat raqamdan iborat raqam (Excel "Dogovor No": '1', '12') har qanday summa/sana
   * ichida uchraydi — shuning uchun faqat "№ 12", "No 12", "договор 12", "shartnoma 12" ko'rinishida (keyin raqam davom etmasa) hisoblanadi.
   */
  function numberInPurpose(purposeUpper, num) {
    const n = String(num || '').toUpperCase();
    if (!n) return false;
    if (!/^\d+$/.test(n)) return purposeUpper.includes(n);
    return new RegExp(`(?:№|\\bNO\\b\\.?|\\bN\\b|ДОГОВОР\\S*|DOGOVOR\\S*|SHARTNOMA\\S*)\\s*(?:№\\s*)?0*${n}(?!\\d)`).test(purposeUpper);
  }

  function scoreIncome(tx) {
    const tol = Number(settings.get('reconciliation.amount_tolerance_pct') || 1) / 100;
    const contracts = app.services.contracts.list({ active: true }).filter((c) => c.remaining > 0.005 || (tx.contract_number_ref && c.contract_number === tx.contract_number_ref));
    const purpose = String(tx.purpose || '').toUpperCase();
    const cands = [];
    for (const c of contracts) {
      let score = 0;
      const reasons = [];
      if (tx.contract_number_ref && c.contract_number === tx.contract_number_ref) { score += 70; reasons.push('contract number'); }
      else if (numberInPurpose(purpose, c.contract_number)) { score += 70; reasons.push('contract number in purpose'); }
      if (tx.counterparty_inn && c.company_inn && tx.counterparty_inn === c.company_inn) { score += 30; reasons.push('INN'); }
      const nameSim = similarity(tx.counterparty_name, c.company_name);
      if (nameSim >= 0.6) { score += Math.round(10 * nameSim); reasons.push('counterparty name'); }
      const near = (a, b) => Math.abs(a - b) <= Math.max(1, b * tol);
      if (near(tx.amount, c.remaining)) { score += 20; reasons.push('amount = remaining'); }
      else if (c.advance_amount > 0 && near(tx.amount, c.advance_amount)) { score += 20; reasons.push('amount = advance'); }
      else if (db.all("SELECT amount FROM payment_schedules WHERE contract_id=? AND status<>'PAID'", c.id).some((s) => near(tx.amount, s.amount))) { score += 15; reasons.push('amount = schedule'); }
      else if (tx.amount <= c.remaining + 1) { score += 5; reasons.push('amount ≤ remaining'); }
      else { score -= 20; reasons.push('amount > remaining'); }
      if (c.next_due_date && Math.abs(daysBetween(c.next_due_date, tx.tx_date)) <= 10) { score += 5; reasons.push('date near due'); }
      if (score > 0) cands.push({ contract_id: c.id, contract_number: c.contract_number, company_name: c.company_name, remaining: c.remaining, amount: c.amount, service_code: c.service_code, score: Math.min(99, score), reasons });
    }
    return cands.sort((a, b) => b.score - a.score);
  }

  function scoreExpense(tx) {
    const tol = Number(settings.get('reconciliation.amount_tolerance_pct') || 1) / 100;
    // Nomzodlar: tasdiqlangan (to'lanmagan) + «Bankdan to‘landi» deb belgilangan, lekin hali bank tranzaksiyasiga bog'lanmagan xarajatlar
    const rows = db.all(`SELECT e.*, ec.name AS category_name FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id
      WHERE e.status IN ('APPROVED','PAID') AND e.reversed_at IS NULL AND e.payment_method='BANK' AND e.bank_transaction_id IS NULL AND e.cash_transaction_id IS NULL`);
    const cands = [];
    for (const e of rows) {
      let score = 0;
      const reasons = [];
      // «Bankdan to‘landi» (PAID, bog'lanmagan) nomzod — faqat to'langan sanasiga yaqin (±10 kun) ko'chirma uchun; aks holda eski to'lov
      // yangi APPROVED xarajatning avtomatik bog'lanishini bo'lib qo'yadi
      if (e.status === 'PAID' && (!e.paid_at || Math.abs(daysBetween(e.paid_at, tx.tx_date)) > 10)) continue;
      if (Math.abs(tx.amount - e.amount) <= Math.max(1, e.amount * tol)) { score += 55; reasons.push('amount'); } else continue;
      const sim = similarity(tx.counterparty_name, e.counterparty);
      if (sim >= 0.6) { score += Math.round(25 * sim); reasons.push('counterparty'); }
      const pSim = similarity(tx.purpose, e.purpose);
      if (pSim >= 0.3) { score += Math.round(10 * pSim); reasons.push('purpose'); }
      const dd = Math.abs(daysBetween(e.required_date || e.expense_date, tx.tx_date));
      if (dd <= 5) { score += 10; reasons.push('date'); } else if (dd <= 20) score += 4;
      if (String(tx.purpose || '').includes(e.code)) { score += 30; reasons.push('expense code'); }
      cands.push({ expense_id: e.id, code: e.code, purpose: e.purpose, amount: e.amount, category: e.category_name, status: e.status, score: Math.min(99, score), reasons });
    }
    return cands.sort((a, b) => b.score - a.score);
  }

  function recordPayment(tx, contractId, ctx, scheduleId) {
    const pid = db.insert('payments', { contract_id: contractId, amount: tx.amount, paid_at: tx.tx_date, source: 'BANK', bank_transaction_id: tx.id, schedule_id: scheduleId || null, created_by: ctx?.user?.id || null, created_at: nowIso() });
    app.services.revenue.onPaymentRecorded(db.get('SELECT * FROM payments WHERE id=?', pid), ctx);
    app.services.contracts.recompute(contractId, ctx);
    return pid;
  }

  const svc = {
    expenseLinkBlockReason,
    suggest(txId) {
      const tx = db.get('SELECT * FROM bank_transactions WHERE id=?', txId);
      if (!tx) throw notFound('Tranzaksiya topilmadi');
      return tx.direction === 'INCOME' ? { direction: 'INCOME', candidates: scoreIncome(tx).slice(0, 5) } : { direction: 'EXPENSE', candidates: scoreExpense(tx).slice(0, 5) };
    },
    autoMatch(txId, ctx) {
      const tx = db.get('SELECT * FROM bank_transactions WHERE id=?', txId);
      if (!tx || tx.matching_status !== 'UNMATCHED' && tx.matching_status !== 'SUGGESTED') return null;
      const autoT = Number(settings.get('reconciliation.auto_match_threshold') || 95), sugT = Number(settings.get('reconciliation.suggest_threshold') || 60);
      const cands = tx.direction === 'INCOME' ? scoreIncome(tx) : scoreExpense(tx);
      if (!cands.length) { db.run("UPDATE bank_transactions SET matching_status='UNMATCHED', suggested_contract_id=NULL, confidence=0 WHERE id=?", tx.id); return { status: 'UNMATCHED' }; }
      const best = cands[0], second = cands[1];
      // Yagona nomzod: ball farqi > 10 yoki (xarajat) faqat eng yaxshisida xarajat kodi to'lov maqsadida bor
      const codeOnlyBest = tx.direction !== 'INCOME' && best.reasons?.includes('expense code') && !second?.reasons?.includes('expense code');
      const unique = !second || second.score < best.score - 10 || codeOnlyBest;
      if (tx.direction === 'INCOME') {
        if (best.score >= autoT && unique && ctx?.user?.role_code !== 'AI_AGENT') {
          svc.confirm(tx.id, best.contract_id, { ...ctx, source: ctx?.source || 'SYSTEM' }, { auto: true, confidence: best.score, reason: best.reasons.join(', ') });
          return { status: 'MATCHED', contract_id: best.contract_id, confidence: best.score };
        }
        if (best.score >= sugT) {
          db.run("UPDATE bank_transactions SET matching_status='SUGGESTED', suggested_contract_id=?, confidence=?, match_reason=? WHERE id=?", best.contract_id, best.score, best.reasons.join(', '), tx.id);
          return { status: 'SUGGESTED', contract_id: best.contract_id, confidence: best.score };
        }
      } else {
        if (best.score >= autoT && unique) { svc.confirmExpense(tx.id, best.expense_id, { ...ctx, source: ctx?.source || 'SYSTEM' }, { auto: true, confidence: best.score }); return { status: 'MATCHED', expense_id: best.expense_id, confidence: best.score }; }
        if (best.score >= sugT) { db.run("UPDATE bank_transactions SET matching_status='SUGGESTED', matched_expense_id=NULL, confidence=?, match_reason=? WHERE id=?", best.score, 'expense ' + best.code + ': ' + best.reasons.join(', '), tx.id); return { status: 'SUGGESTED', expense_id: best.expense_id, confidence: best.score }; }
      }
      db.run("UPDATE bank_transactions SET matching_status='UNMATCHED', confidence=?, match_reason=? WHERE id=?", best.score, 'low confidence', tx.id);
      return { status: 'UNMATCHED', confidence: best.score };
    },
    confirm(txId, contractId, ctx, opts = {}) {
      const tx = db.get('SELECT * FROM bank_transactions WHERE id=?', txId);
      if (!tx) throw notFound('Tranzaksiya topilmadi');
      if (tx.direction !== 'INCOME') throw badRequest('Faqat kirim tranzaksiyasi shartnomaga bog‘lanadi');
      if (tx.matching_status === 'MATCHED') throw badRequest('Allaqachon bog‘langan — avval unmatch qiling');
      if (ctx?.user?.role_code === 'AI_AGENT') throw badRequest('AI agent bog‘lashni tasdiqlay olmaydi — faqat taklif qiladi');
      const c = app.services.contracts.get(contractId);
      if (!c) throw notFound('Shartnoma topilmadi');
      db.tx(() => {
        const pid = recordPayment(tx, contractId, ctx, opts.schedule_id);
        db.run("UPDATE bank_transactions SET matching_status='MATCHED', matched_contract_id=?, suggested_contract_id=NULL, confidence=?, match_reason=?, matched_at=?, matched_by=?, cf_class='OPERATING' WHERE id=?",
          contractId, opts.confidence ?? 100, opts.auto ? 'AUTO: ' + (opts.reason || '') : 'MANUAL: ' + (opts.reason || 'confirmed by user'), nowIso(), ctx?.user?.id || null, tx.id);
        audit(ctx, { action: opts.auto ? 'AUTO_MATCH' : 'MATCH_CONFIRMED', entity: 'bank_transaction', entityId: tx.id, newValue: { contract_id: contractId, payment_id: pid, confidence: opts.confidence ?? 100 } });
      });
      if (tx.amount > c.remaining + 1) app.services.notifications?.notify({ roles: ['FINANCE_MANAGER', 'CFO'], type: 'OVERPAYMENT', severity: 'WARNING', title: `Ortiqcha to‘lov: ${c.contract_number}`, body: `Tranzaksiya ${tx.amount} > qoldiq ${c.remaining}`, entity_type: 'contract', entity_id: c.id, dedupe_key: `overpay:${tx.id}` });
      return db.get('SELECT * FROM bank_transactions WHERE id=?', tx.id);
    },
    confirmExpense(txId, expenseId, ctx, opts = {}) {
      const tx = db.get('SELECT * FROM bank_transactions WHERE id=?', txId);
      if (!tx) throw notFound();
      if (tx.direction !== 'EXPENSE') throw badRequest('Faqat chiqim tranzaksiyasi xarajatga bog‘lanadi');
      if (tx.matching_status === 'MATCHED') throw badRequest('Allaqachon bog‘langan');
      const e = db.get('SELECT * FROM expenses WHERE id=?', expenseId);
      if (!e) throw notFound('Xarajat topilmadi');
      const sabab = expenseLinkBlockReason(e, tx);
      if (sabab) throw badRequest(sabab);
      const oldinTolangan = e.status === 'PAID' && e.bank_transaction_id !== tx.id;
      const cat = e.category_id ? db.get('SELECT cf_class FROM expense_categories WHERE id=?', e.category_id) : null;
      db.tx(() => {
        // Poygaga chidamli: holat sharti UPDATE ning o'zida (eskirgan karta / parallel kassa to'lovi / boshqa jarayon — 0 qator → ROLLBACK).
        // APPROVED → PAID (paid_at = bank sanasi); oldin «to'landi» deb belgilangan PAID → faqat bank_transaction_id to'ldiriladi.
        const n = db.run(`UPDATE expenses SET status='PAID', paid_at=CASE WHEN status='APPROVED' OR paid_at IS NULL THEN ? ELSE paid_at END, bank_transaction_id=?, updated_at=?
          WHERE id=? AND reversed_at IS NULL AND cash_transaction_id IS NULL AND (bank_transaction_id IS NULL OR bank_transaction_id=?)
            AND (status='APPROVED' OR (status='PAID' AND (bank_transaction_id=? OR payment_method='BANK')))`, tx.tx_date, tx.id, nowIso(), e.id, tx.id, tx.id).changes;
        if (!n) throw badRequest('Xarajat holati o‘zgardi (to‘langan, bog‘langan yoki bekor qilingan) — bog‘lanmadi');
        audit(ctx, { action: 'EXPENSE_PAID', entity: 'expense', entityId: e.id, newValue: { bank_transaction_id: tx.id, paid_at: oldinTolangan ? e.paid_at : tx.tx_date, ...(oldinTolangan ? { oldin_tolangan: true } : {}) } });
        const m = db.run(`UPDATE bank_transactions SET matching_status='MATCHED', matched_expense_id=?, confidence=?, match_reason=?, matched_at=?, matched_by=?, cf_class=? WHERE id=? AND matching_status<>'MATCHED'`,
          e.id, opts.confidence ?? 100, (opts.auto ? 'AUTO expense' : 'MANUAL expense') + (oldinTolangan ? ` (${OLDIN_TOLANGAN})` : ''), nowIso(), ctx?.user?.id || null, cat?.cf_class || 'OPERATING', tx.id).changes;
        if (!m) throw badRequest('Allaqachon bog‘langan');
        audit(ctx, { action: opts.auto ? 'AUTO_MATCH_EXPENSE' : 'MATCH_EXPENSE', entity: 'bank_transaction', entityId: tx.id, newValue: { expense_id: e.id } });
      });
      return db.get('SELECT * FROM bank_transactions WHERE id=?', tx.id);
    },
    unmatch(txId, ctx, reason) {
      const tx = db.get('SELECT * FROM bank_transactions WHERE id=?', txId);
      if (!tx) throw notFound();
      if (ctx?.user?.role_code === 'AI_AGENT') throw badRequest('AI agent bog‘lanishni bekor qila olmaydi');
      db.tx(() => {
        if (tx.matched_contract_id) {
          for (const p of db.all('SELECT * FROM payments WHERE bank_transaction_id=? AND reversed_at IS NULL', tx.id)) {
            db.run('UPDATE payments SET reversed_at=? WHERE id=?', nowIso(), p.id);
            app.services.revenue.onPaymentReversed(p, ctx);
          }
          app.services.contracts.recompute(tx.matched_contract_id, ctx);
        }
        if (tx.matched_expense_id) {
          const e = db.get('SELECT id, bank_transaction_id, cash_transaction_id FROM expenses WHERE id=?', tx.matched_expense_id);
          if (!e || (e.bank_transaction_id && e.bank_transaction_id !== tx.id)) {
            // xarajat boshqa bank tranzaksiyasiga bog'langan — uning to'lov holatiga tegilmaydi
          } else if (e.cash_transaction_id || String(tx.match_reason || '').includes(OLDIN_TOLANGAN)) {
            // Kassadan to'langan yoki bog'lashdan oldin «to'landi» deb belgilangan — xarajat PAID qoladi, faqat bank bog'lanishi olinadi
            db.run('UPDATE expenses SET bank_transaction_id=NULL, updated_at=? WHERE id=? AND bank_transaction_id=?', nowIso(), e.id, tx.id);
            audit(ctx, { action: 'UPDATE', entity: 'expense', entityId: e.id, oldValue: { bank_transaction_id: tx.id }, newValue: { bank_transaction_id: null, sabab: 'bank bog‘lanishi bekor qilindi, xarajat to‘langan holicha qoldi' } });
          } else app.services.expenses.unpay(tx.matched_expense_id, ctx);
        }
        db.run("UPDATE bank_transactions SET matching_status='UNMATCHED', matched_contract_id=NULL, matched_expense_id=NULL, suggested_contract_id=NULL, confidence=0, match_reason=?, matched_at=NULL, matched_by=NULL WHERE id=?", 'UNMATCHED: ' + (reason || ''), tx.id);
        audit(ctx, { action: 'UNMATCH', entity: 'bank_transaction', entityId: tx.id, oldValue: { contract_id: tx.matched_contract_id, expense_id: tx.matched_expense_id }, newValue: { reason } });
      });
      return db.get('SELECT * FROM bank_transactions WHERE id=?', tx.id);
    },
    ignore(txId, ctx, reason, cfClass) {
      const tx = db.get('SELECT * FROM bank_transactions WHERE id=?', txId);
      if (!tx) throw notFound();
      if (tx.matching_status === 'MATCHED') throw badRequest('Avval unmatch qiling');
      db.run("UPDATE bank_transactions SET matching_status='IGNORED', ignore_reason=?, cf_class=?, matched_at=?, matched_by=? WHERE id=?", reason || 'NON_CONTRACT', cfClass || tx.cf_class, nowIso(), ctx?.user?.id || null, tx.id);
      audit(ctx, { action: 'IGNORE', entity: 'bank_transaction', entityId: tx.id, newValue: { reason, cf_class: cfClass } });
      return db.get('SELECT * FROM bank_transactions WHERE id=?', tx.id);
    },
    runAll(ctx) {
      const ids = db.all("SELECT id FROM bank_transactions WHERE matching_status IN ('UNMATCHED','SUGGESTED') AND reversed_at IS NULL ORDER BY tx_date").map((x) => x.id);
      const res = { checked: ids.length, matched: 0, suggested: 0, unmatched: 0 };
      for (const id of ids) { const m = svc.autoMatch(id, ctx); if (m?.status === 'MATCHED') res.matched++; else if (m?.status === 'SUGGESTED') res.suggested++; else res.unmatched++; }
      return res;
    },
    stats(from, to) {
      const rng = from && to ? ' AND tx_date BETWEEN ? AND ?' : '';
      return db.get(`SELECT SUM(matching_status='UNMATCHED') unmatched, SUM(matching_status='SUGGESTED') suggested, SUM(matching_status='MATCHED') matched, SUM(matching_status='IGNORED') ignored,
        COALESCE(SUM(CASE WHEN matching_status IN ('UNMATCHED','SUGGESTED') AND direction='INCOME' THEN amount END),0) unmatched_income_amount FROM bank_transactions WHERE reversed_at IS NULL${rng}`, ...(rng ? [from, to] : []));
    },
  };
  app.services.reconciliation = svc;

  r.get('/api/reconciliation/stats', { perm: ['reconciliation', 'VIEW'], tags: ['reconciliation'], summary: 'Matching statistikasi (from/to — tranzaksiya sanasi oralig‘i)', query: ['from', 'to'] }, async (ctx) => svc.stats(ctx.query.from, ctx.query.to));
  r.get('/api/reconciliation/:txId/suggest', { perm: ['reconciliation', 'VIEW'], tags: ['reconciliation'], summary: 'Nomzodlar va confidence' }, async (ctx) => svc.suggest(ctx.params.txId));
  r.post('/api/reconciliation/match', { perm: ['reconciliation', 'APPROVE'], tags: ['reconciliation'], summary: 'Bog‘lashni tasdiqlash {transaction_id, contract_id | expense_id}' }, async (ctx) => {
    const b = ctx.body || {};
    if (!b.transaction_id) throw badRequest('transaction_id majburiy');
    if (b.contract_id) return svc.confirm(b.transaction_id, b.contract_id, ctx, { reason: b.reason, schedule_id: b.schedule_id });
    if (b.expense_id) return svc.confirmExpense(b.transaction_id, b.expense_id, ctx);
    throw badRequest('contract_id yoki expense_id kerak');
  });
  r.post('/api/reconciliation/unmatch', { perm: ['reconciliation', 'EDIT'], tags: ['reconciliation'], summary: 'Bog‘lanishni bekor qilish' }, async (ctx) => svc.unmatch(ctx.body?.transaction_id, ctx, ctx.body?.reason));
  r.post('/api/reconciliation/ignore', { perm: ['reconciliation', 'EDIT'], tags: ['reconciliation'], summary: 'Shartnomaga tegishli emas deb belgilash' }, async (ctx) => svc.ignore(ctx.body?.transaction_id, ctx, ctx.body?.reason, ctx.body?.cf_class));
  r.post('/api/reconciliation/run', { perm: ['reconciliation', 'CREATE'], tags: ['reconciliation'], summary: 'Barcha bog‘lanmagan tranzaksiyalar uchun engine ishga tushirish' }, async (ctx) => svc.runAll(ctx));
}
