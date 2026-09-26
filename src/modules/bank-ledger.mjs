/**
 * Ko'p kompaniyali bank qatlami (UGS, UTAX, ...) — ERP ma'lumotidan ALOHIDA.
 *  - Reyestr: own_companies (o'z yuridik shaxslarimiz) + own_accounts (bank hisoblari va kassa).
 *  - Bank hisoblari: faqat bank ko'chirmasi faylidan (bank-statement.mjs). Fayldagi hisob reyestrda bo'lmasa — import rad etiladi.
 *  - Kassa: oylik yig'indi qo'lda kiritiladi (cash_period_entries), bank importiga aralashmaydi.
 *  - Ichki o'tkazma: korrespondent hisob reyestrda bo'lsa (is_internal=1). Hisob darajasida saqlanadi,
 *    kompaniya/global darajasida shu doiradagi hisoblar orasidagi o'tkazmalar tushum/xarajatdan chiqariladi.
 *  - Manba ustuvorligi: SOURCE_PRIORITY. Bu qatlam faqat BANK_FILE/MANUAL ni o'qiydi — ERP (bank_transactions)
 *    bir xil hisobni bersa ham bu yerda ikki marta sanalmaydi; ERP'dagi mos hisob faqat belgi sifatida ko'rsatiladi.
 */
import { badRequest, notFound } from '../core/http.mjs';
import { nowIso, round2, sha256, parseJson } from '../core/util.mjs';
import { parseBankStatement, cents } from '../import/bank-statement.mjs';
import { decryptSecret, encryptSecret } from '../core/auth.mjs';

export const SOURCE_PRIORITY = ['BANK_FILE', 'MANUAL', 'ERP'];
const MONTH = /^\d{4}-\d{2}$/;
const payCode = (purpose) => /^(\d{5})/.exec(String(purpose || '').trim())?.[1] || null;
const fromCents = (c) => Math.round(c) / 100;

/** JWT'ning amal qilish muddati (token o'zi qaytarilmaydi) */
export function jwtExpiry(token) {
  try {
    const p = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    return p.exp ? new Date(p.exp * 1000).toISOString() : null;
  } catch { return null; }
}

export function register(app) {
  const { r, db, audit } = app;

  /** Manba faylini saqlash (oxirgi yuklangan nusxa ustidan yoziladi) */
  function storeSource(entity, id, buf, fileName) {
    db.run(`INSERT INTO source_files (entity, entity_id, file_name, size, sha256, content_b64, stored_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(entity, entity_id) DO UPDATE SET file_name=excluded.file_name, size=excluded.size, sha256=excluded.sha256, content_b64=excluded.content_b64, stored_at=excluded.stored_at`,
      entity, id, fileName, buf.length, sha256(buf.toString('base64')), buf.toString('base64'), nowIso());
  }
  const sourceMeta = (entity, id) => db.get('SELECT entity, entity_id, file_name, size, stored_at FROM source_files WHERE entity=? AND entity_id=?', entity, id);

  const accountsAll = () => db.all(`SELECT a.*, c.code AS company_code, c.name AS company_name, c.inn AS company_inn
    FROM own_accounts a JOIN own_companies c ON c.id=a.company_id WHERE a.is_active=1 ORDER BY c.id, a.kind, a.id`);

  /** Korrespondent hisob reyestrda bo'lsa — ichki o'tkazma. Reyestr o'zgarganda qayta hisoblanadi. */
  function refreshInternal() {
    db.run(`UPDATE bank_statement_lines SET is_internal = CASE WHEN corr_account IN (SELECT account_number FROM own_accounts WHERE is_active=1) THEN 1 ELSE 0 END`);
  }

  const svc = {
    registry() {
      const accs = accountsAll();
      const erpNums = new Set(db.all('SELECT account_number FROM bank_accounts WHERE account_number IS NOT NULL').map((x) => x.account_number));
      return db.all('SELECT * FROM own_companies ORDER BY id').map((c) => ({
        ...c, accounts: accs.filter((a) => a.company_id === c.id).map((a) => ({ ...a, source: a.kind === 'CASH' ? 'MANUAL' : 'BANK_FILE', erp_duplicate: erpNums.has(a.account_number) })),
      }));
    },
    upsertCompany(b, ctx) {
      const code = String(b.code || '').trim().toUpperCase();
      if (!code || !b.name) throw badRequest('code va name majburiy');
      if (b.inn && !/^\d{9}$/.test(String(b.inn))) throw badRequest('INN 9 xonali bo‘lishi kerak');
      const cur = db.get('SELECT * FROM own_companies WHERE code=?', code);
      const row = { name: String(b.name).trim(), inn: b.inn ? String(b.inn) : null, client_code: b.client_code ? String(b.client_code) : null };
      if (cur) { db.update('own_companies', cur.id, row); audit(ctx, { action: 'UPDATE', entity: 'own_company', entityId: cur.id, oldValue: cur, newValue: row }); return { id: cur.id, created: false }; }
      const id = db.insert('own_companies', { code, ...row, created_at: nowIso() });
      audit(ctx, { action: 'CREATE', entity: 'own_company', entityId: id, newValue: { code, ...row } });
      return { id, created: true };
    },
    upsertAccount(b, ctx) {
      const comp = db.get('SELECT * FROM own_companies WHERE code=?', String(b.company_code || '').toUpperCase());
      if (!comp) throw badRequest(`Kompaniya topilmadi: ${b.company_code}`);
      const num = String(b.account_number || '').trim();
      const kind = b.kind === 'CASH' ? 'CASH' : 'BANK';
      if (kind === 'BANK' && !/^\d{20}$/.test(num)) throw badRequest('Bank hisob raqami 20 xonali bo‘lishi kerak');
      if (kind === 'CASH' && !num) throw badRequest('Kassa kodi majburiy (masalan KASSA-UTAX)');
      if (!b.label) throw badRequest('label majburiy');
      const row = { company_id: comp.id, kind, label: String(b.label).trim(), bank_name: b.bank_name || null, branch: b.branch || null, mfo: b.mfo || null, currency: b.currency || 'UZS', is_active: 1 };
      const cur = db.get('SELECT * FROM own_accounts WHERE account_number=?', num);
      let id, created = false;
      if (cur) { db.update('own_accounts', cur.id, row); id = cur.id; }
      else { id = db.insert('own_accounts', { account_number: num, ...row, created_at: nowIso() }); created = true; }
      refreshInternal();
      audit(ctx, { action: created ? 'CREATE' : 'UPDATE', entity: 'own_account', entityId: id, oldValue: cur, newValue: { account_number: num, ...row } });
      return { id, created };
    },

    /**
     * Bank ko'chirmasini import qilish. preview=true — bazaga yozmaydi.
     * Rad etiladi: fayl nazoratidan o'tmasa, hisob reyestrda bo'lmasa, INN kompaniyanikiga mos kelmasa.
     */
    importStatement(buf, { fileName = null, preview = false } = {}, ctx) {
      let p;
      try { p = parseBankStatement(buf, { fileName }); } catch (e) { throw badRequest(e.message); }
      const acc = p.account ? db.get(`SELECT a.*, c.inn AS company_inn, c.code AS company_code FROM own_accounts a JOIN own_companies c ON c.id=a.company_id WHERE a.account_number=?`, p.account) : null;
      const problems = [];
      if (!acc) problems.push(`Hisob ${p.account || '(topilmadi)'} reyestrda yo‘q — avval kompaniya va hisobni reyestrga qo‘shing`);
      else if (acc.kind !== 'BANK') problems.push(`${p.account} bank hisobi emas`);
      else if (p.inn && acc.company_inn && p.inn !== acc.company_inn) problems.push(`Fayldagi INN ${p.inn} ≠ ${acc.company_code} INN ${acc.company_inn}`);
      for (const c of p.checks) if (!c.ok) problems.push(`${c.name}: ${c.detail}`);
      for (const e of p.errors) problems.push(`Qator ${e.row}: ${e.message}`);
      const own = new Set(db.all('SELECT account_number FROM own_accounts WHERE is_active=1').map((x) => x.account_number));
      const existing = new Set(p.lines.length ? db.all(`SELECT uniq_key FROM bank_statement_lines WHERE account_id=?`, acc?.id ?? -1).map((x) => x.uniq_key) : []);
      const fresh = p.lines.filter((l) => !existing.has(l.uniq_key));
      const summary = {
        format: p.format, file_name: fileName, account: p.account, company: acc?.company_code || null, label: acc?.label || null, inn: p.inn, company_name: p.company_name,
        period_from: p.period_from, period_to: p.period_to, opening: p.opening, inflow: p.totals.inflow, outflow: p.totals.outflow, closing: p.closing,
        ops: p.totals.count, new_ops: fresh.length, duplicates: p.lines.length - fresh.length,
        internal: p.lines.filter((l) => own.has(l.corr_account)).map((l) => ({ tx_date: l.tx_date, direction: l.direction, amount: l.amount, corr_account: l.corr_account })),
        checks: p.checks, ok: !problems.length, problems,
      };
      if (preview || problems.length) {
        if (!preview) throw badRequest('Import rad etildi: ' + problems.join('; '), summary);
        return summary;
      }
      const sha = sha256(buf.toString('base64'));
      db.tx(() => {
        const st = db.get('SELECT id FROM bank_statements WHERE account_id=? AND period_from=? AND period_to=?', acc.id, p.period_from, p.period_to);
        const stRow = { opening: round2(p.opening), closing: round2(p.closing), inflow: round2(p.totals.inflow), outflow: round2(p.totals.outflow), op_count: p.totals.count, format: p.format, file_name: fileName, file_sha: sha, imported_by: ctx?.user?.id || null, imported_at: nowIso() };
        const stId = st ? (db.update('bank_statements', st.id, stRow), st.id) : db.insert('bank_statements', { account_id: acc.id, period_from: p.period_from, period_to: p.period_to, ...stRow });
        for (const l of fresh) {
          db.insert('bank_statement_lines', {
            account_id: acc.id, statement_id: stId, tx_date: l.tx_date, tx_time: l.tx_time, doc_no: l.doc_no, op_code: l.op_code, pay_code: payCode(l.purpose),
            corr_account: l.corr_account, corr_name: l.corr_name, corr_inn: l.corr_inn, corr_mfo: l.corr_mfo, corr_bank: l.corr_bank, purpose: l.purpose,
            amount: round2(l.amount), direction: l.direction, is_internal: own.has(l.corr_account) ? 1 : 0, uniq_key: l.uniq_key, source: 'BANK_FILE', created_at: nowIso(),
          });
        }
        // Asl fayl saqlanadi — "Manba: bank fayli" bosilganda yuklab olinadi
        storeSource('bank_statement', stId, buf, fileName || `${p.account}-${p.period_from}.xls`);
        audit(ctx, { action: 'IMPORT', entity: 'bank_statement', entityId: stId, newValue: { account: p.account, period: `${p.period_from}..${p.period_to}`, file: fileName, new_ops: fresh.length, duplicates: summary.duplicates, closing: p.closing } });
      });
      return { ...summary, imported: true };
    },

    /** Kassa oylik yig'indisi (qo'lda). closing berilsa — nazorat: opening + inflow − outflow = closing */
    /** b.source_file: { file_name, file_base64 } — kassa raqamlari olingan fayl (ixtiyoriy) */
    setCashPeriod(b, ctx) {
      const acc = db.get("SELECT * FROM own_accounts WHERE account_number=? AND kind='CASH'", String(b.account_number || ''));
      if (!acc) throw badRequest(`Kassa topilmadi: ${b.account_number}`);
      if (!MONTH.test(b.period || '')) throw badRequest('period YYYY-MM formatida');
      const nums = ['opening', 'inflow', 'outflow'].map((k) => Number(b[k]));
      if (nums.some((n) => !Number.isFinite(n) || n < 0)) throw badRequest('opening, inflow, outflow — musbat son');
      const [opening, inflow, outflow] = nums.map(round2);
      const calc = fromCents(cents(opening) + cents(inflow) - cents(outflow));
      if (b.closing !== undefined && b.closing !== null && b.closing !== '' && cents(b.closing) !== cents(calc)) throw badRequest(`Nazorat: ${opening} + ${inflow} − ${outflow} = ${calc}, kiritilgan balans ${b.closing}`);
      const cur = db.get('SELECT * FROM cash_period_entries WHERE account_id=? AND period=?', acc.id, b.period);
      const row = { opening, inflow, outflow, closing: calc, note: b.note || null, source: 'MANUAL' };
      let entryId = cur?.id;
      if (cur) db.update('cash_period_entries', cur.id, { ...row, updated_at: nowIso() });
      else entryId = db.insert('cash_period_entries', { account_id: acc.id, period: b.period, ...row, created_by: ctx?.user?.id || null, created_at: nowIso() });
      if (b.source_file?.file_base64) storeSource('cash_period', entryId, Buffer.from(b.source_file.file_base64, 'base64'), String(b.source_file.file_name || `kassa-${b.period}.xlsx`));
      audit(ctx, { action: cur ? 'UPDATE' : 'CREATE', entity: 'cash_period', entityId: cur?.id || null, oldValue: cur, newValue: { account: acc.account_number, period: b.period, ...row } });
      return { account_number: acc.account_number, period: b.period, ...row };
    },

    months() {
      return db.all(`SELECT DISTINCT m FROM (
          SELECT substr(tx_date,1,7) m FROM bank_statement_lines UNION SELECT substr(period_from,1,7) FROM bank_statements UNION SELECT period FROM cash_period_entries)
        WHERE m IS NOT NULL ORDER BY m DESC`).map((x) => x.m);
    },

    /** Tanlov doirasi: company (kod, katta-kichik harf farqsiz) va/yoki account (raqam). Hech biri — global. */
    scope({ company, account } = {}) {
      const all = accountsAll();
      let accs = all, level = 'global', comp = null;
      if (company && String(company).toLowerCase() !== 'global') {
        comp = db.get('SELECT * FROM own_companies WHERE lower(code)=lower(?)', String(company));
        if (!comp) throw notFound(`Kompaniya topilmadi: ${company}`);
        accs = all.filter((a) => a.company_id === comp.id);
        level = 'company';
      }
      // "Barcha bank hisoblari" — barcha kompaniyalarning bank hisoblari (kassasiz), yalpi: ichki o'tkazmalar chiqarilmaydi
      // (Excel'dagi "Umumiy bank hisobi" qatori bilan bir xil hisob)
      if (account === 'banks') return { level: 'banks', company: comp, accounts: all.filter((a) => a.kind === 'BANK'), internalSet: new Set() };
      if (account && account !== 'all') {
        const a = accs.find((x) => x.account_number === account);
        if (!a) throw notFound(`Hisob tanlangan doirada topilmadi: ${account}`);
        accs = [a];
        level = 'account';
      }
      // Ichki o'tkazma chiqariladigan hisoblar to'plami: hisob darajasida — hech biri; kompaniyada — o'sha kompaniya hisoblari; globalda — hammasi
      const internalSet = level === 'account' ? new Set() : new Set((level === 'company' ? all.filter((a) => a.company_id === comp.id) : all).map((a) => a.account_number));
      return { level, company: comp, accounts: accs, internalSet };
    },

    accountMonth(a, month, internalSet) {
      const base = { account_number: a.account_number, label: a.label, kind: a.kind, company_code: a.company_code, bank_name: a.bank_name, branch: a.branch, mfo: a.mfo };
      if (a.kind === 'CASH') {
        const e = db.get('SELECT * FROM cash_period_entries WHERE account_id=? AND period=?', a.id, month);
        if (!e) return { ...base, source: 'MANUAL', has_data: false };
        return { ...base, source: 'MANUAL', has_data: true, opening: e.opening, inflow_gross: e.inflow, outflow_gross: e.outflow, internal_in: 0, internal_out: 0, scope_internal_in: 0, scope_internal_out: 0, closing: e.closing, closing_file: e.closing, ops: null, check_ok: true, note: e.note, source_file: sourceMeta('cash_period', e.id) };
      }
      const st = db.get(`SELECT * FROM bank_statements WHERE account_id=? AND substr(period_from,1,7)=? ORDER BY period_from LIMIT 1`, a.id, month);
      const last = db.get(`SELECT * FROM bank_statements WHERE account_id=? AND substr(period_to,1,7)=? ORDER BY period_to DESC LIMIT 1`, a.id, month);
      const lines = db.all(`SELECT direction, amount, is_internal, corr_account FROM bank_statement_lines WHERE account_id=? AND substr(tx_date,1,7)=?`, a.id, month);
      if (!st && !lines.length) return { ...base, source: 'BANK_FILE', has_data: false };
      let inC = 0, outC = 0, iIn = 0, iOut = 0, sIn = 0, sOut = 0;
      for (const l of lines) {
        const c = cents(l.amount);
        if (l.direction === 'IN') { inC += c; if (l.is_internal) iIn += c; if (internalSet.has(l.corr_account)) sIn += c; }
        else { outC += c; if (l.is_internal) iOut += c; if (internalSet.has(l.corr_account)) sOut += c; }
      }
      const opening = st ? st.opening : null;
      const closing = opening === null ? null : fromCents(cents(opening) + inC - outC);
      const closingFile = last ? last.closing : null;
      return {
        ...base, source: 'BANK_FILE', has_data: true, opening, inflow_gross: fromCents(inC), outflow_gross: fromCents(outC),
        internal_in: fromCents(iIn), internal_out: fromCents(iOut), scope_internal_in: fromCents(sIn), scope_internal_out: fromCents(sOut),
        closing, closing_file: closingFile, ops: lines.length, check_ok: closing !== null && closingFile !== null && cents(closing) === cents(closingFile),
        statement: st ? { id: st.id, period_from: st.period_from, period_to: st.period_to, file_name: st.file_name, imported_at: st.imported_at, source_file: sourceMeta('bank_statement', st.id) } : null,
      };
    },

    summary(q = {}) {
      const months = svc.months();
      const month = MONTH.test(q.month || '') ? q.month : months[0] || null;
      const sc = svc.scope(q);
      const base = { month, months, level: sc.level, company: sc.company ? { code: sc.company.code, name: sc.company.name, inn: sc.company.inn } : null, registry: svc.registry() };
      // Hali birorta oy yuklanmagan — javob shakli ma'lumotli holat bilan BIR XIL (web, bot, AI bir xil o'qisin): raqamlar null ('--'), ro'yxatlar bo'sh
      if (!month) return {
        ...base, has_data: false, missing: sc.accounts.map((a) => a.label), opening: null, inflow: null, outflow: null, closing: null,
        inflow_gross: null, outflow_gross: null, internal_in: null, internal_out: null, internal_excluded: sc.internalSet.size > 0, check_ok: false, sources: [], accounts: [],
      };
      const rows = sc.accounts.map((a) => svc.accountMonth(a, month, sc.internalSet));
      const withData = rows.filter((x) => x.has_data);
      const missing = rows.filter((x) => !x.has_data).map((x) => x.label);
      const total = (k) => fromCents(withData.reduce((s, x) => s + cents(x[k] || 0), 0));
      const openingKnown = withData.length && withData.every((x) => x.opening !== null) && !missing.length;
      const inflowGross = total('inflow_gross'), outflowGross = total('outflow_gross');
      const scopeIn = total('scope_internal_in'), scopeOut = total('scope_internal_out');
      const opening = openingKnown ? total('opening') : null;
      const closing = openingKnown ? total('closing') : null;
      return {
        ...base, has_data: withData.length > 0, missing,
        opening, inflow: fromCents(cents(inflowGross) - cents(scopeIn)), outflow: fromCents(cents(outflowGross) - cents(scopeOut)),
        inflow_gross: inflowGross, outflow_gross: outflowGross, internal_in: sc.internalSet.size ? scopeIn : total('internal_in'), internal_out: sc.internalSet.size ? scopeOut : total('internal_out'),
        internal_excluded: sc.internalSet.size > 0, closing, check_ok: withData.every((x) => x.check_ok) && openingKnown,
        sources: [...new Set(withData.map((x) => x.source))].sort((a, b) => SOURCE_PRIORITY.indexOf(a) - SOURCE_PRIORITY.indexOf(b)),
        accounts: rows,
      };
    },

    /** Drill-down: tanlangan doira va oy operatsiyalari. net=1 — doira ichidagi ichki o'tkazmalarsiz (kartadagi raqam bilan bir xil). */
    lines(q = {}) {
      const sc = svc.scope(q);
      const month = MONTH.test(q.month || '') ? q.month : svc.months()[0];
      const bankIds = sc.accounts.filter((a) => a.kind === 'BANK').map((a) => a.id);
      if (!bankIds.length || !month) return { month, rows: [], cash_only: sc.accounts.some((a) => a.kind === 'CASH') };
      const where = [`l.account_id IN (${bankIds.map(() => '?').join(',')})`, 'substr(l.tx_date,1,7)=?'];
      const args = [...bankIds, month];
      if (q.direction === 'IN' || q.direction === 'OUT') { where.push('l.direction=?'); args.push(q.direction); }
      if (q.internal === 'only') where.push('l.is_internal=1');
      let rows = db.all(`SELECT l.*, a.account_number, a.label AS account_label, c.code AS company_code FROM bank_statement_lines l
        JOIN own_accounts a ON a.id=l.account_id JOIN own_companies c ON c.id=a.company_id WHERE ${where.join(' AND ')} ORDER BY l.tx_date, l.tx_time, l.id`, ...args);
      if (String(q.net) === '1') rows = rows.filter((l) => !sc.internalSet.has(l.corr_account));
      return { month, level: sc.level, rows, cash_only: false, has_cash: sc.accounts.some((a) => a.kind === 'CASH') };
    },

    /** ERP holati: oxirgi muvaffaqiyatli sinxron, oxirgi xato, token muddati (token o'zi qaytarilmaydi) */
    erpStatus() {
      const integ = db.get("SELECT * FROM integrations WHERE type='UTAXERP' ORDER BY id DESC LIMIT 1");
      if (!integ) return { connected: false };
      let exp = null;
      try { const sec = parseJson(decryptSecret(integ.secret_config), {}); exp = jwtExpiry(sec.api_key || sec.token); } catch { exp = null; }
      const errRow = db.get("SELECT value FROM settings WHERE key='scheduler.erp_last_error'");
      const lastError = errRow ? parseJson(errRow.value, null) : null;
      const expired = exp ? new Date(exp) <= new Date() : false;
      const errorAfterSuccess = lastError && (!integ.last_sync_at || lastError.at > integ.last_sync_at);
      return {
        connected: true, active: !!integ.is_active, last_sync_at: integ.last_sync_at, last_status: integ.last_status, token_expires_at: exp, token_expired: expired,
        last_error: errorAfterSuccess ? lastError : null, stale: expired || !!(errorAfterSuccess && /401|token/i.test(lastError.message || '')),
      };
    },
    /** Yangi ERP tokenini saqlash (shifrlangan). Token JWT bo'lishi va muddati o'tmagan bo'lishi kerak. */
    setErpToken(token, ctx) {
      const t = String(token || '').trim();
      const exp = jwtExpiry(t);
      if (!exp) throw badRequest('Token JWT formatida emas');
      if (new Date(exp) <= new Date()) throw badRequest(`Token muddati allaqachon o‘tgan (${exp.slice(0, 10)})`);
      const integ = db.get("SELECT * FROM integrations WHERE type='UTAXERP' ORDER BY id DESC LIMIT 1");
      if (!integ) throw notFound('UTAXERP integratsiyasi ulanmagan');
      db.run('UPDATE integrations SET secret_config=?, is_active=1 WHERE id=?', encryptSecret(JSON.stringify({ api_key: t })), integ.id);
      db.run("DELETE FROM settings WHERE key='scheduler.erp_last_error'");
      audit(ctx, { action: 'UPDATE', entity: 'integration', entityId: integ.id, newValue: { erp_token: 'yangilandi', expires_at: exp } });
      return { ok: true, token_expires_at: exp };
    },
  };
  app.services.bankLedger = svc;

  r.get('/api/bank-ledger/registry', { perm: ['treasury', 'VIEW'], tags: ['bank-ledger'], summary: 'O‘z kompaniyalarimiz va hisoblar reyestri' }, async () => svc.registry());
  r.post('/api/bank-ledger/companies', { perm: ['treasury', 'CREATE'], tags: ['bank-ledger'], summary: 'Kompaniya qo‘shish/yangilash {code, name, inn, client_code}' }, async (ctx) => svc.upsertCompany(ctx.body || {}, ctx));
  r.post('/api/bank-ledger/accounts', { perm: ['treasury', 'CREATE'], tags: ['bank-ledger'], summary: 'Hisob qo‘shish/yangilash {company_code, account_number, kind, label, bank_name, branch, mfo}' }, async (ctx) => svc.upsertAccount(ctx.body || {}, ctx));
  r.post('/api/bank-ledger/import', { perm: ['transactions', 'CREATE'], tags: ['bank-ledger'], summary: 'Bank ko‘chirmasi (.xls/.xlsx: ASBT yoki Open Bank) {file_base64, file_name, preview?}' }, async (ctx) => {
    const b = ctx.body || {};
    if (!b.file_base64) throw badRequest('file_base64 majburiy');
    return svc.importStatement(Buffer.from(b.file_base64, 'base64'), { fileName: b.file_name || null, preview: !!b.preview }, ctx);
  });
  r.put('/api/bank-ledger/cash-period', { perm: ['treasury', 'CREATE'], tags: ['bank-ledger'], summary: 'Kassa oylik yig‘indisi (qo‘lda) {account_number, period, opening, inflow, outflow, closing?}' }, async (ctx) => svc.setCashPeriod(ctx.body || {}, ctx));
  r.get('/api/bank-ledger/summary', { perm: ['treasury', 'VIEW'], tags: ['bank-ledger'], summary: 'Boshlang‘ich qoldiq · Tushum · Xarajat · Balans (company, account, month)', query: ['company', 'account', 'month'] }, async (ctx) => svc.summary(ctx.query));
  r.get('/api/bank-ledger/lines', { perm: ['treasury', 'VIEW'], tags: ['bank-ledger'], summary: 'Operatsiyalar (drill-down)', query: ['company', 'account', 'month', 'direction', 'internal', 'net'] }, async (ctx) => svc.lines(ctx.query));
  r.get('/api/bank-ledger/source-files/:entity/:id', { perm: ['treasury', 'VIEW'], tags: ['bank-ledger'], summary: 'Manba faylini yuklab olish (bank ko‘chirmasi yoki kassa uchun berilgan fayl)', raw: true }, async (ctx) => {
    const f = db.get('SELECT * FROM source_files WHERE entity=? AND entity_id=?', String(ctx.params.entity), Number(ctx.params.id));
    if (!f) throw notFound('Bu yozuvning manba fayli saqlanmagan — faylni qayta import qiling');
    audit(ctx, { action: 'EXPORT', entity: f.entity, entityId: f.entity_id, newValue: { source_file: f.file_name } });
    const type = /\.xlsx$/i.test(f.file_name) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : /\.xls$/i.test(f.file_name) ? 'application/vnd.ms-excel' : 'application/octet-stream';
    ctx.res.writeHead(200, { 'Content-Type': type, 'Content-Length': f.size, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.file_name)}`, 'Cache-Control': 'no-store' });
    ctx.res.end(Buffer.from(f.content_b64, 'base64'));
  });
  r.get('/api/bank-ledger/erp-status', { perm: ['dashboard', 'VIEW'], tags: ['bank-ledger'], summary: 'ERP sinxron holati va token muddati' }, async () => svc.erpStatus());
  r.post('/api/integrations/erp-token', { perm: ['integrations', 'EDIT'], tags: ['integrations'], summary: 'ERP tokenini yangilash {token} (shifrlangan saqlanadi)' }, async (ctx) => svc.setErpToken(ctx.body?.token, ctx));
}
