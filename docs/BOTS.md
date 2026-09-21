# 4 ta Telegram bot — UTAX Finance CRM

**Tamoyil: bot = web panelning Telegram'dagi oynasi.** Botlar o'z hisobini qilmaydi — `app.services.*` ni chaqiradi
(web API bilan bir xil kod), ruxsat web'dagi `app.rbac` matritsasidan (admin panelda tahrirlanadi), har amal
`audit_logs` ga `source = TELEGRAM` bilan yoziladi. Shuning uchun botdagi raqam, ruxsat va holat web bilan har doim bir xil.
Arxitektura namunasi — `utax-agent` (NestJS + grammY): factory → middleware → handlers; bu loyihada tashqi paketsiz.

| Bot | Kimga | Vazifa |
|---|---|---|
| **@utax_rahbar_bot** (`BOT_RAHBAR_TOKEN`) | FOUNDER, CEO, CFO, ADMIN | Holat, pul, P&L, pul oqimi, balans, reja/fakt, prognoz, debitorlik, tasdiqlar, AI takliflari va agentlar, Excel hisobotlar, xodimlar (Kill switch) |
| **@utax_buxgalter_bot** (`BOT_BUXGALTER_TOKEN`) | FOUNDER, CFO, FINANCE_MANAGER, ACCOUNTANT | Bank vipiskasi, tranzaksiyalarni bog'lash, kassa, to'lovlar, daromad, akt, shartnoma kartasi, oylik, byudjet, integratsiyalar |
| **@utax_sorov_bot** (`BOT_SOROV_TOKEN`) | barcha xodimlar | Xarajat so'rovi (7 qadam), so'rovlarim, bo'lim tasdig'i, o'z shartnoma/qarzdor/undiruv vazifalari, o'z oyligi va KPI |
| **@utax_signal_bot** (`BOT_SIGNAL_TOKEN`) | barcha xodimlar | Bildirishnomalar markazi: barcha ogohlantirishlar, ✅/❌ tasdiqlash tugmalari, sozlamalar, jim soatlar |

## Ulanish

1. Web panel → **Sozlamalar → Profil → Telegram botlar → «Ulash»** — 24 soatlik kod va har bir ruxsat etilgan bot uchun havola (`t.me/<bot>?start=KOD`).
2. Havolani bosing → «Start» → hisob bog'lanadi. **Bitta bog'lash barcha 4 botga amal qiladi** (`users.telegram_user_id`).
3. Bildirishnomalar uchun **@utax_signal_bot** ni ham oching (Telegram bot foydalanuvchi o'zi /start qilmaguncha xabar yubora olmaydi).

**Egalar** (`BOT_OWNER_IDS`, vergul bilan Telegram user id'lar): har doim `FOUNDER` roli, barcha 4 botga va barcha buyruqlarga kiradi,
kodsiz — botga birinchi yozganda avtomatik bog'lanadi (server ishga tushganda ham tayyorlanadi). Bog'langan boshqa rolli hisob
ega bo'lsa — rol `FOUNDER` ga ko'tariladi (`OWNER_ROLE_ENFORCED` audit).

Bog'lanmagan Telegram hisobi — yo'riqnoma + `TELEGRAM_ACCESS_DENIED` audit; rolga mos bo'lmagan bot — mos botlar havolasi;
bloklangan foydalanuvchi (Kill switch) — hech bir bot javob bermaydi, web sessiyalari ham bekor qilinadi.

## Umumiy (barcha botlarda)

| Buyruq | Nima qiladi |
|---|---|
| `/start` | Rolga mos menyu (faqat ruxsat etilgan bo'limlar tugmalari) + 🌐 Web panel. Telegram «Menyu» ham shu chat uchun rolga moslanadi |
| `/yordam` | Ruxsat etilgan buyruqlar va misollar |
| `/bekor` | Ochiq ko'p qadamli amalni bekor qilish |
| `/tozalash` | Suhbatni tozalash |
| Erkin matn | **AI moliya yordamchisi** — web «AI moliya» bilan bir xil dvigatel: «Bugun qancha pulimiz bor?», «Kim bizdan eng ko'p qarzdor?», «Marketingning 12 mln so'rovini tasdiqla» (→ ✅ tugma). Rolga ruxsat bo'lmagan ma'lumot so'ralsa — «ruxsat yo'q» (intent va LLM tool'lari web resurs ruxsatlariga bog'langan) |

Tasdiqlash kartalari (barcha botlarda bir xil): summa, so'rovchi, kategoriya, tasdiq zanjiri (kim, qachon, qayerdan — web/Telegram),
**✅ Tasdiqlash / ❌ Rad etish (sabab — tayyor yoki yozma) / ⏸ 3 kunga kechiktirish / 🌐 Web'da ochish** — `approvals.decide` orqali, web bilan bir xil qoida (qadam egasi, `ACT_AS`, AI tasdiqlay olmaydi).

## @utax_rahbar_bot

| Buyruq | Ruxsat | Nima qiladi |
|---|---|---|
| `/holat` | dashboard VIEW | Bugungi moliyaviy holat: pul, available, oy daromad/xarajat/foyda (o'tgan oyga ▲/▼), debitorlik, 30 kunlik kutilgan kirim/chiqim, kutayotgan ishlar |
| `/pul` | treasury VIEW | Bank va kassa hisoblari, avans (cheklangan), rezerv tarkibi, **ishlatish mumkin**, xavfsiz olish, 7/30 kun |
| `/foyda [oy]` | pnl VIEW | P&L (◀️/▶️ oy almashtirish), marja, oldingi davr, xizmatlar |
| `/xizmatlar [oy]` | pnl VIEW | Xizmatlar rentabelligi (✅ / ⚠️ past / ❌ zarar) |
| `/pul_oqimi [oy]` | cashflow VIEW | Operating / investing / financing, ochilish → yopilish |
| `/balans` | balance VIEW | Boshqaruv balansi |
| `/reja [oy]` | planfact VIEW | Reja / Fakt |
| `/prognoz [kun]` | forecast VIEW | 3 senariy, risk (7/30/90/180 tugmalar) |
| `/debitorlik` | receivables VIEW | Aging, TOP-10, filtrlar: muddati o'tgan / kritik / 7 kun |
| `/tasdiqlash` | approvals VIEW | Navbatingizdagi so'rovlar kartalari |
| `/takliflar` | ai VIEW (✅ ai APPROVE, ❌ ai REJECT) | AI takliflari → inson tasdig'i → bajarish → audit |
| `/agentlar` | ai VIEW (▶ ai CREATE) | 14 agent holati va qo'lda ishga tushirish |
| `/hisobot [oy]` | reports EXPORT | Excel: P&L, pul oqimi, xizmatlar, debitorlik |
| `/xodimlar` | users VIEW (🔒/🔓 users EDIT) | Xodimlar, rollar, Telegram ulanganmi; Kill switch (ta'sischi va o'zini bloklab bo'lmaydi) |
| `/sifat` | dashboard VIEW | Ma'lumot sifati muammolari |

## @utax_buxgalter_bot

| Buyruq | Ruxsat | Nima qiladi |
|---|---|---|
| `/vipiska` | transactions CREATE | Hisob → CSV/XLSX fayl → ko'rib chiqish → ✅ Import (takroriylar o'tkaziladi, kirimlar avtomatik bog'lanadi) |
| `/boglash` | reconciliation VIEW (✅ APPROVE, 🚫 EDIT) | Bog'lanmagan tx: nomzod shartnoma/xarajat (ball bilan), e'tiborsiz (sabab + cash-flow sinfi) |
| `/tushumlar [boglanmagan]` | transactions VIEW | Oxirgi kirimlar |
| `/kassa` | treasury CREATE | Naqd kirim/chiqim: kirim shartnomaga to'lov yozadi, chiqim tasdiqlangan xarajatni yopadi |
| `/tolov` | expenses EDIT | Tasdiqlangan xarajatlar → 💵 kassadan / 🏦 bankdan to'landi |
| `/xarajatlar [oy]` | expenses VIEW | Kategoriyalar, to'lanmagan, kutilayotgan |
| `/daromad` | revenue VIEW | Tan olingan, avanslar, backlog, tasdiq kutayotgan tan olishlar (kartalar) |
| `/akt [shartnoma]` | contracts EDIT | Qabul akti fayli → daromad tan olish (yoki CFO tasdig'i) |
| `/shartnoma <raqam\|mijoz>` | contracts VIEW | Karta: to'lov, qoldiq, jadval, akt; ✅ xizmat yakunlandi, 📎 akt |
| `/oylik [oy]` | payroll VIEW | Vedomost: 🧮 hisoblash, 📤 tasdiqqa yuborish, 💸 to'landi |
| `/byudjet [oy]` | planfact VIEW | Bo'limlar byudjeti vs fakt |
| `/integratsiyalar` | integrations VIEW (🔄 EDIT) | Holat va sinxronlash |
| `/sifat` | dashboard VIEW | Ma'lumot sifati |
| `/tasdiqlash` | approvals VIEW | Navbatingizdagi so'rovlar |

Avtomatik: ish kunlari 17:00 — bugun vipiska yuklanmagan va bank API yo'q bo'lsa buxgalterga eslatma (`REMINDER`).

## @utax_sorov_bot

| Buyruq | Ruxsat | Nima qiladi |
|---|---|---|
| `/yangi [summa]` | expenses CREATE | Summa → maqsad → kategoriya (AI taklifi) → sana → to'lov usuli → kontragent → hujjat (rasm/PDF) → yuborish → tasdiq zanjiri |
| `/sorovlarim` | expenses VIEW | Faqat o'z so'rovlari: holat, kim kutyapti, batafsil karta |
| `/tasdiqlash` | approvals APPROVE | Bo'lim rahbari — xarajat so'rovlarini tasdiqlash |
| `/shartnomalarim` | contracts VIEW | O'z shartnomalari (manager) |
| `/qarzdorlarim` | receivables VIEW | O'z mijozlari qarzi, kechikish |
| `/vazifalarim` | collections VIEW (tugmalar EDIT) | Undiruv vazifalari: 📞 aloqa qildim, 🤝 va'da berdi (sana), ✅ bajarildi |
| `/oyligim [oy]` | — (faqat o'zi) | Fiks, KPI, bonus, jarima, avans, net, holat, 6 oy tarixi |
| `/kpi [oy]` | — (faqat o'zi) | KPI qoidalari bo'yicha ko'rsatkichlar |

## @utax_signal_bot — bildirishnomalar markazi

Har `notifications.notify()` (to'lov muddati, katta xarajat, likvidlik, byudjet, tasdiq kutilmoqda/qarori, prognoz riski, kunlik digest …):
CRM yozuvi (web «Bildirishnomalar») **+** Telegram navbati → @utax_signal_bot. Signal bloklangan / ochilmagan bo'lsa — foydalanuvchi ochgan
boshqa UTAX boti orqali (zaxira). Yuborilmasa — har daqiqa qayta urinish (backoff, 24 soat, 5 marta), holat web jurnalida (`bot_key`, `attempts`, `error`).
Xabardagi tugmalar: **✅ Tasdiqlash / ❌ Rad etish** (faqat qadam egasiga), **🌐 Ochish** (web sahifa), **✅ Ko'rildi** — web'dagi «o'qilgan» bilan sinxron.
`TELEGRAM_ALERT_CHAT_ID` — CRITICAL'lar guruhga ham.

| Buyruq | Ruxsat | Nima qiladi |
|---|---|---|
| `/bugun` | notifications VIEW | Bugungi bildirishnomalar (🔴/🟡/🔵), available (treasury VIEW bo'lsa), navbatdagi tasdiqlar |
| `/oqilmagan` | notifications VIEW | O'qilmaganlar, to'liq karta, hammasini o'qilgan qilish |
| `/tarix` | notifications VIEW | Tarix (sahifalash) |
| `/sozlama` | notifications EDIT | Qaysi turlar Telegram'ga kelsin, jim soatlar (22:00–08:00 / 23:00–07:00; CRITICAL jim soatda ham keladi) |
| `/test` | notifications VIEW | O'zingizga test bildirishnoma |

Web'dan ham: Sozlamalar → Profil → Telegram botlar → bildirishnoma sozlamalari (`GET/PUT /api/notifications/prefs`).

## Telegram Mini App

`WEBAPP_URL` (yoki `PUBLIC_URL`) **https** bo'lsa: botlardagi «🌐 …» tugmalari va chat menyusidagi «📊 Dashboard» web panelni Telegram ichida ochadi,
kirish avtomatik — `initData` HMAC (bot tokeni bilan) server'da tekshiriladi (`POST /api/auth/telegram-webapp`, 24 soat), shu Telegram hisobiga
bog'langan foydalanuvchi sessiyasi beriladi. Marshrut `?tgp=contracts/5` orqali. HTTP manzil → oddiy URL tugmalar; localhost / ichki IP → tugmalar chiqmaydi.
HTML sahifalar `Content-Security-Policy: frame-ancestors` bilan faqat Telegram web mijozlariga iframe ruxsati beradi.

## Ishga tushirish

```bash
# .env: BOT_RAHBAR_TOKEN, BOT_BUXGALTER_TOKEN, BOT_SOROV_TOKEN, BOT_SIGNAL_TOKEN, BOT_OWNER_IDS
npm start                 # BOT_MODE=polling (default) — 4 bot long polling bilan
BOT_MODE=off npm start    # botlarsiz (faqat web)
```

Prod (webhook): `BOT_MODE=webhook`, `PUBLIC_URL=https://finance.utax.uz`, `WEBHOOK_SECRET=<tasodifiy>`; nginx `location /telegram/` ilovaga
proxy (deploy/nginx.conf). Telegram `POST /telegram/<bot>` ga yuboradi, `X-Telegram-Bot-Api-Secret-Token` timing-safe tekshiriladi, javob darhol 200.
Holat: web → Sozlamalar → **Telegram botlar** (admin) yoki `GET /api/bots`.

## Xavfsizlik

- RBAC: har buyruq/tugma web matritsasi bilan tekshiriladi; tugma argumentlariga ishonilmaydi (egalik va holat qayta tekshiriladi); web scope'lari takrorlanadi (SALES — o'z shartnomalari, EMPLOYEE — o'z so'rovlari).
- Faqat shaxsiy chat; update dedupe; foydalanuvchi bo'yicha rate limit (30/daq); callback_data ≤ 64 bayt; eskirgan tugmalar rad etiladi.
- Xatolar foydalanuvchiga stack'siz («Xatolik yuz berdi…»), `BOT_ERROR` audit; HTML parse xatosi bo'lsa oddiy matn bilan qayta yuboriladi.
- Tokenlar faqat `.env` da (git'da emas), log va xato matnlariga chiqmaydi. Bog'lash kodi 24 soat, bir martalik.
- Dialog holati `bot_dialogs` (30 daqiqa), polling offset `bot_state` — server qayta ishga tushsa ham saqlanadi.

## Kod tuzilmasi

```
src/bots/
  index.mjs              startBots (polling/webhook/off), registry, status, send, webhook, registerBotJobs, botCatalog
  shared/
    bot-factory.mjs      middleware zanjiri, ctx, menyu, /yordam, chat buyruqlari
    telegram-api.mjs     fetch klient (429/5xx retry, token maxfiy)
    auth.mjs owners.mjs  bog'lash (/start KOD), bot_chats, egalar
    approvals-ui.mjs     tasdiq kartasi/ro'yxati, apr:/aprr: tugmalari, rad sababi dialogi
    ai-chat.mjs          erkin matn → ai.chat (RBAC)
    dispatcher.mjs       bildirishnomalar → signal (zaxira, qayta urinish, alert chat)
    common.mjs           nr: (ko'rildi), x (yopish)
    html.mjs format.mjs keyboards.mjs texts.mjs dialogs.mjs errors.mjs webapp-auth.mjs
  rahbar/ buxgalter/ sorov/ signal/   bot.mjs (definitsiya) + handlers/*.mjs
src/modules/bots.mjs     /api/bots, /api/bots/:key/test, /api/bots/chats, /api/bots/linked-users
tests/bots-*.test.mjs    soxta Telegram server bilan (tests/helpers/bot-harness.mjs) — tarmoqsiz
```
