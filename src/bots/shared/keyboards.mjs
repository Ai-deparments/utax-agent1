/**
 * Inline tugmalar. Handlerlar tugmalarni oddiy obyekt sifatida beradi, factory ularni Telegram formatiga o'giradi:
 *   { text, cb: 'r.pf:2026-08' }   — callback (≤ 64 bayt)
 *   { text, cmd: 'holat', args? }  — shu botdagi buyruqni ishga tushiradi (RBAC qayta tekshiriladi)
 *   { text, web: 'contracts/5' }   — web panel sahifasi (HTTPS bo'lsa Telegram Mini App, aks holda URL; manzil yo'q bo'lsa tugma tushib qoladi)
 *   { text, url: 'https://…' }     — tashqi havola
 *   { text, cb: 'x' } / btn.cancel()  — «✖️ Bekor»: dialog ichida yuborilsa factory uni `x:<dialog teg>` ga aylantiradi (tagCancel)
 * Qatorlar: [[btn, btn], [btn]]. null / false elementlar va bo'sh qatorlar tashlab yuboriladi.
 */
export const btn = {
  cb: (text, data) => ({ text, cb: data }),
  cmd: (text, name, args = '') => ({ text, cmd: name, args }),
  web: (text, path) => ({ text, web: path }),
  url: (text, url) => ({ text, url }),
  cancel: (text = '✖️ Bekor') => ({ text, cb: 'x' }),
};

/** Tegsiz bekor tugmasi (cb: 'x') bormi — factory faqat shunda joriy dialogni o'qiydi */
export const hasBareCancel = (rows) => !!rows?.some?.((row) => (Array.isArray(row) ? row : [row]).some((x) => x && x.cb === 'x'));

/**
 * «✖️ Bekor» tugmalariga joriy dialog tegini qo'shish: cb 'x' → 'x:<teg>' (8 bayt).
 * Shunda eski xabardagi tugma keyinroq boshlangan boshqa dialogni o'chirmaydi (common.mjs x handler tegni solishtiradi).
 * Teg yo'q (dialog ochiq emas) — tugma o'zgarmaydi.
 */
export function tagCancel(rows, tag) {
  if (!tag || !hasBareCancel(rows)) return rows;
  return rows.map((row) => {
    if (!row) return row;
    const fix = (x) => (x && x.cb === 'x' ? { ...x, cb: `x:${tag}` } : x);
    return Array.isArray(row) ? row.map(fix) : fix(row);
  });
}

/** Web panel sahifasi → kerakli resurs (web NAV bilan bir xil): tugma faqat ruxsat bo'lsa ko'rsatiladi */
export const PAGE_PERM = {
  dashboard: 'dashboard', treasury: 'treasury', contracts: 'contracts', transactions: 'transactions', receivables: 'receivables', expenses: 'expenses', pnl: 'pnl',
  cashflow: 'cashflow', balance: 'balance', planfact: 'planfact', forecast: 'forecast', payroll: 'payroll', ai: 'ai', reports: 'reports', integrations: 'integrations',
  approvals: 'approvals', notifications: 'notifications', audit: 'audit', settings: 'settings',
};
export const pagePerm = (path) => {
  const p = String(path || '').replace(/^#?\/?/, '');
  if (p.startsWith('settings/profile')) return null; // profil — hamma uchun
  return PAGE_PERM[p.split(/[/?]/)[0]] || null;
};

/** Obyekt turi → web sahifa (bildirishnomalar, kartalar) */
export function entityPath(entityType, id) {
  switch (entityType) {
    case 'contract': return id ? `contracts/${id}` : 'contracts';
    case 'approval': return id ? `approvals/${id}` : 'approvals';
    case 'expense': return id ? `expenses/${id}` : 'expenses';
    case 'bank_transaction': case 'transaction': return 'transactions';
    case 'payroll': return 'payroll';
    case 'revenue_recognition': return 'approvals';
    case 'integration': return 'integrations';
    case 'ai_action': return 'ai';
    case 'company': return 'contracts';
    default: return 'dashboard';
  }
}

/**
 * Web havolalar: WEBAPP_URL (yoki PUBLIC_URL) ommaviy http(s) bo'lsa tugmalar chiqadi.
 * HTTPS → Telegram Mini App (web_app tugma, ichida avtomatik kirish), HTTP → oddiy URL tugma.
 * localhost / 127.x / ichki tarmoq manzillarini Telegram qabul qilmaydi — ular uchun tugma chiqmaydi.
 */
export function webLinks({ webappUrl, publicUrl } = {}) {
  const base = String(webappUrl || publicUrl || '').trim().replace(/\/+$/, '');
  const valid = /^https?:\/\/[^/\s]+/i.test(base) && !/^https?:\/\/(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/i.test(base);
  const miniApp = valid && /^https:\/\//i.test(base);
  const clean = (path) => String(path || '').replace(/^#?\/?/, '');
  return {
    base, enabled: valid, miniApp,
    /** Brauzer uchun: https://domen/#/contracts/5 */
    url: (path = '') => (valid ? `${base}/#/${clean(path)}` : null),
    /** Mini App uchun: https://domen/?tgp=contracts%2F5 (Telegram hash'ga o'z parametrlarini qo'shadi, shuning uchun marshrut query'da) */
    appUrl: (path = '') => (miniApp ? `${base}/?tgp=${encodeURIComponent(clean(path))}` : null),
  };
}

const CB_LIMIT = 64;
/**
 * Tugma massivini Telegram reply_markup'ga o'girish.
 * @param rows  [[btn]]
 * @param links webLinks() natijasi
 * @param canView (resource) => bool — web tugmalarni ruxsat bo'yicha filtrlash
 */
export function toReplyMarkup(rows, links, canView = () => true) {
  if (!rows || !rows.length) return undefined;
  const out = [];
  for (const row of rows) {
    if (!row) continue;
    const r = [];
    for (const x of Array.isArray(row) ? row : [row]) {
      if (!x || !x.text) continue;
      if (x.cb !== undefined) { assertCb(x.cb); r.push({ text: x.text, callback_data: x.cb }); }
      else if (x.cmd) { const data = `cmd:${x.cmd}${x.args ? ':' + x.args : ''}`; assertCb(data); r.push({ text: x.text, callback_data: data }); }
      else if (x.web !== undefined) {
        const perm = pagePerm(x.web);
        if (perm && !canView(perm)) continue;
        if (links?.miniApp) r.push({ text: x.text, web_app: { url: links.appUrl(x.web) } });
        else if (links?.enabled) r.push({ text: x.text, url: links.url(x.web) });
      } else if (x.url && /^https?:\/\//i.test(x.url)) r.push({ text: x.text, url: x.url });
    }
    if (r.length) out.push(r);
  }
  return out.length ? { inline_keyboard: out } : undefined;
}

function assertCb(data) {
  const n = Buffer.byteLength(String(data), 'utf8');
  if (!n || n > CB_LIMIT) throw new Error(`callback_data 1..64 bayt bo‘lishi kerak (${n}): ${data}`);
}

/** [a,b,c,d,e] → [[a,b],[c,d],[e]] */
export const chunk = (items, size = 2) => {
  const out = [];
  for (let k = 0; k < items.length; k += size) out.push(items.slice(k, k + size));
  return out;
};

/** Sahifalash: items, page (0..), perPage, cbFor(page) → { slice, nav: [btn row] } */
export function paginate(items, page, perPage, cbFor) {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const p = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const slice = items.slice(p * perPage, p * perPage + perPage);
  const nav = [];
  if (p > 0) nav.push(btn.cb('◀️', cbFor(p - 1)));
  if (pages > 1) nav.push(btn.cb(`${p + 1}/${pages}`, cbFor(p)));
  if (p < pages - 1) nav.push(btn.cb('▶️', cbFor(p + 1)));
  return { slice, page: p, pages, nav: nav.length > 1 ? nav : [] };
}
