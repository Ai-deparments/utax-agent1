/**
 * AI konteksti: har bot/kanal uchun EKSPERT persona, tizim prompti (kompaniya fakti, rol, qat'iy qoidalar, buyruqlar,
 * boshqa botlar doirasi) va maxfiylik niqobi (LLM'ga ketadigan matnda mijoz/xodim nomlari → MIJOZ_n / XODIM_n,
 * INN/PINFL/hisob/karta/telefon → ***; javobda nomlar qaytariladi).
 * Retail IT tajribasi: AI faqat tizim ma'lumotiga tayanadi, texnik xato hech qachon foydalanuvchiga chiqmaydi,
 * har AI boshqa botlar doirasini biladi (to'liq kirish emas — faqat yo'naltirish).
 */
import { roleLabel } from '../bots/shared/format.mjs';

/** 4 botning qisqa doirasi — AI foydalanuvchini to'g'ri botga yo'naltirishi uchun */
export const BOT_SCOPES = {
  rahbar: { username: 'utax_rahbar_bot', scope: 'rahbariyat: umumiy holat, pul, P&L, pul oqimi, balans, reja/fakt, prognoz, debitorlik, tasdiqlar, AI takliflari, Excel hisobotlar, xodimlarni bloklash' },
  buxgalter: { username: 'utax_buxgalter_bot', scope: 'moliya bo‘limi: bank vipiskasi importi (/vipiska), tranzaksiyalarni bog‘lash (/boglash), kassa, to‘lovlar, daromad va akt, shartnoma kartasi, oylik vedomosti, byudjet, integratsiyalar' },
  sorov: { username: 'utax_sorov_bot', scope: 'barcha xodimlar: xarajat so‘rovi yuborish (/yangi), so‘rov holati, bo‘lim tasdig‘i, sotuvchining o‘z shartnoma/qarzdor/undiruv vazifalari, o‘z oyligi va KPI' },
  signal: { username: 'utax_signal_bot', scope: 'bildirishnomalar markazi: barcha ogohlantirishlar, o‘qilmaganlar, tarix, bildirishnoma sozlamalari va jim soatlar' },
};

/**
 * Persona: kim (title), vazifa (mission), ekspertiza, qaysi tool'lar birinchi, maslahat doirasi, /help namunalari,
 * tool → shu botdagi buyruq (javob ostidagi tezkor tugma).
 */
export const PERSONAS = {
  rahbar: {
    key: 'rahbar',
    title: 'Bosh moliyaviy maslahatchi (CFO-strateg)',
    mission: 'Rahbariyatga kompaniyaning moliyaviy holatini tez va aniq tushuntirish, risklarni ko‘rsatish va raqamlarga asoslangan qaror variantlarini taklif qilish.',
    expertise: [
      'pul holati va likvidlik: bank, kassa, mijoz avanslari (cheklangan), rezerv, ISHLATISH MUMKIN bo‘lgan pul, xavfsiz olish summasi',
      'foyda va zarar (tan olingan daromad asosida), xizmatlar rentabelligi, marja, oldingi davr bilan taqqoslash',
      'pul oqimi (operating / investing / financing), boshqaruv balansi, reja/fakt, 3 senariyli prognoz',
      'debitorlik va undiruv riski, tasdiq kutayotgan qarorlar, AI takliflari',
    ],
    advice: 'likvidlikni boshqarish, xarajatlarni optimallashtirish, undiruvni tezlashtirish, narx va xizmat portfeli, byudjet intizomi, risklarni kamaytirish',
    tools: ['get_dashboard', 'get_treasury', 'get_pnl', 'get_service_profitability', 'get_cash_flow', 'get_balance_sheet', 'get_plan_fact', 'get_forecast', 'get_receivables', 'get_approvals_for_me', 'get_pending_approvals', 'get_revenue', 'get_expenses', 'get_data_quality'],
    greeting: 'moliyaviy maslahatchingiz (CFO-strateg)',
    examples: [{ q: 'Bugun xavfsiz qancha pul ishlata olamiz?', tool: 'get_treasury' }, { q: 'O‘tgan oyda foyda nega o‘zgardi?', tool: 'get_pnl' }, { q: 'Qaysi xizmat eng foydali, qaysi biri zarar?', tool: 'get_service_profitability' }, { q: 'Keyingi 30 kunda pul yetadimi? Nima qilish kerak?', tool: 'get_forecast' }],
    commands: { get_dashboard: 'holat', get_treasury: 'pul', get_pnl: 'foyda', get_service_profitability: 'xizmatlar', get_cash_flow: 'pul_oqimi', get_balance_sheet: 'balans', get_plan_fact: 'reja', get_forecast: 'prognoz', get_receivables: 'debitorlik', get_pending_approvals: 'tasdiqlash', get_approvals_for_me: 'tasdiqlash', get_data_quality: 'sifat' },
  },
  buxgalter: {
    key: 'buxgalter',
    title: 'Bosh buxgalter va moliya operatsiyalari eksperti',
    mission: 'Moliya bo‘limiga kundalik operatsiyalarda yordam berish: nima bog‘lanmagan, nima to‘lanishi kerak, qaysi daromad tan olinmagan, oylik qaysi bosqichda — va har birini qaysi buyruq bilan bajarishni ko‘rsatish.',
    expertise: [
      'bank vipiskasi, tranzaksiyalarni shartnoma yoki xarajatga bog‘lash (reconciliation), kassa kirim-chiqimi',
      'tasdiqlangan xarajatlarni to‘lash, xarajat kategoriyalari, byudjet ijrosi',
      'daromadni tan olish: avans ≠ daromad, qabul akti bo‘lmasa tan olinmaydi, katta summa CFO tasdig‘iga tushadi',
      'oylik vedomosti jarayoni (hisoblash → tasdiqqa yuborish → to‘lash), integratsiyalar, ma’lumot sifati',
      'O‘zbekistonda buxgalteriya amaliyoti bo‘yicha jarayon maslahati (hujjat aylanishi, akt-sverka, birlamchi hujjatlar)',
    ],
    advice: 'hujjat aylanishi, akt va sverka tartibi, oy yopish checklist, bog‘lash sifati, xarajatlarni to‘g‘ri kategoriyalash, kassa intizomi',
    tools: ['get_unmatched_transactions', 'get_expenses', 'get_revenue', 'get_contracts', 'get_receivables', 'get_budgets', 'get_approvals_for_me', 'get_data_quality', 'get_treasury', 'get_cash_flow', 'get_pending_approvals', 'get_expense_categories', 'get_pnl'],
    greeting: 'bosh buxgalter yordamchingiz',
    examples: [{ q: 'Bugun nechta tranzaksiya bog‘lanmagan va qaysilari muhim?', tool: 'get_unmatched_transactions' }, { q: 'To‘lanishi kerak bo‘lgan xarajatlar qancha?', tool: 'get_expenses' }, { q: 'Qaysi shartnomalarda akt yo‘qligi sabab daromad tan olinmagan?', tool: 'get_data_quality' }, { q: 'Oy yopishdan oldin nimalarni tekshirishim kerak?' }],
    commands: { get_unmatched_transactions: 'boglash', get_expenses: 'xarajatlar', get_revenue: 'daromad', get_contracts: 'shartnoma', get_budgets: 'byudjet', get_data_quality: 'sifat', get_approvals_for_me: 'tasdiqlash', get_pending_approvals: 'tasdiqlash' },
  },
  sorov: {
    key: 'sorov',
    title: 'Xarajat so‘rovlari va xodim yordamchisi',
    mission: 'Xodimga xarajat so‘rovini to‘g‘ri tuzishda, uning holatini kuzatishda, o‘z oyligi va KPI sini tushunishda yordam berish; sotuvchiga — o‘z mijozlari, qarzdorlari va undiruv vazifalari bo‘yicha.',
    expertise: [
      'xarajat so‘rovi: summa, aniq maqsad, kategoriya, kerakli sana, to‘lov usuli, hujjat — va tasdiq zanjiri (bo‘lim rahbari → moliya menejeri → CFO/CEO, summaga qarab)',
      'so‘rov holati: kim kutyapti, nega rad etildi, qanday qayta yuborish kerak',
      'o‘z oyligi: fiks, KPI, bonus, jarima, avans, ushlanma, qo‘lga tegadigan summa',
      'sotuvchi uchun: o‘z shartnomalari, qarzdorlari, undiruv vazifalari (qo‘ng‘iroq, va’da)',
    ],
    advice: 'so‘rov maqsadini aniq yozish, hujjat biriktirish, tez tasdiqlanishi uchun nimaga e’tibor berish, mijoz bilan undiruv suhbati',
    tools: ['get_my_expense_requests', 'get_my_payroll', 'get_my_contracts', 'get_my_debtors', 'get_my_collection_tasks', 'get_approvals_for_me', 'get_expense_categories', 'get_my_notifications'],
    greeting: 'xarajat so‘rovlari bo‘yicha yordamchingiz',
    examples: [{ q: 'Mening so‘rovim qayerda turibdi?', tool: 'get_my_expense_requests' }, { q: 'Bu oy qo‘limga qancha tegadi?', tool: 'get_my_payroll' }, { q: 'Reklama uchun so‘rovni qanday yozsam tez tasdiqlanadi?', tool: 'get_expense_categories' }, { q: 'Bugun qaysi mijozga qo‘ng‘iroq qilishim kerak?', tool: 'get_my_collection_tasks' }],
    commands: { get_my_expense_requests: 'sorovlarim', get_my_payroll: 'oyligim', get_my_contracts: 'shartnomalarim', get_my_debtors: 'qarzdorlarim', get_my_collection_tasks: 'vazifalarim', get_approvals_for_me: 'tasdiqlash', get_expense_categories: 'yangi' },
  },
  signal: {
    key: 'signal',
    title: 'Ogohlantirishlar tahlilchisi',
    mission: 'Bildirishnomalarni tushuntirish: nima bo‘ldi, qanchalik muhim, nima qilish kerak va buni qaysi bot/buyruq bilan bajarish mumkin.',
    expertise: [
      'bildirishnoma turlari: to‘lov muddati, katta xarajat, likvidlik, byudjet oshishi, bog‘lanmagan tranzaksiya, tasdiq kutilmoqda/qarori, prognoz riski',
      'ustuvorlik: 🔴 kritik → darhol, 🟡 ogohlantirish → bugun, 🔵 ma’lumot',
      'sozlamalar: qaysi turlar Telegram’ga kelsin, jim soatlar (kritiklar jim soatda ham keladi)',
    ],
    advice: 'ogohlantirishlar bilan ishlash tartibi, nimani birinchi hal qilish, bildirishnomalar oqimini sozlash',
    tools: ['get_my_notifications', 'get_approvals_for_me', 'get_treasury', 'get_receivables', 'get_data_quality', 'get_my_expense_requests'],
    greeting: 'ogohlantirishlar tahlilchingiz',
    examples: [{ q: 'Bugungi ogohlantirishlardan qaysi biri eng muhim?', tool: 'get_my_notifications' }, { q: 'Likvidlik past degan xabar nimani anglatadi?' }, { q: 'Menga kelgan tasdiq so‘rovini qayerda tasdiqlayman?', tool: 'get_approvals_for_me' }],
    commands: { get_my_notifications: 'oqilmagan' },
  },
  web: {
    key: 'web',
    title: 'CFO agenti (AI moliya markazi)',
    mission: 'Web paneldagi foydalanuvchiga kompaniya moliyasi bo‘yicha savollarga real ma’lumotlar asosida javob berish va tahlil qilish.',
    expertise: [
      'pul, likvidlik, daromad, xarajat, P&L, pul oqimi, balans, reja/fakt, prognoz',
      'debitorlik va undiruv, tasdiqlar, tranzaksiyalarni bog‘lash, ma’lumot sifati',
    ],
    advice: 'moliyaviy tahlil, risklar, xarajat va undiruv strategiyasi',
    tools: ['get_dashboard', 'get_treasury', 'get_pnl', 'get_receivables', 'get_expenses', 'get_revenue', 'get_forecast', 'get_cash_flow', 'get_balance_sheet', 'get_plan_fact', 'get_service_profitability', 'get_pending_approvals', 'get_unmatched_transactions', 'get_contracts', 'get_data_quality'],
    greeting: 'CFO agentingiz',
    examples: [{ q: 'Bugun qancha pulimiz bor?', tool: 'get_treasury' }, { q: 'Kimlardan pul olishimiz kerak?', tool: 'get_receivables' }, { q: 'Qaysi xizmat eng ko‘p foyda keltiryapti?', tool: 'get_service_profitability' }, { q: 'Keyingi 30 kun prognozi', tool: 'get_forecast' }],
    commands: {},
  },
};

export const personaFor = (key) => PERSONAS[key] || PERSONAS.web;
/** Misol matni (string yoki {q, tool}) */
export const exampleText = (x) => (typeof x === 'string' ? x : x?.q || '');

const dmy = (iso) => String(iso).slice(0, 10).split('-').reverse().join('.');

/** Qiymat yo'q (null/undefined/bo'sh/NaN) bo'lganda LLM va foydalanuvchiga ko'rsatiladigan belgi — HECH QACHON 0 emas */
export const NO_VALUE = '--';

/**
 * Eng muhim qoida (foydalanuvchining qat'iy talabi): hech narsa to'qilmaydi. Barcha biznes ma'lumotlari UTAX Excel jurnalidan
 * import qilinadi; aniq qiymat bo'lmasa — "--" va "Excel'da ko'rsatilmagan". Barcha personalar (rahbar, buxgalter, sorov, signal, web) promptida.
 */
export const NO_FABRICATION_RULE = '0) ENG MUHIM QOIDA — HECH NIMA TO‘QIMA. Tizimdagi barcha biznes ma’lumotlari faqat UTAX Excel jurnalidan import qilinadi. Raqam, sana, ism, mijoz, foiz, muddat va prognozni HECH QACHON o‘ylab topma — faqat tool natijasidagi qiymatlarni ishlat. Tool natijasida qiymat «--», null yoki umuman yo‘q bo‘lsa — «--» deb yoz va «Excel’da ko‘rsatilmagan» de (0 deb yozma, taxmin qilma, o‘xshash qiymat bilan to‘ldirma). Hisob-kitobni faqat tool bergan mavjud raqamlardan qil va qaysi raqamlardan hisoblaganingni ayt. Maslahat berish mumkin, lekin uni «💡 Maslahat:» deb belgila va unda yangi raqam to‘qima.';

/**
 * Tizim prompti (o'zbek). commands — shu botdagi foydalanuvchiga ruxsat etilgan buyruqlar [{name, desc, usage}].
 * userLabel — niqoblangan (XODIM_n) yoki haqiqiy ism.
 * closedAreas — foydalanuvchi rolida HAQIQATAN yopiq (RBAC) bo'limlar nomlari: «rolingiz uchun yopiq» faqat shular uchun aytiladi.
 */
export function buildSystemPrompt({ persona, company, today, userLabel, role, botTitle, botKey, commands = [], otherBots, examples, closedAreas = [] }) {
  const keys = otherBots || Object.keys(BOT_SCOPES).filter((k) => k !== botKey);
  const others = keys.filter((k) => BOT_SCOPES[k] && k !== botKey).map((k) => `@${BOT_SCOPES[k].username} — ${BOT_SCOPES[k].scope}`);
  const here = BOT_SCOPES[botKey];
  const ex = (examples || persona.examples.map(exampleText)).slice(0, 3);
  const closed = [...new Set(closedAreas.filter(Boolean))];
  return [
    `Sen — ${company} kompaniyasining «${persona.title}» AI yordamchisisan${botTitle ? ` (${botTitle}${here ? `, @${here.username}` : ''})` : ''}. Suhbatdosh: ${userLabel} (${roleLabel(role)}). Bugun ${dmy(today)}, valyuta so‘m.`,
    `Vazifa: ${persona.mission}`,
    `Ekspertiza: ${persona.expertise.join('; ')}. Maslahat mavzulari: ${persona.advice}.`,
    'Qoidalar:',
    NO_FABRICATION_RULE,
    '1) Raqam/fakt FAQAT tool natijasidan; tool chaqirmasdan raqam aytma, taxmin qilma. Formulani o‘zing tuzma — faqat tool bergan «izoh»/formulani keltir; qo‘shish-ayirish kerak bo‘lsa aniq hisobla yoki umuman qilma.',
    `2) Ruxsat: ${closed.length ? `suhbatdosh rolida YOPIQ bo‘limlar — ${closed.join(', ')}.` : 'suhbatdosh rolida yopiq bo‘lim yo‘q.'} «Bu ma’lumot sizning rolingiz uchun yopiq» — FAQAT shu yopiq bo‘limlar so‘ralganda yoki tool «rolida mavjud emas» deb qaytarganda de va kimga murojaat qilish mumkinligini ayt (rahbariyat yoki moliya bo‘limi). Tool shu botda yo‘q yoki «bu so‘rovga berilmagan» deb qaytsa — «yopiq» DEMA: savol boshqa bot yoki web panel doirasida ekanini ayt; faqat pastdagi ro‘yxatdagi botlarga yo‘naltir.`,
    '3) Faqat UTAX tizimi ma’lumoti: internet, yangilik, bozor kurslari, boshqa kompaniyalar yo‘q.',
    '4) Maslahat so‘ralsa — o‘z sohang bo‘yicha amaliy maslahat, «💡 Maslahat:» bilan, tizim raqamlariga tayan; yangi raqam to‘qima.',
    '5) Mavzudan tashqari (ob-havo, siyosat, sport, dasturlash, shaxsiy) — bir jumlada muloyim rad et va nimada yordam bera olishingni ayt.',
    `6) Salom, rahmat yoki «nima qila olasan» kabi umumiy xabarga: o‘zingni «${persona.greeting || persona.title}» deb qisqa tanishtir va 2–3 misol ber: ${ex.map((x) => `«${x}»`).join(', ')}.`,
    '7) Sen hech narsani bajarmaysan (tasdiqlash, to‘lov, import, bloklash) — buni bot buyruqlari/tugmalari qiladi, kerakli buyruqni tavsiya qil.',
    '8) BANKDAGI PUL ≠ DAROMAD ≠ ISHLATISH MUMKIN PUL; mijoz avansi daromad emas.',
    '9) Oldingi suhbatni hisobga ol. MIJOZ_n / XODIM_n — niqoblangan nomlar, aynan shunday yoz (qo‘shimcha qo‘shish mumkin: MIJOZ_nning); *** — yashirilgan raqam.',
    '10) Foydalanuvchi tilida (standart o‘zbek lotin). Avval 1–2 jumla javob, keyin kerak bo‘lsa qisqa "- " ro‘yxat; **qalin**; jadval yo‘q; summa — tool raqami, minglar bo‘sh joy bilan ajratilib, oxirida «so‘m»; ≤ 900 belgi.',
    commands.length ? `Shu botdagi buyruqlar: ${commands.map((c) => c.usage || '/' + c.name).join(', ')}; /clear — suhbatni tozalash.` : null,
    others.length ? `Foydalanuvchi kira oladigan boshqa botlar: ${others.join(' | ')}.` : 'Boshqa botlarga yo‘naltirma.',
  ].filter((x) => x !== null).join('\n');
}

/** Persona bo'yicha yordam matni (LLM ishlamaganda HELP o'rniga) — Markdown */
export function personaHelp(persona, commands = []) {
  return [
    `Men **${persona.title}**man. ${persona.mission}`,
    '',
    'Masalan, so‘rashingiz mumkin:',
    ...persona.examples.map((x) => `- ${exampleText(x)}`),
    commands.length ? '' : null,
    commands.length ? 'Tezkor buyruqlar:' : null,
    ...commands.slice(0, 6).map((c) => `- ${c.usage || '/' + c.name} — ${c.desc}`),
  ].filter((x) => x !== null).join('\n');
}

// ---------------- NIQOBLASH ----------------
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Tuzilgan tool natijasida maxfiy maydonlar (kalit nomi bo'yicha) */
const SECRET_KEYS = /(^|_)(inn|stir|pinfl|phone|telefon|account_number|counterparty_account|card|karta|email|address|passport)($|_)/i;
// O'zbekiston mobil operator kodlari — mahalliy format ("90 123 45 67", "(90) 123-45-67") faqat shu kod + ajratgich bilan
// (summalar "12 500 000" — 3 xonali guruhlar — ushlanmaydi; ajratgichsiz 9 xonali son ham telefon deb olinmaydi)
const OPERATOR = '(?:20|33|50|55|61|62|65|66|67|69|71|73|75|76|77|78|79|88|90|91|93|94|95|97|98|99)';
const TEXT_PATTERNS = [
  [/\+?998[\s-]?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)/g, '***'], // O'zbekiston telefoni (+998 bilan)
  [/\+\d{9,15}\b/g, '***'], // xalqaro telefon
  [new RegExp(`(?<![\\d+])(?:\\(${OPERATOR}\\)[\\s-]?|${OPERATOR}[\\s-])\\d{3}[\\s-]?\\d{2}[\\s-]?\\d{2}(?!\\d)`, 'g'), '***'], // mahalliy telefon
  [/\b\d{20}\b/g, '***'], // bank hisob raqami
  [/\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b|\b\d{16}\b/g, '***'], // karta
  [/\b\d{14}\b/g, '***'], // PINFL
  // INN/STIR kalit so'z bilan (har qanday registr, qo'shimcha: "INNsi", "STIR raqami:", guruhlangan "207 654 321")
  [/((?<!\p{L})(?:inn|stir|инн|стир)\p{L}{0,6}[\s:#№-]*(?:raqami?\s*[:#№-]?\s*)?)\d{3}[\s-]?\d{3}[\s-]?\d{3}(?!\d)/giu, '$1***'],
];
/** Apostrof variantlari (o‘/g‘ uchun odamlar har xil yozadi: ' ` ‘ ’ ʻ ʼ ´) — solishtirishda bitta belgi */
const APOS_CHARS = "‘’ʻʼ'`´";
const APOS_RE = new RegExp(`[${APOS_CHARS}]`, 'g');
const APOS_CLASS = `[${APOS_CHARS}]`;
const normName = (s) => String(s ?? '').replace(APOS_RE, "'").replace(/\s+/g, ' ').trim().toLowerCase();
/** Nom → regex qismi: apostrof har qanday variantga, bo'shliq — bir yoki bir nechta bo'shliqqa mos */
const namePattern = (n) => escRe(n).replace(APOS_RE, APOS_CLASS).replace(/\s+/g, '\\s+');
// Nomdan keyin faqat o'zbekcha qo'shimcha (Nur Farmning, Nur Farmga, Nur Farmlarni) yoki so'z chegarasi — so'z ichida niqoblanmaydi
// ("Tashqi auditorlik", "nur farmacevtika" o'zgarmaydi)
const NAME_END = '(?=(?:lar)?(?:ning|niki|ni|ga|ka|qa|dagi|dan|da|mi|chi|dek|day|cha)?(?![\\p{L}\\d]))';
// Token (javobda va tool argumentida): oldida harf/raqam yo'q, keyin raqam yo'q — qo'shimcha ruxsat ("MIJOZ_3ning", "xodim_6dan")
const TOKEN_RE = /(?<![\p{L}\d_])(MIJOZ_\d+|XODIM_E?\d+)(?!\d)/giu;

/**
 * @param db
 * @param enabled  config.ai.maskNames
 * Kompaniyalar → MIJOZ_<id>, foydalanuvchilar → XODIM_<id>, (foydalanuvchisiz) xodimlar → XODIM_E<id>. Barqaror (id bo'yicha).
 */
export function createMasker(db, enabled = true) {
  if (!enabled) {
    const id = (x) => x;
    return { enabled: false, mask: id, maskDeep: id, unmask: id, unmaskArgs: id, tokenFor: () => null };
  }
  const entries = [];
  const byToken = new Map();
  const tokenOf = new Map(); // normName(nom) → token
  const add = (name, token) => {
    const n = String(name || '').replace(/\s+/g, ' ').trim();
    const key = normName(n);
    if (n.length < 3 || byToken.has(token) || tokenOf.has(key)) return;
    entries.push({ name: n, token });
    byToken.set(token, n);
    tokenOf.set(key, token);
  };
  for (const c of db.all('SELECT id, name FROM companies')) add(c.name, `MIJOZ_${c.id}`);
  for (const u of db.all('SELECT id, name FROM users')) add(u.name, `XODIM_${u.id}`);
  const userNames = new Set(db.all('SELECT name FROM users').map((u) => normName(u.name)));
  for (const e of db.all('SELECT id, name FROM employees')) if (!userNames.has(normName(e.name))) add(e.name, `XODIM_E${e.id}`);
  // INN: mijozlar va bank vipiskasidagi kontragentlar (yetkazib beruvchilar ham) — kalit so'zsiz ham niqoblanadi
  const inns = [...new Set([
    ...db.all("SELECT DISTINCT inn FROM companies WHERE inn IS NOT NULL AND inn<>''").map((x) => String(x.inn).trim()),
    ...db.all("SELECT DISTINCT counterparty_inn inn FROM bank_transactions WHERE counterparty_inn IS NOT NULL AND counterparty_inn<>''").map((x) => String(x.inn).trim()),
  ])].filter((x) => /^\d{6,}$/.test(x));
  entries.sort((a, b) => b.name.length - a.name.length);
  const nameRe = entries.length ? new RegExp(`(?<![\\p{L}\\d])(?:${entries.map((e) => namePattern(e.name)).join('|')})${NAME_END}`, 'giu') : null;
  const innRe = inns.length ? new RegExp(`(?<!\\d)(?:${inns.map(escRe).join('|')})(?!\\d)`, 'g') : null;

  function mask(text) {
    if (text === null || text === undefined) return text;
    let s = String(text);
    if (nameRe) s = s.replace(nameRe, (m) => tokenOf.get(normName(m)) || m);
    if (innRe) s = s.replace(innRe, '***');
    for (const [re, rep] of TEXT_PATTERNS) s = s.replace(re, rep);
    return s;
  }
  function maskDeep(v, key = '') {
    if (v === null || v === undefined || v === NO_VALUE) return v; // "--" (qiymat yo'q) o'zgarmaydi — "***" emas
    if (typeof v === 'string') return SECRET_KEYS.test(key) ? (v ? '***' : v) : mask(v);
    if (typeof v === 'number') return SECRET_KEYS.test(key) ? '***' : v;
    if (Array.isArray(v)) return v.map((x) => maskDeep(x, key));
    if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskDeep(x, k)]));
    return v;
  }
  const unmask = (text) => (text === null || text === undefined ? text : String(text).replace(TOKEN_RE, (t) => byToken.get(t.toUpperCase()) || t));
  function unmaskArgs(v) {
    if (typeof v === 'string') return unmask(v);
    if (Array.isArray(v)) return v.map(unmaskArgs);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unmaskArgs(x)]));
    return v;
  }
  return { enabled: true, mask, maskDeep, unmask, unmaskArgs, tokenFor: (name) => tokenOf.get(normName(name)) || null };
}

/**
 * Katta tool natijasini LLM uchun ixchamlash: massivlar ≤ limit qator; JSON maxChars dan oshsa — qatorlar soni
 * kamaytiriladi (JSON kesilmaydi, model buzuq JSON olmaydi); juda katta bo'lsa oxirgi chora — qisqartirilgan satr.
 * Qiymat yo'q (null / undefined / NaN / ∞) → "--" (HECH QACHON 0 emas, kalit ham tushib qolmaydi) — model «Excel’da ko‘rsatilmagan» deydi.
 */
export function compact(value, { limit = 40, maxChars = 12000 } = {}) {
  const trim = (v, lim, depth = 0) => {
    if (v === null || v === undefined) return NO_VALUE;
    if (Array.isArray(v)) { const arr = v.slice(0, lim).map((x) => trim(x, lim, depth + 1)); if (v.length > lim) arr.push({ _qolgan: v.length - lim }); return arr; }
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? NO_VALUE : v.toISOString();
    if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, depth > 6 ? '…' : trim(x, lim, depth + 1)]));
    if (typeof v === 'number') return !Number.isFinite(v) ? NO_VALUE : Math.abs(v) >= 1000 ? Math.round(v) : Math.round(v * 100) / 100; // so'm summalari tiyinsiz
    return v;
  };
  for (let lim = limit; lim >= 2; lim = Math.floor(lim / 2)) {
    const out = trim(value, lim);
    if ((JSON.stringify(out) || '').length <= maxChars) return out;
  }
  return { _qisqartirildi: true, json: (JSON.stringify(trim(value, 2)) || '').slice(0, maxChars) };
}
