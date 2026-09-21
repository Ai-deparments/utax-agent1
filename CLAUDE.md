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
| Bank ko'chirmasi (Excel/CSV) | Integratsiyalar → "Excel / CSV fayl" |
| Boshlang'ich qoldiqlar | Pul boshqaruvi → Hisoblar → tahrirlash (foydalanuvchi kiritadi) |

### Test ma'lumotlari

`tests/fixtures/demo-seed.mjs` — **to'qima** ma'lumot, faqat avtomatik testlar uchun (in-memory baza). Uni haqiqiy bazaga yuklash **taqiqlanadi**.
`src/seed/seed.mjs` — faqat tizim tuzilmasi: rollar, kirish akkauntlari (rol nomi bilan), xizmat turlari, xarajat kategoriyalari. Biznes ma'lumoti yo'q.

## Texnik eslatmalar

- Node 22.5+, paketsiz, `node:sqlite`. Ishga tushirish: `npm start` (port 8100). Testlar: `npm test`.
- Bo'sh tizim yaratish: `node src/seed/seed.mjs --reset` (bazani o'chiradi — avval `data/backups/` ga nusxa oling).
- Backend o'zgarsa serverni qayta ishga tushiring (watch yo'q).
