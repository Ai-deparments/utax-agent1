/** Barcha botlar uchun umumiy matnlar (o'zbek, lotin). Bot-spetsifik matnlar — o'z papkasida. */
import { esc } from './html.mjs';
import { roleLabel, dt } from './format.mjs';

export const RESOURCE_LABEL = {
  dashboard: 'Bosh sahifa', treasury: 'Pul boshqaruvi', contracts: 'Shartnomalar', transactions: 'Tushumlar', reconciliation: 'Bog‘lash', revenue: 'Daromad',
  receivables: 'Debitorlik', collections: 'Undiruv', expenses: 'Xarajatlar', approvals: 'Tasdiqlashlar', pnl: 'Foyda va zarar', cashflow: 'Pul oqimi', balance: 'Balans',
  planfact: 'Reja / Fakt', forecast: 'Prognoz', payroll: 'KPI va oylik', ai: 'AI moliya', reports: 'Hisobotlar', integrations: 'Integratsiyalar',
  notifications: 'Bildirishnomalar', audit: 'Audit jurnali', settings: 'Sozlamalar', users: 'Foydalanuvchilar',
};
export const ACTION_LABEL = { VIEW: 'ko‘rish', CREATE: 'yaratish', EDIT: 'tahrirlash', APPROVE: 'tasdiqlash', REJECT: 'rad etish', DELETE: 'o‘chirish', EXPORT: 'eksport' };

export const T = {
  notLinked: (webHint) => [
    '🔐 <b>Telegram hisobingiz UTAX tizimiga bog‘lanmagan.</b>',
    '',
    'Bog‘lash (bir marta, barcha UTAX botlari uchun):',
    '1. Web panelga kiring',
    '2. <b>Sozlamalar → Profil → Telegram botlar</b> → «Ulash»',
    '3. Chiqqan havolani bosing yoki kodni shu yerga yuboring: <code>/start KOD</code>',
    webHint ? '' : null,
    webHint || null,
  ].filter((x) => x !== null).join('\n'),
  linkInvalid: '❌ Kod noto‘g‘ri yoki allaqachon ishlatilgan. Web → Sozlamalar → Profil → Telegram botlar bo‘limidan yangi kod oling.',
  linkExpired: '⌛ Kod muddati tugagan (24 soat). Web panelda yangi kod oling.',
  linkBlocked: (until) => `⛔ Juda ko‘p noto‘g‘ri kod. Bog‘lash vaqtincha to‘xtatildi — <b>${esc(dt(until))}</b> dan keyin qayta urinib ko‘ring.`,
  linkOwnerForeign: '🛡 Siz ega sifatida avtomatik bog‘langansiz; bu kod boshqa hisob uchun. Kod qabul qilinmadi — joriy bog‘lanishingiz o‘zgarmadi.',
  linkConfirm: (target, current) => [
    `🔁 <b>${esc(target.name)}</b> · ${esc(roleLabel(target.role_code))} hisobiga bog‘lansinmi?`,
    '',
    `Joriy bog‘lanish (<b>${esc(current.name)}</b> · ${esc(roleLabel(current.role_code))}) uziladi.`,
    '<i>Tasdiq 10 daqiqa amal qiladi.</i>',
  ].join('\n'),
  linkConfirmExpired: '⌛ Tasdiq muddati tugagan yoki kod o‘zgargan. Web paneldan yangi kod oling va /start KOD ni qayta yuboring.',
  linkCancelled: '✖️ Bog‘lash bekor qilindi. Joriy bog‘lanish o‘zgarmadi.',
  linked: (user) => `✅ <b>Bog‘landi!</b>\n${esc(user.name)} · ${esc(roleLabel(user.role_code))}\n\nEndi UTAX botlari sizni taniydi. Bildirishnomalar <b>@utax_signal_bot</b> orqali keladi — uni ham oching.`,
  blocked: '⛔ Hisobingiz bloklangan. Rahbariyatga murojaat qiling.',
  wrongBot: (role, suggestions) => [
    `🚫 Bu bot <b>${esc(roleLabel(role))}</b> roli uchun mo‘ljallanmagan.`,
    suggestions.length ? '\nSizga mos botlar:' : '',
    ...suggestions.map((s) => `• @${esc(s.username)} — ${esc(s.title)}`),
  ].filter(Boolean).join('\n'),
  forbidden: (resource, action) => `⛔ Ruxsat yo‘q: «${esc(RESOURCE_LABEL[resource] || resource)}» — ${esc(ACTION_LABEL[action] || action)}. Sizning rolingizda bu amal yopiq (web panel bilan bir xil qoida).`,
  forbiddenPlain: '⛔ Bu amal uchun ruxsatingiz yo‘q.',
  error: '⚠️ Xatolik yuz berdi. Moliya bo‘limiga xabar berildi — birozdan so‘ng qayta urinib ko‘ring.',
  cancelled: '✖️ Bekor qilindi.',
  nothingToCancel: 'Bekor qilinadigan ochiq amal yo‘q.',
  cleared: '🧹 Suhbat tozalandi: ochiq amallar bekor qilindi.',
  aiCleared: '🧹 AI suhbat tarixi tozalandi. Endi yangi mavzuda savol berishingiz mumkin.',
  unknownCommand: (cmd) => `❓ /${esc(cmd)} buyrug‘i bu botda yo‘q. /help — mavjud buyruqlar.`,
  expired: '⌛ Bu tugma eskirgan. Buyruqni qayta yuboring.',
  rateLimited: '⏳ Juda ko‘p so‘rov. Bir daqiqa kuting.',
  privateOnly: 'Bu bot faqat shaxsiy chatda ishlaydi.',
  fileUnexpected: '📎 Fayl hozir kutilmayapti. Avval tegishli buyruqni tanlang (/help).',
  aiNoAccess: 'Erkin savollar (AI moliya yordamchisi) sizning rolingiz uchun yopiq. /help — mavjud buyruqlar.',
  aiThinking: '🤔 O‘ylayapman…',
  dialogHint: '\n\n<i>/bekor — bekor qilish</i>',
  staleDialog: '⌛ Oldingi amal muddati tugagan (30 daqiqa). Qaytadan boshlang.',
  done: '✅ Bajarildi.',
  notFound: 'Topilmadi.',
  emptyList: 'Hozircha hech narsa yo‘q.',
};
