import { today, round2, addDays, daysBetween, resolvePeriod, monthOf, addMonths, monthRange, pct, sum } from '../core/util.mjs';

export const GROUP_LABELS = { DIRECT: 'To‘g‘ridan-to‘g‘ri xarajatlar', PAYROLL: 'Oylik (xodimlar)', MARKETING: 'Marketing', ADMIN: 'Ma’muriy', IT: 'IT va aloqa', OFFICE: 'Ofis xarajatlari', OTHER_OPEX: 'Boshqa operatsion', TAX: 'Soliqlar', OTHER: 'Boshqa' };
export function register(app) {
  const { r, db, settings } = app;
  const S = () => app.services;

  const svc = {
    /** TREASURY — Founder savoli: hozir xavfsiz qancha pul olish mumkin? */
    treasury(asOf = today()) {
      const bank = S().banking.bankBalance(asOf), cash = S().banking.cashBalance(asOf);
      const total = round2(bank.total + cash.total);
      const advances = round2(S().revenue.advancesBalance());
      const restrictionPct = Number(settings.get('cash.advance_restriction_pct') ?? 100);
      const restricted = round2(advances * restrictionPct / 100);
      const approvedUnpaid = settings.get('cash.reserve_approved_unpaid_expenses') ? round2(S().expenses.approvedUnpaid().s) : 0;
      const payrollReserve = settings.get('cash.reserve_pending_payroll') ? round2(S().payroll.pendingPayrollReserve()) : 0;
      const safety = round2(Number(settings.get('cash.safety_reserve') || 0));
      const reserved = round2(approvedUnpaid + payrollReserve + safety);
      const available = round2(total - restricted - reserved);
      const rc = S().receivables.summary(asOf);
      const out7 = S().expenses.expectedOutflow(asOf, addDays(asOf, 7)), out30 = S().expenses.expectedOutflow(asOf, addDays(asOf, 30));
      const low = available < Number(settings.get('cash.low_liquidity_threshold') || 0);
      return {
        as_of: asOf, bank_balance: bank.total, cash_balance: cash.total, total_cash: total, customer_advances: advances, restricted_cash: restricted,
        reserved: { approved_unpaid_expenses: approvedUnpaid, pending_payroll: payrollReserve, safety_reserve: safety, total: reserved },
        available_cash: available, safe_withdrawal: round2(Math.max(0, available - out30.total + rc.expected_30d * 0.5)),
        expected_7d_income: rc.expected_7d, expected_7d_expense: out7.total, expected_30d_income: rc.expected_30d, expected_30d_expense: out30.total,
        overdue_receivable: rc.overdue, low_liquidity: low, accounts: { bank: bank.accounts, cash: cash.accounts },
        formula: `Available = Total (${total}) − Advances×${restrictionPct}% (${restricted}) − Reserved (${reserved})`,
      };
    },
    /** P&L — accrual: recognized revenue − expenses by group */
    pnl(q = {}) {
      const p = resolvePeriod(q);
      const revenue = round2(S().revenue.recognizedInPeriod(p.from, p.to));
      const groups = Object.fromEntries(S().expenses.totalsByGroup(p.from, p.to).map((g) => [g.pnl_group, round2(g.amount)]));
      const g = (k) => groups[k] || 0;
      const direct = g('DIRECT');
      const gross = round2(revenue - direct);
      const opexKeys = ['PAYROLL', 'MARKETING', 'ADMIN', 'IT', 'OFFICE', 'OTHER_OPEX'];
      const opex = round2(opexKeys.reduce((s, k) => s + g(k), 0));
      const operating = round2(gross - opex);
      const taxes = g('TAX'), other = g('OTHER');
      const net = round2(operating - taxes - other);
      const lines = [
        { key: 'REVENUE', label: 'Daromad (tan olingan)', amount: revenue, kind: 'total' },
        { key: 'DIRECT', label: '− To‘g‘ridan-to‘g‘ri xarajatlar', amount: -direct },
        { key: 'GROSS', label: '= Yalpi foyda (gross profit)', amount: gross, kind: 'total', margin: pct(gross, revenue) },
        ...opexKeys.map((k) => ({ key: k, label: '− ' + GROUP_LABELS[k], amount: -g(k) })),
        { key: 'OPERATING', label: '= Operatsion foyda', amount: operating, kind: 'total', margin: pct(operating, revenue) },
        { key: 'TAX', label: '− Soliqlar', amount: -taxes }, { key: 'OTHER', label: '− Boshqa xarajatlar', amount: -other },
        { key: 'NET', label: '= Sof foyda (net profit)', amount: net, kind: 'total', margin: pct(net, revenue) },
      ];
      // oldingi davr bilan taqqoslash
      const len = daysBetween(p.from, p.to) + 1;
      const prev = { from: addDays(p.from, -len), to: addDays(p.from, -1) };
      const prevRevenue = round2(S().revenue.recognizedInPeriod(prev.from, prev.to));
      const prevExp = round2(S().expenses.total(prev.from, prev.to));
      const byService = S().revenue.recognizedInPeriod ? db.all(`SELECT st.code, st.name, st.color, COALESCE(SUM(rr.amount),0) revenue FROM service_types st LEFT JOIN contracts c ON c.service_type_id=st.id LEFT JOIN revenue_recognition rr ON rr.contract_id=c.id AND rr.status='RECOGNIZED' AND rr.recognized_at BETWEEN ? AND ? GROUP BY st.id ORDER BY st.sort`, p.from, p.to) : [];
      const monthly = [];
      let mp = addMonths(monthOf(p.to), -5);
      for (let i = 0; i < 6; i++) { const { from, to } = monthRange(mp); const rv = round2(S().revenue.recognizedInPeriod(from, to)); const ex = round2(S().expenses.total(from, to)); monthly.push({ period: mp, revenue: rv, expense: ex, profit: round2(rv - ex) }); mp = addMonths(mp, 1); }
      return { period: p, lines, totals: { revenue, direct, gross, opex, operating, taxes, other, net, net_margin: pct(net, revenue) }, by_category: S().expenses.totalsByCategory(p.from, p.to).filter((c) => c.amount > 0), by_service: byService, previous: { ...prev, revenue: prevRevenue, expense: prevExp, net: round2(prevRevenue - prevExp) }, monthly };
    },
    /** Xizmat rentabelligi — "Sporniy xizmatini davom ettirish foydalimi?" */
    serviceProfitability(q = {}) {
      const p = resolvePeriod(q);
      const types = db.all('SELECT * FROM service_types WHERE is_active=1 ORDER BY sort');
      const totalRevenue = round2(S().revenue.recognizedInPeriod(p.from, p.to));
      const sharedOpex = db.get(`SELECT COALESCE(SUM(e.amount),0) s FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id LEFT JOIN departments d ON d.id=e.department_id
        WHERE e.reversed_at IS NULL AND e.status IN ('APPROVED','PAID') AND e.expense_date BETWEEN ? AND ? AND e.contract_id IS NULL AND e.service_type_id IS NULL AND (d.service_type_id IS NULL) AND COALESCE(ec.pnl_group,'OTHER_OPEX') NOT IN ('DIRECT','PAYROLL')`, p.from, p.to).s;
      const rows = types.map((st) => {
        const revenue = round2(S().revenue.recognizedInPeriod(p.from, p.to, st.id));
        const direct = db.get(`SELECT COALESCE(SUM(e.amount),0) s FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id LEFT JOIN contracts c ON c.id=e.contract_id
          WHERE e.reversed_at IS NULL AND e.status IN ('APPROVED','PAID') AND e.expense_date BETWEEN ? AND ? AND (c.service_type_id=? OR e.service_type_id=?) AND COALESCE(ec.pnl_group,'OTHER_OPEX')<>'PAYROLL'`, p.from, p.to, st.id, st.id).s;
        const payroll = db.get(`SELECT COALESCE(SUM(e.amount),0) s FROM expenses e JOIN expense_categories ec ON ec.id=e.category_id JOIN departments d ON d.id=e.department_id
          WHERE e.reversed_at IS NULL AND e.status IN ('APPROVED','PAID') AND e.expense_date BETWEEN ? AND ? AND ec.pnl_group='PAYROLL' AND d.service_type_id=?`, p.from, p.to, st.id).s;
        const deptOpex = db.get(`SELECT COALESCE(SUM(e.amount),0) s FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id JOIN departments d ON d.id=e.department_id
          WHERE e.reversed_at IS NULL AND e.status IN ('APPROVED','PAID') AND e.expense_date BETWEEN ? AND ? AND d.service_type_id=? AND e.contract_id IS NULL AND e.service_type_id IS NULL AND COALESCE(ec.pnl_group,'OTHER_OPEX') NOT IN ('PAYROLL','DIRECT')`, p.from, p.to, st.id).s;
        const allocated = round2(totalRevenue ? sharedOpex * revenue / totalRevenue : 0);
        const grossProfit = round2(revenue - direct);
        const netProfit = round2(grossProfit - payroll - deptOpex - allocated);
        const contracts = db.get("SELECT COUNT(*) n FROM contracts WHERE service_type_id=? AND contract_status NOT IN ('DRAFT','CANCELLED') AND contract_date BETWEEN ? AND ?", st.id, p.from, p.to).n;
        return { code: st.code, name: st.name, color: st.color, revenue, direct_expense: round2(direct), payroll: round2(payroll), dept_opex: round2(deptOpex), allocated_opex: allocated, gross_profit: grossProfit, net_profit: netProfit, margin: pct(netProfit, revenue), gross_margin: pct(grossProfit, revenue), contracts, verdict: revenue === 0 ? 'NO_DATA' : netProfit < 0 ? 'LOSS' : pct(netProfit, revenue) < 15 ? 'LOW' : 'OK' };
      });
      return { period: p, shared_opex: round2(sharedOpex), total_revenue: totalRevenue, rows: rows.sort((a, b) => b.net_profit - a.net_profit) };
    },
    /** CASH FLOW — operating / investing / financing, opening → closing */
    cashFlow(q = {}) {
      const p = resolvePeriod(q);
      const opening = round2(S().banking.bankBalance(addDays(p.from, -1)).total + S().banking.cashBalance(addDays(p.from, -1)).total);
      const closing = round2(S().banking.bankBalance(p.to).total + S().banking.cashBalance(p.to).total);
      const cls = (c) => {
        const b = db.get(`SELECT COALESCE(SUM(CASE WHEN direction='INCOME' THEN amount END),0) inc, COALESCE(SUM(CASE WHEN direction='EXPENSE' THEN amount END),0) exp FROM bank_transactions WHERE reversed_at IS NULL AND cf_class=? AND tx_date BETWEEN ? AND ?`, c, p.from, p.to);
        const k = db.get(`SELECT COALESCE(SUM(CASE WHEN direction='INCOME' THEN amount END),0) inc, COALESCE(SUM(CASE WHEN direction='EXPENSE' THEN amount END),0) exp FROM cash_transactions WHERE reversed_at IS NULL AND cf_class=? AND tx_date BETWEEN ? AND ?`, c, p.from, p.to);
        return { inflow: round2(b.inc + k.inc), outflow: round2(b.exp + k.exp), net: round2(b.inc + k.inc - b.exp - k.exp) };
      };
      const operating = cls('OPERATING'), investing = cls('INVESTING'), financing = cls('FINANCING');
      const IGN = { LOAN: 'Kredit / ta’sischi mablag‘i', REFUND: 'Qaytarilgan mablag‘', INTEREST: 'Bank foizlari', OTHER_INCOME: 'Boshqa kirim', OTHER: 'Boshqa kirim', REVERSAL: 'Tuzatish yozuvi', PAYROLL: 'Oylik', NON_CONTRACT: 'Shartnomasiz kirim' };
      const inflowDetail = db.all(`SELECT CASE WHEN matching_status='MATCHED' AND matched_contract_id IS NOT NULL THEN 'Mijoz to‘lovlari' WHEN matching_status='IGNORED' THEN COALESCE(ignore_reason,'OTHER') ELSE 'Bog‘lanmagan kirim' END AS name, SUM(amount) amount FROM bank_transactions WHERE reversed_at IS NULL AND direction='INCOME' AND tx_date BETWEEN ? AND ? GROUP BY 1 ORDER BY amount DESC`, p.from, p.to).map((x) => ({ ...x, name: IGN[x.name] || x.name }));
      const outflowDetail = db.all(`SELECT COALESCE(ec.name, CASE WHEN t.matching_status='IGNORED' THEN COALESCE(t.ignore_reason,'OTHER') ELSE 'Bog‘lanmagan chiqim' END) AS name, SUM(t.amount) amount FROM bank_transactions t LEFT JOIN expenses e ON e.id=t.matched_expense_id LEFT JOIN expense_categories ec ON ec.id=e.category_id WHERE t.reversed_at IS NULL AND t.direction='EXPENSE' AND t.tx_date BETWEEN ? AND ? GROUP BY 1 ORDER BY amount DESC`, p.from, p.to).map((x) => ({ ...x, name: IGN[x.name] || x.name }));
      return { period: p, opening_cash: opening, operating, investing, financing, total_inflow: round2(operating.inflow + investing.inflow + financing.inflow), total_outflow: round2(operating.outflow + investing.outflow + financing.outflow), closing_cash: closing, net_change: round2(closing - opening), inflow_detail: inflowDetail, outflow_detail: outflowDetail, monthly: S().banking.monthlyFlows(6, p.to) };
    },
    /** BALANS (soddalashtirilgan boshqaruv balansi) */
    balance(asOf = today()) {
      const bank = S().banking.bankBalance(asOf).total, cash = S().banking.cashBalance(asOf).total;
      // AR: tan olingan lekin pul kelmagan qism
      const ar = round2(db.get(`SELECT COALESCE(SUM(x.ar),0) s FROM (SELECT c.id, MAX(0, COALESCE((SELECT SUM(rr.amount) FROM revenue_recognition rr WHERE rr.contract_id=c.id AND rr.status='RECOGNIZED' AND rr.recognized_at<=?),0) - COALESCE((SELECT SUM(re.amount) FROM revenue_events re WHERE re.contract_id=c.id AND re.state='RECOGNIZED_REVENUE' AND re.event_date<=?),0)) AS ar FROM contracts c) x`, asOf, asOf).s);
      const contractBacklog = round2(S().receivables.summary(asOf).total_receivable);
      const advances = round2(S().revenue.advancesBalance(asOf));
      const ap = round2(S().expenses.approvedUnpaid().s);
      const payrollPayable = round2(S().payroll.pendingPayrollReserve());
      const assets = round2(bank + cash + ar);
      const liabilities = round2(advances + ap + payrollPayable);
      return {
        as_of: asOf,
        assets: [{ name: 'Bank', amount: round2(bank) }, { name: 'Kassa', amount: round2(cash) }, { name: 'Debitorlik (tan olingan, olinmagan)', amount: ar }],
        total_assets: assets,
        liabilities: [{ name: 'Mijoz avanslari (deferred revenue)', amount: advances }, { name: 'Kreditorlik (tasdiqlangan to‘lanmagan xarajat)', amount: ap }, { name: 'Oylik qarzi', amount: payrollPayable }],
        total_liabilities: liabilities, equity: round2(assets - liabilities), memo: { contract_backlog_receivable: contractBacklog, note: 'Shartnoma bo‘yicha qoldiq (xizmat bajarilmagan qism ham) — balansga kirmaydi' },
      };
    },
    /** DATA QUALITY AGENT — noto'liq data bilan jim ishlamaslik */
    dataQuality() {
      const issues = [];
      const push = (code, severity, title, items) => { if (items.length) issues.push({ code, severity, title, count: items.length, items: items.slice(0, 50) }); };
      push('CONTRACT_NO_DUE_DATE', 'WARNING', 'Shartnomada to‘lov muddati yo‘q', db.all("SELECT id, contract_number FROM contracts WHERE payment_due_date IS NULL AND contract_status NOT IN ('DRAFT','CANCELLED','CLOSED','PAID')").map((c) => ({ entity: 'contract', id: c.id, label: c.contract_number })));
      push('TX_UNMATCHED', 'WARNING', 'Bank tranzaksiyalari bog‘lanmagan', db.all("SELECT id, tx_date, amount, counterparty_name FROM bank_transactions WHERE matching_status IN ('UNMATCHED','SUGGESTED') AND reversed_at IS NULL ORDER BY tx_date DESC").map((t) => ({ entity: 'transaction', id: t.id, label: `${t.tx_date} ${t.counterparty_name || ''} ${Number(t.amount).toLocaleString('ru-RU')}` })));
      push('PAID_NO_SERVICE_STATUS', 'WARNING', 'To‘lov olingan, lekin xizmat holati boshlanmagan (14+ kun)', db.all(`SELECT c.id, c.contract_number, MIN(p.paid_at) first_paid FROM contracts c JOIN payments p ON p.contract_id=c.id AND p.reversed_at IS NULL WHERE c.service_status='NOT_STARTED' AND c.contract_status NOT IN ('CANCELLED','CLOSED') GROUP BY c.id HAVING julianday(?) - julianday(MIN(p.paid_at)) > 14`, today()).map((c) => ({ entity: 'contract', id: c.id, label: `${c.contract_number} (to‘lov ${c.first_paid})` })));
      push('COMPLETED_NO_ACT', 'CRITICAL', 'Xizmat yakunlangan, qabul akti yo‘q — daromad tan olinmagan', db.all("SELECT c.id, c.contract_number FROM contracts c JOIN service_types st ON st.id=c.service_type_id WHERE c.service_status='COMPLETED' AND st.recognition_rule LIKE '%\"require_acceptance_document\":true%' AND NOT EXISTS (SELECT 1 FROM contract_documents d WHERE d.contract_id=c.id AND d.doc_type='ACT')").map((c) => ({ entity: 'contract', id: c.id, label: c.contract_number })));
      push('EXPENSE_NO_CATEGORY', 'INFO', 'Xarajat kategoriyasi tasdiqlanmagan', db.all("SELECT id, code, purpose FROM expenses WHERE reversed_at IS NULL AND (category_id IS NULL OR category_source='AI_RULE_UNCONFIRMED')").map((e) => ({ entity: 'expense', id: e.id, label: `${e.code} ${e.purpose}` })));
      push('CONTRACT_EXPIRED_NOT_COMPLETED', 'WARNING', 'Shartnoma muddati tugagan, xizmat yakunlanmagan', db.all("SELECT id, contract_number, end_date FROM contracts WHERE end_date < ? AND service_status IN ('NOT_STARTED','IN_PROGRESS','ON_HOLD') AND contract_status NOT IN ('DRAFT','CANCELLED','CLOSED')", today()).map((c) => ({ entity: 'contract', id: c.id, label: `${c.contract_number} (${c.end_date})` })));
      push('OVERPAYMENT', 'WARNING', 'To‘lov shartnoma summasidan oshgan', app.services.contracts.list({}).filter((c) => c.paid > c.amount + 1).map((c) => ({ entity: 'contract', id: c.id, label: `${c.contract_number}: ${c.paid} > ${c.amount}` })));
      push('COMPANY_NO_INN', 'INFO', 'Kontragentda INN yo‘q (matching sifati past)', db.all("SELECT co.id, co.name FROM companies co WHERE (co.inn IS NULL OR co.inn='') AND EXISTS (SELECT 1 FROM contracts c WHERE c.company_id=co.id)").map((c) => ({ entity: 'company', id: c.id, label: c.name })));
      push('RECOGNITION_PENDING', 'WARNING', 'Daromad tan olish tasdiq kutmoqda (3+ kun)', db.all("SELECT rr.id, c.contract_number, rr.amount FROM revenue_recognition rr JOIN contracts c ON c.id=rr.contract_id WHERE rr.status='PENDING_APPROVAL' AND julianday(?) - julianday(rr.created_at) > 3", today()).map((x) => ({ entity: 'revenue_recognition', id: x.id, label: `${x.contract_number} ${Number(x.amount).toLocaleString('ru-RU')}` })));
      const prevP = addMonths(monthOf(today()), -1);
      if (!db.get('SELECT id FROM payrolls WHERE period=?', prevP) && db.get('SELECT COUNT(*) n FROM employees WHERE is_active=1').n > 0) issues.push({ code: 'PAYROLL_MISSING', severity: 'INFO', title: `Oylik ${prevP} hisoblanmagan`, count: 1, items: [{ entity: 'payroll', id: null, label: prevP }] });
      push('APPROVALS_STALE', 'WARNING', 'Tasdiq 48+ soat kutmoqda', db.all("SELECT id, title FROM approvals WHERE status='PENDING' AND julianday('now') - julianday(created_at) > 2").map((a) => ({ entity: 'approval', id: a.id, label: a.title })));
      return { checked_at: today(), total: issues.reduce((s, i) => s + i.count, 0), issues };
    },
    /** Oylik trendlar (grafik davr filtri uchun) */
    trends(months = 6) {
      months = Math.max(2, Math.min(24, Number(months) || 6));
      const pnl = [];
      let mp = addMonths(monthOf(today()), -(months - 1));
      for (let i = 0; i < months; i++) { const { from, to } = monthRange(mp); const rv = round2(S().revenue.recognizedInPeriod(from, to)); const ex = round2(S().expenses.total(from, to)); pnl.push({ period: mp, revenue: rv, expense: ex, profit: round2(rv - ex) }); mp = addMonths(mp, 1); }
      return { months, cash_flow: S().banking.monthlyFlows(months), revenue: S().revenue.monthlySeries(months), pnl };
    },
    dashboard() {
      const asOf = today();
      const tr = svc.treasury();
      const month = monthOf(asOf);
      const { from, to } = monthRange(month);
      const prevM = addMonths(month, -1);
      const prevR = monthRange(prevM);
      const pnl = svc.pnl({ month });
      const pnlPrev = svc.pnl({ month: prevM });
      const rc = S().receivables.summary();
      const rcPrev = S().receivables.summary(prevR.to);
      const aging = S().receivables.aging();
      const pf = S().budget.planFact(month);
      const recon = S().reconciliation.stats();
      const expByGroup = S().expenses.totalsByGroup(from, to);
      const dq = svc.dataQuality();
      const pctChange = (cur, prev) => (prev ? round2(((cur - prev) / Math.abs(prev)) * 100) : null);
      // O'tgan oy oxiridagi holat bilan taqqoslash
      const bankPrev = S().banking.bankBalance(prevR.to).total, cashPrev = S().banking.cashBalance(prevR.to).total;
      const advPrev = S().revenue.advancesBalance(prevR.to);
      const expPrev = S().expenses.total(prevR.from, prevR.to), expCur = S().expenses.total(from, to);
      // Sparkline: oxirgi 12 hafta (haftalik nuqtalar)
      const weeks = []; for (let i = 11; i >= 0; i--) weeks.push(addDays(asOf, -7 * i));
      const sparklines = {
        bank: weeks.map((d) => round2(S().banking.bankBalance(d).total)), cash: weeks.map((d) => round2(S().banking.cashBalance(d).total)),
        advances: weeks.map((d) => round2(S().revenue.advancesBalance(d))), expenses: weeks.map((d) => round2(S().expenses.total(addDays(d, -6), d))),
      };
      sparklines.total = sparklines.bank.map((v, i) => round2(v + sparklines.cash[i]));
      const bal = svc.balance(asOf);
      const activeContracts = S().contracts.list({ active: true });
      const indicators = {
        active_clients: new Set(activeContracts.map((c) => c.company_id)).size,
        new_clients_month: db.get('SELECT COUNT(*) n FROM (SELECT company_id, MIN(contract_date) d FROM contracts GROUP BY company_id) x WHERE x.d BETWEEN ? AND ?', from, to).n,
        active_contracts: activeContracts.length, new_contracts_month: db.get("SELECT COUNT(*) n FROM contracts WHERE contract_date BETWEEN ? AND ? AND contract_status<>'CANCELLED'", from, to).n,
        transactions_total: db.get('SELECT COUNT(*) n FROM bank_transactions WHERE reversed_at IS NULL').n, transactions_month: db.get('SELECT COUNT(*) n FROM bank_transactions WHERE reversed_at IS NULL AND tx_date BETWEEN ? AND ?', from, to).n,
        overdue_count: rc.overdue_count, overdue_count_prev: rcPrev.overdue_count,
      };
      return {
        as_of: asOf, month,
        kpi: { bank_balance: tr.bank_balance, cash_balance: tr.cash_balance, total_cash: tr.total_cash, available_cash: tr.available_cash, customer_advances: tr.customer_advances, recognized_revenue: pnl.totals.revenue, accounts_receivable: rc.total_receivable, expected_income: tr.expected_30d_income, expected_expenses: tr.expected_30d_expense, net_profit: pnl.totals.net, overdue_receivable: rc.overdue, low_liquidity: tr.low_liquidity, reserved: tr.reserved.total, expenses_month: round2(expCur) },
        deltas: { bank_balance: pctChange(tr.bank_balance, bankPrev), cash_balance: pctChange(tr.cash_balance, cashPrev), total_cash: pctChange(tr.total_cash, bankPrev + cashPrev), customer_advances: pctChange(tr.customer_advances, advPrev), expenses_month: pctChange(expCur, expPrev), recognized_revenue: pctChange(pnl.totals.revenue, pnlPrev.totals.revenue), net_profit: pctChange(pnl.totals.net, pnlPrev.totals.net), accounts_receivable: pctChange(rc.total_receivable, rcPrev.total_receivable) },
        sparklines,
        charts: {
          cash_flow: S().banking.monthlyFlows(6), revenue: S().revenue.monthlySeries(6),
          expense_structure: expByGroup.map((g) => ({ name: GROUP_LABELS[g.pnl_group] || g.pnl_group, group: g.pnl_group, amount: round2(g.amount) })).sort((a, b) => b.amount - a.amount),
          revenue_by_service: pnl.by_service.filter((x) => x.revenue > 0).map((x) => ({ name: x.name, code: x.code, amount: round2(x.revenue), color: x.color })),
          cash_composition: [{ name: 'Bank hisoblari', amount: round2(tr.bank_balance) }, { name: 'Kassa', amount: round2(tr.cash_balance) }, { name: 'Debitorlik (tan olingan)', amount: bal.assets[2].amount }],
          plan_fact: pf.items, aging: aging.buckets, pnl_monthly: pnl.monthly,
        },
        recent_income: db.all(`SELECT t.id, t.tx_date, t.amount, t.counterparty_name, t.matching_status, c.contract_number, c.id AS contract_id, st.name AS service_name FROM bank_transactions t LEFT JOIN contracts c ON c.id=t.matched_contract_id LEFT JOIN service_types st ON st.id=c.service_type_id WHERE t.direction='INCOME' AND t.reversed_at IS NULL ORDER BY t.tx_date DESC, t.amount DESC LIMIT 6`),
        recent_expenses: db.all(`SELECT e.id, e.code, e.expense_date, e.amount, e.purpose, e.status, ec.name AS category, d.name AS department FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id LEFT JOIN departments d ON d.id=e.department_id WHERE e.reversed_at IS NULL AND e.status IN ('APPROVED','PAID') ORDER BY e.expense_date DESC, e.amount DESC LIMIT 6`),
        indicators,
        receivables: { total: rc.total_receivable, overdue: rc.overdue, critical: rc.critical, top: rc.top_debtors.slice(0, 5) },
        pending: { approvals: db.get("SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM approvals WHERE status='PENDING'"), unmatched_transactions: (recon.unmatched || 0) + (recon.suggested || 0), unmatched_income_amount: round2(recon.unmatched_income_amount || 0), data_quality: dq.total, expense_requests: db.get("SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM expenses WHERE status='PENDING' AND reversed_at IS NULL") },
        service_profitability: svc.serviceProfitability({ month }).rows,
      };
    },
  };
  app.services.reports = svc;

  r.get('/api/dashboard', { perm: ['dashboard', 'VIEW'], tags: ['reports'], summary: 'CEO Finance Dashboard — barcha KPI va grafiklar' }, async () => svc.dashboard());
  r.get('/api/reports/trends', { perm: ['dashboard', 'VIEW'], tags: ['reports'], summary: 'Oylik trendlar (pul oqimi, daromad, P&L)', query: ['months'] }, async (ctx) => svc.trends(ctx.query.months));
  r.get('/api/treasury', { perm: ['treasury', 'VIEW'], tags: ['reports'], summary: 'Pul boshqaruvi: bank/kassa/avans/available/kutilayotgan', query: ['as_of'] }, async (ctx) => svc.treasury(ctx.query.as_of || today()));
  r.get('/api/reports/pnl', { perm: ['pnl', 'VIEW'], tags: ['reports'], summary: 'P&L (day/week/month/quarter/year/custom)', query: ['period', 'month', 'from', 'to'] }, async (ctx) => svc.pnl(ctx.query));
  r.get('/api/reports/service-profitability', { perm: ['pnl', 'VIEW'], tags: ['reports'], summary: 'Xizmat turlari rentabelligi', query: ['period', 'month', 'from', 'to'] }, async (ctx) => svc.serviceProfitability(ctx.query));
  r.get('/api/reports/cash-flow', { perm: ['cashflow', 'VIEW'], tags: ['reports'], summary: 'Cash Flow (operating/investing/financing)', query: ['period', 'month', 'from', 'to'] }, async (ctx) => svc.cashFlow(ctx.query));
  r.get('/api/reports/balance-sheet', { perm: ['balance', 'VIEW'], tags: ['reports'], summary: 'Boshqaruv balansi', query: ['as_of'] }, async (ctx) => svc.balance(ctx.query.as_of || today()));
  r.get('/api/reports/data-quality', { perm: ['dashboard', 'VIEW'], tags: ['reports'], summary: 'Data Quality Agent hisoboti' }, async () => svc.dataQuality());
}
