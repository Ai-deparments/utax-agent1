# UTAX Finance CRM — atamalar lug'ati va formulalar

Barcha ko'rsatkichlar tizim ichida **hisoblanadi**, qo'lda yozilmaydi. Har bir atama uchun: nima, qayerdan olinadi, formula.

## 1. Pul (Treasury) — «Bankdagi pul ≠ Daromad ≠ Ishlatish mumkin bo'lgan pul»

| Atama (UI) | Inglizcha | Ma'nosi | Formula / manba |
|---|---|---|---|
| **Bankdagi pul** | Bank balance | Barcha faol bank hisoblaridagi real qoldiq | Σ har hisob: `opening_balance + Σ kirim − Σ chiqim` (`bank_transactions`, reversal qilinganlar chiqarib tashlanadi) |
| **Kassa** | Cash balance | Naqd pul | Σ `cash_accounts.opening_balance + kirim − chiqim` (`cash_transactions`) |
| **Jami pul** | Total cash | Bank + kassa | `bank_balance + cash_balance` |
| **Predoplata / Mijoz avanslari** | Customer advances (deferred revenue) | Mijozdan kelgan, lekin xizmat hali bajarilmagani uchun **daromad emas** — mijozning puli | Σ `revenue_events` holati `CUSTOMER_ADVANCE` |
| **Cheklangan pul** | Restricted / advance cash | Avanslarning ishlatib bo'lmaydigan qismi | `customer_advances × cash.advance_restriction_pct / 100` (sozlama, default 100%) |
| **Rezerv** | Reserved | Yaqin majburiyatlar uchun ajratilgan pul | `tasdiqlangan_to'lanmagan_xarajatlar + tasdiqlangan_to'lanmagan_oylik + xavfsizlik_rezervi` (har biri sozlamada yoqiladi/o'chiriladi) |
| ↳ Tasdiqlangan, to'lanmagan xarajatlar | Approved unpaid expenses (payables) | Approval'dan o'tgan, hali to'lanmagan | Σ `expenses.status = APPROVED` |
| ↳ Tasdiqlangan oylik | Pending payroll | Yuborilgan/tasdiqlangan, to'lanmagan oylik | Σ `payrolls.net` (SUBMITTED/APPROVED) |
| ↳ Xavfsizlik rezervi | Safety reserve | Rahbariyat belgilagan doimiy zaxira | sozlama `cash.safety_reserve` (default 50 mln) |
| **ISHLATISH MUMKIN BO'LGAN PUL** | **Available cash** | Kompaniya o'zi erkin ishlata oladigan pul | **`total_cash − restricted_cash − reserved`** |
| **Xavfsiz olish mumkin** | Safe withdrawal | Founder savoli: hozir qancha pul olsa bo'ladi | `available − kutilayotgan_30_kunlik_chiqim + kutilayotgan_30_kunlik_kirim × 50%` (0 dan kam bo'lmaydi) |
| **Kutilayotgan kirim 7/30 kun** | Expected income | To'lov jadvali bo'yicha muddati oynaga tushadigan qarzlar | Σ debitorlik «portions» (`due_date` ∈ [bugun; +7/+30]) |
| **Kutilayotgan chiqim 7/30 kun** | Expected expenses | Tasdiqlangan to'lanmagan xarajat (muddati oynada yoki o'tgan) + doimiy xarajatlar (ijara, hosting, oylik…) | `approved_unpaid(required_date ≤ oyna) + Σ recurring_expenses (oynadagi kunlar)` |
| **Likvidlik past** | Low liquidity | Ogohlantirish belgisi | `available < cash.low_liquidity_threshold` (default 100 mln) |

## 2. Daromad (Revenue Recognition) — «Cash received ≠ Revenue recognized»

| Atama | Ma'nosi | Formula / manba |
|---|---|---|
| **Kelib tushgan pul** (Cash received) | Shartnoma bo'yicha real kelgan to'lovlar | Σ `payments.amount` (bank matching yoki kassa) |
| **Tan olingan daromad** (Recognized revenue) | Xizmat bajarilib, qoida bo'yicha daromad deb tan olingan summa — **P&L manbai** | Σ `revenue_recognition` (`status = RECOGNIZED`, davr bo'yicha `recognized_at`) |
| **Tan olish qoidasi** (Recognition rule) | Xizmat turi bo'yicha: `ON_COMPLETION` (yakunlanish + akt), `STRAIGHT_LINE` (obuna — oyma-oy teng), `ON_PAYMENT` (kichik xizmat — to'lov kelganda), `MILESTONE` (qo'lda bosqichma-bosqich) | `service_types.recognition_rule` (admin sozlaydi) |
| **Qabul akti** (ACT) | Xizmat yakunlanganini tasdiqlovchi hujjat; qoida talab qilsa, aktsiz daromad tan olinmaydi | `contract_documents.doc_type = ACT` |
| **Tasdiq kutayotgan tan olish** | Summasi chegaradan (`revenue.approval_threshold`, default 50 mln) katta tan olish — CFO tasdiqlaydi (AI safety) | `revenue_recognition.status = PENDING_APPROVAL` + `approvals` |
| **Pul holatlari** (revenue events) | Har bir to'lovning holati: `CUSTOMER_ADVANCE` → `RECOGNIZED_REVENUE` (tan olinganda FIFO), `REFUNDABLE` → `REFUNDED` | `revenue_events.state` |
| **Kutilayotgan daromad** (Expected revenue / backlog) | Faol shartnomalarning hali tan olinmagan qismi | Σ (`contracts.amount − tan olingan`) faol shartnomalar |
| **Reversal** | Tan olishni «o'chirish» o'rniga qarama-qarshi (manfiy) yozuv | `revenue_recognition.method = REVERSAL`, audit log |

## 3. Shartnoma va to'lov (Contract → Payment)

| Atama | Ma'nosi | Formula |
|---|---|---|
| **Shartnoma summasi** | Contract amount | `contracts.amount` |
| **Avans** | Advance % / amount | `amount × advance_pct / 100`, muddati `advance_due_date` |
| **Yakuniy to'lov** | Expected final payment | `amount − advance_amount`, muddati `payment_due_date` |
| **To'langan** | Paid | Σ `payments` (reversal qilinmagan) |
| **Qoldiq / Debitorlik** | Remaining / receivable | `amount − paid` |
| **To'lov %** | Paid % | `paid / amount × 100` (progress bar) |
| **To'lov jadvali** | Payment schedule | `payment_schedules` (ADVANCE / FINAL / INSTALLMENT) — statusi EXPECTED / PAID / OVERDUE |
| **Shartnoma statusi** | Contract status | DRAFT → ACTIVE → ADVANCE_EXPECTED → ADVANCE_RECEIVED → IN_PROGRESS → SERVICE_COMPLETED → FINAL_PAYMENT_EXPECTED → PAID; OVERDUE; CLOSED; CANCELLED. **Avtomatik** hisoblanadi (to'lov + xizmat holati + sana), faqat DRAFT/CLOSED/CANCELLED qo'lda |
| **Xizmat holati** | Service status | NOT_STARTED / IN_PROGRESS / ON_HOLD / COMPLETED / CANCELLED (qo'lda; COMPLETED → revenue engine) |
| **To'lov holati** | Payment status | 🟢 PAID · 🟡 EXPECTED/PARTIAL · 🔴 OVERDUE · ⚫ CANCELLED |
| **Identifikatsiya** | — | `company_id + contract_id + contract_number + service_type` — faqat nom/INN orqali bog'lash taqiqlangan (bitta kompaniyada bir necha shartnoma) |

## 4. Debitorlik va undiruv (Receivables & Collection)

| Atama | Ma'nosi | Formula |
|---|---|---|
| **TOTAL RECEIVABLE** | Barcha faol shartnomalar qoldig'i | Σ `remaining` |
| **OVERDUE** | Muddati o'tgan qism | To'lovlar jadvalga FIFO taqsimlanadi; `due_date < bugun` bo'lgan to'lanmagan qismlar yig'indisi |
| **CRITICAL** | Kritik qarz | OVERDUE qismi, kechikish ≥ `collection.critical_days` (default 15 kun) |
| **Kechikish (kun)** | Days overdue | `bugun − eng eski to'lanmagan muddat` |
| **Aging** | Qarz yoshi | Muddati kelmagan · 0–7 · 8–15 · 16–30 · 31–60 · 60+ kun |
| **Collection bosqichlari** | T-7 Upcoming → T-3 Reminder → T-0 Payment expected → T+1 OVERDUE → T+3 Collection task → T+7 Escalation → T+15 Critical debt | sozlama `collection.stages`; agent har kuni vazifa + bildirishnoma yaratadi |

## 5. Xarajat va tasdiqlash (Expenses & Approvals)

| Atama | Ma'nosi |
|---|---|
| **Xarajat so'rovi** (EXP-000721) | Kim? Qaysi bo'lim? Nima uchun? Qancha? Qachonga? Qaysi shartnoma? → status PENDING → approval zanjiri |
| **Approval qoidalari** | Summa oralig'i → rollar zanjiri (default: <5M Dept Head; 5–20M Dept Head→Finance; 20–100M Dept Head→CFO; 100M+ CFO→CEO). Hard-code emas, admin o'zgartiradi |
| **Xarajat statuslari** | PENDING → APPROVED → PAID; REJECTED; POSTPONED; reversal |
| **Kategoriya (AI)** | Matndan kalit so'zlar bo'yicha; confidence < 0.8 → inson tasdiqlaydi (`AI_RULE_UNCONFIRMED`) |
| **P&L guruhi** | Har kategoriya: DIRECT (to'g'ridan-to'g'ri xarajat), PAYROLL, MARKETING, ADMIN, IT, OFFICE, OTHER_OPEX, TAX, OTHER |
| **Cash flow klassi** | OPERATING / INVESTING (jihozlar) / FINANCING (kredit, ta'sischi) |
| **Doimiy xarajatlar** | Recurring: ijara, hosting, software, kommunal, oylik — treasury va forecast «kutilayotgan chiqim»ga kiradi |
| **Katta xarajat alert** | `expense.large_expense_alert` (default 30 mln) → CFO/CEO bildirishnoma |

## 6. P&L, Cash Flow, Balans

| Atama | Formula |
|---|---|
| **REVENUE** | Tan olingan daromad (davr) |
| **GROSS PROFIT** | Revenue − Direct costs (DIRECT guruh) |
| **OPERATING PROFIT** | Gross − (Payroll + Marketing + Administrative + IT + Office + Other OPEX) |
| **NET PROFIT** | Operating − Taxes − Other expenses |
| **Margin %** | Net / Revenue × 100 |
| **Xizmat rentabelligi** | Har xizmat: Revenue − Direct expense (shartnomaga bog'langan) − Payroll (bo'lim) − Bo'lim OPEX − Allocated OPEX (umumiy OPEX revenue ulushiga ko'ra) = Net profit; verdict OK / LOW (<15%) / LOSS |
| **Opening / Closing cash** | Davr boshidagi va oxiridagi jami pul |
| **Operating / Investing / Financing CF** | Tranzaksiyalar `cf_class` bo'yicha kirim − chiqim |
| **Aktivlar** | Bank + Kassa + Debitorlik (faqat tan olingan, lekin pul kelmagan qism) |
| **Majburiyatlar** | Mijoz avanslari (deferred revenue) + Kreditorlik (tasdiqlangan to'lanmagan xarajat) + Oylik qarzi |
| **Kapital** | Aktivlar − Majburiyatlar |

## 7. Plan/Fakt, Forecast, KPI

| Atama | Ma'nosi |
|---|---|
| **Plan/Fakt** | Oy bo'yicha Revenue, Expense, Profit, Cash, Collection: plan (kiritiladi) vs fakt (hisoblanadi), % = fakt/plan; OK / WARN (±tolerance) / BAD |
| **Byudjet** | Bo'lim/kategoriya bo'yicha oylik limit, oshsa BUDGET_EXCEEDED alert |
| **Forecast** | 7/30/90/180/365 kun: kirim = jadval bo'yicha muddati oynada × undirish %, + muddati o'tgan × %, + pipeline (DRAFT shartnomalar avansi) × %; chiqim = (tasdiqlangan to'lanmagan + doimiy + oylik + o'zgaruvchan OPEX 3 oy o'rtacha) × koeff. Scenariylar: conservative / base / optimistic (sozlamada) |
| **Prognoz pul** | `hozirgi pul + kirim − chiqim` |
| **Risk** | conservative available < likvidlik chegarasi → HIGH; base < chegara → MEDIUM; aks holda LOW |
| **Oylik** | Gross = Fixed + KPI + Piece-rate + Bonus + Certificate bonus + Other − Penalty; Deductions = Gross × soliq %; Net = Gross − Deductions − Advance |
| **KPI qoidalari** | PCT_OF_DEPT_REVENUE, PCT_OF_OWN_REVENUE, PER_UNIT, THRESHOLD_BONUS, PCT_OF_FIXED — bo'lim/xizmat turi bo'yicha, admin qo'shadi |
| **Oylik zanjiri** | Department Head → Executive Director (CEO) → Finance Director (CFO) → Accounting → PAID |

## 8. Reconciliation (bank ↔ shartnoma)

| Atama | Ma'nosi |
|---|---|
| **Matching status** | UNMATCHED (bog'lanmagan) · SUGGESTED (AI taklifi, tasdiq kerak) · MATCHED (bog'langan → to'lov yozildi) · IGNORED (shartnomaga tegishli emas: LOAN, REFUND, …) |
| **Confidence** | Ball: shartnoma raqami 70 · INN 30 · summa = qoldiq/avans/jadval 20 · kontragent nomi ≤10 · sana ±10 kun 5 (max 99). ≥95 va yagona nomzod → avtomatik; 60–94 → SUGGESTED; <60 → UNMATCHED. Chegaralar sozlamada |
| **Unmatch / Reversal** | Bog'lanishni bekor qilish to'lovni reversal qiladi (o'chirmaydi), daromad eventlari qaytariladi |

## 9. AI, xavfsizlik, audit

| Atama | Ma'nosi |
|---|---|
| **AI taklifi** (ai_actions) | Agent aniqlaydi → taklif qiladi (PROPOSED) → inson tasdiqlaydi → tizim bajaradi (EXECUTED) → audit log. AI hech qachon: tranzaksiya o'chirmaydi, pul yubormaydi, xarajat/tan olishni tasdiqlamaydi, shartnoma summasi/maoshni o'zgartirmaydi |
| **Data Quality** | To'lov muddati yo'q · bog'lanmagan tranzaksiya · to'lov bor, xizmat boshlanmagan (14+ kun) · yakunlangan, akt yo'q · kategoriya tasdiqlanmagan · muddati tugagan, yakunlanmagan · ortiqcha to'lov · INN yo'q · tan olish 3+ kun kutmoqda · oylik hisoblanmagan · tasdiq 48+ soat |
| **Audit log** | user, rol, action, entity, old/new value, vaqt, IP, manba (WEB/API/TELEGRAM/AI/SYSTEM), approval_id, ai_agent |
| **RBAC** | 11 rol × 23 resurs × 7 action (VIEW/CREATE/EDIT/APPROVE/REJECT/DELETE/EXPORT), admin panelda tahrirlanadi |
