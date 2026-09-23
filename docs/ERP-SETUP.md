# UTAXERP ulash — jamoa a'zosi uchun qo'llanma

> **Kimga:** `Ai-deparments/utax-agent1` repo'siga va UTAX tashkilotiga ruxsati bor xodimga.
> Ruxsati yo'q odam ERP'ga ulana olmaydi: token repoda yo'q, u faqat shaxsiy kanal orqali beriladi.

---

## 1. Nima kerak

| Narsa | Qayerdan |
|---|---|
| Repo'ga ruxsat | Tashkilot admini beradi |
| `.env` fayli (ichida `ERP_TOKEN`) | Loyiha egasidan **shaxsiy xabarda**. Guruhga tashlanmaydi |
| Node.js 22.5+ | nodejs.org |

`.env`, `.erp-token` va `ERP/` papkasi `.gitignore` da — ular hech qachon commit qilinmaydi.

---

## 2. Ishga tushirish (4 qadam)

```bash
git clone https://github.com/Ai-deparments/utax-agent1.git
cd utax-agent1

# 1) .env ni joyiga qo'ying (loyiha egasi yuborgan fayl).
#    Yoki .env.example dan nusxa olib, ERP_TOKEN ni to'ldiring:
cp .env.example .env

# 2) ERP'dan barcha ma'lumotni tortib, tizim jadvallariga moslashtirish (~3-5 daqiqa)
npm run erp:setup

# 3) Ishga tushirish
DB_PATH=data/finance-erp.db npm start
```

Brauzerda: **http://localhost:8100**

Kirish: `.env` dagi `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

---

## 3. Keyin nima bo'ladi

Server ishga tushganda `.env` dagi `ERP_TOKEN` ni ko'rib, **UTAXERP integratsiyasini o'zi ulaydi** (token bazada AES-256-GCM bilan shifrlanadi). Shundan keyin:

| Ish | Qachon | Nima qiladi |
|---|---|---|
| `erp-sync` | Har soatda | Hisoblar, kirimlar, shartnomalar, qoldiqlar |
| `erp-full` | Har kuni 04:00 | ERP'ning barcha modellari → `erp_raw` + kontragent INN/nom + moslashtirish |

Qo'l tegizish shart emas — ERP'da yangi to'lov paydo bo'lsa, bir soat ichida bu yerda ko'rinadi.

Oraliqni o'zgartirish: `.env` da `ERP_SYNC_MS` va `ERP_FULL_AT`.

---

## 4. Buyruqlar

| Buyruq | Nima qiladi |
|---|---|
| `npm run erp:setup` | Moliya yadrosi + to'liq oyna + moslashtirish — birinchi marta shu (3 bosqich) |
| `npm run erp:sync` | Faqat moliya yadrosi (tez) |
| `npm run erp:full` | Barcha modellar → `erp_raw` + INN boyitish |
| `npm run erp:map` | `erp_raw` → tizim jadvallari (bo'lim, xodim, kategoriya, KPI) |

Hammasi **idempotent** — qayta ishlatsangiz takror yozuv qo'shilmaydi.

---

## 5. Nima tortiladi

**Tizim jadvallariga moslashtiriladi:**

| Bizning jadval | ERP manbai |
|---|---|
| bank_accounts / cash_accounts | financeAccount (+ nomi serviceProvider'dan) |
| bank/cash tranzaksiyalar, payments | inOutMoney |
| contracts | contract (sum / paidSum / debtSum) |
| companies | lead + client (INN: `client.companyINN`) |
| departments | department |
| employees | user + profile (ism) + orderToWork → workerPosition (lavozim) |
| expense_categories | expenseType |
| employee_kpis | kpi |

**`erp_raw` jadvalida (xom, moliya tizimida joyi yo'q):** notification, task, callEvent, leadHistory, chat, project, soliq modullari va boshqalar.

---

## 6. Bilib qo'yish kerak (ERP ma'lumotining o'zidagi cheklovlar)

- **Xarajat yo'q.** `inOutMoney` ning hammasi `INCOME`. Shuning uchun P&L'ning xarajat tomoni va sof foyda bo'sh qoladi.
- **Oylik summasi yo'q.** ERP'da xodim maoshi degan maydon umuman yo'q → `employees.fixed_salary` NULL. Payroll moduli ishlaydi, lekin summalar 0.
- **Xodim–bo'lim bog'lanishi yo'q** — ERP'da user'ni department'ga bog'laydigan maydon topilmadi.
- **3 model yopiq:** `role`, `permission`, `userRole` — HTTP 403, token'ga ruxsat berilmagan.
- **ERP'da takror bor:** bo'limlar filiallar bo'yicha ikkilangan, ba'zi kontragentlar ikki yozuvda.

Bular tizim xatosi emas — manbada shunday. **1-QOIDA:** ERP'da yo'q qiymat NULL qoladi, to'qilmaydi (`CLAUDE.md`).

---

## 7. Muammolar

| Belgi | Sabab / yechim |
|---|---|
| `HTTP 401 — token noto'g'ri/muddati o'tgan` | Token muddati tugagan. Loyiha egasidan yangisini so'rang |
| `ERP_TOKEN yo'q` | `.env` da `ERP_TOKEN` to'ldirilmagan |
| `Bazani ko'chirib bo'lmadi` | Server ishlab turibdi — avval to'xtating |
| Qoldiqlar `--` | Hisobning boshlang'ich qoldig'i yo'q (ERP'dan kelmagan) |
| Dashboard 0 ko'rsatyapti | Joriy oyda yozuv yo'q — davr tanlagichidan oxirgi oyni tanlang |

---

## 8. Xavfsizlik qoidalari

- **Tokenni guruhga, GitHub'ga, skrinshotga tashlamang.** Faqat shaxsiy kanal.
- `.env` ni hech qachon commit qilmang (allaqachon `.gitignore` da).
- Baza fayllari (`data/*.db`) ham git'ga tushmaydi — har kim o'zida ERP'dan quradi.
- Token tarqab ketgan bo'lsa — loyiha egasiga ayting, ERP tarafda yangilanadi.
