# UTAX Finance CRM — ishlash qoidalari

## 1-QOIDA (eng muhim): o'zimizdan ma'lumot QO'SHILMAYDI

Tizimdagi barcha biznes ma'lumotlari **faqat Excel fayllardan** olinadi (yoki foydalanuvchi o'zi qo'lda kiritadi).

- **Taqiqlanadi:** shartnoma, kontragent, INN, telefon, bank hisob raqami, tranzaksiya, xarajat, xodim, ism-familiya, maosh, reja, byudjet, boshlang'ich qoldiq, valyuta kursi, sana, summa — hech birini o'ylab topish, "namuna" yoki "demo" sifatida qo'shish.
- **Faylda yo'q maydon bo'sh qoladi.** Masalan, to'lov muddati, avans %, bo'lim yoki hisob raqami. Uni taxmin bilan to'ldirish mumkin emas.
- **Aniqlab bo'lmagan qator import qilinmaydi.** Import natijasida u sababi bilan "o'tkazib yuborildi" deb ko'rsatiladi.
- **Excel'dagi shubhali qiymat o'zgartirilmaydi.** Masalan, 1965-yil sanasi. U o'zgarishsiz olinadi va foydalanuvchiga "tekshiring" deb ko'rsatiladi.
- **Sozlamalardagi biznes raqamlari standart holda 0 yoki bo'sh.** Bularga xavfsizlik rezervi, likvidlik chegarasi, valyuta kurslari va tasdiqlash summasi chegaralari kiradi. Ularni rahbar o'zi belgilaydi.
- **Tahlil yoki hisoblashga ruxsat bor.** Excel'dagi yozuvlardan hisoblash mumkin: avans, debitorlik, P&L va pul oqimi.
- **Tasniflashga ruxsat bor.** Excel'dagi hisob nomini tizim kategoriyasiga moslash mumkin, masalan "з/п" → "Oylik". Lekin yangi raqam yoki fakt qo'shib bo'lmaydi.

### Ma'lumot qayerdan kiradi

| Manba | Qayerda |
|---|---|
| Moliya jurnali (double-entry Excel) | Integratsiyalar → "Moliya jurnali (Excel)" → Jurnal yuklash. Kod: `src/import/ledger-journal.mjs` |
| Moliya jurnali (bitta yozuvli Excel — direktorning 2026-07 formati: "Договор", "Поступление БАНК", "Расход Банк з/п"...) | Xuddi shu tugma (format o'zi aniqlanadi) yoki CLI: `node scripts/excel-import.mjs <fayl> --reset`. Kod: `src/import/excel-journal.mjs` → `apply-journal.mjs` |
| Bank ko'chirmasi (Excel/CSV) | Integratsiyalar → "Excel / CSV fayl" |
| Ko'p kompaniyali bank ko'chirmasi (.xls: ASBT — Ipoteka "Справка о работе счета", Open Bank/Smart "Hisob-varaq aylanmasi") | Dashboard → "Bank hisoblari" → "Bank ko'chirmasi" yoki CLI: `node scripts/bank-import.mjs --registry data/bank-registry.json <fayllar>`. Kod: `src/import/bank-statement.mjs`, `src/modules/bank-ledger.mjs`. Hisob reyestrda bo'lmasa yoki boshlang'ich + kirim − chiqim ≠ yakuniy bo'lsa — rad etiladi |
| Kassa oylik yig'indisi (bank qatlami uchun) | Dashboard → "Bank hisoblari" → "+ Kassa" (foydalanuvchi kiritadi) |
| Boshlang'ich qoldiqlar | Pul boshqaruvi → Hisoblar → tahrirlash (foydalanuvchi kiritadi) |
| Bank API / ERP (REST JSON) | Integratsiyalar → Ulash: manzil, autentifikatsiya, `list_path`, `field_map`. Har soatda BANK agenti sinxronlaydi |
| 1C:Бухгалтерия | Integratsiyalar → 1C: standart OData (`Document_ПоступлениеНаРасчетныйСчет` / `СписаниеСРасчетногоСчета`) yoki o'z HTTP-servisi |
| Google Sheets | Integratsiyalar → havola (Share → Anyone with the link) |
| Tashqi tizim push | Integratsiyalar → Inbound webhook: `POST /api/integrations/webhook/<token>` |

**Joriy haqiqiy ma'lumot (2026-09-22):** yagona manba — "Программистларга молия ИЮЛЬ.xlsx" (direktor bergan). Eski Excel bazalari `data/backups/` ga olindi.
Foydalanuvchi kiritgan qiymatlar: 1-qatordagi 1965-07-20 → 2026-07-20 (`--fix-date 69=2026-07-20`); UTAX BANK boshlang'ich qoldig'i 1 092 584 868, kassa 100 368 000 (1-iyul 2026 holati).

### Ko'p kompaniyali bank qatlami (2026-09-25)

ERP ma'lumotidan ALOHIDA jadvallar: `own_companies`, `own_accounts`, `bank_statements`, `bank_statement_lines`, `cash_period_entries` (migratsiya 7). ERP jadvallariga tegilmaydi.
- Reyestr (foydalanuvchi bergan): UGS — ООО "UTAX GROUP" (INN 302348324), UTAX — ООО "UNITED TAX ADVISORS" (INN 302047120); hisoblar va kassa `data/bank-registry.json` da (git'ga tushmaydi).
- Boshlang'ich qoldiq har doim bank faylidan olinadi. Qo'lda yaxlitlangan qiymatlar ishlatilmaydi. Masalan, Utax Moliya.xlsx da Smart uchun 344 900 000 yozilgan, fayl bo'yicha esa 344 856 000.
- Ichki o'tkazma — korrespondent hisob reyestrda bo'lsa. Hisob darajasida saqlanadi, kompaniya/global darajasida shu doira ichidagilari tushum/xarajatdan chiqariladi. Oylik kartalari (2310…) ichki emas.
- Manba ustuvorligi: bank fayli > qo'lda > ERP. Bu qatlam ERP `bank_transactions` ni o'qimaydi, shuning uchun ikki marta sanalmaydi.
- Kassa iyul 2026 (foydalanuvchi kiritgan): 100 400 000 + 390 600 000 − 452 400 000 = 38 600 000. Eslatma: eski jurnal importidagi kassa boshlang'ich qoldig'i 100 368 000 edi.

### Ma'lumot seyfi (jamoa bilan ulashish)

Haqiqiy baza git'ga ochiq holda tushmaydi (`data/*.db` ignore'da). Jamoa uchun u **shifrlangan** holda `data/vault/` da saqlanadi (AES-256-GCM, `scripts/data-vault.mjs`).
- Kalit `DATA_VAULT_KEY` — faqat `.env` da; loyiha egasi shaxsiy kanal orqali beradi. Kalit git'ga, chatga, logga yozilmaydi.
- Ochish: `.env` ga kalitni qo'yish → server to'xtagan holda `npm run vault:unpack` → `npm start`.
- Yangilash (ma'lumot o'zgarganda): `npm run vault:pack -- --add <manba.xlsx>` → commit `data/vault/`.

### UTAXERP tokeni (seyfda, 2026-09-26)

Token har oy yangilanadi va `.env` git'ga tushmaydi — shu sababli a'zolar pull qilgach ERP 401 berardi. Endi token ham seyfda:
`data/vault/erp-token.enc` (AES-256-GCM, xuddi shu `DATA_VAULT_KEY`). Yonida `erp-token.json` — faqat muddat va kalit izi, tokenning o'zi yo'q.

| Kim | Nima qiladi |
|---|---|
| **Jamoa a'zosi** | `git pull` → `npm start`. `.env` da `DATA_VAULT_KEY` bo'lsa yetarli, `ERP_TOKEN` shart emas |
| **Token egasi** (oyiga bir marta) | `npm run erp:token:seal -- <yangi-token>` → `data/vault/` ni commit qilib PR ochadi |
| **Tekshirish** | `npm run erp:token:show` — kim uchun, necha kun qolgani (token ekranga chiqmaydi) |

Tanlov tartibi: `.env` dagi `ERP_TOKEN` → seyf. Bazadagi token (UI'dagi "Tokenni yangilash") ikkalasidan yangiroq bo'lsa, u saqlanib qoladi — `ensureErpIntegration` muddatlarni solishtiradi. Kalit yo'q yoki fayl buzuq bo'lsa server ogohlantirish berib odatdagidek ishga tushadi. `seal` muddati o'tgan yoki JWT bo'lmagan qiymatni repoga qo'ymaydi.

### Texnik qoldiq tuzatmalari (foydalanuvchi so'rovi bilan, 2026-09-21)

Excel'da 01.07 boshlang'ich qoldig'i yo'q edi. Shuning uchun bank va kassa minusga tushdi. Foydalanuvchi so'rovi bilan minus summasi **alohida** `balance_adjustments` jadvaliga kiritildi. Bank uchun +1 840 404 091,41, kassa uchun +61 804 920 so'm, turi `NEGATIVE_COVER`.

- `opening_balance` va tranzaksiyalar o'zgarmagan, ular Excel ma'lumoti bo'lib qoladi.
- Tuzatma qoldiqqa qo'shiladi, lekin kirim yoki daromad hisoblanmaydi.
- UI'da "texnik tuzatma" belgisi va Ma'lumot sifati ogohlantirishi bilan ko'rinadi.
- Haqiqiy qoldiq ma'lum bo'lganda `POST /api/banking/adjustments/:id/reverse` bilan bekor qilinadi, keyin haqiqiy `opening_balance` kiritiladi.
- Bunday tuzatma faqat foydalanuvchi aniq so'raganda qilinadi.

### Test ma'lumotlari

`tests/fixtures/demo-seed.mjs` — **to'qima** ma'lumot, faqat avtomatik testlar uchun (in-memory baza). Uni haqiqiy bazaga yuklash **taqiqlanadi**.
`src/seed/seed.mjs` — faqat tizim tuzilmasi: rollar, kirish akkauntlari (rol nomi bilan), xizmat turlari, xarajat kategoriyalari. Biznes ma'lumoti yo'q.

## UI qoidalari

Har qanday sahifa, komponent yoki stilni yaratishdan yoki o'zgartirishdan **oldin** [UI-SKILL.md](UI-SKILL.md) ni o'qing. Bu fayl loyiha UI'sining yagona manbai: tokenlar, komponentlar, sahifa naqshlari, responsiv tizim, kanonik variantlar va yangi sahifa qoidalari shu yerda.

## Deploy

- **VPS / Docker:** `deploy/`, `Dockerfile`. Kod o'zgarmaydi, cheklov yo'q.
- **Vercel:** [DEPLOY-VERCEL.md](DEPLOY-VERCEL.md) ga qarang: `api/index.mjs`, `vercel.json`, Turso bazasi (`TURSO_DATABASE_URL`) va cron (`/api/cron/tick`). Deploydan oldin `npm run vercel:check` ni ishga tushiring.

## Texnik eslatmalar

- Node 22.5+, paketsiz, `node:sqlite`. Ishga tushirish: `npm start` (port 8100). Testlar: `npm test`.
- Bo'sh tizim yaratish: `node src/seed/seed.mjs --reset` (bazani o'chiradi — avval `data/backups/` ga nusxa oling).
- Backend o'zgarsa serverni qayta ishga tushiring (watch yo'q).
