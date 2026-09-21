# UTAX AI Moliya CRM — Finance Operating System (MVP v1.0)

Shartnoma → Tushum → Predoplata → Xizmat bajarilishi → Daromad → Xarajat → Debitorlik → Oylik/KPI → P&L → Cash Flow → Balans → Forecast — bitta markaziy tizimda, AI agentlar bilan.

**Asosiy prinsip:** `BANKDAGI PUL ≠ DAROMAD ≠ ISHLATISH MUMKIN BO‘LGAN PUL`. Mijoz avansi bank balansiga qo‘shiladi, lekin daromad emas va ishlatib bo‘lmaydi — xizmat bajarilib akt yopilgandan keyingina tan olinadi.

## Tez boshlash

```bash
cd utax-finance-crm
cp .env.example .env          # JWT_SECRET, SECRETS_KEY ni o‘zgartiring
npm start                     # http://127.0.0.1:8100  (Node ≥ 22.5, tashqi paket shart emas)
```

Birinchi ishga tushishda baza bo‘sh bo‘lsa **Iyul 2026 pilot ma’lumotlari** avtomatik yuklanadi (`SEED_ON_EMPTY=true`).
Qayta yuklash: `npm run seed:reset`. Testlar: `npm test` (25 ta, shu jumladan TZ §45 acceptance).

| Rol | Login | Parol |
|---|---|---|
| Founder | founder@utax.uz | `Utax2026!` |
| CEO / CFO / Finance manager / Accountant | ceo@ · cfo@ · finance@ · accountant@ (utax.uz) | `Utax2026!` |
| Sales / Dept heads / Employee / Auditor / Admin | sales@ · head.revision@ · head.audit@ · head.legal@ · head.marketing@ · head.it@ · employee@ · auditor@ · admin@ | `Utax2026!` |

API hujjati (OpenAPI/Swagger): `http://127.0.0.1:8100/api/docs` · Health: `/api/health`.

## Nimalar bor (MVP, TZ §43)

- **Auth + RBAC** — JWT (access 15 daq + refresh rotation), 2FA (TOTP), 11 rol × 23 resurs × 7 action (VIEW/CREATE/EDIT/APPROVE/REJECT/DELETE/EXPORT), admin panelda tahrirlanadi.
- **CEO Dashboard** — 10 KPI karta, Bankdagi pul − Predoplata − Rezerv = Available cash, Cash flow / Revenue / Xarajat tuzilmasi / Plan-Fakt / Aging grafiklari, xizmat rentabelligi, diqqat talab qiladigan ishlar.
- **Pul boshqaruvi (Treasury)** — bank/kassa/avans/rezerv/available, 7/30 kunlik kirim-chiqim, «xavfsiz qancha pul olish mumkin».
- **Shartnomalar** — `UTAX-R-00001` avto-raqam (xizmat prefiksi), avans/yakuniy to‘lov jadvali, status mashinasi (avtomatik), xizmat holati, hujjatlar (akt), to‘lov progressi, daromad eventlari, audit.
- **Bank tranzaksiyalari + Reconciliation engine** — CSV/XLSX import, ball (shartnoma raqami 70 / INN 30 / summa 20 / nom 10 / sana 5), ≥95 → auto, 60–94 → SUGGESTED (CONFIRM / CHANGE / IGNORE), reversal.
- **Revenue Recognition engine** — `CUSTOMER_ADVANCE → RECOGNIZED_REVENUE` (FIFO), qoidalar xizmat turi bo‘yicha (ON_COMPLETION+akt, STRAIGHT_LINE, ON_PAYMENT, MILESTONE), chegaradan katta summa → CFO tasdig‘i, reversal.
- **Xarajatlar + Approval engine** — so‘rov (EXP-000721), AI kategoriyalash, limitlar bo‘yicha zanjir (admin sozlaydi), APPROVE/REJECT/POSTPONE, to‘lov bank matching yoki kassa orqali.
- **Debitorlik + Collection agent** — jadval bo‘yicha FIFO, aging 0–7/8–15/16–30/31–60/60+, T-7…T+15 vazifalar va bildirishnomalar.
- **P&L, Xizmat rentabelligi, Cash Flow (operating/investing/financing), Balans, Plan/Fakt, Byudjet, Forecast (3 scenariy)**.
- **KPI & Oylik** — rule engine (formulalar bazada), zanjir Dept Head → CEO → CFO → Accounting → PAID.
- **AI Finance Center** — chat (rule-based router API kalitsiz ishlaydi; `ANTHROPIC_API_KEY` bo‘lsa Claude tool-use), 14 agent, AI takliflari → inson tasdig‘i → bajarish → audit.
- **Telegram bot** — /balance /cash /revenue /expenses /debtors /forecast /approvals /report + tabiiy til + CONFIRM/CANCEL tasdiqlash.
- **Notification engine** (CRM + Telegram + Email webhook), **Audit log** (o‘chirish yo‘q, reversal), **Integratsiyalar** (adapter: Bank API, Google Sheets, Excel/CSV, 1C, ERP, Telegram, Email, inbound webhook), **Excel/PDF eksport**, **Backup**.

Batafsil: [docs/GLOSSARY.md](docs/GLOSSARY.md) (atamalar va formulalar) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/DEPLOY.md](docs/DEPLOY.md) · [docs/API.md](docs/API.md).

## Texnik qarorlar (TZ §37 dan farqlar)

TZ Next.js + NestJS/FastAPI + PostgreSQL + Redis + Docker ni **tavsiya** qilgan. Bu mashinada Docker/Redis yo‘q, PostgreSQL parol talab qiladi; mavjud `sotuv-web` loyihasi konvensiyasi — tashqi paketsiz Node. Shuning uchun:

- **Backend:** Node.js (ESM), modulli (`src/modules/*` — /auth /users /contracts /banking /reconciliation /revenue /expenses /receivables /collections /payroll /budget /forecast /reports /approvals /notifications /integrations /ai /audit), API-first, OpenAPI avtomatik.
- **DB:** `node:sqlite` (WAL) — `src/core/db.mjs` adapteri 5 metod (`run/get/all/exec/tx`); PostgreSQL ga o‘tish = shu adapter + `schema.mjs` tiplari. Sxema PostgreSQL bilan mos (TEXT/INTEGER/REAL, ISO sanalar).
- **Queue/Cache:** fon vazifalari `src/core/scheduler.mjs` (daily/hourly); yuklama oshsa BullMQ/Redis ga ko‘chirish nuqtasi shu.
- **Frontend:** vanilla ES modules SPA (`public/`), build qadamisiz, yagona light (oq/mint/emerald) design system (`public/css/app.css` tokenlari, `public/js/ui.js` komponentlari, `public/js/charts.js` SVG grafiklar, `public/js/icons.js`), responsive (desktop/laptop/mobil), barcha matnlar o‘zbekcha, har jadvalda qidiruv/filtr/sort/ustunlar/sana/Excel/PDF.
- **Docker:** `Dockerfile` + `docker-compose.yml` tayyor (mashinada Docker bo‘lmagani uchun bu yerda ishga tushirilmadi); `deploy/install.sh` systemd + nginx.
- **AI:** `@anthropic-ai/sdk` ixtiyoriy (`optionalDependencies`); kalit bo‘lmasa rule-based router 15 acceptance savoliga real raqam bilan javob beradi.

## Loyiha tuzilmasi

```
src/core/       config, db (adapter), schema (migratsiyalar), http, router, auth (JWT/scrypt/TOTP/AES), rbac, audit, settings, export (xlsx), openapi, scheduler
src/modules/    auth users companies contracts revenue banking reconciliation approvals expenses receivables payroll budget reports forecast notifications integrations ai audit settings
src/telegram/   bot.mjs (long polling)
src/seed/       seed.mjs — Iyul pilot (xronologik voqealar → barcha raqamlar biznes qoidalari orqali hisoblanadi)
public/         index.html, css/app.css, js/{app,api,ui,charts}.js, js/pages/*.js (19 modul)
tests/          core.test.mjs, acceptance.test.mjs
deploy/         install.sh, utax-finance.service, nginx.conf, backup.sh, restore.sh
docs/           GLOSSARY, ARCHITECTURE, DEPLOY, API
```
