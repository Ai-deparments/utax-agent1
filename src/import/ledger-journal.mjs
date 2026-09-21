/**
 * MOLIYA JURNALI (Excel) IMPORTI — "Молия Тизимлаш UTAX" formatidagi double-entry jurnal.
 *
 * QOIDA: tizimga faqat Excel'da yozilgan ma'lumot kiradi. Importer hech qanday qiymatni o'ylab topmaydi:
 *  - summa, sana, kontragent, yo'nalish, hisob (schyot) nomi — faqat fayldan;
 *  - faylda yo'q maydonlar (to'lov muddati, avans %, bo'lim, hisob raqami...) bo'sh qoladi;
 *  - aniqlab bo'lmagan qator import qilinmaydi — hisobotda "o'tkazib yuborildi" deb sababi bilan ko'rsatiladi.
 *
 * Ustunlar: A Dogovor No (operatsiya №) · B Sana · E To'lov kuni · F Valyuta · G Summa · H Shyot nomi · I Kontragent · J Napravleniye
 * Har operatsiya kamida 2 qator (debet/kredit, summalar qarama-qarshi ishorali). Pul qatorlari:
 *   Поступление БАНК / Поступление КАССА  → kirim;  Расход БАНК / Расход КАССА → chiqim;  Трансфер в КАССУ / Трансфер с БАНКА → ichki o'tkazma.
 * Juft qator (shu operatsiya №, qarama-qarshi summa) — pul nimaga ekanini bildiradi (Дебитор, з/п, НДС, ДИВИДЕНД ...).
 * Sotuv qatori (yo'nalish hisobi, manfiy summa, juftida Дебитор, sanasiz) — shartnoma + tan olingan daromad (jurnalda sotuv yozilgani uchun).
 */
import { excelDate } from '../core/export.mjs';
import { nowIso, round2, sha256 } from '../core/util.mjs';

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const low = (s) => norm(s).toLowerCase();

// Jurnaldagi yo'nalish (Napravleniye) → xizmat turi kodi
export const DIRECTION_SERVICE = { 'ревизия': 'REVISION', 'спорный': 'SPORNIY', 'консультация': 'CONSULTING', 'сопровождение': 'SUPPORT', 'экспресс': 'EXPRESS', 'аудит': 'AUDIT', 'прочий': 'OTHER' };
// Jurnaldagi xarajat hisobi nomi → xarajat kategoriyasi kodi (faqat aniq hisob nomlari; erkin matn — kategoriyasiz qoladi)
const EXPENSE_ACCOUNT = { 'з/п': 'PAYROLL', 'маркетинг': 'MARKETING', 'ндс': 'TAX', 'есп': 'TAX', 'подоходный налог': 'TAX', 'налог на прибыль': 'TAX', 'инпс': 'TAX', 'аренда': 'RENT', 'комиссия банка': 'BANK', 'адвокат': 'LEGAL', 'интернет': 'UTILITIES', 'мусор': 'UTILITIES', 'дидокс': 'SOFTWARE', 'услуга субподряд': 'SUBCONTRACT', 'корпоратив карта': 'OTHER', 'прочий': 'OTHER' };
// Xarajat bo'lmagan chiqimlar (P&L'ga kirmaydi)
function nonExpense(counter, counterparty) {
  const t = low(counter), cp = low(counterparty);
  if (t === 'дивиденд' || cp === 'учредитель') return { reason: 'DIVIDEND', cf: 'FINANCING', label: 'Dividend' };
  if (t.includes('займ')) return { reason: 'LOAN', cf: 'FINANCING', label: 'Qarz (заём)' };
  if (t.includes('возврат')) return { reason: 'REFUND', cf: 'OPERATING', label: 'Qaytarilgan mablag‘ (возврат)' };
  return null;
}
const MONEY = { 'поступление банк': ['BANK', 'INCOME'], 'поступление касса': ['CASH', 'INCOME'], 'расход банк': ['BANK', 'EXPENSE'], 'расход касса': ['CASH', 'EXPENSE'], 'трансфер в кассу': ['CASH', 'TRANSFER_IN'], 'трансфер с банка': ['BANK', 'TRANSFER_OUT'] };
const isDebtor = (h) => /^дебитор/.test(low(h));

/** Sarlavha qatorini topib, ustun indekslarini qaytaradi */
function header(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = Array.from(rows[i] || [], low);
    const col = (re) => r.findIndex((c) => re.test(c));
    const h = { no: col(/dogovor|№|^no$/), date: col(/^sana$/), pay: col(/to.?lov kuni/), cur: col(/valyuta/), sum: col(/^summa$/), acc: col(/shyot|schyot|hisob nomi/), cp: col(/kontragent/), dir: col(/napravlen|yo.?nalish/) };
    if (h.sum >= 0 && h.acc >= 0 && h.cp >= 0) return { idx: i, ...h };
  }
  return null;
}

/** Faylni tahlil qiladi (bazaga yozmaydi) → { ops, skipped, warnings, stats } */
export function parseLedger(rows) {
  const H = header(rows);
  if (!H) throw new Error('Jurnal sarlavhasi topilmadi (kerakli ustunlar: Summa, Shyot nomi, Kontragent)');
  const all = [];
  for (let i = H.idx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const amount = Number(r[H.sum]);
    if (!Number.isFinite(amount) || amount === 0 || !norm(r[H.acc])) continue;
    all.push({ row: i + 1, no: norm(r[H.no]), date: excelDate(r[H.date]) || null, payDate: excelDate(r[H.pay]) || null, cur: norm(H.cur >= 0 ? r[H.cur] : ''), amount: round2(amount), acc: norm(r[H.acc]), cp: norm(r[H.cp]), dir: norm(H.dir >= 0 ? r[H.dir] : '') });
  }
  const skipped = [], warnings = [];
  // Valyuta ko'rsatilgan blok — asosiy jurnaldan alohida namuna (USD, boshqa davr) — import qilinmaydi
  const rowsMain = all.filter((x) => { if (x.cur) { skipped.push({ row: x.row, reason: `Valyuta ustuni to‘ldirilgan (${x.cur}) — asosiy UZS jurnalidan alohida namuna blok`, acc: x.acc, cp: x.cp, amount: x.amount }); return false; } return true; });
  const used = new Set();
  const counterOf = (x) => rowsMain.find((y) => !used.has(y) && y !== x && y.no === x.no && Math.abs(y.amount + x.amount) < 0.01 && (y.payDate || null) === (x.payDate || null) && !MONEY[low(y.acc)]);
  const ops = [];
  // 1) Pul harakatlari
  for (const x of rowsMain) {
    const m = MONEY[low(x.acc)];
    if (!m || used.has(x)) continue;
    const [where, kind] = m;
    used.add(x);
    const date = x.payDate || x.date;
    if (!date) { skipped.push({ row: x.row, reason: 'Sana yo‘q', acc: x.acc, cp: x.cp, amount: x.amount }); continue; }
    if (date < '2000-01-01') warnings.push({ row: x.row, text: `Sana shubhali: ${date} (Excel’dagi qiymat o‘zgarishsiz olindi — tekshiring)` });
    if (kind === 'TRANSFER_IN' || kind === 'TRANSFER_OUT') { const pair = rowsMain.find((y) => y !== x && y.no === x.no && MONEY[low(y.acc)] && Math.abs(y.amount + x.amount) < 0.01); if (pair) used.add(pair); ops.push({ type: 'TRANSFER', no: x.no, date, amount: Math.abs(x.amount), cp: x.cp, rows: [x.row, pair?.row].filter(Boolean) }); continue; }
    const c = counterOf(x);
    if (c) used.add(c);
    ops.push({ type: kind === 'INCOME' ? 'RECEIPT' : 'PAYMENT', where, no: x.no, date, amount: Math.abs(x.amount), cp: x.cp, dir: x.dir || c?.dir || '', counter: c?.acc || '', counterCp: c?.cp || '', rows: [x.row, c?.row].filter(Boolean) });
  }
  // 2) Sotuvlar (yo'nalish hisobi manfiy + Дебитор juft, sanasiz)
  for (const x of rowsMain) {
    if (used.has(x) || isDebtor(x.acc) || x.amount >= 0) continue;
    const pair = rowsMain.find((y) => !used.has(y) && y !== x && y.no === x.no && isDebtor(y.acc) && Math.abs(y.amount + x.amount) < 0.01);
    if (!pair) continue;
    used.add(x); used.add(pair);
    ops.push({ type: 'SALE', no: x.no, amount: Math.abs(x.amount), cp: x.cp, dir: x.dir || pair.dir, account: x.acc, date: x.date || null, rows: [x.row, pair.row] });
  }
  for (const x of rowsMain) if (!used.has(x)) skipped.push({ row: x.row, reason: 'Juft qator topilmadi yoki turi aniqlanmadi', acc: x.acc, cp: x.cp, amount: x.amount });
  const sum = (t) => round2(ops.filter((o) => o.type === t).reduce((s, o) => s + o.amount, 0));
  return { ops, skipped, warnings, stats: { rows: all.length, sales: ops.filter((o) => o.type === 'SALE').length, sales_amount: sum('SALE'), receipts: ops.filter((o) => o.type === 'RECEIPT').length, receipts_amount: sum('RECEIPT'), payments: ops.filter((o) => o.type === 'PAYMENT').length, payments_amount: sum('PAYMENT'), transfers: ops.filter((o) => o.type === 'TRANSFER').length, transfers_amount: sum('TRANSFER') } };
}

/** Tahlil qilingan jurnalni bazaga yozadi. Qayta yuklansa, avval import qilingan operatsiyalar o'tkazib yuboriladi. */
export function importLedger(app, rows, ctx, { fileName = 'jurnal.xlsx' } = {}) {
  const { db, settings } = app;
  const S = app.services;
  const parsed = parseLedger(rows);
  db.exec('CREATE TABLE IF NOT EXISTS import_keys (key TEXT PRIMARY KEY, entity TEXT, entity_id INTEGER, file TEXT, created_at TEXT)');
  const seen = (key) => !!db.get('SELECT key FROM import_keys WHERE key=?', key);
  const mark = (key, entity, id) => db.run('INSERT OR IGNORE INTO import_keys (key, entity, entity_id, file, created_at) VALUES (?,?,?,?,?)', key, entity, id, fileName, nowIso());
  const keyOf = (o) => sha256(['ledger', o.type, o.no, o.date || '', o.amount, low(o.cp), low(o.counter || o.account || '')].join('|')).slice(0, 32);

  const bank = db.get('SELECT id FROM bank_accounts WHERE is_active=1 ORDER BY id LIMIT 1');
  const cash = db.get('SELECT id FROM cash_accounts WHERE is_active=1 ORDER BY id LIMIT 1');
  if (!bank) throw new Error('Bank hisobi yo‘q — avval Pul boshqaruvi sahifasida bank hisobini qo‘shing');
  if (!cash && parsed.ops.some((o) => o.where === 'CASH' || o.type === 'TRANSFER')) throw new Error('Kassa yo‘q — avval kassani qo‘shing');
  const st = Object.fromEntries(db.all('SELECT id, code FROM service_types').map((x) => [x.code, x.id]));
  const cat = Object.fromEntries(db.all('SELECT id, code FROM expense_categories').map((x) => [x.code, x.id]));
  const companyId = (name) => { const n = norm(name); const ex = db.get('SELECT id FROM companies WHERE name=?', n); return ex ? ex.id : db.insert('companies', { name: n, notes: `Excel: ${fileName}`, created_at: nowIso() }); };
  const res = { ...parsed.stats, created: { contracts: 0, bank: 0, cash: 0, expenses: 0 }, duplicates: 0, skipped: parsed.skipped, warnings: [...parsed.warnings], uncategorized: 0 };

  // Daromad tasdiq chegarasi — import paytida jurnalda allaqachon yozilgan sotuv qayta tasdiqqa tushmasin
  const thr = settings.get('revenue.approval_threshold');
  settings.set('revenue.approval_threshold', Number.MAX_SAFE_INTEGER, ctx.user?.id);
  const contractByClient = {};
  try {
    db.tx(() => {
      // Shartnoma sanasi = shu mijozdan jurnaldagi birinchi pul kelgan sana (sotuv qatorida sana yo'q)
      const firstReceipt = {};
      for (const o of parsed.ops) if (o.type === 'RECEIPT' && isDebtor(o.counter)) { const k = low(o.cp); if (!firstReceipt[k] || o.date < firstReceipt[k]) firstReceipt[k] = o.date; }
      for (const o of parsed.ops.filter((x) => x.type === 'SALE')) {
        const key = keyOf(o);
        if (seen(key)) { res.duplicates++; const ex = db.get('SELECT entity_id FROM import_keys WHERE key=?', key); contractByClient[low(o.cp)] = ex.entity_id; continue; }
        const code = DIRECTION_SERVICE[low(o.dir)] || DIRECTION_SERVICE[low(o.account)];
        const date = o.date || firstReceipt[low(o.cp)];
        if (!code || !st[code]) { res.skipped.push({ row: o.rows[0], reason: `Yo‘nalish aniqlanmadi: ${o.dir || o.account}`, acc: o.account, cp: o.cp, amount: o.amount }); continue; }
        if (!date) { res.skipped.push({ row: o.rows[0], reason: 'Sotuv sanasi yo‘q va mijozdan to‘lov ham yo‘q', acc: o.account, cp: o.cp, amount: o.amount }); continue; }
        const c = S.contracts.create({ company_id: companyId(o.cp), service_type_id: st[code], amount: o.amount, contract_date: date, title: `${o.account} — jurnal №${o.no}`, contract_status: 'ACTIVE', service_status: 'COMPLETED', comments: `Excel: ${fileName}, qatorlar ${o.rows.join(', ')}` }, ctx);
        db.run('UPDATE contracts SET service_completed_at=? WHERE id=?', date, c.id);
        S.revenue.recognize({ contract_id: c.id, amount: o.amount, date, method: 'LEDGER', ctx, note: `Jurnaldagi sotuv yozuvi (${o.account}), qatorlar ${o.rows.join(', ')}`, silent: true });
        mark(key, 'contract', c.id); contractByClient[low(o.cp)] = c.id; res.created.contracts++;
      }
      for (const o of parsed.ops.filter((x) => x.type !== 'SALE').sort((a, b) => a.date.localeCompare(b.date))) {
        const key = keyOf(o);
        if (seen(key)) { res.duplicates++; continue; }
        const note = `Excel ${fileName}: qatorlar ${o.rows.join(', ')}`;
        if (o.type === 'TRANSFER') {
          const t = S.banking.createTransaction({ bank_account_id: bank.id, tx_date: o.date, amount: o.amount, direction: 'EXPENSE', counterparty_name: o.cp || 'Kassa', purpose: `Bankdan kassaga o‘tkazma. ${note}`, cf_class: 'TRANSFER', external_id: key }, ctx, { source: 'IMPORT', skipMatch: true });
          if (t.id) S.reconciliation.ignore(t.id, ctx, 'TRANSFER', 'TRANSFER');
          db.insert('cash_transactions', { cash_account_id: cash.id, tx_date: o.date, amount: o.amount, direction: 'INCOME', counterparty_name: o.cp || 'Bank', purpose: `Bankdan kassaga o‘tkazma. ${note}`, cf_class: 'TRANSFER', created_by: ctx.user?.id || null, created_at: nowIso() });
          mark(key, 'transfer', t.id || null); res.created.bank++; res.created.cash++; continue;
        }
        const cid = contractByClient[low(o.cp)];
        if (o.type === 'RECEIPT') {
          const purpose = `${o.counter || 'Kirim'}${o.dir ? ' · ' + o.dir : ''}. ${note}`;
          if (o.where === 'BANK') {
            const t = S.banking.createTransaction({ bank_account_id: bank.id, tx_date: o.date, amount: o.amount, direction: 'INCOME', counterparty_name: o.cp, purpose, external_id: key }, ctx, { source: 'IMPORT', skipMatch: true });
            if (t.id && cid && isDebtor(o.counter)) S.reconciliation.confirm(t.id, cid, ctx, { reason: 'Excel jurnali: Дебитор yopildi' });
            else if (t.id) S.reconciliation.ignore(t.id, ctx, 'NON_CONTRACT', 'OPERATING');
            mark(key, 'bank_transaction', t.id || null); res.created.bank++;
          } else {
            const id = db.insert('cash_transactions', { cash_account_id: cash.id, tx_date: o.date, amount: o.amount, direction: 'INCOME', counterparty_name: o.cp, purpose, contract_id: cid && isDebtor(o.counter) ? cid : null, created_by: ctx.user?.id || null, created_at: nowIso() });
            if (cid && isDebtor(o.counter)) {
              const pid = db.insert('payments', { contract_id: cid, amount: o.amount, paid_at: o.date, source: 'CASH', cash_transaction_id: id, created_by: ctx.user?.id || null, created_at: nowIso() });
              S.revenue.onPaymentRecorded(db.get('SELECT * FROM payments WHERE id=?', pid), ctx);
              S.contracts.recompute(cid);
            }
            mark(key, 'cash_transaction', id); res.created.cash++;
          }
          continue;
        }
        // PAYMENT (chiqim)
        const ne = nonExpense(o.counter, o.cp);
        const text = o.counter && low(o.counter) !== low(o.cp) ? `${o.counter} — ${o.cp}` : (o.counter || o.cp);
        if (o.where === 'BANK') {
          const t = S.banking.createTransaction({ bank_account_id: bank.id, tx_date: o.date, amount: o.amount, direction: 'EXPENSE', counterparty_name: o.cp, purpose: `${text}. ${note}`, cf_class: ne?.cf || 'OPERATING', external_id: key }, ctx, { source: 'IMPORT', skipMatch: true });
          if (!t.id) { res.duplicates++; continue; }
          if (ne) S.reconciliation.ignore(t.id, ctx, ne.reason, ne.cf);
          else {
            const cc = EXPENSE_ACCOUNT[low(o.counter)];
            const x = S.expenses.createDirect({ expense_date: o.date, amount: o.amount, purpose: text, counterparty: o.cp, payment_method: 'BANK', status: 'APPROVED', category_id: cc ? cat[cc] : null }, ctx);
            if (!cc) { db.run("UPDATE expenses SET category_id=NULL, category_source='IMPORT_UNCATEGORIZED' WHERE id=?", x.id); res.uncategorized++; }
            S.reconciliation.confirmExpense(t.id, x.id, ctx);
            res.created.expenses++;
          }
          mark(key, 'bank_transaction', t.id); res.created.bank++;
        } else {
          const id = db.insert('cash_transactions', { cash_account_id: cash.id, tx_date: o.date, amount: o.amount, direction: 'EXPENSE', counterparty_name: o.cp, purpose: `${text}. ${note}`, cf_class: ne?.cf || 'OPERATING', created_by: ctx.user?.id || null, created_at: nowIso() });
          if (!ne) {
            const cc = EXPENSE_ACCOUNT[low(o.counter)];
            const x = S.expenses.createDirect({ expense_date: o.date, amount: o.amount, purpose: text, counterparty: o.cp, payment_method: 'CASH', status: 'APPROVED', category_id: cc ? cat[cc] : null }, ctx);
            if (!cc) { db.run("UPDATE expenses SET category_id=NULL, category_source='IMPORT_UNCATEGORIZED' WHERE id=?", x.id); res.uncategorized++; }
            db.run('UPDATE cash_transactions SET expense_id=? WHERE id=?', x.id, id);
            S.expenses.markPaid(x.id, { cash_transaction_id: id, paid_at: o.date }, ctx);
            res.created.expenses++;
          }
          mark(key, 'cash_transaction', id); res.created.cash++;
        }
      }
    });
  } finally {
    settings.set('revenue.approval_threshold', thr, ctx.user?.id);
  }
  S.contracts.recomputeAll?.();
  return res;
}
