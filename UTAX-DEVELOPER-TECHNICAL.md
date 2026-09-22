# UTAX AI Finance CRM — Developer & Technical Reference

> **State as of:** 2026-09-22 (UTC+5). Branch `main`, HEAD `5dddfe8` (merge of PR #5).
> **How this was produced:** a full read of `src/`, `public/`, `api/`, `scripts/`, `tests/`, and the deploy configs; queries against the running app at `localhost:8100`; and read-only queries on `data/finance.db`. File references use the form `path:line`. Anything that could not be confirmed is marked **Not verified**.
> **Audience:** backend/frontend/full-stack developers, DevOps, AI engineers, future Claude Code sessions. Business-level explanation lives in `UTAX-BUSINESS-FINANCE.md`.

---

## 1. Architecture at a glance

```
 Director's Excel (.xlsx)          Manual input (web / Telegram)        External systems (not connected yet)
        │                                   │                          Bank REST · 1C OData · Google Sheets · Webhook
        ▼                                   │                                        │
 src/import/excel-journal.mjs  ── plan ──►  │                          src/modules/integrations.mjs (adapters)
 (parse · classify · validate)              │                                        │
        │                                   ▼                                        ▼
 src/import/apply-journal.mjs  ───────►  Service layer: app.services.*  ◄── banking.importRows()
 (idempotent write + verifyImport)        (src/modules/*.mjs: contracts, banking, reconciliation, revenue,
                                            expenses, approvals, receivables, reports, payroll, budget, forecast…)
                                                   │            │
                                  src/core/db.mjs (node:sqlite | libSQL/Turso)   src/core/audit.mjs → audit_logs
                                                   │
             ┌─────────────────────────────────────┼───────────────────────────────────┐
             ▼                                     ▼                                   ▼
   REST API (src/core/router.mjs)        Telegram bots (src/bots/*)         Scheduler (src/core/scheduler.mjs)
   RBAC per route · 160 module routes    same services, same RBAC            14 rule-based AI agents (src/modules/ai.mjs)
             │                                     │                                   │
             ▼                                     ▼                                   ▼
   public/ SPA (vanilla ES modules, PWA)   4 bots: rahbar/buxgalter/sorov/signal   notifications → CRM / Telegram / Email
```

Key properties:
- **No external runtime dependencies.** The only package is `libsql`, listed in `optionalDependencies` for Turso/Vercel. Node ≥ 22.5 is required (`package.json` engines). HTTP, JWT, SMTP, XLSX reading, the SVG charts and the Telegram client are all hand-written.
- **One service layer serves every channel.** Web routes, Telegram handlers and AI agents all call `app.services.*`, so RBAC and audit behave the same everywhere. Telegram writes carry `ctx.actor = {source:'TELEGRAM', bot}` (`src/bots/shared/bot-factory.mjs:251`).
- **Data integrity rule (project rule #1, `CLAUDE.md`).** No fabricated business data. A missing value is `NULL` in the DB and renders as `--` in the UI; for example, balances are `null` when `opening_balance` is NULL (`src/modules/banking.mjs:12-38`).

---

## 2. Repository map

| Path | Layer | Responsibility |
|---|---|---|
| `src/server.mjs` | backend | `createApp` (migrate, services, scheduler jobs `:62-76`), `createServer` (static files, security headers, rate limit, inline routes `/api/health`, `/api/cron/tick`, `/api/openapi.json`, `/api/docs`, `POST /telegram/<bot>`), bootstrap admin (`:185-189`), `ensureOwners` (`:191`), bot start (`:201-202`) |
| `src/core/` | backend infra | `config.mjs` (env parsing; reads `.env` itself, no dotenv), `db.mjs` (driver switch plus helpers), `schema.mjs` (6 migrations), `router.mjs`, `http.mjs`, `rbac.mjs`, `auth.mjs` (scrypt, JWT, TOTP, AES-GCM secrets), `audit.mjs`, `scheduler.mjs`, `settings.mjs`, `llm.mjs` (Gemini/Groq), `smtp.mjs`, `export.mjs` (XLSX writer/reader, CSV), `openapi.mjs`, `bootstrap.mjs`, `util.mjs` |
| `src/modules/` | backend | 21 domain modules. Each registers routes plus `app.services.<name>` (see §8) |
| `src/import/` | backend | `excel-journal.mjs` (plan builder for both journal formats), `apply-journal.mjs` (writer and verifier), `ledger-journal.mjs` (legacy double-entry web path), `xlsx-reader.mjs` |
| `src/bots/` | backend | `index.mjs` (start/stop, polling/webhook, jobs), `shared/` (bot-factory pipeline, telegram-api client, auth/linking, owners, dispatcher, AI chat, keyboards, texts), one folder each for `rahbar/`, `buxgalter/`, `sorov/`, `signal/` (`bot.mjs` plus `handlers/`) |
| `src/seed/seed.mjs` | backend | Structure only (roles, service types, categories, rules). **No business data** |
| `public/` | frontend | `index.html`, `js/app.js` (hash router and shell), `js/api.js`, `js/ui.js`, `js/charts.js`, `js/icons.js`, `js/pwa.js`, `js/pages/*.js` (19 pages), `css/app.css`, `sw.js`, `manifest.webmanifest`, `icons/` |
| `api/index.mjs` | infra (Vercel) | Serverless entry that reuses `createHandler`; runs `db.sync()` at most once per second |
| `scripts/` | tooling | `check.mjs`, `excel-import.mjs`, `data-vault.mjs`, `llm-check.mjs`, `vercel-check.mjs`, `gen-icons.mjs` |
| `tests/` | tests | 19 `*.test.mjs` files; `helpers/bot-harness.mjs`; `fixtures/demo-seed.mjs` (**fabricated, tests only**) |
| `deploy/`, `Dockerfile`, `docker-compose.yml`, `vercel.json`, `DEPLOY-VERCEL.md` | infra | VPS (systemd/nginx), Docker, Vercel |
| `data/` | runtime | `finance.db` (gitignored), `backups/`, `imports/` (gitignored), `vault/*.enc` (**committed, encrypted**) |
| `docs/` | docs | `ARCHITECTURE.md`, `API.md`, `BOTS.md`, `BOTS_PLAN.md`, `DEPLOY.md`, `GLOSSARY.md` (see §17 for known doc drift) |

---

## 3. Runtime & commands

| Item | Value |
|---|---|
| Node | `>=22.5` (`node:sqlite`). Verified with v24.18.0 |
| Package manager | npm. There are no required deps, so `npm install` is only needed for optional `libsql` |
| Start | `npm start` → `node src/server.mjs` |
| Dev | `npm run dev` (`node --watch`) |
| Test | `npm test` → `node --test "tests/**/*.test.mjs"` |
| Syntax check | `npm run check`, which runs `node --check` over src, public/js, tests and scripts. It does **not** cover `api/`. Last run: 141 files, 0 errors |
| Build | none, no bundler. Asset versioning happens at request time (§10) |
| Port / host | `PORT` (8100) / `HOST` (127.0.0.1) |
| Timezone | `APP_TZ`, default `Asia/Tashkent` (`config.mjs:23`) |
| Other scripts | `seed`, `seed:reset`, `backup`, `openapi`, `llm:check`, `import:excel`, `vercel:check`, `vault:pack`, `vault:unpack`, `vault:verify` |

Backend changes require a manual restart unless you use `npm run dev`.

---

## 4. Database

### 4.1 Driver selection (`src/core/db.mjs:28-47`)
1. `TURSO_DATABASE_URL` or `LIBSQL_URL` set → `libsql` embedded replica (`syncUrl`, `readYourWrites:true`, then `db.sync()`).
2. `DB_DRIVER=libsql` → local libSQL without sync (used by `vercel-check`).
3. Default → `node:sqlite` `DatabaseSync` on `DB_PATH` (default `./data/finance.db`), with `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.

Helpers (`:65-108`): `exec`, `run` (returns `{changes,lastId}`), `get` (returns `null`), `all`, `tx` (flattened nesting via a depth counter), `insert`, `update`, `sync`, `close`. Prepared statements are cached. `norm()` maps undefined→NULL, bool→0/1, Date→ISO, object→JSON.

### 4.2 Migrations (`src/core/schema.mjs`)
- `MIGRATIONS` v1 core · v2 telegram_bots · v3 ai_memory · v4 telegram_auth_hardening · v5 excel_import_nullable (rebuilds `contracts` so `contract_date` and `service_status` can be NULL; uses FK off plus `foreign_key_check`) · v6 balance_adjustments.
- Applied versions are tracked in `schema_migrations`. `migrate()` runs on every start (`server.mjs:43`). Each migration runs in its own transaction.
- **To change the schema, add a new migration. Never edit an applied one.**

### 4.3 Important tables (49 `CREATE TABLE` statements)

| Table | Purpose / key columns | Written by | Read by |
|---|---|---|---|
| `users` | email, `password_hash` (scrypt), `role_code`, `department_id`, `totp_secret/enabled`, `telegram_user_id` (unique), `tg_quiet_from/to` | auth, users, bootstrap, owners | everything |
| `sessions` | `refresh_hash` (sha256), `expires_at`, `revoked_at`, `source` (WEB/TELEGRAM), `tg_user_id` | auth | auth |
| `roles`, `permissions` | RBAC matrix, seeded when empty (`rbac.mjs:105-116`) | rbac, users | rbac |
| `companies` | counterparties: name, inn, manager_user_id, kind | import, contracts | all finance |
| `service_types` | code, `prefix`, `recognition_rule` JSON | import, seed | contracts, revenue |
| `contracts` | `contract_number` (unique), company, service type, amount, advance_*, due dates, `contract_status`, `service_status`, `payment_status`, comments (contains import trace `[XLS-…]`) | import, contracts | receivables, reports |
| `payment_schedules` | ADVANCE/FINAL/INSTALLMENT portions | contracts | receivables (FIFO) |
| `contract_documents` | `doc_type='ACT'` enables ON_COMPLETION recognition | contracts | revenue |
| `bank_accounts` / `cash_accounts` | `opening_balance` (**NULL = unknown**), `opening_date`, `is_active` | import (NULL), user PATCH | banking |
| `bank_transactions` | `external_id` (unique per account, `ux_btx_ext`), direction, `matching_status` UNMATCHED/SUGGESTED/MATCHED/IGNORED, matched_contract_id/expense_id, `cf_class`, `ignore_reason`, `reversed_at`, `reversal_of` | import, banking, integrations | reconciliation, reports |
| `cash_transactions` | direction, contract_id, expense_id, `cf_class`, `reversed_at` | import, banking, bots | reports |
| `payments` | contract payments linked to a bank or cash tx | reconciliation, import | receivables, revenue |
| `revenue_events` | cash state per payment: CUSTOMER_ADVANCE / RECOGNIZED_REVENUE / REFUNDABLE / REFUNDED | revenue | advances, balance sheet |
| `revenue_recognition` | accrual entries RECOGNIZED/PENDING_APPROVAL/REJECTED; feeds the P&L | revenue | reports |
| `expense_categories` | `pnl_group`, `cf_class`, `is_direct_cost`, keywords | import, seed | expenses, P&L |
| `expenses` | code, category, department, status, approval_id, paid_at, `category_source`, `reversed_at` | import, expenses | P&L, approvals |
| `approval_rules` / `approvals` | rule: entity_type, min/max, steps JSON. Instance: current_step, status | settings / approvals | approvals |
| `employees`, `payrolls`, `kpi_rules`, `employee_kpis`, `advances` | payroll engine | payroll | payroll, forecast |
| `budgets`, `plans`, `forecasts` | plan/fact and forecast snapshots | budget, forecast | reports |
| `notifications` | channel CRM/TELEGRAM/ALERT/EMAIL, type, severity, `dedupe_key` (unique), attempts, next_try_at | notifications | bots dispatcher, UI |
| `integrations`, `integration_sync_logs` | adapter config plus `secret_config` (AES-GCM) | integrations | BANK agent |
| `ai_agents`, `ai_actions`, `ai_conversations` | agent registry, proposals, chat memory | ai | ai, bots |
| `audit_logs` | append-only audit (§7) | `core/audit.mjs` | audit module |
| `import_keys` | idempotency keys for the legacy ledger path | ledger-journal | ledger-journal |
| `balance_adjustments` | technical cover for negative balances (`NEGATIVE_COVER`), reversible | banking | balances |
| `bot_chats`, `bot_dialogs`, `bot_state`, `notification_prefs` | Telegram state | bots | bots |

### 4.4 Current live dataset (`data/finance.db`, verified 2026-09-22)
Non-empty business tables:
- contracts 20 · companies 20 · payments 20 · bank_transactions 144 · cash_transactions 52 · expenses 151
- ai_actions 12 · notifications 18
- bank_accounts 2, of which 1 is active; id 2 was deactivated as an empty duplicate
- cash_accounts 1

Configuration tables that are **empty**: `approval_rules`, `departments`, `employees`, `kpi_rules`, `plans`, `budgets`, `integrations`, `balance_adjustments`, `payment_schedules`, `contract_documents`, `revenue_recognition`, `collections`, `approvals`. The `settings` table holds no business overrides, so code defaults apply.

---

## 5. Excel import pipeline

### 5.1 Files (all present)
- `src/import/excel-journal.mjs`: `parseJournal(buf, {fileName, sheet, baseCurrency, dateFixes})` → **plan**. It writes nothing.
- `src/import/apply-journal.mjs`: `applyJournal(app, plan, {ctx})` performs the idempotent write. `verifyImport(app, plan)` compares Excel and DB totals. `formatReport()` renders the text report.
- `src/import/ledger-journal.mjs`: legacy double-entry parser/writer used by the web upload for the old format.
- `scripts/excel-import.mjs`: CLI.
- Web entry: `POST /api/integrations/ledger-upload` (`integrations.mjs:296`). It tries `parseJournal` first; when `plan.meta.format==='SINGLE_ENTRY'` it takes the plan/apply/verify path, otherwise it falls back to `ledger-journal`.

### 5.2 Input
- Header row must contain `Dogovor No` (plus `Sana`, `Uchish kuni`, `Qaytish kuni`, `To'lov kuni`, `Valyuta`, `Summa`, `Shyot nomi`, `Kontragent`, `Napravleniye`, `Operator`, `Transaksiya raqami`, `Kurs`, `Summa USD`, `Bron nomer`).
- Required: `no`, `tolov`, `summa`, `shyot`.
- Rows with template columns filled (Uchish/Qaytish/Operator/Trans/Bron) or template accounts ("Продажы - Тур", …) are skipped as leftovers of a tourism template.
- Any non-UZS `Valyuta`, or a filled `Kurs`/`Summa USD`, is an **error**. FX is never guessed.
- Dates come from Excel serials or `YYYY-MM-DD`/`DD.MM.YYYY`. An unparseable date is an error. A year outside 2000–2100 sends the group to **quarantine** (it is not written).

### 5.3 Two formats
**Legacy double-entry:** every `Dogovor No` group must sum to 0. The sale row is negative and paired with Дебитор; money rows carry sign rules; transfers are two rows.

**Current single-entry (director's July format).** Detected by `isSingleEntry()`: no Дебитор rows, no negative amounts, and at least one `Договор` row or compound money account. Classification is done by `singleEntryAccount()`:

| `Shyot nomi` | Plan element |
|---|---|
| `Договор` | contract. `service = Napravleniye`, `contract_date = Sana` (NULL in this file) |
| `Поступление БАНК/КАССА` with the same No and same Kontragent as a `Договор` | contract payment |
| other `Поступление …` | `incomes` (kind OTHER, `cf_class UNCLASSIFIED`) plus an open question |
| `Расход Трансфер в КАССУ` | `transfers` BANK→CASH |
| `Расход Банк|Касса <item>` | item = suffix, or Kontragent when the suffix is empty |
| item `дивиденд` / Kontragent `Учредитель` | `nonExpenses` DIVIDEND (`cf_class FINANCING`) |
| item matching `фин.займ` | `nonExpenses` LOAN (`UNCLASSIFIED`, with a question) |
| item containing the word `возврат` | `nonExpenses` REFUND (`UNCLASSIFIED`, with a question) |
| item found in `CATEGORY_MAP` (з/п, ндс, есп, инпс, подоходный налог, налог на прибыль, аренда, мусор, маркетинг, интернет, дидокс, комиссия банка, адвокат, услуга субподряд, прочий, корпоратив карта) | categorized expense (`pnl_group` from the map) |
| free text (cash) | uncategorized expense. The text is kept verbatim |

Validation for contract groups rejects any of these: more than one `Договор`, mixed expense rows, an empty Kontragent or Napravleniye, a payer that doesn't match, or paid > amount.

### 5.4 Write semantics (`apply-journal.mjs`)
- Everything runs in a single `db.tx`. **If the plan has errors, nothing is written.** The CLI exits with 1.
- Minimal reference data is created on demand: bank account `БАНК` and cash `КАССА` with `opening_balance NULL`, companies, service types (recognition `ON_COMPLETION` with an act required), and categories.
- **Renamed accounts.** If `БАНК`/`КАССА` is not found by name but exactly one active account exists, that account is reused (added 2026-09-22 after the bank was renamed to `UTAX BANK`).
- **Idempotency.** Every element gets a key `<prefix>-<No>[.<n>]`. The prefix is `XLS-YYYY-MM` when all dates fall in one month; otherwise it is `XLS-<sha8>`. Existing rows are detected as follows:
  - bank: `external_id` per account;
  - cash: the `[KEY ` marker in `purpose`;
  - expenses: `code`;
  - contracts: the marker in `comments` or `contract_number`.
  Re-importing the same file therefore writes 0 new rows (`created.* = 0`, `existing.* > 0`). A contract number already owned by a different company or amount aborts the whole import.
- Bank incomes linked to a contract → `reconciliation.confirm`. Non-contract incomes, dividends, loans and refunds → `reconciliation.ignore(reason, cf_class)`. Expenses → an `expenses` row plus a bank tx with `confirmExpense`, or a cash tx with `expense_id`.

### 5.5 CLI
```
node scripts/excel-import.mjs <file.xlsx> [--db data/finance.db] [--reset] [--dry-run]
                              [--sheet <name>] [--report <file.json>] [--fix-date <row>=YYYY-MM-DD[,...]]
```
- `--dry-run`: parse and report only.
- `--reset`: moves the DB (+wal/shm) to `data/backups/…-pre-import-<ts>.db` and starts with a fresh schema. **The server must be stopped first**; otherwise the rename fails and the script aborts without changing anything.
- `--fix-date`: user-approved date correction. It is recorded as a plan warning ("foydalanuvchi tasdig'i bilan tuzatildi").
- Exit code 3 means the post-import verification did not match.

### 5.6 July import facts (from `data/imports/iyul-2026.json`)
- Sheet `Лист1`, 215 rows, format SINGLE_ENTRY, period 2026-07, prefix `XLS-2026-07`.
- 20 contracts / 20 payments / 5 incomes / 151 expenses / 16 non-expenses / 2 transfers.
- 0 errors, 0 quarantined, 1 warning (the date fix, row 69: 1965-07-20 → 2026-07-20).
- `verify.ok = true`.

---

## 6. Authentication

| Aspect | Implementation |
|---|---|
| Passwords | scrypt, 16-byte salt, 64-byte key, stored as `scrypt:salt:hash`, compared with `timingSafeEqual` (`src/core/auth.mjs:5-16`) |
| Access token | hand-rolled HS256 JWT using `JWT_SECRET`. `ACCESS_TOKEN_TTL` defaults to 900 s. ⚠ A hard-coded dev fallback is used when unset (`config.mjs:35`) |
| Refresh token | random `uid(32)`, only its sha256 is stored in `sessions`. `REFRESH_TOKEN_TTL` defaults to 7 days. Rotated on `/api/auth/refresh`: the old session is revoked (`modules/auth.mjs:108-119`) |
| Logout | revokes the refresh session. There is no access-token denylist, so the access token lives up to 15 min |
| Rate limits (in-memory) | login 10/min per IP+email; 2FA 5/min per user; Mini App 60/min per IP and 10/min per tg id; global 900/min per IP (`server.mjs:124`) |
| 2FA | TOTP SHA1, 6 digits, 30 s, ±1 window. Login returns a `temp_token` (typ `2fa`, 300 s) → `/api/auth/2fa/verify`. Setup/enable/disable at `modules/auth.mjs:143-160` |
| Mini App | `POST /api/auth/telegram-webapp` checks initData HMAC (`WebAppData`, bot token), max age 3600 s, and maps via `users.telegram_user_id`. The token carries `src:'TELEGRAM', tg` and is invalid once the link changes |
| Telegram linking | `POST /api/auth/telegram-link` returns a 12-hex code valid for 24 h and a `t.me/<bot>?start=CODE` deep link. 5 wrong codes → 1 h block. Relinking revokes the old account's Telegram sessions |
| Owners | `BOT_OWNER_IDS` → FOUNDER account (linked FOUNDER or `tg<id>@owner.utax.uz`); it never promotes another role (`bots/shared/owners.mjs:38-74`) |
| Bootstrap admin | when `ADMIN_EMAIL` is set: creates or enforces FOUNDER; a password change revokes sessions (`core/bootstrap.mjs:12-39`) |
| Service auth | `X-Api-Key` (sha256 match against `ai_agents.api_key_hash`) → role `AI_AGENT` |
| Secrets at rest | `encryptSecret` uses AES-256-GCM with key = sha256(`SECRETS_KEY`). ⚠ A dev fallback is used when unset (`config.mjs:38`) |

---

## 7. Authorization (RBAC) and audit

- **Model:** 11 roles × 23 resources × 7 actions (`src/core/rbac.mjs:3-69`). Seeded only when `permissions` is empty; edited via `PUT /api/roles/:code/permissions` (FOUNDER is locked).
  - Roles: FOUNDER, CEO, CFO, FINANCE_MANAGER, ACCOUNTANT, SALES, DEPARTMENT_HEAD, EMPLOYEE, AUDITOR, ADMIN, AI_AGENT.
  - Actions: VIEW, CREATE, EDIT, APPROVE, REJECT, DELETE, EXPORT.
  - Resources: dashboard, treasury, contracts, transactions, reconciliation, revenue, receivables, collections, expenses, approvals, pnl, cashflow, balance, planfact, forecast, payroll, ai, reports, integrations, notifications, audit, settings, users.
- **Enforcement.** A route option `perm:[resource, action]` is checked after `resolveUser` (`server.mjs:156-161`). Telegram handlers call the same services and use `ctx.can`, so web and bots share one model. The AI tool list is filtered by the same permissions (`ai.mjs:467-485`).
- **Row scoping.**
  - SALES: contract list and receivables limited to own records (`contracts.mjs:212`, `receivables.mjs:21-24`).
  - Expenses: EMPLOYEE sees own, DEPARTMENT_HEAD sees their department.
  - Approvals: EMPLOYEE/SALES see own requests or ones they can act on.
- **Approval guards** (`approvals.mjs:18-31`):
  - No self-approval, FOUNDER included.
  - `AI_AGENT` can never approve.
  - A DEPARTMENT_HEAD step requires being head of that department.
  - Delegation `ACT_AS`: FOUNDER can act as any role; CEO as DEPARTMENT_HEAD; CFO as FINANCE_MANAGER/ACCOUNTANT.
- **Audit** (`core/audit.mjs`, table `audit_logs`):
  - Columns: user_id, role, action, entity, entity_id, old/new JSON, ts, ip, `source` (WEB/API/TELEGRAM/AI/IMPORT/SYSTEM), approval_id, ai_agent_code.
  - Nothing in `src/`, `scripts/` or `api/` issues UPDATE or DELETE on this table. There is no DB trigger enforcing that.
  - Corrections use reversals, never deletes: bank `reversal_of` mirror row, expense `reversed_at`, negative revenue REVERSAL, adjustment `reversed_at`.
  - Read API: `GET /api/audit` (1000-row cap) and `GET /api/audit/stats`.

---

## 8. Backend modules (`src/modules/`, route counts)

| Module | Routes | Responsibility and notable rules |
|---|---|---|
| banking | 16 | Accounts, transactions, cash, import rows. `bankBalance`/`cashBalance` (§12). `balance_adjustments` (`cover-negative`, `reverse`). Reversals |
| expenses | 15 | Requests (keyword auto-categorization; confidence `min(0.97, 0.6+0.15·hits)`, ≥0.8 counts as AI_RULE), direct create, pay/markPaid, reversal. LARGE_EXPENSE alert at ≥30M |
| payroll | 13 | KPI formulas (PCT_OF_DEPT_REVENUE, PCT_OF_OWN_REVENUE, PER_UNIT, THRESHOLD_BONUS, PCT_OF_FIXED); gross/deductions (`payroll.income_tax_pct`=12)/net. Submit → approval → one APPROVED expense per department → markPaid |
| auth | 12 | §6 |
| contracts | 12 | Numbering `UTAX-{prefix}-{00001}`. Status machine `recompute` (DRAFT…CLOSED/CANCELLED). Schedules. `setServiceStatus` triggers recognition. `addDocument(ACT)` retries recognition. Cancellation is blocked after revenue has been recognized |
| ai | 10 | Agents, actions, chat (§11) |
| integrations | 10 | Adapters, sync, ledger/excel upload, inbound webhook (§13) |
| reports | 8 | dashboard, treasury, pnl, cash-flow, balance-sheet, service-profitability, trends, data-quality |
| users | 8 | CRUD, block (revokes sessions), roles/permissions |
| approvals, notifications, revenue | 7 each | Approval engine; notification channels; recognition engine |
| receivables, reconciliation, settings | 6 each | FIFO aging; scoring/matching; settings plus manual scheduler runs |
| budget | 5 | plan/fact, budgets |
| bots, companies | 4 each | Bot status/test/chats; counterparties |
| audit, forecast | 2 each | Audit read API; 3-scenario forecast |
| `ai-context.mjs` | — | Masking and context helpers for the LLM |

**Totals:** 160 module routes (65 GET, 72 POST, 6 PUT, 17 PATCH, 0 DELETE), plus 4 inline routes and `POST /telegram/:bot` in `server.mjs`. OpenAPI is generated from the route table at `/api/openapi.json`, with Swagger UI at `/api/docs` (loaded from the jsdelivr CDN).

### Key endpoints (verified)
| Method | Path | Auth / perm | Purpose |
|---|---|---|---|
| GET | `/api/health` | none | liveness plus `build` id |
| GET | `/api/cron/tick` | `Bearer CRON_SECRET` | runs `scheduler.tick()` and `bots.retryPending` |
| POST | `/api/auth/login` · `/2fa/verify` · `/refresh` · `/telegram-webapp` | none | auth flows |
| GET | `/api/dashboard?from&to` | dashboard VIEW | KPIs. Defaults to the current month |
| GET | `/api/treasury` | treasury VIEW | bank/cash/available/safe withdrawal |
| GET | `/api/reports/pnl?month=YYYY-MM` (or `period`, `from`,`to`) | pnl VIEW | P&L |
| GET | `/api/reports/cash-flow?month=` | cashflow VIEW | CF by class |
| GET | `/api/reports/balance-sheet?as_of=` | balance VIEW | balance sheet |
| GET | `/api/reports/data-quality` | dashboard VIEW | data-quality issues |
| GET/POST | `/api/contracts` | contracts VIEW/CREATE | list/create |
| POST | `/api/contracts/:id/service-status` | contracts EDIT | triggers revenue recognition |
| GET / PATCH | `/api/banking/accounts` · `/api/banking/accounts/:id` | treasury VIEW / CREATE | balances; edit name/opening balance |
| GET/POST | `/api/banking/adjustments`, `/cover-negative`, `/:id/reverse` | treasury | technical balance cover |
| GET | `/api/receivables`, `/aging`, `/summary` | receivables VIEW | AR |
| POST | `/api/reconciliation/match` | reconciliation APPROVE | manual match |
| POST | `/api/expenses/request` · `/api/expenses/:id/pay` | expenses CREATE / EDIT | request / pay |
| POST | `/api/approvals/:id/approve` / `reject` | approvals APPROVE/REJECT | decisions |
| POST | `/api/revenue/recognize` | revenue CREATE | manual recognition (MILESTONE) |
| POST | `/api/integrations/ledger-upload` | integrations EDIT + transactions CREATE | Excel journal (preview or import) |
| POST | `/api/integrations/webhook/:token` | none (token) | inbound push |
| POST | `/api/ai/chat`, `/api/ai/actions/:id/approve` | ai CREATE / ai APPROVE | chat / execute proposal |

---

## 9. Request pipeline & HTTP hardening
`server.mjs:151-163`: global rate limit → route match → `resolveUser` (Bearer JWT or `X-Api-Key`) → `rbac.require(perm)` → handler.

- **Headers.** `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`. HTML additionally gets CSP `frame-ancestors`, limited to Telegram domains so the Mini App works.
- **Not present.** Full CSP, HSTS (nginx adds HSTS) and CORS.
- **Body limit.** 25 MB (`http.mjs:24-44`).
- **Errors.** 500 messages are hidden when `NODE_ENV=production`.
- ⚠ `clientIp` trusts `X-Forwarded-For` (`http.mjs:52-56`), so rate limits can be bypassed when the app is not behind a trusted proxy.

---

## 10. Frontend (`public/`)
- **Stack.** Vanilla ES modules, no framework, no build step. The DOM is created with `h()` (`js/ui.js`).
- **Router.** Hash-based (`js/app.js:110-145`). `#/<page>` dynamically imports `./pages/<page>.js` and calls `default(el, ctx)`, where `ctx = {params, query, me, can, navigate, roleLabel, setTitle, setActions}`.
  - **19 routes, verified.** Each maps to a page file and to a permission resource of the same name: dashboard, treasury, contracts, transactions, receivables, expenses, pnl, cashflow, balance, planfact, forecast, payroll, ai, reports, integrations, approvals, notifications, audit, settings.
  - Sub-routes are passed through `params`, e.g. `#/contracts/:id`, `#/settings/profile`.
- **Auth state.** `localStorage` keys `uf_access`/`uf_refresh`. On a 401 the client refreshes once; concurrent refreshes share one promise (`js/api.js`). 2FA login is supported. Mini App launches pass `tgWebAppData` to `/api/auth/telegram-webapp`.
- **Role-based UI.** `App.can(res, action)` reads `perms` from `/api/auth/me` and filters nav, routes and search.
- **Components** (`js/ui.js`): fmt/money/date, badge, toast, modal/drawer/form, dataTable (search/paging/export), kpiCard, statTile, periodPicker/dateRange, fileDrop. Charts are hand-written SVG (`js/charts.js`).
- **Missing values.** `fmt(null)` renders `--`. The dashboard shows a "no records in current month → show last month" banner (`pages/dashboard.js:23`).
- **Asset versioning.** The server rewrites `/css|/js` to `/v/<build>/` and injects `<meta name="app-build">`.
  - Versioned files are served `immutable`; `index.html` is served `no-store`.
  - The build id is the Vercel deployment id or commit SHA, otherwise the newest mtime in `public/`.
  - The client reloads when `/api/health.build` changes.
- **PWA.** `manifest.webmanifest` (standalone, start `/#/dashboard`, theme `#059669`, 4 shortcuts). `sw.js`:
  - never caches `/api/*` or non-GET requests;
  - navigation is network-first with an offline fallback;
  - `/v/<build>/` is cache-first and old builds are purged;
  - icons use stale-while-revalidate.
  `pwa.js` shows an install prompt, with a manual guide on iOS/Safari. The service worker registers only on HTTPS or localhost.
- **Conventions.** `UI-SKILL.md` is the single UI source of truth: tokens only (`var(--…)`, no raw hex), emerald `--primary`, Uzbek Latin copy, numbers through `fmt()`, every number drills down to its source, and no sample data. **Read it before any UI change** (`CLAUDE.md`).

---

## 11. AI subsystem

### 11.1 Agents: 14, all rule-based
None of the agents calls an LLM. The registry is `AGENTS` (`src/modules/ai.mjs:599-614`); runners are at `:617-717`. `runAgent` skips inactive agents, runs as role `AI_AGENT` with `user.id=null`, stores `last_run_at/last_result`, and writes an `AGENT_RUN` audit entry.

| Agent | What it does | Class |
|---|---|---|
| CFO | daily digest (treasury, AR, approvals, data quality) → FOUNDER/CEO/CFO | Observation |
| BANK | `integrations.sync` for active BANK_API/GOOGLE_SHEETS/ONE_C/ERP → **inserts bank tx and auto-matches**. Currently no integrations are configured | Automatic action |
| RECONCILIATION | `reconciliation.runAll`; proposes `MATCH_TRANSACTION` for SUGGESTED. Income auto-match is blocked for AI_AGENT (`reconciliation.mjs:117`), **expense auto-confirm is not** (`:126`) | Recommendation + partial automatic |
| REVENUE | straight-line run. For AI_AGENT recognition is forced to PENDING_APPROVAL. Missing-act notices; `REVIEW_CONTRACT` proposals | Manual approval |
| EXPENSE | keyword categorization. **Writes `category_id` directly** when confidence ≥ 0.8; otherwise proposes `SET_EXPENSE_CATEGORY` | Automatic + recommendation |
| APPROVAL | reminders for stale approvals | Observation |
| CASH_FLOW | LOW_LIQUIDITY (CRITICAL) and 7-day risk alerts | Observation |
| RECEIVABLE | aging notification | Observation |
| COLLECTION | **inserts `collections` tasks** and supersedes old ones | Automatic action |
| PAYROLL | proposes `COMPUTE_PAYROLL`; late-payroll notice | Recommendation |
| FORECAST | 30/90-day forecast; alert when risk is HIGH | Analysis |
| FINANCIAL_ANALYST | reuses the `WHY_PROFIT` rule handler. **Not scheduled**; runs manually only | Analysis |
| DATA_QUALITY | notifies non-INFO issues | Observation |
| AUDIT_ANOMALY | mean+3σ amounts over 90 days, ±3-day duplicates, budget overruns → `FLAG_ANOMALY` proposals | Analysis + recommendation |

### 11.2 Scheduler
`src/core/scheduler.mjs` ticks every 60 s. Jobs use `everyMs` or `dailyAt` in local time, and `last_run` is stored in `settings` under `scheduler.last_run.<name>`. Registered jobs (`server.mjs:62-76`):

| Job | Schedule |
|---|---|
| recompute-contracts | every 6 h |
| collection | 08:00 |
| data-quality | 08:10 |
| revenue | 01:00 |
| cfo | 08:30 |
| forecast | 07:00 |
| audit-anomaly | 09:00 |
| payroll | 09:30 |
| receivable | 08:20 |
| expense | 02:00 |
| approval | 60 min |
| cash-flow | 30 min |
| bank | 60 min |
| reconciliation | 60 min |
| backup | 03:00 (skipped on remote DB) |

Bot jobs are registered as `bot-<key>-<name>`. Manual triggers: `POST /api/settings/scheduler/:name/run` and `POST /api/ai/agents/:code/run`.

### 11.3 Proposals (`ai_actions`)
- **Lifecycle:** PROPOSED → `decideAction` → REJECTED, or executed → EXECUTED/FAILED. Every step is audited.
- **Who decides:** `AI_AGENT` can never decide. A chat proposer cannot self-approve. Deciding requires `ai APPROVE/REJECT`, which by default only FOUNDER and CFO have.
- **Executors:** MATCH_TRANSACTION, SET_EXPENSE_CATEGORY, RECOGNIZE_REVENUE (may still require approval), COMPUTE_PAYROLL, CREATE_COLLECTION_TASK (⚠ runs the whole collection agent and ignores its payload), FLAG_ANOMALY (appends `[FLAGGED]` to `tx_type`), REVIEW_CONTRACT (⚠ no-op).
- **Kill switches:** `ai.allow_llm` disables the LLM only; `ai_agents.is_active` switches individual agents off. **There is no global agent kill switch.**

### 11.4 LLM chat (`src/core/llm.mjs`, `ai.mjs:527-593`)
- **Chain:** Gemini (`GEMINI_MODEL`, default `gemini-3.6-flash`, then `GEMINI_FALLBACK_MODELS`) → Groq (`GROQ_MODEL` `openai/gpt-oss-120b`) → Groq fallback (`openai/gpt-oss-20b`) → rule engine. The rule engine has 22 intents plus HELP, each RBAC-checked.
- **Resilience:**
  - `AI_TIMEOUT_MS` 25 s per request.
  - Gemini sliding-window RPM budget.
  - After a 429: 60 s cooldown for Gemini, ≥5 s for Groq. After 401/403: 10 min cooldown.
  - Blocked, empty or truncated responses count as failures.
  - No retry on the same provider. Up to 4 tool steps.
- **Tools:** 24 read-only `get_*` tools, 6 of them self-scoped (`my_*`). One write tool, `propose_action` (creates PROPOSED only; web persona only). Each tool is filtered and re-checked against the user's permissions.
- **Masking** (`ai-context.mjs:198-251`, `AI_MASK_NAMES`):
  - Company names → `MIJOZ_<id>`, users/employees → `XODIM_<id>`.
  - INN, phone, account, card and PINFL patterns → `***`.
  - Applied to the prompt, history, question and tool results. Tool results are compacted to 12 rows / 4500 characters.
- **Memory:** `ai_conversations`; last `AI_MEMORY_TURNS` (6) turns within `AI_MEMORY_HOURS` (12 h). `/clear` stores a reset marker in `bot_state`.
- **Approvals via chat:** approve intents never go through the LLM. They produce a confirm button, which calls `/api/ai/confirm` → `approvals.decide`.
- **Keys:** whether `GEMINI_API_KEY`/`GROQ_API_KEY` are set in the running environment is **not verified** in this document (`.env` was deliberately not read). `npm run llm:check` pings the providers without sending company data.

---

## 12. Finance calculations (as implemented)

| Metric | Formula / source |
|---|---|
| Bank / cash balance | `opening_balance + Σ adjustments + Σ(INCOME−EXPENSE)` over non-reversed tx with `tx_date ≤ asOf`. The result is **`null` when the opening balance is NULL and there are no adjustments** (`banking.mjs:12-38`). The total is null if any account is null |
| Total cash | `nadd(bank, cash)`, which is null-propagating (`reports.mjs:6`) |
| Available cash | `total − advances×cash.advance_restriction_pct% (default 100) − (approved unpaid expenses + submitted payroll + cash.safety_reserve)` |
| Safe withdrawal | `max(0, available − 30-day outflow + 0.5 × 30-day expected receipts)` |
| Low liquidity | `available < cash.low_liquidity_threshold` |
| Customer advances | Σ `revenue_events` with state CUSTOMER_ADVANCE. For a historical date: per contract `max(0, paid − recognized − refunded)` |
| Receivables | active contracts with remaining > 0. Payments are allocated FIFO to `payment_schedules`; the remainder is due on `payment_due_date`, or goes to **NO_DUE** when there is none (never counted as overdue). Buckets: CURRENT, 0-7, 8-15, 16-30, 31-60, 60+, NO_DUE. `is_critical` means ≥ `collection.critical_days` (15) |
| Revenue | rule from `service_types.recognition_rule`. ON_COMPLETION: BLOCKED until an ACT exists when `require_acceptance_document`; ON_PAYMENT: per payment; STRAIGHT_LINE: monthly. Amounts ≥ `revenue.approval_threshold` (default 50,000,000) or requested by AI → PENDING_APPROVAL. Recognition is capped at the contract amount. Recognized revenue converts advances FIFO |
| P&L | revenue = recognized. Expenses = APPROVED/PAID, not reversed, grouped by `pnl_group`. `gross = rev − DIRECT`; opex = PAYROLL+MARKETING+ADMIN+IT+OFFICE+OTHER_OPEX+UNCATEGORIZED; `net = operating − TAX − OTHER`. Dividends, loans, refunds and transfers are never expenses, so they stay out |
| Cash flow | opening = balance(from−1), closing = balance(to). Transactions are summed by `cf_class` into OPERATING/INVESTING/FINANCING; TRANSFER is shown separately and excluded from totals; anything else is UNCLASSIFIED |
| Balance sheet | Assets: bank, cash, AR (recognized unpaid). Liabilities: customer advances, AP (approved unpaid), payroll payable. `equity = assets − liabilities`. The contract backlog is a memo line only |
| Plan/fact | status NO_PLAN/OK/WARN (tolerance `planfact.tolerance_pct`=10)/BAD; prorated by day for custom ranges |
| Forecast | three scenarios (conservative/base/optimistic, `settings.mjs:36-40`). Inflow = due × collection rate + overdue × rate + pipeline × rate. Outflow = (approved unpaid + recurring + payroll estimate + 3-month average variable opex) × factor. Risk is HIGH/MEDIUM/LOW against the liquidity threshold |
| Reconciliation score | income: +70 contract number, +30 INN, +10×name similarity (≥0.6), amount +20/+15/+5/−20, +5 near the due date, capped at 99. Expense: amount +55, counterparty +25×, purpose +10×, date +10/+4, expense code +30. **Auto-match at ≥95** if unique (runner-up more than 10 points behind) and the actor is not AI; suggest at ≥60. ⚠ The file header comment (`reconciliation.mjs:6`) still describes older weights |

### Live July numbers (API, verified 2026-09-22)
- **P&L 2026-07:**
  - revenue 0
  - DIRECT −44,200,000
  - PAYROLL −888,906,857.77
  - MARKETING −248,200,000
  - ADMIN −39,006,943.44
  - IT −4,274,500
  - OFFICE −93,773,548.13
  - OTHER_OPEX −77,737,972.45
  - UNCATEGORIZED −164,101,440
  - TAX −511,404,309.62
  - **NET −2,071,605,571.41**
- **Cash flow 2026-07:**
  - opening 1,192,952,868
  - operating +503,900,000 / −2,071,605,571.41
  - financing −352,253,440
  - transfers ±123,999,960
  - unclassified +266,550,000 / −248,800,000
  - closing −709,256,143.41
- **Balance 2026-07-31:**
  - bank −747,819,223.41, cash 38,563,080
  - advances 503,900,000
  - equity −1,213,156,143.41
  - backlog memo 682,700,000
- **Receivables:** 682,700,000 across 9 contracts, all in NO_DUE.
- **Data quality:** CONTRACT_NO_DUE_DATE 9 (WARNING), EXPENSE_NO_CATEGORY 35 (INFO), COMPANY_NO_INN 20 (INFO).
- **Opening balances (user-entered 2026-09-22):** UTAX BANK 1,092,584,868 and КАССА 100,368,000, both dated 2026-07-01.

---

## 13. Integrations (`src/modules/integrations.mjs`, `ADAPTERS :172-237`)

| Adapter | Config / secrets | Behaviour | Live status |
|---|---|---|---|
| LEDGER | — | manual Excel journal upload | **Live**, used for July |
| EXCEL | bank_account_id | manual bank statement upload (`/excel-upload`) | Available, unused |
| BANK_API / ERP | base_url, endpoint, account_id, auth_type (bearer/basic/header/none), since_param, list_path, field_map, days_back / `api_key` | generic REST JSON pull with a 30 s timeout; field mapping via `DEFAULT_FIELDS` | Code ready, **not configured** (0 integration rows) |
| ONE_C | mode odata/http, base_url, endpoint / username, password | reads OData `Document_ПоступлениеНаРасчетныйСчет` and `Document_СписаниеСРасчетногоСчета` | Code ready, not configured |
| GOOGLE_SHEETS | sheet_url, mapping | CSV export; a private sheet returns an error | Code ready, not configured |
| EMAIL | smtp_host/port/security, from, recipients, webhook_url / smtp_user, smtp_pass | `src/core/smtp.mjs` (ssl/starttls/none, AUTH PLAIN/LOGIN). Otherwise uses `EMAIL_WEBHOOK_URL` | Not configured |
| WEBHOOK_IN | bank_account_id, field_map / token | `POST /api/integrations/webhook/:token` | Not configured |
| TELEGRAM | alert_chat_id | getMe check plus test message | Bot tokens are env-based (§14) |
| GEMINI / GROQ | model / api_key | runtime override of the env keys | Not verified |

- `sync()` → `banking.importRows` → `integration_sync_logs`; the "since" date is `last_sync_at`.
- The BANK agent syncs hourly. Active DB rows for TELEGRAM/EMAIL/GEMINI/GROQ override env values (`applyRuntime :244-265`).
- Tests use local fake servers (`tests/integrations-real.test.mjs`). **No production credentials have been exercised.**

---

## 14. Telegram bots (`src/bots/`)

**Runtime:**
- `BOT_MODE` is `polling`, `webhook` or `off`. The default is polling; on Vercel it is webhook when `PUBLIC_URL` is set, otherwise off.
- Webhook mode needs an https `PUBLIC_URL` and `WEBHOOK_SECRET`. The secret header is compared timing-safe.
- Polling calls `deleteWebhook` on start. The offset is keyed by bot id.

**Error handling:**
- 401/404 on getMe → fatal for that bot. The log says "qayta urinilmaydi"; the bot is not retried.
- 409 → warning and a 15 s sleep.
- Other start errors → backoff from 5 s up to 60 s.
- The client retries 429/5xx and redacts the token from errors (`shared/telegram-api.mjs:46-56`).

**Pipeline** (`shared/bot-factory.mjs:181-284`):
1. update dedupe;
2. private chats only;
3. rate limit, 30 messages per 60 s per user;
4. `/start CODE` linking;
5. auth (owner → FOUNDER; unlinked → instructions plus `TELEGRAM_ACCESS_DENIED` audit; blocked; wrong audience → links to the right bot);
6. callbacks / commands / open dialog / file / free text (AI chat).

**Common commands:** `/start`, `/help` (`/yordam`), `/bekor` (`/cancel`), `/clear` (`/tozalash`, which clears AI memory and the open dialog), and a hidden `/menu`. The menu keyboard also has "🌐 Web panel".

**Shared callbacks:** `apr:ok|no|later|view:<id>` (TTL 7 d), `aprr:<id>:<n>` (24 h), `nr:<id>`, `x`.

**Mini App:** base URL is `WEBAPP_URL` or `PUBLIC_URL`. https → web_app buttons plus a "📊 Dashboard" menu button; plain http → URL buttons; localhost/private IP → no buttons.

| Bot (env) | Audience | Main features (writes marked ✎) | Status 2026-09-22 |
|---|---|---|---|
| **rahbar** (`BOT_RAHBAR_TOKEN`, legacy `TELEGRAM_BOT_TOKEN`) | FOUNDER, CEO, CFO, ADMIN | Holat, Pul, Sifat, Foyda, Xizmatlar, Pul oqimi, Balans, Reja/Fakt, Prognoz, Debitorlik, Tasdiqlash ✎, AI takliflari ✎ (`ai.decideAction`), Agentlar ✎ (run), Hisobot (Excel), Xodimlar ✎ (kill switch `users.setActive`) | ❌ **getMe 401 Unauthorized** at start: the token is revoked or invalid, so the bot is not running |
| **buxgalter** (`BOT_BUXGALTER_TOKEN`) | FOUNDER, CFO, FINANCE_MANAGER, ACCOUNTANT | Vipiska ✎ (`importRows`), Bog'lash ✎, Tushumlar, Kassa ✎, To'lov ✎, Xarajatlar, Daromad, Akt ✎, Shartnoma ✎, Oylik ✎, Byudjet, Integratsiyalar ✎ (sync), Sifat, Tasdiqlash. Weekday 17:00 statement reminder | ✅ polling |
| **sorov** (`BOT_SOROV_TOKEN`) | all 10 human roles | Yangi so'rov ✎ (`expenses.request` plus receipt), So'rovlarim, Tasdiqlash (EXPENSE), Shartnomalarim, Qarzdorlarim, Vazifalarim ✎, Oyligim, KPI | ✅ polling |
| **signal** (`BOT_SIGNAL_TOKEN`) | all | Bugun, O'qilmagan, Tarix, Sozlama (per-type toggles, quiet hours 22–08/23–07/off), Test | ✅ polling |

**Notifications** (`src/modules/notifications.mjs`, `bots/shared/dispatcher.mjs`):
- A CRM row is always created.
- A TELEGRAM row is created when `notifications.telegram_enabled` is on, the user is linked, and their prefs allow it.
- ALERT rows (CRITICAL only) go to `TELEGRAM_ALERT_CHAT_ID`.
- EMAIL is sent only if `notifications.email_enabled`, and only for CRITICAL or DAILY_DIGEST.
- Delivery goes through the signal bot first, then falls back to other bots.
- Failed deliveries retry every 60 s, up to 5 attempts, only for items from the last 24 h.
- Quiet hours are skipped for CRITICAL. Dedupe key is `${dedupe_key}:u<id>`.
- Event sources: approvals, large expense, payroll, receivables, overpayment, missing document, AI agents, bot linking. The `AI_ACTION` type exists but nothing sends it.

---

## 15. Deployment

| Target | How | Notes |
|---|---|---|
| **Local / Mac mini** | `npm start`. Data comes from `npm run vault:unpack` | Stop the server before `unpack` or `--reset`. macOS 24/7 supervision (launchd) is **not implemented in the repo** |
| **VPS (Ubuntu)** | `deploy/install.sh` (Node 24, `finance` user, `/opt/utax-finance-crm`, random secrets, systemd unit, 03:20 cron backup), `nginx.conf` (TLS, HSTS, 20 r/s, 30 MB), `backup.sh` (daily 30 d / weekly 90 d), `restore.sh` | ⚠ `nginx.conf` sets `X-Frame-Options DENY`, which conflicts with the Mini App CSP `frame-ancestors`. `install.sh` uses apt/systemd and does not work on macOS |
| **Docker** | `Dockerfile` (node:24-alpine, user `node`, healthcheck `/api/health`); `docker-compose.yml` (requires `JWT_SECRET`/`SECRETS_KEY`, volume `finance-data`, 127.0.0.1:8100) | ⚠ Compose defaults `SEED_ON_EMPTY=true`, which conflicts with rule #1. The image excludes `scripts/` and `api/`, so vault/import tooling cannot run inside it |
| **Vercel** | `vercel.json` (fra1, single function `api/index.mjs`, catch-all rewrite, cron `/api/cron/tick` at `30 4 * * *`), Turso (`TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`), `CRON_SECRET`; pre-deploy check `npm run vercel:check` (18 checks) | Without Turso the DB lives in `/tmp` and is lost. Polling bots do not run. Uploads/backups are ephemeral. 30/60-min jobs run only once per day unless an external cron calls `/api/cron/tick`. **Deployment status: not verified** (PR #4 merged, no evidence of a live deployment) |

**Health:** `GET /api/health` returns 200 plus the build id.

---

## 16. Encrypted data vault (`scripts/data-vault.mjs`)
- **Algorithm:** AES-256-GCM plus gzip. File layout: `UTAXVLT1 | iv(12) | tag(16) | ciphertext`.
- **Key:** `DATA_VAULT_KEY` (64 hex), stored **only in `.env`**. `manifest.json` stores a 12-char sha256 fingerprint of the key, never the key.
- **Commands:**
  - `keygen`: writes the key to `.env` and never prints it.
  - `pack [--add file]`: `VACUUM INTO` a consistent snapshot, then encrypt → `data/vault/finance.db.enc` and `data/vault/source/*.enc`.
  - `verify`: fingerprint plus sha256 check, writes nothing.
  - `unpack`: moves the current DB to `data/backups/finance-pre-unpack-*.db`, writes `data/finance.db` and restores source files to `data/imports/source/`.
- **Committed now:** `data/vault/finance.db.enc` (snapshot 2026-09-22T13:03Z), `data/vault/source/moliya-iyul-2026.xlsx.enc`, `manifest.json`.
- `.gitattributes` marks `*.enc` binary so CRLF conversion doesn't corrupt the files.
- **Never commit:** `.env`, the vault key, plaintext `*.db`, `*.xlsx`, `data/imports/`, `data/backups/`, `uploads/`. All of these are gitignored.
- The vault is **not updated automatically**. Run `npm run vault:pack -- --add <source.xlsx>` and commit after data changes.
- Tests: `tests/data-vault.test.mjs` covers round-trip, wrong key, tamper and key format.

---

## 17. Environment variables (names only)
- **Core:** PORT, HOST, NODE_ENV, APP_TZ, DB_PATH, DB_DRIVER, JWT_SECRET, ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL, SECRETS_KEY, CRON_SECRET, SEED_ON_EMPTY, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME, DATA_VAULT_KEY.
- **DB remote:** TURSO_DATABASE_URL, TURSO_AUTH_TOKEN (aliases LIBSQL_URL, LIBSQL_AUTH_TOKEN).
- **AI:** GEMINI_API_KEY, GEMINI_MODEL, GEMINI_FALLBACK_MODELS, GEMINI_RPM, GROQ_API_KEY, GROQ_MODEL, GROQ_FALLBACK_MODEL, AI_MAX_TOOLS, AI_MASK_NAMES, AI_MEMORY_TURNS, AI_MEMORY_HOURS, AI_TIMEOUT_MS, AI_LIVE_IN_TESTS.
- **Telegram:** BOT_RAHBAR_TOKEN (legacy TELEGRAM_BOT_TOKEN), BOT_BUXGALTER_TOKEN, BOT_SOROV_TOKEN, BOT_SIGNAL_TOKEN, BOT_OWNER_IDS, BOT_MODE, PUBLIC_URL, WEBAPP_URL, WEBHOOK_SECRET, TELEGRAM_ALERT_CHAT_ID.
- **Email:** EMAIL_WEBHOOK_URL.
- **Platform (read-only):** VERCEL, VERCEL_PROJECT_PRODUCTION_URL, VERCEL_DEPLOYMENT_ID, VERCEL_GIT_COMMIT_SHA, TZ, NODE_TEST_CONTEXT.
- **Missing from `.env.example`:** TELEGRAM_BOT_TOKEN, AI_LIVE_IN_TESTS, LIBSQL_*, the VERCEL_* variables, and GEMINI_FALLBACK_MODEL (the last is used only by `llm-check.mjs`).

### Documentation drift found (docs vs code)
- `docs/BOTS_PLAN.md`:
  - buxgalter audience omits FOUNDER;
  - names `telegram-html.mjs` (the file is actually `html.mjs`) and `app.bots.sendDocument` (no such method);
  - says 3 retry attempts (code: 5) and 16 alert types (code: 17);
  - names routes `/api/bots/status` and `/test` (actual: `/api/bots`, `/api/bots/:key/test`);
  - names `tests/bots.test.mjs` (actual: 10 `bots-*` files).
- `docs/DEPLOY.md`: the `SCHEDULER=off` option is **not implemented**.
- `.git/hooks/pre-push` says "CI bilan bir xil" (same as CI), but **no `.github/workflows` exist**.
- The `reconciliation.mjs:6` header comment has outdated weights.
- The `payroll.approval_steps` setting is not read; the approval chain comes from `approval_rules`.

---

## 18. Tests
- **Framework:** `node:test`, network-free. Telegram is faked at the fetch level (`tests/helpers/bot-harness.mjs`). Fake servers are used for integrations. Real LLM calls happen only with `AI_LIVE_IN_TESTS=1`.
- **Result:** **297 tests, all passing** (last run 2026-09-22 after pulling PR #4/#5).

| File | Tests | Area |
|---|---|---|
| acceptance | 16 | MVP acceptance (TZ §45) |
| ai-fixes | 19 | AI regressions |
| bots-ai | 26 | personas, RBAC tools, masking, provider chain |
| bots-auth-security | 18 | owners, Mini App, 2FA, link codes |
| bots-buxgalter | 22 | buxgalter bot |
| bots-core | 24 | bot core and webhook |
| bots-money-security | 19 | double-pay protection |
| bots-rahbar | 19 | rahbar numbers = web |
| bots-rbac-security | 10 | RBAC scopes |
| bots-signal | 20 | signal bot |
| bots-sorov | 22 | sorov bot |
| bots-telegram-fixes | 14 | dispatch, offset, backoff |
| core | 9 | core app |
| data-vault | 3 | vault |
| excel-single-entry | 5 | single-entry journal, rename safety, web upload |
| integrations-real | 6 | adapters vs fake servers |
| llm | 21 | LLM chain |
| merge-fixes | 20 | TZ, dedupe, env |
| residuals | 4 | review leftovers |

- **Fixture:** `tests/fixtures/demo-seed.mjs` is fabricated data, in-memory only; loading it into a real DB is forbidden.
- **Not covered:** frontend and service worker, `/api/cron/tick` and `/api/health`, the libSQL/Turso path (only the `vercel-check` script), `/excel-upload`, TELEGRAM/GEMINI/GROQ adapter `test()`, deploy shell scripts, real Telegram/LLM. No coverage tooling is configured.

---

## 19. Known issues (verified)

**Critical**
- `@utax_rahbar_bot`: getMe returns **401 Unauthorized** at startup, so the bot is off. Needs a new `BOT_RAHBAR_TOKEN`.
- IDOR: `GET/PATCH /api/contracts/:id` do not apply SALES scope (`contracts.mjs:126-130, 219-224`).
- `POST /api/auth/2fa/setup` resets the TOTP secret and sets `totp_enabled=0` without password or code (`modules/auth.mjs:145`). A stolen access token can disable 2FA.

**Important**
- A password change (`/api/auth/password`, admin PATCH) does not revoke existing sessions.
- An ADMIN can change a FOUNDER's password or name via PATCH; the guard only runs on role change (`users.mjs:60-71`).
- `clientIp` trusts `X-Forwarded-For`, so rate limits are spoofable.
- `POST /api/ai/agents/:code/run` only needs `ai CREATE`, which every role has, so any user can trigger writing agents (EXPENSE, COLLECTION, BANK).
- The expense-side auto-confirm in reconciliation has no AI_AGENT guard.
- The executor bugs listed in §11.3 (CREATE_COLLECTION_TASK, REVIEW_CONTRACT).

**Configuration required**
- `JWT_SECRET` and `SECRETS_KEY` fall back to dev defaults when unset. Production must set them.
- Vercel: Turso plus `CRON_SECRET`, and an external cron for sub-daily jobs.
- nginx `X-Frame-Options` vs the Mini App.
- Docker `SEED_ON_EMPTY=true`.
- No CI. Only the local pre-push hook (`npm run check` + `npm test`).

**Data required** (the system cannot compute these without business input)
- Bank balance is −747,819,223.41 after the user-entered opening balance. The inputs need business verification.
- Revenue is 0 because there are no contract dates or ACT documents.
- 9 contracts have no due date, so there is no overdue aging.
- 35 uncategorized expenses (164,101,440).
- 20 counterparties have no INN.
- 5 non-contract cash receipts and the loan/refund rows are `UNCLASSIFIED`.
- `approval_rules`, `departments`, `employees`, `plans` and `budgets` are empty, so every approval falls back to `['CFO']`.

**Optional / future**
- A global AI kill switch.
- Wire up `FINANCIAL_ANALYST` scheduling.
- Add `api/` to `npm run check`.
- Fix the doc drift listed in §17.

---

## 20. Current state summary

| Question | Answer |
|---|---|
| **Production ready** | Core web app, REST API, RBAC, audit, the Excel import path and reports, all on a single node with node:sqlite. 297 tests pass |
| **Local only right now** | The running instance (`localhost:8100`, Windows workstation) and the data (`data/finance.db`; team copy via the encrypted vault) |
| **Partially implemented** | AI executors (two no-op/over-broad); FINANCIAL_ANALYST unscheduled; payroll `approval_steps` setting unused; Vercel sub-daily jobs |
| **Requires credentials** | rahbar bot token; Bank API / 1C / Sheets / SMTP / webhook; Gemini/Groq keys (status not verified); Turso; CRON_SECRET; production JWT/SECRETS keys |
| **Requires business data** | opening-balance verification, contract dates/due dates/acts, categories for 35 expenses, INNs, approval rules, departments, employees, plans/budgets |
| **Requires code changes** | the security items in §19 (IDOR, 2FA setup, session revocation, XFF, agent-run permission, reconciliation guard), executor fixes, CI workflow |

### Safe next steps
1. Replace `BOT_RAHBAR_TOKEN` and restart. Confirm that `[bots] @utax_rahbar_bot … ishga tushdi` appears in the log.
2. Fix the critical security items in §19, each with a regression test (project rule).
3. Add a GitHub Actions workflow that mirrors the pre-push hook.
4. After any data change: `npm run vault:pack -- --add <xlsx>` → PR.

### Read these first
`CLAUDE.md` (rule #1 and data sources) → `src/server.mjs` → `src/core/{config,db,schema,rbac,router}.mjs` → `src/import/excel-journal.mjs` + `apply-journal.mjs` → `src/modules/{banking,reports,revenue,receivables}.mjs` → `src/bots/shared/bot-factory.mjs` → `src/modules/ai.mjs` → `UI-SKILL.md` (before any UI work).

### Do not modify casually
- `src/core/schema.mjs` applied migrations (add new ones instead)
- `src/core/auth.mjs` (token and crypto formats)
- `src/core/audit.mjs` (append-only contract)
- `apply-journal.mjs` idempotency keys (changing them would duplicate data on re-import)
- `scripts/data-vault.mjs` file format (`UTAXVLT1`)
- `.gitignore` and `.gitattributes` vault rules
- `tests/fixtures/demo-seed.mjs` must never touch a real DB

### Common failure modes
| Symptom | Cause / fix |
|---|---|
| `EADDRINUSE 127.0.0.1:8100` | An old `node src/server.mjs` is still running; stop it first |
| `--reset` / `vault:unpack` "Bazani ko'chirib bo'lmadi" | The server holds the DB file; stop the server |
| Bot `401 Unauthorized` | Revoked or invalid token |
| Bot `409 Conflict` | Same token running in two places (e.g. local and Mac mini/Vercel) |
| Balances show `--` | `opening_balance` is NULL; enter it in Treasury → Hisoblar |
| Dashboard shows zeros | Current month has no data; use the period picker ("…ni ko'rsatish" banner) |
| Re-import creates nothing | Expected: idempotent keys already exist |
| Vault "Kalit bu seyfga mos emas" | Wrong `DATA_VAULT_KEY` (fingerprint mismatch) |

### Onboarding checklist
- [ ] Node ≥ 22.5; `git pull` on `main`
- [ ] Copy `.env.example` → `.env`; get `DATA_VAULT_KEY` (and bot tokens if needed) from the owner **privately**
- [ ] `npm run vault:unpack` (server stopped) → `npm start` → open `http://localhost:8100`
- [ ] Run `npm run check` and `npm test`; expect 297/297
- [ ] Read `CLAUDE.md` and `UI-SKILL.md`
- [ ] Never run bots with the same tokens in two places
- [ ] Work on a feature branch → PR. Never push to `main`; never commit `.env`, `*.db`, `*.xlsx`
