import { nowIso, today, round2, addDays, daysBetween, monthOf, addMonths, monthRange, sum } from '../core/util.mjs';

/** FORECAST ENGINE — shartnomalar, to'lov jadvali, recurring, payroll, debitorlik, pipeline; 3 scenariy. */
export function register(app) {
  const { r, db, settings } = app;
  const S = () => app.services;

  const svc = {
    compute(horizonDays = 30, asOf = today()) {
      const end = addDays(asOf, horizonDays);
      const scen = settings.get('forecast.scenarios');
      const rc = S().receivables.list({}, asOf);
      const portions = rc.flatMap((x) => x.portions.map((p) => ({ ...p, contract: x.contract_number })));
      const dueIn = portions.filter((p) => p.due && p.due >= asOf && p.due <= end);
      const overdue = portions.filter((p) => p.due && p.due < asOf);
      const pipeline = db.all("SELECT id, contract_number, advance_amount, amount, advance_due_date FROM contracts WHERE contract_status='DRAFT'").filter((c) => !c.advance_due_date || c.advance_due_date <= end);
      const pipelineAmt = round2(sum(pipeline, (c) => c.advance_amount || c.amount * 0.5));
      const out = S().expenses.expectedOutflow(asOf, end);
      // payroll: agar recurring PAYROLL yo'q bo'lsa xodimlar fixed asosida
      const hasPayrollRec = db.get("SELECT COUNT(*) n FROM recurring_expenses rx JOIN expense_categories ec ON ec.id=rx.category_id WHERE ec.code='PAYROLL' AND rx.is_active=1").n > 0;
      const payDay = Number(settings.get('payroll.pay_day') || 10);
      let payrollEst = 0;
      if (!hasPayrollRec) {
        const monthlyFixed = db.get('SELECT COALESCE(SUM(fixed_salary),0) s FROM employees WHERE is_active=1').s;
        let p = monthOf(asOf);
        while (p <= monthOf(end)) { const d = `${p}-${String(payDay).padStart(2, '0')}`; if (d > asOf && d <= end) payrollEst += monthlyFixed; p = addMonths(p, 1); }
      }
      // o'zgaruvchan OPEX — oxirgi 3 oy o'rtachasi (recurring va payroll'dan tashqari)
      const m3from = monthRange(addMonths(monthOf(asOf), -3)).from, m3to = monthRange(addMonths(monthOf(asOf), -1)).to;
      const varOpex3 = db.get(`SELECT COALESCE(SUM(e.amount),0) s FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id WHERE e.reversed_at IS NULL AND e.status IN ('APPROVED','PAID') AND e.expense_date BETWEEN ? AND ? AND e.is_recurring=0 AND COALESCE(ec.pnl_group,'')<>'PAYROLL'`, m3from, m3to).s;
      const varDaily = varOpex3 / Math.max(1, daysBetween(m3from, m3to) + 1);
      const variableEst = round2(varDaily * horizonDays);
      const cashNow = round2(S().banking.bankBalance(asOf).total + S().banking.cashBalance(asOf).total);
      const tr = S().reports.treasury(asOf);
      const scenarios = {};
      for (const [name, s] of Object.entries(scen)) {
        const inflow = round2(sum(dueIn, (x) => x.amount) * s.collection_rate + sum(overdue, (x) => x.amount) * s.overdue_rate + pipelineAmt * s.pipeline_rate);
        const outflow = round2((out.total + payrollEst + variableEst) * s.expense_factor);
        scenarios[name] = { inflow, outflow, net: round2(inflow - outflow), projected_cash: round2(cashNow + inflow - outflow), projected_available: round2(tr.available_cash + inflow - outflow), assumptions: s,
          breakdown: { due_in_horizon: round2(sum(dueIn, (x) => x.amount)), overdue: round2(sum(overdue, (x) => x.amount)), pipeline: pipelineAmt, approved_unpaid: out.approved_unpaid, recurring: out.recurring, payroll: round2(payrollEst), variable_opex: variableEst } };
      }
      // haftalik/oylik seriya (base)
      const step = horizonDays <= 90 ? 7 : 30;
      const series = [];
      let cur = asOf, cash = cashNow;
      const base = scen.base;
      while (cur < end) {
        const nxt = addDays(cur, step) < end ? addDays(cur, step) : end;
        const inc = round2(sum(dueIn.filter((x) => x.due > cur && x.due <= nxt || (cur === asOf && x.due === asOf)), (x) => x.amount) * base.collection_rate + (cur === asOf ? sum(overdue, (x) => x.amount) * base.overdue_rate * 0.5 : sum(overdue, (x) => x.amount) * base.overdue_rate * 0.5 / Math.max(1, Math.ceil(horizonDays / step) - 1)));
        const frac = daysBetween(cur, nxt) / horizonDays;
        const exp = round2((out.total + payrollEst + variableEst) * frac * base.expense_factor);
        cash = round2(cash + inc - exp);
        series.push({ from: cur, to: nxt, inflow: inc, outflow: exp, cash });
        cur = nxt;
      }
      const result = { as_of: asOf, horizon_days: horizonDays, to: end, cash_now: cashNow, available_now: tr.available_cash, scenarios, series, risk: scenarios.conservative.projected_available < Number(settings.get('cash.low_liquidity_threshold') || 0) ? 'HIGH' : scenarios.base.projected_available < Number(settings.get('cash.low_liquidity_threshold') || 0) ? 'MEDIUM' : 'LOW' };
      db.insert('forecasts', { created_at: nowIso(), horizon_days: horizonDays, scenario: 'ALL', payload: JSON.stringify({ cash_now: cashNow, scenarios: Object.fromEntries(Object.entries(scenarios).map(([k, v]) => [k, { inflow: v.inflow, outflow: v.outflow, projected_cash: v.projected_cash }])) }) });
      return result;
    },
  };
  app.services.forecast = svc;
  r.get('/api/forecast', { perm: ['forecast', 'VIEW'], tags: ['forecast'], summary: 'Forecast 7/30/90/180/365 kun, 3 scenariy', query: ['days', 'as_of'] }, async (ctx) => svc.compute(Number(ctx.query.days || 30), ctx.query.as_of || today()));
  r.get('/api/forecast/all', { perm: ['forecast', 'VIEW'], tags: ['forecast'], summary: 'Barcha gorizontlar xulosasi' }, async (ctx) => [7, 30, 90, 180, 365].map((d) => { const f = svc.compute(d, ctx.query.as_of || today()); return { days: d, to: f.to, risk: f.risk, ...Object.fromEntries(Object.entries(f.scenarios).map(([k, v]) => [k, { inflow: v.inflow, outflow: v.outflow, net: v.net, projected_cash: v.projected_cash }])) }; }));
}
