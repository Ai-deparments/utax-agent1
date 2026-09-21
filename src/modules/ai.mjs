import { badRequest, notFound, forbidden } from '../core/http.mjs';
import { config } from '../core/config.mjs';
import { nowIso, today, round2, parseJson, monthOf, addMonths, monthRange, resolvePeriod, addDays, sum, sha256, uid } from '../core/util.mjs';

/**
 * AI FINANCE CENTER
 *  1) Rule-based intent router — API kalitsiz ham 15 acceptance savoliga real raqam bilan javob beradi.
 *  2) LLM gateway (Anthropic SDK, ixtiyoriy) — tool use orqali faqat o'qish; harakatlar propose_action → human approval.
 *  3) 14 agent — detect → recommend → human approves → execute → audit.
 */
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/,/g, ' ');
const M = (n) => `${fmt(n)} so‘m`;

const MONTHS = { yanvar: 1, fevral: 2, mart: 3, aprel: 4, may: 5, iyun: 6, iyul: 7, avgust: 8, sentabr: 9, sentyabr: 9, oktabr: 10, oktyabr: 10, noyabr: 11, dekabr: 12, январ: 1, феврал: 2, март: 3, апрел: 4, мая: 5, май: 5, июн: 6, июл: 7, август: 8, сентябр: 9, октябр: 10, ноябр: 11, декабр: 12, january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
function detectMonth(q) {
  const t = q.toLowerCase();
  for (const [name, m] of Object.entries(MONTHS)) if (new RegExp('(?<![a-zа-яё])' + name).test(t)) { const y = /20\d{2}/.exec(t)?.[0] || today().slice(0, 4); return `${y}-${String(m).padStart(2, '0')}`; }
  if (/o[‘'ʻ]?tgan oy|прошл(ый|ом) месяц|last month/.test(t)) return addMonths(monthOf(today()), -1);
  return null;
}
function detectPeriod(q) {
  const t = q.toLowerCase();
  const month = detectMonth(q);
  if (month) return { month };
  if (/bugun|today|сегодня/.test(t)) return { period: 'day' };
  if (/hafta|week|недел/.test(t)) return { period: 'week' };
  if (/kvartal|quarter|квартал/.test(t)) return { period: 'quarter' };
  if (/\byil|year|год/.test(t)) return { period: 'year' };
  return { period: 'month' };
}
function detectDays(q) { const m = /(\d{1,3})\s*(kun|day|дн)/.exec(q.toLowerCase()); if (m) return Number(m[1]); if (/hafta|week|недел/.test(q.toLowerCase())) return 7; if (/kvartal|quarter/.test(q.toLowerCase())) return 90; return 30; }
function detectAmount(q) { const m = /(\d+[\d\s.,]*)\s*(mln|million|млн|m\b)/i.exec(q); if (m) return Math.round(parseFloat(m[1].replace(/\s/g, '').replace(',', '.')) * 1e6); const n = /(\d[\d\s]{5,})/.exec(q); return n ? Number(n[1].replace(/\s/g, '')) : null; }

export function register(app) {
  const { r, db, audit, settings } = app;
  const S = () => app.services;

  // ---------------- INTENT ROUTER ----------------
  const INTENTS = [
    { name: 'APPROVE_REQUEST', test: (t) => /(tasdiqla|approve|утверди|подтверди)/.test(t) && !/kutayotgan|pending|ro[‘'ʻ]?yxat|list/.test(t) },
    { name: 'DAILY_STATUS', test: (t) => /(bugungi holat|holatni ber|umumiy holat|status|digest|xulosa|сводк|отчет за сегодня|daily)/.test(t) && !/xizmat|service|qarz|xarajat/.test(t) },
    { name: 'EXPECTED_EXPENSES', test: (t) => /(xarajat|expense|расход|chiqim|pul chiq|to[‘'ʻ]?lov(lar)? chiq)/.test(t) && /(kutil|expected|chiqadi|ожида|keyingi|kelasi)/.test(t) },
    { name: 'EXPECTED_INCOME', test: (t) => /(tush(ishi|adi)|kirim|income|поступ)/.test(t) && /(kutil|kerak|expected|keyingi|kelasi|ожида)/.test(t) },
    { name: 'WHY_PROFIT', test: (t) => /(nima uchun|nega|sabab|why|почему)/.test(t) && /(foyda|profit|прибыл|kamay|tush|pasay)/.test(t) },
    { name: 'SERVICE_PROFIT', test: (t) => /(xizmat|service|sporniy|revision|reviziya|audit|obuna|subscription|rentabel|услуг)/.test(t) && /(foyda|profit|rentabel|прибыл|margin|davom|keltir)/.test(t) },
    { name: 'OVERDUE', test: (t) => /(muddati o[‘'ʻ]?tgan|overdue|kechik|просроч)/.test(t) },
    { name: 'DEBTORS', test: (t) => /(qarzdor|debitor|kimdan|kimlardan|pul olishimiz|receivable|должн|дебитор|qarz)/.test(t) },
    { name: 'UNMATCHED', test: (t) => /(bog[‘'ʻ]?lanmagan|unmatched|match|сопостав|bog[‘'ʻ]?lash)/.test(t) },
    { name: 'APPROVALS', test: (t) => /(tasdiq|approv|подтвержд|kutayotgan so[‘'ʻ]?rov|pending)/.test(t) },
    { name: 'FORECAST', test: (t) => /(forecast|prognoz|bashorat|прогноз|keyingi \d+|keyingi (hafta|oy)|kelasi)/.test(t) },
    { name: 'PLAN', test: (t) => /(plan|reja|план)/.test(t) },
    { name: 'PAYROLL', test: (t) => /(oylik|maosh|payroll|зарплат|\bkpi)/.test(t) },
    { name: 'CASH', test: (t) => /(qancha pul|pulimiz|balans|balance|\bcash|kassa|bank|naqd|available|ishlat(ish|a) (mumkin|olamiz)|xavfsiz|olsak bo[‘'ʻ]?ladi|pul bor|predoplata|avans|advance|предоплат|аванс|деньг|остат|сколько у нас)/.test(t) },
    { name: 'EXPENSES', test: (t) => /(xarajat|expense|расход|chiqim)/.test(t) },
    { name: 'REVENUE', test: (t) => /(daromad|revenue|tan olin|выручк|доход|tushum)/.test(t) },
    { name: 'PROFIT', test: (t) => /(foyda|profit|прибыл|p&l|pnl|zarar)/.test(t) },
    { name: 'CONTRACTS', test: (t) => /(shartnoma|contract|договор)/.test(t) },
    { name: 'DATA_QUALITY', test: (t) => /(sifat|quality|muammo|xato|warning|to[‘'ʻ]?liq emas|ogohlantir)/.test(t) },
  ];

  const handlers = {
    CASH() {
      const t = S().reports.treasury();
      const lines = [`Bank: ${M(t.bank_balance)}`, `Kassa: ${M(t.cash_balance)}`, `Jami: ${M(t.total_cash)}`, `Mijoz avanslari (cheklangan): ${M(t.customer_advances)}`, `Rezerv: ${M(t.reserved.total)} (tasdiqlangan to‘lanmagan xarajat ${fmt(t.reserved.approved_unpaid_expenses)}, oylik ${fmt(t.reserved.pending_payroll)}, xavfsizlik ${fmt(t.reserved.safety_reserve)})`, `**ISHLATISH MUMKIN: ${M(t.available_cash)}**`, `Xavfsiz olish mumkin (30 kunlik chiqim hisobga olinganda): ${M(t.safe_withdrawal)}`];
      if (t.low_liquidity) lines.push('⚠️ Likvidlik pastligi chegarasidan past!');
      return { answer: lines.join('\n'), data: { kind: 'kpis', items: [['Bank', t.bank_balance], ['Kassa', t.cash_balance], ['Jami', t.total_cash], ['Avans', t.customer_advances], ['Rezerv', t.reserved.total], ['Available', t.available_cash]] } };
    },
    DEBTORS(q) {
      const rows = S().receivables.list({ filter: /muddati o[‘'ʻ]?tgan|overdue/.test(q.toLowerCase()) ? 'overdue' : undefined });
      const s = S().receivables.summary();
      const top = rows.slice(0, 10);
      const answer = [`Jami debitorlik: ${M(s.total_receivable)} (${s.count} shartnoma)`, `Muddati o‘tgan: ${M(s.overdue)} · Kritik (15+ kun): ${M(s.critical)}`, '', ...top.map((x, i) => `${i + 1}. ${x.client} — ${x.contract_number}: qarz ${M(x.debt)}, muddat ${x.due_date}${x.days_overdue > 0 ? ` (${x.days_overdue} kun o‘tdi)` : ''}`)].join('\n');
      return { answer, data: { kind: 'table', columns: [{ key: 'client', label: 'Mijoz' }, { key: 'contract_number', label: 'Shartnoma' }, { key: 'total', label: 'Summa', money: true }, { key: 'paid', label: 'To‘langan', money: true }, { key: 'debt', label: 'Qarz', money: true }, { key: 'due_date', label: 'Muddat' }, { key: 'days_overdue', label: 'Kechikish (kun)' }], rows } };
    },
    OVERDUE(q) { return handlers.DEBTORS('muddati o‘tgan ' + q); },
    REVENUE(q) {
      const p = resolvePeriod(detectPeriod(q));
      const rev = S().revenue.recognizedInPeriod(p.from, p.to);
      const cash = db.get('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE reversed_at IS NULL AND paid_at BETWEEN ? AND ?', p.from, p.to).s;
      const pend = db.get("SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM revenue_recognition WHERE status='PENDING_APPROVAL'");
      const byS = db.all(`SELECT st.name, COALESCE(SUM(rr.amount),0) amount FROM service_types st LEFT JOIN contracts c ON c.service_type_id=st.id LEFT JOIN revenue_recognition rr ON rr.contract_id=c.id AND rr.status='RECOGNIZED' AND rr.recognized_at BETWEEN ? AND ? GROUP BY st.id HAVING COALESCE(SUM(rr.amount),0)>0 ORDER BY 2 DESC`, p.from, p.to);
      return { answer: [`Davr: ${p.label}`, `Tan olingan daromad (Recognized Revenue): **${M(rev)}**`, `Kelib tushgan pul (Cash Received): ${M(cash)}`, `Mijoz avanslari qoldig‘i: ${M(S().revenue.advancesBalance())}`, pend.n ? `Tasdiq kutayotgan tan olish: ${M(pend.s)} (${pend.n} ta)` : '', '', ...byS.map((x) => `• ${x.name}: ${M(x.amount)}`)].filter((x) => x !== '').join('\n'), data: { kind: 'kpis', items: [['Recognized', rev], ['Cash received', cash], ['Advances', S().revenue.advancesBalance()]] } };
    },
    EXPENSES(q) {
      const p = resolvePeriod(detectPeriod(q));
      const total = S().expenses.total(p.from, p.to);
      const cats = S().expenses.totalsByCategory(p.from, p.to).filter((c) => c.amount > 0).slice(0, 8);
      const pend = db.get("SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM expenses WHERE status='PENDING' AND reversed_at IS NULL");
      return { answer: [`Davr: ${p.label}`, `Xarajatlar (tasdiqlangan + to‘langan): **${M(total)}**`, `Tasdiq kutayotgan so‘rovlar: ${M(pend.s)} (${pend.n} ta)`, '', ...cats.map((c) => `• ${c.name}: ${M(c.amount)}`)].join('\n'), data: { kind: 'table', columns: [{ key: 'name', label: 'Kategoriya' }, { key: 'amount', label: 'Summa', money: true }, { key: 'n', label: 'Soni' }], rows: cats } };
    },
    EXPECTED_EXPENSES(q) {
      const days = detectDays(q);
      const o = S().expenses.expectedOutflow(today(), addDays(today(), days));
      const list = db.all("SELECT code, purpose, amount, required_date FROM expenses WHERE status='APPROVED' AND reversed_at IS NULL AND COALESCE(required_date, expense_date)<=? ORDER BY required_date", addDays(today(), days));
      return { answer: [`Keyingi ${days} kunda kutilayotgan chiqim: **${M(o.total)}**`, `• Tasdiqlangan, to‘lanmagan xarajatlar: ${M(o.approved_unpaid)}`, `• Doimiy xarajatlar (ijara, hosting, oylik...): ${M(o.recurring)}`].join('\n'), data: { kind: 'table', columns: [{ key: 'code', label: 'Kod' }, { key: 'purpose', label: 'Maqsad' }, { key: 'amount', label: 'Summa', money: true }, { key: 'required_date', label: 'Muddat' }], rows: list } };
    },
    EXPECTED_INCOME(q) {
      const days = detectDays(q);
      const rows = S().receivables.list({ filter: days <= 7 ? '7' : '30' });
      const s = S().receivables.summary();
      return { answer: [`Keyingi ${days} kunda tushishi kerak: **${M(days <= 7 ? s.expected_7d : s.expected_30d)}**`, `Muddati o‘tgan (qo‘shimcha undirish kerak): ${M(s.overdue)}`, '', ...rows.slice(0, 10).map((x) => `• ${x.client} — ${x.contract_number}: ${M(x.debt)} (${x.due_date})`)].join('\n'), data: { kind: 'table', columns: [{ key: 'client', label: 'Mijoz' }, { key: 'contract_number', label: 'Shartnoma' }, { key: 'debt', label: 'Kutilayotgan', money: true }, { key: 'due_date', label: 'Muddat' }], rows } };
    },
    PROFIT(q) {
      const pnl = S().reports.pnl(detectPeriod(q));
      const t = pnl.totals;
      return { answer: [`Davr: ${pnl.period.label}`, `Revenue: ${M(t.revenue)}`, `− Direct costs: ${M(t.direct)} → Gross profit: ${M(t.gross)}`, `− OPEX: ${M(t.opex)} → Operating profit: ${M(t.operating)}`, `− Soliqlar: ${M(t.taxes)}, boshqa: ${M(t.other)}`, `**NET PROFIT: ${M(t.net)}** (margin ${t.net_margin}%)`, `Oldingi davr: net ${M(pnl.previous.net)}`].join('\n'), data: { kind: 'table', columns: [{ key: 'label', label: 'Qator' }, { key: 'amount', label: 'Summa', money: true }], rows: pnl.lines } };
    },
    WHY_PROFIT(q) {
      const month = detectMonth(q) || addMonths(monthOf(today()), -1);
      const cur = S().reports.pnl({ month }), prevM = addMonths(month, -1), prev = S().reports.pnl({ month: prevM });
      const dRev = round2(cur.totals.revenue - prev.totals.revenue), dExp = round2((cur.totals.direct + cur.totals.opex + cur.totals.taxes + cur.totals.other) - (prev.totals.direct + prev.totals.opex + prev.totals.taxes + prev.totals.other));
      const catMap = Object.fromEntries(prev.by_category.map((c) => [c.code, c.amount]));
      const catDiff = S().expenses.totalsByCategory(cur.period.from, cur.period.to).map((c) => ({ name: c.name, diff: round2(c.amount - (catMap[c.code] || 0)), cur: c.amount })).filter((c) => Math.abs(c.diff) > 0).sort((a, b) => b.diff - a.diff);
      const svcCur = Object.fromEntries(cur.by_service.map((s) => [s.code, s.revenue])), svcPrev = Object.fromEntries(prev.by_service.map((s) => [s.code, s.revenue]));
      const svcDiff = Object.keys(svcCur).map((k) => ({ name: k, diff: round2(svcCur[k] - (svcPrev[k] || 0)) })).sort((a, b) => a.diff - b.diff);
      const lines = [`${month} vs ${prevM}: sof foyda ${M(cur.totals.net)} vs ${M(prev.totals.net)} (${M(cur.totals.net - prev.totals.net)})`, '', `1) Daromad o‘zgarishi: ${dRev >= 0 ? '+' : ''}${M(dRev)}`, ...svcDiff.slice(0, 4).map((s) => `   • ${s.name}: ${s.diff >= 0 ? '+' : ''}${M(s.diff)}`), `2) Xarajat o‘zgarishi: ${dExp >= 0 ? '+' : ''}${M(dExp)}`, ...catDiff.slice(0, 5).map((c) => `   • ${c.name}: ${c.diff >= 0 ? '+' : ''}${M(c.diff)}`)];
      const pend = db.get("SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM revenue_recognition WHERE status='PENDING_APPROVAL' AND period=?", month);
      if (pend.n) lines.push(`3) Tasdiq kutayotgan tan olish (${month}): ${M(pend.s)} — tasdiqlansa foyda oshadi`);
      const noAct = db.all("SELECT c.contract_number FROM contracts c JOIN service_types st ON st.id=c.service_type_id WHERE c.service_status='COMPLETED' AND st.recognition_rule LIKE '%\"require_acceptance_document\":true%' AND NOT EXISTS (SELECT 1 FROM contract_documents d WHERE d.contract_id=c.id AND d.doc_type='ACT')");
      if (noAct.length) lines.push(`4) Akt yo‘qligi sabab tan olinmagan: ${noAct.map((c) => c.contract_number).join(', ')}`);
      return { answer: lines.join('\n'), data: { kind: 'table', columns: [{ key: 'name', label: 'Kategoriya' }, { key: 'cur', label: 'Joriy', money: true }, { key: 'diff', label: 'O‘zgarish', money: true }], rows: catDiff } };
    },
    SERVICE_PROFIT(q) {
      const sp = S().reports.serviceProfitability(detectPeriod(q));
      const rows = sp.rows;
      const target = /sporniy/.test(q.toLowerCase()) ? rows.find((x) => x.code === 'SPORNIY') : null;
      const lines = [`Davr: ${sp.period.label}`, ...rows.map((x) => `• ${x.name}: revenue ${M(x.revenue)}, net ${M(x.net_profit)}, margin ${x.margin}% → ${x.verdict === 'LOSS' ? '❌ zarar' : x.verdict === 'LOW' ? '⚠️ past' : x.verdict === 'NO_DATA' ? '— ma’lumot yo‘q' : '✅'}`)];
      if (target) lines.push('', `${target.name}: ${target.verdict === 'LOSS' ? 'davom ettirish zararli' : target.verdict === 'LOW' ? 'foyda past — narx/xarajatni qayta ko‘ring' : 'foydali, davom ettirish mumkin'} (net ${M(target.net_profit)}, margin ${target.margin}%)`);
      return { answer: lines.join('\n'), data: { kind: 'table', columns: [{ key: 'name', label: 'Xizmat' }, { key: 'revenue', label: 'Revenue', money: true }, { key: 'direct_expense', label: 'Direct', money: true }, { key: 'payroll', label: 'Payroll', money: true }, { key: 'allocated_opex', label: 'Allocated OPEX', money: true }, { key: 'net_profit', label: 'Net', money: true }, { key: 'margin', label: 'Margin %' }], rows } };
    },
    FORECAST(q) {
      const days = detectDays(q);
      const f = S().forecast.compute(days);
      return { answer: [`Forecast ${days} kun (${f.as_of} → ${f.to}). Hozirgi pul: ${M(f.cash_now)}`, ...Object.entries(f.scenarios).map(([k, s]) => `• ${k}: kirim ${M(s.inflow)}, chiqim ${M(s.outflow)}, net ${M(s.net)} → pul ${M(s.projected_cash)}`), `Risk: ${f.risk}`].join('\n'), data: { kind: 'table', columns: [{ key: 'scenario', label: 'Scenariy' }, { key: 'inflow', label: 'Kirim', money: true }, { key: 'outflow', label: 'Chiqim', money: true }, { key: 'net', label: 'Net', money: true }, { key: 'projected_cash', label: 'Prognoz pul', money: true }], rows: Object.entries(f.scenarios).map(([k, s]) => ({ scenario: k, ...s })) } };
    },
    APPROVALS(q, ctx) {
      let rows = S().approvals.list({ status: 'PENDING' }, ctx.user);
      if (['EMPLOYEE', 'SALES'].includes(ctx.user?.role_code)) rows = rows.filter((a) => a.is_mine); // web /api/approvals bilan bir xil scope
      return { answer: rows.length ? [`Tasdiq kutayotgan: ${rows.length} ta, jami ${M(sum(rows, (a) => a.amount))}`, ...rows.slice(0, 10).map((a) => `• #${a.id} ${a.title} — ${M(a.amount)} (qadam ${a.current_step + 1}/${a.steps.length}: ${a.steps[a.current_step]?.role})${a.can_act ? ' ← siz tasdiqlashingiz mumkin' : ''}`)].join('\n') : 'Tasdiq kutayotgan so‘rovlar yo‘q.', data: { kind: 'table', columns: [{ key: 'id', label: '#' }, { key: 'title', label: 'Nomi' }, { key: 'amount', label: 'Summa', money: true }, { key: 'status', label: 'Status' }], rows } };
    },
    APPROVE_REQUEST(q, ctx) {
      const amount = detectAmount(q);
      const t = q.toLowerCase();
      let rows = S().approvals.list({ status: 'PENDING' }, ctx.user).filter((a) => a.can_act);
      if (amount) rows = rows.filter((a) => Math.abs(a.amount - amount) < Math.max(1, amount * 0.02));
      const dept = db.all('SELECT id, name FROM departments').find((d) => t.includes(d.name.toLowerCase().slice(0, 6)));
      if (dept) rows = rows.filter((a) => a.department_id === dept.id);
      if (!rows.length) return { answer: 'Mos keladigan va siz tasdiqlay oladigan so‘rov topilmadi.', data: null };
      if (rows.length > 1) return { answer: 'Bir nechta mos so‘rov bor, aniqlashtiring:\n' + rows.map((a) => `• #${a.id} ${a.title} — ${M(a.amount)}`).join('\n'), data: null };
      const a = rows[0];
      return { answer: `${M(a.amount)} xarajatni tasdiqlamoqchimisiz?\n${a.title}`, data: null, confirm: { type: 'APPROVE', approval_id: a.id, title: a.title, amount: a.amount } };
    },
    UNMATCHED() {
      const rows = db.all("SELECT id, tx_date, amount, direction, counterparty_name, purpose, matching_status, confidence FROM bank_transactions WHERE matching_status IN ('UNMATCHED','SUGGESTED') AND reversed_at IS NULL ORDER BY tx_date DESC");
      return { answer: rows.length ? [`Bog‘lanmagan tranzaksiyalar: ${rows.length} ta, jami ${M(sum(rows, (x) => x.amount))}`, ...rows.slice(0, 10).map((x) => `• ${x.tx_date} ${x.direction === 'INCOME' ? '+' : '−'}${M(x.amount)} ${x.counterparty_name || ''} — ${x.matching_status}${x.confidence ? ` (${x.confidence}%)` : ''}`)].join('\n') : 'Barcha tranzaksiyalar bog‘langan ✅', data: { kind: 'table', columns: [{ key: 'tx_date', label: 'Sana' }, { key: 'counterparty_name', label: 'Kontragent' }, { key: 'amount', label: 'Summa', money: true }, { key: 'purpose', label: 'Maqsad' }, { key: 'matching_status', label: 'Status' }, { key: 'confidence', label: 'Confidence' }], rows } };
    },
    PLAN(q) {
      const pf = S().budget.planFact(detectMonth(q) || monthOf(today()));
      return { answer: [`Plan/Fakt ${pf.period}:`, ...pf.items.map((i) => `• ${i.name}: plan ${M(i.plan)} → fakt ${M(i.fact)} = ${i.pct}%`)].join('\n'), data: { kind: 'table', columns: [{ key: 'name', label: 'Ko‘rsatkich' }, { key: 'plan', label: 'Plan', money: true }, { key: 'fact', label: 'Fakt', money: true }, { key: 'pct', label: '%' }], rows: pf.items } };
    },
    PAYROLL(q) {
      const period = detectMonth(q) || db.get('SELECT period FROM payrolls ORDER BY period DESC LIMIT 1')?.period || monthOf(today());
      const s = S().payroll.summary(period);
      return { answer: s.rows ? [`Oylik ${period}: ${s.rows} xodim, gross ${M(s.gross)}, KPI ${M(s.kpi)}, net ${M(s.net)} — status ${s.status}`, ...s.by_department.map((d) => `• ${d.department}: net ${M(d.net)} (${d.n} kishi)`)].join('\n') : `Oylik ${period} hisoblanmagan.`, data: { kind: 'table', columns: [{ key: 'department', label: 'Bo‘lim' }, { key: 'n', label: 'Xodim' }, { key: 'gross', label: 'Gross', money: true }, { key: 'kpi', label: 'KPI', money: true }, { key: 'net', label: 'Net', money: true }], rows: s.by_department } };
    },
    CONTRACTS(q, ctx) {
      const rows = S().contracts.list({ q: /UTAX-/i.test(q) ? /UTAX-[A-Z]+-\d+/i.exec(q)[0] : undefined, manager_user_id: ctx?.user?.role_code === 'SALES' ? ctx.user.id : undefined });
      const active = rows.filter((c) => !['DRAFT', 'CANCELLED', 'CLOSED'].includes(c.contract_status));
      return { answer: [`Shartnomalar: ${rows.length} ta, faol ${active.length} ta, jami summa ${M(sum(active, (c) => c.amount))}`, `To‘langan: ${M(sum(active, (c) => c.paid))}, qoldiq ${M(sum(active, (c) => c.remaining))}`, ...rows.slice(0, 8).map((c) => `• ${c.contract_number} ${c.company_name}: ${M(c.amount)} — ${c.contract_status}, to‘langan ${c.paid_pct}%`)].join('\n'), data: { kind: 'table', columns: [{ key: 'contract_number', label: '№' }, { key: 'company_name', label: 'Mijoz' }, { key: 'service_code', label: 'Xizmat' }, { key: 'amount', label: 'Summa', money: true }, { key: 'paid', label: 'To‘langan', money: true }, { key: 'contract_status', label: 'Status' }], rows } };
    },
    DATA_QUALITY() {
      const dq = S().reports.dataQuality();
      return { answer: dq.total ? [`⚠️ ${dq.total} ta ma’lumot sifati muammosi:`, ...dq.issues.map((i) => `• ${i.title}: ${i.count} ta`)].join('\n') : 'Ma’lumot sifati muammolari yo‘q ✅', data: { kind: 'table', columns: [{ key: 'severity', label: 'Daraja' }, { key: 'title', label: 'Muammo' }, { key: 'count', label: 'Soni' }], rows: dq.issues } };
    },
    DAILY_STATUS(q, ctx) {
      const c = handlers.CASH(), d = handlers.DEBTORS(''), a = handlers.APPROVALS('', ctx), u = handlers.UNMATCHED(), dq = handlers.DATA_QUALITY();
      return { answer: ['📊 **Bugungi holat**', '', c.answer, '', d.answer.split('\n').slice(0, 2).join('\n'), '', a.answer.split('\n')[0], u.answer.split('\n')[0], dq.answer.split('\n')[0]].join('\n'), data: c.data };
    },
    HELP() {
      return { answer: ['Men UTAX moliya AI yordamchisiman. Misol savollar:', '• Bugun qancha pulimiz bor?', '• Kimlardan pul olishimiz kerak?', '• Qaysi qarzdorlik muddati o‘tgan?', '• Shu oy qancha daromad tan olindi?', '• Shu haftada qancha xarajat kutilyapti?', '• Avgust oyida nima uchun foyda kamaydi?', '• Qaysi xizmat eng ko‘p foyda keltiryapti?', '• Keyingi 30 kun forecast', '• Plan necha foiz bajarildi?', '• Bog‘lanmagan tranzaksiyalar', '• Marketingning 12 mln so‘rovini tasdiqla'].join('\n'), data: null };
    },
  };

  // Har intent web'dagi qaysi resursni ko'rsatadi — foydalanuvchida ruxsat bo'lmasa javob berilmaydi (web RBAC bilan bir xil).
  const INTENT_PERM = {
    APPROVE_REQUEST: ['approvals', 'APPROVE'], DAILY_STATUS: ['treasury', 'VIEW'], EXPECTED_EXPENSES: ['pnl', 'VIEW'], EXPECTED_INCOME: ['receivables', 'VIEW'],
    WHY_PROFIT: ['pnl', 'VIEW'], SERVICE_PROFIT: ['pnl', 'VIEW'], OVERDUE: ['receivables', 'VIEW'], DEBTORS: ['receivables', 'VIEW'], UNMATCHED: ['transactions', 'VIEW'],
    APPROVALS: ['approvals', 'VIEW'], FORECAST: ['forecast', 'VIEW'], PLAN: ['planfact', 'VIEW'], PAYROLL: ['payroll', 'VIEW'], CASH: ['treasury', 'VIEW'],
    EXPENSES: ['pnl', 'VIEW'], REVENUE: ['revenue', 'VIEW'], PROFIT: ['pnl', 'VIEW'], CONTRACTS: ['contracts', 'VIEW'], DATA_QUALITY: ['dashboard', 'VIEW'],
  };
  const RESOURCE_LABEL = { treasury: 'Pul boshqaruvi', pnl: 'Foyda va zarar', receivables: 'Debitorlik', transactions: 'Tushumlar', approvals: 'Tasdiqlashlar', forecast: 'Prognoz', planfact: 'Reja / Fakt', payroll: 'KPI va oylik', revenue: 'Daromad', contracts: 'Shartnomalar', dashboard: 'Bosh sahifa', cashflow: 'Pul oqimi', ai: 'AI moliya' };
  const allowed = (ctx, perm) => !perm || (!!ctx?.user && app.rbac.can(ctx.user, perm[0], perm[1]));

  function route(question, ctx) {
    const t = String(question || '').toLowerCase();
    for (const it of INTENTS) {
      if (!it.test(t)) continue;
      const perm = INTENT_PERM[it.name];
      if (!allowed(ctx, perm)) return { intent: it.name, denied: true, answer: `⛔ Bu savol «${RESOURCE_LABEL[perm[0]] || perm[0]}» ma’lumotini talab qiladi — sizning rolingizda bunga ruxsat yo‘q.`, data: null };
      return { intent: it.name, ...handlers[it.name](question, ctx) };
    }
    return { intent: 'HELP', ...handlers.HELP() };
  }

  // ---------------- LLM GATEWAY (Anthropic SDK, ixtiyoriy) ----------------
  const TOOLS = [
    { name: 'get_treasury', description: 'Bank, kassa, jami pul, mijoz avanslari, rezerv, ISHLATISH MUMKIN bo‘lgan pul, 7/30 kun kutilayotgan kirim/chiqim', input_schema: { type: 'object', properties: {} }, run: () => S().reports.treasury() },
    { name: 'get_receivables', description: 'Debitorlik ro‘yxati va aging', input_schema: { type: 'object', properties: { filter: { type: 'string', enum: ['overdue', '7', '30', '60+', 'critical', 'today'] } } }, run: (i) => ({ summary: S().receivables.summary(), aging: S().receivables.aging(), rows: S().receivables.list(i).slice(0, 40) }) },
    { name: 'get_pnl', description: 'P&L davr bo‘yicha (period: day|week|month|quarter|year yoki month: YYYY-MM)', input_schema: { type: 'object', properties: { period: { type: 'string' }, month: { type: 'string' } } }, run: (i) => S().reports.pnl(i) },
    { name: 'get_expenses', description: 'Xarajatlar xulosasi va kutilayotgan chiqim', input_schema: { type: 'object', properties: { period: { type: 'string' }, month: { type: 'string' }, days_ahead: { type: 'number' } } }, run: (i) => { const p = resolvePeriod(i); return { period: p, total: S().expenses.total(p.from, p.to), by_category: S().expenses.totalsByCategory(p.from, p.to).filter((c) => c.amount > 0), expected_outflow: S().expenses.expectedOutflow(today(), addDays(today(), i.days_ahead || 30)), pending: db.all("SELECT code, purpose, amount, department_id, required_date FROM expenses WHERE status='PENDING' AND reversed_at IS NULL") }; } },
    { name: 'get_revenue', description: 'Tan olingan daromad, avanslar, kutilayotgan daromad', input_schema: { type: 'object', properties: { period: { type: 'string' }, month: { type: 'string' } } }, run: (i) => { const p = resolvePeriod(i); return { period: p, recognized: S().revenue.recognizedInPeriod(p.from, p.to), customer_advances: S().revenue.advancesBalance(), expected_revenue: S().revenue.expectedRevenue(), monthly: S().revenue.monthlySeries(6) }; } },
    { name: 'get_forecast', description: 'Forecast (7/30/90/180/365 kun), 3 scenariy', input_schema: { type: 'object', properties: { days: { type: 'number' } } }, run: (i) => S().forecast.compute(i.days || 30) },
    { name: 'get_service_profitability', description: 'Xizmat turlari bo‘yicha rentabellik', input_schema: { type: 'object', properties: { period: { type: 'string' }, month: { type: 'string' } } }, run: (i) => S().reports.serviceProfitability(i) },
    { name: 'get_plan_fact', description: 'Plan/Fakt oy bo‘yicha', input_schema: { type: 'object', properties: { month: { type: 'string' } } }, run: (i) => S().budget.planFact(i.month || monthOf(today())) },
    { name: 'get_pending_approvals', description: 'Tasdiq kutayotgan so‘rovlar', input_schema: { type: 'object', properties: {} }, run: (_, ctx) => S().approvals.list({ status: 'PENDING' }, ctx.user) },
    { name: 'get_unmatched_transactions', description: 'Shartnoma bilan bog‘lanmagan bank tranzaksiyalari', input_schema: { type: 'object', properties: {} }, run: () => db.all("SELECT id, tx_date, amount, direction, counterparty_name, counterparty_inn, purpose, matching_status, confidence, suggested_contract_id FROM bank_transactions WHERE matching_status IN ('UNMATCHED','SUGGESTED') AND reversed_at IS NULL ORDER BY tx_date DESC LIMIT 50") },
    { name: 'get_contracts', description: 'Shartnomalar (q — qidiruv, status)', input_schema: { type: 'object', properties: { q: { type: 'string' }, status: { type: 'string' } } }, run: (i) => S().contracts.list(i).slice(0, 50).map((c) => ({ id: c.id, contract_number: c.contract_number, company: c.company_name, service: c.service_code, amount: c.amount, paid: c.paid, remaining: c.remaining, status: c.contract_status, service_status: c.service_status, due: c.next_due_date, overdue_days: c.overdue_days })) },
    { name: 'get_data_quality', description: 'Ma’lumot sifati muammolari', input_schema: { type: 'object', properties: {} }, run: () => S().reports.dataQuality() },
    { name: 'get_cash_flow', description: 'Cash flow (operating/investing/financing)', input_schema: { type: 'object', properties: { period: { type: 'string' }, month: { type: 'string' } } }, run: (i) => S().reports.cashFlow(i) },
    { name: 'propose_action', description: 'Harakat taklif qilish (AI hech qachon o‘zi bajarmaydi — inson tasdiqlaydi). action_type: MATCH_TRANSACTION|SET_EXPENSE_CATEGORY|RECOGNIZE_REVENUE|CREATE_COLLECTION_TASK|FLAG_ANOMALY', input_schema: { type: 'object', properties: { action_type: { type: 'string' }, entity_type: { type: 'string' }, entity_id: { type: 'number' }, title: { type: 'string' }, payload: { type: 'object' }, confidence: { type: 'number' } }, required: ['action_type', 'title'] }, run: (i, ctx) => svc.propose({ agent_code: 'CFO', ...i }, ctx) },
  ];
  const SYSTEM = `Sen UTAX kompaniyasining moliyaviy AI yordamchisisan (CFO Agent). Faqat tool'lardan olingan real raqamlar bilan javob ber, hech qachon raqam o'ylab topma. O'zbek tilida (lotin) qisqa, aniq, rahbar uchun tushunarli javob ber; jadval/ro'yxat formatini afzal ko'r. Summalarni "123 456 789 so‘m" ko'rinishida yoz.
Qoidalar: BANKDAGI PUL ≠ DAROMAD ≠ ISHLATISH MUMKIN BO'LGAN PUL. Cash received ≠ recognized revenue. Mijoz avanslari cheklangan pul.
AI safety: sen hech qachon tranzaksiya o'chirmaysan, pul yubormaysan, xarajat tasdiqlamaysan, shartnoma summasi/maoshni o'zgartirmaysan. Kerak bo'lsa propose_action orqali taklif qil — inson tasdiqlaydi.`;

  // LLM faqat foydalanuvchi web'da ko'ra oladigan ma'lumot tool'larini oladi
  const TOOL_PERM = {
    get_treasury: ['treasury', 'VIEW'], get_receivables: ['receivables', 'VIEW'], get_pnl: ['pnl', 'VIEW'], get_expenses: ['pnl', 'VIEW'], get_revenue: ['revenue', 'VIEW'],
    get_forecast: ['forecast', 'VIEW'], get_service_profitability: ['pnl', 'VIEW'], get_plan_fact: ['planfact', 'VIEW'], get_pending_approvals: ['approvals', 'VIEW'],
    get_unmatched_transactions: ['transactions', 'VIEW'], get_contracts: ['contracts', 'VIEW'], get_data_quality: ['dashboard', 'VIEW'], get_cash_flow: ['cashflow', 'VIEW'], propose_action: ['ai', 'CREATE'],
  };

  async function llmChat(question, ctx, history = []) {
    let Anthropic;
    try { Anthropic = (await import('@anthropic-ai/sdk')).default; } catch { return null; }
    const client = new Anthropic({ apiKey: config.anthropicKey });
    const messages = [...history.slice(-8).map((h) => ({ role: h.role, content: h.content })), { role: 'user', content: question }];
    const permitted = TOOLS.filter((t) => allowed(ctx, TOOL_PERM[t.name] || ['ai', 'VIEW']));
    const tools = permitted.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
    let firstData = null;
    for (let i = 0; i < 8; i++) {
      const response = await client.messages.create({ model: config.aiModel, max_tokens: 4096, system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }], tools, messages });
      if (response.stop_reason === 'refusal') return { answer: 'Bu so‘rovga javob bera olmayman.', data: null, engine: 'LLM' };
      if (response.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: response.content }); continue; }
      const toolUses = response.content.filter((b) => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || !toolUses.length) {
        const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        return { answer: text, data: firstData, engine: 'LLM', model: config.aiModel };
      }
      messages.push({ role: 'assistant', content: response.content });
      const results = [];
      for (const tu of toolUses) {
        const tool = permitted.find((t) => t.name === tu.name);
        let out;
        try { out = tool ? tool.run(tu.input || {}, ctx) : { error: 'unknown tool' }; if (!firstData && tool && tool.name !== 'propose_action') firstData = { kind: 'json', tool: tool.name, value: out }; }
        catch (e) { out = { error: e.message }; }
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 60000) });
      }
      messages.push({ role: 'user', content: results });
    }
    return { answer: 'Javob juda uzun bo‘lib ketdi, savolni aniqlashtiring.', data: firstData, engine: 'LLM' };
  }

  // ---------------- AGENTS ----------------
  const AGENTS = [
    { code: 'CFO', name: 'CFO agenti', description: 'Kunlik digest: pul, debitorlik, tasdiqlar, sifat', schedule: 'daily 08:30' },
    { code: 'BANK', name: 'Bank agenti', description: 'Bank/ERP integratsiyalarini sinxronlash', schedule: 'hourly' },
    { code: 'RECONCILIATION', name: 'Bog‘lash (reconciliation) agenti', description: 'Tranzaksiya ↔ shartnoma bog‘lash (taklif/auto)', schedule: 'on import + hourly' },
    { code: 'REVENUE', name: 'Daromad agenti', description: 'Obuna straight-line tan olish; yakunlangan xizmatlarni tekshirish', schedule: 'daily 01:00' },
    { code: 'EXPENSE', name: 'Xarajat agenti', description: 'Xarajatlarni kategoriyalash (past confidence → tasdiq)', schedule: 'daily' },
    { code: 'APPROVAL', name: 'Tasdiqlash agenti', description: 'Kutayotgan tasdiqlar uchun eslatma', schedule: 'hourly' },
    { code: 'CASH_FLOW', name: 'Pul oqimi agenti', description: 'Likvidlik nazorati, low liquidity alert', schedule: 'every 30m' },
    { code: 'RECEIVABLE', name: 'Debitorlik agenti', description: 'Aging hisoboti va kritik qarzdorlar', schedule: 'daily' },
    { code: 'COLLECTION', name: 'Undiruv agenti', description: 'T-7…T+15 undiruv bosqichlari, vazifalar', schedule: 'daily 08:00' },
    { code: 'PAYROLL', name: 'Oylik agenti', description: 'Oylik hisoblash muddati nazorati', schedule: 'daily 09:30' },
    { code: 'FORECAST', name: 'Prognoz agenti', description: '30/90 kunlik prognoz, risk alert', schedule: 'daily 07:00' },
    { code: 'FINANCIAL_ANALYST', name: 'Moliyaviy tahlilchi agenti', description: 'Oylik P&L tahlili va o‘zgarish sabablari', schedule: 'monthly' },
    { code: 'DATA_QUALITY', name: 'Ma’lumot sifati agenti', description: 'Noto‘liq/ziddiyatli ma’lumotlar', schedule: 'daily 08:10' },
    { code: 'AUDIT_ANOMALY', name: 'Audit va anomaliya agenti', description: 'G‘ayrioddiy tranzaksiyalar, dublikatlar, byudjet oshishi', schedule: 'daily 09:00' },
  ];
  const agentCtx = (code) => ({ user: { id: null, name: AGENTS.find((a) => a.code === code)?.name, role_code: 'AI_AGENT', agent_code: code, is_agent: true }, ip: null, source: 'AI' });

  const runners = {
    CFO(ctx) {
      const t = S().reports.treasury(), rc = S().receivables.summary(), ap = db.get("SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM approvals WHERE status='PENDING'"), dq = S().reports.dataQuality(), rec = S().reconciliation.stats();
      const body = [`Bank ${M(t.bank_balance)} · Kassa ${M(t.cash_balance)} · Avans ${M(t.customer_advances)} · Available ${M(t.available_cash)}`, `Debitorlik ${M(rc.total_receivable)} (muddati o‘tgan ${M(rc.overdue)}, kritik ${M(rc.critical)})`, `7 kun: kirim ${M(t.expected_7d_income)} / chiqim ${M(t.expected_7d_expense)}`, `Tasdiq kutmoqda: ${ap.n} ta (${M(ap.s)}) · Bog‘lanmagan tx: ${(rec.unmatched || 0) + (rec.suggested || 0)} · Sifat muammolari: ${dq.total}`].join('\n');
      S().notifications.notify({ roles: ['FOUNDER', 'CEO', 'CFO'], type: 'DAILY_DIGEST', title: `CFO digest ${today()}`, body, dedupe_key: `digest:${today()}` });
      return { digest: body };
    },
    async BANK(ctx) {
      const out = [];
      for (const i of db.all("SELECT * FROM integrations WHERE is_active=1 AND type IN ('BANK_API','GOOGLE_SHEETS','ONE_C','ERP')")) { try { out.push({ integration: i.name, ...(await S().integrations.sync(i, ctx)) }); } catch (e) { out.push({ integration: i.name, error: e.message }); } }
      return { synced: out };
    },
    RECONCILIATION(ctx) {
      const res = S().reconciliation.runAll(ctx);
      for (const t of db.all("SELECT t.*, c.contract_number FROM bank_transactions t LEFT JOIN contracts c ON c.id=t.suggested_contract_id WHERE t.matching_status='SUGGESTED' AND t.reversed_at IS NULL")) {
        svc.propose({ agent_code: 'RECONCILIATION', action_type: 'MATCH_TRANSACTION', entity_type: 'bank_transaction', entity_id: t.id, title: `Tranzaksiya ${t.tx_date} ${M(t.amount)} → ${t.contract_number}`, payload: { transaction_id: t.id, contract_id: t.suggested_contract_id }, confidence: t.confidence }, ctx, `match:${t.id}:${t.suggested_contract_id}`);
      }
      const un = db.get("SELECT COUNT(*) n FROM bank_transactions WHERE matching_status IN ('UNMATCHED','SUGGESTED') AND reversed_at IS NULL").n;
      if (un) S().notifications.notify({ roles: ['ACCOUNTANT', 'FINANCE_MANAGER'], type: 'UNMATCHED_TRANSACTION', severity: 'WARNING', title: `${un} ta tranzaksiya bog‘lanmagan`, body: 'Reconciliation sahifasida tasdiqlang', dedupe_key: `unmatched:${today()}:${un}` });
      return res;
    },
    REVENUE(ctx) {
      const sl = S().revenue.runStraightLine(today(), ctx);
      const noAct = db.all("SELECT c.id, c.contract_number FROM contracts c JOIN service_types st ON st.id=c.service_type_id WHERE c.service_status='COMPLETED' AND st.recognition_rule LIKE '%\"require_acceptance_document\":true%' AND NOT EXISTS (SELECT 1 FROM contract_documents d WHERE d.contract_id=c.id AND d.doc_type='ACT')");
      for (const c of noAct) S().notifications.notify({ roles: ['FINANCE_MANAGER', 'SALES'], type: 'MISSING_DOCUMENT', severity: 'WARNING', title: `Akt kerak: ${c.contract_number}`, body: 'Xizmat yakunlangan, daromad tan olish uchun qabul akti biriktiring', entity_type: 'contract', entity_id: c.id, dedupe_key: `act:${c.id}:${today()}` });
      const expired = db.all("SELECT id, contract_number FROM contracts WHERE end_date < ? AND service_status='IN_PROGRESS' AND contract_status NOT IN ('CANCELLED','CLOSED')", today());
      for (const c of expired) svc.propose({ agent_code: 'REVENUE', action_type: 'REVIEW_CONTRACT', entity_type: 'contract', entity_id: c.id, title: `${c.contract_number}: muddat tugagan — xizmat yakunlanganmi?`, payload: { contract_id: c.id }, confidence: 60 }, ctx, `review:${c.id}`);
      return { straight_line: sl.length, missing_act: noAct.length, expired_in_progress: expired.length };
    },
    EXPENSE(ctx) {
      let set = 0, proposed = 0;
      for (const e of db.all("SELECT * FROM expenses WHERE reversed_at IS NULL AND (category_id IS NULL OR category_source='AI_RULE_UNCONFIRMED')")) {
        const s = S().expenses.suggestCategory(`${e.purpose} ${e.counterparty || ''}`);
        if (!s.category_id) continue;
        if (s.confidence >= Number(settings.get('expense.category_confidence_threshold') || 0.8)) { db.run("UPDATE expenses SET category_id=?, category_confidence=?, category_source='AI_RULE' WHERE id=?", s.category_id, s.confidence, e.id); audit(ctx, { action: 'AI_CATEGORIZED', entity: 'expense', entityId: e.id, newValue: s, aiAgentCode: 'EXPENSE' }); set++; }
        else { svc.propose({ agent_code: 'EXPENSE', action_type: 'SET_EXPENSE_CATEGORY', entity_type: 'expense', entity_id: e.id, title: `${e.code}: kategoriya → ${s.name}?`, payload: { expense_id: e.id, category_id: s.category_id }, confidence: Math.round(s.confidence * 100) }, ctx, `cat:${e.id}:${s.category_id}`); proposed++; }
      }
      return { categorized: set, proposed };
    },
    APPROVAL(ctx) {
      const hours = Number(settings.get('approvals.reminder_hours') || 24);
      const stale = S().approvals.list({ status: 'PENDING' }, null).filter((a) => (Date.now() - new Date(a.updated_at || a.created_at)) / 3600000 >= hours);
      for (const a of stale) S().notifications.notify({ roles: [a.steps[a.current_step]?.role], department_id: a.department_id, type: 'APPROVAL_WAITING', severity: 'WARNING', title: `Eslatma: ${a.title}`, body: `${M(a.amount)} — ${Math.round((Date.now() - new Date(a.created_at)) / 3600000)} soatdan beri kutmoqda`, entity_type: 'approval', entity_id: a.id, dedupe_key: `apr-remind:${a.id}:${today()}` });
      return { reminded: stale.length };
    },
    CASH_FLOW(ctx) {
      const t = S().reports.treasury();
      if (t.low_liquidity) S().notifications.notify({ roles: ['FOUNDER', 'CEO', 'CFO'], type: 'LOW_LIQUIDITY', severity: 'CRITICAL', title: 'Likvidlik past!', body: `Available ${M(t.available_cash)} < chegara ${M(settings.get('cash.low_liquidity_threshold'))}`, dedupe_key: `lowliq:${today()}` });
      if (t.expected_7d_expense > t.available_cash + t.expected_7d_income) S().notifications.notify({ roles: ['CFO'], type: 'FORECAST_RISK', severity: 'WARNING', title: '7 kunlik chiqim available + kirimdan katta', body: `Chiqim ${M(t.expected_7d_expense)} vs ${M(t.available_cash + t.expected_7d_income)}`, dedupe_key: `7d-risk:${today()}` });
      return { available: t.available_cash, low_liquidity: t.low_liquidity };
    },
    RECEIVABLE(ctx) {
      const a = S().receivables.aging(), s = S().receivables.summary();
      S().notifications.notify({ roles: ['CFO', 'FINANCE_MANAGER'], type: 'PAYMENT_OVERDUE', severity: s.critical > 0 ? 'WARNING' : 'INFO', title: `Debitorlik: ${M(s.total_receivable)}, muddati o‘tgan ${M(s.overdue)}`, body: a.buckets.map((b) => `${b.label}: ${fmt(b.amount)}`).join(' · '), dedupe_key: `aging:${today()}` });
      return { aging: a, summary: { total: s.total_receivable, overdue: s.overdue, critical: s.critical } };
    },
    COLLECTION(ctx) { return S().receivables.runCollectionAgent(today(), ctx); },
    PAYROLL(ctx) {
      const period = monthOf(today());
      const payDay = Number(settings.get('payroll.pay_day') || 10);
      const prev = addMonths(period, -1);
      const prevRows = db.get('SELECT COUNT(*) n FROM payrolls WHERE period=?', prev).n;
      const dayOfMonth = Number(today().slice(8));
      if (!prevRows && dayOfMonth >= 1) { svc.propose({ agent_code: 'PAYROLL', action_type: 'COMPUTE_PAYROLL', entity_type: 'payroll', title: `Oylik ${prev} hisoblansinmi?`, payload: { period: prev }, confidence: 90 }, ctx, `payroll:${prev}`); }
      if (dayOfMonth >= payDay - 3 && db.get("SELECT COUNT(*) n FROM payrolls WHERE period=? AND status IN ('DRAFT','SUBMITTED')", prev).n) S().notifications.notify({ roles: ['CFO', 'ACCOUNTANT'], type: 'PAYROLL_READY', severity: 'WARNING', title: `Oylik ${prev} hali tasdiqlanmagan`, body: `To‘lov kuni ${payDay}`, dedupe_key: `payroll-late:${prev}:${today()}` });
      return { period_checked: prev, computed: prevRows > 0 };
    },
    FORECAST(ctx) {
      const f30 = S().forecast.compute(30), f90 = S().forecast.compute(90);
      if (f30.risk === 'HIGH' || f90.risk === 'HIGH') S().notifications.notify({ roles: ['FOUNDER', 'CEO', 'CFO'], type: 'FORECAST_RISK', severity: 'CRITICAL', title: `Forecast risk: ${f30.risk === 'HIGH' ? '30' : '90'} kun`, body: `Conservative available: ${M((f30.risk === 'HIGH' ? f30 : f90).scenarios.conservative.projected_available)}`, dedupe_key: `fc-risk:${today()}` });
      return { risk_30: f30.risk, risk_90: f90.risk, base_30: f30.scenarios.base.projected_cash };
    },
    FINANCIAL_ANALYST(ctx) {
      const res = handlers.WHY_PROFIT('o‘tgan oy');
      S().notifications.notify({ roles: ['FOUNDER', 'CEO', 'CFO'], type: 'DAILY_DIGEST', title: `Oylik tahlil: ${addMonths(monthOf(today()), -1)}`, body: res.answer.slice(0, 1500), dedupe_key: `analyst:${addMonths(monthOf(today()), -1)}` });
      return { analysis: res.answer };
    },
    DATA_QUALITY(ctx) {
      const dq = S().reports.dataQuality();
      for (const i of dq.issues) if (i.severity !== 'INFO') S().notifications.notify({ roles: ['FINANCE_MANAGER', 'ACCOUNTANT', 'CFO'], type: 'MISSING_CONTRACT_INFO', severity: i.severity, title: `⚠️ ${i.title} (${i.count})`, body: i.items.slice(0, 5).map((x) => x.label).join('; '), dedupe_key: `dq:${i.code}:${today()}` });
      return dq;
    },
    AUDIT_ANOMALY(ctx) {
      const since = addDays(today(), -90);
      const stats = db.get('SELECT AVG(amount) mean, COUNT(*) n FROM bank_transactions WHERE reversed_at IS NULL AND tx_date>=?', since);
      const rows = db.all('SELECT * FROM bank_transactions WHERE reversed_at IS NULL AND tx_date>=?', since);
      const mean = stats.mean || 0, sd = Math.sqrt(rows.reduce((s, x) => s + (x.amount - mean) ** 2, 0) / Math.max(1, rows.length));
      const findings = [];
      for (const t of rows) if (rows.length > 10 && t.amount > mean + 3 * sd) findings.push({ type: 'LARGE_AMOUNT', tx: t.id, label: `${t.tx_date} ${M(t.amount)} ${t.counterparty_name || ''}` });
      const dups = db.all(`SELECT a.id id1, b.id id2, a.amount, a.counterparty_name, a.tx_date FROM bank_transactions a JOIN bank_transactions b ON b.id>a.id AND b.amount=a.amount AND COALESCE(b.counterparty_name,'')=COALESCE(a.counterparty_name,'') AND b.direction=a.direction AND abs(julianday(b.tx_date)-julianday(a.tx_date))<=3 WHERE a.reversed_at IS NULL AND b.reversed_at IS NULL AND a.tx_date>=?`, since);
      for (const d of dups) findings.push({ type: 'DUPLICATE', tx: d.id2, label: `${d.tx_date} ${M(d.amount)} ${d.counterparty_name || ''} (#${d.id1} & #${d.id2})` });
      const { from, to } = monthRange(monthOf(today()));
      for (const b of db.all(`SELECT b.*, d.name dept, ec.name cat, COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.reversed_at IS NULL AND e.status IN ('APPROVED','PAID') AND e.expense_date BETWEEN ? AND ? AND (b.department_id IS NULL OR e.department_id=b.department_id) AND (b.category_id IS NULL OR e.category_id=b.category_id)),0) fact FROM budgets b LEFT JOIN departments d ON d.id=b.department_id LEFT JOIN expense_categories ec ON ec.id=b.category_id WHERE b.period=?`, from, to, monthOf(today())).filter((x) => x.fact > x.amount)) {
        findings.push({ type: 'BUDGET_EXCEEDED', label: `${b.dept || ''} ${b.cat || ''}: ${M(b.fact)} > ${M(b.amount)}` });
        S().notifications.notify({ roles: ['CFO', 'DEPARTMENT_HEAD'], department_id: b.department_id, type: 'BUDGET_EXCEEDED', severity: 'WARNING', title: `Byudjet oshdi: ${b.dept || ''} ${b.cat || ''}`, body: `${M(b.fact)} > ${M(b.amount)}`, dedupe_key: `budget:${b.id}:${monthOf(today())}` });
      }
      for (const f of findings.filter((x) => x.tx)) svc.propose({ agent_code: 'AUDIT_ANOMALY', action_type: 'FLAG_ANOMALY', entity_type: 'bank_transaction', entity_id: f.tx, title: `${f.type}: ${f.label}`, payload: { transaction_id: f.tx, type: f.type }, confidence: f.type === 'DUPLICATE' ? 85 : 60 }, ctx, `anom:${f.type}:${f.tx}`);
      if (findings.length) S().notifications.notify({ roles: ['CFO', 'AUDITOR'], type: 'UNUSUAL_TRANSACTION', severity: 'WARNING', title: `${findings.length} ta g‘ayrioddiy holat`, body: findings.slice(0, 5).map((f) => f.label).join('; '), dedupe_key: `anomaly:${today()}:${findings.length}` });
      return { findings };
    },
  };

  // ---------------- AI ACTIONS (propose → human approve → execute → audit) ----------------
  const EXECUTORS = {
    MATCH_TRANSACTION: (p, ctx) => S().reconciliation.confirm(p.transaction_id, p.contract_id, ctx, { reason: 'AI proposal approved' }),
    SET_EXPENSE_CATEGORY: (p, ctx) => S().expenses.update(p.expense_id, { category_id: p.category_id }, ctx),
    RECOGNIZE_REVENUE: (p, ctx) => S().revenue.recognize({ contract_id: p.contract_id, amount: p.amount, date: p.date, method: p.method || 'MILESTONE', ctx }),
    COMPUTE_PAYROLL: (p, ctx) => ({ rows: S().payroll.compute(p.period, ctx).length }),
    CREATE_COLLECTION_TASK: (p, ctx) => S().receivables.runCollectionAgent(today(), ctx),
    FLAG_ANOMALY: (p, ctx) => { db.run("UPDATE bank_transactions SET tx_type=COALESCE(tx_type,'')||' [FLAGGED]' WHERE id=?", p.transaction_id); return { flagged: p.transaction_id }; },
    REVIEW_CONTRACT: (p) => ({ reviewed: p.contract_id }),
  };
  const svc = {
    route, llmChat, AGENTS,
    propose(a, ctx, key) {
      const dedupe = key ? sha256(key) : null;
      if (dedupe && db.get("SELECT id FROM ai_actions WHERE status='PROPOSED' AND payload LIKE ?", `%"__k":"${dedupe}"%`)) return null;
      const id = db.insert('ai_actions', { agent_code: a.agent_code || 'CFO', action_type: a.action_type, entity_type: a.entity_type || null, entity_id: a.entity_id || null, title: a.title, payload: JSON.stringify({ ...(a.payload || {}), __k: dedupe }), confidence: a.confidence ?? null, status: 'PROPOSED', proposed_at: nowIso() });
      audit(ctx, { action: 'AI_PROPOSED', entity: 'ai_action', entityId: id, newValue: { type: a.action_type, title: a.title }, aiAgentCode: a.agent_code });
      return { id, status: 'PROPOSED' };
    },
    decideAction(id, decision, ctx) {
      const a = db.get('SELECT * FROM ai_actions WHERE id=?', id);
      if (!a) throw notFound();
      if (a.status !== 'PROPOSED') throw badRequest('Allaqachon hal qilingan');
      if (ctx.user.role_code === 'AI_AGENT') throw forbidden('AI o‘z taklifini tasdiqlay olmaydi');
      if (decision === 'REJECT') { db.run('UPDATE ai_actions SET status=?, decided_by=?, decided_at=? WHERE id=?', 'REJECTED', ctx.user.id, nowIso(), id); audit(ctx, { action: 'AI_ACTION_REJECTED', entity: 'ai_action', entityId: id, aiAgentCode: a.agent_code }); return db.get('SELECT * FROM ai_actions WHERE id=?', id); }
      const payload = parseJson(a.payload, {});
      let result;
      try { result = EXECUTORS[a.action_type] ? EXECUTORS[a.action_type](payload, ctx) : { error: 'no executor' }; db.run('UPDATE ai_actions SET status=?, decided_by=?, decided_at=?, executed_at=?, result=? WHERE id=?', 'EXECUTED', ctx.user.id, nowIso(), nowIso(), JSON.stringify(result).slice(0, 4000), id); }
      catch (e) { db.run('UPDATE ai_actions SET status=?, decided_by=?, decided_at=?, result=? WHERE id=?', 'FAILED', ctx.user.id, nowIso(), e.message, id); throw e; }
      audit(ctx, { action: 'AI_ACTION_EXECUTED', entity: 'ai_action', entityId: id, newValue: { type: a.action_type, payload }, aiAgentCode: a.agent_code });
      return db.get('SELECT * FROM ai_actions WHERE id=?', id);
    },
    async runAgent(code, ctx) {
      const ag = db.get('SELECT * FROM ai_agents WHERE code=?', code);
      if (!ag) throw notFound('Agent topilmadi');
      if (!ag.is_active) return { skipped: 'inactive' };
      const c = ctx?.user ? ctx : agentCtx(code);
      const result = await runners[code]?.(c);
      db.run('UPDATE ai_agents SET last_run_at=?, last_result=? WHERE code=?', nowIso(), JSON.stringify(result || {}).slice(0, 4000), code);
      audit(c, { action: 'AGENT_RUN', entity: 'ai_agent', entityId: ag.id, newValue: result && typeof result === 'object' ? Object.fromEntries(Object.entries(result).filter(([k]) => !['tasks', 'issues', 'findings', 'aging', 'digest', 'analysis'].includes(k))) : result, aiAgentCode: code });
      return result;
    },
    async chat(question, ctx, { channel = 'WEB', history = [] } = {}) {
      let res = null;
      if (config.anthropicKey && settings.get('ai.allow_llm')) { try { res = await llmChat(question, ctx, history); } catch (e) { res = null; console.error('[ai] LLM error:', e.message); } }
      if (!res) res = { ...route(question, ctx), engine: 'RULES' };
      db.insert('ai_conversations', { user_id: ctx.user?.id || null, channel, question, answer: res.answer, intent: res.intent || null, engine: res.engine, created_at: nowIso() });
      return res;
    },
    seedAgents() { for (const a of AGENTS) { db.run('INSERT OR IGNORE INTO ai_agents (code,name,description,schedule,permissions) VALUES (?,?,?,?,?)', a.code, a.name, a.description, a.schedule, JSON.stringify(['VIEW', 'PROPOSE'])); db.run('UPDATE ai_agents SET name=?, description=? WHERE code=?', a.name, a.description, a.code); } },
    agentCtx,
    listAgents() { return db.all('SELECT * FROM ai_agents ORDER BY id').map((a) => ({ ...a, api_key_hash: undefined, has_api_key: !!a.api_key_hash, permissions: parseJson(a.permissions, []), last_result: parseJson(a.last_result, null), proposed: db.get("SELECT COUNT(*) n FROM ai_actions WHERE agent_code=? AND status='PROPOSED'", a.code).n })); },
    listActions(status) {
      return db.all(`SELECT a.*, u.name AS decided_by_name FROM ai_actions a LEFT JOIN users u ON u.id=a.decided_by ${status ? 'WHERE a.status=?' : ''} ORDER BY a.id DESC LIMIT 300`, ...(status ? [status] : [])).map((a) => { const p = parseJson(a.payload, {}); delete p.__k; return { ...a, payload: p }; });
    },
    getAction(id) { const a = db.get('SELECT * FROM ai_actions WHERE id=?', id); if (!a) return null; const p = parseJson(a.payload, {}); delete p.__k; return { ...a, payload: p }; },
  };
  app.services.ai = svc;
  svc.seedAgents();

  r.post('/api/ai/chat', { perm: ['ai', 'CREATE'], tags: ['ai'], summary: 'AI Finance chat (rule-based + LLM)' }, async (ctx) => {
    const q = String(ctx.body?.message || ctx.body?.question || '').trim();
    if (!q) throw badRequest('message kerak');
    return svc.chat(q, ctx, { history: ctx.body?.history || [] });
  });
  r.post('/api/ai/confirm', { perm: ['approvals', 'APPROVE'], tags: ['ai'], summary: 'Chat orqali taklif qilingan harakatni tasdiqlash {approval_id}' }, async (ctx) => {
    if (!ctx.body?.approval_id) throw badRequest('approval_id kerak');
    return S().approvals.decide(ctx.body.approval_id, 'APPROVE', { ...ctx, source: ctx.source || 'AI_CHAT' }, ctx.body.comment || 'AI chat orqali tasdiqlandi');
  });
  r.get('/api/ai/history', { perm: ['ai', 'VIEW'], tags: ['ai'], summary: 'Chat tarixi' }, async (ctx) => db.all('SELECT * FROM ai_conversations WHERE user_id=? ORDER BY id DESC LIMIT 50', ctx.user.id).reverse());
  r.get('/api/ai/agents', { perm: ['ai', 'VIEW'], tags: ['ai'], summary: 'AI agentlar va oxirgi natijalari' }, async () => svc.listAgents());
  r.post('/api/ai/agents/:code/run', { perm: ['ai', 'CREATE'], tags: ['ai'], summary: 'Agentni qo‘lda ishga tushirish' }, async (ctx) => ({ result: await svc.runAgent(ctx.params.code, agentCtx(ctx.params.code)) }));
  r.patch('/api/ai/agents/:code', { perm: ['ai', 'EDIT'], tags: ['ai'], summary: 'Agentni yoqish/o‘chirish, API kalit yaratish' }, async (ctx) => {
    const ag = db.get('SELECT * FROM ai_agents WHERE code=?', ctx.params.code);
    if (!ag) throw notFound();
    let apiKey = null;
    if (ctx.body?.is_active !== undefined) db.run('UPDATE ai_agents SET is_active=? WHERE id=?', ctx.body.is_active ? 1 : 0, ag.id);
    if (ctx.body?.rotate_api_key) { apiKey = 'uta_' + uid(24); db.run('UPDATE ai_agents SET api_key_hash=? WHERE id=?', sha256(apiKey), ag.id); }
    audit(ctx, { action: 'AGENT_UPDATED', entity: 'ai_agent', entityId: ag.id, newValue: { is_active: ctx.body?.is_active, key_rotated: !!apiKey } });
    return { ...db.get('SELECT id, code, name, is_active FROM ai_agents WHERE id=?', ag.id), api_key: apiKey };
  });
  r.get('/api/ai/actions', { perm: ['ai', 'VIEW'], tags: ['ai'], summary: 'AI takliflari (PROPOSED/EXECUTED/REJECTED)', query: ['status'] }, async (ctx) => svc.listActions(ctx.query.status));
  r.post('/api/ai/actions/:id/approve', { perm: ['ai', 'APPROVE'], tags: ['ai'], summary: 'AI taklifini tasdiqlash → tizim bajaradi → audit' }, async (ctx) => svc.decideAction(ctx.params.id, 'APPROVE', ctx));
  r.post('/api/ai/actions/:id/reject', { perm: ['ai', 'REJECT'], tags: ['ai'], summary: 'AI taklifini rad etish' }, async (ctx) => svc.decideAction(ctx.params.id, 'REJECT', ctx));
}
