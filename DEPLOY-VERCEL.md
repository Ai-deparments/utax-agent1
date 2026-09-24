# UTAX Finance CRM — Vercel'ga joylash

Vercel doimiy server emas: diskka yozilgan narsa saqlanmaydi, fonda jarayon aylanmaydi. Shuning uchun ilova quyidagicha moslashtirilgan:

| Qism | Lokal / VPS | Vercel |
|---|---|---|
| Server | `npm start` (`src/server.mjs`) | bitta funksiya: `api/index.mjs` (barcha yo'llar `vercel.json` orqali) |
| Baza | `data/finance.db` (node:sqlite) | **Turso** (libSQL). Funksiyada lokal nusxa `/tmp` da, yozuvlar Turso'ga ketadi |
| Fon vazifalari | ichki taymer (har daqiqa) | **Vercel Cron** → `GET /api/cron/tick` (`CRON_SECRET` bilan) |
| Telegram botlar | `BOT_MODE=polling` | `webhook` (avtomatik, `PUBLIC_URL` = Vercel production manzili) |
| Zaxira | kunlik `data/backups/` | Turso o'zi saqlaydi (point-in-time restore) |
| Web (PWA) | o'zgarmaydi | o'zgarmaydi. Aktivlar deploy ID bilan versiyalanadi va CDN'da keshlanadi |

Kod ikkala muhitda ham bir xil ishlaydi. Oddiy `npm start` avvalgidek node:sqlite bilan ishlaydi.

---

## 1. Turso bazasini yaratish (mavjud ma'lumot bilan)

1. Turso CLI'ni o'rnating va kiring (akkaunt: https://turso.tech):
   ```bash
   brew install tursodatabase/tap/turso
   ```
   ```bash
   turso auth login
   ```
2. Lokal serverni to'xtating, keyin bazani bitta faylga yig'ing (WAL'dagi oxirgi yozuvlar asosiy faylga o'tadi):
   ```bash
   sqlite3 data/finance.db "PRAGMA wal_checkpoint(TRUNCATE);"
   ```
3. Mavjud bazadan Turso bazasini yarating. Region Frankfurt, Vercel funksiyasi ham shu yerda (`fra1`):
   ```bash
   turso db create utax-finance --from-file data/finance.db --location fra
   ```
4. Manzil va tokenni oling:
   ```bash
   turso db show utax-finance --url
   ```
   ```bash
   turso db tokens create utax-finance
   ```

## 2. Vercel loyihasi

1. Vercel'da **Add New → Project → Import** bosing va GitHub'dagi `Ai-deparments/utax-agent1` ni tanlang. Framework: **Other**. Build sozlamalari `vercel.json` da.
2. **Settings → Environment Variables** (Production) bo'limiga quyidagilarni kiriting:

| O'zgaruvchi | Qiymat | Majburiy |
|---|---|---|
| `TURSO_DATABASE_URL` | 1.4-qadamdagi `libsql://…` manzil | ✅ |
| `TURSO_AUTH_TOKEN` | 1.4-qadamdagi token | ✅ |
| `JWT_SECRET` | lokal `.env` dagi bilan **bir xil** (bo'lmasa hamma qayta kiradi) | ✅ |
| `SECRETS_KEY` | lokal `.env` dagi bilan **bir xil**. Gemini kaliti va integratsiya sirlari shu kalit bilan shifrlangan | ✅ |
| `CRON_SECRET` | istalgan uzun tasodifiy satr (`openssl rand -hex 32`) | ✅ |
| `NODE_ENV` | `production` | ✅ |
| `GEMINI_API_KEY`, `GROQ_API_KEY` | AI uchun | ixtiyoriy |
| `BOT_RAHBAR_TOKEN`, `BOT_BUXGALTER_TOKEN`, `BOT_SOROV_TOKEN`, `BOT_SIGNAL_TOKEN` | Telegram botlar | ixtiyoriy |
| `WEBHOOK_SECRET` | botlar bo'lsa majburiy (`openssl rand -hex 24`) | botlar uchun |
| `PUBLIC_URL`, `WEBAPP_URL` | o'z domeningiz bo'lsa (standart: Vercel production manzili) | ixtiyoriy |

3. **Deploy** tugmasini bosing. Keyin quyidagilarni tekshiring:
   - `https://<loyiha>.vercel.app/api/health` sahifasi `ok: true` qaytarishi kerak.
   - Login ishlashi kerak.
   - Pul boshqaruvi raqamlari lokal bilan bir xil bo'lishi kerak.

> ⚠️ `TURSO_DATABASE_URL` berilmasa, ilova ishlaydi, lekin baza `/tmp` da bo'ladi va **har ishga tushishda yo'qoladi**. Logda ogohlantirish chiqadi.

## 3. Fon vazifalari (cron)

`vercel.json` da cron **kuniga bir marta** sozlangan: `30 4 * * *` UTC, ya'ni Toshkent vaqti bilan 09:30. Bu Vercel **Hobby** tarifining chegarasi. Bu vaqtda barcha kunlik agentlar bajariladi: undiruv, ma'lumot sifati, CFO, prognoz va boshqalar.

- **Pro** tarifda jadvalni tezroq qilish mumkin, masalan `*/30 * * * *`.
- Bepul alternativa ham bor: tashqi cron xizmati (masalan cron-job.org) har 30 daqiqada so'rov yuborsin:
  `GET https://<loyiha>.vercel.app/api/cron/tick`, header `Authorization: Bearer <CRON_SECRET>`.
- Vazifalarning oxirgi ishga tushgan vaqti bazada saqlanadi. Shuning uchun tez-tez chaqirilsa ham har vazifa o'z jadvali bo'yicha bir marta bajariladi.

## 4. Telegram botlar

Vercel'da botlar **webhook** rejimida ishlaydi. Funksiya birinchi ishga tushganda `setWebhook` avtomatik chaqiriladi. Kerakli sozlamalar: `BOT_*_TOKEN` va `WEBHOOK_SECRET`. Lokal `BOT_MODE=polling` bilan bir vaqtda **ishlatmang**: bitta token faqat bitta joyda ishlaydi.

## 5. Tekshiruv (deploydan oldin, lokal)

```bash
npm install
```
```bash
npm run vercel:check
```

Skript `api/index.mjs` ni Vercel muhitiga o'xshatib ishga tushiradi va 18 ta tekshiruv o'tkazadi: libSQL drayveri, cron, login, asosiy sahifalar va yozish. Haqiqiy baza o'zgarmaydi, uning nusxasi ishlatiladi.

**Muhim:** bu tekshiruv lokal libSQL **fayli** bilan ishlaydi, shuning uchun Turso serveriga xos farqlarni ko'rmaydi. Turso ulangach:

```bash
npm run turso:check
```

`.env` dagi `TURSO_*` bilan ulanib, barcha asosiy API yo'llarini haqiqiy Turso bazasiga qarshi ishga tushiradi va javoblardagi KATTA HARFLI kalitlarni skanerdan o'tkazadi (quyidagi 5.1 ga qarang).

### 5.1 Turso'ning SQLite'dan farqlari (amalda uchragan)

| Muammo | Belgisi | Yechim |
|---|---|---|
| Ko'p buyruqli SQL ochiq tranzaksiya ichida | `Sqlite3UnsupportedStatement` | migratsiya masofaviy bazada birma-bir bajariladi (`schema.mjs: applyRemote`) |
| `CREATE TEMP TABLE` keyingi buyruqda yo'qoladi | `no such table: TEMP._v5_seq` | vaqtinchalik jadval oddiy jadval sifatida yaratiladi |
| `GROUP BY`siz `HAVING` | `SQL_PARSE_ERROR: near HAVING` | `GROUP BY` qo'shiladi (SQLite kechiradi, Turso yo'q) |
| Kalit so'z taxalluslari (`AS first`, `AS last`) | ustun nomi KATTA HARFDA qaytadi, frontend topa olmaydi | neytral nom (`span_first`), API shakli JS'da yig'iladi |
| `PRAGMA` | rad etilishi mumkin | `try/catch` ichida (`db.mjs`) |

### 5.2 Ma'lumotni Turso'ga yuborish

ERP'dan to'liq tortishni Vercel funksiyasida bajarib **bo'lmaydi** — 60 soniya chegarasi (`Task timed out`, keyin `database is locked`). Shuning uchun:

1. Sinxron lokalda (yoki doimiy serverda) ishlaydi: `npm run erp:setup`
2. Natija Turso'ga ko'chiriladi: `npm run turso:push` (`--dry` bilan avval solishtirib ko'rish mumkin)

`erp_raw` ataylab yuborilmaydi: u 186 mingdan ortiq xom yozuv, saytda ishlatilmaydi va bazani 0,8 MB dan 166 MB ga kattalashtiradi. Nusxa (embedded replica) rejimida har sovuq start bazani to'liq yuklab oladi, shuning uchun hajm muhim.

## 6. Cheklovlar (bilish kerak)

- **Fayllar:** botlar orqali yuklangan fayllar (`uploads`) Vercel'da `/tmp` ga tushadi va saqlanmaydi. Doimiy fayl saqlash kerak bo'lsa, Vercel Blob yoki S3 kerak bo'ladi.
- **Instansiyalar orasidagi kechikish:** har bir funksiya o'z nusxasini ko'pi bilan 1 soniyada bir marta Turso bilan sinxronlaydi. Juda kam hollarda boshqa foydalanuvchining so'nggi yozuvi 1 soniyagacha kechikib ko'rinadi.
- **Birinchi so'rov (cold start):** 1–3 soniya. Bu vaqtda baza nusxasi yuklanadi va migratsiyalar tekshiriladi.
- **Tezlik cheklovi va login urinishlari** har instansiya uchun alohida hisoblanadi.
- **Zaxira:** "Hozir zaxiralash" tugmasi Vercel'da `/tmp` ga yozadi. Haqiqiy zaxira uchun `turso db shell` / Turso dashboard'dagi PITR ishlatiladi.

Bu cheklovlar qabul qilinmasa, `deploy/` papkasidagi VPS yo'li (systemd + nginx) yoki `Dockerfile` bilan doimiy diskli hosting (Railway, Render, Fly.io) cheklovsiz ishlaydi.
