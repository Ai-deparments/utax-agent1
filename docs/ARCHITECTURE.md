# Arxitektura

```
Brauzer (SPA, public/)  ──HTTP/JSON──▶  src/server.mjs (node:http)
                                          │  router → auth (JWT / X-Api-Key) → RBAC → handler
                                          ▼
                              app.services.* (biznes yadro, src/modules)
   contracts ─▶ payments ─▶ revenue (recognition engine) ─▶ reports (P&L, treasury, balance)
   banking ─▶ reconciliation ─▶ payments ─▶ contracts.recompute
   expenses ─▶ approvals (engine, rules) ─▶ notifications (CRM/Telegram/Email)
   receivables (aging, collection agent) ─▶ forecast
   payroll (KPI rule engine) ─▶ approvals ─▶ expenses
   ai (intent router | LLM gateway | 14 agents | ai_actions) ─▶ propose → human → execute → audit
                                          ▼
                              src/core/db.mjs (node:sqlite, WAL)  ·  scheduler  ·  audit_logs
Telegram bot (long polling) ──▶ ai.chat / approvals.decide (source=TELEGRAM)
Integrations (adapters) ──▶ banking.importRows ──▶ reconciliation.autoMatch
```

## Yadro zanjiri (Contract → Payment → Revenue → Expense → Receivable → Cash → Profit)

1. **Contract** yaratiladi → to‘lov jadvali (ADVANCE/FINAL) → status `ACTIVE/ADVANCE_EXPECTED`.
2. **Bank tranzaksiyasi** keladi (import/webhook/qo‘lda) → **reconciliation** ball hisoblaydi → MATCHED bo‘lsa `payments` yoziladi.
3. **revenue.onPaymentRecorded**: xizmat tan olinmagan bo‘lsa → `CUSTOMER_ADVANCE` (bank balansda bor, daromad emas, available emas); tan olingan AR bo‘lsa → `RECOGNIZED_REVENUE`.
4. **contracts.recompute**: to‘lov + xizmat holati + sana → contract_status/payment_status/jadval statuslari.
5. **Xizmat COMPLETED** (+ akt) → **revenue.recognize**: `revenue_recognition` (P&L manbai), avans eventlari FIFO → `RECOGNIZED_REVENUE`; summa ≥ chegara → `PENDING_APPROVAL` (CFO).
6. **Expenses**: so‘rov → approval_rules → zanjir → APPROVED → bank matching / kassa → PAID. P&L: APPROVED+PAID (accrual, expense_date).
7. **Receivables**: `amount − paid` jadvalga FIFO taqsimlanadi → muddati o‘tgan qism/aging → collection agent (T-7…T+15).
8. **Treasury**: `available = bank + cash − advances×% − (approved unpaid + pending payroll + safety reserve)`.
9. **Reports**: P&L, service profitability, cash flow (cf_class), balance (AR = tan olingan − pul kelgan), plan/fact, forecast.

## Modul interfeysi

Har modul: `export function register(app)`; `app = { r (router), db, rbac, settings, audit, scheduler, services }`. Servislar `app.services.<name>` ga qo‘yiladi va **chaqiruv vaqtida** o‘qiladi (ro‘yxatga olish tartibi muhim emas, faqat `approvals` `expenses`/`payroll` dan oldin — callback ro‘yxati uchun).

Route: `r.get('/api/x/:id', { perm: ['resource','ACTION'], tags, summary, query }, async (ctx) => ...)`; `ctx = { user, params, query, body, ip, source, req, res }`. Har route OpenAPI ga avtomatik kiradi (`/api/openapi.json`, `/api/docs`).

## Xavfsizlik

HTTPS (nginx), JWT HS256 + refresh rotation (sessions jadvali, hash), scrypt parol, TOTP 2FA, rate limit (login 10/min, API 900/min per IP), RBAC har route, integratsiya secretlari AES-256-GCM (`SECRETS_KEY`), audit log (IP, manba, approval, AI agent), security headers, moliyaviy yozuvlar o‘chirilmaydi (reversal). AI agent (`X-Api-Key`) faqat VIEW/PROPOSE.

## PostgreSQL ga o‘tish

1. `src/core/db.mjs` — `pg` Pool asosida `run/get/all/exec/tx` (placeholder `?` → `$n`).
2. `src/core/schema.mjs` — `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL`/`IDENTITY`, `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`, `julianday()` → `date` arifmetikasi (3–4 joy).
3. Modullar o‘zgarmaydi.

## Kengaytirish nuqtalari

- Yangi xizmat turi / kategoriya / approval qoidasi / KPI formulasi — admin panel (kodsiz).
- Yangi integratsiya — `src/modules/integrations.mjs` → `ADAPTERS` obyektiga `{name, config_schema, secret_schema, test, pull}`.
- Yangi AI agent — `src/modules/ai.mjs` → `AGENTS` + `runners` + scheduler qatori.
- Yangi intent — `INTENTS` + `handlers`.
