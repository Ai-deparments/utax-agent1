import { badRequest } from '../core/http.mjs';
import { nowIso, today, round2, monthRange, monthOf, addMonths, pct, addDays, daysBetween } from '../core/util.mjs';

export function register(app) {
  const { r, db, audit, settings } = app;
  // Pul qoldig'i: boshlang'ich qoldiq kiritilmagan hisob bo'lsa noma'lum (null) — reja/fakt 'NO_DATA', 0 deb solishtirilmaydi
  const cashAsOf = (asOf) => { const b = app.services.banking.bankBalance(asOf).total, c = app.services.banking.cashBalance(asOf).total; return b === null || c === null ? null : round2(b + c); };
  const cashItem = (planCash, cash, item) => (cash === null ? { key: 'Cash', name: 'Pul qoldig‘i', plan: round2(planCash), fact: null, pct: null, diff: null, status: 'NO_DATA' } : item('Pul qoldig‘i', 'Cash', planCash, cash));
  const svc = {
    planFact(period) {
      const plan = db.get('SELECT * FROM plans WHERE period=?', period) || { period, revenue_plan: 0, expense_plan: 0, profit_plan: 0, cash_plan: 0, collection_plan: 0 };
      const { from, to } = monthRange(period);
      const revenue = round2(app.services.revenue.recognizedInPeriod(from, to));
      const expense = round2(app.services.expenses.total(from, to));
      const profit = round2(revenue - expense);
      const asOf = to < today() ? to : today();
      const cash = cashAsOf(asOf);
      const collection = round2(db.get('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE reversed_at IS NULL AND paid_at BETWEEN ? AND ?', from, to).s);
      const item = (name, key, p, f, lowerIsBetter = false) => ({ key, name, plan: round2(p), fact: f, pct: pct(f, p), diff: round2(f - p), status: !p ? 'NO_PLAN' : lowerIsBetter ? (f <= p ? 'OK' : (f <= p * (1 + Number(settings.get('planfact.tolerance_pct') || 10) / 100) ? 'WARN' : 'BAD')) : (f >= p ? 'OK' : (f >= p * (1 - Number(settings.get('planfact.tolerance_pct') || 10) / 100) ? 'WARN' : 'BAD')) });
      return { period, items: [item('Daromad', 'Revenue', plan.revenue_plan, revenue), item('Xarajat', 'Expense', plan.expense_plan, expense, true), item('Foyda', 'Profit', plan.profit_plan, profit), cashItem(plan.cash_plan, cash, item), item('Undirish', 'Collection', plan.collection_plan, collection)], plan };
    },
    /** Ixtiyoriy oraliq: oylik rejalar kunlar bo'yicha proporsional taqsimlanadi; pul rejasi — tugash sanasi oyining rejasi */
    planFactRange(from, to) {
      const months = []; for (let p = monthOf(from); p <= monthOf(to); p = addMonths(p, 1)) months.push(p);
      const plan = { revenue_plan: 0, expense_plan: 0, profit_plan: 0, collection_plan: 0, cash_plan: 0 };
      for (const p of months) {
        const pl = db.get('SELECT * FROM plans WHERE period=?', p); if (!pl) continue;
        const r = monthRange(p); const a = from > r.from ? from : r.from, b = to < r.to ? to : r.to;
        const frac = (daysBetween(a, b) + 1) / (daysBetween(r.from, r.to) + 1);
        for (const k of ['revenue_plan', 'expense_plan', 'profit_plan', 'collection_plan']) plan[k] += (pl[k] || 0) * frac;
      }
      plan.cash_plan = db.get('SELECT cash_plan FROM plans WHERE period=?', monthOf(to))?.cash_plan || 0;
      const revenue = round2(app.services.revenue.recognizedInPeriod(from, to));
      const expense = round2(app.services.expenses.total(from, to));
      const asOf = to < today() ? to : today();
      const cash = cashAsOf(asOf);
      const collection = round2(db.get('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE reversed_at IS NULL AND paid_at BETWEEN ? AND ?', from, to).s);
      const tol = Number(settings.get('planfact.tolerance_pct') || 10) / 100;
      const item = (name, key, p, f, lowerIsBetter = false) => ({ key, name, plan: round2(p), fact: f, pct: pct(f, p), diff: round2(f - p), status: !p ? 'NO_PLAN' : lowerIsBetter ? (f <= p ? 'OK' : f <= p * (1 + tol) ? 'WARN' : 'BAD') : (f >= p ? 'OK' : f >= p * (1 - tol) ? 'WARN' : 'BAD') });
      return { period: `${from} → ${to}`, from, to, months, items: [item('Daromad', 'Revenue', plan.revenue_plan, revenue), item('Xarajat', 'Expense', plan.expense_plan, expense, true), item('Foyda', 'Profit', plan.profit_plan, round2(revenue - expense)), cashItem(plan.cash_plan, cash, item), item('Undirish', 'Collection', plan.collection_plan, collection)], plan: Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, round2(v)])) };
    },
    series(months = 6, asOf = today()) {
      const out = [];
      let p = addMonths(monthOf(asOf), -(months - 1));
      for (let i = 0; i < months; i++) { const pf = svc.planFact(p); out.push({ period: p, revenue_plan: pf.items[0].plan, revenue_fact: pf.items[0].fact, expense_plan: pf.items[1].plan, expense_fact: pf.items[1].fact, profit_plan: pf.items[2].plan, profit_fact: pf.items[2].fact }); p = addMonths(p, 1); }
      return out;
    },
    /** Bo'lim/kategoriya byudjeti va fakt bajarilishi */
    budgets(period) {
      const { from, to } = monthRange(period);
      return db.all(`SELECT b.*, d.name AS department_name, ec.name AS category_name,
          COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.reversed_at IS NULL AND e.status IN ('APPROVED','PAID') AND e.expense_date BETWEEN ? AND ? AND (b.department_id IS NULL OR e.department_id=b.department_id) AND (b.category_id IS NULL OR e.category_id=b.category_id)),0) AS fact
        FROM budgets b LEFT JOIN departments d ON d.id=b.department_id LEFT JOIN expense_categories ec ON ec.id=b.category_id WHERE b.period=? ORDER BY d.name`, from, to, period).map((x) => ({ ...x, pct: pct(x.fact, x.amount), exceeded: x.fact > x.amount }));
    },
  };
  app.services.budget = svc;

  r.get('/api/plans', { perm: ['planfact', 'VIEW'], tags: ['planfact'], summary: 'Oylik rejalar' }, async () => db.all('SELECT * FROM plans ORDER BY period DESC'));
  r.put('/api/plans/:period', { perm: ['planfact', 'EDIT'], tags: ['planfact'], summary: 'Reja kiritish/yangilash' }, async (ctx) => {
    const period = ctx.params.period;
    if (!/^\d{4}-\d{2}$/.test(period)) throw badRequest('period YYYY-MM');
    const b = ctx.body || {};
    const old = db.get('SELECT * FROM plans WHERE period=?', period);
    const vals = { revenue_plan: round2(b.revenue_plan ?? old?.revenue_plan ?? 0), expense_plan: round2(b.expense_plan ?? old?.expense_plan ?? 0), profit_plan: round2(b.profit_plan ?? (b.revenue_plan !== undefined && b.expense_plan !== undefined ? b.revenue_plan - b.expense_plan : old?.profit_plan ?? 0)), cash_plan: round2(b.cash_plan ?? old?.cash_plan ?? 0), collection_plan: round2(b.collection_plan ?? old?.collection_plan ?? 0), note: b.note ?? old?.note ?? null, updated_at: nowIso() };
    if (old) db.update('plans', old.id, vals); else db.insert('plans', { period, ...vals });
    audit(ctx, { action: old ? 'PLAN_UPDATED' : 'PLAN_CREATED', entity: 'plan', entityId: old?.id, oldValue: old, newValue: vals });
    return db.get('SELECT * FROM plans WHERE period=?', period);
  });
  r.get('/api/planfact', { perm: ['planfact', 'VIEW'], tags: ['planfact'], summary: 'Plan/Fakt (joriy oy + 6 oy seriya; from/to — ixtiyoriy oraliq)', query: ['month', 'from', 'to'] }, async (ctx) => {
    if (ctx.query.from && ctx.query.to) {
      if (ctx.query.from > ctx.query.to) throw badRequest('Boshlanish sanasi tugash sanasidan keyin bo‘lishi mumkin emas');
      const pf = svc.planFactRange(ctx.query.from, ctx.query.to);
      return { ...pf, series: pf.months.length >= 2 ? pf.months.map((p) => svc.series(1, monthRange(p).to)[0]) : svc.series(6, ctx.query.to) };
    }
    const period = ctx.query.month || monthOf(today());
    return { ...svc.planFact(period), series: svc.series(6, monthRange(period).to) };
  });
  r.get('/api/budgets', { perm: ['planfact', 'VIEW'], tags: ['planfact'], summary: 'Bo‘lim/kategoriya byudjeti va bajarilishi (from/to — ixtiyoriy oraliq)', query: ['month', 'from', 'to'] }, async (ctx) => {
    if (ctx.query.from && ctx.query.to) {
      const F = ctx.query.from, T = ctx.query.to;
      const months = []; for (let p = monthOf(F); p <= monthOf(T); p = addMonths(p, 1)) months.push(p);
      const groups = new Map();
      for (const p of months) {
        const r = monthRange(p); const a = F > r.from ? F : r.from, b = T < r.to ? T : r.to;
        const frac = (daysBetween(a, b) + 1) / (daysBetween(r.from, r.to) + 1);
        for (const x of db.all('SELECT b.*, d.name AS department_name, ec.name AS category_name FROM budgets b LEFT JOIN departments d ON d.id=b.department_id LEFT JOIN expense_categories ec ON ec.id=b.category_id WHERE b.period=?', p)) {
          const k = `${x.department_id || 0}:${x.category_id || 0}`;
          const g = groups.get(k) || { ...x, period: `${F} → ${T}`, amount: 0 }; g.amount += x.amount * frac; groups.set(k, g);
        }
      }
      return [...groups.values()].map((x) => { const fact = db.get("SELECT COALESCE(SUM(e.amount),0) s FROM expenses e WHERE e.reversed_at IS NULL AND e.status IN ('APPROVED','PAID') AND e.expense_date BETWEEN ? AND ? AND (? IS NULL OR e.department_id=?) AND (? IS NULL OR e.category_id=?)", F, T, x.department_id, x.department_id, x.category_id, x.category_id).s; const amount = round2(x.amount); return { ...x, amount, fact, pct: pct(fact, amount), exceeded: fact > amount }; }).sort((a, b) => String(a.department_name || '').localeCompare(String(b.department_name || '')));
    }
    return svc.budgets(ctx.query.month || monthOf(today()));
  });
  r.put('/api/budgets', { perm: ['planfact', 'EDIT'], tags: ['planfact'], summary: 'Byudjet qatori {period, department_id, category_id, amount}' }, async (ctx) => {
    const b = ctx.body || {};
    if (!b.period || b.amount === undefined) throw badRequest('period, amount majburiy');
    db.run('INSERT INTO budgets (period, department_id, category_id, amount) VALUES (?,?,?,?) ON CONFLICT(period, department_id, category_id) DO UPDATE SET amount=excluded.amount', b.period, b.department_id || null, b.category_id || null, round2(b.amount));
    audit(ctx, { action: 'BUDGET_SET', entity: 'budget', newValue: b });
    return { ok: true };
  });
}
