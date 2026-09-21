/**
 * TIZIM SEED — faqat tizim tuzilmasi (hech qanday biznes ma'lumoti YO'Q).
 *
 * QOIDA (CLAUDE.md): tizimga o'zimizdan ma'lumot qo'shilmaydi. Shartnoma, kontragent, tranzaksiya, xarajat,
 * xodim, maosh, reja, qoldiq — faqat Excel importi orqali (Integratsiyalar → Moliya jurnali) yoki
 * foydalanuvchi qo'lda kiritadi. Bu yerda faqat: kirish akkauntlari (rol nomi bilan), xizmat turlari
 * (TZ + Excel jurnalidagi yo'nalishlar), xarajat kategoriyalari (TZ), tasdiqlash zanjiri tuzilmasi.
 *
 * Ishga tushirish: node src/seed/seed.mjs --reset   (bazani o'chirib, bo'sh tizim yaratadi)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../core/auth.mjs';
import { nowIso } from '../core/util.mjs';

const PASSWORD = 'Utax2026!';

export async function seed(app, { log = console.log } = {}) {
  const { db } = app;

  // Xizmat turlari: TZ (REVISION, AUDIT, SPORNIY, SUBSCRIPTION) + Excel jurnalidagi yo'nalishlar (Консультация, Сопровождение, Экспресс, Прочий)
  const types = [
    ['REVISION', 'Reviziya', 'R', 'ON_COMPLETION', true, '#2563eb'],
    ['AUDIT', 'Audit', 'A', 'ON_COMPLETION', true, '#059669'],
    ['SPORNIY', 'Nizoli ishlar (sud)', 'S', 'ON_COMPLETION', true, '#ea580c'],
    ['CONSULTING', 'Konsultatsiya', 'K', 'ON_COMPLETION', false, '#7c3aed'],
    ['SUPPORT', 'Hamrohlik (soprovojdeniye)', 'H', 'ON_COMPLETION', false, '#0891b2'],
    ['EXPRESS', 'Ekspress', 'E', 'ON_COMPLETION', false, '#db2777'],
    ['SUBSCRIPTION', 'Obuna xizmati', 'SB', 'STRAIGHT_LINE', false, '#b45309'],
    ['OTHER', 'Boshqa xizmatlar', 'O', 'ON_PAYMENT', false, '#92400e'],
  ];
  types.forEach(([code, name, prefix, method, doc, color], i) => db.run('INSERT OR IGNORE INTO service_types (code,name,prefix,recognition_rule,color,sort) VALUES (?,?,?,?,?,?)', code, name, prefix, JSON.stringify({ method, require_acceptance_document: doc }), color, i));

  // Bo'limlar (tashkiliy tuzilma — Sozlamalarda o'zgartiriladi)
  const st = Object.fromEntries(db.all('SELECT id, code FROM service_types').map((x) => [x.code, x.id]));
  const depts = [['REVISION', 'Reviziya bo‘limi', st.REVISION], ['AUDIT', 'Audit bo‘limi', st.AUDIT], ['LEGAL', 'Yuridik (nizoli ishlar) bo‘limi', st.SPORNIY], ['SALES', 'Sotuv bo‘limi', null], ['MARKETING', 'Marketing', null], ['IT', 'IT bo‘limi', null], ['FINANCE', 'Moliya bo‘limi', null], ['ADMIN', 'Ma’muriyat', null]];
  for (const [code, name, stid] of depts) db.run('INSERT OR IGNORE INTO departments (code,name,service_type_id) VALUES (?,?,?)', code, name, stid);
  const D = Object.fromEntries(db.all('SELECT id, code FROM departments').map((x) => [x.code, x.id]));

  // Kirish akkauntlari — shaxs ismi o'ylab topilmaydi, faqat rol nomi (foydalanuvchi o'zi o'zgartiradi)
  const users = [
    ['founder@utax.uz', 'Ta’sischi', 'FOUNDER', null], ['ceo@utax.uz', 'Bosh direktor', 'CEO', null], ['cfo@utax.uz', 'Moliya direktori', 'CFO', 'FINANCE'],
    ['finance@utax.uz', 'Moliya menejeri', 'FINANCE_MANAGER', 'FINANCE'], ['accountant@utax.uz', 'Bosh buxgalter', 'ACCOUNTANT', 'FINANCE'],
    ['sales@utax.uz', 'Sotuv menejeri', 'SALES', 'SALES'], ['head.revision@utax.uz', 'Reviziya bo‘limi rahbari', 'DEPARTMENT_HEAD', 'REVISION'],
    ['head.audit@utax.uz', 'Audit bo‘limi rahbari', 'DEPARTMENT_HEAD', 'AUDIT'], ['head.legal@utax.uz', 'Yuridik bo‘lim rahbari', 'DEPARTMENT_HEAD', 'LEGAL'],
    ['head.marketing@utax.uz', 'Marketing rahbari', 'DEPARTMENT_HEAD', 'MARKETING'], ['head.it@utax.uz', 'IT bo‘limi rahbari', 'DEPARTMENT_HEAD', 'IT'],
    ['employee@utax.uz', 'Xodim', 'EMPLOYEE', 'MARKETING'], ['auditor@utax.uz', 'Tashqi auditor', 'AUDITOR', null], ['admin@utax.uz', 'Administrator', 'ADMIN', 'IT'],
  ];
  const pw = hashPassword(PASSWORD);
  for (const [email, name, role, dept] of users) db.run('INSERT OR IGNORE INTO users (email,password_hash,name,role_code,department_id,created_at) VALUES (?,?,?,?,?,?)', email, pw, name, role, dept ? D[dept] : null, nowIso());
  const U = Object.fromEntries(db.all('SELECT id, email FROM users').map((x) => [x.email, x.id]));
  for (const [dept, email] of [['REVISION', 'head.revision@utax.uz'], ['AUDIT', 'head.audit@utax.uz'], ['LEGAL', 'head.legal@utax.uz'], ['MARKETING', 'head.marketing@utax.uz'], ['IT', 'head.it@utax.uz'], ['FINANCE', 'cfo@utax.uz']]) db.run('UPDATE departments SET head_user_id=? WHERE code=?', U[email], dept);

  // Xarajat kategoriyalari (TZ: Payroll, Marketing, Office, IT, Taxes, Operations, Other) — kalit so'zlar avtomatik kategoriyalash uchun
  const cats = [
    ['PAYROLL', 'Oylik (xodimlar)', 'PAYROLL', 'OPERATING', 0, ['oylik', 'maosh', 'з/п', 'зарплат', 'ойлик']],
    ['MARKETING', 'Marketing', 'MARKETING', 'OPERATING', 0, ['marketing', 'маркетинг']], ['ADVERTISING', 'Reklama', 'MARKETING', 'OPERATING', 0, ['reklama', 'таргет', 'target', 'реклама']],
    ['IT', 'IT xizmatlari', 'IT', 'OPERATING', 0, ['it xizmat']], ['HOSTING', 'Hosting va server', 'IT', 'OPERATING', 0, ['hosting', 'server', 'сервер']], ['SOFTWARE', 'Dasturiy ta’minot', 'IT', 'OPERATING', 0, ['dasturiy', 'дидокс', 'программа']],
    ['OFFICE', 'Ofis xarajatlari', 'OFFICE', 'OPERATING', 0, ['ofis', 'ишхона']], ['RENT', 'Ofis ijarasi', 'OFFICE', 'OPERATING', 0, ['ijara', 'аренда']], ['UTILITIES', 'Kommunal va aloqa', 'OFFICE', 'OPERATING', 0, ['kommunal', 'интернет', 'мусор']],
    ['TRANSPORT', 'Transport', 'ADMIN', 'OPERATING', 0, ['transport']], ['TAX', 'Soliqlar', 'TAX', 'OPERATING', 0, ['soliq', 'налог', 'ндс', 'есп', 'инпс']],
    ['LEGAL', 'Yuridik xizmatlar', 'ADMIN', 'OPERATING', 0, ['yurist', 'адвокат']], ['BANK', 'Bank xizmatlari', 'ADMIN', 'OPERATING', 0, ['комиссия банка']],
    ['EQUIPMENT', 'Jihozlar', 'OTHER', 'INVESTING', 0, ['jihoz']], ['BUSINESS_TRIP', 'Xizmat safari', 'ADMIN', 'OPERATING', 0, ['xizmat safari']],
    ['SUBCONTRACT', 'Tashqi ekspert (to‘g‘ridan-to‘g‘ri)', 'DIRECT', 'OPERATING', 1, ['субподряд']], ['OTHER', 'Boshqa', 'OTHER_OPEX', 'OPERATING', 0, []],
  ];
  cats.forEach(([code, name, grp, cf, direct, kw], i) => db.run('INSERT OR IGNORE INTO expense_categories (code,name,pnl_group,cf_class,is_direct_cost,keywords,sort) VALUES (?,?,?,?,?,?,?)', code, name, grp, cf, direct, JSON.stringify(kw), i));

  // Tasdiqlash zanjiri tuzilmasi (summa chegaralarisiz — chegaralarni Tasdiqlashlar → Qoidalar va limitlar sahifasida rahbar belgilaydi)
  if (!db.get('SELECT id FROM approval_rules LIMIT 1')) {
    const rules = [['EXPENSE', ['DEPARTMENT_HEAD', 'CFO'], 'Xarajat'], ['REVENUE_RECOGNITION', ['CFO'], 'Daromad tan olish'], ['PAYROLL', ['CFO'], 'Oylik'], ['CONTRACT_CHANGE', ['CFO'], 'Shartnoma o‘zgarishi'], ['AI_ACTION', ['CFO'], 'AI harakati']];
    rules.forEach(([et, steps, name], i) => db.run('INSERT INTO approval_rules (entity_type,min_amount,max_amount,steps,name,sort) VALUES (?,?,?,?,?,?)', et, 0, null, JSON.stringify(steps), name, i));
  }

  // Excel yuklash adapteri (sozlama yozuvi; ma'lumot emas)
  const { encryptSecret } = await import('../core/auth.mjs');
  if (!db.get("SELECT id FROM integrations WHERE type='EXCEL'")) db.insert('integrations', { type: 'EXCEL', name: 'Excel / CSV fayl', config: '{}', secret_config: encryptSecret('{}'), created_at: nowIso(), last_status: 'Qo‘lda yuklanadi' });

  log(`[seed] ✅ Bo‘sh tizim tayyor: ${db.get('SELECT COUNT(*) c FROM users').c} ta kirish akkaunti (parol: ${PASSWORD}). Biznes ma’lumotlari yo‘q — Excel orqali yuklang.`);
  return { password: PASSWORD };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { createApp } = await import('../server.mjs');
  const { config } = await import('../core/config.mjs');
  const fs = await import('node:fs');
  if (process.argv.includes('--reset')) for (const f of [config.dbPath, config.dbPath + '-wal', config.dbPath + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
  const app = createApp();
  if (app.db.get('SELECT COUNT(*) c FROM users').c > 0 && !process.argv.includes('--reset')) { console.log('Baza bo‘sh emas. --reset bilan qayta yarating.'); process.exit(0); }
  await seed(app);
  app.db.close();
}
