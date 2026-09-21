import { api, get, post, setTokens, isLoggedIn, qs } from './api.js';
import { h, clear, toast, err, icon, fmt, date, alert } from './ui.js';

export const NAV = [
  ['dashboard', 'Bosh sahifa', 'dashboard', 'home'], ['treasury', 'Pul boshqaruvi', 'treasury', 'wallet'], ['contracts', 'Shartnomalar', 'contracts', 'contract'], ['transactions', 'Tushumlar', 'transactions', 'inflow'],
  ['receivables', 'Debitorlik', 'receivables', 'users'], ['expenses', 'Xarajatlar', 'expenses', 'receipt'], ['pnl', 'Foyda va zarar', 'pnl', 'trend'], ['cashflow', 'Pul oqimi', 'cashflow', 'activity'], ['balance', 'Balans', 'balance', 'scale'],
  ['planfact', 'Reja / Fakt', 'planfact', 'target'], ['forecast', 'Prognoz', 'forecast', 'lineChart'], ['payroll', 'KPI va oylik', 'payroll', 'award'], ['ai', 'AI moliya', 'ai', 'sparkles'], ['reports', 'Hisobotlar', 'reports', 'barChart'],
  ['integrations', 'Integratsiyalar', 'integrations', 'plug'], ['approvals', 'Tasdiqlashlar', 'approvals', 'checkSquare'], ['notifications', 'Bildirishnomalar', 'notifications', 'bell'], ['audit', 'Audit jurnali', 'audit', 'shield'], ['settings', 'Sozlamalar', 'settings', 'settings'],
];
export const App = {
  me: null, perms: {}, dept: null, company: 'UTAX',
  can(res, action = 'VIEW') { return !!(this.perms[res] || []).includes(action); },
  navigate(path) { location.hash = '#/' + path.replace(/^#?\/?/, ''); },
  async refreshMe() { const m = await get('/api/auth/me'); this.me = m.user; this.perms = m.permissions; this.dept = m.department; this.company = m.settings.company; return m; },
  async logout() { try { await post('/api/auth/logout', { refresh_token: localStorage.getItem('uf_refresh') }); } catch {} setTokens(null); location.hash = ''; boot(); },
};
window.App = App;
const root = document.getElementById('root');
const logoMark = () => h('div', { class: 'mark' }, icon('x_mark', 20));

// ---------- LOGIN ----------
/** notice — login ustida ko'rsatiladigan ogohlantirish (masalan Telegram Mini App orqali kirish muvaffaqiyatsiz bo'lsa) */
function renderLogin(notice) {
  const email = h('input', { class: 'input', type: 'email', placeholder: 'Elektron pochta', autocomplete: 'username' });
  const pass = h('input', { class: 'input', type: 'password', placeholder: 'Parol', autocomplete: 'current-password' });
  const code = h('input', { class: 'input', placeholder: '2FA kodi (6 raqam)', inputmode: 'numeric', style: { display: 'none' } });
  const msg = h('div', { class: 'small neg mt8' });
  let temp = null;
  const btn = h('button', { class: 'btn pri', type: 'submit', style: { width: '100%', justifyContent: 'center', marginTop: '14px', padding: '10px' } }, 'Kirish');
  const submit = async (e) => {
    e?.preventDefault(); btn.disabled = true; msg.textContent = '';
    try {
      let r;
      if (temp) r = await post('/api/auth/2fa/verify', { temp_token: temp, code: code.value });
      else { r = await post('/api/auth/login', { email: email.value.trim(), password: pass.value }); if (r.requires_2fa) { temp = r.temp_token; code.style.display = ''; code.focus(); msg.textContent = '2FA kodini kiriting'; btn.disabled = false; return; } }
      setTokens(r); await boot();
    } catch (x) { msg.textContent = x.message; } finally { btn.disabled = false; }
  };
  clear(root).append(h('div', { class: 'login' }, h('form', { class: 'card box', onSubmit: submit, style: { padding: '28px' } },
    h('div', { class: 'brand' }, logoMark(), h('div', {}, h('div', { class: 'nm' }, 'UTAX Finance'), h('small', {}, 'Moliya boshqaruv tizimi'))),
    notice ? h('div', { class: 'mb12' }, alert('warn', notice, 'send')) : null,
    h('div', { class: 'field mt8' }, h('label', {}, 'Elektron pochta'), email), h('div', { class: 'field mt12' }, h('label', {}, 'Parol'), pass), h('div', { class: 'field mt8' }, code), msg, btn)));
  setTimeout(() => pass.focus(), 50);
}

// ---------- LAYOUT ----------
let layout = null;
function renderLayout() {
  const me = App.me;
  const nav = h('nav', { class: 'nav' });
  const sidebar = h('aside', { class: 'sidebar' }, h('a', { class: 'brand', href: '#/dashboard' }, logoMark(), h('div', {}, h('div', { class: 'nm' }, 'UTAX Finance'), h('small', {}, 'Moliya boshqaruv tizimi'))), nav, h('div', { class: 'foot' }, 'UTAX Finance', h('span', { class: 'grow' }), 'v1.0.0'));
  const overlay = h('div', { class: 'overlay', onClick: () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); } });
  // global qidiruv (real API: shartnoma, kontragent, tranzaksiya)
  const res = h('div', { class: 'res' });
  const sInput = h('input', { placeholder: 'Qidirish… (kontragent, shartnoma, summa, hujjat raqami)', onInput: (e) => search(e.target.value), onFocus: (e) => { if (res.children.length) res.classList.add('show'); } });
  const search = debounce(async (q) => {
    q = q.trim(); if (q.length < 2) { res.classList.remove('show'); clear(res); return; }
    try {
      const [cs, cos, txs] = await Promise.all([App.can('contracts') ? get('/api/contracts' + qs({ q })) : [], App.can('contracts') ? get('/api/companies' + qs({ q })) : [], App.can('transactions') ? get('/api/transactions' + qs({ q })) : []]);
      clear(res);
      const grp = (t, items, mk) => { if (!items.length) return; res.append(h('div', { class: 'grp' }, t)); items.slice(0, 5).forEach((x) => res.append(mk(x))); };
      grp('Shartnomalar', cs, (c) => h('a', { href: '#/contracts/' + c.id, onClick: () => res.classList.remove('show') }, h('span', { style: { color: 'var(--text)' } }, `${c.contract_number} · ${c.company_name}`), h('span', {}, fmt(c.amount))));
      grp('Kontragentlar', cos, (c) => h('a', { href: '#/contracts?company=' + c.id, onClick: () => res.classList.remove('show') }, h('span', { style: { color: 'var(--text)' } }, c.name), h('span', {}, c.inn ? 'INN ' + c.inn : '')));
      grp('Tranzaksiyalar', txs, (t) => h('a', { href: '#/transactions', onClick: () => res.classList.remove('show') }, h('span', { style: { color: 'var(--text)' } }, `${date(t.tx_date)} · ${t.counterparty_name || t.purpose || ''}`), h('span', {}, fmt(t.amount))));
      if (!res.children.length) res.append(h('div', { class: 'grp' }, 'Hech narsa topilmadi'));
      res.classList.add('show');
    } catch (e) { console.error(e); }
  }, 250);
  const searchBox = h('div', { class: 'search' }, icon('search', 16), sInput, res);
  document.addEventListener('click', (e) => { if (!searchBox.contains(e.target)) res.classList.remove('show'); });
  const bell = h('button', { class: 'iconbtn', title: 'Bildirishnomalar', onClick: () => App.navigate('notifications') }, icon('bell', 18));
  const umenu = h('div', { class: 'menu' }, h('div', { class: 'mh' }, me.email), h('a', { href: '#/settings/profile', onClick: () => umenu.classList.remove('show') }, icon('user', 16), 'Profil, 2FA, Telegram'), h('button', { onClick: () => App.logout() }, icon('logout', 16), 'Chiqish'));
  const chip = h('div', { style: { position: 'relative' } }, h('div', { class: 'userchip', onClick: (e) => { e.stopPropagation(); umenu.classList.toggle('show'); } }, h('div', { class: 'av' }, me.name.split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase()), h('div', {}, h('div', { class: 'nm' }, me.name), h('div', { class: 'rl' }, roleLabel(me.role_code))), icon('chevronDown', 14)), umenu);
  document.addEventListener('click', () => umenu.classList.remove('show'));
  const top = h('header', { class: 'topbar' }, h('button', { class: 'iconbtn menu-btn', onClick: () => { sidebar.classList.toggle('open'); overlay.classList.toggle('show'); } }, icon('menu', 18)), searchBox, h('span', { class: 'spacer' }), bell, chip);
  const main = h('main', { class: 'content' });
  clear(root).append(h('div', { id: 'app' }, sidebar, top, main), overlay);
  layout = { nav, main, bell, sidebar, overlay };
  renderNav();
  pollBadges();
}
export const roleLabel = (r) => ({ FOUNDER: 'Ta’sischi', CEO: 'Bosh direktor', CFO: 'Moliya direktori', FINANCE_MANAGER: 'Moliya menejeri', ACCOUNTANT: 'Buxgalter', SALES: 'Sotuv menejeri', DEPARTMENT_HEAD: 'Bo‘lim rahbari', EMPLOYEE: 'Xodim', AUDITOR: 'Auditor', ADMIN: 'Administrator', AI_AGENT: 'AI agent' })[r] || r;
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function renderNav() {
  const cur = (location.hash.replace(/^#\//, '').split(/[/?]/)[0]) || 'dashboard';
  clear(layout.nav).append(...NAV.filter(([, , perm]) => App.can(perm)).map(([path, label, , ic]) => h('a', { href: '#/' + path, class: cur === path ? 'active' : '', onClick: () => { layout.sidebar.classList.remove('open'); layout.overlay.classList.remove('show'); } }, icon(ic, 18), label, h('span', { class: 'nav-badge', dataset: { nav: path } }))));
}
async function pollBadges() {
  try {
    const n = App.can('notifications') ? await get('/api/notifications?unread=1') : { unread: 0 };
    const d = layout.bell.querySelector('.dot'); if (n.unread) { (d || layout.bell.appendChild(h('span', { class: 'dot' }))).textContent = n.unread; } else d?.remove();
    const set = (path, v) => { const b = layout.nav.querySelector(`[data-nav="${path}"]`); if (!b) return; b.className = 'nav-badge ' + (v ? 'badge-n' : ''); b.textContent = v || ''; };
    if (App.can('approvals')) { const a = await get('/api/approvals?status=PENDING&mine=1'); set('approvals', a.length); }
    set('notifications', n.unread);
  } catch {}
  setTimeout(pollBadges, 60000);
}

// ---------- ROUTER ----------
const PAGES = Object.fromEntries(NAV.map(([p]) => [p, p]));
async function route() {
  if (!App.me) return;
  const raw = location.hash.replace(/^#\//, '');
  const [pathPart, queryPart] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  const page = parts[0] || 'dashboard';
  const perm = NAV.find(([p]) => p === page)?.[2];
  // Profil (parol, 2FA, Telegram botlar) — har bir kirgan foydalanuvchi uchun ochiq; boshqa sozlamalar ruxsat bilan
  const openForAll = page === 'settings' && parts[1] === 'profile';
  renderNav();
  window.scrollTo(0, 0);
  if (!PAGES[page] || (perm && !openForAll && !App.can(perm))) { clear(layout.main).append(h('div', { class: 'empty-state' }, icon('alert', 28), h('b', {}, 'Sahifa topilmadi yoki ruxsat yo‘q'))); return; }
  const head = h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, NAV.find(([p]) => p === page)?.[1] || page), h('div', { class: 'sub' }, '')), h('div', { class: 'acts' }));
  const cont = h('div', {}, h('div', { class: 'empty-state' }, 'Yuklanmoqda…'));
  clear(layout.main).append(head, cont);
  try {
    const mod = await import(`./pages/${page}.js`);
    const fresh = h('div', {});
    const ctx = { params: parts.slice(1), query, me: App.me, can: App.can.bind(App), navigate: App.navigate, roleLabel,
      setTitle: (t, sub, actions) => { head.querySelector('h1').textContent = t; head.querySelector('.sub').textContent = sub || ''; document.title = t + ' — UTAX Finance'; if (actions) clear(head.querySelector('.acts')).append(...actions.filter(Boolean)); },
      setActions: (actions) => clear(head.querySelector('.acts')).append(...actions.filter(Boolean)) };
    await mod.default(fresh, ctx);
    clear(cont).append(fresh);
  } catch (e) {
    console.error(e);
    // Tab eski versiyada ochiq qolgan bo‘lsa (server yangilangan), modullar mos kelmaydi — bir marta qayta yuklaymiz.
    const stale = e instanceof SyntaxError || /dynamically imported module|Importing a module script failed|does not provide an export/i.test(e?.message || '');
    let last = 0; try { last = Number(sessionStorage.getItem('utax.reload') || 0); } catch {}
    if (stale && Date.now() - last > 30_000) { try { sessionStorage.setItem('utax.reload', String(Date.now())); } catch {} location.reload(); return; }
    clear(cont).append(h('div', { class: 'alert crit' }, icon('alert', 16), h('div', {}, 'Sahifa xatosi: ' + e.message)));
  }
}
window.addEventListener('hashchange', route);

// Server yangilangan bo‘lsa (build o‘zgargan), ochiq tabni yangi versiyaga o‘tkazamiz.
const BUILD = document.querySelector('meta[name="app-build"]')?.content;
let buildCheckedAt = 0;
async function checkBuild() {
  if (!BUILD || Date.now() - buildCheckedAt < 60_000) return;
  buildCheckedAt = Date.now();
  try { const j = await (await fetch('/api/health', { cache: 'no-store' })).json(); if (j.build && j.build !== BUILD) location.reload(); } catch {}
}
window.addEventListener('hashchange', checkBuild);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkBuild(); });

export async function boot(notice) {
  if (!isLoggedIn()) return renderLogin(notice);
  try { await App.refreshMe(); } catch (e) { setTokens(null); return renderLogin(notice); }
  renderLayout();
  if (!location.hash) location.hash = '#/dashboard'; else route();
}

// ---------- TELEGRAM MINI APP ----------
/**
 * Bot tugmasi ilovani `https://domen/?tgp=<sahifa>#tgWebAppData=…&tgWebAppVersion=…` ko'rinishida ochadi.
 * tgWebAppData — Telegram imzolagan xom initData satri: server uni bot tokeni bilan tekshirib, bog'langan foydalanuvchiga sessiya beradi.
 * Marshrut hash'da emas, `?tgp` da keladi (hash'ni Telegram egallaydi). Kirishdan keyin manzil `#/<sahifa>` ga keltiriladi.
 */
const cleanRoute = (p) => String(p || '').replace(/^[#/]+/, '').replace(/[^\w\-/?=&.%]/g, '').slice(0, 200);

/** telegram-web-app.js — faqat ready()/expand() uchun; yuklanmasa ham (bloklangan, sekin tarmoq) ilova ishlayveradi */
function loadTelegramScript(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const done = () => { try { window.Telegram?.WebApp?.ready(); window.Telegram?.WebApp?.expand(); } catch {} resolve(); };
    if (window.Telegram?.WebApp) return done();
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-web-app.js';
    s.async = true;
    s.onload = done;
    s.onerror = () => resolve();
    document.head.append(s);
    setTimeout(resolve, timeoutMs);
  });
}

async function telegramLaunch() {
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  const initData = hashParams.get('tgWebAppData');
  const tgp = new URLSearchParams(location.search).get('tgp');
  if (!initData && tgp === null) return null;
  let notice = null;
  let route = cleanRoute(tgp);
  if (initData) {
    // Skript hash hali o'zgarmagan paytda yuklanishi kerak (u launch parametrlarini hash'dan o'qiydi)
    const scriptReady = loadTelegramScript();
    try {
      // api.js emas: 401 da refresh urinishi va eski sessiya bilan aralashmasligi uchun to'g'ridan-to'g'ri fetch
      const res = await fetch('/api/auth/telegram-webapp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ init_data: initData }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.access_token) {
        setTokens(data);
        if (!route && data.start_param) route = cleanRoute(String(data.start_param).replace(/__/g, '/'));
      } else {
        if (res.status === 401) setTokens(null); // boshqa Telegram hisobi yoki uzilgan bog'lanish — eski sessiya qolmasin
        notice = data.message || 'Telegram orqali kirib bo‘lmadi. Elektron pochta va parol bilan kiring.';
      }
    } catch {
      notice = 'Server bilan aloqa yo‘q. Birozdan so‘ng qayta urinib ko‘ring.';
    }
    await scriptReady;
  }
  history.replaceState(null, '', location.pathname + '#/' + (route || 'dashboard'));
  return notice;
}

telegramLaunch().catch(() => null).then((notice) => {
  boot(notice);
  if (notice && isLoggedIn()) toast(notice, 'err'); // eski sessiya bilan davom etilsa ham sababi ko'rinsin
});
