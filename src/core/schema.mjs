/**
 * Sxema — SQLite (PostgreSQL bilan mos tiplar: TEXT/INTEGER/REAL, ISO sanalar).
 * Migratsiyalar `schema_migrations` jadvalida versiyalanadi.
 */
export const MIGRATIONS = [
  {
    version: 1,
    name: 'core',
    sql: `
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT, updated_by INTEGER);

CREATE TABLE IF NOT EXISTS roles (code TEXT PRIMARY KEY, name TEXT NOT NULL, rank INTEGER NOT NULL DEFAULT 0, description TEXT);
CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, role_code TEXT NOT NULL REFERENCES roles(code),
  resource TEXT NOT NULL, action TEXT NOT NULL, UNIQUE(role_code, resource, action));
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, name TEXT NOT NULL,
  head_user_id INTEGER, service_type_id INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  name TEXT NOT NULL, role_code TEXT NOT NULL REFERENCES roles(code), department_id INTEGER REFERENCES departments(id),
  phone TEXT, telegram_chat_id TEXT, telegram_link_code TEXT, totp_secret TEXT, totp_enabled INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1, last_login_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), refresh_hash TEXT NOT NULL,
  ip TEXT, user_agent TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT);
CREATE INDEX IF NOT EXISTS ix_sessions_hash ON sessions(refresh_hash);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, inn TEXT, phone TEXT, email TEXT, address TEXT,
  director TEXT, manager_user_id INTEGER REFERENCES users(id), kind TEXT DEFAULT 'CLIENT', notes TEXT,
  is_active INTEGER DEFAULT 1, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_companies_inn ON companies(inn);

CREATE TABLE IF NOT EXISTS service_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, prefix TEXT NOT NULL,
  recognition_rule TEXT NOT NULL, payment_rule TEXT, kpi_rule TEXT, expense_rule TEXT, collection_rule TEXT,
  color TEXT, is_active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0);

CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, contract_number TEXT UNIQUE NOT NULL,
  company_id INTEGER NOT NULL REFERENCES companies(id), service_type_id INTEGER NOT NULL REFERENCES service_types(id),
  title TEXT, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'UZS',
  contract_date TEXT NOT NULL, start_date TEXT, end_date TEXT,
  advance_pct REAL DEFAULT 0, advance_amount REAL DEFAULT 0, expected_final_payment REAL DEFAULT 0,
  advance_due_date TEXT, payment_due_date TEXT,
  manager_user_id INTEGER REFERENCES users(id),
  contract_status TEXT NOT NULL DEFAULT 'DRAFT', service_status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  payment_status TEXT NOT NULL DEFAULT 'EXPECTED',
  service_completed_at TEXT, comments TEXT, created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT);
CREATE INDEX IF NOT EXISTS ix_contracts_company ON contracts(company_id);
CREATE INDEX IF NOT EXISTS ix_contracts_status ON contracts(contract_status);
CREATE TABLE IF NOT EXISTS contract_services (
  id INTEGER PRIMARY KEY AUTOINCREMENT, contract_id INTEGER NOT NULL REFERENCES contracts(id),
  description TEXT NOT NULL, amount REAL NOT NULL, status TEXT DEFAULT 'PLANNED', completed_at TEXT);
CREATE TABLE IF NOT EXISTS contract_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, contract_id INTEGER NOT NULL REFERENCES contracts(id),
  doc_type TEXT NOT NULL, name TEXT NOT NULL, file_path TEXT, doc_date TEXT, uploaded_by INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payment_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT, contract_id INTEGER NOT NULL REFERENCES contracts(id),
  kind TEXT NOT NULL, due_date TEXT NOT NULL, amount REAL NOT NULL, status TEXT DEFAULT 'EXPECTED', note TEXT);
CREATE INDEX IF NOT EXISTS ix_sched_due ON payment_schedules(due_date);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, bank_name TEXT NOT NULL, account_number TEXT, currency TEXT DEFAULT 'UZS',
  opening_balance REAL DEFAULT 0, opening_date TEXT, is_active INTEGER DEFAULT 1, integration_id INTEGER);
CREATE TABLE IF NOT EXISTS cash_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, currency TEXT DEFAULT 'UZS',
  opening_balance REAL DEFAULT 0, opening_date TEXT, responsible_user_id INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS bank_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
  external_id TEXT, tx_date TEXT NOT NULL, amount REAL NOT NULL, currency TEXT DEFAULT 'UZS',
  direction TEXT NOT NULL, counterparty_name TEXT, counterparty_inn TEXT, counterparty_account TEXT,
  purpose TEXT, contract_number_ref TEXT, tx_type TEXT,
  matching_status TEXT NOT NULL DEFAULT 'UNMATCHED', matched_contract_id INTEGER REFERENCES contracts(id),
  matched_expense_id INTEGER, suggested_contract_id INTEGER, confidence REAL DEFAULT 0, match_reason TEXT,
  cf_class TEXT DEFAULT 'OPERATING', ignore_reason TEXT, reversed_at TEXT, reversal_of INTEGER,
  source TEXT DEFAULT 'MANUAL', created_by INTEGER, created_at TEXT NOT NULL, matched_at TEXT, matched_by INTEGER);
CREATE INDEX IF NOT EXISTS ix_btx_date ON bank_transactions(tx_date);
CREATE INDEX IF NOT EXISTS ix_btx_status ON bank_transactions(matching_status);
CREATE UNIQUE INDEX IF NOT EXISTS ux_btx_ext ON bank_transactions(bank_account_id, external_id);
CREATE TABLE IF NOT EXISTS cash_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, cash_account_id INTEGER NOT NULL REFERENCES cash_accounts(id),
  tx_date TEXT NOT NULL, amount REAL NOT NULL, currency TEXT DEFAULT 'UZS', direction TEXT NOT NULL,
  counterparty_name TEXT, purpose TEXT, contract_id INTEGER REFERENCES contracts(id), expense_id INTEGER,
  cf_class TEXT DEFAULT 'OPERATING', reversed_at TEXT, created_by INTEGER, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, contract_id INTEGER NOT NULL REFERENCES contracts(id),
  amount REAL NOT NULL, paid_at TEXT NOT NULL, source TEXT NOT NULL,
  bank_transaction_id INTEGER, cash_transaction_id INTEGER, schedule_id INTEGER,
  note TEXT, reversed_at TEXT, created_by INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_payments_contract ON payments(contract_id);

CREATE TABLE IF NOT EXISTS revenue_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, contract_id INTEGER NOT NULL REFERENCES contracts(id),
  payment_id INTEGER, amount REAL NOT NULL, state TEXT NOT NULL, event_date TEXT NOT NULL,
  state_changed_at TEXT, note TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_revev_state ON revenue_events(state);
CREATE TABLE IF NOT EXISTS revenue_recognition (
  id INTEGER PRIMARY KEY AUTOINCREMENT, contract_id INTEGER NOT NULL REFERENCES contracts(id),
  amount REAL NOT NULL, recognized_at TEXT NOT NULL, period TEXT NOT NULL, method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RECOGNIZED', approval_id INTEGER, note TEXT, created_by INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_revrec_period ON revenue_recognition(period);

CREATE TABLE IF NOT EXISTS expense_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, parent_id INTEGER,
  pnl_group TEXT NOT NULL DEFAULT 'OTHER_OPEX', cf_class TEXT DEFAULT 'OPERATING', is_direct_cost INTEGER DEFAULT 0,
  keywords TEXT, is_active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, expense_date TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id), category_id INTEGER REFERENCES expense_categories(id),
  subcategory TEXT, project TEXT, contract_id INTEGER REFERENCES contracts(id), service_type_id INTEGER,
  requested_by INTEGER REFERENCES users(id), counterparty TEXT, amount REAL NOT NULL, currency TEXT DEFAULT 'UZS',
  purpose TEXT NOT NULL, required_date TEXT, payment_method TEXT DEFAULT 'BANK', receipt_path TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING', approval_id INTEGER, approver_id INTEGER, approved_at TEXT,
  paid_at TEXT, bank_transaction_id INTEGER, cash_transaction_id INTEGER,
  category_confidence REAL, category_source TEXT, is_recurring INTEGER DEFAULT 0,
  reversed_at TEXT, created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT);
CREATE INDEX IF NOT EXISTS ix_exp_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS ix_exp_status ON expenses(status);
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category_id INTEGER, department_id INTEGER,
  amount REAL NOT NULL, day_of_month INTEGER DEFAULT 1, is_active INTEGER DEFAULT 1);

CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT, contract_id INTEGER NOT NULL REFERENCES contracts(id),
  stage TEXT NOT NULL, due_date TEXT, debt REAL, task_date TEXT NOT NULL, status TEXT DEFAULT 'OPEN',
  assigned_to INTEGER, note TEXT, done_at TEXT, created_at TEXT NOT NULL, UNIQUE(contract_id, stage, due_date));

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT NOT NULL, department_id INTEGER REFERENCES departments(id),
  position TEXT, fixed_salary REAL DEFAULT 0, hired_at TEXT, is_active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS kpi_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, service_type_id INTEGER,
  department_id INTEGER, formula TEXT NOT NULL, params TEXT, is_active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS employee_kpis (
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, period TEXT NOT NULL, kpi_rule_id INTEGER,
  metric_value REAL, kpi_amount REAL, note TEXT, UNIQUE(employee_id, period, kpi_rule_id));
CREATE TABLE IF NOT EXISTS payrolls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, period TEXT NOT NULL, employee_id INTEGER NOT NULL REFERENCES employees(id),
  fixed REAL DEFAULT 0, kpi REAL DEFAULT 0, piece_rate REAL DEFAULT 0, bonus REAL DEFAULT 0, penalty REAL DEFAULT 0,
  advance REAL DEFAULT 0, certificate_bonus REAL DEFAULT 0, other REAL DEFAULT 0, gross REAL DEFAULT 0,
  deductions REAL DEFAULT 0, net REAL DEFAULT 0, status TEXT DEFAULT 'DRAFT', approval_id INTEGER,
  paid_at TEXT, expense_id INTEGER, created_at TEXT NOT NULL, UNIQUE(period, employee_id));
CREATE TABLE IF NOT EXISTS advances (
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, amount REAL NOT NULL, given_at TEXT NOT NULL,
  period TEXT, note TEXT, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT, period TEXT NOT NULL, department_id INTEGER, category_id INTEGER,
  amount REAL NOT NULL, UNIQUE(period, department_id, category_id));
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT, period TEXT UNIQUE NOT NULL, revenue_plan REAL DEFAULT 0, expense_plan REAL DEFAULT 0,
  profit_plan REAL DEFAULT 0, cash_plan REAL DEFAULT 0, collection_plan REAL DEFAULT 0, note TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS forecasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, horizon_days INTEGER, scenario TEXT, payload TEXT);

CREATE TABLE IF NOT EXISTS approval_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, min_amount REAL NOT NULL DEFAULT 0,
  max_amount REAL, steps TEXT NOT NULL, name TEXT, is_active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, amount REAL,
  title TEXT, requested_by INTEGER, department_id INTEGER, steps TEXT NOT NULL, current_step INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING', postponed_until TEXT, decided_at TEXT, comment TEXT,
  created_at TEXT NOT NULL, updated_at TEXT);
CREATE INDEX IF NOT EXISTS ix_apr_status ON approvals(status);

CREATE TABLE IF NOT EXISTS import_keys (key TEXT PRIMARY KEY, entity TEXT, entity_id INTEGER, file TEXT, created_at TEXT);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, channel TEXT NOT NULL DEFAULT 'CRM', type TEXT NOT NULL,
  severity TEXT DEFAULT 'INFO', title TEXT NOT NULL, body TEXT, entity_type TEXT, entity_id INTEGER,
  is_read INTEGER DEFAULT 0, sent_at TEXT, error TEXT, dedupe_key TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_id, is_read);
CREATE UNIQUE INDEX IF NOT EXISTS ux_notif_dedupe ON notifications(dedupe_key);

CREATE TABLE IF NOT EXISTS integrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, name TEXT NOT NULL, config TEXT, secret_config TEXT,
  is_active INTEGER DEFAULT 1, last_sync_at TEXT, last_status TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS integration_sync_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, integration_id INTEGER, started_at TEXT NOT NULL, finished_at TEXT,
  status TEXT, rows_in INTEGER DEFAULT 0, rows_new INTEGER DEFAULT 0, message TEXT);

CREATE TABLE IF NOT EXISTS ai_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT,
  permissions TEXT, schedule TEXT, is_active INTEGER DEFAULT 1, last_run_at TEXT, last_result TEXT, api_key_hash TEXT);
CREATE TABLE IF NOT EXISTS ai_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, agent_code TEXT NOT NULL, action_type TEXT NOT NULL, entity_type TEXT,
  entity_id INTEGER, title TEXT, payload TEXT, confidence REAL, status TEXT NOT NULL DEFAULT 'PROPOSED',
  proposed_at TEXT NOT NULL, decided_by INTEGER, decided_at TEXT, executed_at TEXT, result TEXT);
CREATE TABLE IF NOT EXISTS ai_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, channel TEXT, question TEXT, answer TEXT, intent TEXT,
  engine TEXT, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, role TEXT, action TEXT NOT NULL, entity TEXT NOT NULL,
  entity_id INTEGER, old_value TEXT, new_value TEXT, ts TEXT NOT NULL, ip TEXT, source TEXT,
  approval_id INTEGER, ai_agent_code TEXT);
CREATE INDEX IF NOT EXISTS ix_audit_entity ON audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS ix_audit_ts ON audit_logs(ts);
`,
  },
];

export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)`);
  const applied = new Set(db.all('SELECT version FROM schema_migrations').map((r) => r.version));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.tx(() => {
      db.exec(m.sql);
      db.run('INSERT INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)', m.version, m.name, new Date().toISOString());
    });
  }
}
