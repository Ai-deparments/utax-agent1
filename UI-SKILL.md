---
name: utax-finance-ui
description: UTAX Finance CRM uchun yagona UI manbai. Loyihadagi har qanday sahifa, komponent, jadval, grafik yoki stilni yaratishdan yoki o'zgartirishdan oldin o'qing. Unda vizual DNA, tokenlar, app shell, komponent API'lari, sahifama-sahifa naqshlar, UI qaror qabul qilish qoidalari, responsiv tizim, izchillik auditi va yangi sahifalar uchun qoidalar bor.
---

# UTAX Finance — UI SKILL (UI Source of Truth)

> Bu fayl loyiha UI'sining **yagona manbai**. Agent faqat shu faylni o'qib, loyiha qanday ko'rinishini, yangi sahifa qanday qurilishini va qaysi naqshni ishlatish kerakligini tushuna olishi kerak.
> Kod fayllariga havolalar `public/…` ko'rinishida beriladi. Qator raqamlari 2026-09-21 holatiga to'g'ri. Kod o'zgargan bo'lsa, funksiya nomi bo'yicha qidiring.
> Ma'lumot qoidasi alohida: [CLAUDE.md](CLAUDE.md). UI hech qachon o'ylab topilgan raqam yoki namuna ma'lumot ko'rsatmaydi.

---

## 0. Tezkor xarita

| Nima | Qayerda |
|---|---|
| HTML kirish nuqtasi | `public/index.html` (faqat `#root`; aktivlarni server `/v/<build>/` bilan beradi) |
| Dizayn tokenlari va barcha CSS | `public/css/app.css` (bitta fayl, `:root` tokenlari 4–23-qatorlarda) |
| App shell, NAV, router, login, qidiruv | `public/js/app.js` |
| Barcha umumiy komponentlar | `public/js/ui.js` |
| Grafiklar (qo'lda yozilgan SVG) | `public/js/charts.js` |
| Ikonlar (inline SVG, 58 ta) | `public/js/icons.js` |
| API klienti | `public/js/api.js` (`get/post/put/patch/qs/downloadXlsx`) |
| Sahifalar (har biri alohida modul) | `public/js/pages/<route>.js` (19 ta) |

**Stack:** vanilla JS ES modullari, framework yo'q, build bosqichi yo'q, Tailwind yo'q, tashqi UI kutubxonasi yo'q. DOM `h()` yordamchisi bilan quriladi. Faqat yorug' tema. Butun UI matni **o'zbekcha (lotin)**.

---

## 1. Dizayn falsafasi (Design DNA)

UTAX Finance bu **tinch, yorug', ma'lumotga zich moliya ish maydoni**. Asosiy vazifa rahbarga "bankdagi pul ≠ daromad ≠ ishlatish mumkin pul" farqini bir qarashda ko'rsatish.

1. **Yorug' va toza.** Kulrang-ko'kish fon (`--bg #f4f6f9`), oq kartalar va yupqa `#e6eaf0` chegaralar. Qorong'i tema **yo'q va qo'shilmaydi**.
2. **Bitta asosiy rang: zumrad (emerald).** `--primary #059669` va mint foni `--primary-bg #ecfdf5`. Asosiy harakat, faol navigatsiya, fokus va "ijobiy natija" shu rangda. Boshqa ranglar faqat **holat** (good/warn/crit/info) yoki **grafik seriyasi** uchun.
3. **Raqam birinchi o'rinda.** KPI qiymatlari katta (17–20px, 700), `tabular-nums` bilan, "so'm" birligi kichik va xira. Summa har doim `fmt()` bilan: bo'shliq bilan guruhlangan, kasrsiz.
4. **Zichlik o'rtacha-yuqori.** Asosiy matn 13.5px, jadval 12.5px, sarlavhalar 650 og'irlikda. Katta bo'sh maydonlar va "hero" bannerlar yo'q.
5. **Kartalar yumshoq va tekis.** Radius 12px, juda yengil soya, gradient va bezak deyarli yo'q. Istisno: `accent` KPI karta oqdan mintga gradientga ega.
6. **Ierarxiya rang bilan emas, og'irlik va o'lcham bilan quriladi.** Sarlavha → 650; ikkinchi darajali ma'lumot → `muted` (#6b7a8f) va kichikroq o'lcham; kritik ma'lumot → `crit` rangi va chegarasi.
7. **Ikonlar chiziqli.** 24×24 viewBox, `stroke-width 1.75`, `currentColor`. To'ldirilgan (filled) ikonlar yo'q. KPI kartadagi ikon rangli "tile" (yumshoq fonli kvadrat) ichida turadi.
8. **Harakatlar sokin.** Animatsiya deyarli yo'q. Faqat 3 ta transition bor: sidebar slide, filedrop va link-karta hover.
9. **Har bir raqam manbaga bog'lanadi.** KPI karta yoki qator bosilsa, batafsil sahifa, drawer yoki shartnoma ochiladi.

---

## 2. Dizayn tokenlari (`public/css/app.css:4-23`)

### 2.1 Ranglar

| Guruh | Token | Qiymat | Qo'llanishi |
|---|---|---|---|
| Fon | `--bg` | `#f4f6f9` | sahifa foni, drawer tanasi |
| Sirt | `--surface` | `#ffffff` | karta, sidebar, topbar, input, modal |
| | `--surface-2` | `#f8fafc` | hover, jadval `th`, stat-tile, modal footer |
| | `--surface-3` | `#f1f5f9` | default tile va badge, progress izi, ghost hover |
| Chiziq | `--border` | `#e6eaf0` | barcha 1px bo'luvchilar |
| | `--border-strong` | `#cfd6df` | `.btn`, `.input`, `.chip`, `.seg` |
| | `--grid` / `--axis` | `#eef2f6` / `#cbd5e1` | grafik to'r va o'q chiziqlari |
| Matn | `--text` | `#0f1b2d` | asosiy matn, sarlavhalar |
| | `--text-2` | `#3b4a5e` | nav, label, tab, ghost tugma |
| | `--muted` | `#6b7a8f` | sub-matn, `th`, grafik matni |
| | `--muted-2` | `#94a3b8` | empty-state ikoni, formula operatorlari |
| Asosiy | `--primary` | `#059669` | `.btn.pri`, fokus, faol nav chizig'i |
| | `--primary-dark` | `#047857` | havola, faol nav matni, accent qiymat |
| | `--primary-bg` | `#ecfdf5` | faol nav foni, `.btn.soft`, `.chip.active`, `.alert.mint` |
| | `--primary-bg-2` | `#d1fae5` | `.tile.green`, avatar, brand belgisi |
| | `--primary-ring` | `rgba(5,150,105,.18)` | 3px fokus halqasi |
| Holat | `--good` `--good-bg` `--good-text` | `#16a34a` `#dcfce7` `#166534` | muvaffaqiyat, `.pos` |
| | `--warn` … | `#d97706` `#fef3c7` `#92400e` | ogohlantirish, `.warnc` |
| | `--crit` … | `#dc2626` `#fee2e2` `#991b1b` | xato, muddati o'tgan, `.neg` |
| | `--info` … | `#2563eb` `#dbeafe` `#1e40af` | ma'lumot |
| Qo'shimcha | `--violet*` `--orange*` `--teal*` | — | faqat `.tile` va `.badge` tonlari |
| Grafik | `--s1…--s8` | `#059669 #ea580c #2563eb #b45309 #7c3aed #0891b2 #db2777 #92400e` | seriyalar **shu tartibda** (`charts.js:3`) |

**Qoida:** yangi rang qo'shilmaydi. Hex qiymat yozish o'rniga har doim `var(--…)` ishlatiladi. Dataga bog'liq rang faqat bitta joyda ruxsat: `service_types.color` (xizmat badge'i).

### 2.2 Tipografiya

- **Shrift:** `--font` = system stack (`-apple-system, Segoe UI, Inter, Roboto…`). Veb-shrift yuklanmaydi.
- **Asosiy o'lcham:** body 13.5px / 1.45.
- **Shkala.** Faqat shu qiymatlar ishlatiladi:

| Rol | O'lcham / og'irlik | Misol |
|---|---|---|
| Sahifa sarlavhasi | 21px / 650, `-.01em` | `.page-head h1` |
| Karta sarlavhasi | 14.5px / 650 | `.card-h h3` |
| Drawer sarlavhasi | 15px / 650 | `.drawer .dh h2` |
| KPI qiymati | 20px / 700 (`.sm` → 17px). Uzun bo'lsa `.lg` 18px, `.xl` 16px | `.kpi-card .vl` |
| Asosiy matn | 13–13.5px | body, `.btn`, `.input`, `.kv`, `.alert` |
| Jadval | 12.5px; `th` 10.5px UPPERCASE `.05em` | `table.tbl` |
| Sub-matn | 12–12.5px `muted` | `.page-head .sub`, `.small` |
| Mikro-label | 11px (`.xs`), UPPERCASE bo'lishi mumkin | `.sec-title`, `tr.sec` |

- **Og'irliklar:** 500 (nav, `dd`), 600 (tugma, label, tab), **650** (loyihaning "semi-bold"i: sarlavha, badge, `th`, `.bold`), 700 (KPI qiymati, jami qatorlar).
- **Raqamlar:** `.tnum` / `td.right` → `tabular-nums`. Pul ustunlari har doim o'ngga tekislanadi.

### 2.3 Radius

| Qiymat | Qo'llanishi |
|---|---|
| 12px (`--radius`) | karta, KPI karta, chat xabari, toolbar yuqori burchaklari |
| 14px | modal. Bu ataylab qilingan istisno |
| 10px | `.tile`, `.stat-tile`, menyu, qidiruv natijalari, filedrop |
| 8px (`--radius-s`) | tugma, input, select, nav link, seg, step, tooltip |
| 999px | badge. Chip 16px, userchip 22px |

**Kanonik qoida:** yuza → 12, boshqaruv elementi → 8, tile → 10, pill → 999. Yangi kodda 7, 9 yoki 14 kabi yangi qiymatlar ishlatilmaydi.

### 2.4 Soya, qatlam, harakat

- `--shadow` faqat karta va KPI karta uchun (juda yengil). `--shadow-lg` modal, drawer, menyu, toast, tooltip va mobil sidebar uchun.
- **z-index:** tooltip 5 · topbar 20 · menyu/qidiruv/overlay 30 · mobil sidebar 40 · modal-bg/drawer-bg 50 · drawer 51 · toast 100.
- **Transition:** faqat `.15s` (filedrop, link-karta) va `.2s` (sidebar). Tugmalar holatni bir zumda almashtiradi.

### 2.5 Spacing tizimi

Loyiha 2px qadamli kichik shkalaga asoslangan: **4 · 6 · 8 · 10 · 12 · 14 · 16 · 18/20 · 24**.

| Kontekst | Qiymat |
|---|---|
| Kartalar va KPI'lar orasidagi gap (`.grid`, `.kpis`) | **14px** |
| Sahifa bo'limlari orasida (vertikal) | **16px** (`mb16`) |
| Chip qatori va jadval orasida | 12px (`mb12`) |
| Tugmalar va header harakatlari orasida | 8px |
| Karta header / tana paddingi | 12px 16px / 14px 16px |
| Sahifa paddingi (`main.content`) | 18px 22px 48px; ≤1024px da 14px 14px 48px |
| Modal | header 14px 20px · tana 18px 20px · footer 12px 20px |
| Jadval yacheykasi | `th` 9px 12px · `td` 8px 12px |

**Utility'lar:** `.mt4/8/12/16/24`, `.mb8/12/16`, `.gap6/8/12`, `.flex`, `.wrap`, `.grow`, `.between`, `.col`, `.right`, `.center`, `.nowrap`, `.muted`, `.small`, `.xs`, `.bold`, `.tnum`, `.pos`, `.neg`, `.warnc`, `.no-print`.

---

## 3. App shell va routing (`public/js/app.js`)

### 3.1 Tuzilma

```
#app  (grid: 232px | 1fr ; rows: 56px | 1fr)
├─ aside.sidebar      brand (logo "X" + "UTAX Finance / Moliya boshqaruv tizimi")
│                     nav.nav → 19 ta link (ikon 18 + label + qizil badge-n)
│                     .foot ("UTAX Finance · v1.0.0")
├─ header.topbar      ☰ (faqat ≤1024px) · global qidiruv · bell (+dot) · userchip → menyu
└─ main.content       .page-head (h1 + .sub | .acts) + sahifa tanasi
```

- **Sidebar:** `sticky`, 100dvh. `.nav` o'zi scroll bo'ladi. Faol link mint fonda, `primary-dark` matn va chap tomonda 3px zumrad chiziq bilan.
- **Global qidiruv:** 2+ belgi, 250ms debounce. Shartnoma, kontragent va tranzaksiya bo'yicha, har guruhda 5 tadan natija.
- **Userchip menyusi:** email, "Profil, 2FA, Telegram" (`#/settings/profile`) va "Chiqish".
- **Badge polling:** har 60 soniyada bell nuqtasi va nav'dagi `badge-n` (tasdiqlash, bildirishnoma) yangilanadi.

### 3.2 NAV (yagona ro'yxat, guruhsiz). `app.js:4-9`

Format: `[route, label, permission, icon]`. Permission har doim route nomiga teng.

| # | Route | Label | Ikon |
|---|---|---|---|
| 1 | `dashboard` | Bosh sahifa | home |
| 2 | `treasury` | Pul boshqaruvi | wallet |
| 3 | `contracts` | Shartnomalar | contract |
| 4 | `transactions` | Tushumlar | inflow |
| 5 | `receivables` | Debitorlik | users |
| 6 | `expenses` | Xarajatlar | receipt |
| 7 | `pnl` | Foyda va zarar | trend |
| 8 | `cashflow` | Pul oqimi | activity |
| 9 | `balance` | Balans | scale |
| 10 | `planfact` | Reja / Fakt | target |
| 11 | `forecast` | Prognoz | lineChart |
| 12 | `payroll` | KPI va oylik | award |
| 13 | `ai` | AI moliya | sparkles |
| 14 | `reports` | Hisobotlar | barChart |
| 15 | `integrations` | Integratsiyalar | plug |
| 16 | `approvals` | Tasdiqlashlar | checkSquare |
| 17 | `notifications` | Bildirishnomalar | bell |
| 18 | `audit` | Audit jurnali | shield |
| 19 | `settings` | Sozlamalar | settings |

**Yangi sahifa qo'shish:** NAV'ga bitta qator, `public/js/pages/<route>.js` fayl va backend'da shu nomdagi RBAC resursi. Tartib moliya oqimiga mos: pul → shartnoma → tushum → qarz → xarajat → hisobotlar → boshqaruv → tizim.

### 3.3 Router (`app.js:99-129`)

- Hash format: `#/page/param1/param2?key=val`. `params = parts.slice(1)`, `query` esa obyekt.
- Ruxsat yo'q yoki sahifa topilmasa: `.empty-state`, ikon `alert` va "Sahifa topilmadi yoki ruxsat yo'q".
- **Birinchi yuklash:** `.page-head` (NAV label bilan) + `.empty-state` "Yuklanmoqda…".
- **Xato:** `alert.crit` "Sahifa xatosi: …". Modul mos kelmasa (eski build), sahifa bir marta avtomatik qayta yuklanadi.
- **Sahifa moduli shartnomasi:**

```js
export default async function render(root, { setTitle, setActions, params, query, me, can, navigate, roleLabel }) {
  setTitle('Sarlavha', 'Qisqa tavsif · kontekst', [/* header harakatlari */]);
  root.append(/* sahifa tanasi */);
}
```

- `setTitle(t, sub, actions?)` h1 va `.sub` ni o'rnatadi, `document.title` ni esa `"t — UTAX Finance"` qiladi. `actions` berilsagina `.acts` almashtiriladi.
- `can(resource, action='VIEW')`. Harakatlar: `VIEW CREATE EDIT APPROVE REJECT DELETE EXPORT`.

### 3.4 Login (`app.js:22-42`)

Markazda `form.card.box` (400px) turadi, fon esa ikki mint radial gradient. Ichida brand bloki, email, parol, kerak bo'lsa 2FA kodi va to'liq kenglikdagi `btn pri`. Xato matni `.small.neg`.

---

### 3.5 PWA (o'rnatiladigan ilova)

| Fayl | Vazifa |
|---|---|
| `public/manifest.webmanifest` | nom, `start_url /#/dashboard`, `display: standalone`, `theme_color #059669`, `background_color #f4f6f9`, ikonlar, 4 ta shortcut |
| `public/sw.js` | service worker. `/api/*` va GET bo'lmagan so'rovlar **keshlanmaydi**; `/v/<build>/` aktivlari cache-first (eski build o'chiriladi); sahifa network-first + oflayn sahifa |
| `public/js/pwa.js` | `registerSW()` (HTTPS yoki localhost, iframe'dan tashqarida), `installMenuItem()` (userchip menyusida "Ilovani o'rnatish"), iOS/macOS Safari uchun qo'lda ko'rsatma modali, oflayn/onlayn toast |
| `public/icons/*` | `scripts/gen-icons.mjs` bilan yaratiladi (zumrad fon + oq "X"). Ikon o'zgarsa skriptni qayta ishga tushiring |

**Qoidalar:**
- Yangi statik fayl turi qo'shilsa, `sw.js` dagi strategiyaga mosligini tekshiring. API javobi hech qachon SW keshiga tushmaydi.
- `sw.js` o'zgarsa, `SHELL`/`ASSETS` kesh nomidagi versiyani oshiring.
- Standalone rejimda brauzer paneli yo'q, shuning uchun har bir sahifaga ichki navigatsiya orqali kirish mumkin bo'lishi kerak.

## 4. Komponent tizimi (`public/js/ui.js`)

> **Qoida:** yangi UI yozishdan oldin shu bo'limdagi komponentni ishlating. Yangi komponent faqat bu yerda yo'q bo'lsa yaratiladi. U `ui.js` ga qo'shiladi, stili esa `app.css` ga.

### 4.1 DOM va formatlash

| API | Vazifa |
|---|---|
| `h(tag, attrs, ...children)` | DOM yaratish. `class`, `style{}`, `onClick`, `dataset`, `html` qo'llaydi. `false`, `null` bolalar tashlab yuboriladi |
| `icon(name, size=18)` | chiziqli SVG ikon |
| `fmt(n)` | `1 234 567` (null bo'lsa `—`) |
| `money(n)` | `1 234 567 so'm` |
| `short(n)` | `1.2 mln`, `3.45 mlrd`, `12 ming` |
| `date(iso)` | `21.09.2026` |
| `dt(iso)` | `21.09.26, 14:05` |
| `pct(n)` | `12.3%` |
| `monthLabel('2026-07')` | `Iyul 26` |
| `rangeLabel({from,to})` | `01.07.2026 — 31.07.2026` yoki `Barcha davr` |

### 4.2 Holat va indikatorlar

- **`badge(status, label?)`**: pill badge. Holat kodi `STATUS` xaritasi orqali tarjima qilinadi va rang oladi (`ui.js:30-39`):
  - **good (yashil):** PAID, COMPLETED, MATCHED, APPROVED, RECOGNIZED, DONE, OK, INCOME…
  - **warn (sariq):** PENDING, SUGGESTED, EXPECTED, OPEN, PROPOSED, WARNING, MEDIUM, LOW…
  - **crit (qizil):** OVERDUE, UNMATCHED, REJECTED, FAILED, CRITICAL, HIGH, LOSS, EXPENSE…
  - **info (ko'k):** ACTIVE, IN_PROGRESS, PARTIAL, SUBMITTED, RUNNING…
  - **neytral:** DRAFT, CLOSED, CANCELLED, IGNORED, POSTPONED, EMPTY…
  - Yangi holat kodi qo'shilsa, avval `STATUS` ga yozing. Sahifada qo'lda badge rangi berilmaydi.
- **`statusLabel(code)`**: faqat o'zbekcha nom.
- **`progress(p)`**: 7px progress + foiz; 100% da yashil.
- **`confBar(c)`**: bog'lash ishonchliligi. ≥95 good, ≥60 warn, qolgani crit.
- **`delta(p, {invert})`**: ↑/↓ + foiz. Xarajat kabi "kamayishi yaxshi" ko'rsatkichlar uchun `invert:true`.
- **`alert(kind, text, icon?)`**: `warn | crit | info | good | mint` turlari. `mint` loyihaga xos: formulalar, xavfsizlik qoidalari va tushuntirishlar uchun.
- **`emptyState(title, sub, icon)`**: markazlangan, xira ikon (28px) va qalin sarlavha.

### 4.3 Kartalar

**`card(title, body, actions[], {tight, sub})`** loyihaning asosiy konteyneri.

```
.card
 ├─ .card-h   h3 (14.5/650) + span.sub (11.5 muted) … [harakatlar o'ngda]
 └─ .card-b   14px 16px   (tight → 0; jadval/ro'yxat uchun)
```

- Tanada xom `<table>` bo'lsa, u avtomatik `.tbl-wrap` ga o'raladi.
- `sub` kontekstni beradi: davr, "joriy oy", "N ta" yoki "inson tasdiqlaydi".
- Jadval va ro'yxat kartalari `tight:true` bo'ladi.

**`kpiCard({...})`** eng ko'p ishlatiladigan komponent (~80 chaqiruv).

```js
kpiCard({ icon, tone, label, value, unit, delta, deltaLabel, invert, spark, accent, sub, size: ''|'sm', cls: ''|'warn'|'crit', href })
```

- **Anatomiya:** rangli `.tile` (38px, `sm` da 34px) + label (12px muted, 2 qatorgacha) + qiymat (20/700 + kichik "so'm"). Pastda `delta` va `deltaLabel`, **yoki** `sub`. Ixtiyoriy sparkline (44px) ham bo'lishi mumkin.
- **Tonlar:** `green blue orange red violet amber teal gray`.
- **Qiymat turi:**
  - `number` berilsa, avtomatik `fmt` va "so'm" qo'shiladi.
  - Son "so'm" emas (masalan "12 ta", "30 kun") bo'lsa, **string** beriladi.
  - Holat ko'rsatilsa, `badge(...)` elementi beriladi.
- `accent:true` bitta KPI qatorida faqat **bitta** kartaga beriladi. U "eng muhim natija" uchun: "Ishlatish mumkin pul", "Sof foyda", "To'lanadigan".
- `href` berilsa, karta `<a>` ga aylanadi. Hover'da zumrad chegara paydo bo'ladi va karta 1px ko'tariladi. KPI ma'lumotining manba sahifasi bo'lsa, `href` qo'yiladi.

**`statTile({icon, tone, label, value, delta, href})`**: kichik ko'rsatkich plitasi (`surface-2` fonda). Faqat `.stat-tiles` (2 ustun) ichida ishlatiladi.

**`kv(pairs)`**: "kalit → qiymat" ro'yxati (`dl.kv`, 190px + 1fr; ≤640px da 1 ustun). Drawer va batafsil kartalarda ishlatiladi. Falsy juftlar tashlab yuboriladi, null esa `—` ko'rinishida chiqadi.

### 4.4 Jadval: `dataTable`

```js
const t = dataTable({
  columns: [{ key, label, money, date, datetime, badge, pct, progress, right, nowrap, width, render(row, v), exportValue(row) }],
  rows, onRow, search = true, pageSize = 25,
  filters: [{ key, label, options }],      // toolbar select'lari (client-side)
  exportName, emptyText = "Ma'lumot yo'q", footer(rows, cols), toolbarExtra, hideToolbar,
  dateKey,                                 // toolbar'ga sana oralig'i + ✕ tozalash tugmasini qo'shadi
  onFilter(rows),                          // har filtrlashdan keyin KO'RINAYOTGAN qatorlar
  onDateChange(from, to),                  // berilsa: lokal filtrlamaydi, sahifa serverdan qayta so'raydi
});
root.append(card('Sarlavha', t.el, null, { tight: true })); t.setRows(rows);
```

- **Toolbar:** qidiruv ("Qidirish…"), filtr select'lari, [sana + ✕], bo'sh joy, "Ustunlar", "Excel", "PDF".
- **Jadval ustidagi KPI'lar filtrga ergashishi shart.** Aks holda foydalanuvchi sana tanlaydi, ro'yxat o'zgaradi, kartalar esa eski raqamda qoladi — bu xato deb qabul qilinadi.
  - KPI'lar qatorlardan hisoblansa → `onFilter` (masalan shartnomalar).
  - KPI'lar serverdan kelsa → `onDateChange` bilan sahifa `load()` ni qayta chaqiradi (masalan tushumlar, xarajatlar).
- Excel faqat ko'rinayotgan ustun va filtrlangan qatorlarni o'zbekcha sarlavhalar bilan eksport qiladi.
- **Sarlavhalar:** bosilganda ▲/▼ bilan tartiblanadi. `th` sticky.
- **Qatorlar:** `tr.row` hover'da `surface-2` bo'ladi. `onRow` berilsa, `tr.click` (pointer) qo'shiladi.
- **Pager:** "N ta yozuv · ‹ p / n ›", sahifada 25 tadan.
- **Pul ustuni:** `money:true`. Bu o'ngga tekislash, `tnum` va manfiyda qizil rangni beradi.

**Xom `table.tbl`** faqat quyidagilar uchun ruxsat etiladi:

1. **Moliyaviy hisobot jadvallari.** Bular P&L, pul oqimi, balans va rezerv tarkibi. Qator klasslari:
   - `tr.sec`: bo'lim sarlavhasi (UPPERCASE 11px, `surface-2`)
   - `tr.sub`: 24px chekinish
   - `tr.total`: 700, `surface-2`
   - Raqam yacheykasi `td.right.tnum`. Manfiy qiymat `.neg`.
2. Drawer ichidagi kichik (≤10 qator) jadvallar.
3. Tahrirlanadigan matritsa yoki jadval (rollar matritsasi, tasdiqlash qoidalari).
4. Import oldindan ko'rish jadvali.

Xom jadval har doim `.tbl-wrap` ichida bo'ladi. `card()` buni avtomatik qiladi, boshqa joyda qo'lda o'rang. Bo'sh holat uchun `td.empty` qatori kerak va unga ustunlar soniga teng `colspan` beriladi.

### 4.5 Formalar

```js
formModal({ title, size: ''|'sm'|'lg', submitLabel = 'Saqlash', values,
  fields: [{ name, label, type: 'text'|'number'|'date'|'month'|'email'|'password'|'select'|'textarea'|'checkbox'|'color',
             options, required, full, hint, placeholder, value, onInput(v, inputs), onChange(v, inputs) }],
  submit: async (values) => { await post(...); toast('Saqlandi', 'ok'); load(); } });
```

- `.form-grid` 2 ustunli (≤640px da 1). `full:true` ikkala ustunni egallaydi: maqsad, izoh va JSON maydonlari uchun.
- `required` maydonda qizil `*` chiqadi va avtomatik tekshiriladi ("… maydoni majburiy").
- `hint` label ostida 11px muted matn: format namunasi yoki ogohlantirish.
- Submit paytida tugma `disabled` bo'ladi. Xato `err()` orqali toast'da chiqadi va modal ochiq qoladi.
- **Kanonik CRUD:**

```js
submit: async (v) => { existing ? await patch(url + existing.id, v) : await post(url, v); toast('Saqlandi', 'ok'); load(); }
```

### 4.6 Qatlamlar

| Komponent | Qachon ishlatiladi | Shakl |
|---|---|---|
| `modal({title, body, footer, size})` | forma, import, kichik ro'yxat, tanlov | markazda; kenglik 760 (sm 480, lg 1040); radius 14; footer o'ngda |
| `formModal` | yaratish va tahrirlash | yuqoridagi |
| `confirmDlg(text, {danger, okLabel})` | qaytarib bo'lmaydigan yoki muhim harakat | sm modal; `danger` bo'lsa qizil tugma |
| `promptDlg(title, {label, type})` | sabab yoki izoh so'rash (rad etish, tuzatish) | textarea + "Saqlash" |
| `drawer({title, body, actions})` | **yozuvning batafsil ko'rinishi** (shartnoma, xarajat, tranzaksiya, tasdiqlash) | o'ngdan `min(900px,100%)`; tana `--bg` fonda, ichida kartalar (14px oraliq) |
| `toast(msg, 'ok'\|'err'\|'')` | natija xabari | pastki o'ng; 3.5s (err 6s) |
| `err(e)` | API xatosi | `toast(e.message,'err')` |

Drawer ichidagi naqsh: yuqorida holat badge'lari, keyin `card(kv)`, keyin harakat tugmalari, keyin zanjir (`.steps`) va `card('Audit', .timeline)`.

### 4.7 Filtr va tanlovlar

| Komponent | Vazifa | Joylashuvi |
|---|---|---|
| `dateRange({from, to, allowEmpty, onChange})` | **Sanadan / Sanagacha** oralig'i. from > to bo'lsa toast chiqadi. `allowEmpty` bo'lsa × tugmasi "Barcha davr"ga qaytaradi | **header `.acts` da, birinchi element** |
| `.chips` / `.chip.active` | holat bo'yicha tez filtr (Barchasi, Bog'lanmagan…) | KPI qatoridan keyin, jadvaldan oldin, `div.mb12` ichida |
| `segmented(opts, v, cb)` (`.seg`) | 2–6 ta preset (7 kun / 30 kun…) | tana boshida, `mb16` |
| `.tabs` | bitta sahifadagi turli ko'rinishlar | page-head'dan keyin, `mb16` |
| `monthsSelect(v, cb)` | grafik davri (3/6/12 oy) | karta header harakati |
| `periodPicker` | Kun/Hafta/Oy/Chorak/Yil/Davr | ⚠ eskirgan: `dateRange` bilan takrorlanadi, 8-bo'limga qarang |
| `fileDrop({accept, hint})` | fayl yuklash (native "Choose File" o'rniga) | modal ichida |

### 4.8 Grafiklar (`public/js/charts.js`)

Hammasi qo'lda yozilgan SVG, kutubxona yo'q. Ranglar `--s1…--s8` tartibida yoki seriyadagi `color` bilan beriladi.

| Funksiya | Qachon | Standartlar |
|---|---|---|
| `lineChart({labels, series:[{name, values, area, color}], height})` | vaqt bo'yicha dinamika (pul oqimi, qoldiq prognozi) | viewBox 720 kenglik, height 240; birinchi seriyaga `area`; crosshair + tooltip; legend faqat seriya 1 tadan ko'p bo'lsa |
| `barChart({labels, series, height, stacked, money, yFmt})` | davrlar taqqoslashi (daromad va xarajat, reja va fakt) | guruhlangan; rx 3; manfiy qiymat qo'llanadi |
| `donutChart({items:[{name, value, color}], size, centerLabel})` | tarkib yoki ulush (≤8 bo'lak) | markazda `short(jami)` + "jami"; o'ngda legend (%, summa) |
| `hBarChart({items:[{label, value, color, sub}]})` | kategoriyali reyting yoki aging | HTML satrlari: label / bar / summa |
| `planFact(items)` | reja va fakt bajarilishi | nom + "Reja · Fakt · %" + progress |
| `sparkline(values, {color})` | KPI kartadagi trend | faqat `kpiCard({spark})` orqali |

**Grafik qoidalari:**

- Grafik har doim `card(title, chart, [monthsSelect?], {sub: davr})` ichida bo'ladi.
- **Kanonik balandlik:** asosiy grafik 230 (dashboard), yordamchi 200. Donut `size:140`.
- Bo'sh ma'lumotda grafik chizilmaydi. Uning o'rniga `emptyState('Ma'lumot yo'q', '<davr> uchun yozuvlar yo'q', 'pie')` qo'yiladi. Chart funksiyalari bo'sh massivni o'zi tekshirmaydi.
- **Semantik rang:** tushum yoki daromad `--s1` (zumrad), xarajat `--s2` (to'q sariq), sof natija yoki reja `--s3` (ko'k).
- **Aging ranglari:**
  - joriy: `--s1`
  - 0–7 kun: `--warn`
  - 8–30 kun: `--orange`
  - 30+ kun: `--crit`

### 4.9 Maxsus bloklar

| Blok | Klass | Qayerda |
|---|---|---|
| Formula chizig'i: "A − B − C = natija" | `.formula`, `.op`, `.vl`, `.res` (mint quti) | treasury (ishlatish mumkin pul) |
| Tasdiqlash zanjiri | `.steps > .step.ok\|bad\|cur` (`.ic` doira, `.t` rol, `.s` kim va qachon) | approvals va expenses drawer, payroll |
| Audit vaqt chizig'i | `.timeline .it` | contract va expense drawer |
| Mini KPI'lar | `.kpimini` (auto-fit 140px) | contract va tranzaksiya drawer, AI chat |
| Ro'yxat | `.list > .li` (`.t` sarlavha, `.s` meta) yoki `a.li` | diqqat talab qiladi, bildirishnomalar, AI takliflari, eksport markazi |
| JSON ko'rinishi | `pre.json` (max 260px) | audit modal, AI manba |
| Bo'lim sarlavhasi | `.sec-title` (11px UPPERCASE) | drawer tablari ichida |
| Chat | `.ai-grid`, `.chat .msgs`, `.msg.u` (zumrad pufak) / `.msg.a` (oq), `.eng` | ai |

### 4.10 Tugmalar

| Klass | Ko'rinish | Qachon |
|---|---|---|
| `.btn.pri` | zumrad fon, oq matn | sahifadagi **bitta** asosiy harakat (yaratish, import, hisoblash) |
| `.btn` | oq, `border-strong` | ikkilamchi harakat |
| `.btn.soft` | mint | "Ulash" kabi yumshoq taklif |
| `.btn.ghost` | shaffof | uchinchi darajali: "Batafsil →", × tozalash, ikonli tahrirlash |
| `.btn.good` | yashil | Tasdiqlash / Bajarildi |
| `.btn.danger` | qizil | Rad etish / Tuzatish (reversal) / 2FA o'chirish |
| `.btn.warn` | sariq | Bog'lanishni bekor qilish |
| O'lchamlar | default ≈32px · `.sm` ≈27px · `.xs` ≈22px | header → default; karta header / drawer → `sm`; jadval qatori → `xs` |

- Ikon matndan **oldin** turadi. Header tugmalarida 15px, `xs` tugmada 13px.
- `.iconbtn` 36×36 faqat topbar uchun.

---

## 5. UI qaror qabul qilish mantig'i

Yangi UI qurishda quyidagi savollar ketma-ket beriladi:

### 5.1 Ma'lumot turi → vizual shakl

| Agar… | Unda… |
|---|---|
| Bitta asosiy raqam (qoldiq, jami, foyda) | `kpiCard` KPI qatorida (`.kpis`) |
| Raqam boshqa sahifada batafsil ko'rsatiladi | `kpiCard({href})` |
| Raqam o'tgan davrga nisbatan o'zgaradi | `delta` + `deltaLabel` ("O'tgan oyga nisbatan" / "Oldingi davrga nisbatan"). Xarajat uchun `invert` |
| Raqam formula natijasi | `sub` da formulani yozing ("Jami pul − avanslar − rezerv") yoki `.formula` bloki |
| Raqam emas, holat | `badge(status)` |
| 2–4 ikkilamchi ko'rsatkich | `.stat-tiles` + `statTile` |
| Ko'p yozuv (>10), qidirish yoki tartiblash kerak | `dataTable` `card(..., {tight})` ichida |
| Moliyaviy hisobot (qator → summa, bo'limlar, jami) | xom `table.tbl` va `sec/sub/total` qatorlari |
| Kam yozuv (≤8) va har birida harakat yoki holat | `.list > .li` (masalan "Diqqat talab qiladi") |
| Kalit–qiymat tafsilotlari | `kv()` |
| Vaqt bo'yicha dinamika | `lineChart` |
| Davrlar yoki kategoriyalarni taqqoslash | `barChart` (guruhlangan) |
| Tarkib yoki ulush | `donutChart` (≤8 bo'lak, qolganini "Boshqa"ga birlashtiring) |
| Reyting yoki aging | `hBarChart` |
| Reja va fakt | `planFact` + progress |
| Ketma-ket qadamlar yoki zanjir | `.steps` |
| O'zgarishlar tarixi | `.timeline` |

### 5.2 Ierarxiya

- **Asosiy harakat:** header'da bitta `btn pri`, `.acts` ning oxirgi elementi. Ikkinchi darajali harakatlar oddiy `btn` va undan chapda turadi.
- **Ikkilamchi ma'lumot:** `muted` rang, `.small` yoki `.xs`, `sub` qatori, `.s` meta. Qalin qilinmaydi.
- **Kritik ma'lumot:**
  - KPI'da `tone:'red'` va kerak bo'lsa `cls:'crit'` (qizil chegara)
  - matnda `.neg`
  - holat uchun `badge('OVERDUE')`
  - butun sahifaga tegishli bo'lsa, sahifa tepasida `alert('crit', …)`
  - Qizil rang faqat haqiqatan yomon holat uchun (manfiy summa, muddati o'tgan, rad etilgan).
- **Ogohlantirish:** `amber` tone yoki `alert('warn')`. Masalan "tekshiring", "tasdiq kutmoqda".
- **Tushuntirish yoki qoida:** `alert('mint' | 'info')`, sahifa pastida yoki tegishli karta ichida.
- **Bo'sh natija:** har doim `emptyState(sarlavha, "nima uchun bo'sh / nima qilish kerak", ikon)`. Faqat "Ma'lumot yo'q" deb qoldirmang, sababini yozing.

### 5.3 Sahifa skeleti (kanonik tartib)

```
page-head:  h1 · sub ("vazifa · davr/sana")               [dateRange] [ikkilamchi btn] [btn pri]
(ixtiyoriy) alert  — sahifa darajasidagi muhim xabar (ma'lumot yo'q, likvidlik past)
(ixtiyoriy) .tabs  — sahifa ichidagi ko'rinishlar
.kpis.mb16  — 4–6 ta kpiCard (bittasi accent)
.grid.g2|g3.mb16 — grafik va xulosa kartalari
div.mb12 > .chips — holat filtri (kerak bo'lsa)
card(tight) > dataTable — asosiy ro'yxat
(ixtiyoriy) alert('info'|'mint') — qoida yoki tushuntirish
```

### 5.4 Matn qoidalari

- Barcha matn o'zbekcha (lotin), `‘` belgisi bilan: `o‘`, `g‘`. Kod yoki inglizcha status foydalanuvchiga ko'rsatilmaydi. Tarjima uchun `STATUS`, `ROLE_LABEL`, `ACTION_LABEL`, `SOURCE_LABEL`, `IGNORE_LABEL`, `RESOURCE_LABEL` va `AGENT_LABEL` xaritalari (`ui.js`) ishlatiladi.
- **Subtitle formati:** `"<vazifa> · <davr yoki sana>"`. Oraliq tanlansa, `" · " + rangeLabel(rng.value)` qo'shiladi.
- Pul birligi faqat `so'm`. Boshqa valyuta bo'lsa, kodi ko'rsatiladi.
- **Toast matni:** qisqa natija. Masalan "Saqlandi", "Import qilindi: 12 ta yangi".

---

## 6. Responsiv tizim

| Kenglik | O'zgarish |
|---|---|
| **>1650** | `.kpis` 5 ustun · `.c6` 6 ustun |
| **≤1650** | `.c6` → 3 ustun |
| **761–1500** | 5 kartali `.kpis` → **3 + 2** (6 ustunli grid: 3 ta span 2, 2 ta span 3) |
| **≤1500** (681+) | `.grid.g3.tr-row` → 2 + 1 |
| **≤1400** | `.g5/.g6` → 3, `.g4` → 2 |
| **≤1300** | `.kpis` (5) → 3, `.c4` → 2 |
| **≤1100** | `.g3` → 2 · `.g-2-1/.g-1-2` → 1 · `.ai-grid` → 1 · `.formula` → 2 ustun (operatorlar yashirinadi) |
| **≤1024** | **sidebar drawerga aylanadi** (fixed, translateX, ☰ tugma, overlay) · padding 14px · userchip'da faqat avatar |
| **≤760** | `.kpis` → 2 (toq oxirgi karta to'liq qator) · header `.acts` to'liq kenglik, tugmalar `flex:1` · `dateRange` to'liq kenglik (qismlar 150px) · `.hbar` torayadi |
| **≤680** | barcha `.g2…g6` → 1 ustun |
| **≤640** | `.form-grid` → 1 · `.kv` → 1 |
| **≤480** | `.kpis` → 1 |
| **height ≤820 / ≤700** | nav zichlashadi; 700 da sidebar footer yashirinadi |
| **print** | sidebar, topbar, toolbar, pager va tugmalar yashirinadi; kartalar chegara bilan, `break-inside:avoid` |

**Qoidalar:**

- Jadval har doim `.tbl-wrap` ichida bo'ladi. Mobil'da gorizontal scroll qiladi, ustunlar yashirilmaydi.
- Grid bolalari `min-width:0` oladi (`.grid > *`). Shuning uchun karta ichidagi uzun matn gridni buzmaydi.
- Yangi grid uchun mavjud klasslar ishlatiladi (`g2 g3 g4 g-2-1 g-1-2`). O'z media query'ingizni yozmang.
- KPI qatorida 4, 5 yoki 6 karta bo'ladi. 5 karta standart (`.kpis`), 6 → `.c6`, 4 → `.c4`. 3 yoki 7 karta ishlatilmaydi.
- 1024px dan kichik ekranda hover'ga tayanadigan funksiya bo'lmasligi kerak. Tooltip'dagi ma'lumot boshqa joyda ham ko'rinishi kerak.

---

## 7. Sahifama-sahifa UI (19 ta sahifa + login)

Har bir sahifa `public/js/pages/<route>.js` faylida. **Umumiy xulq:**

- **Birinchi yuklash:** router "Yuklanmoqda…" ko'rsatadi.
- **Qayta yuklash:** sana, tab yoki filtr o'zgarganda `load()` kontentni almashtiradi (indikator yo'q).
- **Xato:** harakat tugmalarida `try/catch → err()`.

### 7.1 Bosh sahifa: `#/dashboard` (`dashboard.js`)

- **Maqsad:** butun moliyaviy holatni bir sahifada ko'rsatish.
- **Header:** `dateRange({allowEmpty})`. Oraliq bo'lmasa "joriy oy va o'tgan oyga nisbatan" rejimi. Oraliq tanlansa barcha labellar "(davr)" va "Oldingi davrga nisbatan" ga o'zgaradi.
- **Mustaqil bloklar** (`public/js/bank-ledger.js`): biri yiqilsa, qolgani ishlaydi.
  - **ERP banneri:** token eskirgan yoki oxirgi sinxron 401 bo'lsa `alert.warn` + "Tokenni yangilash" (`integrations EDIT`). Token `password` maydonda kiritiladi.
  - **"Bank hisoblari" kartasi** (`treasury VIEW`): Kompaniya (Global/UGS/UTAX) → Hisob (kompaniyaga qarab filtrlanadi) → Oy select'lari, manba badge'lari (`SRC_BANK_FILE`, `SRC_MANUAL`). Tanlov URL'da: `#/dashboard?company=ugs&account=<raqam>&month=2026-07` (`history.replaceState`). `.kpis.c4`: Boshlang'ich qoldiq · Tushum · Xarajat · Balans (accent). Tushum/Xarajat kartasi `sub` da yalpi summani ko'rsatadi. Karta bosilsa drawer ochiladi: Tushum/Xarajat → operatsiyalar `dataTable`, Boshlang'ich/Balans → hisoblar kesimidagi tekshiruv jadvali.
  - Kartalar ostida tanlovga bog'liq ikki jadval turadi:
    - **"Hisoblar kesimi"** — xom `table.tbl`: kompaniya `tr.sec` → hisoblar `tr.sub` → jami `tr.total` → barcha bank hisoblari → umumiy jami. Summalar yalpi, Excel'dagidek.
    - **"Operatsiyalar"** — `dataTable`: kirim/chiqim, hisob va ichki o'tkazma filtrlari, Excel eksport.
  - **Manba badge'i bosiladi** (`.badge.link` + download ikoni) va raqam olingan asl faylni yuklab beradi: bank ko'chirmasi yoki kassa uchun berilgan Excel (`/api/bank-ledger/source-files/:entity/:id`). Filtr qatoridagi manba tugmasi doiradagi barcha fayllar ro'yxatini ochadi.
  - Asosiy ERP ko'rsatkichlari ustida `.sec-title` va `badge('SRC_ERP')` turadi.
- **Tuzilma (yuqoridan pastga):**
  1. **Ma'lumot oyi ogohlantirishi.** Joriy oyda yozuv bo'lmasa `alert.info` chiqadi: "Oxirgi ma'lumot: Iyul 26" va `btn sm pri` "Iyul 26 ni ko'rsatish" (oraliqni o'rnatadi).
  2. `.kpis`: 5 ta **katta** `kpiCard`, sparkline va delta bilan. Bank, Kassa, Jami pul, Mijoz avanslari va Xarajatlar. Hammasi `href` bilan.
  3. `.kpis.c6`: 6 ta `sm` karta. Ishlatish mumkin pul (**accent**), Tan olingan daromad, Debitorlik, Kutilayotgan daromad va xarajat (30 kun), Sof foyda. Hammasi `href` bilan.
  4. `grid g2`: "Pul oqimi dinamikasi" (`lineChart` 230) va "Daromad va xarajatlar taqqoslamasi" (`barChart` 230). Karta header'ida `monthsSelect` (3/6/12 oy, ikkalasi sinxron; oraliq rejimida yashirin).
  5. `grid g3`: uchta donut. Pul tarkibi, daromad manbalari, xarajatlar tuzilmasi.
  6. `grid g3`: "So'nggi yirik tushumlar" va "…xarajatlar" (xom jadval, qator bosilsa manbaga o'tadi, "Barchasini ko'rish →"), hamda "Asosiy ko'rsatkichlar" (`.stat-tiles`, 4 ta `statTile`).
  7. `grid g3`: "Diqqat talab qiladi" (`a.li` ro'yxati va badge), "Reja va fakt" (`planFact`), "Debitorlik yoshi" (`hBarChart`).
- **O'ziga xos:** sparkline, `statTile`, `planFact` va link-KPI'lar faqat shu sahifada ishlatiladi. Kanonik **dashboard** namunasi shu sahifa.

### 7.2 Pul boshqaruvi: `#/treasury` (`treasury.js`)

- **Maqsad:** "Ishlatish mumkin pul" formulasi, rezerv, hisoblar va kassa.
- **Header:** Sanadan–Sanagacha (standart: oy boshidan bugungacha), "Bank hisobi" (`btn`), "Kassa operatsiyasi" (`btn pri`).
- **Tuzilma:**
  - "Tanlangan davr" kartasi: kirim/chiqim jadvali, davr boshi va oxiri.
  - **Formula kartasi** (`.formula`): Jami pul − Cheklangan pul − Rezerv = **Ishlatish mumkin pul**. Ostida `alert(mint|crit)` "Hozir xavfsiz olish mumkin".
  - `.kpis` 5 ta `sm`.
  - `grid g3 tr-row`: "Kutilayotgan pul oqimi" (7/30 kun), "Rezerv tarkibi" (`kv`), "Hisoblar". Hisoblar jadvalida boshlang'ich qoldiq, qator oxirida ✎ tahrirlash tugmasi va "+ Kassa" bor.
  - "Kassa operatsiyalari" `dataTable`.
- **Formalar:** kassa operatsiyasi (shartnoma yoki xarajatga bog'lash), bank hisobi, kassa, hisobni tahrirlash (boshlang'ich qoldiq va sana).

### 7.3 Shartnomalar: `#/contracts`, `#/contracts/:id`, `?company=`

- **Header:** "Kontragent" (`btn`), "Yangi shartnoma" (`btn pri`). Sana filtri faqat jadval toolbar'ida; KPI'lar `onFilter` orqali shu filtrga ergashadi.
- **Tuzilma:** `.kpis` 5 ta `sm` (faol soni, summa, to'langan, qoldiq, muddati o'tgan), keyin katta `dataTable`. Jadval ustunlari:
  - raqam
  - kompaniya va INN
  - xizmat badge'i (xizmat rangida)
  - summa, to'langan, qoldiq
  - to'lov progress'i
  - sana
  - muddat (kechiksa qizil "(+N kun)")
  - holatlar
  - menejer
  - Filtrlar: holat, xizmat, menejer. Qator bosilsa drawer ochiladi.
- **Drawer (7 tab):**
  1. **Umumiy:** `kv` (12 qator), "Moliyaviy holat" `.kpimini`, progress, xizmat va shartnoma holatini o'zgartirish
  2. **To'lovlar:** to'lov jadvali va "Qator qo'shish", kelib tushgan to'lovlar
  3. **Hujjatlar:** jadval va "Hujjat qo'shish"
  4. **Daromad:** tan olish qoidasi `alert('mint')`, tan olish yozuvlari va "Tuzatish", "Tan olish" (bosqichma-bosqich), pul holati
  5. **Xarajatlar**
  6. **Undiruv**
  7. **Audit** (`.timeline`)
- Drawer harakati: "Tahrirlash" (`btn sm`) → `contractForm` (lg, 15 maydon).

### 7.4 Tushumlar (bank tranzaksiyalari): `#/transactions`, `#/transactions/unmatched`

- **Header:** "Bog'lashni ishga tushirish" (`btn` + zap), "Qo'lda kiritish" (`btn`), "Ko'chirmani import qilish" (`btn pri`). Sana filtri faqat jadval toolbar'ida (`onDateChange` → serverdan qayta so'rov, KPI'lar ham yangilanadi).
- **Tuzilma:**
  - `.kpis` 5 ta: bog'lanmagan, taklif, bog'langan, e'tiborsiz, bog'lanmagan kirim summasi
  - `.chips`: Barchasi / Bog'lanmagan / Taklif / Bog'langan / E'tiborsiz
  - `dataTable`:
    - ustunlar: sana, yo'nalish badge'i, summa, kontragent va INN, maqsad, bank, holat, `confBar`, bog'langan obyekt
    - filtrlar: yo'nalish, bank
- **Drawer:**
  - `.kpimini` (summa, yo'nalish, holat, ishonchlilik %)
  - `card('Ma'lumotlar', kv)`
  - nomzodlar ro'yxati (`.li` + `confBar` + "Tasdiqlash"/"Tanlash")
  - harakatlar: Boshqasini tanlash, E'tiborsiz qoldirish (prompt), Bog'lanishni bekor qilish (`warn`), Tuzatish (reversal, `danger`)
- **Import modal:** bank select, `fileDrop`, oldindan ko'rish jadvali (≤50 qator), "Import qilish".

### 7.5 Debitorlik: `#/receivables`

- **Header:** `dateRange` (**to'lov muddati** bo'yicha), "Undiruv agentini ishga tushirish" (`btn` + zap). Bu sahifada `btn pri` yo'q.
- **Tuzilma:**
  - `.kpis` 5 ta: jami, muddati o'tgan, kritik (15+ kun), 7 va 30 kunda kutilmoqda
  - `grid g-1-2`: aging `hBarChart` va "Undiruv agenti vazifalari". Vazifalar xom jadvalda: bosqich badge'i, "Bajarildi" (`btn xs good`), "Izoh"
  - `.chips`: Barchasi / Bugun / Muddati o'tgan / 7 kun / 30 kun / 60+ / Kritik
  - `dataTable`, toolbar'da "Minimal summa" input'i
- Qator bosilsa shartnomaga o'tadi. Bu sahifada drawer yo'q.

### 7.6 Xarajatlar: `#/expenses`, `#/expenses/pending`, `#/expenses/:id`

- **Header:** `dateRange`, "To'g'ridan-to'g'ri kiritish" (`btn`), "Xarajat so'rovi" (`btn pri`).
- **Tuzilma:**
  - `.kpis` 5 ta: davr xarajati, tasdiq kutmoqda, tasdiqlangan-to'lanmagan, eng katta kategoriya, bo'limlar soni
  - `grid g2`: kategoriyalar donut'i va oylik `barChart`
  - `dataTable`:
    - ustunlar: kod, sana, bo'lim, kategoriya ("aniqlanmagan" qizil yoki "AI taklifi N%" badge'i), maqsad, summa, so'ragan, kerak sana, holat, to'langan
    - filtrlar: holat, bo'lim, kategoriya
- **So'rov formasi (lg):** maqsad yozilayotganda AI kategoriyani taklif qiladi (`onInput`).
- **Drawer:**
  - `card(kv)` va tasdiqlash tugmalari: Tasdiqlash (`good`) / Rad etish (`danger` + prompt) / Kechiktirish
  - `card('Tasdiqlash zanjiri', .steps)`
  - harakatlar: To'langan deb belgilash (`pri`), Tahrirlash, Tuzatish (`danger`)
  - `card('Audit', .timeline)`

### 7.7 Foyda va zarar: `#/pnl`, `#/pnl/services`

- **Header:** `dateRange` (oy boshi va oxiri). **Tablar:** "Foyda va zarar hisoboti" va "Xizmatlar rentabelligi".
- **P&L tab:**
  - `.kpis`: daromad, yalpi foyda (marja bilan), operatsion, sof (**accent**), oldingi davr
  - `grid g2`:
    - chapda P&L hisobot jadvali (`total` va `sub` qatorlar, marja ustuni)
    - o'ngda "Oylik dinamika" (`barChart` 200) va "Daromad xizmat turlari bo'yicha" (donut)
  - "Xarajatlar kategoriyalar bo'yicha" `dataTable`. Oxirida "Kategoriyasiz (belgilash kerak)" qatori va footer "Jami".
- **Xizmatlar tab:**
  - formula `alert('info')`
  - xizmat KPI'lari (verdict bo'yicha ton)
  - ikki `barChart` (summa va marja %)
  - rentabellik `dataTable`

### 7.8 Pul oqimi: `#/cashflow`

- **Header:** `dateRange`.
- **Tuzilma:**
  - `.kpis`: davr boshi, kirim, chiqim, sof o'zgarish, davr oxiri (**accent**)
  - `grid g2`:
    - chapda **kanonik moliyaviy hisobot jadvali** (`tr.sec`, `tr.sub`, `tr.total`: operatsion / investitsion / moliyaviy)
    - o'ngda "Oylik pul oqimi" `lineChart` va "Kirim manbalari" / "Chiqim yo'nalishlari" kichik jadvallari
- **Qoida:** ichki o'tkazmalar (bank → kassa) kirim va chiqimga qo'shilmaydi.

### 7.9 Balans: `#/balance`

- **Header:** `dateRange({allowEmpty})`. Bo'sh bo'lsa "bugun holatiga". Oraliq tanlansa **taqqoslash rejimi** yoqiladi: davr boshi, oxiri va o'zgarish (`pos`/`neg`).
- **Tuzilma:**
  - `.kpis`: aktivlar, majburiyatlar, kapital (**accent**), mijoz avanslari, shartnoma qoldig'i
  - `grid g2`: "Aktivlar" va "Majburiyatlar va kapital" jadvallari
  - `alert('info')`

### 7.10 Reja / Fakt: `#/planfact`

- **Header:** `dateRange`, "Rejani kiritish" (`btn pri`, EDIT).
- **Tuzilma:**
  - 5 ta reja/fakt kartasi. Har birida badge holati, Reja / Fakt / Farq, progress va katta foiz.
  - `grid g2`: `planFact` va "Daromad va foyda: reja va fakt" `barChart`
  - `grid g2`: "Oylik rejalar" `dataTable` (qator bosilsa tahrirlanadi) va "Byudjet" `dataTable` ("+ Byudjet")

### 7.11 Prognoz: `#/forecast`

- **Header:** `dateRange` (bugundan +30 kun). Tanada `segmented` presetlar: 7 kun / 30 / 90 / 6 oy / 12 oy.
- **Tuzilma:**
  - `.kpis`: hozirgi pul, ishlatish mumkin pul, gorizont, bazaviy prognoz (**accent**), likvidlik riski (badge)
  - `grid g3`: 3 ta **senariy kartasi** (konservativ / bazaviy / optimistik), ichida `kv`
  - `grid g2`: qoldiq `lineChart` va davrlar `barChart`
  - `grid g2`: "Prognoz manbalari" va "Barcha gorizontlar" `dataTable`

### 7.12 KPI va oylik: `#/payroll`

- **Tablar:** Oylik · Xodimlar · KPI qoidalari.
- **Oylik (bitta oy):**
  - header'da `dateRange` (standart: o'tgan oy), "Hisoblash" (`pri`), "Tasdiqlashga yuborish" (`btn` + confirm), "To'langan deb belgilash" (`good`)
  - `.kpis`, holati badge'da
  - "Tasdiqlash zanjiri" (`.steps`, gorizontal)
  - `grid g2`: bo'limlar jadvali va hisoblash qoidasi `alert('mint')`
  - "Xodimlar oyligi" `dataTable`: 14 ustun va footer "Jami". Qoralama holatida qator tahrirlanadi.
- **Oylik (ko'p oy):** jamlanma rejimi. Oylar jadvalida qator bosilsa o'sha oyga o'tiladi.
- **Xodimlar tab:** `dataTable` va "Xodim qo'shish".
- **KPI qoidalari tab:** `dataTable` va qoida formasi (formula select, JSON parametrlar).

### 7.13 AI moliya: `#/ai`

- **Layout:** `.ai-grid` (2fr | 1fr; ≤1100px da 1 ustun).
- **Chap: chat kartasi.**
  - `.msgs`: foydalanuvchi zumrad pufakda o'ngda, AI oq pufakda chapda
  - xush kelibsiz xabari va 15 ta savol chip'i
  - javob ostida ma'lumot: `.kpimini`, jadval (≤30 qator) yoki `<details>` "Manba ma'lumotlar"
  - pastda `.eng`: "manba: Gemini AI · model" yoki "tizim qoidalari"
  - tasdiqlash so'rovi bo'lsa, xabar ichida Tasdiqlash va Bekor qilish tugmalari
  - kutish paytida "Tahlil qilinmoqda…" xabari
- **O'ng:**
  - "AI takliflari" (`.li` + ✓/×, sub "inson tasdiqlaydi")
  - "AI agentlar" (ro'yxat + ⚡ ishga tushirish)
  - xavfsizlik `alert('mint')`

### 7.14 Hisobotlar: `#/reports`

- **Header:** `dateRange({allowEmpty})`.
- **`grid g2`:**
  - **Eksport markazi:** 12 ta hisobot `.li` ro'yxatida. Har birida "Excel" (`btn xs` + download). Oraliq tanlansa, "davr · qaysi sana bo'yicha" izohi chiqadi. Karta harakati "PDF" (print).
  - **Ma'lumot sifati:** muammolar ro'yxati. Har birida badge, soni va chip havolalari (tegishli yozuvga olib boradi). Muammo bo'lmasa `alert('good')`.

### 7.15 Integratsiyalar: `#/integrations`

- **Tuzilma:**
  - `grid g4`: **adapter kartalari**. Ikon tile, nom, tavsif va tugma:
    - Excel/CSV → "Excel fayl yuklash" (`pri`)
    - Moliya jurnali → "Jurnal yuklash" (`pri`)
    - qolganlari → "Ulash" (`soft`)
  - "Ulangan integratsiyalar" `dataTable`. Qator harakatlari: Tekshirish, Sinxronlash, Jurnal. Qator bosilsa tahrirlash oynasi ochiladi.
  - Shifrlash haqida `alert('info')`.
- **Modallar:**
  - **Moliya jurnalini yuklash:** `fileDrop`, oldindan ko'rish (4 ta KPI), ogohlantirishlar, "Import qilinmaydigan qatorlar" `<details>`, "Import qilish"
  - **Excel/CSV bank ko'chirmasi:** bank select, `fileDrop`, oldindan ko'rish jadvali
  - **Ulash / tahrirlash:** adapter sxemasidan qurilgan `formModal`. Secret maydonlar `password` turida va "shifrlangan holda saqlanadi" izohi bilan.
- **Qoida:** biznes ma'lumoti faqat shu sahifa orqali Excel'dan kiradi ([CLAUDE.md](CLAUDE.md)).

### 7.16 Tasdiqlashlar: `#/approvals`, `#/approvals/:id`

- **Header:** `dateRange` (qoidalar tabida yashirin).
- **Tablar:**
  1. Men tasdiqlashim kerak
  2. Barcha kutayotganlar
  3. Mening so'rovlarim
  4. Tarix
  5. Qoidalar va limitlar (`settings EDIT`)
- **Ro'yxat:** `.kpis.c4` va `dataTable`. Ustunlar: turi badge'i, nomi, summa, so'ragan, bo'lim, qadam "k/n · rol", holat, "Sizning navbatingiz" badge'i.
- **Drawer:** `kv` va Tasdiqlash / Rad etish / Kechiktirish. Keyin "Tasdiqlash zanjiri" (`.steps`).
- **Qoidalar tabi:** tahrirlanadigan jadval (tur, nom, min, max, rollar), "Qoida qo'shish", "Saqlash".

### 7.17 Bildirishnomalar: `#/notifications`

- **Header:** `dateRange`.
- **Tablar:** Mening · Yuborilganlar jurnali (`audit` ruxsati bilan).
- **Mening:**
  - `.list` elementlari: daraja tile'i (CRITICAL qizil, WARNING sariq, INFO ko'k), sarlavha, matn, "tur · vaqt", "yangi" badge'i
  - o'qilganlari 65% shaffoflikda
  - bosilsa tegishli yozuvga o'tadi
  - karta harakatlari: "faqat o'qilmagan", "Barchasini o'qilgan qilish", "Sinov xabari"
- **Jurnal:** `dataTable`.

### 7.18 Audit jurnali: `#/audit`

- `.kpis.c4`: jami, AI harakatlari, eng faol foydalanuvchi, eng ko'p harakat.
- **Filtr toolbar'i:** obyekt turi, harakat turi, sana, qiymat bo'yicha qidirish.
- `dataTable`: vaqt, foydalanuvchi va rol, harakat (o'zbekcha nom), obyekt, ID, manba, IP, tasdiq №, yangi qiymat.
- **Modal:** `kv` va `grid g2` ichida "Eski qiymat" / "Yangi qiymat" (`pre.json`).
- **Sahifa matni:** "Moliyaviy tarix o'chirilmaydi — faqat tuzatish yozuvlari".

### 7.19 Sozlamalar: `#/settings/<tab>`

Tablar va ular nimani ko'rsatishi:

| Tab | Ko'rinish |
|---|---|
| **Biznes qoidalari** (`rules`) | muhit `alert('info')`; `grid g2` ichida 11 guruh kartasi; maydon turi qiymatga qarab tanlanadi (checkbox / number / JSON textarea / text); "Saqlash" (`pri`) |
| **Xizmat turlari** | `dataTable` (kod badge'i xizmat rangida) + forma (rang tanlagich, JSON qoidalar) |
| **Xarajat kategoriyalari** | `dataTable` + forma (P&L guruhi, pul oqimi turi, AI kalit so'zlari) |
| **Foydalanuvchilar** | `dataTable` (2FA, Telegram badge'lari) + forma |
| **Rollar va ruxsatlar** | rol tanlash select'i + checkbox matritsasi (resurs × harakat) + "Saqlash" |
| **Bo'limlar** | `dataTable` + forma |
| **Doimiy xarajatlar** | `dataTable` + forma |
| **Fon vazifalari va zaxira** | `grid g2`: vazifalar ro'yxati (⚡) va "Zaxira nusxa" ("Hozir zaxiralash") |
| **Profil** | `grid g3`: Profil (`kv` + parol), 2FA, Telegram (kod olish) |

### 7.20 Login

3.4-bo'limga qarang. Bu app shell'dan tashqaridagi yagona ekran.

---

## 8. Izchillik auditi va kanonik naqshlar

Quyida bir xil ish turlicha qilingan joylar va **qaysi variant to'g'ri** ekani berilgan. Yangi kod faqat **kanonik** variantni ishlatadi. Mavjud nomuvofiqliklar asta-sekin shu variantga keltiriladi.

| # | Nomuvofiqlik (qayerda) | Kanonik naqsh |
|---|---|---|
| 1 | **Sana oralig'i 4 xil.** `dateRange()` ko'p joyda; treasury o'z input'larini qo'lda quradi; audit belgisiz ikki `input[type=date]` ishlatadi; pnl va cashflow'da `dateRange` + `periodPicker` ikkalasi bor | **Bitta sahifada BITTA sana filtri.** Sahifaning asosiy mazmuni jadval bo'lsa (shartnomalar, tushumlar, xarajatlar) — filtr jadval toolbar'ida (`dateKey`), KPI'lar esa `onFilter` yoki `onDateChange` orqali unga ergashadi; header'da `dateRange` bo'lmaydi. Jadvalsiz hisobot sahifalarida (pnl, balans, prognoz…) — `dateRange()` header'da, `.acts` ning birinchi elementi. `periodPicker` yangi kodda ishlatilmaydi; presetlar kerak bo'lsa `segmented` + `rng.set()`.<br>**Ochiq:** treasury'da header filtri va "Kassa operatsiyalari" jadvalidagi filtr yonma-yon turibdi — ikkinchisi faqat o'sha kartaga tegishli, lekin ko'rinishda chalkashtiradi |
| 2 | **Tablar 3 xil qo'lda qurilgan** (approvals/settings/payroll → `drawTabs()`, notifications → `classList` toggle, pnl/contracts → alohida). URL yangilanmaydi | `.tabs.mb16` + `drawTabs()` qayta chizish naqshi. Tab kaliti `params[0]` dan o'qiladi va `navigate('<route>/<tab>')` bilan yoziladi |
| 3 | **Asosiy jadval konteyneri:** ba'zan `card(title, t.el, null, {tight})`, ba'zan sarlavhasiz `h('div',{class:'card'}, t.el)` | Sarlavhali: `card('Nomi', t.el, actions, {tight:true, sub})`. Sarlavhasiz variant faqat sahifada bitta asosiy ro'yxat bo'lsa (contracts, expenses) |
| 4 | **Rol nomlari 4 joyda:** `ROLE_LABEL` (ui.js), `roleLabel` (app.js, EXECUTIVE_DIRECTOR yo'q), approvals va payroll'dagi lokal `ROLE` ("Buxgalteriya" va "Buxgalter") | Faqat `ROLE_LABEL` yoki `ctx.roleLabel`. Lokal rol xaritasi yozilmaydi |
| 5 | **Lokal label xaritalari** (TYPE, ENT, RULE, GRP, CF, ACT, AD_ICON, ACTION) | 2+ sahifada kerak bo'lsa, `ui.js` ga `*_LABEL` sifatida ko'chiriladi |
| 6 | **Bo'sh holat 5 xil:** `emptyState`, `alert('warn')`, xira matn, `td.empty`, `alert('good')` | Ro'yxat yoki blok uchun `emptyState(title, sabab, ikon)`. Jadval ichida `emptyText`. `alert('good')` faqat "muammo yo'q" ijobiy natijasi uchun |
| 7 | **Inline style'lar** (~31 ta): tile o'lchami 32/34/36, `maxWidth:300` matn, `maxHeight` preview, `gap:'14px'`, `marginTop:0`, katta raqam tipografiyasi | Klass ishlating: `.grid` (gap allaqachon 14), `.tbl-wrap` + max-height klassi, ellipsis uchun `.nowrap` + klass, tile uchun `.tile` / `.kpi-card.sm .tile`. Yangi kodda `style:{}` faqat dinamik qiymat uchun (progress kengligi, data rangi) |
| 8 | **Tugma o'lchami bir xil harakat uchun har xil:** qo'shish `btn xs pri`, `btn`, `btn xs soft`; saqlash `btn pri` va `btn sm pri`; ikon 13/14/15/16/17 | Header → `btn` / `btn pri`, ikon 15. Karta header'i → `btn xs`, ikon 13. Jadval qatori → `btn xs` (ghost yoki ikon). Modal footer → `btn` + `btn pri`. Qo'shish tugmasi har doim `+` va ob'ekt nomi ("+ Byudjet", "+ Kassa"). Umumiy "Qo'shish" yozilmaydi |
| 9 | **Tuzatish (reversal) 3 xil:** `btn danger`, `btn danger` "(reversal)", `btn xs ghost` | Drawer'da `btn danger` "Tuzatish" + `promptDlg('Sabab')`. Jadval qatorida `btn xs ghost` "Tuzatish" |
| 10 | **KPI son qiymati:** `String(n)`, "N ta", badge, raqam | Pul → number. Hisob (count) → `"N ta"`. Kun → `"N kun"`. Holat → `badge()` |
| 11 | **planfact KPI'lari qo'lda qurilgan** `div.kpi-card.sm` | `kpiCard` + `sub`/`delta`. Reja/fakt uchun `planFact()` |
| 12 | **Grafik balandligi** 190/200/210/230/240, donut 130/140 | Asosiy grafik 230, yordamchi 200, donut 140 |
| 13 | **Aging rang xaritasi** dashboard va receivables'da nusxalangan | Umumiy konstanta sifatida bir joyga ko'chiriladi. 4.8-bo'limdagi ranglar |
| 14 | **"Faol" badge'i** 5+ joyda qo'lda yozilgan (`badge(is_active?'OK':'CANCELLED','Ha'/'Faol')`) | Bir xil yorliq: `badge(x ? 'OK' : 'CANCELLED', x ? 'Faol' : 'Nofaol')` |
| 15 | **Xato ishlov berish:** `load()` hech qayerda ushlanmaydi; ba'zi harakatlarda `err()` yo'q | Har async harakat `try { … } catch (e) { err(e) }`. Tugma bosilganda `disabled`, `finally` da qayta yoqiladi |
| 16 | **Eksport:** `dataTable` o'zbekcha sarlavhalar bilan; `reports.js` xom inglizcha kalitlar bilan | Eksport faqat o'zbekcha ustun nomlari bilan |
| 17 | **Radius tokenlari** (`--radius-s/xs`) e'lon qilingan, lekin ishlatilmaydi; 7/9/10/14 literal qiymatlari bor | 2.3-bo'limdagi shkala |
| 18 | **Literal ranglar** (`#fff`, alert chegaralari `#fcd34d` va hokazo) | `var(--surface)` va status tokenlari. Yangi hex yozilmaydi |
| 19 | **Tasdiqlash (confirm) izchil emas:** "To'langan deb belgilash" va rad etishda confirm yo'q | Qaytarib bo'lmaydigan yoki pulga ta'sir qiluvchi harakat → `confirmDlg`. Rad etish yoki tuzatish → `promptDlg` (sabab majburiy) |
| 20 | **Ma'lum xato:** `.drawer` z-index 51 > `.modal-bg` 50. Drawer ichidan ochilgan modal drawer ortida qolishi mumkin | `.modal-bg` z-index drawer'dan yuqori bo'lishi kerak (masalan 60). Tuzatilguncha drawer ichidan modal ochganda tekshiring |
| 21 | **Solid status tugmalari** (`good/danger/warn`) hover'siz; tugma, tab va chip'da `:focus-visible` yo'q | Yangi interaktiv element uchun hover va `focus-visible` (2px primary outline) qo'shing |
| 22 | **Sozlamalar Profil tabi** `settings` ruxsatisiz foydalanuvchiga ochilmaydi (router butun sahifani yopadi) | Shaxsiy sahifalar alohida route yoki ruxsatsiz tab sifatida qilinadi |

---

## 9. Yangi sahifa yoki UI uchun qoidalar (FUTURE PAGE RULE)

Yangi sahifa, tab, modal yoki komponent yaratishdan **oldin** agent:

1. **Shu `UI-SKILL.md` ni to'liq o'qiydi.** Ma'lumot qoidasi uchun `CLAUDE.md` ni ham o'qiydi.
2. **Eng yaqin mavjud sahifani namuna qiladi** (7-bo'lim):
   - dashboard'ga o'xshash → `dashboard.js`
   - ro'yxat + drawer → `expenses.js`
   - moliyaviy hisobot → `cashflow.js`
   - sozlama yoki CRUD → `settings.js`
   - import → `integrations.js`
3. **Yangi komponent yozishdan oldin `ui.js` va `charts.js` da qidiradi.** Mos komponent bo'lsa, faqat shuni ishlatadi. Yetishmasa, `ui.js` ga umumiy komponent qo'shadi. Sahifa ichida bir martalik nusxa yaratmaydi.
4. **Tipografiya shkalasidan tashqariga chiqmaydi** (2.2). Yangi font, o'lcham yoki og'irlik qo'shilmaydi.
5. **Spacing shkalasidan foydalanadi** (2.5): grid 14, bo'lim 16, utility klasslar. `style:{margin…}` yozilmaydi.
6. **Faqat mavjud tokenlar va ranglar ishlatiladi** (2.1). Yangi rang, gradient yoki soya yo'q. Qorong'i tema yo'q.
7. **Card, KPI, table va chart standartlariga amal qiladi** (4.3, 4.4 va 4.8). Kanonik balandliklar, `tight` jadval kartasi, bitta `accent` KPI va `href` bilan manbaga bog'lash.
8. **Responsiv tizimga moslashadi** (6). Faqat mavjud grid va KPI klasslari, jadval `.tbl-wrap` ichida. 1440, 1024, 760 va 375 px kengliklarda tekshiriladi.
9. **Sahifa boshqa loyiha yoki shablondan olingandek ko'rinmasligi kerak.**
   - hero banner, katta illyustratsiya, qorong'i panel, boshqa ikon to'plami yoki UI kutubxonasi ishlatilmaydi
   - inglizcha matn yo'q
10. **Yangi UI loyihaning tabiiy davomi bo'ladi.**
    - Sahifa skeleti 5.3-bo'limdagi tartibda.
    - Matn o'zbekcha.
    - Holatlar `badge()` orqali.
    - Raqamlar `fmt`/`money`/`short` orqali.
    - Bo'sh holat `emptyState` bilan, sababi yozilgan.
    - Xato `err()` bilan.
    - Ruxsatlar `can()` bilan: tugma ruxsat bo'lmasa ko'rsatilmaydi.
11. **Ma'lumot to'qilmaydi.** UI'da namuna, demo yoki "placeholder" raqam ko'rsatilmaydi. Ma'lumot yo'q bo'lsa, `emptyState` ko'rsatiladi va manbaga yo'l beriladi (masalan "Integratsiyalar → Moliya jurnali orqali yuklang").
12. **Yangi route qo'shilganda:**
    - `app.js` NAV'ga qator qo'shiladi
    - `ui.js` `RESOURCE_LABEL` ga resurs nomi yoziladi
    - backend RBAC'ga resurs qo'shiladi
    - bu faylning 3.2 va 7-bo'limlariga sahifa tavsifi qo'shiladi

### Yangi sahifa shabloni

```js
import { get, post, qs } from '../api.js';
import { h, card, kpiCard, dataTable, dateRange, rangeLabel, emptyState, alert, formModal, toast, err, icon } from '../ui.js';
import { lineChart } from '../charts.js';

export default async function render(root, { setTitle, can, params }) {
  const rng = dateRange({ allowEmpty: true, onChange: () => load() });
  const TITLE = 'Sahifa nomi', SUB = 'Qisqa vazifa';
  setTitle(TITLE, SUB, [rng.el, can('res', 'CREATE') ? h('button', { class: 'btn pri', onClick: () => createForm() }, icon('plus', 15), 'Yangi …') : null]);
  const kpis = h('div', { class: 'kpis mb16' }), charts = h('div', { class: 'grid g2 mb16' });
  const table = dataTable({ columns: [/* … money:true … */], exportName: 'fayl-nomi', onRow: (r) => openDetail(r.id), emptyText: 'Tanlangan davrda yozuv yo‘q' });
  root.append(kpis, charts, card('Ro‘yxat', table.el, null, { tight: true }));
  async function load() {
    try {
      const { from, to } = rng.value;
      const d = await get('/api/…' + qs(rng.active ? { from, to } : {}));
      setTitle(TITLE, SUB + (rng.active ? ' · ' + rangeLabel(rng.value) : ''));
      kpis.replaceChildren(kpiCard({ size: 'sm', icon: 'coins', tone: 'green', label: '…', value: d.total, sub: '…' }) /* … 5 ta, bittasi accent */);
      charts.replaceChildren(card('Dinamika', d.series.length ? lineChart({ labels: d.series.map((x) => x.label), series: [{ name: '…', values: d.series.map((x) => x.v), area: true }], height: 230 }) : emptyState('Ma’lumot yo‘q', 'Bu davrda yozuvlar yo‘q', 'lineChart'), null, { sub: rng.active ? rangeLabel(rng.value) : 'joriy oy' }));
      table.setRows(d.rows);
    } catch (e) { err(e); }
  }
  await load();
  if (params[0]) openDetail(params[0]);
}
```

---

## 10. Manba havolalari

```
Theme / tokens:        public/css/app.css:4-23
Tipografiya, util:     public/css/app.css:25-34
Layout / shell CSS:    public/css/app.css:38-67
KPI / tile / grid:     public/css/app.css:75-95, 184-193, 213-216
Tugma / input / forma: public/css/app.css:96-104
Jadval:                public/css/app.css:105-116
Modal / drawer / toast:public/css/app.css:126-133
Responsiv:             public/css/app.css:66, 75-81, 93, 104, 133, 157, 177-210
App shell / NAV:       public/js/app.js:4-9, 46-95
Router / ctx:          public/js/app.js:99-129
Login / 2FA:           public/js/app.js:22-42
Komponentlar:          public/js/ui.js (h:4, badge:40, dataTable:106, kpiCard:165, card:177, dateRange:201, fileDrop:221, label xaritalari:243-261)
Grafiklar:             public/js/charts.js (sparkline:13, lineChart:28, barChart:56, donutChart:88, hBarChart:110, planFact:116)
Ikonlar:               public/js/icons.js
API:                   public/js/api.js
Kanonik dashboard:     public/js/pages/dashboard.js
Kanonik ro'yxat+drawer:public/js/pages/expenses.js
Kanonik hisobot jadval:public/js/pages/cashflow.js
Kanonik import oqimi:  public/js/pages/integrations.js (ledgerDlg)
Kanonik CRUD tablari:  public/js/pages/settings.js
Ma'lumot qoidasi:      CLAUDE.md
```

---

## 11. Yakuniy tekshiruv (yangi UI tugagach)

- [ ] Sahifa skeleti 5.3-bo'limdagi tartibda. Header'da `dateRange` birinchi, keyin ikkilamchi tugmalar, oxirida bitta `btn pri`.
- [ ] Faqat `ui.js` va `charts.js` komponentlari ishlatilgan. Yangi inline style yoki hex rang yo'q.
- [ ] KPI qatorida 4/5/6 karta, bittasi `accent`. Manbasi bor raqamlarda `href`.
- [ ] Jadval `card(tight)` ichida, pul ustunlari `money:true`, eksport o'zbekcha sarlavhalar bilan.
- [ ] Bo'sh holat sababi bilan ko'rsatilgan. Xatolar `err()` orqali. Ruxsatsiz tugmalar ko'rinmaydi.
- [ ] 1440 / 1024 / 760 / 375 px da gorizontal toshib chiqish yo'q (jadval `.tbl-wrap` ichida scroll qiladi).
- [ ] Barcha matn o'zbekcha. Kod yoki status nomi foydalanuvchiga ko'rinmaydi.
- [ ] Hech qanday to'qima yoki namuna ma'lumot yo'q.
