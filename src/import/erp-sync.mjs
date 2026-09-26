/**
 * UTAXERP → baza sinxron (faqat ERP'dagi real ma'lumot). Idempotent: qayta ishlaganda takror yozmaydi.
 * Manba (Prisma find-many): financeAccount, inOutMoney (INCOME), contract, lead.
 * Ilova ichidagi scheduler (server.mjs) va CLI (scripts/erp-import.mjs) shu moduldan foydalanadi.
 */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const iso = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(+d) ? null : d.toISOString().slice(0, 10); };
const nowIso = () => new Date().toISOString();

function makeClient(base, token) {
  const root = String(base).replace(/\/$/, '');
  async function findMany(model, body = {}) {
    const res = await fetch(`${root}/api/${model}/find-many`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await res.text();
    if (res.status === 401 || res.status === 403) throw new Error(`ERP ${model}: HTTP ${res.status} — token noto‘g‘ri/muddati o‘tgan yoki IP ruxsat etilmagan`);
    if (!res.ok) throw new Error(`ERP ${model}: HTTP ${res.status} ${text.slice(0, 120)}`);
    const j = JSON.parse(text);
    return { total: j.totalCount ?? (Array.isArray(j) ? j.length : (j.data || []).length), data: j.data || (Array.isArray(j) ? j : []) };
  }
  async function pullAll(model, where) {
    const take = 500, out = []; let total = 0;
    for (let skip = 0; ; skip += take) {
      const { total: t, data } = await findMany(model, { take, skip, ...(where ? { where } : {}) });
      total = t; out.push(...data);
      if (data.length < take || out.length >= total) break;
    }
    return { total, rows: out };
  }
  return { findMany, pullAll };
}

/**
 * @param app  createApp natijasi (app.db, app.services)
 * @param opts {token, base='https://api.utaxerp.uz', log}
 * @returns {res, verify}  — yozilgan sonlar va ERP↔baza solishtiruvi
 */
/**
 * ERP tokenini tanlash: MUDDATI O'TMAGANI ustun.
 *
 * Nega: token har oy almashadi. Yangisi odatda `.erp-token` ga tashlanadi, lekin `.env` dagi eski
 * nusxa har doim ustun kelib, sinxron jim 401 bilan to'xtardi va sabab ko'rinmasdi.
 * Endi ikkala manba ham tekshiriladi va amal qilayotgani olinadi (tenglikda `.erp-token`).
 *
 * @param sources  [{ name, token }] — ustuvorlik tartibida
 * @returns { token, name, exp } yoki hammasi yaroqsiz bo'lsa { token: '', reason }
 */
export function pickErpToken(sources) {
  const now = Date.now() / 1000;
  const parsed = sources.filter((s) => s.token).map((s) => {
    let exp = null;
    try { exp = JSON.parse(Buffer.from(String(s.token).split('.')[1], 'base64url').toString()).exp ?? null; } catch { /* JWT emas — muddatini bilib bo'lmaydi */ }
    return { ...s, exp, valid: exp === null || exp > now };
  });
  if (!parsed.length) return { token: '', reason: 'token topilmadi (.erp-token yoki ERP_TOKEN)' };
  const ok = parsed.find((s) => s.valid);
  if (ok) return { token: ok.token, name: ok.name, exp: ok.exp };
  const latest = parsed.reduce((a, b) => ((b.exp || 0) > (a.exp || 0) ? b : a));
  return { token: '', reason: `barcha tokenlarning muddati o'tgan (eng yangisi ${latest.name}, ${new Date(latest.exp * 1000).toISOString().slice(0, 16).replace('T', ' ')})` };
}

export async function erpSync(app, { token, base = 'https://api.utaxerp.uz', log = () => {} }) {
  if (!token) throw new Error('ERP token yo‘q');
  const { db } = app;
  const { findMany, pullAll } = makeClient(base, token);

  log('ERP tortilyapti...');
  const accounts = await pullAll('financeAccount');
  const inout = await pullAll('inOutMoney');
  const contracts = await pullAll('contract');
  const leadIds = [...new Set(contracts.rows.map((c) => c.leadId).filter(Boolean))];
  const leads = new Map();
  for (let i = 0; i < leadIds.length; i += 100) {
    const { data } = await findMany('lead', { take: 100, where: { id: { in: leadIds.slice(i, i + 100) } } });
    for (const l of data) leads.set(l.id, l);
  }
  log(`  financeAccount ${accounts.total} · inOutMoney ${inout.total} · contract ${contracts.total} · lead ${leads.size}`);

  const res = { accounts: 0, cash: 0, companies: 0, contracts: 0, income: 0, dup: 0 };
  let stId = db.get("SELECT id FROM service_types WHERE code='ERP'")?.id;
  if (!stId) stId = db.insert('service_types', { code: 'ERP', name: 'ERP shartnoma', prefix: 'E', recognition_rule: JSON.stringify({ method: 'ON_PAYMENT' }), payment_rule: '{}', kpi_rule: '{}', expense_rule: '{}', collection_rule: '{}', sort: 90 });

  db.tx(() => {
    // 1) Hisoblar (Cash → kassa, aks holda bank). Ko'rsatiladigan qoldiq = ERP balanceSum (opening = balanceSum − kirim).
    const incByAcc = {};
    for (const t of inout.rows) incByAcc[t.financeAccountId] = round2((incByAcc[t.financeAccountId] || 0) + Number(t.value || 0));
    const accMap = {};
    for (const a of accounts.rows) {
      const isCash = Array.isArray(a.types) && a.types.includes('Cash') && !a.types.includes('Transfer');
      const cur = (Array.isArray(a.currency) ? a.currency[0] : a.currency) || 'UZS';
      const opening = round2(Number(a.balanceSum || 0) - (incByAcc[a.id] || 0));
      const marker = `[erp:acc:${a.id}]`;
      const tbl = isCash ? 'cash_accounts' : 'bank_accounts';
      let row = db.get(`SELECT id FROM ${tbl} WHERE ${isCash ? 'name' : 'account_number'} LIKE ?`, `%${marker}%`);
      if (row) { db.run(`UPDATE ${tbl} SET opening_balance=? WHERE id=?`, opening, row.id); } // qoldiqni ERP bilan sinxronla
      else if (isCash) { row = { id: db.insert('cash_accounts', { name: `${a.name} ${marker}`, currency: cur, opening_balance: opening, opening_date: '2025-01-01' }) }; res.cash++; }
      else { row = { id: db.insert('bank_accounts', { bank_name: a.name, account_number: marker, currency: cur, opening_balance: opening, opening_date: '2025-01-01' }) }; res.accounts++; }
      accMap[a.id] = { kind: isCash ? 'CASH' : 'BANK', id: row.id };
    }

    // 2) Kompaniyalar (lead) + shartnomalar
    const companyByLead = {};
    const companyId = (leadId) => {
      if (!leadId) return null;
      if (companyByLead[leadId]) return companyByLead[leadId];
      const l = leads.get(leadId);
      const marker = `[erp:lead:${leadId}]`;
      let row = db.get('SELECT id FROM companies WHERE notes LIKE ?', `%${marker}%`);
      if (!row) { row = { id: db.insert('companies', { name: (l?.title || `Lead ${leadId.slice(0, 8)}`).slice(0, 200), inn: l?.data?.inn || null, phone: l?.data?.phone || null, kind: 'CLIENT', notes: `UTAXERP ${marker}`, created_at: nowIso() }) }; res.companies++; }
      return (companyByLead[leadId] = row.id);
    };
    const contractByErp = {};
    for (const c of contracts.rows) {
      const marker = `[erp:con:${c.id}]`;
      let row = db.get('SELECT id FROM contracts WHERE comments LIKE ?', `%${marker}%`);
      if (row) { db.run('UPDATE contracts SET amount=?, comments=? WHERE id=?', round2(c.sum), `UTAXERP: ${c.status || ''} · sum ${c.sum} paid ${c.paidSum} debt ${c.debtSum} ${marker}`, row.id); }
      else {
        let num = (c.nomer || `ERP-${c.id.slice(0, 8)}`).slice(0, 80);
        if (db.get('SELECT 1 x FROM contracts WHERE contract_number=?', num)) num = `${num} (${c.id.slice(0, 6)})`.slice(0, 90);
        row = { id: db.insert('contracts', {
          contract_number: num, company_id: companyId(c.leadId), service_type_id: stId, title: null, amount: round2(c.sum), currency: 'UZS',
          contract_date: iso(c.startDate), start_date: iso(c.startDate), end_date: iso(c.endDate), advance_pct: null, advance_amount: null, expected_final_payment: null, advance_due_date: null, payment_due_date: iso(c.endDate),
          manager_user_id: null, contract_status: c.status === 'Success' ? 'PAID' : 'ACTIVE', service_status: null, payment_status: round2(c.debtSum) > 0 ? 'PARTIAL' : 'PAID',
          comments: `UTAXERP: ${c.status || ''} · sum ${c.sum} paid ${c.paidSum} debt ${c.debtSum} ${marker}`, created_by: null, created_at: nowIso(),
        }) }; res.contracts++;
      }
      contractByErp[c.id] = row.id;
    }

    // 3) Kirim tranzaksiyalari (inOutMoney, INCOME) — hisob va shartnomaga bog'langan
    for (const t of inout.rows) {
      const key = `erp:${t.id}`;
      const acc = accMap[t.financeAccountId];
      const date = iso(t.date);
      if (!acc || !date) continue;
      const cid = t.contractId ? contractByErp[t.contractId] : null;
      if (acc.kind === 'BANK') {
        if (db.get('SELECT id FROM bank_transactions WHERE external_id=?', key)) { res.dup++; continue; }
        const id = db.insert('bank_transactions', { bank_account_id: acc.id, external_id: key, tx_date: date, amount: round2(t.value), currency: t.currency || 'UZS', direction: 'INCOME', counterparty_name: null, purpose: t.comment || 'UTAXERP kirim', cf_class: 'OPERATING', matching_status: cid ? 'MATCHED' : 'UNMATCHED', matched_contract_id: cid || null, created_at: nowIso() });
        if (cid) db.insert('payments', { contract_id: cid, amount: round2(t.value), paid_at: date, source: 'BANK', bank_transaction_id: id, created_by: null, created_at: nowIso() });
      } else {
        if (db.get('SELECT id FROM cash_transactions WHERE instr(purpose, ?) > 0', `[${key}]`)) { res.dup++; continue; }
        const id = db.insert('cash_transactions', { cash_account_id: acc.id, tx_date: date, amount: round2(t.value), direction: 'INCOME', counterparty_name: null, purpose: `${t.comment || 'UTAXERP kirim'} [${key}]`, contract_id: cid || null, cf_class: 'OPERATING', created_by: null, created_at: nowIso() });
        if (cid) db.insert('payments', { contract_id: cid, amount: round2(t.value), paid_at: date, source: 'CASH', cash_transaction_id: id, created_by: null, created_at: nowIso() });
      }
      res.income++;
    }
  });
  app.services.contracts.recomputeAll?.();

  const erpIncome = round2(inout.rows.reduce((s, t) => s + Number(t.value || 0), 0));
  const dbIncome = round2((db.get("SELECT COALESCE(SUM(amount),0) s FROM bank_transactions WHERE direction='INCOME'").s) + (db.get("SELECT COALESCE(SUM(amount),0) s FROM cash_transactions WHERE direction='INCOME'").s));
  const verify = { income_count_ok: inout.total === res.income + res.dup, income_sum_ok: Math.abs(erpIncome - dbIncome) < 1, contracts_ok: contracts.total === res.contracts + (contracts.total - res.contracts), erp: { income: inout.total, income_sum: erpIncome, contracts: contracts.total, accounts: accounts.total }, db: { income_sum: dbIncome } };
  verify.ok = verify.income_count_ok && verify.income_sum_ok;
  return { res, verify };
}

/**
 * ERP'ning BARCHA modellarini `erp_raw` oynasiga ko'chiradi va kontragentlarni boyitadi
 * (INN/nom/manzil/telefon: contract → lead → client → companyINN). Og'ir — kuniga bir marta.
 */
export async function erpFullMirror(app, { token, base = 'https://api.utaxerp.uz', log = () => {}, only = [], skip = [] }) {
  if (!token) throw new Error('ERP token yo‘q');
  const { db } = app;
  const { findMany } = makeClient(base, token);
  const root = String(base).replace(/\/$/, '');
  const docs = await (await fetch(`${root}/api/docs-json`)).json();
  let models = [...new Set(Object.keys(docs.paths || {}).map((p) => /^\/api\/([^/]+)\/find-many$/.exec(p)?.[1]).filter(Boolean))];
  if (only.length) models = models.filter((m) => only.includes(m));
  if (skip.length) models = models.filter((m) => !skip.includes(m));

  db.exec('CREATE TABLE IF NOT EXISTS erp_raw (model TEXT NOT NULL, erp_id TEXT NOT NULL, data TEXT NOT NULL, synced_at TEXT NOT NULL, PRIMARY KEY (model, erp_id))');
  db.exec('CREATE INDEX IF NOT EXISTS ix_erp_raw_model ON erp_raw(model)');

  const report = [];
  for (const model of models) {
    let total = 0, got = 0, err = null; const take = 500;
    try {
      for (let sk = 0; ; sk += take) {
        const { total: t, data } = await findMany(model, { take, skip: sk });
        total = t;
        if (data.length) db.tx(() => { for (const row of data) { db.run('INSERT INTO erp_raw (model, erp_id, data, synced_at) VALUES (?,?,?,?) ON CONFLICT(model, erp_id) DO UPDATE SET data=excluded.data, synced_at=excluded.synced_at', model, String(row.id ?? `${model}:${sk}:${got}`), JSON.stringify(row), nowIso()); got++; } });
        if (data.length < take || got >= total) break;
      }
    } catch (e) { err = e.message.slice(0, 60); }
    report.push({ model, total, got, err });
    log(`  ${err ? '✗' : '✓'} ${model.padEnd(24)} ${err || `${got}/${total}`}`);
  }

  // Kontragentlarni boyitish
  const leadById = new Map(); for (const r of db.all("SELECT erp_id, data FROM erp_raw WHERE model='lead'")) { try { leadById.set(r.erp_id, JSON.parse(r.data)); } catch {} }
  const clientById = new Map(); for (const r of db.all("SELECT erp_id, data FROM erp_raw WHERE model='client'")) { try { clientById.set(r.erp_id, JSON.parse(r.data)); } catch {} }
  let enriched = 0, innSet = 0, renamed = 0;
  db.tx(() => {
    for (const co of db.all("SELECT id, name, inn, phone, address, notes FROM companies WHERE notes LIKE '%[erp:lead:%'")) {
      const leadId = /\[erp:lead:([^\]]+)\]/.exec(co.notes || '')?.[1];
      const cl = leadId && leadById.get(leadId)?.clientId ? clientById.get(leadById.get(leadId).clientId) : null;
      if (!cl) continue;
      const upd = {};
      if (cl.companyINN && !co.inn) { upd.inn = String(cl.companyINN).trim(); innSet++; }
      const nm = cl.companyName || [cl.lastName, cl.firstName, cl.fatherName].filter(Boolean).join(' ').trim();
      if (nm && nm.length > 2 && nm !== co.name) { upd.name = nm.slice(0, 200); renamed++; }
      if (!co.phone && (cl.companyPhone || cl.phone)) upd.phone = String(cl.companyPhone || cl.phone).slice(0, 40);
      if (!co.address && cl.companyAddress) upd.address = String(cl.companyAddress).slice(0, 300);
      if (Object.keys(upd).length) { db.update('companies', co.id, upd); enriched++; }
    }
  });
  const rows = db.get('SELECT COUNT(*) c FROM erp_raw').c;
  return { models: report.length, ok: report.filter((r) => !r.err).length, failed: report.filter((r) => r.err).map((r) => `${r.model} (${r.err})`), rows, enriched, innSet, renamed };
}
