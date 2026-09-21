import { nowIso, parseJson } from './util.mjs';

/** Biznes qoidalari — hech narsa hard-code emas, admin panel orqali o'zgaradi. */
export const DEFAULT_SETTINGS = {
  'company.name': 'UTAX',
  'company.base_currency': 'UZS',
  'fx.rates': {}, // valyuta kurslari — foydalanuvchi kiritadi (o'zimizdan qiymat qo'yilmaydi)
  // Available cash formulasi: total − advances×restriction% − reserved
  'cash.advance_restriction_pct': 100,
  'cash.safety_reserve': 0, // rahbar belgilaydi
  'cash.reserve_approved_unpaid_expenses': true,
  'cash.reserve_pending_payroll': true,
  'cash.low_liquidity_threshold': 0, // rahbar belgilaydi
  // Reconciliation
  'reconciliation.auto_match_threshold': 95,
  'reconciliation.suggest_threshold': 60,
  'reconciliation.amount_tolerance_pct': 1,
  // Revenue recognition
  'revenue.approval_threshold': 50000000, // shundan katta tan olish CFO tasdig'ini talab qiladi
  'revenue.require_acceptance_document': true,
  // Expense
  'expense.large_expense_alert': 30000000,
  'expense.category_confidence_threshold': 0.8,
  // Collection agent bosqichlari (kun, due date'ga nisbatan)
  'collection.stages': [
    { code: 'T-7', days: -7, label: 'Muddat yaqinlashmoqda' },
    { code: 'T-3', days: -3, label: 'Eslatma' },
    { code: 'T-0', days: 0, label: 'To‘lov kuni' },
    { code: 'T+1', days: 1, label: 'Muddati o‘tdi' },
    { code: 'T+3', days: 3, label: 'Undiruv vazifasi' },
    { code: 'T+7', days: 7, label: 'Eskalatsiya' },
    { code: 'T+15', days: 15, label: 'Kritik qarz' },
  ],
  'collection.critical_days': 15,
  // Forecast scenariylari
  'forecast.scenarios': {
    conservative: { collection_rate: 0.7, overdue_rate: 0.3, expense_factor: 1.1, pipeline_rate: 0.3 },
    base: { collection_rate: 0.85, overdue_rate: 0.5, expense_factor: 1.0, pipeline_rate: 0.5 },
    optimistic: { collection_rate: 1.0, overdue_rate: 0.7, expense_factor: 0.95, pipeline_rate: 0.7 },
  },
  'payroll.pay_day': 10,
  'payroll.approval_steps': ['DEPARTMENT_HEAD', 'CEO', 'CFO', 'ACCOUNTANT'],
  'approvals.reminder_hours': 24,
  'notifications.telegram_enabled': true,
  'notifications.email_enabled': false,
  'ai.allow_llm': true,
  'security.require_2fa_roles': [],
  'security.session_hours': 168,
  'planfact.tolerance_pct': 10,
};

export function createSettings(db) {
  let cache = null;
  const load = () => {
    cache = { ...DEFAULT_SETTINGS };
    for (const r of db.all('SELECT key, value FROM settings')) cache[r.key] = parseJson(r.value, r.value);
  };
  return {
    reload: load,
    get(key, d) {
      if (!cache) load();
      return cache[key] === undefined ? d : cache[key];
    },
    all() {
      if (!cache) load();
      return { ...cache };
    },
    set(key, value, userId) {
      db.run(
        'INSERT INTO settings (key,value,updated_at,updated_by) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by',
        key, JSON.stringify(value), nowIso(), userId ?? null
      );
      load();
    },
    toBase(amount, currency) {
      if (!currency || currency === this.get('company.base_currency')) return Number(amount) || 0;
      const rate = (this.get('fx.rates') || {})[currency];
      return rate ? (Number(amount) || 0) * rate : Number(amount) || 0;
    },
  };
}
