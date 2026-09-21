/**
 * PILOT DATA — Iyul 2026 (+ iyun tarix, avgust, sentabr). Voqealar xronologik qo'llanadi,
 * shuning uchun barcha raqamlar (avans, tan olish, debitorlik) biznes qoidalari orqali hisoblanadi — qo'lda yozilmaydi.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../core/auth.mjs';
import { nowIso, today, round2 } from '../core/util.mjs';

const PASSWORD = 'Utax2026!';

export async function seed(app, { log = console.log } = {}) {
  const { db } = app;
  const S = app.services;
  const ctxOf = (email) => ({ user: db.get('SELECT * FROM users WHERE email=?', email), ip: '127.0.0.1', source: 'SEED' });

  // ---------- 1. Xizmat turlari ----------
  const types = [
    ['REVISION', 'Reviziya', 'R', { method: 'ON_COMPLETION', require_acceptance_document: true }, '#2a78d6'],
    ['AUDIT', 'Audit', 'A', { method: 'ON_COMPLETION', require_acceptance_document: true }, '#1baf7a'],
    ['SPORNIY', 'Nizoli ishlar (sud)', 'S', { method: 'ON_COMPLETION', require_acceptance_document: true }, '#eb6834'],
    ['SUBSCRIPTION', 'Obuna xizmati', 'SB', { method: 'STRAIGHT_LINE', require_acceptance_document: false }, '#4a3aa7'],
    ['OTHER', 'Boshqa xizmatlar', 'O', { method: 'ON_PAYMENT', require_acceptance_document: false }, '#898781'],
  ];
  types.forEach(([code, name, prefix, rule, color], i) => db.run('INSERT OR IGNORE INTO service_types (code,name,prefix,recognition_rule,payment_rule,kpi_rule,expense_rule,collection_rule,color,sort) VALUES (?,?,?,?,?,?,?,?,?,?)', code, name, prefix, JSON.stringify(rule), JSON.stringify({ advance_pct: code === 'OTHER' ? 100 : 50, due_days: 10 }), JSON.stringify({ formula: 'PCT_OF_DEPT_REVENUE' }), JSON.stringify({ direct_categories: ['SUBCONTRACT', 'BUSINESS_TRIP'] }), JSON.stringify({ stages: 'default' }), color, i));
  const st = Object.fromEntries(db.all('SELECT id, code FROM service_types').map((x) => [x.code, x.id]));

  // ---------- 2. Bo'limlar ----------
  const depts = [['REVISION', 'Revision bo‘limi', st.REVISION], ['AUDIT', 'Audit bo‘limi', st.AUDIT], ['LEGAL', 'Yuridik (Sporniy) bo‘limi', st.SPORNIY], ['SALES', 'Sotuv bo‘limi', null], ['MARKETING', 'Marketing', null], ['IT', 'IT bo‘limi', null], ['FINANCE', 'Moliya', null], ['ADMIN', 'Administratsiya', null]];
  for (const [code, name, stid] of depts) db.run('INSERT OR IGNORE INTO departments (code,name,service_type_id) VALUES (?,?,?)', code, name, stid);
  const D = Object.fromEntries(db.all('SELECT id, code FROM departments').map((x) => [x.code, x.id]));

  // ---------- 3. Foydalanuvchilar ----------
  const users = [
    ['founder@utax.uz', 'Mirazim Orifjonov', 'FOUNDER', null], ['ceo@utax.uz', 'Bekzod Karimov', 'CEO', null], ['cfo@utax.uz', 'Nilufar Rashidova', 'CFO', 'FINANCE'],
    ['finance@utax.uz', 'Sardor Alimov', 'FINANCE_MANAGER', 'FINANCE'], ['accountant@utax.uz', 'Gulnora Yusupova', 'ACCOUNTANT', 'FINANCE'],
    ['sales@utax.uz', 'Jasur Tursunov', 'SALES', 'SALES'], ['sales2@utax.uz', 'Madina Ergasheva', 'SALES', 'SALES'],
    ['head.revision@utax.uz', 'Dilnoza Abdullayeva', 'DEPARTMENT_HEAD', 'REVISION'], ['head.audit@utax.uz', 'Otabek Nazarov', 'DEPARTMENT_HEAD', 'AUDIT'], ['head.legal@utax.uz', 'Kamola Saidova', 'DEPARTMENT_HEAD', 'LEGAL'],
    ['head.marketing@utax.uz', 'Aziza Mirzayeva', 'DEPARTMENT_HEAD', 'MARKETING'], ['head.it@utax.uz', 'Farrux Xolmatov', 'DEPARTMENT_HEAD', 'IT'],
    ['employee@utax.uz', 'Sherzod Qodirov', 'EMPLOYEE', 'MARKETING'], ['auditor@utax.uz', 'Tashqi auditor', 'AUDITOR', null], ['admin@utax.uz', 'System Admin', 'ADMIN', 'IT'],
  ];
  const pw = hashPassword(PASSWORD);
  for (const [email, name, role, dept] of users) db.run('INSERT OR IGNORE INTO users (email,password_hash,name,role_code,department_id,created_at) VALUES (?,?,?,?,?,?)', email, pw, name, role, dept ? D[dept] : null, nowIso());
  const U = Object.fromEntries(db.all('SELECT id, email FROM users').map((x) => [x.email, x.id]));
  for (const [dept, email] of [['REVISION', 'head.revision@utax.uz'], ['AUDIT', 'head.audit@utax.uz'], ['LEGAL', 'head.legal@utax.uz'], ['MARKETING', 'head.marketing@utax.uz'], ['IT', 'head.it@utax.uz'], ['FINANCE', 'cfo@utax.uz']]) db.run('UPDATE departments SET head_user_id=? WHERE id=?', U[email], D[dept]);

  // ---------- 4. Xarajat kategoriyalari ----------
  const cats = [
    ['PAYROLL', 'Oylik (xodimlar)', 'PAYROLL', 'OPERATING', 0, ['oylik', 'maosh', 'payroll', 'зарплат']],
    ['MARKETING', 'Marketing', 'MARKETING', 'OPERATING', 0, ['marketing', 'brend', 'pr ']], ['ADVERTISING', 'Reklama', 'MARKETING', 'OPERATING', 0, ['reklama', 'advertising', 'ads', 'smm', 'target', 'kampaniya', 'instagram', 'telegram ads', 'meta']],
    ['IT', 'IT xizmatlari', 'IT', 'OPERATING', 0, ['it ', 'texnik', 'kompyuter xizmat']], ['HOSTING', 'Hosting va server', 'IT', 'OPERATING', 0, ['hosting', 'server', 'domen', 'vps']], ['SOFTWARE', 'Dasturiy ta’minot', 'IT', 'OPERATING', 0, ['software', 'dasturiy', 'litsenziya', 'obuna', 'subscription', 'crm', 'saas']],
    ['OFFICE', 'Ofis xarajatlari', 'OFFICE', 'OPERATING', 0, ['ofis', 'kantselyariya', 'mebel', 'office']], ['RENT', 'Ofis ijarasi', 'OFFICE', 'OPERATING', 0, ['ijara', 'arenda', 'rent']], ['UTILITIES', 'Kommunal va aloqa', 'OFFICE', 'OPERATING', 0, ['kommunal', 'elektr', 'suv', 'internet', 'gaz', 'telefon']],
    ['TRANSPORT', 'Transport', 'ADMIN', 'OPERATING', 0, ['transport', 'taksi', 'yoqilg', 'benzin', 'yandex']], ['TAX', 'Soliqlar', 'TAX', 'OPERATING', 0, ['soliq', 'nalog', 'tax', 'qqs', 'inps']],
    ['LEGAL', 'Yuridik xizmatlar', 'ADMIN', 'OPERATING', 0, ['yurist', 'notarius', 'davlat boji', 'legal', 'yuridik']], ['BANK', 'Bank xizmatlari', 'ADMIN', 'OPERATING', 0, ['bank xizmat', 'komissiya', 'bank']],
    ['EQUIPMENT', 'Jihozlar', 'OTHER', 'INVESTING', 0, ['noutbuk', 'kompyuter', 'monitor', 'jihoz', 'uskuna', 'printer', 'server klaster']], ['BUSINESS_TRIP', 'Xizmat safari', 'ADMIN', 'OPERATING', 0, ['xizmat safari', 'komandirovka', 'mehmonxona', 'chipta', 'safar']],
    ['SUBCONTRACT', 'Tashqi ekspert (to‘g‘ridan-to‘g‘ri)', 'DIRECT', 'OPERATING', 1, ['ekspert', 'subpudrat', 'autsors', 'tashqi', 'ekspertiza']], ['OTHER', 'Boshqa', 'OTHER_OPEX', 'OPERATING', 0, []],
  ];
  cats.forEach(([code, name, grp, cf, direct, kw], i) => db.run('INSERT OR IGNORE INTO expense_categories (code,name,pnl_group,cf_class,is_direct_cost,keywords,sort) VALUES (?,?,?,?,?,?,?)', code, name, grp, cf, direct, JSON.stringify(kw), i));
  const C = Object.fromEntries(db.all('SELECT id, code FROM expense_categories').map((x) => [x.code, x.id]));

  // ---------- 5. Approval qoidalari (admin o'zgartiradi) ----------
  if (!db.get('SELECT id FROM approval_rules LIMIT 1')) {
    const rules = [
      ['EXPENSE', 0, 5e6, ['DEPARTMENT_HEAD'], '< 5M'], ['EXPENSE', 5e6, 20e6, ['DEPARTMENT_HEAD', 'FINANCE_MANAGER'], '5–20M'], ['EXPENSE', 20e6, 100e6, ['DEPARTMENT_HEAD', 'CFO'], '20–100M'], ['EXPENSE', 100e6, null, ['CFO', 'CEO'], '100M+'],
      ['REVENUE_RECOGNITION', 0, null, ['CFO'], 'Daromad tan olish'], ['PAYROLL', 0, null, ['DEPARTMENT_HEAD', 'CEO', 'CFO', 'ACCOUNTANT'], 'Oylik'], ['CONTRACT_CHANGE', 0, null, ['CFO'], 'Shartnoma o‘zgarishi'], ['AI_ACTION', 0, null, ['CFO'], 'AI harakati'],
    ];
    rules.forEach(([et, min, max, steps, name], i) => db.run('INSERT INTO approval_rules (entity_type,min_amount,max_amount,steps,name,sort) VALUES (?,?,?,?,?,?)', et, min, max, JSON.stringify(steps), name, i));
  }
  // ---------- 6. KPI qoidalari ----------
  for (const [code, name, dept, formula, params] of [['REV_KPI', 'Revision KPI: bo‘lim daromadining 5%', 'REVISION', 'PCT_OF_DEPT_REVENUE', { pct: 5 }], ['AUD_KPI', 'Audit KPI: bo‘lim daromadining 4%', 'AUDIT', 'PCT_OF_DEPT_REVENUE', { pct: 4 }], ['SPR_KPI', 'Sporniy KPI: bo‘lim daromadining 6%', 'LEGAL', 'PCT_OF_DEPT_REVENUE', { pct: 6 }], ['SALES_KPI', 'Sotuv KPI: o‘z shartnomalari daromadining 2%', 'SALES', 'PCT_OF_OWN_REVENUE', { pct: 2 }]])
    db.run('INSERT OR IGNORE INTO kpi_rules (code,name,department_id,formula,params) VALUES (?,?,?,?,?)', code, name, D[dept], formula, JSON.stringify(params));

  // ---------- 7. Hisoblar ----------
  db.run('INSERT INTO bank_accounts (bank_name,account_number,currency,opening_balance,opening_date) VALUES (?,?,?,?,?)', 'Kapitalbank', '2020 8000 1234 5678 9001', 'UZS', 150000000, '2026-05-31');
  db.run('INSERT INTO bank_accounts (bank_name,account_number,currency,opening_balance,opening_date) VALUES (?,?,?,?,?)', 'Ipoteka Bank', '2020 8000 9876 5432 1002', 'UZS', 60000000, '2026-05-31');
  db.run('INSERT INTO cash_accounts (name,currency,opening_balance,opening_date,responsible_user_id) VALUES (?,?,?,?,?)', 'Asosiy kassa', 'UZS', 8000000, '2026-05-31', U['accountant@utax.uz']);

  // ---------- 8. Kontragentlar ----------
  const companies = [['Silk Road Logistics', '300123456'], ['Toshkent Qurilish Invest', '301234567'], ['Nur Farm', '302345678'], ['Buxoro Teks', '303456789'], ['Digital Uz Solutions', '304567890'], ['Andijon Agro Export', '305678901'], ['Samarqand Tourism Group', '306789012'], ['Fergana Textile', '307890123'], ['Qo‘qon Metall', '308901234'], ['Namangan Med', '309012345'], ['Zarafshon Gold Trade', '310123456'], ['Chust Pichoq', '311234567'], ['Xorazm Energo', '312345678'], ['Termiz Cargo', '313456789'], ['Jizzax Sement', '314567890'], ['Guliston Plast', '315678901'], ['Navoiy Mining Service', '316789012'], ['Olmaliq Kimyo', '317890123'], ['Urgench Savdo', '318901234'], ['Qarshi Don Mahsulotlari', '319012345'], ['Shahrisabz Sayohat', '320123456'], ['Bekobod Metallurg', '321234567'], ['Kokand Kimyo Zavod', '322345678'], ['Marg‘ilon Ipak', '323456789'], ['Nukus Energiya', '324567890']];
  const CO = {};
  companies.forEach(([name, inn], i) => { CO[name] = db.insert('companies', { name, inn, phone: `+99890${String(1000000 + i * 7919).slice(0, 7)}`, email: `info@${name.toLowerCase().replace(/[^a-z]/g, '')}.uz`, manager_user_id: i % 2 ? U['sales2@utax.uz'] : U['sales@utax.uz'], kind: 'CLIENT', created_at: nowIso() }); });

  // ---------- 9. Xodimlar ----------
  const emps = [['Dilnoza Abdullayeva', 'REVISION', 'Bo‘lim boshlig‘i', 9e6, 'head.revision@utax.uz'], ['Rustam Qosimov', 'REVISION', 'Katta revizor', 7.5e6], ['Nodira Karimova', 'REVISION', 'Revizor', 6e6], ['Bobur Aliyev', 'REVISION', 'Revizor', 5.5e6],
    ['Otabek Nazarov', 'AUDIT', 'Bo‘lim boshlig‘i', 9.5e6, 'head.audit@utax.uz'], ['Sevara Tosheva', 'AUDIT', 'Auditor', 7e6], ['Ulug‘bek Raxmonov', 'AUDIT', 'Auditor', 6.5e6],
    ['Kamola Saidova', 'LEGAL', 'Bo‘lim boshlig‘i', 9e6, 'head.legal@utax.uz'], ['Doston Ergashev', 'LEGAL', 'Yurist', 6.5e6],
    ['Jasur Tursunov', 'SALES', 'Sotuv menejeri', 5e6, 'sales@utax.uz'], ['Madina Ergasheva', 'SALES', 'Sotuv menejeri', 5e6, 'sales2@utax.uz'],
    ['Aziza Mirzayeva', 'MARKETING', 'Marketing rahbari', 7e6, 'head.marketing@utax.uz'], ['Sherzod Qodirov', 'MARKETING', 'SMM mutaxassis', 4.5e6, 'employee@utax.uz'],
    ['Farrux Xolmatov', 'IT', 'IT rahbari', 8e6, 'head.it@utax.uz'], ['Sardor Alimov', 'FINANCE', 'Moliya menejeri', 7.5e6, 'finance@utax.uz'], ['Gulnora Yusupova', 'FINANCE', 'Bosh buxgalter', 6.5e6, 'accountant@utax.uz']];
  for (const [name, dept, pos, fixed, email] of emps) db.insert('employees', { user_id: email ? U[email] : null, name, department_id: D[dept], position: pos, fixed_salary: fixed, hired_at: '2025-01-10' });

  // ---------- 10. Reja / byudjet / recurring ----------
  for (const [p, r, e, cash, coll] of [['2026-06', 250e6, 230e6, 300e6, 250e6], ['2026-07', 300e6, 220e6, 400e6, 350e6], ['2026-08', 500e6, 240e6, 600e6, 450e6], ['2026-09', 600e6, 260e6, 800e6, 500e6], ['2026-10', 650e6, 270e6, 900e6, 550e6]])
    db.insert('plans', { period: p, revenue_plan: r, expense_plan: e, profit_plan: r - e, cash_plan: cash, collection_plan: coll, updated_at: nowIso() });
  for (const [dept, cat, amt] of [['MARKETING', null, 20e6], ['IT', null, 12e6], ['LEGAL', null, 25e6], ['ADMIN', 'RENT', 18e6]]) db.insert('budgets', { period: '2026-09', department_id: D[dept], category_id: cat ? C[cat] : null, amount: amt });
  for (const [name, cat, amt, day] of [['Ofis ijarasi', 'RENT', 18e6, 5], ['Hosting / server', 'HOSTING', 3.5e6, 1], ['Dasturiy ta‘minot obunalari', 'SOFTWARE', 4.8e6, 1], ['Kommunal', 'UTILITIES', 2.5e6, 10], ['Internet', 'UTILITIES', 1.2e6, 10], ['Oylik (taxminiy)', 'PAYROLL', 100e6, 10]]) db.insert('recurring_expenses', { name, category_id: C[cat], amount: amt, day_of_month: day });

  // ---------- 11. XRONOLOGIK VOQEALAR ----------
  const K = {}; // contract key → id
  const contracts = {
    C1: ['Silk Road Logistics', 'REVISION', 120e6, '2026-07-02', '2026-07-03', '2026-08-15', 50, '2026-07-07', '2026-08-25', 'sales@utax.uz', 'Moliyaviy reviziya 2025 yil'],
    C2: ['Toshkent Qurilish Invest', 'AUDIT', 250e6, '2026-07-03', '2026-07-06', '2026-09-30', 40, '2026-07-10', '2026-10-10', 'sales2@utax.uz', 'Majburiy audit 2025'],
    C3: ['Nur Farm', 'SPORNIY', 80e6, '2026-07-05', '2026-07-06', '2026-08-30', 50, '2026-07-10', '2026-09-10', 'sales@utax.uz', 'Soliq nizosi (sud)'],
    C4: ['Buxoro Teks', 'REVISION', 95e6, '2026-07-07', '2026-07-08', '2026-08-20', 50, '2026-07-12', '2026-08-30', 'sales2@utax.uz', 'Ombor va hisob reviziyasi'],
    C5: ['Digital Uz Solutions', 'SUBSCRIPTION', 60e6, '2026-07-01', '2026-07-01', '2027-06-30', 50, '2026-07-05', '2027-01-10', 'sales@utax.uz', 'Buxgalteriya autsorsing obunasi (12 oy)'],
    C6: ['Andijon Agro Export', 'AUDIT', 180e6, '2026-07-09', '2026-07-10', '2026-09-15', 50, '2026-07-15', '2026-09-25', 'sales2@utax.uz', 'Eksport operatsiyalari auditi'],
    C7: ['Samarqand Tourism Group', 'REVISION', 70e6, '2026-07-12', '2026-07-13', '2026-08-10', 50, '2026-07-17', '2026-08-20', 'sales@utax.uz', 'Reviziya'],
    C8: ['Fergana Textile', 'SPORNIY', 150e6, '2026-07-14', '2026-07-15', '2026-10-30', 30, '2026-07-20', '2026-11-10', 'sales2@utax.uz', 'Bojxona nizosi'],
    C9: ['Qo‘qon Metall', 'OTHER', 25e6, '2026-07-15', '2026-07-15', '2026-07-25', 100, '2026-07-20', '2026-07-20', 'sales@utax.uz', 'Konsultatsiya'],
    C10: ['Namangan Med', 'REVISION', 110e6, '2026-07-18', '2026-07-20', '2026-09-05', 50, '2026-07-23', '2026-09-15', 'sales2@utax.uz', 'Reviziya (klinika)'],
    C11: ['Zarafshon Gold Trade', 'AUDIT', 320e6, '2026-07-20', '2026-07-22', '2026-10-15', 40, '2026-07-28', '2026-10-25', 'sales@utax.uz', 'Audit (guruh)'],
    C12: ['Chust Pichoq', 'OTHER', 18e6, '2026-07-22', '2026-07-22', '2026-07-30', 100, '2026-07-27', '2026-07-27', 'sales2@utax.uz', 'Hisobot tayyorlash'],
    C13: ['Xorazm Energo', 'SPORNIY', 200e6, '2026-07-25', '2026-07-28', '2026-09-30', 50, '2026-07-30', '2026-10-10', 'sales@utax.uz', 'Arbitraj nizosi'],
    C14: ['Termiz Cargo', 'REVISION', 85e6, '2026-07-28', '2026-07-29', '2026-09-10', 50, '2026-08-02', '2026-09-20', 'sales2@utax.uz', 'Reviziya'],
    C15: ['Jizzax Sement', 'AUDIT', 140e6, '2026-06-10', '2026-06-11', '2026-07-20', 50, '2026-06-15', '2026-07-15', 'sales@utax.uz', 'Audit 2025'],
    C16: ['Guliston Plast', 'REVISION', 65e6, '2026-06-18', '2026-06-19', '2026-07-25', 50, '2026-06-23', '2026-08-05', 'sales2@utax.uz', 'Reviziya'],
    C17: ['Navoiy Mining Service', 'SPORNIY', 175e6, '2026-06-05', '2026-06-06', '2026-08-31', 40, '2026-06-10', '2026-09-10', 'sales@utax.uz', 'Soliq nizosi (apellyatsiya)'],
    C18: ['Olmaliq Kimyo', 'AUDIT', 95e6, '2026-06-25', '2026-06-26', '2026-08-10', 50, '2026-06-30', '2026-08-20', 'sales2@utax.uz', 'Audit'],
    C19: ['Urgench Savdo', 'REVISION', 130e6, '2026-08-04', '2026-08-05', '2026-09-25', 50, '2026-08-09', '2026-10-05', 'sales@utax.uz', 'Reviziya (savdo tarmog‘i)'],
    C20: ['Qarshi Don Mahsulotlari', 'AUDIT', 210e6, '2026-08-11', '2026-08-12', '2026-10-20', 40, '2026-08-16', '2026-10-30', 'sales2@utax.uz', 'Audit'],
    C21: ['Shahrisabz Sayohat', 'SUBSCRIPTION', 36e6, '2026-08-01', '2026-08-01', '2027-01-31', 50, '2026-08-05', '2027-01-31', 'sales@utax.uz', 'Obuna (6 oy)'],
    C22: ['Bekobod Metallurg', 'SPORNIY', 90e6, '2026-08-18', '2026-08-19', '2026-10-10', 50, '2026-08-23', '2026-10-20', 'sales2@utax.uz', 'Mehnat nizosi'],
    C23: ['Toshkent Qurilish Invest', 'REVISION', 75e6, '2026-08-20', '2026-08-21', '2026-09-30', 50, '2026-08-25', '2026-10-10', 'sales@utax.uz', 'Qurilish obyekti reviziyasi'],
    C24: ['Kokand Kimyo Zavod', 'AUDIT', 160e6, '2026-09-08', '2026-09-10', '2026-11-20', 40, '2026-09-13', '2026-11-30', 'sales2@utax.uz', 'Audit 2025'],
    C25: ['Marg‘ilon Ipak', 'REVISION', 55e6, '2026-09-15', '2026-09-16', '2026-10-20', 50, '2026-09-20', '2026-10-30', 'sales@utax.uz', 'Reviziya'],
    C26: ['Nukus Energiya', 'SPORNIY', 240e6, '2026-09-18', '2026-09-21', '2026-12-20', 50, '2026-09-25', '2026-12-30', 'sales@utax.uz', 'Nizolar (DRAFT)', 'DRAFT'],
  };
  const ev = [];
  for (const [k, c] of Object.entries(contracts)) ev.push({ d: c[3], t: 'contract', k, c });
  const pay = (d, k, amount, ref, bank = 1, confirm = false) => ev.push({ d, t: 'pay', k, amount, ref, bank, confirm });
  pay('2026-06-09', 'C17', 70e6, 'num'); pay('2026-06-15', 'C15', 70e6, 'num'); pay('2026-06-22', 'C16', 32.5e6, 'num', 2); pay('2026-06-29', 'C18', 47.5e6, 'num');
  pay('2026-07-04', 'C5', 30e6, 'num', 2); pay('2026-07-06', 'C1', 60e6, 'num'); pay('2026-07-08', 'C3', 40e6, 'num'); pay('2026-07-10', 'C2', 100e6, 'num'); pay('2026-07-11', 'C4', 47.5e6, 'num', 2);
  pay('2026-07-14', 'C7', 35e6, 'num'); pay('2026-07-15', 'C6', 90e6, 'inn', 1, true); pay('2026-07-17', 'C9', 25e6, 'num', 2); pay('2026-07-20', 'C8', 45e6, 'num'); pay('2026-07-22', 'C10', 55e6, 'num');
  ev.push({ d: '2026-07-24', t: 'cashpay', k: 'C12', amount: 18e6 });
  pay('2026-07-28', 'C11', 128e6, 'num'); pay('2026-08-01', 'C14', 42.5e6, 'num', 2); pay('2026-08-03', 'C16', 32.5e6, 'inn', 1, true); pay('2026-08-05', 'C21', 18e6, 'num'); pay('2026-08-07', 'C19', 65e6, 'num');
  pay('2026-08-14', 'C20', 84e6, 'inn', 1, true); pay('2026-08-18', 'C7', 35e6, 'num', 2); pay('2026-08-19', 'C18', 47.5e6, 'num'); pay('2026-08-20', 'C22', 45e6, 'num'); pay('2026-08-28', 'C1', 60e6, 'inn', 1, true);
  pay('2026-09-12', 'C17', 50e6, 'num'); pay('2026-09-12', 'C24', 64e6, 'num'); pay('2026-09-18', 'C14', 42.5e6, 'num', 2);
  pay('2026-09-18', 'C3', 40e6, 'inn'); pay('2026-09-19', 'C23', 37.5e6, 'inn'); // SUGGESTED — inson tasdiqlashi kerak
  const svc = (d, k, status) => ev.push({ d, t: 'svc', k, status });
  for (const [k, d] of [['C15', '2026-06-11'], ['C16', '2026-06-19'], ['C17', '2026-06-06'], ['C18', '2026-06-26'], ['C1', '2026-07-03'], ['C2', '2026-07-06'], ['C3', '2026-07-06'], ['C4', '2026-07-08'], ['C5', '2026-07-01'], ['C6', '2026-07-10'], ['C7', '2026-07-13'], ['C8', '2026-07-15'], ['C10', '2026-07-20'], ['C11', '2026-07-22'], ['C13', '2026-07-28'], ['C14', '2026-07-29'], ['C19', '2026-08-05'], ['C20', '2026-08-12'], ['C21', '2026-08-01'], ['C23', '2026-08-21'], ['C24', '2026-09-10']]) svc(d, k, 'IN_PROGRESS');
  svc('2026-08-05', 'C13', 'ON_HOLD');
  const done = (d, k, act = true, approve = true) => { ev.push({ d, t: 'svc', k, status: 'COMPLETED', approve }); if (act) ev.push({ d, t: 'act', k }); };
  done('2026-07-18', 'C15'); done('2026-07-24', 'C16'); ev.push({ d: '2026-07-25', t: 'svc', k: 'C9', status: 'COMPLETED' }); ev.push({ d: '2026-07-30', t: 'svc', k: 'C12', status: 'COMPLETED' });
  done('2026-08-08', 'C7'); done('2026-08-09', 'C18'); done('2026-08-14', 'C1'); done('2026-08-19', 'C4', false); done('2026-08-29', 'C3'); done('2026-08-30', 'C17');
  done('2026-09-04', 'C10', true, false); done('2026-09-09', 'C14'); done('2026-09-15', 'C6');
  ev.push({ d: '2026-08-01', t: 'sl', asOf: '2026-07-31' }, { d: '2026-09-01', t: 'sl', asOf: '2026-08-31' });

  // Xarajatlar: [date, dept, cat, amount, purpose, counterparty, pay(bank1/bank2/cash/unpaid), paidDate, contractKey, recurring]
  const exp = (d, dept, cat, amount, purpose, cp, pay, paid, k = null, rec = false, extra = {}) => ev.push({ d, t: 'exp', dept, cat, amount, purpose, cp, pay, paid: paid || d, k, rec, extra });
  for (const [m, rent, host, soft, util, inet, tax, ads, bankfee, transport] of [['06', 18e6, 3.5e6, 4.8e6, 2.4e6, 1.2e6, 24e6, 10e6, 0.8e6, 2.8e6], ['07', 18e6, 3.5e6, 4.8e6, 2.5e6, 1.2e6, 22e6, 12e6, 0.9e6, 3.1e6], ['08', 18e6, 3.5e6, 4.8e6, 2.6e6, 1.2e6, 28e6, 15e6, 0.9e6, 3.3e6], ['09', 18e6, 3.5e6, 4.8e6, 2.5e6, null, 30e6, 9e6, null, 1.9e6]]) {
    const mm = `2026-${m}`;
    exp(`${mm}-05`, 'ADMIN', 'RENT', rent, `Ofis ijarasi ${mm}`, 'TASHKENT CITY OFFICE MCHJ', 'bank1', null, null, true);
    exp(`${mm}-01`, 'IT', 'HOSTING', host, `Hosting va server ${mm}`, 'AHOST MCHJ', 'bank1', `${mm}-02`, null, true);
    exp(`${mm}-01`, 'IT', 'SOFTWARE', soft, `Dasturiy ta‘minot obunalari ${mm}`, 'SOFTLINE UZ', 'bank2', `${mm}-03`, null, true);
    exp(`${mm}-10`, 'ADMIN', 'UTILITIES', util, `Kommunal xizmatlar ${mm}`, 'TOSHKENT ISSIQLIK', 'bank1', `${mm}-11`, null, true);
    if (inet) exp(`${mm}-10`, 'ADMIN', 'UTILITIES', inet, `Internet ${mm}`, 'UZBEKTELECOM', 'bank1', `${mm}-11`, null, true);
    exp(`${mm}-${m === '06' ? '20' : m === '09' ? '15' : '20'}`, 'FINANCE', 'TAX', tax, `Soliq to‘lovlari ${mm} (QQS, foyda solig‘i)`, 'DAVLAT SOLIQ QO‘MITASI', 'bank1');
    exp(`${mm}-${m === '09' ? '10' : m === '08' ? '08' : m === '07' ? '12' : '15'}`, 'MARKETING', 'ADVERTISING', ads, `Reklama kampaniyasi ${mm} (Meta, Telegram Ads)`, 'META PLATFORMS', 'bank2', null);
    if (bankfee) exp(`${mm}-30`, 'FINANCE', 'BANK', bankfee, `Bank xizmatlari ${mm}`, 'KAPITALBANK', 'bank1');
    exp(`${mm}-${m === '09' ? '15' : '28'}`, 'ADMIN', 'TRANSPORT', transport, `Transport va taksi ${mm}`, 'Yandex Go / xodimlar', 'cash');
  }
  exp('2026-06-30', 'FINANCE', 'PAYROLL', 92e6, 'Oylik 2026-06', 'Xodimlar', 'bank1', '2026-07-10');
  exp('2026-06-18', 'LEGAL', 'SUBCONTRACT', 14e6, 'Tashqi ekspert xulosasi (Navoiy Mining)', 'EKSPERT-AUDIT MCHJ', 'bank1', '2026-06-20', 'C17');
  exp('2026-07-15', 'REVISION', 'BUSINESS_TRIP', 6.5e6, 'Xizmat safari Buxoro (reviziya)', 'Xodimlar', 'bank1', '2026-07-16', 'C4');
  exp('2026-07-18', 'ADMIN', 'OFFICE', 1.8e6, 'Kantselyariya va ofis buyumlari', 'OFIS MARKET', 'cash');
  exp('2026-07-22', 'LEGAL', 'SUBCONTRACT', 15e6, 'Sud ekspertizasi (Nur Farm nizosi)', 'EKSPERT-AUDIT MCHJ', 'bank1', '2026-07-23', 'C3');
  exp('2026-07-25', 'AUDIT', 'SUBCONTRACT', 12e6, 'Tashqi auditor jalb qilish (Andijon Agro)', 'AUDIT PARTNERS', 'bank1', '2026-07-26', 'C6');
  exp('2026-08-12', 'IT', 'EQUIPMENT', 24e6, '3 ta noutbuk (revision bo‘limi uchun)', 'TEXNOMART', 'bank1', '2026-08-13');
  exp('2026-08-15', 'LEGAL', 'LEGAL', 5e6, 'Davlat boji va notarius (Navoiy Mining sud)', 'NOTARIUS №12', 'bank1', '2026-08-15', 'C17');
  exp('2026-08-22', 'LEGAL', 'SUBCONTRACT', 22e6, 'Ekspert xulosasi apellyatsiya (Navoiy Mining)', 'EKSPERT-AUDIT MCHJ', 'bank1', '2026-08-23', 'C17');
  exp('2026-08-26', 'AUDIT', 'BUSINESS_TRIP', 8e6, 'Xizmat safari Qarshi (audit)', 'Xodimlar', 'bank1', '2026-08-27', 'C20');
  exp('2026-09-12', 'LEGAL', 'SUBCONTRACT', 9e6, 'Ekspert xulosasi (Fergana Textile)', 'EKSPERT-AUDIT MCHJ', 'bank1', '2026-09-13', 'C8');
  exp('2026-09-16', 'LEGAL', 'LEGAL', 7e6, 'Yuridik xizmat (Xorazm Energo nizosi)', 'LEX PARTNERS', 'unpaid', null, 'C13');
  exp('2026-09-17', 'IT', 'SOFTWARE', 9e6, 'CRM litsenziyasi yillik uzaytirish', 'SOFTLINE UZ', 'unpaid');
  ev.push({ d: '2026-08-05', t: 'payroll', period: '2026-07', paid: '2026-08-10' }, { d: '2026-09-05', t: 'payroll', period: '2026-08', paid: '2026-09-10' });
  // So'rovlar (approval engine)
  const req = (d, by, dept, amount, purpose, required, decisions = []) => ev.push({ d, t: 'req', by, dept, amount, purpose, required, decisions });
  req('2026-08-28', 'employee@utax.uz', 'MARKETING', 6e6, 'Korporativ tadbir (team building)', '2026-09-05', [['head.marketing@utax.uz', 'APPROVE'], ['finance@utax.uz', 'REJECT', 'Byudjetdan tashqari']]);
  // Bo'lim rahbarining o'z so'rovi — vazifalar ajratilishi: bo'lim rahbari qadamini CEO (ACT_AS) tasdiqlaydi
  req('2026-09-10', 'head.legal@utax.uz', 'LEGAL', 18e6, 'Yuridik adabiyot va huquqiy baza obunasi', '2026-09-30', [['ceo@utax.uz', 'APPROVE'], ['finance@utax.uz', 'POSTPONE', 'Oktabr byudjetiga ko‘chirish']]);
  req('2026-09-13', 'sales2@utax.uz', 'SALES', 45e6, 'Ofis ta‘mirlash (sotuv bo‘limi)', '2026-10-05', [['founder@utax.uz', 'APPROVE']]);
  req('2026-09-14', 'employee@utax.uz', 'MARKETING', 12e6, 'Reklama kampaniyasi — sentabr-oktabr Telegram Ads', '2026-09-25', [['head.marketing@utax.uz', 'APPROVE']]);
  req('2026-09-16', 'head.it@utax.uz', 'IT', 3.5e6, 'Dizayner uchun 27" monitor', '2026-09-30');
  req('2026-09-18', 'head.it@utax.uz', 'IT', 120e6, 'Server klaster (yangi CRM + backup)', '2026-10-15');
  req('2026-09-19', 'head.audit@utax.uz', 'AUDIT', 4.2e6, 'Audit bo‘limi uchun ISO standartlar to‘plami', '2026-10-01');
  // Bog'lanmagan / boshqa tranzaksiyalar
  ev.push({ d: '2026-06-20', t: 'tx', b: { bank_account_id: 2, direction: 'INCOME', amount: 50e6, counterparty_name: 'Orifjonov M.', purpose: 'Vremennaya finansovaya pomoshch uchreditelya' }, ignore: 'LOAN', cf: 'FINANCING' });
  ev.push({ d: '2026-09-05', t: 'tx', b: { bank_account_id: 1, direction: 'INCOME', amount: 8.2e6, counterparty_name: 'OOO TEXNOSERVIS', counterparty_inn: '301999888', purpose: 'Vozvrat sredstv po schetu 45' }, ignore: 'REFUND' });
  ev.push({ d: '2026-09-16', t: 'tx', b: { bank_account_id: 1, direction: 'INCOME', amount: 15e6, counterparty_name: 'ALFA TRADE MCHJ', counterparty_inn: '305111222', purpose: 'Oplata za uslugi' } });
  ev.push({ d: '2026-09-17', t: 'tx', b: { bank_account_id: 1, direction: 'EXPENSE', amount: 1.2e6, counterparty_name: 'UZBEKTELECOM', counterparty_inn: '200111222', purpose: 'Internet 2026-09' } });

  ev.sort((a, b) => a.d.localeCompare(b.d) || order(a) - order(b));
  function order(e) { return { contract: 0, svc: 1, pay: 2, cashpay: 2, tx: 2, act: 3, sl: 4, exp: 5, payroll: 6, req: 7 }[e.t] ?? 9; }

  const acc = ctxOf('accountant@utax.uz'), fin = ctxOf('finance@utax.uz'), cfo = ctxOf('cfo@utax.uz'), founder = ctxOf('founder@utax.uz');
  let firstExpense = true;
  for (const e of ev) {
    if (e.t === 'contract') {
      const [co, type, amount, cd, sd, ed, adv, advDue, due, mgr, title, status] = e.c;
      const c = S.contracts.create({ company_id: CO[co], service_type_id: st[type], amount, contract_date: cd, start_date: sd, end_date: ed, advance_pct: adv, advance_due_date: advDue, payment_due_date: due, manager_user_id: U[mgr], title, contract_status: status || 'ACTIVE' }, ctxOf(mgr));
      K[e.k] = c.id;
    } else if (e.t === 'pay') {
      const c = S.contracts.get(K[e.k]);
      const purpose = e.ref === 'num' ? `Oplata po dogovoru ${c.contract_number} za uslugi` : `Oplata za uslugi po dogovoru ot ${c.contract_date}`;
      const res = S.banking.createTransaction({ bank_account_id: e.bank, tx_date: e.d, amount: e.amount, direction: 'INCOME', counterparty_name: c.company_name.toUpperCase() + ' MCHJ', counterparty_inn: c.company_inn, purpose }, acc, { source: 'IMPORT', skipMatch: true });
      const m = S.reconciliation.autoMatch(res.id, acc);
      if (m?.status !== 'MATCHED' && e.confirm) S.reconciliation.confirm(res.id, c.id, fin, { reason: 'INN + summa mos, mijoz tasdiqladi' });
    } else if (e.t === 'cashpay') {
      const c = S.contracts.get(K[e.k]);
      const id = db.insert('cash_transactions', { cash_account_id: 1, tx_date: e.d, amount: e.amount, direction: 'INCOME', counterparty_name: c.company_name, purpose: `Naqd to‘lov ${c.contract_number}`, contract_id: c.id, created_by: acc.user.id, created_at: nowIso() });
      const pid = db.insert('payments', { contract_id: c.id, amount: e.amount, paid_at: e.d, source: 'CASH', cash_transaction_id: id, created_by: acc.user.id, created_at: nowIso() });
      S.revenue.onPaymentRecorded(db.get('SELECT * FROM payments WHERE id=?', pid), acc);
      S.contracts.recompute(c.id);
    } else if (e.t === 'svc') {
      const r = S.contracts.setServiceStatus(K[e.k], e.status, ctxOf('sales@utax.uz'), { completed_at: e.d });
      if (r.recognition?.status === 'PENDING_APPROVAL' && e.approve) S.approvals.decide(r.recognition.approval_id, 'APPROVE', cfo, 'Akt tekshirildi, tasdiqlandi');
    } else if (e.t === 'act') {
      const c = S.contracts.get(K[e.k]);
      S.contracts.addDocument(c.id, { doc_type: 'ACT', name: `Qabul akti ${c.contract_number}`, doc_date: e.d }, ctxOf('sales@utax.uz'));
      const pend = db.get("SELECT approval_id FROM revenue_recognition WHERE contract_id=? AND status='PENDING_APPROVAL' ORDER BY id DESC LIMIT 1", c.id);
      if (pend) { const evc = ev.find((x) => x.t === 'svc' && x.k === e.k && x.status === 'COMPLETED'); if (evc?.approve) S.approvals.decide(pend.approval_id, 'APPROVE', cfo, 'Akt tekshirildi, tasdiqlandi'); }
    } else if (e.t === 'sl') S.revenue.runStraightLine(e.asOf, acc);
    else if (e.t === 'exp') {
      const x = S.expenses.createDirect({ code: firstExpense ? 'EXP-000650' : undefined, expense_date: e.d, department_id: D[e.dept], category_id: C[e.cat], amount: e.amount, purpose: e.purpose, counterparty: e.cp, payment_method: e.pay === 'cash' ? 'CASH' : 'BANK', status: 'APPROVED', contract_id: e.k ? K[e.k] : null, is_recurring: e.rec, requested_by: db.get('SELECT head_user_id FROM departments WHERE id=?', D[e.dept])?.head_user_id || acc.user.id }, acc);
      firstExpense = false;
      if (e.pay === 'bank1' || e.pay === 'bank2') {
        const res = S.banking.createTransaction({ bank_account_id: e.pay === 'bank1' ? 1 : 2, tx_date: e.paid, amount: e.amount, direction: 'EXPENSE', counterparty_name: e.cp, purpose: `${e.purpose} ${x.code}` }, acc, { source: 'IMPORT', skipMatch: true });
        const m = S.reconciliation.autoMatch(res.id, acc);
        if (m?.status !== 'MATCHED') S.reconciliation.confirmExpense(res.id, x.id, acc);
      } else if (e.pay === 'cash') {
        const id = db.insert('cash_transactions', { cash_account_id: 1, tx_date: e.paid, amount: e.amount, direction: 'EXPENSE', counterparty_name: e.cp, purpose: e.purpose, expense_id: x.id, created_by: acc.user.id, created_at: nowIso() });
        S.expenses.markPaid(x.id, { cash_transaction_id: id, paid_at: e.paid }, acc);
      }
    } else if (e.t === 'payroll') {
      S.payroll.compute(e.period, acc);
      const sum = S.payroll.submit(e.period, acc);
      let apr = sum.approval;
      for (let i = 0; i < apr.steps.length; i++) apr = S.approvals.decide(apr.id, 'APPROVE', founder, 'Tasdiqlandi');
      for (const row of db.all('SELECT DISTINCT p.expense_id FROM payrolls p WHERE p.period=? AND p.expense_id IS NOT NULL', e.period)) {
        const x = db.get('SELECT * FROM expenses WHERE id=?', row.expense_id);
        const dname = db.get('SELECT name FROM departments WHERE id=?', x.department_id)?.name || '';
        const res = S.banking.createTransaction({ bank_account_id: 1, tx_date: e.paid, amount: x.amount, direction: 'EXPENSE', counterparty_name: 'Xodimlar (plastik karta)', purpose: `Oylik ${e.period} ${dname} ${x.code}` }, acc, { source: 'IMPORT', skipMatch: true });
        const m = S.reconciliation.autoMatch(res.id, acc);
        if (m?.status !== 'MATCHED') S.reconciliation.confirmExpense(res.id, x.id, acc);
      }
      db.run("UPDATE payrolls SET status='PAID', paid_at=? WHERE period=? AND status='APPROVED'", e.paid, e.period);
    } else if (e.t === 'req') {
      const x = S.expenses.request({ expense_date: e.d, department_id: D[e.dept], amount: e.amount, purpose: e.purpose, required_date: e.required }, ctxOf(e.by));
      for (const [who, decision, comment] of e.decisions) S.approvals.decide(x.approval_id, decision, ctxOf(who), comment || 'OK');
    } else if (e.t === 'tx') {
      const res = S.banking.createTransaction({ ...e.b, tx_date: e.d }, acc, { source: 'IMPORT', skipMatch: true });
      if (e.ignore) S.reconciliation.ignore(res.id, acc, e.ignore, e.cf); else S.reconciliation.autoMatch(res.id, acc);
    }
  }
  S.revenue.runStraightLine(today(), acc);
  S.contracts.recomputeAll();

  // ---------- 12. Integratsiyalar (namuna) ----------
  const { encryptSecret } = await import('../core/auth.mjs');
  db.insert('integrations', { type: 'EXCEL', name: 'Bank ko‘chirmasi (Excel/CSV)', config: JSON.stringify({ bank_account_id: 1 }), secret_config: encryptSecret('{}'), created_at: nowIso(), last_status: 'Qo‘lda yuklanadi' });
  db.insert('integrations', { type: 'WEBHOOK_IN', name: 'Kapitalbank webhook (inbound)', config: JSON.stringify({ bank_account_id: 1 }), secret_config: encryptSecret(JSON.stringify({ token: 'demo-webhook-token-change-me' })), created_at: nowIso() });
  db.insert('integrations', { type: 'GOOGLE_SHEETS', name: 'Google Sheets — kassa jadvali', config: JSON.stringify({ sheet_id: '', gid: '0', bank_account_id: 2 }), secret_config: encryptSecret('{}'), is_active: 0, created_at: nowIso() });
  db.insert('integrations', { type: 'TELEGRAM', name: 'Telegram Finance Bot', config: '{}', secret_config: encryptSecret('{}'), created_at: nowIso() });
  db.insert('integrations', { type: 'ONE_C', name: '1C Buxgalteriya', config: JSON.stringify({ base_url: 'http://1c.local/utax/hs/finance', endpoint: '/transactions', bank_account_id: 1 }), secret_config: encryptSecret(JSON.stringify({ username: '', password: '' })), is_active: 0, created_at: nowIso() });

  // ---------- 13. Agentlar bir marta ----------
  await S.ai.runAgent('COLLECTION');
  await S.ai.runAgent('RECONCILIATION');
  await S.ai.runAgent('DATA_QUALITY');
  await S.ai.runAgent('EXPENSE');
  // ko'p eski bildirishnomalarni o'qilgan deb belgilash
  db.run("UPDATE notifications SET is_read=1 WHERE id NOT IN (SELECT id FROM notifications n2 WHERE n2.user_id=notifications.user_id ORDER BY id DESC LIMIT 8)");
  db.run("UPDATE audit_logs SET source='SEED' WHERE source IS NULL");
  log(`[seed] ✅ ${db.get('SELECT COUNT(*) c FROM contracts').c} shartnoma, ${db.get('SELECT COUNT(*) c FROM bank_transactions').c} bank tranzaksiya, ${db.get('SELECT COUNT(*) c FROM expenses').c} xarajat, ${db.get('SELECT COUNT(*) c FROM users').c} foydalanuvchi. Parol: ${PASSWORD}`);
  return { password: PASSWORD };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { createApp } = await import('../server.mjs');
  const { config } = await import('../core/config.mjs');
  const fs = await import('node:fs');
  if (process.argv.includes('--reset')) for (const f of [config.dbPath, config.dbPath + '-wal', config.dbPath + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
  const app = createApp();
  if (app.db.get('SELECT COUNT(*) c FROM users').c > 0 && !process.argv.includes('--reset')) { console.log('Baza bo‘sh emas. --reset bilan qayta yuklang.'); process.exit(0); }
  await seed(app);
  app.db.close();
}
