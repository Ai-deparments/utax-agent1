/**
 * Bank ko'chirmasi (bitta hisob, bitta davr) → tuzilgan reja. Format fayl ichidan aniqlanadi:
 *   ASBT     — Ipoteka bank "Справка о работе счета" (.xls): 1 operatsiya = 3 qator
 *              (sana | hujjat No | op | korrespondent | Дебет | Кредит) → (vaqt | nomi) → (to'lov mazmuni).
 *   FLEXCUBE — Open Bank / Smart bank "Hisob-varaq aylanmasi" (.xls): sarlavha bloki + 1 operatsiya = 1 qator.
 * Debet = chiqim (OUT), Kredit = kirim (IN). Hech narsa taxmin qilinmaydi: faylda yo'q maydon null qoladi,
 * tanib bo'lmagan qator xato sifatida qaytadi. Nazorat: boshlang'ich + kirim − chiqim = yakuniy (tiyinlarda).
 */
import { readXls, isXls } from './xls-reader.mjs';
import { readXlsx } from './xlsx-reader.mjs';

const txt = (c) => (c?.v === null || c?.v === undefined ? '' : String(c.v)).trim();
/** "37,521,972.67" | "1 234,56" | 344856000 → son (2 xona). Bo'sh → 0, tushunarsiz → NaN */
export function bankAmount(v) {
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  let s = String(v ?? '').replace(/[\s ]/g, '');
  if (!s) return 0;
  if (/^-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^-?\d+(,\d+)$/.test(s)) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
/** "02.07.2026" | "01.07.2026 16:48" → { date: '2026-07-02', time: '16:48' | null } */
function ddmmyyyy(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}:\d{2}(?::\d{2})?))?$/.exec(String(s || '').trim());
  return m ? { date: `${m[3]}-${m[2]}-${m[1]}`, time: m[4] || null } : null;
}
export const cents = (n) => Math.round(Number(n) * 100);

function readTable(buf) {
  if (isXls(buf)) return readXls(buf);
  if (buf?.length > 4 && buf.readUInt32LE(0) === 0x04034b50) return readXlsx(buf);
  throw new Error('Fayl formati tanilmadi: faqat .xls yoki .xlsx bank ko‘chirmasi qabul qilinadi');
}

export function detectFormat(rows) {
  const head = rows.slice(0, 15).map((r) => r.cells.map(txt).join(' | ')).join('\n');
  if (/[CС]правка о работе сч[её]та/i.test(head) && /Лицевой счет/i.test(head)) return 'ASBT';
  if (/Hisobvaraq:/i.test(head) && /Hisobot davri boshiga qoldiq/i.test(head)) return 'FLEXCUBE';
  return null;
}

function parseAsbt(rows) {
  const out = { format: 'ASBT', bank_name: null, mfo: null, account: null, inn: null, client_code: null, company_name: null, period_from: null, period_to: null, opening: null, closing: null, turnover: {}, count: {}, lines: [], errors: [] };
  let i = 0;
  for (; i < rows.length; i++) {
    const c0 = txt(rows[i].cells[0]);
    let m;
    if ((m = /Лицевой счет No\s*(\d{20})/i.exec(c0))) out.account = m[1];
    else if ((m = /Клиент:\s*(\d+)\s*ИНН:\s*(\d*)/i.exec(c0))) { out.client_code = m[1]; out.inn = m[2] || null; out.company_name = txt(rows[i + 1]?.cells[0]) || null; }
    else if ((m = /Период с (\S+) по (\S+)/i.exec(c0))) { out.period_from = ddmmyyyy(m[1])?.date || null; out.period_to = ddmmyyyy(m[2])?.date || null; }
    else if (/^Входящий остаток/i.test(c0)) out.opening = bankAmount(rows[i].cells[4]?.v);
    else if (/^Дата проводки/i.test(c0)) { i++; break; }
  }
  let cur = null;
  const flush = () => { if (cur) { cur.purpose = cur._p.join(' ').trim() || null; delete cur._p; out.lines.push(cur); cur = null; } };
  for (; i < rows.length; i++) {
    const { r, cells } = rows[i];
    const c0 = txt(cells[0]);
    const d = ddmmyyyy(c0);
    if (d) {
      flush();
      const corr = txt(cells[3]);
      const debit = bankAmount(cells[4]?.v), credit = bankAmount(cells[5]?.v);
      if (Number.isNaN(debit) || Number.isNaN(credit) || (debit > 0) === (credit > 0)) { out.errors.push({ row: r, message: `Summa tushunarsiz (Дебет=${txt(cells[4])}, Кредит=${txt(cells[5])})` }); continue; }
      cur = {
        row: r, tx_date: d.date, tx_time: null, doc_no: txt(cells[1]) || null, op_code: txt(cells[2]) || null,
        corr_mfo: /МФО:\s*(\d+)/i.exec(corr)?.[1] || null, corr_account: /Сч[её]т:\s*(\d+)/i.exec(corr)?.[1] || null, corr_inn: /ИНН:\s*(\d+)/i.exec(corr)?.[1] || null,
        corr_name: null, corr_bank: null, direction: debit > 0 ? 'OUT' : 'IN', amount: debit > 0 ? debit : credit, _p: [],
      };
    } else if (/^Сумма оборотов/i.test(c0)) { flush(); out.turnover = { debit: bankAmount(cells[4]?.v), credit: bankAmount(cells[5]?.v) }; }
    else if (/^Количество оборотов/i.test(c0)) out.count = { debit: Number(cells[4]?.v) || 0, credit: Number(cells[5]?.v) || 0 };
    else if (/^Исходящий остаток/i.test(c0)) out.closing = bankAmount(cells[4]?.v);
    else if (/^\d{5}\s/.test(c0) && !out.bank_name) { flush(); out.mfo = c0.slice(0, 5); out.bank_name = c0.slice(6).trim(); }
    else if (cur && /^\d{2}:\d{2}(:\d{2})?$/.test(c0)) { cur.tx_time = c0; cur.corr_name = txt(cells[3]) || null; }
    else if (cur && !c0 && txt(cells[3])) cur._p.push(txt(cells[3]));
  }
  flush();
  return out;
}

function parseFlexcube(rows) {
  const out = { format: 'FLEXCUBE', bank_name: null, mfo: null, account: null, inn: null, client_code: null, company_name: null, period_from: null, period_to: null, opening: null, closing: null, turnover: {}, count: {}, lines: [], errors: [] };
  let i = 0;
  for (; i < rows.length; i++) {
    const c = rows[i].cells, c0 = txt(c[0]);
    let m;
    if (/^Bank:/i.test(c0) && (m = /^(.*?)\s*\((\d{5})\)\s*$/.exec(txt(c[2])))) { out.bank_name = m[1].trim(); out.mfo = m[2]; }
    else if (/^Mijoz:/i.test(c0)) { const s = txt(c[2]); out.company_name = s.replace(/\s*\(\d+\)\s*$/, '') || null; out.inn = /\((\d{9})\)\s*$/.exec(s)?.[1] || null; }
    else if (/^Hisobvaraq:/i.test(c0)) out.account = /\d{20}/.exec(txt(c[2]))?.[0] || null;
    else if (/^Davr:/i.test(c0) && (m = /(\S+)\s*-\s*(\S+)/.exec(txt(c[2])))) { out.period_from = ddmmyyyy(m[1])?.date || null; out.period_to = ddmmyyyy(m[2])?.date || null; }
    else if (/boshiga qoldiq/i.test(c0)) {
      out.opening = bankAmount(c[2]?.v);
      const k = c.findIndex((x) => /oxiriga qoldiq/i.test(txt(x)));
      if (k >= 0) out.closing = bankAmount(c.slice(k + 1).find((x) => txt(x) !== '')?.v);
    } else if (/^Sana$/i.test(c0) && /Debet/i.test(txt(c[6]))) { i++; break; }
  }
  for (; i < rows.length; i++) {
    const { r, cells } = rows[i];
    const c0 = txt(cells[0]);
    if (!c0 && cells.every((x) => !txt(x))) continue;
    if (/^Jami hisobot davrida aylanma/i.test(c0)) { out.turnover = { debit: bankAmount(cells[6]?.v), credit: bankAmount(cells[7]?.v) }; break; }
    const d = ddmmyyyy(c0);
    if (!d) { if (c0) out.errors.push({ row: r, message: `Tanib bo‘lmagan qator: "${c0.slice(0, 60)}"` }); continue; }
    const debit = bankAmount(cells[6]?.v), credit = bankAmount(cells[7]?.v);
    if (Number.isNaN(debit) || Number.isNaN(credit) || (debit > 0) === (credit > 0)) { out.errors.push({ row: r, message: `Summa tushunarsiz (Debet=${txt(cells[6])}, Kredit=${txt(cells[7])})` }); continue; }
    const purpose = txt(cells[8]) || null;
    out.lines.push({
      row: r, tx_date: d.date, tx_time: d.time, doc_no: txt(cells[1]) || null, op_code: /^(\d{5})/.exec(purpose || '')?.[1] || null,
      corr_account: txt(cells[2]) || null, corr_name: txt(cells[3]) || null, corr_mfo: txt(cells[4]) || null, corr_bank: txt(cells[5]) || null, corr_inn: null,
      direction: debit > 0 ? 'OUT' : 'IN', amount: debit > 0 ? debit : credit, purpose,
    });
  }
  return out;
}

/**
 * @returns reja: { format, account, inn, opening, closing, lines[], totals, checks[], errors[], ok }
 *   ok=false bo'lsa import qilinmaydi (checks/errors da sabab).
 */
export function parseBankStatement(buf, { fileName = null } = {}) {
  const { rows } = readTable(buf);
  const format = detectFormat(rows);
  if (!format) throw new Error('Bank ko‘chirmasi formati tanilmadi (ASBT "Справка о работе счета" yoki Open Bank "Hisob-varaq aylanmasi" kutilgan)');
  const p = format === 'ASBT' ? parseAsbt(rows) : parseFlexcube(rows);
  p.file_name = fileName;
  // Fayl ichidagi aynan bir xil operatsiyalar (kamdan-kam) — tartib raqami bilan ajratiladi, qayta import barqaror qoladi
  const seen = new Map();
  for (const l of p.lines) {
    const base = [p.account, l.tx_date, l.doc_no || '', cents(l.amount), l.direction].join('|');
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    l.uniq_key = n > 1 ? `${base}#${n}` : base;
  }
  const inC = p.lines.filter((l) => l.direction === 'IN').reduce((s, l) => s + cents(l.amount), 0);
  const outC = p.lines.filter((l) => l.direction === 'OUT').reduce((s, l) => s + cents(l.amount), 0);
  p.totals = { inflow: inC / 100, outflow: outC / 100, count: p.lines.length, count_in: p.lines.filter((l) => l.direction === 'IN').length, count_out: p.lines.filter((l) => l.direction === 'OUT').length };
  const checks = [];
  const need = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
  need('Hisob raqami topildi', /^\d{20}$/.test(p.account || ''), p.account || 'yo‘q');
  need('Boshlang‘ich qoldiq topildi', Number.isFinite(p.opening), p.opening);
  need('Yakuniy qoldiq topildi', Number.isFinite(p.closing), p.closing);
  need('Davr topildi', p.period_from && p.period_to, `${p.period_from} — ${p.period_to}`);
  if (Number.isFinite(p.turnover.debit)) need('Chiqim yig‘indisi = fayldagi aylanma (Дебет)', cents(p.turnover.debit) === outC, `${outC / 100} vs ${p.turnover.debit}`);
  else need('Fayldagi aylanma qatori topildi', false, 'Jami aylanma qatori yo‘q');
  if (Number.isFinite(p.turnover.credit)) need('Kirim yig‘indisi = fayldagi aylanma (Кредит)', cents(p.turnover.credit) === inC, `${inC / 100} vs ${p.turnover.credit}`);
  if (p.count.debit !== undefined) need('Operatsiyalar soni = fayldagi soni', p.count.debit === p.totals.count_out && p.count.credit === p.totals.count_in, `${p.totals.count_out}+${p.totals.count_in} vs ${p.count.debit}+${p.count.credit}`);
  if (Number.isFinite(p.opening) && Number.isFinite(p.closing)) {
    const diff = cents(p.opening) + inC - outC - cents(p.closing);
    need('Boshlang‘ich + kirim − chiqim = yakuniy', diff === 0, diff === 0 ? `${p.closing}` : `farq ${diff / 100}`);
  }
  const outside = p.lines.filter((l) => p.period_from && (l.tx_date < p.period_from || l.tx_date > p.period_to));
  need('Barcha operatsiyalar davr ichida', !outside.length, outside.length ? `${outside.length} ta davrdan tashqari` : 'ok');
  p.checks = checks;
  p.ok = !p.errors.length && checks.every((c) => c.ok);
  return p;
}
