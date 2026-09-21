import { api, get, post, setTokens, isLoggedIn, qs } from './api.js';
import { h, clear, toast, err, icon, fmt, date } from './ui.js';

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
function renderLogin() {
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
  renderNav();
  window.scrollTo(0, 0);
  if (!PAGES[page] || (perm && !App.can(perm))) { clear(layout.main).append(h('div', { class: 'empty-state' }, icon('alert', 28), h('b', {}, 'Sahifa topilmadi yoki ruxsat yo‘q'))); return; }
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
  } catch (e) { console.error(e); clear(cont).append(h('div', { class: 'alert crit' }, icon('alert', 16), h('div', {}, 'Sahifa xatosi: ' + e.message))); }
}
window.addEventListener('hashchange', route);

export async function boot() {
  if (!isLoggedIn()) return renderLogin();
  try { await App.refreshMe(); } catch (e) { setTokens(null); return renderLogin(); }
  renderLayout();
  if (!location.hash) location.hash = '#/dashboard'; else route();
}
boot();
