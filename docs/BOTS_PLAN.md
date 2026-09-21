# 4 ta Telegram bot — qurish rejasi

> **Holat: bajarildi** (feature/telegram-bots). Yakuniy spetsifikatsiya — [BOTS.md](BOTS.md).
> Rejadan farqlar: avtomatik xabarlar (digest, ogohlantirishlar) hammasi @utax_signal_bot orqali keladi (bildirishnomalar markazi);
> egalar uchun `BOT_OWNER_IDS` qo'shildi (FOUNDER, kodsiz bog'lanish).

Branch: `feature/telegram-bots`. Namuna: `E:\Desktop\utax-agent` (`src/bots/*`, `docs/bots.md`).

## Asosiy tamoyil — bot = webapp'ning Telegram'dagi oynasi

1. **Bitta manba.** Bot hech qachon o'z hisobini qilmaydi, faqat `app.services.*` ni chaqiradi (reports, contracts,
   banking, reconciliation, revenue, expenses, approvals, receivables, payroll, budget, forecast, integrations, ai,
   notifications). Webapp'dagi raqam va botdagi raqam har doim bir xil bo'ladi.
2. **Bitta RBAC.** Har bir buyruq `app.rbac.can(user, resource, action)` bilan tekshiriladi — xuddi shu 11 rol × 23
   resurs matritsasi (admin panelda tahrirlanadi). Botda alohida ruxsat jadvali yo'q.
3. **Bitta audit.** Har bir amal `app.audit(ctx, …)` ga `source: 'TELEGRAM'`, `bot: <key>` bilan yoziladi.
4. **Tashqi paketsiz.** Loyiha konvensiyasi — faqat Node ≥ 22.5 (`fetch`, `node:sqlite`, `node:test`). grammY emas,
   o'zimizning yupqa Telegram klient (namunadagi grammY arxitekturasi: factory → middleware → handlers).
5. **Har javobda web havola.** Kartalarda "🌐 Web'da ochish" tugmasi → `WEBAPP_URL/#/<sahifa>/<id>`
   (HTTPS bo'lsa Telegram Mini App sifatida ochiladi).

## Botlar va rollar

| Bot | Env | Kimga (role_code) | Vazifa |
|---|---|---|---|
| `@utax_rahbar_bot` | `BOT_RAHBAR_TOKEN` | FOUNDER, CEO, CFO, ADMIN | Boshqaruv: holat, pul, P&L, tasdiqlar, AI takliflari, xodimlar |
| `@utax_buxgalter_bot` | `BOT_BUXGALTER_TOKEN` | CFO, FINANCE_MANAGER, ACCOUNTANT | Operatsion moliya: vipiska, bog'lash, kassa, to'lov, daromad, oylik |
| `@utax_sorov_bot` | `BOT_SOROV_TOKEN` | barcha xodimlar (EMPLOYEE, SALES, DEPARTMENT_HEAD, …) | Xarajat so'rovi, holatini kuzatish, bo'lim tasdig'i, o'z shartnoma/qarz/oylik |
| `@utax_signal_bot` | `BOT_SIGNAL_TOKEN` | barcha faol foydalanuvchilar | Faqat bildirishnomalar: notification engine'ning Telegram kanali |

FOUNDER barcha 4 botga kiradi. Kirish = `audience` ∩ RBAC.

## Papka tuzilmasi

```
src/bots/
  index.mjs                 # startBots(app): 4 botni yig'adi, polling/webhook, app.bots = {send, sendDocument, status}
  definitions.mjs           # 4 bot: key, tokenEnv, audience, commands[{name, perm:[res,act], desc}]
  shared/
    telegram-api.mjs        # fetch klient: 429 retry_after, 5xx retry, getUpdates, sendMessage/Document, editMessage, answerCallback, getFile
    bot-factory.mjs         # createBot(def, deps): dedupe → rate-limit → error → auth → audit → router
    router.mjs              # command / callback (prefix:args) / document / text / dialog
    auth.mjs                # telegram_user_id → users, /start KOD bog'lash, is_active (Kill switch), access_denied audit
    rbac.mjs                # requirePerm([res,act]) → app.rbac.can
    dialogs.mjs             # ko'p qadamli dialog (FSM), TTL 30 daq, /bekor
    keyboards.mjs           # inline, confirm, pagination, webButton(path)
    telegram-html.mjs       # escape, **qalin**, 4096 bo'laklash (teg yopib-ochish)
    format.mjs              # pul "12 500 000 so'm", sana "17.09.2026", jadval/kartochka
    texts.mjs               # barcha o'zbekcha matnlar, /yordam
    webapp-auth.mjs         # Telegram Mini App initData HMAC tekshiruvi
  rahbar/    bot.mjs, handlers/*.mjs
  buxgalter/ bot.mjs, handlers/*.mjs
  sorov/     bot.mjs, handlers/*.mjs
  signal/    bot.mjs, handlers/*.mjs, dispatcher.mjs
src/modules/bots.mjs        # /api/bots/* endpointlar (holat, test, bog'lash havolalari, webapp login)
```

`src/telegram/bot.mjs` o'chiriladi (uning buyruqlari rahbar botiga ko'chadi). `TELEGRAM_BOT_TOKEN` eski kalit →
`BOT_RAHBAR_TOKEN` fallback.

---

## BOSQICH 0 — Poydevor (ketma-ket, boshqa hamma narsa shunga bog'liq)

- [x] `config.mjs`: `bots: { rahbar, buxgalter, sorov, signal }` tokenlar, `botMode`, `publicUrl`, `webappUrl`, `webhookSecret`.
- [x] `.env.example` yangilash (tokenlarsiz), `.env` tayyor (commit qilinmaydi).
- [x] Migratsiya (`schema.mjs` keyingi versiya):
  - `users.telegram_user_id TEXT UNIQUE` (+ eski `telegram_chat_id` dan ko'chirish), `telegram_username`
  - `bot_chats(user_id, bot_key, chat_id, started_at, blocked_at)` — kim qaysi botni /start qilgan (signal yuborish uchun shart)
  - `notification_prefs(user_id, type, telegram INTEGER, quiet_from, quiet_to)`
  - `notifications.bot_key`, `notifications.tg_message_id`, `notifications.attempts`
  - `bot_dialogs(key, state_json, expires_at)` — restartdan keyin ham dialog saqlansin
- [x] `.git/hooks/pre-push` → `node --check` + `npm test`.

## BOSQICH 1 — Umumiy bot yadrosi `src/bots/shared/`

- [x] Telegram API klient (retry, `retry_after`, timeout, `getFile` + hajm chegarasi 10 MB).
- [x] Factory + middleware zanjiri (namunadagi `bot-factory.ts` ning aynan mantiqi): update dedupe (2000), rate limit
      (user bo'yicha 20/daq), error (foydalanuvchiga "Xatolik yuz berdi", stack yo'q, audit), auth, audit.
- [x] Auth: `/start KOD` (web → Sozlamalar → Telegram, kod 1 kun), bitta bog'lash 4 botga amal qiladi
      (private chat id = telegram user id). Bog'lanmagan → yo'riqnoma + `ACCESS_DENIED` audit. Botga kirmaydigan rol → rad.
- [x] Router: `/buyruq args`, callback `prefix:a:b` (64 bayt), hujjat/fayl, erkin matn → dialog yoki bot-agent.
- [x] Callback eskirishi 24 soat ("Bu so'rov eskirgan, /tasdiqlash orqali qayta oching").
- [x] `setMyCommands` har bot uchun (o'zbekcha, `[a-z0-9_]`), `/start` `/yordam` `/bekor` `/tozalash` hammasida.
- [x] Erkin matn → `app.services.ai.chat(text, ctx, {channel:'TELEGRAM', bot})` → HTML + CONFIRM/CANCEL tugmalari
      (`confirm` javobi bo'lsa `/api/ai/confirm` mantiqi).
- [x] Polling (dev) va webhook (`POST /telegram/<bot>` + `X-Telegram-Bot-Api-Secret-Token`) — `server.mjs` ga ulash.
- [x] `app.bots.send(botKey, userId, text, {buttons, html})`, `sendDocument(...)`, `status()`.

## BOSQICH 2 — `@utax_rahbar_bot` (web: Bosh sahifa, Pul, P&L, Pul oqimi, Balans, Reja/Fakt, Prognoz, Tasdiqlar, AI, Sozlamalar)

| Buyruq | Web sahifa | Servis |
|---|---|---|
| `/holat` | Bosh sahifa | `reports.dashboard` — 10 KPI, diqqat talab ishlar |
| `/pul` | Pul boshqaruvi | `reports.treasury` — bank/kassa/avans/rezerv/**available**, xavfsiz olish |
| `/foyda [oy]` | Foyda va zarar | `reports.pnl` + xizmat rentabelligi |
| `/pul_oqimi [oy]` | Pul oqimi | `reports.cashFlow` |
| `/balans` | Balans | `reports.balanceSheet` |
| `/reja_fakt [oy]` | Reja / Fakt | `budget.planFact` — og'ish > tolerans ⚠️ |
| `/prognoz [30]` | Prognoz | `forecast` — 3 senariy, eng past nuqta |
| `/debitorlik` | Debitorlik | `receivables.summary` + aging + TOP-10 |
| `/tasdiqlash` | Tasdiqlashlar | `approvals` — ✅ Tasdiqlash / ❌ Rad (sabab dialog) / ⏸ Kechiktirish / 🌐 |
| `/takliflar` | AI moliya | `ai_actions` PROPOSED → Tasdiqlash / Rad |
| `/agentlar` | AI moliya | 14 agent holati, "▶ Ishga tushirish" |
| `/hisobot [oy]` | Hisobotlar | P&L/Cash flow/Aging XLSX → `sendDocument` |
| `/xodimlar` | Sozlamalar → Foydalanuvchilar | ro'yxat, 🔒 Bloklash / ochish (`is_active`, Kill switch) — faqat `users.EDIT` |
| erkin matn | AI chat | "Bugun qancha pulimiz bor?" va h.k. |

Avtomatik: 08:30 CFO digest (rahbar botga), LOW_LIQUIDITY/FORECAST_RISK darhol, katta xarajat so'rovi darhol.

## BOSQICH 3 — `@utax_buxgalter_bot` (web: Tushumlar, Bog'lash, Xarajatlar, Shartnomalar, Oylik, Integratsiyalar)

| Buyruq | Servis |
|---|---|
| `/vipiska` | bank hisobini tanlash → CSV/XLSX fayl → `banking.preview` → "✅ Import" → `banking.import` + reconciliation natijasi |
| `/boglash` | SUGGESTED tranzaksiyalar: ✅ Tasdiqlash / 🔁 Boshqa shartnoma / 🚫 E'tiborsiz |
| `/tushumlar` | oxirgi tranzaksiyalar, filtr (bog'lanmagan) |
| `/kassa` | naqd kirim/chiqim dialogi (summa → turi → maqsad → tasdiq) |
| `/tolov` | tasdiqlangan, to'lanmagan xarajatlar → "💸 To'landi" (vazifalar ajratilishi: tasdiqlagan odam to'lay olmaydi) |
| `/xarajatlar [oy]` | kategoriya bo'yicha jami, kategoriyasiz → AI taklifi |
| `/daromad` | PENDING_APPROVAL tan olishlar → Tasdiqlash / Rad; `/akt` — shartnomaga akt yuklash → tan olish |
| `/shartnoma <raqam yoki mijoz>` | kartochka: jadval, to'langan, qoldiq, holat, akt |
| `/oylik [oy]` | payroll davri holati, qadamlar, "Keyingi qadamga" (RBAC `payroll.APPROVE`) |
| `/byudjet [oy]` | byudjet vs fakt |
| `/integratsiyalar` | holat, oxirgi sync, "🔄 Hozir sinxronlash" |
| `/sifat` | data-quality ogohlantirishlari |

Avtomatik: 17:00 ish kunlari "Bugungi vipiskani yuboring" (API yo'q bo'lsa), UNMATCHED_TRANSACTION, integratsiya xatosi.

## BOSQICH 4 — `@utax_sorov_bot` (web: Xarajatlar → So'rov, Tasdiqlashlar, Debitorlik, KPI)

| Buyruq | Kimga | Servis |
|---|---|---|
| `/yangi` | hamma (`expenses.CREATE`) | dialog: summa → kategoriya (AI taklifi + tugmalar) → maqsad → hujjat (rasm/PDF, ixtiyoriy) → tasdiq → `expenses.request` → tasdiq zanjiri |
| `/sorovlarim` | hamma | o'z so'rovlari, holati, kim kutyapti |
| `/tasdiqlash` | DEPARTMENT_HEAD (`approvals.APPROVE`) | faqat o'ziga tushgan qadam: ✅ / ❌ sabab / ⏸ |
| `/shartnomalarim` | SALES | faqat `manager_user_id = me` |
| `/qarzdorlarim` | SALES | o'z mijozlari qarzi, kechikish |
| `/vazifalarim` | SALES | collections: "📞 Aloqa qildim", "🤝 Va'da berdi (sana)", izoh |
| `/oyligim [oy]`, `/kpi [oy]` | hamma | faqat o'z payroll qatori va KPI |

Avtomatik: so'rov tasdiqlandi/rad etildi/to'landi → so'rovchiga shu botdan.

## BOSQICH 5 — `@utax_signal_bot` (web: Bildirishnomalar)

- [x] `notifications.notify()` qayta ulanadi: CRM yozuvi → Telegram kanal **signal bot** orqali (faqat `bot_chats` da
      signal /start qilganlarga), `notification_prefs` va jim soatlar hisobga olinadi, CRITICAL jim soatni yorib o'tadi.
- [x] Har xabar: 🔴/🟡/🔵 + sarlavha + matn + tugmalar: "🌐 Ochish" (entity → web sahifa), "✅ Ko'rildi"
      (→ web'dagi `is_read` bilan sinxron), APPROVAL_WAITING uchun "✅ Tasdiqlash / ❌ Rad" (RBAC bilan).
- [x] Yuborish navbati: 429 da kutish, 3 urinish, `sent_at/error/attempts`, `tg_message_id`.
- [x] `/sozlama` — 16 alert turi bo'yicha yoqish/o'chirish, jim soatlar; `/bugun` — bugungi digest; `/oqilmagan`.
- [x] `TELEGRAM_ALERT_CHAT_ID` guruhiga CRITICAL'lar.

## BOSQICH 6 — Webapp integratsiyasi

- [x] `/api/bots/status` — 4 bot: ishlayaptimi, username, xato, oxirgi update; `/api/bots/test` (admin).
- [x] Sozlamalar → Profil → **Telegram botlar** kartasi: 4 bot, har biri uchun holat (bog'langan / /start qilingan),
      `t.me/<bot>?start=KOD` deep link tugmalari (kod qo'lda yozilmaydi).
- [x] Sozlamalar → **Botlar** (admin): holat, buyruqlar ro'yxati, test xabar, foydalanuvchilar qaysi botda.
- [x] Bildirishnomalar sahifasi: Telegram yetkazish holati (yuborildi/xato).
- [x] Telegram Mini App: `setChatMenuButton` → "🌐 Dashboard" (web_app, faqat HTTPS `WEBAPP_URL`),
      `POST /api/auth/telegram-webapp` (initData HMAC-SHA256 tekshiruvi, 24 soat) → JWT; frontend
      `window.Telegram.WebApp` bo'lsa avtomatik kiradi, `#/...` start_param bo'yicha kerakli sahifani ochadi.

## BOSQICH 7 — Test, hujjat, push

- [x] `tests/bots.test.mjs` (`node:test`, in-memory DB + seed, soxta Telegram API — `fetch` mock):
      telegram-html bo'laklash, auth bog'lash/rad, har bot buyrug'i RBAC (ruxsatsiz rol → rad), so'rov dialogi to'liq
      yo'l, tasdiq callback → approvals holati, vazifalar ajratilishi, signal routing + prefs + jim soat, initData HMAC.
- [x] `docs/BOTS.md` (spetsifikatsiya), README yangilash.
- [x] `npm test` yashil → commit → `git push -u origin feature/telegram-bots` → PR.
- [x] Lokal jonli sinov: `npm start`, 4 botga /start KOD, har bir buyruq.

---

## Multi-agent ijro tartibi

1. **Men (lead):** Bosqich 0 + 1 — yadro va kontrakt (`definitions.mjs`, `shared/*`, handler interfeysi). Ketma-ket.
2. **Parallel 5 agent** (har biri faqat o'z papkasida, yadroga tegmaydi):
   - A → `src/bots/rahbar/` · B → `src/bots/buxgalter/` · C → `src/bots/sorov/` · D → `src/bots/signal/` + notifications ulash
   - E → Bosqich 6 (`src/modules/bots.mjs`, `public/js/pages/settings.js`, Mini App login)
3. **Men:** integratsiya, `tests/bots.test.mjs`, jonli sinov, hujjat, commit, push, PR.

## Ochiq savollar (qurishdan oldin javob kerak emas — default qabul qilingan)

- Server HTTPS domeni yo'q → lokal `polling`, Mini App tugmasi `WEBAPP_URL` HTTPS bo'lgandagina yoqiladi.
- Webhook prodda: `BOT_MODE=webhook`, `PUBLIC_URL=https://…`.
