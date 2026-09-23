/**
 * ERP xom oynasi (`erp_raw`) → tizim jadvallariga moslashtirish.
 * Faqat ERP'da HAQIQATAN bor qiymatlar ko'chiriladi; yo'q maydon NULL qoladi (1-QOIDA).
 *
 * Moslashtiriladi:
 *   department            → departments
 *   user + profile        → employees (ism profile'dan, lavozim orderToWork→workerPosition'dan)
 *   expenseType           → expense_categories
 *   kpi                   → employee_kpis (ERP fakt qiymatlari; formula qoidasi yo'q → kpi_rule_id NULL)
 *   serviceProvider       → bank_accounts.bank_name (financeAccount.serviceProviderId orqali)
 *
 * Moslashtirilmaydi (tizimda mos jadval yo'q): task, project, notification, callEvent, chat,
 * tax*, filial, bankName (hisob bilan bog'lanish maydoni ERP'da yo'q), incomeIndicator.
 *
 * Idempotentlik: `erp_map(model, erp_id) → (table_name, row_id)`.
 */
const nowIso = () => new Date().toISOString();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h' };
const slug = (s) => [...String(s || '').toLowerCase()].map((c) => TR[c] ?? c).join('').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase().slice(0, 30) || 'ERP';
/** Excel/ERP "Ойлик" kabi nomni P&L guruhiga tasniflash (yangi fakt qo'shilmaydi — faqat tasnif) */
function pnlGroupOf(title) {
  const t = String(title || '').toLowerCase();
  if (/ойлик|oylik|з\/п|зарплат|maosh/.test(t)) return 'PAYROLL';
  if (/аренда|ijara|rent/.test(t)) return 'OFFICE';
  if (/налог|soliq|ндс|tax/.test(t)) return 'TAX';
  if (/маркетинг|reklama|marketing/.test(t)) return 'MARKETING';
  if (/интернет|internet|hosting|it/.test(t)) return 'IT';
  return 'OTHER_OPEX';
}

export function erpMapAll(app, { log = () => {} } = {}) {
  const { db } = app;
  db.exec('CREATE TABLE IF NOT EXISTS erp_map (model TEXT NOT NULL, erp_id TEXT NOT NULL, table_name TEXT NOT NULL, row_id INTEGER NOT NULL, mapped_at TEXT NOT NULL, PRIMARY KEY (model, erp_id))');
  const raw = (model) => db.all('SELECT erp_id, data FROM erp_raw WHERE model=?', model).map((r) => { try { return { _id: r.erp_id, ...JSON.parse(r.data) }; } catch { return null; } }).filter(Boolean);
  const linked = (model, erpId) => db.get('SELECT row_id FROM erp_map WHERE model=? AND erp_id=?', model, erpId)?.row_id || null;
  const link = (model, erpId, table, rowId) => db.run('INSERT INTO erp_map (model, erp_id, table_name, row_id, mapped_at) VALUES (?,?,?,?,?) ON CONFLICT(model, erp_id) DO UPDATE SET table_name=excluded.table_name, row_id=excluded.row_id, mapped_at=excluded.mapped_at', model, erpId, table, rowId, nowIso());
  const uniqCode = (table, want) => { let v = want, i = 2; while (db.get(`SELECT 1 x FROM ${table} WHERE code=?`, v)) v = `${want}_${i++}`.slice(0, 32); return v; };
  const res = { departments: 0, employees: 0, categories: 0, kpis: 0, accounts_named: 0, skipped: {} };

  db.tx(() => {
    // 1) Bo'limlar
    for (const d of raw('department')) {
      let id = linked('department', d._id);
      if (id) { db.run('UPDATE departments SET name=? WHERE id=?', String(d.name || '').slice(0, 120), id); continue; }
      id = db.insert('departments', { code: uniqCode('departments', slug(d.name)), name: String(d.name || 'Bo‘lim').slice(0, 120) });
      link('department', d._id, 'departments', id); res.departments++;
    }

    // 2) Xodimlar: user (akkaunt) + profile (ism) + orderToWork→workerPosition (lavozim)
    const profByUser = new Map(); for (const p of raw('profile')) if (p.userId) profByUser.set(p.userId, p);
    const posById = new Map(); for (const w of raw('workerPosition')) posById.set(w._id, w.name);
    const posByUser = new Map();
    for (const o of raw('orderToWork')) { if (o.userId && o.positionId && posById.has(o.positionId)) posByUser.set(o.userId, posById.get(o.positionId)); }
    for (const u of raw('user')) {
      const p = profByUser.get(u._id);
      const name = p ? [p.lastName, p.firstName, p.fatherName].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() : String(u.username || '').trim();
      if (!name) continue;
      const row = { name: name.slice(0, 120), position: posByUser.get(u._id) || null, is_active: p ? (String(p.isBlocked) === 'true' ? 0 : 1) : 1 };
      // fixed_salary / department_id / hired_at — ERP'da yo'q → NULL (to'qilmaydi)
      let id = linked('user', u._id);
      if (id) { db.update('employees', id, row); continue; }
      id = db.insert('employees', { ...row, user_id: null, department_id: null, fixed_salary: null, hired_at: null });
      link('user', u._id, 'employees', id); res.employees++;
    }

    // 3) Xarajat kategoriyalari (expenseType)
    for (const e of raw('expenseType')) {
      const title = String(e.title || '').trim(); if (!title) continue;
      let id = linked('expenseType', e._id);
      if (id) { db.run('UPDATE expense_categories SET name=? WHERE id=?', title.slice(0, 120), id); continue; }
      id = db.insert('expense_categories', { code: uniqCode('expense_categories', slug(title)), name: title.slice(0, 120), pnl_group: pnlGroupOf(title), cf_class: 'OPERATING', is_direct_cost: 0, keywords: '[]', sort: 50 });
      link('expenseType', e._id, 'expense_categories', id); res.categories++;
    }

    // 4) KPI faktlari (ERP kpi) → employee_kpis. Formula qoidasi ERP'da yo'q → kpi_rule_id NULL.
    const FACT = ['monthly', 'auditor_license_holder', 'for_assistant', 'for_assistant_per_checking', 'additional_work', 'tourism_subscriber', 'tourism_audit', 'subscriber_in_city', 'subscriber_out_city', 'for_finish', 'for_close_invoice', 'for_finish_in_month', 'bonus_for_client'];
    for (const k of raw('kpi')) {
      const empId = k.employeeId ? linked('user', k.employeeId) : null;
      if (!empId) { res.skipped.kpi_no_employee = (res.skipped.kpi_no_employee || 0) + 1; continue; }
      const period = String(k.createdAt || '').slice(0, 7) || null;
      if (!period) continue;
      const fact = FACT.reduce((s, f) => s + num(k[f]), 0);
      const plan = FACT.reduce((s, f) => s + num(k[`${f}_plan`]), 0);
      if (!fact && !plan) { res.skipped.kpi_zero = (res.skipped.kpi_zero || 0) + 1; continue; }
      const detail = FACT.filter((f) => num(k[f]) || num(k[`${f}_plan`])).map((f) => `${f}=${num(k[f])}/${num(k[`${f}_plan`])}`).join(' ');
      let id = linked('kpi', k._id);
      const row = { employee_id: empId, period, kpi_rule_id: null, metric_value: plan, kpi_amount: fact, note: `UTAXERP ${detail}`.slice(0, 400) };
      if (id) { db.update('employee_kpis', id, row); continue; }
      id = db.insert('employee_kpis', row);
      link('kpi', k._id, 'employee_kpis', id); res.kpis++;
    }

    // 5) Bank hisobi nomini provayder bo'yicha aniqlashtirish (financeAccount.serviceProviderId → serviceProvider.name)
    const provById = new Map(); for (const s of raw('serviceProvider')) provById.set(s._id, s.name);
    for (const fa of raw('financeAccount')) {
      const prov = fa.serviceProviderId && provById.get(fa.serviceProviderId);
      if (!prov) continue;
      const acc = db.get("SELECT id, bank_name FROM bank_accounts WHERE account_number LIKE ?", `%[erp:acc:${fa._id}]%`);
      if (acc && acc.bank_name !== prov) { db.run('UPDATE bank_accounts SET bank_name=? WHERE id=?', String(prov).slice(0, 120), acc.id); res.accounts_named++; }
    }
  });

  log(`  bo‘lim ${res.departments} · xodim ${res.employees} · kategoriya ${res.categories} · KPI ${res.kpis} · hisob nomi ${res.accounts_named}`);
  return res;
}
