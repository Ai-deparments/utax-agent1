# UTAX AI Moliya CRM — moliya va boshqaruv uchun qo'llanma

> **Kim uchun:** Founder, CEO, CFO, moliya menejeri, bosh buxgalter, moliyaviy nazoratchi.
> **Holat sanasi:** 2026-09-22 (Toshkent vaqti). Raqamlar ishlab turgan tizimdan va kod tekshiruvidan olingan.
> **Dasturlash bilimi talab qilinmaydi.** Texnik tafsilotlar alohida hujjatda: `UTAX-DEVELOPER-TECHNICAL.md`.

---

## 1. Bu tizim nima va kompaniyaga nega kerak

UTAX AI Moliya CRM — kompaniyaning **pul, shartnoma va xarajatlarini bitta joyda ko'rsatadigan boshqaruv tizimi**. U quyidagi savollarga javob berish uchun qurilgan:

- Bankda va kassada hozir qancha pul bor?
- Mijozlar qancha to'lashi kerak edi, qanchasini to'ladi, qanchasi qarz bo'lib qoldi?
- Pul nimaga sarflandi — oylik, soliq, marketing, ijara?
- Qaysi xarajatlar tasdiqlanishi kerak va kim tasdiqlaydi?
- Oy oxirida foyda yoki zarar qancha?
- Qayerda muammo bor: pul kam qolyaptimi, ma'lumot to'liqmi?

Tizimdan ikki yo'l bilan foydalaniladi:
- **Web panel** — kompyuterda yoki telefonda. Telefonga ilova sifatida o'rnatsa bo'ladi.
- **4 ta Telegram bot** — rahbar, buxgalter, xodimlar va bildirishnomalar uchun.

---

## 2. Eng muhim qoida: tizim ma'lumot o'ylab topmaydi

Tizimga faqat ikki xil manbadan ma'lumot kiradi:
1. **Kompaniya Excel fayllari** (hozir — direktorning moliya jurnali);
2. **Mas'ul xodim qo'lda kiritgan qiymat** (masalan, bankning boshlang'ich qoldig'i).

Faylda biror ma'lumot yo'q bo'lsa, tizim uni **taxmin qilmaydi va to'ldirmaydi**:
- raqam o'rnida **"--"** ko'rinadi;
- tushunarsiz qator yozilmaydi va sababi ko'rsatiladi;
- shubhali qiymat (masalan, noto'g'ri yil) o'zgartirilmaydi. U "tekshiring" deb belgilanadi va faqat mas'ul shaxs tasdiqlasa tuzatiladi.

**Rahbariyat uchun ma'nosi:** ekrandagi har bir raqamni manbaga qaytarib tekshirish mumkin. Lekin ekran **manbadan to'liqroq bo'lolmaydi**. Excel'da biror narsa yo'q bo'lsa, hisobotda ham u bo'lmaydi, raqam esa "--" yoki 0 bo'lib ko'rinadi.

Tizimga ruxsat berilgan ish — mavjud ma'lumotni **hisoblash va tasniflash**. Masalan, qarzdorlikni hisoblash yoki Excel'dagi "з/п" hisobini "Oylik" guruhiga qo'yish. Yangi fakt qo'shish taqiqlangan.

---

## 3. Asosiy tushunchalar — bir-biridan farqi

| Tushuncha | Oddiy tilda | Tizimda qanday ko'rinadi |
|---|---|---|
| **Shartnoma summasi** | Mijoz bilan kelishilgan umumiy narx | Shartnomalar ro'yxati. Bu hali pul emas |
| **Haqiqatda kelgan pul** | Bank yoki kassaga tushgan summa | Tushum yozuvi, to'lov |
| **Mijoz avansi** | Mijoz to'lagan, lekin xizmat hali "bajarildi" deb rasmiylashtirilmagan pul | Balansda majburiyat, daromad emas |
| **Debitorlik** | Mijoz shartnoma bo'yicha hali to'lamagan qism | Shartnoma summasi − to'langan summa |
| **Daromad (tan olingan)** | Xizmat bajarilib, akt bilan tasdiqlangan qism | P&L'dagi "Daromad" qatori |
| **Xarajat** | Kompaniya faoliyati uchun sarflangan pul | P&L'ga kiradi |
| **Ichki o'tkazma** | Bankdan kassaga pul olish | Daromad ham, xarajat ham emas. Faqat pul joyi o'zgaradi |
| **Dividend** | Egalarga to'langan foyda | Xarajat emas, moliyaviy oqim. P&L'ga kirmaydi |
| **Qarz (займ)** | Berilgan yoki qaytarilgan qarz | Xarajat emas. Yo'nalishi Excel'da yo'q, shuning uchun "tasniflanmagan" |
| **Qaytarim (возврат)** | Mijozga qaytarilgan pul | Xarajat emas. Qaysi shartnomaga tegishliligi Excel'da yo'q |

---

## 4. Pul tizim ichida qanday harakatlanadi

```
Direktorning Excel'i  /  qo'lda kiritilgan qiymat
        │
        ▼
 Tekshiruv — har qator: sana, summa, hisob nomi, kontragent
        │   (tushunarsiz qator → yozilmaydi, sababi bilan)
        ▼
 Moliyaviy yozuv:
   Shartnoma · Mijoz to'lovi · Bank kirim/chiqim · Kassa kirim/chiqim
   Xarajat (kategoriya bilan) · Dividend · Qarz · Qaytarim · O'tkazma
        │
        ▼
 Hisobotlar: Dashboard · Pul · Debitorlik · P&L · Cash Flow · Balans
        │
        ▼
 Signallar: bildirishnomalar va Telegram (pul kam, qarz, tasdiq kutilmoqda)
        │
        ▼
 AI agentlar: kuzatadi, tahlil qiladi, taklif beradi
        │
        ▼
 Rahbariyat qarori: tasdiqlaydi, rad etadi, ma'lumotni to'ldiradi
```

**Takroriy yuklash xavfsiz.** Bir Excel faylini qayta yuklansa, tizim avval yozilgan operatsiyalarni taniydi va ikkinchi marta qo'shmaydi.

---

## 5. Hozirgi ma'lumot manbai — direktorning iyul Excel'i

**Fayl:** "Программистларга молия ИЮЛЬ.xlsx". Hozir tizimdagi **yagona biznes ma'lumot manbai** shu.

### Excel nimani o'z ichiga oladi
Har qatorda bitta operatsiya bor:
- **"Договор"** — shartnoma: mijoz, summa, xizmat yo'nalishi (Ревизия, Спорный, Консультация, Сопровождение, Экспресс);
- **"Поступление БАНК / КАССА"** — mijozdan yoki boshqa manbadan kelgan pul;
- **"Расход Банк …"** — bankdan chiqim, yonida moddasi (з/п, НДС, маркетинг, аренда…);
- **"Расход Касса …"** — kassadan chiqim, erkin matn bilan (masalan, "Чоршанба ош");
- **dividend, qarz, qaytarim, bankdan kassaga o'tkazma**.

### Tizim nimani hisoblay oladi
- Shartnomalar, to'langan qism va qarzdorlik.
- Bank va kassa harakati. Boshlang'ich qoldiq kiritilgandan keyin — qoldiq ham.
- Xarajatlar moddalar bo'yicha.
- Pul oqimi: operatsion va moliyaviy oqim.

### Tizim nimani hisoblay olmaydi (Excel'da ma'lumot yo'q)
- **Daromadni tan olish.** Shartnoma sanasi va xizmat bajarilgani haqidagi akt yo'q.
- **To'lov muddati.** Shuning uchun "muddati o'tgan qarz" hisoblanmaydi.
- **Kontragent rekvizitlari:** INN, telefon.
- **Qarz va qaytarimning mazmuni:** kimga, qaysi shartnoma bo'yicha.
- **Kassadagi erkin matnli xarajatlarning kategoriyasi.**

### Mas'ul shaxs qo'lda kiritgan 3 ta qiymat
1. Bitta kassa xarajatida (500 040 so'm) sana 1965-yil deb yozilgan edi. Tasdiq bilan **2026-07-20** qilib tuzatildi.
2. **UTAX BANK boshlang'ich qoldig'i: 1 092 584 868 so'm** (1-iyul 2026 holati).
3. **Kassa boshlang'ich qoldig'i: 100 368 000 so'm** (1-iyul 2026 holati).

---

## 6. Iyul raqamlari va ularning ma'nosi

Tizim Excel'dagi yig'indilarni bazadagilar bilan avtomatik solishtirdi: **hammasi mos**.

### Shartnomalar va mijozlar
| | Summa |
|---|---|
| Shartnomalar: 20 ta | **1 186 600 000** |
| Mijozlardan kelgan pul (bank orqali, 20 ta to'lov) | **503 900 000** |
| Hali to'lanmagan: 9 ta mijoz | **682 700 000** |

**Ma'nosi:** 11 ta shartnoma to'liq to'langan, 9 tasida qoldiq bor. Excel'da to'lov muddati yo'qligi sababli, qarzning hammasi "muddati belgilanmagan" deb turibdi. "Muddati o'tgan" qarz 0 bo'lib ko'rinadi, lekin bu hech kim kechikmagan degani emas: muddat ma'lumoti yo'q.

### Shartnomasiz tushumlar — kassaga 5 ta, jami 266 550 000
CREDO MOBILE loyihasi 120 000 000 · Курилиш Нурафшон 82 350 000 · PEPITO 48 000 000 · SAMLAZIZBEK TRADE 12 000 000 · Хуршидхужа 4 200 000.

Bular hech qaysi Excel shartnomasiga bog'lanmagan. SAMLAZIZBEK TRADE'ning shartnomasi bor, lekin u bank orqali to'liq to'langan. Kassadagi 12 000 000 esa boshqa raqam bilan yozilgan. **Bu tushumlarning mazmunini aniqlash kerak.**

### Xarajatlar — 151 ta, jami 2 071 605 571
| Modda | Summa |
|---|---|
| Oylik (з/п) | 888 906 858 |
| Marketing | 248 200 000 |
| НДС | 229 306 000 |
| **Kategoriyasiz** (35 ta kassa xarajati) | **164 101 440** |
| ЕСП | 108 079 155 |
| Daromad solig'i (подоходный) | 104 441 495 |
| Ijara | 92 925 840 |
| Foyda solig'i | 68 700 000 |
| Boshqa (прочий) | 66 737 972 |
| Subpudrat | 44 200 000 |
| Advokat | 35 596 000 |
| Korporativ karta | 11 000 000 |
| Internet, bank komissiyasi, ИНПС, chiqindi, didoks | ~9,4 mln |

### Xarajat bo'lmagan chiqimlar
- **Dividendlar:** 12 ta, **352 253 440** (kassadan 9 ta, bankdan 3 ta).
- **Qarz (фин.займ):** 1 ta, **100 000 000**. Berildimi yoki qaytarildimi, Excel'da ko'rsatilmagan.
- **Qaytarimlar (возврат):** 3 ta, **148 800 000**.
- **Bankdan kassaga o'tkazma:** 2 ta, **123 999 960**. Bu faqat pulning joyi o'zgargani.

### Bank va kassa qoldig'i
| | 1-iyul | Iyul harakati | Hozirgi qoldiq |
|---|---|---|---|
| **UTAX BANK** | 1 092 584 868 | kirim 503 900 000, chiqim 2 344 304 091 | **−747 819 223** |
| **Kassa** | 100 368 000 | kirim 390 549 960, chiqim 452 354 880 | **38 563 080** |
| **Jami** | 1 192 952 868 | | **−709 256 143** |

**Bu raqam nimani anglatadi.** Tizim oddiy arifmetika qildi: boshlang'ich qoldiq + kirim − chiqim. Natijada bank minusga chiqdi. Bank hisobi amalda minusga tushmaydi, shuning uchun bu **boshqaruv signali** — lekin tizim qaysi ma'lumot noto'g'ri ekanini aniqlamaydi. Tekshirish kerak bo'lgan variantlar:
- 1-iyuldagi bank qoldig'i kiritilganidan kattaroq bo'lganmi?
- Excel'da ba'zi bank kirimlari yozilmay qolganmi?
- Ba'zi chiqimlar ikki marta yozilganmi yoki boshqa oyga tegishlimi?

**Ma'lum:** iyulda bankdan 2,34 mlrd chiqqan va 504 mln kirgan. **Noma'lum:** qaysi biri to'liq emas.

### P&L — iyul
| Qator | Summa |
|---|---|
| Daromad (tan olingan) | **0** |
| To'g'ridan-to'g'ri xarajatlar (subpudrat) | −44 200 000 |
| Operatsion xarajatlar (oylik, marketing, ofis, IT, boshqa, kategoriyasiz) | −1 516 001 262 |
| Soliqlar | −511 404 310 |
| **Sof natija** | **−2 071 605 571** |

**Daromad nega 0.** Tizim daromadni faqat xizmat bajarilib, akt bilan tasdiqlanganda tan oladi — bu buxgalteriya qoidasi. Excel'da na shartnoma sanasi, na akt bor. Shuning uchun mijozlardan kelgan 503,9 mln **mijoz avansi** bo'lib turibdi. Bu tizim xatosi emas, ma'lumot yetishmasligi.

**Rahbariyat uchun xulosa:** iyul P&L'i hozir faqat xarajat tomonini ko'rsatadi. Real foydani ko'rish uchun bajarilgan xizmatlar va aktlar kiritilishi kerak.

### Cash Flow — iyul
| Oqim | Kirim | Chiqim | Sof |
|---|---|---|---|
| Operatsion | 503 900 000 | 2 071 605 571 | −1 567 705 571 |
| Moliyaviy (dividend) | 0 | 352 253 440 | −352 253 440 |
| Ichki o'tkazma | 123 999 960 | 123 999 960 | 0 |
| **Tasniflanmagan** (shartnomasiz tushum; qarz va qaytarim) | 266 550 000 | 248 800 000 | +17 750 000 |
| **Jami** | 770 450 000 | 2 672 659 011 | −1 902 209 011 |

"Tasniflanmagan" qator katta. Kassadagi shartnomasiz tushumlar, qarz va qaytarimlar mazmuni aniqlangach, ular to'g'ri guruhga o'tadi.

### Balans — 31-iyul holati
- **Aktivlar:** bank −747,8 mln, kassa 38,6 mln.
- **Majburiyatlar:** mijoz avanslari 503,9 mln.
- **Kapital (hisob-kitob natijasi):** −1 213,2 mln.
- **Ma'lumot uchun:** shartnomalar bo'yicha kelajakdagi to'lovlar 682,7 mln. Ular balansga kirmaydi, chunki xizmat hali tan olinmagan.

### Nega kategoriyasiz 35 ta xarajat muhim
Bular kassadan qilingan kundalik chiqimlar: "Чоршанба ош", "Ширинликлар", "Дизайнерга", "Азамат ойлик ва компьютер" va shunga o'xshashlar. Jami **164,1 mln**. Ular P&L'da alohida "Kategoriyasiz" qatorida turibdi. Kategoriya belgilanmaguncha:
- ofis, marketing yoki oylik bo'yicha haqiqiy xarajat to'liq ko'rinmaydi;
- byudjet nazorati va xarajatlar tahlili aniq chiqmaydi.

Kategoriyani Xarajatlar sahifasida mas'ul xodim belgilaydi. Tizim ham kalit so'zlar bo'yicha taklif beradi.

### Ma'lumot sifati tekshiruvi (tizim o'zi topgan)
- 9 ta shartnomada to'lov muddati yo'q.
- 35 ta xarajat kategoriyasiz.
- 20 ta kontragentda INN yo'q. Bu bank to'lovlarini shartnomaga avtomatik bog'lash sifatini pasaytiradi.

---

## 7. Tizimning asosiy jarayonlari

**Shartnomalar.**
- Har shartnomada mijoz, summa va xizmat turi bor.
- Tizim avans va yakuniy to'lov jadvalini yuritadi, to'lovlarga qarab holatni o'zi o'zgartiradi.
- Hozirgi Excel'da sana, muddat va avans foizi yo'q, shuning uchun bu maydonlar bo'sh.

**Mijoz to'lovlari.**
- Bankdan kelgan pul shartnomaga bog'lanadi. Bog'lash shartnoma raqami, INN, summa, nom va sana bo'yicha "ball" hisoblash orqali qilinadi.
- Ishonch yuqori bo'lsa — avtomatik bog'lanadi. O'rtacha bo'lsa — buxgalterga "tasdiqlang" deb taklif qilinadi.

**Debitorlik.**
- Qarz = shartnoma summasi − to'langan summa.
- Muddat kiritilgan bo'lsa, qarz yoshi bo'yicha guruhlanadi: 0–7, 8–15, 16–30, 31–60, 60+ kun. Tizim undirish vazifalari va eslatmalar yaratadi.

**Bank va kassa.**
- Qoldiq = boshlang'ich qoldiq + barcha kirim − barcha chiqim.
- Boshlang'ich qoldiq kiritilmaguncha qoldiq "--" ko'rinadi.
- Noto'g'ri yozuv o'chirilmaydi, **teskari yozuv** bilan bekor qilinadi. Shunda tarix saqlanadi.

**Xarajatlar va tasdiqlash.**
- Xodim xarajat so'rovi yuboradi. So'rov tasdiqlash zanjiridan o'tadi, keyin to'lanadi. Zanjir summaga qarab sozlanadi, masalan: kichik summani bo'lim boshlig'i, katta summani CFO va CEO tasdiqlaydi.
- **Hozirgi holat:** tasdiqlash qoidalari va bo'limlar hali kiritilmagan. Shuning uchun har bir so'rov **faqat CFO tasdig'iga** boradi. Zanjirni rahbariyat sozlamalarda belgilaydi.
- Hech kim o'z so'rovini o'zi tasdiqlay olmaydi, Founder ham.
- AI hech narsani tasdiqlay olmaydi.

**Oylik (payroll).**
- Imkoniyat tizimda bor: oklad + KPI formulasi + tasdiqlash zanjiri.
- **Hozir ishlatilmaydi:** xodimlar ro'yxati va oklad kiritilmagan.

**Byudjet, reja/fakt, prognoz.**
- Imkoniyatlar bor: bo'lim va kategoriya bo'yicha byudjet, oylik reja, 30/90 kunlik prognoz.
- **Hozir reja va byudjet kiritilmagan.** Prognoz faqat mavjud pul harakatlaridan hisoblanadi.

**Audit.**
- Har bir muhim harakat jurnalga yoziladi: kim, qachon, nimani, qaysi kanaldan (web, Telegram, import, AI).
- Jurnaldan yozuv o'chirilmaydi va o'zgartirilmaydi.

**Bildirishnomalar.**
- Quyidagi hodisalarda xabar keladi: tasdiq kutilmoqda, qaror qabul qilindi, katta xarajat, pul kam (kritik), qarz eslatmasi, akt yo'q, ma'lumot sifati muammosi, kunlik hisobot.
- Xabar web'da va Telegram'da ko'rinadi.
- "Jim soatlar" bor, masalan 22:00–08:00. Kritik xabar jim soatda ham keladi.

---

## 8. Kim nimani qila oladi (rollar)

| Rol | Biznes ma'nosi | Asosiy huquqlar |
|---|---|---|
| **FOUNDER** | Kompaniya egasi | Hamma narsa. Founder rolini faqat Founder beradi |
| **CEO** | Bosh direktor | Hammasini ko'radi. Xarajat, daromad va oylikni tasdiqlaydi |
| **CFO** | Moliya direktori | Moliyaviy yozuvlarni kiritadi, o'zgartiradi, tasdiqlaydi. Sozlamalarni o'zgartiradi. AI takliflarini tasdiqlaydi |
| **FINANCE_MANAGER** | Moliya menejeri | Moliyaviy yozuvlarni kiritadi. Bog'lash va xarajatlarni tasdiqlaydi |
| **ACCOUNTANT** | Buxgalter | Tranzaksiya, xarajat, oylik kiritadi. Bank bog'lashni tasdiqlaydi |
| **SALES** | Sotuvchi | Shartnoma kiritadi. O'z mijozlarining qarzini ko'radi, undirish vazifalarini yuritadi |
| **DEPARTMENT_HEAD** | Bo'lim boshlig'i | O'z bo'limi xarajatlari va oyligini tasdiqlaydi |
| **EMPLOYEE** | Xodim | O'z xarajat so'rovlarini yuboradi va kuzatadi |
| **AUDITOR** | Tashqi auditor | Hammasini faqat ko'radi va eksport qiladi |
| **ADMIN** | Tizim administratori | Foydalanuvchilar, sozlamalar, integratsiyalar. **Moliyaviy ma'lumotga kirmaydi** |
| **AI_AGENT** | Avtomatik yordamchi | Asosan ko'radi va taklif beradi |

Huquqlar jadvalini Founder sozlamalardan o'zgartira oladi.

---

## 9. Telegram botlar

| Bot | Kim ishlatadi | Nima uchun | Nima qila oladi |
|---|---|---|---|
| **@utax_rahbar_bot** | Founder, CEO, CFO, Admin | Kompaniya holatini tez ko'rish | Holat, pul, foyda, pul oqimi, balans, reja/fakt, prognoz, debitorlik, Excel hisobot. Tasdiqlash, AI takliflarini qabul yoki rad qilish. Xodimni bloklash (favqulodda) |
| **@utax_buxgalter_bot** | Founder, CFO, moliya menejeri, buxgalter | Kundalik buxgalteriya | Bank ko'chirmasini yuklash, to'lovni shartnomaga bog'lash, kassa yozuvi, xarajatni "to'landi" qilish, akt, oylik, byudjet. Ish kunlari 17:00 da ko'chirma yuklanmagan bo'lsa eslatma |
| **@utax_sorov_bot** | Barcha xodimlar | So'rov va shaxsiy ma'lumot | Xarajat so'rovi yuborish (chek bilan), holatini kuzatish. O'z shartnomalari, qarzdorlari, vazifalari, oyligi, KPI |
| **@utax_signal_bot** | Hamma | Bildirishnomalar | Bugungi va o'qilmagan xabarlar, tarix. ✅/❌ tugmalar bilan tasdiqlash. Xabar turlarini va jim soatlarni sozlash |

**Xavfsizlik:**
- Botdan faqat web panelda o'z akkauntini bog'lagan xodim foydalanadi (Profil → Telegram botlar, bir martalik kod).
- Har kim faqat o'z roliga ruxsat berilgan narsani ko'radi — web bilan bir xil qoidalar.

⚠️ **Hozirgi holat:** buxgalter, sorov va signal botlari ishlayapti. **@utax_rahbar_bot ishlamayapti:** Telegram uning tokenini qabul qilmayapti. Botlar egasidan yangi token kerak.

---

## 10. AI agentlar — nima qiladi va nima qilmaydi

Tizimda **14 ta agent** bor. Ular **belgilangan qoidalar asosida** ishlaydi (sun'iy intellekt modeli emas) va jadval bo'yicha avtomatik ishga tushadi.

| Agent | Nimani kuzatadi |
|---|---|
| **CFO** | Har kuni ertalab Founder, CEO va CFO'ga qisqa hisobot: pul, qarz, kutilayotgan tasdiqlar, ma'lumot sifati |
| **BANK** | Ulangan bank, 1C yoki Google Sheets'dan yangi tranzaksiyalarni oladi. **Hozir birorta ham ulanish yo'q** |
| **RECONCILIATION** | Bog'lanmagan bank to'lovlarini topadi va shartnomaga bog'lashni taklif qiladi |
| **REVENUE** | Akt yo'q shartnomalarni eslatadi. Daromad tan olishni tasdiqqa yuboradi |
| **EXPENSE** | Kategoriyasiz xarajatlarga kategoriya taklif qiladi. Ishonch yuqori bo'lsa o'zi belgilaydi |
| **APPROVAL** | Uzoq kutib qolgan tasdiqlarni eslatadi |
| **CASH_FLOW** | Pul kamayib ketsa va yaqin 7 kunda xavf bo'lsa ogohlantiradi |
| **RECEIVABLE** | Mijozlar qarzi haqida xabar beradi |
| **COLLECTION** | Qarz undirish vazifalarini yaratadi |
| **PAYROLL** | Oylik hisoblanmagan yoki kechikkan bo'lsa eslatadi |
| **FORECAST** | 30 va 90 kunlik pul prognozini hisoblaydi va xavfni bildiradi |
| **FINANCIAL_ANALYST** | Foyda nega o'zgarganini tahlil qiladi. **Faqat qo'lda ishga tushiriladi** |
| **DATA_QUALITY** | Yetishmayotgan yoki mos kelmagan ma'lumotni topadi |
| **AUDIT_ANOMALY** | G'ayrioddiy katta summalar, takroriy to'lovlar va byudjetdan oshishni belgilaydi |

**AI nima qila olmaydi:**
- Hech qanday xarajat, to'lov yoki oylikni **tasdiqlay olmaydi**.
- Daromadni o'zi tan olmaydi: har doim inson tasdig'iga yuboradi.
- Agentlarning takliflari rahbar yoki CFO tasdiqlagandan keyingina bajariladi.

**AI chat (savol-javob):**
- Web'da va botlarda "Pul qancha?", "Kim qarzdor?" kabi savollarga javob beradi.
- Faqat foydalanuvchining roli ruxsat bergan ma'lumotni ishlatadi.
- Tashqi AI xizmatiga (Gemini, Groq) yuborishdan oldin mijoz va xodim nomlari, INN, telefon, hisob raqamlari **yashiriladi**.
- AI xizmati ulanmagan bo'lsa, oddiy qoidalar bilan javob beradi.

---

## 11. Xavfsizlik — rahbariyat bilishi kerak bo'lganlar

- **Kirish:** email va parol. Ixtiyoriy ravishda telefon ilovasidan kod bilan ikki bosqichli himoya (2FA).
- **Rollar:** har kim faqat o'z ishiga tegishli ma'lumotni ko'radi.
- **Audit jurnali:** har bir harakat qayd etiladi, o'chirilmaydi.
- **Shifrlangan ma'lumot seyfi:** kompaniya bazasi jamoa uchun GitHub'da faqat **shifrlangan** holda saqlanadi. Kalit alohida beriladi.
- **Maxfiy narsalar:** bot tokenlari, parollar va seyf kaliti **hech qachon chatga, guruhga yoki umumiy joyga tashlanmaydi**. Token tarqalsa, begona odam botni boshqarishi mumkin.

---

## 12. Integratsiyalar holati

| Integratsiya | Holat |
|---|---|
| **Excel moliya jurnali** | **ISHLAYAPTI** — hozirgi yagona manba |
| Bank ko'chirmasi (Excel/CSV) | **TAYYOR** — yuklash imkoniyati bor, hali ishlatilmagan |
| Bank API | **TAYYOR, LEKIN ULANMAGAN** — bank kaliti kerak |
| 1C:Бухгалтерия | **TAYYOR, LEKIN ULANMAGAN** — 1C manzili va login kerak |
| Google Sheets | **TAYYOR, LEKIN ULANMAGAN** |
| Email (SMTP) | **TAYYOR, LEKIN ULANMAGAN** — pochta sozlamasi kerak |
| Tashqi tizimdan push (webhook) | **TAYYOR, LEKIN ULANMAGAN** |
| Telegram | **QISMAN** — 3 ta bot ishlayapti, rahbar boti tokeni kerak |

---

## 13. Holat xulosasi

### Hozir ishlayapti
- Web panel va barcha hisobotlar: Dashboard, pul, debitorlik, P&L, Cash Flow, balans.
- Iyul Excel'i to'liq yuklangan, yig'indilar tekshirilgan.
- Bank va kassa qoldiqlari hisoblanmoqda.
- Buxgalter, sorov va signal botlari.
- AI agentlar jadval bo'yicha ishlayapti. Audit jurnali yuritilmoqda.

### Qisman ishlayapti / sozlash kerak
- @utax_rahbar_bot — yangi token kerak.
- AI chat — tashqi AI kalitlari sozlanganda to'liq ishlaydi.

### Hali ulanmagan
- Bank API, 1C, Google Sheets, Email, webhook.

### Biznes ma'lumoti kerak
- Shartnoma sanalari, to'lov muddatlari va bajarilgan xizmat aktlari.
- 35 ta kassa xarajatining kategoriyasi.
- Shartnomasiz 5 ta kassa tushumining mazmuni (266,55 mln).
- Qarz (100 mln) va qaytarimlar (148,8 mln) tafsiloti.
- Kontragentlar INN'i.
- Xodimlar ro'yxati va okladlar (oylik moduli uchun).
- Bo'limlar va tasdiqlash qoidalari (kim qaysi summani tasdiqlaydi).
- Oylik reja va byudjet.
- Xavfsizlik rezervi va "pul kam" chegarasi. Hozir 0 turibdi, rahbariyat belgilaydi.

### Rahbariyat qarori kerak
- Bank qoldig'i minus: 1-iyul qoldig'i to'g'rimi yoki Excel to'liq emasmi?
- Dividendlar kassadan qilinganmi — hisobda shunday qoladimi?
- Kim qaysi rolda ishlaydi: foydalanuvchilarni yaratish.
- Tizim qayerda doimiy ishlaydi (Mac mini, server yoki bulut)?

---

## 14. Ochiq savollar

**Biznes savollari**
1. Bankdan chiqqan 2,34 mlrd va kirgan 504 mln — iyul uchun to'liqmi?
2. CREDO MOBILE (120 mln), Курилиш Нурафшон (82,35 mln), PEPITO (48 mln) — bu qanday tushumlar?
3. фин.займ 100 mln — qarz berildimi yoki qaytarildimi, kimga?
4. Qaytarimlar (60 mln, 76 mln, 12,8 mln) — qaysi mijozlarga, qaysi shartnomalar bo'yicha?

**Ma'lumot savollari**
1. 20 ta shartnomaning sanasi va to'lov muddati qachon?
2. Qaysi shartnomalar bo'yicha xizmat bajarilgan va akt bor?
3. НДС, ЕСП, ИНПС, подоходный — soliq sifatidami yoki oylik xarajati sifatida ko'rsatilsin?

**Boshqaruv qarorlari**
1. Rahbar boti uchun yangi token kim beradi va botlar qayerda ishlaydi?
2. Qaysi integratsiya birinchi ulanadi: bank, 1C yoki Google Sheets?

## 15. Keyingi amallar (moliya uchun)
1. Direktor bilan bank qoldig'i va iyul bank kirimlarini solishtirish.
2. Shartnomalar bo'yicha sana, muddat va aktlarni yig'ish — shunda daromad va muddati o'tgan qarz ko'rinadi.
3. 35 ta kassa xarajatiga kategoriya belgilash.
4. Shartnomasiz tushumlar, qarz va qaytarimlarning mazmunini yozib berish.
5. Foydalanuvchilarni rollar bo'yicha yaratish (CEO, CFO, buxgalter…) va botlarga bog'lash.
6. Keyingi oy Excel'ini web orqali yuklash — tizim takroriy yozuvlarni o'zi o'tkazib yuboradi.
