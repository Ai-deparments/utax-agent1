/**
 * UTAX Excel moliya jurnali (ikki yozuvli: + debet, − kredit) → import rejasi (bazaga yozmaydi).
 *
 * QOIDA: hech narsa o'ylab topilmaydi. Excel'da aniq qiymat bo'lmasa — null (ko'rsatishda '--').
 *  - Sana faqat o'sha qatorning o'z ustunidan olinadi (boshqa qator/ustundan hosila qilinmaydi).
 *  - Kategoriya faqat Excel hisob nomi (Shyot nomi) aynan ma'lum xaritada bo'lsa; erkin matn — kategoriyasiz.
 *  - Valyuta/kurs taxmin qilinmaydi: bazaviy valyutadan boshqa qator — xato.
 *
 * Jurnal tuzilishi (tekshirilgan): har "Dogovor No" guruhi nolga yopiladi.
 *  - Shartnoma guruhi: sotuv qatori (Shyot = xizmat turi, −) + Дебитор (+) + tushum(lar) (Поступление БАНК|КАССА, +) + Дебитор (−).
 *  - Oddiy operatsiya: 2 qator — pul qatori (Поступление/Расход БАНК|КАССА) + modda (hisob nomi yoki erkin matn).
 *  - Ichki o'tkazma: Трансфер с БАНКА (−) + Трансфер в КАССУ (+).
 *  - Boshqa (turizm) shablonidan qolgan namuna qatorlari (Operator/Bron/Uchish… to'ldirilgan) — o'tkazib yuboriladi.
 */
import crypto from 'node:crypto';
import { readXlsx, colLetters } from './xlsx-reader.mjs';

export const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const keyOf = (s) => norm(s).toLowerCase().replace(/ё/g, 'е');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Sarlavha → maydon (kalit: kichik harf, harf/raqamdan boshqasi olib tashlangan) */
const HEADER = {
  dogovorno: 'no', sana: 'sana', uchishkuni: 'uchish', qaytishkuni: 'qaytish', tolovkuni: 'tolov', valyuta: 'valyuta', summa: 'summa',
  shyotnomi: 'shyot', kontragent: 'kontragent', napravleniye: 'napr', operator: 'operator', transaksiyaraqami: 'trans', kurs: 'kurs', summausd: 'summa_usd', bronnomer: 'bron',
};
const hdrKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9а-яё]/g, '');
/** Turizm shabloniga xos ustunlar — haqiqiy UTAX qatorlarida bo'sh */
const TEMPLATE_COLS = ['uchish', 'qaytish', 'operator', 'trans', 'bron'];
/** Faqat shablon qatorlarida uchraydigan hisoblar (Excel qator 2–11 dalili) */
export const TEMPLATE_ACCOUNTS = new Set(['продажы - тур', 'продажы - сопровождение', 'дебиторка клиентов аудит', 'дебиторка клиентов сопровождение', 'наличные usd']);

/** Pul hisoblari: qaysi hisob (bank/kassa), yo'nalish, kutilgan ishora */
export const MONEY = {
  'поступление банк': { side: 'BANK', dir: 'INCOME', sign: 1 },
  'поступление касса': { side: 'CASH', dir: 'INCOME', sign: 1 },
  'расход банк': { side: 'BANK', dir: 'EXPENSE', sign: -1 },
  'расход касса': { side: 'CASH', dir: 'EXPENSE', sign: -1 },
  'трансфер с банка': { side: 'BANK', dir: 'EXPENSE', sign: -1, transfer: true },
  'трансфер в кассу': { side: 'CASH', dir: 'INCOME', sign: 1, transfer: true },
};
const DEBITOR = { 'дебитор': 'CLIENT', 'дебиторы другие': 'OTHER' };

/**
 * Xarajat kategoriyalari — faqat Excel bank blokidagi hisob nomlari (kalit — registrsiz). pnl_group — nomdan bevosita
 * ko'rinadigan tizim tasnifi (konfiguratsiya, Excel ma'lumoti emas); `question` — hisobotda ochiq savol.
 */
export const CATEGORY_MAP = {
  'з/п': { pnl_group: 'PAYROLL' },
  'ндс': { pnl_group: 'TAX', question: 'НДС P&L xarajatimi (QQS hisobi)?' },
  'есп': { pnl_group: 'TAX', question: 'ЕСП — Soliqlar (TAX) yoki oylik (PAYROLL)?' },
  'инпс': { pnl_group: 'TAX', question: 'ИНПС — Soliqlar (TAX) yoki oylik (PAYROLL)?' },
  'подоходный налог': { pnl_group: 'TAX', question: 'Подоходный налог — Soliqlar (TAX) yoki oylik (PAYROLL)?' },
  'налог на прибыль': { pnl_group: 'TAX' },
  'аренда': { pnl_group: 'OFFICE' },
  'мусор': { pnl_group: 'OFFICE' },
  'маркетинг': { pnl_group: 'MARKETING' },
  'интернет': { pnl_group: 'IT' },
  'дидокс': { pnl_group: 'IT' },
  'комиссия банка': { pnl_group: 'ADMIN' },
  'адвокат': { pnl_group: 'ADMIN', question: 'Адвокат — ma’muriy (ADMIN) yoki to‘g‘ridan-to‘g‘ri (DIRECT) xarajat?' },
  'услуга субподряд': { pnl_group: 'DIRECT', is_direct_cost: 1, question: 'Услуга субподряд qaysi shartnomalarga tegishli (Excel’da yo‘q)?' },
  'прочий': { pnl_group: 'OTHER_OPEX' },
  'корпоратив карта': { pnl_group: 'OTHER_OPEX', question: 'Корпоратив карта — xarajatmi yoki korporativ karta hisobiga ichki o‘tkazmami?' },
};

/** Xarajat bo'lmagan moddalar (hisob nomidan aniq) */
function nonExpenseKind(accountKey) {
  if (accountKey === 'дивиденд') return { kind: 'DIVIDEND', cf_class: 'FINANCING', ignore_reason: 'DIVIDEND' };
  if (accountKey.replace(/\s/g, '') === 'фин.займ') return { kind: 'LOAN', cf_class: 'UNCLASSIFIED', ignore_reason: 'LOAN', question: 'фин.займ — qarz berildimi (INVESTING) yoki olingan qarz qaytarildimi (FINANCING)? Kimga?' };
  if (/(^|[\s.,;:])возврат($|[\s.,;:])/.test(accountKey)) return { kind: 'REFUND', cf_class: 'UNCLASSIFIED', ignore_reason: 'REFUND', question: 'возврат — qaysi mijozga, qaysi shartnoma bo‘yicha? Daromadni kamaytiradimi?' };
  return null;
}

/** Excel serial yoki matn → ISO sana; tushunarsiz → undefined (null emas — "yo'q" bilan "xato" farqlanadi) */
function toIsoDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
  }
  const s = norm(v);
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  m = /^(\d{2})[./](\d{2})[./](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return undefined;
}
const plausible = (iso) => !!iso && Number(iso.slice(0, 4)) >= 2000 && Number(iso.slice(0, 4)) <= 2100;

/**
 * @param {Buffer} buf  XLSX fayl
 * @param {{ fileName?: string, sheet?: string, baseCurrency?: string }} opts
 */
export function parseJournal(buf, { fileName = null, sheet, baseCurrency = 'UZS', dateFixes = {} } = {}) {
  const book = readXlsx(buf, { sheet });
  const plan = {
    meta: { file: fileName, sha256: crypto.createHash('sha256').update(buf).digest('hex'), sheet: book.sheet, sheets: book.sheets, excel_rows: book.rows.length, header_row: null, key_prefix: null, period: null, base_currency: baseCurrency },
    contracts: [], incomes: [], expenses: [], nonExpenses: [], transfers: [],
    quarantine: [], skipped: [], errors: [], warnings: [], questions: [],
    accountTotals: {}, excelTotals: {},
  };
  const err = (rows, no, message) => plan.errors.push({ rows, no, message });
  const warn = (rows, no, message) => plan.warnings.push({ rows, no, message });

  // 1) Sarlavha
  const hi = book.rows.findIndex((x) => x.cells.some((c) => hdrKey(c?.v) === 'dogovorno'));
  if (hi < 0) { err([], null, 'Sarlavha qatori ("Dogovor No") topilmadi'); return plan; }
  const header = book.rows[hi];
  plan.meta.header_row = header.r;
  const col = {};
  header.cells.forEach((c, i) => { const f = HEADER[hdrKey(c?.v)]; if (f && col[f] === undefined) col[f] = i; });
  for (const f of ['no', 'tolov', 'summa', 'shyot']) if (col[f] === undefined) err([header.r], null, `Majburiy ustun topilmadi: ${f}`);
  if (plan.errors.length) return plan;
  plan.meta.columns = Object.fromEntries(Object.entries(col).map(([f, i]) => [f, colLetters(i)]));

  // 2) Qatorlarni normallashtirish
  const recs = [];
  const val = (row, f) => (col[f] === undefined ? null : row.cells[col[f]]?.v ?? null);
  const filled = (row, f) => { const v = val(row, f); return v !== null && v !== '' && !(typeof v === 'string' && !norm(v)); };
  // Qator raqamlari ketma-ketligidagi bo'shliqlar (XML'da yo'q qatorlar) — hisobot uchun
  const data = book.rows.slice(hi + 1);
  let prev = header.r;
  const gaps = [];
  for (const row of data) { if (row.r > prev + 1) gaps.push(prev + 1 === row.r - 1 ? String(prev + 1) : `${prev + 1}-${row.r - 1}`); prev = row.r; }
  if (gaps.length) plan.skipped.push({ rows: gaps.join(', '), reason: 'Bo‘sh ajratuvchi qatorlar (faylda umuman yo‘q)', count: 0 });
  const template = [];
  for (const row of data) {
    const hasAny = ['no', 'summa', 'shyot', 'kontragent', 'tolov'].some((f) => filled(row, f));
    if (!hasAny) continue;
    const account = norm(val(row, 'shyot'));
    const akey = keyOf(account);
    const tmplCols = TEMPLATE_COLS.filter((f) => filled(row, f));
    if (TEMPLATE_ACCOUNTS.has(akey) || tmplCols.length) {
      template.push({ r: row.r, reason: tmplCols.length ? `shablon ustunlari to‘ldirilgan (${tmplCols.join(', ')})` : `shablon hisobi "${account}"` });
      continue;
    }
    const rawNo = val(row, 'no');
    const no = typeof rawNo === 'number' ? rawNo : /^\d+$/.test(norm(rawNo)) ? Number(norm(rawNo)) : NaN;
    if (!Number.isInteger(no) || no <= 0) { err([row.r], null, `Dogovor No noto‘g‘ri: ${JSON.stringify(rawNo)}`); continue; }
    const summa = val(row, 'summa');
    if (typeof summa !== 'number' || !Number.isFinite(summa) || summa === 0) { err([row.r], no, `Summa son emas yoki 0: ${JSON.stringify(summa)}`); continue; }
    const cur = norm(val(row, 'valyuta'));
    if (cur && cur.toUpperCase() !== String(baseCurrency).toUpperCase()) { err([row.r], no, `Valyuta "${cur}" — faqat ${baseCurrency} import qilinadi (kurs taxmin qilinmaydi)`); continue; }
    if (filled(row, 'kurs') || filled(row, 'summa_usd')) { err([row.r], no, 'Kurs / Summa USD to‘ldirilgan — valyuta konvertatsiyasi taxmin qilinmaydi'); continue; }
    if (!account) { err([row.r], no, 'Shyot nomi bo‘sh'); continue; }
    const tolovRaw = val(row, 'tolov');
    let date = toIsoDate(tolovRaw);
    if (date === undefined) { err([row.r], no, `To‘lov kuni tushunarsiz: ${JSON.stringify(tolovRaw)}`); continue; }
    // Foydalanuvchi qo'lda tasdiqlagan sana tuzatishi (--fix-date qator=YYYY-MM-DD) — hisobotda ko'rsatiladi
    if (dateFixes[row.r]) { warn([row.r], no, `To‘lov kuni foydalanuvchi tasdig‘i bilan tuzatildi: ${date ?? '--'} → ${dateFixes[row.r]}`); date = dateFixes[row.r]; }
    const sanaRaw = val(row, 'sana');
    const sana = toIsoDate(sanaRaw);
    if (sana === undefined) { err([row.r], no, `Sana tushunarsiz: ${JSON.stringify(sanaRaw)}`); continue; }
    recs.push({ r: row.r, no, date, sana, amount: round2(summa), account, akey, kontragent: norm(val(row, 'kontragent')) || null, napr: norm(val(row, 'napr')) || null });
    const t = (plan.accountTotals[akey] ??= { account, rows: 0, total: 0 });
    t.rows++; t.total = round2(t.total + round2(summa));
  }
  if (template.length) plan.skipped.push({ rows: template.map((x) => x.r).join(', '), reason: 'Boshqa (turizm) shablonidan qolgan namuna — UTAX ma’lumoti emas: ' + [...new Set(template.map((x) => x.reason))].join('; '), count: template.length });

  // 3) Guruhlash (Dogovor No)
  const groups = new Map();
  for (const x of recs) { if (!groups.has(x.no)) groups.set(x.no, []); groups.get(x.no).push(x); }
  const counterRows = [];
  const planned = [];
  // Bitta yozuvli jurnal (har operatsiya bitta qator, summa musbat, yo'nalish hisob nomida) — alohida tahlil
  if (isSingleEntry(recs)) { plan.meta.format = 'SINGLE_ENTRY'; planSingleEntry(groups, planned, plan, err, warn); }
  else plan.meta.format = 'DOUBLE_ENTRY';
  for (const [no, rows] of plan.meta.format === 'SINGLE_ENTRY' ? [] : [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const rn = rows.map((x) => x.r);
    const total = round2(rows.reduce((s, x) => s + x.amount, 0));
    if (Math.abs(total) > 0.009) { err(rn, no, `Guruh nolga yopilmaydi (Σ = ${total})`); continue; }
    const bad = rows.find((x) => x.date && !plausible(x.date));
    if (bad) {
      const amt = round2(rows.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0));
      plan.quarantine.push({ no, rows: rn, amount: amt, account: rows.find((x) => !MONEY[x.akey])?.account || rows[0].account, date: bad.date, reason: `Sana xato (${bad.date}) — tasdiq kerak, yozilmadi` });
      continue;
    }
    const money = rows.filter((x) => MONEY[x.akey]);
    const deb = rows.filter((x) => DEBITOR[x.akey]);
    const other = rows.filter((x) => !MONEY[x.akey] && !DEBITOR[x.akey]);
    for (const m of money) {
      const spec = MONEY[m.akey];
      if (Math.sign(m.amount) !== spec.sign) { err([m.r], no, `"${m.account}" ishorasi kutilganidek emas (${m.amount})`); }
      if (!m.date) err([m.r], no, `"${m.account}" qatorida To‘lov kuni yo‘q`);
    }
    if (plan.errors.some((e) => e.no === no)) continue;
    const sale = other.filter((x) => x.amount < 0);
    // A) Shartnoma
    if (sale.length === 1 && deb.some((x) => x.akey === 'дебитор' && x.amount > 0)) {
      const s = sale[0];
      const debPlus = round2(deb.filter((x) => x.amount > 0).reduce((a, x) => a + x.amount, 0));
      const pays = money.filter((x) => MONEY[x.akey].dir === 'INCOME' && !MONEY[x.akey].transfer);
      const debMinus = round2(-deb.filter((x) => x.amount < 0).reduce((a, x) => a + x.amount, 0));
      const paid = round2(pays.reduce((a, x) => a + x.amount, 0));
      const problems = [];
      if (other.length !== 1) problems.push('ortiqcha modda qatorlari');
      if (deb.some((x) => x.akey !== 'дебитор')) problems.push('Дебиторы ДРУГИЕ shartnoma guruhida');
      if (money.length !== pays.length) problems.push('shartnoma guruhida chiqim/transfer qatori');
      if (Math.abs(debPlus + s.amount) > 0.009) problems.push(`Дебитор (+${debPlus}) sotuv summasiga (${-s.amount}) teng emas`);
      if (Math.abs(debMinus - paid) > 0.009) problems.push(`Дебитор (−${debMinus}) tushumlarga (${paid}) teng emas`);
      if (paid - -s.amount > 0.009) problems.push('tushum shartnoma summasidan katta');
      const names = new Set(rows.map((x) => keyOf(x.kontragent)));
      if (names.size !== 1 || !s.kontragent) problems.push('Kontragent guruh ichida bir xil emas yoki bo‘sh');
      for (const p of pays) { const d = deb.find((x) => x.amount < 0 && Math.abs(x.amount + p.amount) < 0.009 && x.date === p.date); if (!d) problems.push(`tushum (qator ${p.r}) uchun juft Дебитор (−) topilmadi`); }
      if (problems.length) { err(rn, no, 'Shartnoma tuzilmasi buzilgan: ' + problems.join('; ')); continue; }
      if (s.napr && keyOf(s.napr) !== s.akey) warn([s.r], no, `Napravleniye "${s.napr}" Shyot "${s.account}" dan farq qiladi — xizmat turi Shyot bo‘yicha olindi`);
      counterRows.push(...deb.map((x) => x.r));
      planned.push({ type: 'contract', no, rows: rn, item: { no, rows: rn, sale_row: s.r, company: s.kontragent, service: s.account, service_key: s.akey, amount: round2(-s.amount), contract_date: s.sana || null,
        payments: pays.map((p) => ({ row: p.r, pair_row: deb.find((x) => x.amount < 0 && Math.abs(x.amount + p.amount) < 0.009 && x.date === p.date)?.r, side: MONEY[p.akey].side, date: p.date, amount: p.amount, counterparty: p.kontragent, purpose: p.napr || s.account })) } });
      continue;
    }
    // B) Ichki o'tkazma
    if (rows.length === 2 && money.length === 2 && money.every((x) => MONEY[x.akey].transfer)) {
      const out = money.find((x) => MONEY[x.akey].dir === 'EXPENSE'), inc = money.find((x) => MONEY[x.akey].dir === 'INCOME');
      if (!out || !inc || MONEY[out.akey].side === MONEY[inc.akey].side || out.date !== inc.date) { err(rn, no, 'Transfer tuzilmasi buzilgan (bir tomon/sana)'); continue; }
      planned.push({ type: 'transfer', no, rows: rn, item: { no, rows: rn, date: inc.date, amount: inc.amount, from: MONEY[out.akey].side, to: MONEY[inc.akey].side, from_row: out.r, to_row: inc.r, counterparty: inc.kontragent || out.kontragent, purpose: `${out.account} → ${inc.account}` } });
      continue;
    }
    // C) Oddiy operatsiya (pul qatori + modda)
    if (rows.length === 2 && money.length === 1 && !MONEY[money[0].akey].transfer) {
      const m = money[0], c = rows.find((x) => x !== m), spec = MONEY[m.akey];
      if (m.date !== c.date) { err(rn, no, `Juft qatorlar sanasi har xil (${m.date} / ${c.date})`); continue; }
      if (keyOf(m.kontragent) !== keyOf(c.kontragent)) warn(rn, no, `Kontragent juftda farq qiladi ("${m.kontragent}" / "${c.kontragent}") — pul qatoridagisi olindi`);
      const base = { no, rows: rn, money_row: m.r, row: c.r, side: spec.side, date: m.date, amount: Math.abs(m.amount), counterparty: m.kontragent || c.kontragent, account: c.account, account_key: c.akey };
      if (spec.dir === 'INCOME') {
        if (DEBITOR[c.akey]) {
          counterRows.push(c.r);
          const client = DEBITOR[c.akey] === 'CLIENT';
          planned.push({ type: 'income', no, rows: rn, item: { ...base, kind: client ? 'CLIENT_DEBTOR' : 'OTHER_DEBTOR', purpose: c.napr || m.napr || c.account, cf_class: client ? 'OPERATING' : 'UNCLASSIFIED', debtor_account: c.account } });
          if (!client) plan.questions.push(`${c.account} (No ${no}, ${m.kontragent || ''}, ${Math.abs(m.amount)}): qarz qaytishimi? Pul oqimi turi (cf_class) qaysi?`);
        } else {
          planned.push({ type: 'income', no, rows: rn, item: { ...base, kind: 'OTHER', purpose: c.account, cf_class: 'UNCLASSIFIED' } });
          plan.questions.push(`Shartnomasiz kirim "${c.account}" (No ${no}): qanday tasniflanadi?`);
        }
        continue;
      }
      if (DEBITOR[c.akey]) { err(rn, no, `Chiqim + ${c.account} — tushunarsiz tuzilma (avans/qarz berish?), qo‘lda ko‘rib chiqing`); continue; }
      const ne = nonExpenseKind(c.akey);
      if (ne) {
        planned.push({ type: 'nonExpense', no, rows: rn, item: { ...base, ...ne, purpose: c.account } });
        continue;
      }
      const cat = CATEGORY_MAP[c.akey] ? c.akey : null;
      if (!cat && spec.side === 'BANK') warn(rn, no, `Bank bloki hisobi "${c.account}" kategoriya xaritasida yo‘q — kategoriyasiz yozildi`);
      planned.push({ type: 'expense', no, rows: rn, item: { ...base, purpose: c.account, category_key: cat, category_name: cat ? c.account : null } });
      continue;
    }
    err(rn, no, `Tushunarsiz tuzilma (${rows.length} qator: ${rows.map((x) => x.account).join(' | ')})`);
  }
  if (counterRows.length) plan.skipped.push({ rows: compactRows(counterRows), reason: 'Qarama-qarshi Дебитор / Дебиторы ДРУГИЕ qatorlari — alohida yozuv emas, faqat juftlik tekshiruvi (debitorlik shartnoma − to‘lovlardan hisoblanadi)', count: counterRows.length });

  // 4) Idempotentlik kaliti: barcha operatsiya sanalari bir oyda bo'lsa XLS-YYYY-MM, aks holda fayl xeshi
  const months = new Set();
  for (const p of planned) for (const r of p.rows) { const d = recs.find((x) => x.r === r)?.date; if (d) months.add(d.slice(0, 7)); }
  const prefix = months.size === 1 ? `XLS-${[...months][0]}` : `XLS-${plan.meta.sha256.slice(0, 8)}`;
  plan.meta.key_prefix = prefix;
  plan.meta.period = months.size === 1 ? [...months][0] : [...months].sort().join(', ') || null;
  for (const p of planned) {
    const key = `${prefix}-${p.no}`;
    const trace = `[${key} · qator ${p.rows.join('/')}]`;
    const it = { ...p.item, key, trace };
    if (p.type === 'contract') { it.payments = it.payments.map((x, i, arr) => ({ ...x, key: arr.length > 1 ? `${key}.${i + 1}` : key, trace: `[${arr.length > 1 ? `${key}.${i + 1}` : key} · qator ${[x.row, x.pair_row].filter(Boolean).join('/')}]` })); plan.contracts.push(it); }
    else if (p.type === 'transfer') plan.transfers.push(it);
    else if (p.type === 'income') plan.incomes.push(it);
    else if (p.type === 'nonExpense') { plan.nonExpenses.push(it); if (it.question) plan.questions.push(`${it.question} (No ${it.no}, ${it.amount})`); }
    else plan.expenses.push(it);
  }
  for (const k of new Set(plan.expenses.filter((e) => e.category_key && CATEGORY_MAP[e.category_key].question).map((e) => e.category_key))) plan.questions.push(CATEGORY_MAP[k].question);
  if (plan.expenses.some((e) => !e.category_key)) plan.questions.push(`Kategoriyasiz xarajatlar (${plan.expenses.filter((e) => !e.category_key).length} ta, ${round2(plan.expenses.filter((e) => !e.category_key).reduce((s, e) => s + e.amount, 0))}): Excel’da kategoriya yo‘q — har biriga kategoriya tasdiqlansinmi?`);
  plan.excelTotals = excelTotals(plan);
  return plan;
}

/**
 * Bitta yozuvli jurnal hisob nomi: "Договор" | "Поступление БАНК|КАССА" | "Расход Банк|Касса <modda>" | "Расход Трансфер в КАССУ".
 * → { kind: 'CONTRACT' } | { kind: 'MONEY', side, dir, item } | { kind: 'TRANSFER', from, to } | null
 */
export function singleEntryAccount(account) {
  const a = norm(account), k = keyOf(a);
  if (k === 'договор') return { kind: 'CONTRACT' };
  const t = /^(?:расход\s+)?трансфер\s+в\s+кассу$/.exec(k);
  if (t) return { kind: 'TRANSFER', from: 'BANK', to: 'CASH' };
  const m = /^(поступление|расход)\s+(банк|касса)(?:\s+|$)/.exec(k);
  if (!m) return null;
  return { kind: 'MONEY', side: m[2] === 'банк' ? 'BANK' : 'CASH', dir: m[1] === 'расход' ? 'EXPENSE' : 'INCOME', item: norm(a.slice(m[0].length)) || null };
}

/** Bitta yozuvli format: Дебитор juftlari yo'q, barcha summalar musbat, "Договор" yoki "<pul hisobi> <modda>" qatorlari bor */
function isSingleEntry(recs) {
  if (!recs.length || recs.some((x) => DEBITOR[x.akey] || x.amount < 0)) return false;
  return recs.some((x) => { const s = singleEntryAccount(x.account); return s && (s.kind === 'CONTRACT' || (s.kind === 'MONEY' && s.item)); });
}

/**
 * Bitta yozuvli jurnal → reja elementlari (planned). Hech narsa o'ylab topilmaydi:
 *  - "Договор" qatori — shartnoma (summa, kontragent, yo'nalish faylda); sana faylda yo'q → null.
 *  - Shu No va shu kontragentli "Поступление" qatorlari — o'sha shartnoma to'lovlari.
 *  - "Расход Банк <modda>" — modda nomi (з/п, НДС ...) kategoriya xaritasi / dividend / qarz / qaytarim bo'yicha tasniflanadi.
 *  - "Расход Касса <erkin matn>" — kategoriyasiz xarajat (matn o'zgarishsiz izoh bo'ladi).
 */
function planSingleEntry(groups, planned, plan, err, warn) {
  for (const [no, rows] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const rn = rows.map((x) => x.r);
    const typed = rows.map((x) => ({ ...x, se: singleEntryAccount(x.account) }));
    const unknown = typed.filter((x) => !x.se);
    if (unknown.length) { err(unknown.map((x) => x.r), no, `Hisob nomi tanilmadi: ${unknown.map((x) => `"${x.account}"`).join(', ')}`); continue; }
    const noDate = typed.find((x) => x.se.kind !== 'CONTRACT' && !x.date);
    if (noDate) { err([noDate.r], no, `"${noDate.account}" qatorida To‘lov kuni yo‘q`); continue; }
    const bad = typed.find((x) => x.date && !plausible(x.date));
    if (bad) {
      plan.quarantine.push({ no, rows: rn, amount: round2(rows.reduce((s, x) => s + x.amount, 0)), account: bad.account, date: bad.date, reason: `Sana xato (${bad.date}) — tasdiq kerak, yozilmadi` });
      continue;
    }
    const contracts = typed.filter((x) => x.se.kind === 'CONTRACT');
    // A) Shartnoma + uning tushumlari
    if (contracts.length) {
      const s = contracts[0];
      const pays = typed.filter((x) => x.se.kind === 'MONEY' && x.se.dir === 'INCOME');
      const problems = [];
      if (contracts.length > 1) problems.push('bitta No da bir nechta "Договор" qatori');
      if (pays.length + contracts.length !== typed.length) problems.push('shartnoma guruhida chiqim/transfer qatori');
      if (!s.kontragent) problems.push('Kontragent bo‘sh');
      if (pays.some((p) => keyOf(p.kontragent) !== keyOf(s.kontragent))) problems.push('tushum kontragenti shartnomanikidan farq qiladi');
      if (!s.napr) problems.push('Napravleniye (xizmat turi) bo‘sh');
      const paid = round2(pays.reduce((a, x) => a + x.amount, 0));
      if (paid - s.amount > 0.009) problems.push(`tushum (${paid}) shartnoma summasidan (${s.amount}) katta`);
      if (problems.length) { err(rn, no, 'Shartnoma tuzilmasi buzilgan: ' + problems.join('; ')); continue; }
      planned.push({ type: 'contract', no, rows: rn, item: { no, rows: rn, sale_row: s.r, company: s.kontragent, service: s.napr, service_key: keyOf(s.napr), amount: s.amount, contract_date: s.sana || null,
        payments: pays.map((p) => ({ row: p.r, pair_row: null, side: p.se.side, date: p.date, amount: p.amount, counterparty: p.kontragent, purpose: p.napr || s.napr })) } });
      continue;
    }
    if (typed.length !== 1) { err(rn, no, `Tushunarsiz tuzilma (${typed.length} qator: ${typed.map((x) => x.account).join(' | ')})`); continue; }
    const x = typed[0];
    // B) Ichki o'tkazma (bank → kassa)
    if (x.se.kind === 'TRANSFER') {
      planned.push({ type: 'transfer', no, rows: rn, item: { no, rows: rn, date: x.date, amount: x.amount, from: x.se.from, to: x.se.to, from_row: x.r, to_row: x.r, counterparty: x.kontragent, purpose: x.account } });
      continue;
    }
    const base = { no, rows: rn, money_row: x.r, row: x.r, side: x.se.side, date: x.date, amount: x.amount, counterparty: x.kontragent };
    // C) Shartnomasiz kirim
    if (x.se.dir === 'INCOME') {
      const purpose = [x.se.item, x.napr].filter(Boolean).join(' · ') || x.account;
      planned.push({ type: 'income', no, rows: rn, item: { ...base, account: x.account, account_key: x.akey, kind: 'OTHER', purpose, cf_class: 'UNCLASSIFIED' } });
      plan.questions.push(`Shartnomasiz kirim "${x.kontragent || x.account}" (No ${no}, ${x.amount}): qanday tasniflanadi?`);
      continue;
    }
    // D) Chiqim: modda nomi — hisobning o'zida ("Расход Банк з/п"), bo'lmasa kontragent ustunida
    const item = x.se.item || x.kontragent;
    if (!item) { err(rn, no, `"${x.account}" — chiqim moddasi yo‘q`); continue; }
    const ikey = keyOf(item);
    const ne = nonExpenseKind(ikey) || (keyOf(x.kontragent) === 'учредитель' ? nonExpenseKind('дивиденд') : null);
    if (ne) { planned.push({ type: 'nonExpense', no, rows: rn, item: { ...base, account: item, account_key: ikey, ...ne, purpose: item } }); continue; }
    const cat = CATEGORY_MAP[ikey] ? ikey : null;
    if (!cat && x.se.side === 'BANK') warn(rn, no, `Bank chiqimi moddasi "${item}" kategoriya xaritasida yo‘q — kategoriyasiz yozildi`);
    // Kassa erkin matnida kontragent = modda matni (Excel'da shunday) — izohda takrorlanmaydi
    planned.push({ type: 'expense', no, rows: rn, item: { ...base, account: item, account_key: ikey, purpose: item, category_key: cat, category_name: cat ? item : null } });
  }
}

function compactRows(rs) {
  const s = [...new Set(rs)].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < s.length; i++) { let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++; out.push(j > i ? `${s[i]}-${s[j]}` : String(s[i])); i = j; }
  return out.join(', ');
}

/** Rejadagi (Excel) nazorat yig'indilari — bazadagi bilan solishtirish uchun */
export function excelTotals(plan) {
  const S = (xs, f = (x) => x.amount) => round2(xs.reduce((a, x) => a + f(x), 0));
  const pays = plan.contracts.flatMap((c) => c.payments);
  const bankOut = [...plan.expenses, ...plan.nonExpenses].filter((x) => x.side === 'BANK');
  const cashOut = [...plan.expenses, ...plan.nonExpenses].filter((x) => x.side === 'CASH');
  return {
    contracts: { n: plan.contracts.length, amount: S(plan.contracts), paid: S(pays), remaining: round2(S(plan.contracts) - S(pays)), debtors: plan.contracts.filter((c) => c.amount - S(c.payments) > 0.005).length },
    bank_income: { n: pays.filter((p) => p.side === 'BANK').length + plan.incomes.filter((x) => x.side === 'BANK').length, amount: round2(S(pays.filter((p) => p.side === 'BANK')) + S(plan.incomes.filter((x) => x.side === 'BANK'))) },
    cash_income: { n: pays.filter((p) => p.side === 'CASH').length + plan.incomes.filter((x) => x.side === 'CASH').length, amount: round2(S(pays.filter((p) => p.side === 'CASH')) + S(plan.incomes.filter((x) => x.side === 'CASH'))) },
    // Ichki o'tkazmalar (transfers) kirim/chiqimga qo'shilmaydi — alohida qator
    bank_expense: { n: bankOut.length, amount: S(bankOut) },
    cash_expense: { n: cashOut.length, amount: S(cashOut) },
    transfers: { n: plan.transfers.length, amount: S(plan.transfers) },
    expenses: { n: plan.expenses.length, amount: S(plan.expenses), uncategorized: { n: plan.expenses.filter((e) => !e.category_key).length, amount: S(plan.expenses.filter((e) => !e.category_key)) } },
    by_kind: Object.fromEntries(['DIVIDEND', 'LOAN', 'REFUND'].map((k) => [k, { n: plan.nonExpenses.filter((x) => x.kind === k).length, amount: S(plan.nonExpenses.filter((x) => x.kind === k)) }])),
    by_category: Object.values(plan.expenses.reduce((m, e) => { const k = e.category_key || '__none'; (m[k] ??= { key: e.category_key, name: e.category_name || 'Kategoriyasiz', n: 0, amount: 0 }); m[k].n++; m[k].amount = round2(m[k].amount + e.amount); return m; }, {})),
    quarantine: { n: plan.quarantine.length, amount: S(plan.quarantine) },
  };
}
