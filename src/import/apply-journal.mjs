/**
 * Import rejasini (excel-journal.mjs → parseJournal) bazaga qo'llash — mavjud servislar orqali, bitta tranzaksiyada
 * (xato bo'lsa hech narsa yozilmaydi). Idempotent: qayta import takror yaratmaydi (kalit XLS-<oy>-<No>).
 *
 * QOIDA — hech narsa to'qilmaydi: Excel'da yo'q maydonlar NULL (ko'rsatishda '--').
 *  - Shartnoma contracts.create orqali EMAS (u o'zi muddat +30/+5 kun, to'lov jadvali, menejer qo'yadi) — to'g'ridan-to'g'ri
 *    yoziladi: sana/muddat/avans/xizmat holati/menejer/sarlavha NULL, to'lov jadvali yaratilmaydi, keyin recompute.
 *  - Xarajat expenses.createDirect orqali EMAS (u kategoriyani kalit so'z bo'yicha taxmin qiladi, approved_at=hozir) —
 *    to'g'ridan-to'g'ri APPROVED yoziladi, to'lov esa servis orqali (reconciliation.confirmExpense / banking.createCashTransaction).
 *  - Daromad tan olinmaydi (revenue_recognition yaratilmaydi) — Excel'da sana yo'q; tushumlar tizim qoidasi bo'yicha avans.
 *  - ctx.user = null (source IMPORT): menejer/so'rovchi/tasdiqlovchi hech kimga yozilmaydi.
 */
import { nowIso, round2 } from '../core/util.mjs';
import { DEFAULT_SETTINGS } from '../core/settings.mjs';
import { CATEGORY_MAP, keyOf } from './excel-journal.mjs';

export const IMPORT_CTX = Object.freeze({ user: null, source: 'IMPORT', ip: null });
/** Excel pul hisoblari nomi (Поступление/Расход БАНК|КАССА) — tizimdagi hisob nomi */
export const BANK_NAME = 'БАНК';
export const CASH_NAME = 'КАССА';
/** Xizmat turi tan olish qoidasi — tizim standarti (POST /api/service-types bilan bir xil); to'lov qoidasi yo'q (Excel'da yo'q) */
const RECOGNITION_RULE = { method: 'ON_COMPLETION', require_acceptance_document: true };

const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h' };
export const translit = (s) => [...String(s ?? '').toLowerCase()].map((ch) => TR[ch] ?? ch).join('');
const codeOf = (s) => translit(s).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'X';

export function applyJournal(app, plan, { ctx = IMPORT_CTX } = {}) {
  if (plan.errors?.length) throw new Error(`Import rejasida ${plan.errors.length} ta xato bor — hech narsa yozilmadi`);
  const { db, audit, settings } = app;
  const S = app.services;
  const base = settings.get('company.base_currency') || 'UZS';
  const zero = () => ({ companies: 0, service_types: 0, categories: 0, bank_accounts: 0, cash_accounts: 0, contracts: 0, payments: 0, bank_transactions: 0, cash_transactions: 0, expenses: 0 });
  const res = { created: zero(), existing: zero(), reference: { service_types: [], categories: [], bank_account: null, cash_account: null } };

  const uniq = (table, col, want) => { let v = want, i = 2; while (db.get(`SELECT 1 x FROM ${table} WHERE ${col}=?`, v)) v = `${want}_${i++}`; return v; };
  const cashByMarker = (key) => db.get('SELECT id FROM cash_transactions WHERE instr(purpose, ?) > 0', `[${key} `);
  const bankByExt = (bankId, key) => db.get('SELECT id FROM bank_transactions WHERE bank_account_id=? AND external_id=?', bankId, key);

  db.tx(() => {
    // ---------- 0) To'qnashuvlarni oldindan tekshirish (hech narsa yozilmasdan) ----------
    for (const c of plan.contracts) {
      const byMarker = db.get('SELECT id FROM contracts WHERE instr(comments, ?) > 0', `[${c.key} `);
      const byNum = db.get('SELECT c.id, c.amount, co.name company FROM contracts c JOIN companies co ON co.id=c.company_id WHERE c.contract_number=?', String(c.no));
      if (!byMarker && byNum && !(keyOf(byNum.company) === keyOf(c.company) && Math.abs(byNum.amount - c.amount) < 0.01))
        throw new Error(`Shartnoma raqami "${c.no}" bazada boshqa shartnomaga tegishli (${byNum.company}, ${byNum.amount}) — import to‘xtatildi`);
    }

    // ---------- 1) Minimal ma'lumotnoma ----------
    let bank = db.get('SELECT id FROM bank_accounts WHERE bank_name=? AND account_number IS NULL AND is_active=1 ORDER BY id LIMIT 1', BANK_NAME);
    const needBank = plan.contracts.some((c) => c.payments.some((p) => p.side === 'BANK')) || [...plan.incomes, ...plan.expenses, ...plan.nonExpenses].some((x) => x.side === 'BANK') || plan.transfers.some((t) => t.from === 'BANK' || t.to === 'BANK');
    const needCash = plan.contracts.some((c) => c.payments.some((p) => p.side === 'CASH')) || [...plan.incomes, ...plan.expenses, ...plan.nonExpenses].some((x) => x.side === 'CASH') || plan.transfers.some((t) => t.from === 'CASH' || t.to === 'CASH');
    if (!bank && needBank) {
      // Boshlang'ich qoldiq Excel'da yo'q → NULL (qoldiq '--'); hisob raqami yo'q → NULL
      bank = { id: db.insert('bank_accounts', { bank_name: BANK_NAME, account_number: null, currency: base, opening_balance: null, opening_date: null }) };
      audit(ctx, { action: 'CREATE', entity: 'bank_account', entityId: bank.id, newValue: { bank_name: BANK_NAME, opening_balance: null, source: 'EXCEL' } });
      res.created.bank_accounts++;
    } else if (bank) res.existing.bank_accounts++;
    let cash = db.get('SELECT id FROM cash_accounts WHERE name=? AND is_active=1 ORDER BY id LIMIT 1', CASH_NAME);
    if (!cash && needCash) {
      cash = { id: db.insert('cash_accounts', { name: CASH_NAME, currency: base, opening_balance: null, opening_date: null, responsible_user_id: null }) };
      audit(ctx, { action: 'CREATE', entity: 'cash_account', entityId: cash.id, newValue: { name: CASH_NAME, opening_balance: null, source: 'EXCEL' } });
      res.created.cash_accounts++;
    } else if (cash) res.existing.cash_accounts++;
    res.reference.bank_account = bank ? { id: bank.id, bank_name: BANK_NAME } : null;
    res.reference.cash_account = cash ? { id: cash.id, name: CASH_NAME } : null;

    const companies = new Map(db.all('SELECT id, name FROM companies').map((x) => [keyOf(x.name), x.id]));
    const companyId = (c) => {
      const k = keyOf(c.company);
      if (companies.has(k)) { res.existing.companies++; return companies.get(k); }
      const id = db.insert('companies', { name: c.company, inn: null, phone: null, email: null, address: null, director: null, manager_user_id: null, kind: 'CLIENT', notes: `Excel Kontragent — Dogovor No ${c.no} (qator ${c.sale_row})`, created_at: nowIso() });
      audit(ctx, { action: 'CREATE', entity: 'company', entityId: id, newValue: { name: c.company, source: 'EXCEL', row: c.sale_row } });
      companies.set(k, id); res.created.companies++;
      return id;
    };
    const services = new Map(db.all('SELECT id, name FROM service_types').map((x) => [keyOf(x.name), x.id]));
    const serviceId = (c) => {
      if (services.has(c.service_key)) return services.get(c.service_key);
      const code = uniq('service_types', 'code', codeOf(c.service));
      let prefix = translit(c.service).toUpperCase().replace(/[^A-Z]/g, '') || 'X';
      for (let i = 2; db.get('SELECT 1 x FROM service_types WHERE prefix=?', prefix); i++) prefix = prefix.replace(/[A-Z]$/, '') + String.fromCharCode(64 + i);
      const sort = (db.get('SELECT COALESCE(MAX(sort),0) m FROM service_types').m || 0) + 1;
      const id = db.insert('service_types', { code, name: c.service, prefix, recognition_rule: JSON.stringify(RECOGNITION_RULE), payment_rule: '{}', kpi_rule: '{}', expense_rule: '{}', collection_rule: '{}', color: null, sort });
      audit(ctx, { action: 'CREATE', entity: 'service_type', entityId: id, newValue: { name: c.service, code, prefix, source: 'EXCEL' } });
      services.set(c.service_key, id); res.created.service_types++;
      res.reference.service_types.push({ name: c.service, code, prefix, recognition_rule: RECOGNITION_RULE.method });
      return id;
    };
    const cats = new Map(db.all('SELECT id, name, cf_class FROM expense_categories').map((x) => [keyOf(x.name), x]));
    const category = (e) => {
      if (!e.category_key) return null;
      if (cats.has(e.category_key)) return cats.get(e.category_key);
      const m = CATEGORY_MAP[e.category_key];
      const code = uniq('expense_categories', 'code', codeOf(e.category_name));
      const sort = (db.get('SELECT COALESCE(MAX(sort),0) m FROM expense_categories').m || 0) + 1;
      const id = db.insert('expense_categories', { code, name: e.category_name, parent_id: null, pnl_group: m.pnl_group, cf_class: 'OPERATING', is_direct_cost: m.is_direct_cost ? 1 : 0, keywords: '[]', sort });
      audit(ctx, { action: 'CREATE', entity: 'expense_category', entityId: id, newValue: { name: e.category_name, code, pnl_group: m.pnl_group, source: 'EXCEL' } });
      const row = { id, name: e.category_name, cf_class: 'OPERATING' };
      cats.set(e.category_key, row); res.created.categories++;
      res.reference.categories.push({ name: e.category_name, code, pnl_group: m.pnl_group, is_direct_cost: m.is_direct_cost ? 1 : 0 });
      return row;
    };

    const bankTx = (x, direction, key, purpose, cf) => {
      if (bankByExt(bank.id, key)) { res.existing.bank_transactions++; return null; }
      const r = S.banking.createTransaction({ bank_account_id: bank.id, external_id: key, tx_date: x.date, amount: x.amount, currency: base, direction, counterparty_name: x.counterparty || null, purpose, cf_class: cf || 'OPERATING' }, ctx, { skipMatch: true, source: 'IMPORT' });
      if (r.duplicate) { res.existing.bank_transactions++; return null; }
      res.created.bank_transactions++;
      return r.id;
    };
    const cashTx = (b, key) => {
      if (cashByMarker(key)) { res.existing.cash_transactions++; return null; }
      const t = S.banking.createCashTransaction({ cash_account_id: cash.id, currency: base, ...b }, ctx);
      res.created.cash_transactions++;
      return t.id;
    };

    // ---------- 2) Shartnomalar + tushumlar ----------
    for (const c of plan.contracts) {
      let id = db.get('SELECT id FROM contracts WHERE instr(comments, ?) > 0', `[${c.key} `)?.id || db.get('SELECT id FROM contracts WHERE contract_number=?', String(c.no))?.id;
      if (id) res.existing.contracts++;
      else {
        id = db.insert('contracts', {
          contract_number: String(c.no), company_id: companyId(c), service_type_id: serviceId(c), title: null, amount: round2(c.amount), currency: base,
          contract_date: c.contract_date || null, start_date: null, end_date: null,
          advance_pct: null, advance_amount: null, expected_final_payment: null, advance_due_date: null, payment_due_date: null,
          manager_user_id: null, contract_status: 'ACTIVE', service_status: null, payment_status: 'EXPECTED',
          comments: `Excel: Dogovor No ${c.no} ${c.trace}`, created_by: null, created_at: nowIso(),
        });
        audit(ctx, { action: 'CREATE', entity: 'contract', entityId: id, newValue: { contract_number: String(c.no), amount: c.amount, company: c.company, service: c.service, source: 'EXCEL', rows: c.rows } });
        res.created.contracts++;
      }
      for (const p of c.payments) {
        if (p.side === 'BANK') {
          const txId = bankTx(p, 'INCOME', p.key, `${p.purpose} ${p.trace}`, 'OPERATING');
          if (txId) { S.reconciliation.confirm(txId, id, ctx, { reason: `Excel Dogovor No ${c.no}` }); res.created.payments++; }
          else res.existing.payments++;
        } else {
          const t = cashTx({ tx_date: p.date, amount: p.amount, direction: 'INCOME', counterparty_name: p.counterparty || null, purpose: `${p.purpose} ${p.trace}`, contract_id: id, cf_class: 'OPERATING' }, p.key);
          if (t) res.created.payments++; else res.existing.payments++;
        }
      }
      S.contracts.recompute(id, ctx);
    }

    // ---------- 3) Shartnomasiz kirimlar ----------
    for (const x of plan.incomes) {
      const purpose = `${x.purpose} ${x.trace}`;
      if (x.side === 'BANK') { const txId = bankTx(x, 'INCOME', x.key, purpose, x.cf_class); if (txId) S.reconciliation.ignore(txId, ctx, 'NON_CONTRACT', x.cf_class); }
      else cashTx({ tx_date: x.date, amount: x.amount, direction: 'INCOME', counterparty_name: x.counterparty || null, purpose, cf_class: x.cf_class }, x.key);
    }

    // ---------- 4) Xarajatlar (PAID, kategoriya faqat Excel hisob nomidan) ----------
    for (const e of plan.expenses) {
      if (db.get('SELECT id FROM expenses WHERE code=?', e.key)) { res.existing.expenses++; continue; }
      const cat = category(e);
      const expId = db.insert('expenses', {
        code: e.key, expense_date: e.date, department_id: null, category_id: cat?.id ?? null, subcategory: null, project: null, contract_id: null, service_type_id: null,
        requested_by: null, counterparty: e.counterparty || null, amount: round2(e.amount), currency: base, purpose: e.purpose, required_date: null,
        payment_method: e.side === 'BANK' ? 'BANK' : 'CASH', status: 'APPROVED', approver_id: null, approved_at: null, paid_at: null,
        category_confidence: cat ? 1 : null, category_source: cat ? 'EXCEL' : null, is_recurring: 0, created_by: null, created_at: nowIso(),
      });
      audit(ctx, { action: 'EXPENSE_CREATED', entity: 'expense', entityId: expId, newValue: { code: e.key, amount: e.amount, category: cat?.name ?? null, source: 'EXCEL', rows: e.rows } });
      res.created.expenses++;
      const purpose = `${e.purpose} ${e.trace}`;
      if (e.side === 'BANK') {
        const txId = bankTx(e, 'EXPENSE', e.key, purpose, cat?.cf_class);
        if (!txId) throw new Error(`Bank tranzaksiyasi ${e.key} bor, lekin xarajati yo‘q — bazani qo‘lda tekshiring`);
        S.reconciliation.confirmExpense(txId, expId, ctx, {});
      } else {
        const t = cashTx({ tx_date: e.date, amount: e.amount, direction: 'EXPENSE', counterparty_name: e.counterparty || null, purpose, expense_id: expId, cf_class: cat?.cf_class || 'OPERATING' }, e.key);
        if (!t) throw new Error(`Kassa yozuvi ${e.key} bor, lekin xarajati yo‘q — bazani qo‘lda tekshiring`);
      }
    }

    // ---------- 5) Xarajat bo'lmagan chiqimlar: dividend (FINANCING), qarz, qaytarish ----------
    for (const x of plan.nonExpenses) {
      const purpose = `${x.purpose} ${x.trace}`;
      if (x.side === 'BANK') { const txId = bankTx(x, 'EXPENSE', x.key, purpose, x.cf_class); if (txId) S.reconciliation.ignore(txId, ctx, x.ignore_reason, x.cf_class); }
      else cashTx({ tx_date: x.date, amount: x.amount, direction: 'EXPENSE', counterparty_name: x.counterparty || null, purpose, cf_class: x.cf_class }, x.key);
    }

    // ---------- 6) Ichki o'tkazmalar (bank ↔ kassa): daromad/xarajat emas ----------
    for (const t of plan.transfers) {
      const purpose = `${t.purpose} ${t.trace}`;
      for (const [side, direction] of [[t.from, 'EXPENSE'], [t.to, 'INCOME']]) {
        if (side === 'BANK') { const txId = bankTx(t, direction, t.key, purpose, 'TRANSFER'); if (txId) S.reconciliation.ignore(txId, ctx, 'TRANSFER', 'TRANSFER'); }
        else cashTx({ tx_date: t.date, amount: t.amount, direction, counterparty_name: t.counterparty || null, purpose, cf_class: 'TRANSFER' }, t.key);
      }
    }
    audit(ctx, { action: 'IMPORT', entity: 'excel_journal', newValue: { file: plan.meta.file, sha256: plan.meta.sha256, key_prefix: plan.meta.key_prefix, created: res.created } });
  });
  return res;
}

/** Excel (reja) yig'indilari ↔ bazadagi yig'indilar, NULL qoldirilgan maydonlar, davr hisobotlari */
export function verifyImport(app, plan) {
  const { db } = app;
  const S = app.services;
  const px = plan.meta.key_prefix;
  const like = `${px}-%`, mark = `[${px}-`;
  const n2 = (x) => ({ n: x?.n || 0, amount: round2(x?.s || 0) });
  const q = (sql, ...p) => n2(db.get(sql, ...p));
  const contractIds = db.all('SELECT id FROM contracts WHERE instr(comments, ?) > 0', mark).map((x) => x.id);
  const idsSql = contractIds.length ? contractIds.join(',') : '0';
  const cs = contractIds.map((id) => S.contracts.get(id));
  const db_ = {
    contracts: { n: cs.length, amount: round2(cs.reduce((a, c) => a + c.amount, 0)), paid: round2(cs.reduce((a, c) => a + c.paid, 0)), remaining: round2(cs.reduce((a, c) => a + c.remaining, 0)), debtors: cs.filter((c) => c.remaining > 0.005).length },
    bank_income: q("SELECT COUNT(*) n, SUM(amount) s FROM bank_transactions WHERE reversed_at IS NULL AND direction='INCOME' AND COALESCE(ignore_reason,'')<>'TRANSFER' AND external_id LIKE ?", like),
    cash_income: q("SELECT COUNT(*) n, SUM(amount) s FROM cash_transactions WHERE reversed_at IS NULL AND direction='INCOME' AND cf_class<>'TRANSFER' AND instr(purpose, ?) > 0", mark),
    bank_expense: q("SELECT COUNT(*) n, SUM(amount) s FROM bank_transactions WHERE reversed_at IS NULL AND direction='EXPENSE' AND COALESCE(ignore_reason,'')<>'TRANSFER' AND external_id LIKE ?", like),
    cash_expense: q("SELECT COUNT(*) n, SUM(amount) s FROM cash_transactions WHERE reversed_at IS NULL AND direction='EXPENSE' AND cf_class<>'TRANSFER' AND instr(purpose, ?) > 0", mark),
    // transfer: har o'tkazma bank tomonida bitta yozuv (ignore_reason TRANSFER) + kassa tomonida bitta (cf_class TRANSFER)
    transfers: q("SELECT COUNT(*) n, SUM(amount) s FROM cash_transactions WHERE reversed_at IS NULL AND cf_class='TRANSFER' AND instr(purpose, ?) > 0", mark),
    expenses: { ...q("SELECT COUNT(*) n, SUM(amount) s FROM expenses WHERE reversed_at IS NULL AND status='PAID' AND code LIKE ?", like), uncategorized: q("SELECT COUNT(*) n, SUM(amount) s FROM expenses WHERE reversed_at IS NULL AND status='PAID' AND category_id IS NULL AND code LIKE ?", like) },
    by_kind: Object.fromEntries(['DIVIDEND', 'LOAN', 'REFUND'].map((k) => {
      const b = db.get("SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM bank_transactions WHERE reversed_at IS NULL AND ignore_reason=? AND external_id LIKE ?", k, like);
      const cf = k === 'DIVIDEND' ? 'FINANCING' : 'UNCLASSIFIED';
      const keys = plan.nonExpenses.filter((x) => x.kind === k && x.side === 'CASH').map((x) => `[${x.key} `);
      const c = keys.reduce((a, key) => { const r = db.get('SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM cash_transactions WHERE reversed_at IS NULL AND cf_class=? AND instr(purpose, ?) > 0', cf, key); return { n: a.n + r.n, s: a.s + r.s }; }, { n: 0, s: 0 });
      return [k, { n: b.n + c.n, amount: round2(b.s + c.s) }];
    })),
    by_category: db.all("SELECT ec.name AS name, COUNT(*) n, SUM(e.amount) s FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id WHERE e.reversed_at IS NULL AND e.status='PAID' AND e.code LIKE ? GROUP BY e.category_id ORDER BY s DESC", like).map((x) => ({ name: x.name || 'Kategoriyasiz', n: x.n, amount: round2(x.s) })),
  };
  const nulls = {
    'contracts.contract_date': db.get(`SELECT COUNT(*) n FROM contracts WHERE id IN (${idsSql}) AND contract_date IS NULL`).n,
    'contracts.start_date / end_date': db.get(`SELECT COUNT(*) n FROM contracts WHERE id IN (${idsSql}) AND start_date IS NULL AND end_date IS NULL`).n,
    'contracts.payment_due_date / advance_due_date': db.get(`SELECT COUNT(*) n FROM contracts WHERE id IN (${idsSql}) AND payment_due_date IS NULL AND advance_due_date IS NULL`).n,
    'contracts.advance_pct / advance_amount / expected_final_payment': db.get(`SELECT COUNT(*) n FROM contracts WHERE id IN (${idsSql}) AND advance_pct IS NULL AND advance_amount IS NULL AND expected_final_payment IS NULL`).n,
    'contracts.service_status': db.get(`SELECT COUNT(*) n FROM contracts WHERE id IN (${idsSql}) AND service_status IS NULL`).n,
    'contracts.title': db.get(`SELECT COUNT(*) n FROM contracts WHERE id IN (${idsSql}) AND title IS NULL`).n,
    'contracts.manager_user_id': db.get(`SELECT COUNT(*) n FROM contracts WHERE id IN (${idsSql}) AND manager_user_id IS NULL`).n,
    'companies.inn / phone / email / manager': db.get(`SELECT COUNT(*) n FROM companies WHERE id IN (SELECT company_id FROM contracts WHERE id IN (${idsSql})) AND inn IS NULL AND phone IS NULL AND email IS NULL AND manager_user_id IS NULL`).n,
    'payment_schedules (yaratilmadi)': db.get(`SELECT COUNT(*) n FROM payment_schedules WHERE contract_id IN (${idsSql})`).n,
    'revenue_recognition (yaratilmadi)': db.get(`SELECT COUNT(*) n FROM revenue_recognition WHERE contract_id IN (${idsSql})`).n,
    'expenses.category_id (kategoriyasiz)': db.get("SELECT COUNT(*) n FROM expenses WHERE code LIKE ? AND category_id IS NULL", like).n,
    'expenses.requested_by / approver_id / approved_at': db.get("SELECT COUNT(*) n FROM expenses WHERE code LIKE ? AND requested_by IS NULL AND approver_id IS NULL AND approved_at IS NULL", like).n,
    'bank_accounts.opening_balance / account_number': db.get('SELECT COUNT(*) n FROM bank_accounts WHERE bank_name=? AND opening_balance IS NULL AND account_number IS NULL', BANK_NAME).n,
    'cash_accounts.opening_balance': db.get('SELECT COUNT(*) n FROM cash_accounts WHERE name=? AND opening_balance IS NULL', CASH_NAME).n,
  };
  const ex = plan.excelTotals;
  const checks = [];
  const cmp = (label, a, b) => checks.push({ label, excel: a, db: b, ok: JSON.stringify(a) === JSON.stringify(b) });
  cmp('Shartnomalar (soni, summa)', [ex.contracts.n, ex.contracts.amount], [db_.contracts.n, db_.contracts.amount]);
  cmp('Shartnoma to‘lovlari', ex.contracts.paid, db_.contracts.paid);
  cmp('Shartnoma qoldig‘i (debitorlik)', [ex.contracts.debtors, ex.contracts.remaining], [db_.contracts.debtors, db_.contracts.remaining]);
  for (const k of ['bank_income', 'cash_income', 'bank_expense', 'cash_expense']) cmp({ bank_income: 'Bank kirimi', cash_income: 'Kassa kirimi', bank_expense: 'Bank chiqimi', cash_expense: 'Kassa chiqimi' }[k], [ex[k].n, ex[k].amount], [db_[k].n, db_[k].amount]);
  cmp('Transfer bank → kassa', [ex.transfers.n, ex.transfers.amount], [db_.transfers.n, db_.transfers.amount]);
  cmp('Xarajatlar (PAID)', [ex.expenses.n, ex.expenses.amount], [db_.expenses.n, db_.expenses.amount]);
  cmp('  shundan kategoriyasiz', [ex.expenses.uncategorized.n, ex.expenses.uncategorized.amount], [db_.expenses.uncategorized.n, db_.expenses.uncategorized.amount]);
  for (const k of ['DIVIDEND', 'LOAN', 'REFUND']) cmp({ DIVIDEND: 'Dividend (FINANCING)', LOAN: 'фин.займ (xarajat emas)', REFUND: 'возврат (xarajat emas)' }[k], [ex.by_kind[k].n, ex.by_kind[k].amount], [db_.by_kind[k].n, db_.by_kind[k].amount]);
  const dbCat = new Map(db_.by_category.map((x) => [keyOf(x.name), x]));
  for (const c of ex.by_category) { const d = dbCat.get(keyOf(c.name)); cmp(`  kategoriya: ${c.name}`, [c.n, c.amount], [d?.n || 0, d?.amount || 0]); }
  // Davr hisobotlari (bir oylik fayl bo'lsa)
  let period = null;
  if (/^\d{4}-\d{2}$/.test(plan.meta.period || '')) {
    const pnl = S.reports.pnl({ month: plan.meta.period });
    const cf = S.reports.cashFlow({ month: plan.meta.period });
    const tr = S.reports.treasury(pnl.period.to);
    period = { month: plan.meta.period, pnl: pnl.totals, pnl_lines: pnl.lines.filter((l) => l.amount), cash_flow: { opening: cf.opening_cash, operating: cf.operating, investing: cf.investing, financing: cf.financing, transfers: cf.transfers, unclassified: cf.unclassified, closing: cf.closing_cash }, flows: S.banking.flows(pnl.period.from, pnl.period.to), treasury: { bank_balance: tr.bank_balance, cash_balance: tr.cash_balance, total_cash: tr.total_cash, available_cash: tr.available_cash, low_liquidity: tr.low_liquidity, customer_advances: tr.customer_advances }, receivables: S.receivables.aging(pnl.period.to) };
  }
  const users = db.get('SELECT COUNT(*) n FROM users').n;
  return { excel: ex, db: db_, checks, ok: checks.every((c) => c.ok), nulls, period, users };
}

const fmtN = (n) => (n === null || n === undefined ? '--' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replace(/[  ]/g, ' '));
const cell = (v) => (Array.isArray(v) ? v.map((x, i) => (i === 0 && v.length > 1 ? `${x} ta` : fmtN(x))).join(' / ') : fmtN(v));

/** Hisobot matni (CLI) */
export function formatReport(plan, result, verify, { dryRun = false } = {}) {
  const L = [];
  const h = (t) => L.push('', `== ${t} ==`);
  L.push(`UTAX Excel import — ${dryRun ? 'SINOV (--dry-run, bazaga yozilmadi)' : 'natija'}`);
  L.push(`Fayl: ${plan.meta.file || '--'} · varaq "${plan.meta.sheet}" · ${plan.meta.excel_rows} qator · sha256 ${plan.meta.sha256.slice(0, 12)}…`);
  L.push(`Davr: ${plan.meta.period || '--'} · idempotentlik kaliti: ${plan.meta.key_prefix || '--'}-<Dogovor No>`);
  if (plan.errors.length) { h(`XATOLAR (${plan.errors.length}) — import qilinmadi`); for (const e of plan.errors) L.push(`  qator ${e.rows.join('/') || '--'}${e.no ? ` (No ${e.no})` : ''}: ${e.message}`); }
  const ex = plan.excelTotals;
  h('Reja (Excel)');
  L.push(`  Shartnomalar: ${ex.contracts.n} ta, ${fmtN(ex.contracts.amount)} · to‘langan ${fmtN(ex.contracts.paid)} · qoldiq ${fmtN(ex.contracts.remaining)} (${ex.contracts.debtors} ta qarzdor)`);
  L.push(`  Bank kirimi: ${ex.bank_income.n} ta, ${fmtN(ex.bank_income.amount)} · Kassa kirimi: ${ex.cash_income.n} ta, ${fmtN(ex.cash_income.amount)}`);
  L.push(`  Bank chiqimi: ${ex.bank_expense.n} ta, ${fmtN(ex.bank_expense.amount)} · Kassa chiqimi: ${ex.cash_expense.n} ta, ${fmtN(ex.cash_expense.amount)}`);
  L.push(`  Xarajatlar: ${ex.expenses.n} ta, ${fmtN(ex.expenses.amount)} (kategoriyasiz ${ex.expenses.uncategorized.n} ta, ${fmtN(ex.expenses.uncategorized.amount)})`);
  L.push(`  Dividend: ${ex.by_kind.DIVIDEND.n} ta, ${fmtN(ex.by_kind.DIVIDEND.amount)} · фин.займ: ${ex.by_kind.LOAN.n} ta, ${fmtN(ex.by_kind.LOAN.amount)} · возврат: ${ex.by_kind.REFUND.n} ta, ${fmtN(ex.by_kind.REFUND.amount)} · Transfer: ${ex.transfers.n} ta, ${fmtN(ex.transfers.amount)}`);
  if (result) {
    h('Bazaga yozildi (yangi / avvaldan bor)');
    for (const [k, v] of Object.entries(result.created)) L.push(`  ${k}: ${v} / ${result.existing[k]}`);
  }
  if (verify) {
    h(`Excel ↔ baza solishtirish: ${verify.ok ? 'HAMMASI MOS' : 'FARQ BOR'}`);
    for (const c of verify.checks) L.push(`  ${c.ok ? 'OK ' : 'XX '} ${c.label}: Excel ${cell(c.excel)} | baza ${cell(c.db)}`);
    h('Qoida: "hech narsa to‘qilmasin" — NULL qoldirilgan maydonlar (ko‘rsatishda "--")');
    for (const [k, v] of Object.entries(verify.nulls)) L.push(`  ${k}: ${v}`);
    L.push(`  Daromad: Excel sotuv provodkalari jami ${fmtN(ex.contracts.amount)} — sana yo‘qligi sabab P&L’da tan olinmadi (tushumlar ${fmtN(ex.contracts.paid)} — mijoz avansi)`);
    L.push(`  Foydalanuvchilar bazada: ${verify.users} (import foydalanuvchi yaratmaydi; menejer/so‘rovchi hech kimga yozilmadi)`);
    if (verify.period) {
      const p = verify.period;
      h(`Davr hisobotlari (${p.month})`);
      L.push(`  P&L: daromad ${fmtN(p.pnl.revenue)} · to‘g‘ridan-to‘g‘ri ${fmtN(p.pnl.direct)} · opex ${fmtN(p.pnl.opex)} · soliqlar ${fmtN(p.pnl.taxes)} · sof ${fmtN(p.pnl.net)}`);
      for (const l of p.pnl_lines) if (!['REVENUE', 'GROSS', 'OPERATING', 'NET'].includes(l.key)) L.push(`     ${l.label}: ${fmtN(l.amount)}`);
      L.push(`  Pul harakati (bank+kassa): kirim ${fmtN(p.flows.income)} · chiqim ${fmtN(p.flows.expense)} · sof ${fmtN(p.flows.net)}`);
      const c = p.cash_flow;
      L.push(`  Cash flow: operatsion ${fmtN(c.operating.net)} · investitsion ${fmtN(c.investing.net)} · moliyaviy ${fmtN(c.financing.net)} · transfer ${fmtN(c.transfers?.net)} · tasniflanmagan ${fmtN(c.unclassified?.net)}`);
      L.push(`  Qoldiqlar: boshi ${fmtN(c.opening)} · oxiri ${fmtN(c.closing)} (boshlang‘ich qoldiq Excel’da yo‘q → "--")`);
      L.push(`  Treasury: bank ${fmtN(p.treasury.bank_balance)} · kassa ${fmtN(p.treasury.cash_balance)} · ishlatish mumkin ${fmtN(p.treasury.available_cash)} · likvidlik signali ${p.treasury.low_liquidity === null ? '-- (qoldiq noma’lum)' : p.treasury.low_liquidity} · mijoz avanslari ${fmtN(p.treasury.customer_advances)}`);
      L.push(`  Debitorlik (aging): ${p.receivables.buckets.filter((b) => b.amount).map((b) => `${b.label} ${fmtN(b.amount)} (${b.count} ta)`).join(' · ') || '--'} · muddati o‘tgan ${fmtN(p.receivables.overdue)}`);
    }
  }
  h('O‘tkazib yuborilgan qatorlar');
  for (const s of plan.skipped) L.push(`  qator ${s.rows}: ${s.reason}${s.count ? ` (${s.count} ta)` : ''}`);
  for (const q of plan.quarantine) L.push(`  qator ${q.rows.join('/')} (No ${q.no} "${q.account}", ${fmtN(q.amount)}): KARANTIN — ${q.reason}`);
  if (plan.warnings.length) { h(`Ogohlantirishlar (${plan.warnings.length})`); for (const w of plan.warnings) L.push(`  qator ${w.rows.join('/')} (No ${w.no}): ${w.message}`); }
  h('Konfiguratsiya (Excel ma’lumoti emas — tizim ma’lumotnomasi)');
  if (result) {
    for (const s of result.reference.service_types) L.push(`  xizmat turi "${s.name}": code ${s.code}, prefiks ${s.prefix} (transliteratsiya), tan olish ${s.recognition_rule} + akt`);
    for (const c of result.reference.categories) L.push(`  kategoriya "${c.name}": code ${c.code}, P&L guruhi ${c.pnl_group}${c.is_direct_cost ? ' (to‘g‘ridan-to‘g‘ri)' : ''}`);
    if (result.reference.bank_account) L.push(`  bank hisobi "${BANK_NAME}" (hisob raqami --, boshlang‘ich qoldiq --) · kassa "${CASH_NAME}" (boshlang‘ich qoldiq --)`);
  }
  L.push('  Excel’dan emas — foydalanuvchi tasdiqlashi kerak (DEFAULT_SETTINGS, sozlamalardan o‘zgartiriladi):');
  for (const k of ['cash.safety_reserve', 'cash.low_liquidity_threshold', 'revenue.approval_threshold', 'fx.rates', 'expense.large_expense_alert', 'payroll.pay_day']) L.push(`    ${k} = ${JSON.stringify(app_setting(k))}`);
  if (plan.questions.length) { h(`Ochiq savollar (${plan.questions.length})`); for (const q of [...new Set(plan.questions)]) L.push(`  - ${q}`); for (const q of plan.quarantine) L.push(`  - No ${q.no} "${q.account}" ${fmtN(q.amount)}: haqiqiy sana qaysi? (Excel’da ${q.date})`); L.push('  - Bank va kassa boshlang‘ich qoldiqlari (davr boshiga) qancha? Kiritilmaguncha qoldiqlar "--".'); }
  return L.join('\n');
}
const app_setting = (k) => DEFAULT_SETTINGS[k];
