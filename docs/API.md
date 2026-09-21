# API

API-first. To‘liq spetsifikatsiya: `GET /api/openapi.json` (OpenAPI 3.0), interaktiv: `GET /api/docs` (Swagger UI). 140+ operatsiya.

Auth: `Authorization: Bearer <access_token>` (`POST /api/auth/login` → `access_token` 15 daq, `refresh_token` 7 kun → `POST /api/auth/refresh`). AI agentlar: `X-Api-Key` (Sozlamalar → AI agent → kalit).

Asosiy endpointlar (TZ §39):

| Endpoint | Ruxsat |
|---|---|
| `GET /api/dashboard` | dashboard.VIEW |
| `GET /api/treasury` | treasury.VIEW |
| `GET/POST /api/contracts`, `GET/PATCH /api/contracts/{id}`, `POST /api/contracts/{id}/service-status`, `/documents`, `/schedules` | contracts.* |
| `GET/POST /api/transactions`, `POST /api/transactions/import`, `POST /api/transactions/{id}/reverse` | transactions.* |
| `GET /api/reconciliation/{txId}/suggest`, `POST /api/reconciliation/match`, `/unmatch`, `/ignore`, `/run` | reconciliation.* |
| `GET /api/revenue/summary`, `/recognitions`, `/events`, `POST /api/revenue/recognize`, `/refund`, `/recognitions/{id}/reverse` | revenue.* |
| `GET /api/receivables`, `/aging`, `/summary`; `GET/PATCH /api/collections`, `POST /api/collections/run` | receivables / collections |
| `GET /api/expenses`, `/summary`, `/categories`; `POST /api/expenses/request`, `POST /api/expenses`, `/{id}/pay`, `/{id}/reverse` | expenses.* |
| `GET /api/approvals`, `/rules`; `POST /api/approvals/{id}/approve|reject|postpone`; `PUT /api/approvals/rules` | approvals.* / settings.EDIT |
| `GET /api/reports/pnl`, `/service-profitability`, `/cash-flow`, `/balance-sheet`, `/data-quality` | pnl / cashflow / balance |
| `GET /api/planfact`, `GET/PUT /api/plans/{period}`, `GET/PUT /api/budgets` | planfact.* |
| `GET /api/forecast?days=30`, `/api/forecast/all` | forecast.VIEW |
| `GET /api/payroll/{period}`, `POST /api/payroll/{period}/compute|submit|mark-paid`, `/api/employees`, `/api/kpi-rules` | payroll.* |
| `POST /api/ai/chat`, `/api/ai/confirm`, `GET /api/ai/agents`, `POST /api/ai/agents/{code}/run`, `GET /api/ai/actions`, `POST /api/ai/actions/{id}/approve|reject` | ai.* |
| `GET /api/notifications`, `POST /api/notifications/read` | notifications.* |
| `GET /api/integrations`, `/adapters`, `POST /api/integrations`, `/{id}/test`, `/{id}/sync`, `POST /api/integrations/webhook/{token}` (auth yo‘q, token) | integrations.* |
| `GET /api/audit`, `/api/audit/stats` | audit.VIEW |
| `GET/PUT /api/settings`, `/api/service-types`, `/api/roles/{code}/permissions`, `/api/users`, `/api/departments`, `POST /api/export/xlsx`, `POST /api/settings/backup` | settings / users |

Xato formati: `{ "error": "CODE", "message": "..." }` — 400 BAD_REQUEST, 401 UNAUTHORIZED, 403 FORBIDDEN, 404 NOT_FOUND, 409 CONFLICT, 429 RATE_LIMIT.

Inbound bank webhook namunasi:
```bash
curl -X POST https://finance.utax.uz/api/integrations/webhook/<token> -H 'Content-Type: application/json' \
  -d '{"rows":[{"date":"2026-09-21","amount":50000000,"type":"credit","counterparty":"NUR FARM MCHJ","inn":"302345678","description":"Oplata po dogovoru UTAX-S-00002","id":"bank-doc-1234"}]}'
```
