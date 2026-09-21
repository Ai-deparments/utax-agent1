import { badRequest, notFound } from '../core/http.mjs';
import { nowIso, today, round2, sha256, monthOf, addMonths, monthRange } from '../core/util.mjs';
import { parseCsv, parseXlsx, excelDate, parseAmount } from '../core/export.mjs';

export function register(app) {
  const { r, db, audit, settings } = app;

  const svc = {
    bankBalance(asOf = today(), accountId) {
      const rows = db.all(`SELECT ba.id, ba.bank_name, ba.account_number, ba.currency, ba.opening_balance,
          COALESCE((SELECT SUM(CASE WHEN direction='INCOME' THEN amount ELSE -amount END) FROM bank_transactions t WHERE t.bank_account_id=ba.id AND t.reversed_at IS NULL AND t.tx_date<=?),0) AS movement
        FROM bank_accounts ba WHERE ba.is_active=1 ${accountId ? 'AND ba.id=?' : ''}`, asOf, ...(accountId ? [accountId] : []));
      const accounts = rows.map((a) => ({ ...a, balance: round2(a.opening_balance + a.movement), balance_base: round2(settings.toBase(a.opening_balance + a.movement, a.currency)) }));
      return { total: round2(accounts.reduce((s, a) => s + a.balance_base, 0)), accounts };
    },
    cashBalance(asOf = today()) {
      const rows = db.all(`SELECT ca.id, ca.name, ca.currency, ca.opening_balance,
          COALESCE((SELECT SUM(CASE WHEN direction='INCOME' THEN amount ELSE -amount END) FROM cash_transactions t WHERE t.cash_account_id=ca.id AND t.reversed_at IS NULL AND t.tx_date<=?),0) AS movement
        FROM cash_accounts ca WHERE ca.is_active=1`, asOf);
      const accounts = rows.map((a) => ({ ...a, balance: round2(a.opening_balance + a.movement), balance_base: round2(settings.toBase(a.opening_balance + a.movement, a.currency)) }));
      return { total: round2(accounts.reduce((s, a) => s + a.balance_base, 0)), accounts };
    },
    /** Davr bo'yicha pul harakati (bank+kassa) */
    flows(from, to) {
      const b = db.get(`SELECT COALESCE(SUM(CASE WHEN direction='INCOME' THEN amount END),0) inc, COALESCE(SUM(CASE WHEN direction='EXPENSE' THEN amount END),0) exp FROM bank_transactions WHERE reversed_at IS NULL AND tx_date BETWEEN ? AND ?`, from, to);
      const c = db.get(`SELECT COALESCE(SUM(CASE WHEN direction='INCOME' THEN amount END),0) inc, COALESCE(SUM(CASE WHEN direction='EXPENSE' THEN amount END),0) exp FROM cash_transactions WHERE reversed_at IS NULL AND tx_date BETWEEN ? AND ?`, from, to);
      return { income: round2(b.inc + c.inc), expense: round2(b.exp + c.exp), net: round2(b.inc + c.inc - b.exp - c.exp) };
    },
    monthlyFlows(months = 6, asOf = today()) {
      const out = [];
      let p = addMonths(monthOf(asOf), -(months - 1));
      for (let i = 0; i < months; i++) { const { from, to } = monthRange(p); out.push({ period: p, ...svc.flows(from, to) }); p = addMonths(p, 1); }
      return out;
    },
    createTransaction(b, ctx, opts = {}) {
      if (!b.bank_account_id || !b.tx_date || !b.amount || !b.direction) throw badRequest('bank_account_id, tx_date, amount, direction majburiy');
      if (!['INCOME', 'EXPENSE'].includes(b.direction)) throw badRequest('direction INCOME|EXPENSE');
      const ext = b.external_id || sha256(`${b.bank_account_id}|${b.tx_date}|${b.amount}|${b.direction}|${b.counterparty_name || ''}|${b.purpose || ''}`).slice(0, 24);
      if (db.get('SELECT id FROM bank_transactions WHERE bank_account_id=? AND external_id=?', b.bank_account_id, ext)) return { duplicate: true };
      const ref = b.contract_number_ref || (b.purpose ? (/(UTAX-[A-Z]+-\d{3,6})/i.exec(b.purpose)?.[1]?.toUpperCase() || null) : null);
      const id = db.insert('bank_transactions', {
        bank_account_id: b.bank_account_id, external_id: ext, tx_date: b.tx_date, amount: round2(Math.abs(b.amount)), currency: b.currency || 'UZS', direction: b.direction,
        counterparty_name: b.counterparty_name || null, counterparty_inn: b.counterparty_inn ? String(b.counterparty_inn).replace(/\D/g, '') : null, counterparty_account: b.counterparty_account || null,
        purpose: b.purpose || null, contract_number_ref: ref, tx_type: b.tx_type || null, cf_class: b.cf_class || 'OPERATING', source: opts.source || 'MANUAL', created_by: ctx?.user?.id || null, created_at: nowIso(),
      });
      audit(ctx, { action: 'CREATE', entity: 'bank_transaction', entityId: id, newValue: { amount: b.amount, direction: b.direction, counterparty: b.counterparty_name } });
      if (!opts.skipMatch) app.services.reconciliation.autoMatch(id, ctx);
      return { id, duplicate: false };
    },
    reverseTransaction(id, ctx, reason) {
      const t = db.get('SELECT * FROM bank_transactions WHERE id=?', id);
      if (!t) throw notFound();
      if (t.reversed_at) throw badRequest('Allaqachon reversal qilingan');
      if (ctx?.user?.role_code === 'AI_AGENT') throw badRequest('AI agent tranzaksiyani o‘chira/qaytara olmaydi');
      if (t.matching_status === 'MATCHED') app.services.reconciliation.unmatch(id, ctx, 'reversal');
      db.run('UPDATE bank_transactions SET reversed_at=? WHERE id=?', nowIso(), id);
      const rid = db.insert('bank_transactions', { ...Object.fromEntries(Object.entries(t).filter(([k]) => !['id', 'external_id', 'matching_status', 'matched_contract_id', 'matched_expense_id', 'suggested_contract_id', 'confidence', 'match_reason', 'reversed_at', 'reversal_of', 'matched_at', 'matched_by', 'created_at'].includes(k))), external_id: 'REV-' + t.id, direction: t.direction === 'INCOME' ? 'EXPENSE' : 'INCOME', purpose: `REVERSAL #${t.id}: ${reason || ''}`, matching_status: 'IGNORED', ignore_reason: 'REVERSAL', reversal_of: t.id, reversed_at: nowIso(), created_by: ctx?.user?.id || null, created_at: nowIso() });
      audit(ctx, { action: 'REVERSE', entity: 'bank_transaction', entityId: id, oldValue: t, newValue: { reversal_id: rid, reason } });
      return { ok: true, reversal_id: rid };
    },
    /** CSV/XLSX/JSON qatorlarini normal shaklga keltirish (bank ko'chirmasi) */
    normalizeRows(rows, mapping = {}) {
      if (!rows.length) return [];
      const norm = (r) => Array.from(r || [], (x) => String(x ?? '').trim().toLowerCase());
      // Bank ko'chirmalarida sarlavhadan oldin sarlavha/rekvizit qatorlari bo'ladi — sana + summa ustunlari bor birinchi qatorni topamiz
      let hi = 0;
      for (let i = 0; i < Math.min(rows.length, 25); i++) { const hr = norm(rows[i]); if (hr.some((x) => /sana|date|дата/.test(x)) && hr.some((x) => /summa|amount|сумма|debet|debit|дебет|kredit|credit|кредит|kirim|chiqim|приход|расход/.test(x))) { hi = i; break; } }
      const header = norm(rows[hi]);
      rows = rows.slice(hi);
      const find = (...names) => { for (const n of names) { const i = header.findIndex((h) => h.includes(n)); if (i >= 0) return i; } return -1; };
      const col = {
        date: mapping.date ?? find('sana', 'date', 'дата'), amount: mapping.amount ?? find('summa', 'amount', 'сумма'),
        debit: mapping.debit ?? find('debet', 'debit', 'дебет', 'chiqim', 'расход'), credit: mapping.credit ?? find('kredit', 'credit', 'кредит', 'kirim', 'приход'),
        name: mapping.name ?? find('kontragent', 'counterparty', 'контрагент', 'nomi', 'наимен', 'name'), inn: mapping.inn ?? find('inn', 'stir', 'инн'),
        purpose: mapping.purpose ?? find('maqsad', 'purpose', 'назнач', 'izoh', 'комментарий'), ext: mapping.ext ?? find('hujjat', 'raqam', 'номер', '№', 'doc', 'id'), type: mapping.type ?? find('turi', 'type', 'yo‘nalish', 'yo\'nalish', 'направ', 'вид операц'),
      };
      const out = [];
      for (const row of rows.slice(1)) {
        const date = col.date >= 0 ? excelDate(row[col.date]) : null;
        if (!date) continue;
        let amount = 0, direction = 'INCOME';
        if (col.debit >= 0 || col.credit >= 0) {
          const d = col.debit >= 0 ? parseAmount(row[col.debit]) : 0, c = col.credit >= 0 ? parseAmount(row[col.credit]) : 0;
          if (c > 0) { amount = c; direction = 'INCOME'; } else if (d > 0) { amount = d; direction = 'EXPENSE'; } else continue;
        } else if (col.amount >= 0) { const a = parseAmount(row[col.amount]); if (!a) continue; amount = Math.abs(a); direction = a < 0 ? 'EXPENSE' : 'INCOME'; if (col.type >= 0 && /chiq|расход|debet|дебет|expense|out|списан/i.test(String(row[col.type] || ''))) direction = 'EXPENSE'; }
        else continue;
        out.push({ tx_date: date, amount, direction, counterparty_name: col.name >= 0 ? row[col.name] : null, counterparty_inn: col.inn >= 0 ? row[col.inn] : null, purpose: col.purpose >= 0 ? row[col.purpose] : null, external_id: col.ext >= 0 && row[col.ext] ? String(row[col.ext]) : null });
      }
      return out;
    },
    importRows(bankAccountId, rows, ctx, source = 'IMPORT') {
      let created = 0, dup = 0;
      const ids = [];
      db.tx(() => {
        for (const row of rows) {
          const res = svc.createTransaction({ ...row, bank_account_id: bankAccountId }, ctx, { source, skipMatch: true });
          if (res.duplicate) dup++; else { created++; ids.push(res.id); }
        }
      });
      const matched = ids.map((id) => app.services.reconciliation.autoMatch(id, ctx));
      const auto = matched.filter((m) => m?.status === 'MATCHED').length, sugg = matched.filter((m) => m?.status === 'SUGGESTED').length;
      audit(ctx, { action: 'IMPORT', entity: 'bank_transaction', newValue: { bank_account_id: bankAccountId, rows: rows.length, created, duplicates: dup, auto_matched: auto, suggested: sugg } });
      return { rows: rows.length, created, duplicates: dup, auto_matched: auto, suggested: sugg, unmatched: created - auto - sugg };
    },
  };
  app.services.banking = svc;

  r.get('/api/banking/accounts', { perm: ['treasury', 'VIEW'], tags: ['banking'], summary: 'Bank va kassa hisoblari balanslari', query: ['as_of'] }, async (ctx) => ({ bank: svc.bankBalance(ctx.query.as_of), cash: svc.cashBalance(ctx.query.as_of) }));
  r.post('/api/banking/accounts', { perm: ['treasury', 'CREATE'], tags: ['banking'], summary: 'Bank hisobi qo‘shish' }, async (ctx) => {
    const b = ctx.body || {};
    if (!b.bank_name) throw badRequest('bank_name majburiy');
    const id = db.insert('bank_accounts', { bank_name: b.bank_name, account_number: b.account_number || null, currency: b.currency || 'UZS', opening_balance: round2(b.opening_balance || 0), opening_date: b.opening_date || today() });
    audit(ctx, { action: 'CREATE', entity: 'bank_account', entityId: id, newValue: b });
    return db.get('SELECT * FROM bank_accounts WHERE id=?', id);
  });
  r.post('/api/banking/cash-accounts', { perm: ['treasury', 'CREATE'], tags: ['banking'], summary: 'Kassa qo‘shish' }, async (ctx) => {
    const b = ctx.body || {};
    if (!b.name) throw badRequest('name majburiy');
    const id = db.insert('cash_accounts', { name: b.name, currency: b.currency || 'UZS', opening_balance: round2(b.opening_balance || 0), opening_date: b.opening_date || today(), responsible_user_id: b.responsible_user_id || null });
    audit(ctx, { action: 'CREATE', entity: 'cash_account', entityId: id, newValue: b });
    return db.get('SELECT * FROM cash_accounts WHERE id=?', id);
  });

  r.get('/api/transactions', { perm: ['transactions', 'VIEW'], tags: ['banking'], summary: 'Bank tranzaksiyalari', query: ['status', 'direction', 'from', 'to', 'q', 'account_id'] }, async (ctx) => {
    const w = ['1=1'], p = [];
    const q = ctx.query;
    if (q.status) { w.push('t.matching_status=?'); p.push(q.status); }
    if (q.direction) { w.push('t.direction=?'); p.push(q.direction); }
    if (q.from) { w.push('t.tx_date>=?'); p.push(q.from); }
    if (q.to) { w.push('t.tx_date<=?'); p.push(q.to); }
    if (q.account_id) { w.push('t.bank_account_id=?'); p.push(q.account_id); }
    if (q.q) { w.push('(t.counterparty_name LIKE ? OR t.purpose LIKE ? OR t.counterparty_inn LIKE ? OR t.contract_number_ref LIKE ?)'); p.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
    if (!q.include_reversed) w.push('t.reversed_at IS NULL');
    return db.all(`SELECT t.*, ba.bank_name, ba.account_number, c.contract_number AS matched_contract_number, co.name AS matched_company, sc.contract_number AS suggested_contract_number,
        e.code AS matched_expense_code
      FROM bank_transactions t JOIN bank_accounts ba ON ba.id=t.bank_account_id
      LEFT JOIN contracts c ON c.id=t.matched_contract_id LEFT JOIN companies co ON co.id=c.company_id
      LEFT JOIN contracts sc ON sc.id=t.suggested_contract_id LEFT JOIN expenses e ON e.id=t.matched_expense_id
      WHERE ${w.join(' AND ')} ORDER BY t.tx_date DESC, t.id DESC LIMIT 2000`, ...p);
  });
  r.post('/api/transactions', { perm: ['transactions', 'CREATE'], tags: ['banking'], summary: 'Tranzaksiya qo‘lda kiritish' }, async (ctx) => {
    const res = svc.createTransaction(ctx.body || {}, ctx);
    if (res.duplicate) throw badRequest('Bunday tranzaksiya allaqachon mavjud');
    return db.get('SELECT * FROM bank_transactions WHERE id=?', res.id);
  });
  r.post('/api/transactions/import', { perm: ['transactions', 'CREATE'], tags: ['banking'], summary: 'Ko‘chirma import: {bank_account_id, rows:[...]} | {csv} | {xlsx_base64}' }, async (ctx) => {
    const b = ctx.body || {};
    if (!b.bank_account_id) throw badRequest('bank_account_id majburiy');
    let rows = [];
    if (Array.isArray(b.rows)) rows = b.rows;
    else if (b.csv) rows = svc.normalizeRows(parseCsv(b.csv), b.mapping);
    else if (b.xlsx_base64) rows = svc.normalizeRows(parseXlsx(Buffer.from(b.xlsx_base64, 'base64')), b.mapping);
    else throw badRequest('rows | csv | xlsx_base64 kerak');
    return svc.importRows(b.bank_account_id, rows, ctx, b.source || 'IMPORT');
  });
  r.post('/api/transactions/preview', { perm: ['transactions', 'CREATE'], tags: ['banking'], summary: 'Import oldidan ko‘rish (normalizatsiya)' }, async (ctx) => {
    const b = ctx.body || {};
    const rows = b.csv ? svc.normalizeRows(parseCsv(b.csv), b.mapping) : b.xlsx_base64 ? svc.normalizeRows(parseXlsx(Buffer.from(b.xlsx_base64, 'base64')), b.mapping) : [];
    return { rows: rows.slice(0, 200), total: rows.length };
  });
  r.post('/api/transactions/:id/reverse', { perm: ['transactions', 'EDIT'], tags: ['banking'], summary: 'Tranzaksiya reversal (o‘chirish taqiqlangan)' }, async (ctx) => svc.reverseTransaction(ctx.params.id, ctx, ctx.body?.reason));
  r.patch('/api/transactions/:id', { perm: ['transactions', 'EDIT'], tags: ['banking'], summary: 'Tranzaksiya maydonlarini tuzatish (cf_class, purpose, INN)' }, async (ctx) => {
    const t = db.get('SELECT * FROM bank_transactions WHERE id=?', ctx.params.id);
    if (!t) throw notFound();
    const upd = {};
    for (const k of ['cf_class', 'purpose', 'counterparty_inn', 'counterparty_name', 'tx_type']) if (ctx.body?.[k] !== undefined) upd[k] = ctx.body[k];
    db.update('bank_transactions', t.id, upd);
    audit(ctx, { action: 'UPDATE', entity: 'bank_transaction', entityId: t.id, oldValue: t, newValue: upd });
    return db.get('SELECT * FROM bank_transactions WHERE id=?', t.id);
  });

  r.get('/api/cash-transactions', { perm: ['treasury', 'VIEW'], tags: ['banking'], summary: 'Kassa operatsiyalari', query: ['from', 'to'] }, async (ctx) => {
    const w = ['t.reversed_at IS NULL'], p = [];
    if (ctx.query.from) { w.push('t.tx_date>=?'); p.push(ctx.query.from); }
    if (ctx.query.to) { w.push('t.tx_date<=?'); p.push(ctx.query.to); }
    return db.all(`SELECT t.*, ca.name AS cash_account, c.contract_number FROM cash_transactions t JOIN cash_accounts ca ON ca.id=t.cash_account_id LEFT JOIN contracts c ON c.id=t.contract_id WHERE ${w.join(' AND ')} ORDER BY t.tx_date DESC, t.id DESC`, ...p);
  });
  r.post('/api/cash-transactions', { perm: ['treasury', 'CREATE'], tags: ['banking'], summary: 'Kassa kirim/chiqim (shartnoma yoki xarajatga bog‘lash)' }, async (ctx) => {
    const b = ctx.body || {};
    if (!b.cash_account_id || !b.tx_date || !b.amount || !b.direction) throw badRequest('cash_account_id, tx_date, amount, direction majburiy');
    const id = db.tx(() => {
      const id = db.insert('cash_transactions', { cash_account_id: b.cash_account_id, tx_date: b.tx_date, amount: round2(Math.abs(b.amount)), currency: b.currency || 'UZS', direction: b.direction, counterparty_name: b.counterparty_name || null, purpose: b.purpose || null, contract_id: b.contract_id || null, expense_id: b.expense_id || null, cf_class: b.cf_class || 'OPERATING', created_by: ctx.user?.id || null, created_at: nowIso() });
      if (b.direction === 'INCOME' && b.contract_id) {
        const pid = db.insert('payments', { contract_id: b.contract_id, amount: round2(b.amount), paid_at: b.tx_date, source: 'CASH', cash_transaction_id: id, created_by: ctx.user?.id || null, created_at: nowIso() });
        app.services.revenue.onPaymentRecorded(db.get('SELECT * FROM payments WHERE id=?', pid), ctx);
        app.services.contracts.recompute(b.contract_id, ctx);
      }
      if (b.direction === 'EXPENSE' && b.expense_id) app.services.expenses.markPaid(b.expense_id, { cash_transaction_id: id, paid_at: b.tx_date }, ctx);
      return id;
    });
    audit(ctx, { action: 'CREATE', entity: 'cash_transaction', entityId: id, newValue: b });
    return db.get('SELECT * FROM cash_transactions WHERE id=?', id);
  });
}
