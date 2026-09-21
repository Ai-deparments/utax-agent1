// UI komponentlar: h(), formatlar, badge, toast, modal, drawer, form, DataTable, KPI kartalar
import { icon } from './icons.js';
export { icon };
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v; else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v; else if (k === 'dataset') Object.assign(el.dataset, v); else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
export const frag = (...c) => { const f = document.createDocumentFragment(); for (const x of c.flat(Infinity)) if (x !== null && x !== undefined && x !== false) f.append(x instanceof Node ? x : document.createTextNode(String(x))); return f; };
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const CUR = 'so‘m';
export const fmt = (n, d = 0) => (n === null || n === undefined || n === '' || Number.isNaN(Number(n)) ? '--' : Number(n).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/,/g, ' ').replace(/ /g, ' '));
export const money = (n) => (n === null || n === undefined || n === '' || Number.isNaN(Number(n)) ? '--' : fmt(n) + ' ' + CUR);
export const short = (n) => { if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '--'; const a = Math.abs(Number(n) || 0); const s = Number(n) < 0 ? '−' : ''; if (a >= 1e9) return s + (a / 1e9).toFixed(2) + ' mlrd'; if (a >= 1e6) return s + (a / 1e6).toFixed(1) + ' mln'; if (a >= 1e3) return s + (a / 1e3).toFixed(0) + ' ming'; return s + fmt(a); };
export const date = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '--');
export const dt = (d) => (d ? new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '--');
export const pct = (n) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '--' : Number(n).toFixed(1) + '%');
export const today = () => new Date().toISOString().slice(0, 10);
export const monthNow = () => today().slice(0, 7);
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MONTHS_UZ = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyun', 'Iyul', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];
export const monthLabel = (p) => { const [y, m] = String(p).split('-'); return `${MONTHS_UZ[Number(m) - 1] || m} ${String(y).slice(2)}`; };

const STATUS = {
  DRAFT: ['', 'Qoralama'], ACTIVE: ['info', 'Faol'], ADVANCE_EXPECTED: ['warn', 'Avans kutilmoqda'], ADVANCE_RECEIVED: ['info', 'Avans olindi'], IN_PROGRESS: ['info', 'Jarayonda'], SERVICE_COMPLETED: ['good', 'Xizmat yakunlandi'], FINAL_PAYMENT_EXPECTED: ['warn', 'Yakuniy to‘lov kutilmoqda'], PAID: ['good', 'To‘langan'], OVERDUE: ['crit', 'Muddati o‘tgan'], CLOSED: ['', 'Yopilgan'], CANCELLED: ['', 'Bekor qilingan'],
  NOT_STARTED: ['', 'Boshlanmagan'], ON_HOLD: ['warn', 'To‘xtatilgan'], COMPLETED: ['good', 'Yakunlangan'], EXPECTED: ['warn', 'Kutilmoqda'], PARTIAL: ['info', 'Qisman to‘langan'],
  UNMATCHED: ['crit', 'Bog‘lanmagan'], SUGGESTED: ['warn', 'Taklif'], MATCHED: ['good', 'Bog‘langan'], IGNORED: ['', 'E’tiborsiz'],
  PENDING: ['warn', 'Kutilmoqda'], APPROVED: ['good', 'Tasdiqlangan'], REJECTED: ['crit', 'Rad etilgan'], POSTPONED: ['', 'Kechiktirilgan'], SUBMITTED: ['info', 'Yuborilgan'], PENDING_APPROVAL: ['warn', 'Tasdiq kutmoqda'], RECOGNIZED: ['good', 'Tan olingan'],
  CUSTOMER_ADVANCE: ['warn', 'Mijoz avansi'], RECOGNIZED_REVENUE: ['good', 'Tan olingan daromad'], REFUNDABLE: ['crit', 'Qaytariladi'], REFUNDED: ['', 'Qaytarilgan'],
  OPEN: ['warn', 'Ochiq'], DONE: ['good', 'Bajarildi'], SUPERSEDED: ['', 'Eskirgan'], PROPOSED: ['warn', 'Taklif'], EXECUTED: ['good', 'Bajarildi'], FAILED: ['crit', 'Xato'],
  INFO: ['info', 'Ma’lumot'], WARNING: ['warn', 'Ogohlantirish'], CRITICAL: ['crit', 'Kritik'], OK: ['good', 'Yaxshi'], WARN: ['warn', 'Diqqat'], BAD: ['crit', 'Bajarilmadi'], NO_PLAN: ['', 'Reja yo‘q'], LOSS: ['crit', 'Zarar'], LOW: ['warn', 'Past'], NO_DATA: ['', 'Ma’lumot yo‘q'], HIGH: ['crit', 'Yuqori'], MEDIUM: ['warn', 'O‘rta'],
  INCOME: ['good', 'Kirim'], EXPENSE: ['crit', 'Chiqim'], RUNNING: ['info', 'Ishlamoqda'], ERROR: ['crit', 'Xato'], EMPTY: ['', 'Bo‘sh'],
};
export const badge = (s, label) => { const [cls, lb] = STATUS[s] || ['', s]; return h('span', { class: 'badge ' + cls }, label || lb || s || '--'); };
export const statusLabel = (s) => (STATUS[s] || [null, s])[1];
export const progress = (p, cls = '') => { const v = Math.max(0, Math.min(100, Number(p) || 0)); return h('div', { class: 'progtxt' }, h('div', { class: 'prog ' + (cls || (v >= 100 ? 'good' : '')) }, h('i', { style: { width: v + '%' } })), h('span', { class: 'pct' }, v.toFixed(0) + '%')); };
export const confBar = (c) => { const v = Number(c) || 0; return h('span', { class: 'conf' }, h('div', { class: 'prog ' + (v >= 95 ? 'good' : v >= 60 ? 'warn' : 'crit') }, h('i', { style: { width: v + '%' } })), h('span', { class: 'small tnum' }, v + '%')); };
/** O'zgarish belgisi: +12.5% ↑ (musbat yashil, salbiy qizil); invert=true bo'lsa (xarajat) o'sish qizil */
export const delta = (p, { invert = false, suffix = '%' } = {}) => {
  if (p === null || p === undefined || Number.isNaN(Number(p))) return h('span', { class: 'delta flat' }, '--');
  const v = Number(p); const up = v > 0, flat = Math.abs(v) < 0.05;
  const good = flat ? null : invert ? !up : up;
  return h('span', { class: 'delta ' + (flat ? 'flat' : good ? 'up' : 'down') }, flat ? null : icon(up ? 'arrowUp' : 'arrowDown', 13), (up ? '+' : '') + v.toFixed(1) + suffix);
};

// ---------- toast ----------
let toastBox;
export function toast(msg, kind = '') { toastBox ??= document.body.appendChild(h('div', { class: 'toasts' })); const t = h('div', { class: 'toast ' + kind }, msg); toastBox.append(t); setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3500); }
export const err = (e) => { console.error(e); toast(e?.message || String(e), 'err'); };

// ---------- modal / drawer ----------
export function modal({ title, body, footer, size = '', onClose }) {
  const bg = h('div', { class: 'modal-bg' });
  const close = () => { bg.remove(); onClose?.(); };
  const m = h('div', { class: 'modal ' + size }, h('div', { class: 'mh' }, h('h2', {}, title), h('button', { class: 'iconbtn', onClick: close, title: 'Yopish' }, icon('x', 16))), h('div', { class: 'mb' }, body), footer ? h('div', { class: 'mf' }, footer) : null);
  bg.append(m); bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  document.body.append(bg);
  return { close, el: m };
}
export function confirmDlg(text, { okLabel = 'Tasdiqlash', danger = false } = {}) {
  return new Promise((resolve) => { const m = modal({ title: 'Tasdiqlash', size: 'sm', body: h('p', { style: { margin: 0 } }, text), footer: [h('button', { class: 'btn', onClick: () => { m.close(); resolve(false); } }, 'Bekor qilish'), h('button', { class: 'btn ' + (danger ? 'danger' : 'pri'), onClick: () => { m.close(); resolve(true); } }, okLabel)], onClose: () => resolve(false) }); });
}
export function promptDlg(title, { label = 'Izoh', value = '', type = 'textarea' } = {}) {
  return new Promise((resolve) => { const inp = type === 'textarea' ? h('textarea', { class: 'input', rows: 3 }, value) : h('input', { class: 'input', value }); const m = modal({ title, size: 'sm', body: h('div', { class: 'field' }, h('label', {}, label), inp), footer: [h('button', { class: 'btn', onClick: () => { m.close(); resolve(null); } }, 'Bekor qilish'), h('button', { class: 'btn pri', onClick: () => { m.close(); resolve(inp.value); } }, 'Saqlash')], onClose: () => resolve(null) }); setTimeout(() => inp.focus(), 50); });
}
export function drawer({ title, body, actions }) {
  const bg = h('div', { class: 'drawer-bg' });
  const close = () => { bg.remove(); d.remove(); };
  const d = h('div', { class: 'drawer' }, h('div', { class: 'dh' }, h('h2', {}, title), ...(actions || []), h('button', { class: 'iconbtn', onClick: close, title: 'Yopish' }, icon('x', 16))), h('div', { class: 'db' }, body));
  bg.addEventListener('click', close); document.body.append(bg, d);
  return { close, el: d, setBody(b) { const db = d.querySelector('.db'); clear(db).append(b); }, setTitle(t) { d.querySelector('.dh h2').textContent = t; } };
}

// ---------- form ----------
export function form(fields, values = {}, { cols = 2 } = {}) {
  const inputs = {};
  const grid = h('div', { class: 'form-grid', style: cols === 1 ? { gridTemplateColumns: '1fr' } : {} });
  for (const f of fields) {
    let inp;
    const v = values[f.name] ?? f.value ?? '';
    if (f.type === 'select') inp = h('select', { class: 'select', name: f.name }, ...(f.options || []).map((o) => { const [val, lb] = Array.isArray(o) ? o : [o.value ?? o.id, o.label ?? o.name]; return h('option', { value: val, selected: String(val) === String(v) }, lb); }));
    else if (f.type === 'textarea') inp = h('textarea', { class: 'input', name: f.name, rows: f.rows || 3 }, v);
    else if (f.type === 'checkbox') inp = h('input', { type: 'checkbox', name: f.name, checked: !!v });
    else inp = h('input', { class: 'input', type: f.type || 'text', name: f.name, value: v, placeholder: f.placeholder || '', step: f.step, min: f.min });
    if (f.onInput) inp.addEventListener('input', () => f.onInput(inp.value, inputs));
    if (f.onChange) inp.addEventListener('change', () => f.onChange(inp.value, inputs));
    inputs[f.name] = inp;
    grid.append(h('div', { class: 'field ' + (f.full ? 'full' : '') }, h('label', {}, f.label, f.required ? h('span', { class: 'neg' }, ' *') : null), inp, f.hint ? h('div', { class: 'hint' }, f.hint) : null));
  }
  return { el: grid, inputs, values() { const o = {}; for (const f of fields) { const i = inputs[f.name]; o[f.name] = f.type === 'checkbox' ? i.checked : f.type === 'number' ? (i.value === '' ? null : Number(i.value)) : i.value; } return o; }, validate() { for (const f of fields) if (f.required) { const i = inputs[f.name]; if (i.value === '' || i.value === null) { i.focus(); throw new Error(`"${f.label}" maydoni majburiy`); } } return this.values(); } };
}
export function formModal({ title, fields, values, submit, submitLabel = 'Saqlash', size = '' }) {
  const f = form(fields, values);
  const m = modal({ title, size, body: f.el, footer: [h('button', { class: 'btn', onClick: () => m.close() }, 'Bekor qilish'), h('button', { class: 'btn pri', onClick: async (e) => { try { e.target.disabled = true; const v = f.validate(); await submit(v, f); m.close(); } catch (x) { err(x); } finally { e.target.disabled = false; } } }, submitLabel)] });
  return m;
}

// ---------- DataTable ----------
/** columns: [{key,label,money,date,datetime,badge,pct,progress,render,right,width}] */
export function dataTable({ columns, rows = [], search = true, pageSize = 25, onRow, filters = [], exportName, emptyText = 'Ma’lumot yo‘q', dateKey, footer, toolbarExtra, hideToolbar }) {
  let all = rows, q = '', sortKey = null, sortDir = 1, page = 0, from = '', to = '';
  const visible = new Set(columns.map((c) => c.key));
  const filterVals = {};
  const wrap = h('div', {});
  const tb = h('div', { class: 'toolbar no-print' });
  const tblWrap = h('div', { class: 'tbl-wrap' });
  const pager = h('div', { class: 'pager no-print' });
  const cell = (c, r) => {
    const v = r[c.key];
    if (c.render) return c.render(r, v);
    if (c.money) return h('span', { class: 'tnum ' + (v < 0 ? 'neg' : '') }, fmt(v));
    if (c.date) return date(v);
    if (c.datetime) return dt(v);
    if (c.badge) return badge(v);
    if (c.pct) return pct(v);
    if (c.progress) return progress(v);
    return v === null || v === undefined ? '--' : String(v);
  };
  function filtered() {
    let r = all;
    if (q) { const s = q.toLowerCase(); r = r.filter((x) => columns.some((c) => String(x[c.key] ?? '').toLowerCase().includes(s))); }
    for (const [k, v] of Object.entries(filterVals)) if (v !== '' && v !== undefined) r = r.filter((x) => String(x[k] ?? '') === String(v));
    if (dateKey && from) r = r.filter((x) => String(x[dateKey] || '') >= from);
    if (dateKey && to) r = r.filter((x) => String(x[dateKey] || '').slice(0, 10) <= to);
    if (sortKey) r = [...r].sort((a, b) => { const va = a[sortKey], vb = b[sortKey]; if (va === vb) return 0; if (va === null || va === undefined) return 1; if (vb === null || vb === undefined) return -1; return (typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb))) * sortDir; });
    return r;
  }
  function render() {
    const r = filtered();
    const pages = Math.max(1, Math.ceil(r.length / pageSize)); if (page >= pages) page = pages - 1;
    const slice = r.slice(page * pageSize, (page + 1) * pageSize);
    const cols = columns.filter((c) => visible.has(c.key));
    const table = h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ...cols.map((c) => h('th', { class: c.right || c.money ? 'right' : '', onClick: () => { if (sortKey === c.key) sortDir = -sortDir; else { sortKey = c.key; sortDir = 1; } render(); } }, c.label, sortKey === c.key ? h('span', { class: 'arrow' }, sortDir > 0 ? '▲' : '▼') : null)))),
      h('tbody', {}, slice.length ? slice.map((row) => h('tr', { class: 'row ' + (onRow ? 'click' : ''), onClick: onRow ? () => onRow(row) : null }, ...cols.map((c) => h('td', { class: (c.right || c.money ? 'right ' : '') + (c.nowrap ? 'nowrap' : ''), style: c.width ? { width: c.width } : {} }, cell(c, row))))) : h('tr', {}, h('td', { class: 'empty', colspan: cols.length }, emptyText))),
      footer ? h('tfoot', {}, footer(r, cols)) : null);
    clear(tblWrap).append(table);
    clear(pager).append(h('span', {}, `${r.length} ta yozuv`), h('span', { class: 'spacer' }), h('button', { class: 'btn xs', disabled: page === 0, onClick: () => { page--; render(); } }, '‹'), h('span', {}, `${page + 1} / ${pages}`), h('button', { class: 'btn xs', disabled: page >= pages - 1, onClick: () => { page++; render(); } }, '›'));
  }
  if (search) tb.append(h('input', { class: 'input sm', placeholder: 'Qidirish…', onInput: (e) => { q = e.target.value; page = 0; render(); } }));
  for (const f of filters) tb.append(h('select', { class: 'select sm', onChange: (e) => { filterVals[f.key] = e.target.value; page = 0; render(); } }, h('option', { value: '' }, f.label), ...f.options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, statusLabel(o)]; return h('option', { value: v }, l); })));
  if (dateKey) tb.append(h('input', { class: 'input sm', type: 'date', title: 'Boshlanish sanasi', onChange: (e) => { from = e.target.value; render(); } }), h('input', { class: 'input sm', type: 'date', title: 'Tugash sanasi', onChange: (e) => { to = e.target.value; render(); } }));
  if (toolbarExtra) tb.append(...[toolbarExtra].flat());
  tb.append(h('span', { class: 'grow' }));
  const colBtn = h('button', { class: 'btn sm ghost', title: 'Ustunlar' }, icon('columns', 15), 'Ustunlar');
  colBtn.addEventListener('click', () => { modal({ title: 'Ustunlarni tanlash', size: 'sm', body: h('div', { class: 'grid', style: { gap: '6px' } }, ...columns.map((c) => h('label', { class: 'flex gap8' }, h('input', { type: 'checkbox', checked: visible.has(c.key), onChange: (e) => { e.target.checked ? visible.add(c.key) : visible.delete(c.key); render(); } }), c.label))) }); });
  tb.append(colBtn);
  if (exportName) {
    tb.append(h('button', { class: 'btn sm ghost', onClick: async () => { try { const { downloadXlsx } = await import('./api.js'); await downloadXlsx(exportName, columns.filter((c) => visible.has(c.key)).map((c) => ({ key: c.key, label: c.label })), filtered().map((r) => Object.fromEntries(columns.map((c) => [c.key, c.exportValue ? c.exportValue(r) : r[c.key]])))); } catch (e) { err(e); } } }, icon('download', 15), 'Excel'));
    tb.append(h('button', { class: 'btn sm ghost', onClick: () => window.print() }, icon('printer', 15), 'PDF'));
  }
  if (!hideToolbar) wrap.append(tb);
  wrap.append(tblWrap, pager);
  render();
  return { el: wrap, setRows(r) { all = r; page = 0; render(); }, refresh: render, filtered };
}

// ---------- KPI kartalar ----------
/** kpiCard({ icon, tone, label, value, unit, delta, deltaLabel, invert, spark, accent, sub, size }) */
export function kpiCard({ icon: ic = 'wallet', tone = 'green', label, value, unit, delta: dl, deltaLabel = 'O‘tgan oyga nisbatan', invert = false, spark, accent = false, sub, size = '', cls = '', href }) {
  const isNum = typeof value === 'number';
  const el = h(href ? 'a' : 'div', { class: `kpi-card ${size} ${accent ? 'accent' : ''} ${cls} ${href ? 'link' : ''}`, title: (isNum ? money(value) : '') + (href ? (isNum ? ' · ' : '') + 'Batafsil ko‘rish' : ''), ...(href ? { href } : {}) },
    h('div', { class: 'top' }, h('div', { class: 'tile ' + tone }, icon(ic, 20)), h('div', { class: 'grow' }, h('div', { class: 'lb' }, label), h('div', { class: 'vl' + (isNum && fmt(value).length > 13 ? ' xl' : isNum && fmt(value).length > 10 ? ' lg' : '') }, isNum ? fmt(value) : value ?? '--', isNum ? h('span', { class: 'un' }, unit ?? CUR) : null))),
    dl !== undefined ? h('div', { class: 'dl' }, delta(dl, { invert }), h('span', {}, deltaLabel)) : sub ? h('div', { class: 'dl' }, sub) : null);
  if (spark && spark.length > 1) import('./charts.js').then(({ sparkline }) => el.append(h('div', { class: 'spark' }, sparkline(spark, { color: `var(--${{ green: 's1', blue: 's3', orange: 's2', red: 'crit', violet: 's5', amber: 's4', teal: 's6', gray: 'muted-2' }[tone] || 's1'})` }))));
  return el;
}
/** Kichik ko'rsatkich (Asosiy ko'rsatkichlar) */
export const statTile = ({ icon: ic = 'info', tone = 'green', label, value, delta: dl, invert = false, href }) => h(href ? 'a' : 'div', { class: 'stat-tile' + (href ? ' link' : ''), ...(href ? { href, title: 'Batafsil ko‘rish' } : {}) }, h('div', { class: 'tile ' + tone, style: { width: '36px', height: '36px' } }, icon(ic, 18)), h('div', { class: 'grow' }, h('div', { class: 'lb' }, label), h('div', { class: 'flex' }, h('span', { class: 'vl' }, value), dl !== undefined && dl !== null ? h('span', { class: 'dl' }, delta(dl, { invert, suffix: '' })) : null)));
/** Eski API: kpi(label, value, sub, cls) — sahifalar uchun qisqa karta */
export const kpi = (label, value, sub, cls = '', ic = 'coins', tone = 'green') => kpiCard({ icon: ic, tone: cls === 'crit' ? 'red' : cls === 'warn' ? 'amber' : tone, label, value, sub, size: 'sm', accent: cls === 'hero', cls: cls === 'crit' || cls === 'warn' ? cls : '' });
export const card = (title, body, actions, { tight = false, sub } = {}) => h('div', { class: 'card' }, title ? h('div', { class: 'card-h' }, typeof title === 'string' ? h('h3', {}, title, sub ? h('span', { class: 'sub' }, sub) : null) : title, ...(actions || [])) : null, h('div', { class: 'card-b ' + (tight ? 'tight' : '') }, body instanceof HTMLTableElement ? h('div', { class: 'tbl-wrap' }, body) : body));
export const kv = (pairs) => h('dl', { class: 'kv' }, ...pairs.filter(Boolean).map(([k, v]) => [h('dt', {}, k), h('dd', {}, v instanceof Node ? v : v ?? '--')]));
export const mdLite = (text) => { const el = h('div', {}); el.innerHTML = esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>'); return el; };
export const emptyState = (title = 'Ma’lumot yo‘q', sub = '', ic = 'inbox') => h('div', { class: 'empty-state' }, icon(ic, 28), h('b', {}, title), sub ? h('div', {}, sub) : null);
export const alert = (kind, text, ic) => h('div', { class: 'alert ' + kind }, icon(ic || (kind === 'crit' ? 'alert' : kind === 'warn' ? 'alert' : kind === 'good' ? 'check' : 'info'), 16), h('div', { class: 'grow' }, text));
export function segmented(options, value, onChange) { const el = h('div', { class: 'seg' }); const render = () => { clear(el).append(...options.map(([v, l]) => h('button', { class: v === value ? 'active' : '', onClick: () => { value = v; render(); onChange(v); } }, l))); }; render(); return el; }
export function periodPicker(onChange, initial = { period: 'month' }) {
  let state = { ...initial };
  const month = h('input', { class: 'input sm', type: 'month', value: state.month || monthNow(), onChange: (e) => { state = { month: e.target.value }; onChange(state); } });
  const from = h('input', { class: 'input sm', type: 'date' }), to = h('input', { class: 'input sm', type: 'date' });
  const apply = h('button', { class: 'btn sm', onClick: () => { if (from.value && to.value) { state = { period: 'custom', from: from.value, to: to.value }; onChange(state); } } }, 'Qo‘llash');
  const custom = h('span', { class: 'flex gap8', style: { display: 'none' } }, from, to, apply);
  const seg = segmented([['day', 'Kun'], ['week', 'Hafta'], ['month', 'Oy'], ['quarter', 'Chorak'], ['year', 'Yil'], ['custom', 'Davr']], state.period || 'month', (v) => { custom.style.display = v === 'custom' ? '' : 'none'; month.style.display = v === 'month' ? '' : 'none'; if (v === 'month') { state = { month: month.value }; onChange(state); } else if (v !== 'custom') { state = { period: v }; onChange(state); } });
  return h('div', { class: 'flex wrap gap8' }, seg, month, custom);
}
/** Grafik kartasi uchun davr tanlovchi (oylar soni) */
export const monthsSelect = (value, onChange) => h('select', { class: 'select sm', onChange: (e) => onChange(Number(e.target.value)) }, ...[[3, 'Oxirgi 3 oy'], [6, 'Oxirgi 6 oy'], [12, 'Oxirgi 12 oy']].map(([v, l]) => h('option', { value: v, selected: v === value }, l)));

// ---------- Sana oralig'i (Sanadan — Sanagacha) ----------
export const addDaysISO = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const monthStartISO = (d = today()) => d.slice(0, 8) + '01';
export const monthEndISO = (d = today()) => { const [y, m] = d.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
export const rangeLabel = (r) => (r && r.from && r.to ? `${date(r.from)} — ${date(r.to)}` : 'Barcha davr');
/** dateRange({ from, to, onChange, allowEmpty }) — ikkala sana tanlangach onChange({from,to}); allowEmpty bo'lsa × tugmasi "barcha davr"ga qaytaradi */
export function dateRange({ from = '', to = '', onChange, allowEmpty = false }) {
  let cur = { from, to };
  const fromInp = h('input', { class: 'input sm', type: 'date', value: from, title: 'Boshlanish sanasi' });
  const toInp = h('input', { class: 'input sm', type: 'date', value: to, title: 'Tugash sanasi' });
  const fire = () => {
    const f = fromInp.value, t = toInp.value;
    if (!f && !t) { if (allowEmpty && (cur.from || cur.to)) { cur = { from: '', to: '' }; onChange(cur); } return; }
    if (!f || !t) return;
    if (f > t) return toast('Boshlanish sanasi tugash sanasidan keyin bo‘lishi mumkin emas', 'err');
    if (f === cur.from && t === cur.to) return;
    cur = { from: f, to: t }; onChange(cur);
  };
  fromInp.addEventListener('change', fire); toInp.addEventListener('change', fire);
  const clr = allowEmpty ? h('button', { class: 'btn xs ghost', title: 'Barcha davr (tozalash)', onClick: () => { fromInp.value = ''; toInp.value = ''; fire(); } }, icon('x', 13)) : null;
  const el = h('span', { class: 'date-range small muted' }, h('span', { class: 'dr-part' }, 'Sanadan:', fromInp), h('span', { class: 'dr-part' }, 'Sanagacha:', toInp), clr);
  return { el, get value() { return cur; }, get active() { return !!(cur.from && cur.to); }, set(f, t) { fromInp.value = f || ''; toInp.value = t || ''; cur = { from: f || '', to: t || '' }; } };
}

// ---------- Fayl tanlash maydoni (brauzerning standart "Choose File" tugmasi o'rniga) ----------
/** fileDrop({ accept, hint }) → { el, input, reset() } — input.files va 'change' hodisasi avvalgidek ishlaydi */
export function fileDrop({ accept = '', hint = '' } = {}) {
  const input = h('input', { type: 'file', accept, class: 'filedrop-input', tabindex: '-1' });
  const name = h('div', { class: 'filedrop-name' }, 'Faylni tanlang');
  const sub = h('div', { class: 'filedrop-sub' }, hint || 'yoki shu yerga sudrab tashlang');
  const btn = h('span', { class: 'btn sm' }, 'Tanlash');
  const el = h('label', { class: 'filedrop', tabindex: '0' }, h('div', { class: 'tile green', style: { width: '36px', height: '36px' } }, icon('upload', 18)), h('div', { class: 'grow' }, name, sub), btn, input);
  const show = () => {
    const f = input.files && input.files[0];
    el.classList.toggle('has-file', !!f);
    name.textContent = f ? f.name : 'Faylni tanlang';
    sub.textContent = f ? `${(f.size / 1024).toFixed(f.size < 10240 ? 1 : 0)} KB` : hint || 'yoki shu yerga sudrab tashlang';
    btn.textContent = f ? 'Almashtirish' : 'Tanlash';
  };
  input.addEventListener('change', show);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  ['dragenter', 'dragover'].forEach((t) => el.addEventListener(t, (e) => { e.preventDefault(); el.classList.add('drag'); }));
  ['dragleave', 'dragend'].forEach((t) => el.addEventListener(t, () => el.classList.remove('drag')));
  el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('drag'); if (e.dataTransfer?.files?.length) { input.files = e.dataTransfer.files; input.dispatchEvent(new Event('change')); } });
  return { el, input, reset() { input.value = ''; show(); } };
}

// ---------- Tizim kodlarining o'zbekcha nomlari (kodlar bazada o'zgarmaydi, faqat ko'rsatiladi) ----------
export const ROLE_LABEL = { FOUNDER: 'Ta’sischi', CEO: 'Bosh direktor', CFO: 'Moliya direktori', FINANCE_MANAGER: 'Moliya menejeri', ACCOUNTANT: 'Buxgalter', SALES: 'Sotuv menejeri', DEPARTMENT_HEAD: 'Bo‘lim rahbari', EMPLOYEE: 'Xodim', AUDITOR: 'Auditor', ADMIN: 'Administrator', AI_AGENT: 'AI agent', EXECUTIVE_DIRECTOR: 'Ijrochi direktor', SYSTEM: 'Tizim' };
export const SOURCE_LABEL = { WEB: 'Veb', API: 'API', AI: 'AI', SYSTEM: 'Tizim', TELEGRAM: 'Telegram', SEED: 'Boshlang‘ich ma’lumot', WEBHOOK: 'Webhook', IMPORT: 'Import', MANUAL: 'Qo‘lda', EXCEL: 'Excel fayl', BANK_API: 'Bank API', GOOGLE_SHEETS: 'Google Sheets', ONE_C: '1C', ERP: 'ERP', AI_CHAT: 'AI chat', TEST: 'Sinov' };
export const IGNORE_LABEL = { DIVIDEND: 'Dividend (ta’sischilarga)', TRANSFER: 'Ichki o‘tkazma (bank → kassa)', LOAN: 'Qarz / kredit (заём)', REFUND: 'Qaytarilgan mablag‘', INTEREST: 'Bank foizlari', OTHER_INCOME: 'Boshqa kirim', OTHER: 'Boshqa', REVERSAL: 'Tuzatish yozuvi', NON_CONTRACT: 'Shartnomasiz', PAYROLL: 'Oylik' };
export const RESOURCE_LABEL = { dashboard: 'Bosh sahifa', treasury: 'Pul boshqaruvi', contracts: 'Shartnomalar', transactions: 'Bank tranzaksiyalari', reconciliation: 'Tranzaksiyalarni bog‘lash', revenue: 'Daromadni tan olish', receivables: 'Debitorlik', collections: 'Undiruv', expenses: 'Xarajatlar', approvals: 'Tasdiqlashlar', pnl: 'Foyda va zarar', cashflow: 'Pul oqimi', balance: 'Balans', planfact: 'Reja / Fakt', forecast: 'Prognoz', payroll: 'KPI va oylik', ai: 'AI moliya', reports: 'Hisobotlar', integrations: 'Integratsiyalar', notifications: 'Bildirishnomalar', audit: 'Audit jurnali', settings: 'Sozlamalar', users: 'Foydalanuvchilar' };
export const AGENT_LABEL = { CFO: 'CFO agenti', BANK: 'Bank agenti', RECONCILIATION: 'Bog‘lash agenti', REVENUE: 'Daromad agenti', EXPENSE: 'Xarajat agenti', APPROVAL: 'Tasdiqlash agenti', CASH_FLOW: 'Pul oqimi agenti', RECEIVABLE: 'Debitorlik agenti', COLLECTION: 'Undiruv agenti', PAYROLL: 'Oylik agenti', FORECAST: 'Prognoz agenti', FINANCIAL_ANALYST: 'Moliyaviy tahlilchi', DATA_QUALITY: 'Ma’lumot sifati agenti', AUDIT_ANOMALY: 'Audit va anomaliya agenti' };
export const ACTION_LABEL = {
  LOGIN: 'Tizimga kirdi', LOGIN_FAILED: 'Kirish rad etildi', LOGIN_2FA: 'Tizimga kirdi (2FA)', LOGOUT: 'Tizimdan chiqdi', CREATE: 'Yaratildi', UPDATE: 'O‘zgartirildi',
  STATUS_RECOMPUTED: 'Holat qayta hisoblandi', CONTRACT_STATUS: 'Shartnoma holati o‘zgardi', SERVICE_STATUS: 'Xizmat holati o‘zgardi', DOCUMENT_ADDED: 'Hujjat qo‘shildi', SCHEDULE_ADDED: 'To‘lov jadvaliga qator qo‘shildi',
  AUTO_MATCH: 'Avtomatik bog‘landi', MATCH_CONFIRMED: 'Bog‘lash tasdiqlandi', AUTO_MATCH_EXPENSE: 'Xarajatga avtomatik bog‘landi', MATCH_EXPENSE: 'Xarajatga bog‘landi', UNMATCH: 'Bog‘lanish bekor qilindi', IGNORE: 'E’tiborsiz qoldirildi', REVERSE: 'Tuzatish (reversal)', IMPORT: 'Import qilindi', EXCEL_UPLOAD: 'Excel fayl yuklandi', SYNC: 'Sinxronlandi',
  REVENUE_RECOGNIZED: 'Daromad tan olindi', REVENUE_RECOGNITION_PROPOSED: 'Daromadni tan olish tasdiqqa yuborildi', REVENUE_RECOGNITION_REJECTED: 'Daromadni tan olish rad etildi', REVENUE_REVERSED: 'Daromad tuzatildi', REVENUE_EVENTS_REVERSED: 'To‘lov yozuvlari qaytarildi', REFUND_REFUNDABLE: 'Qaytarishga belgilandi', REFUND_REFUNDED: 'Qaytarildi',
  APPROVAL_CREATED: 'Tasdiq so‘rovi yaratildi', APPROVAL_APPROVE: 'Tasdiqlandi', APPROVAL_REJECT: 'Rad etildi', APPROVAL_POSTPONE: 'Kechiktirildi', APPROVAL_RULES_UPDATED: 'Tasdiqlash qoidalari o‘zgardi',
  EXPENSE_REQUESTED: 'Xarajat so‘raldi', EXPENSE_CREATED: 'Xarajat kiritildi', EXPENSE_APPROVED: 'Xarajat tasdiqlandi', EXPENSE_REJECTED: 'Xarajat rad etildi', EXPENSE_PAID: 'Xarajat to‘landi', EXPENSE_UNPAID: 'To‘lov bekor qilindi', EXPENSE_REVERSED: 'Xarajat tuzatildi',
  PAYROLL_COMPUTED: 'Oylik hisoblandi', PAYROLL_SUBMITTED: 'Oylik tasdiqqa yuborildi', PAYROLL_PAID: 'Oylik to‘landi', PAYROLL_ROW_EDIT: 'Oylik qatori tahrirlandi', SALARY_CHANGED: 'Maosh o‘zgartirildi', KPI_SET: 'KPI kiritildi',
  AGENT_RUN: 'Agent ishga tushdi', AGENT_UPDATED: 'Agent sozlandi', AI_PROPOSED: 'AI taklif berdi', AI_ACTION_EXECUTED: 'AI taklifi bajarildi', AI_ACTION_REJECTED: 'AI taklifi rad etildi', AI_CATEGORIZED: 'AI kategoriyaladi',
  COLLECTION_TASK: 'Undiruv vazifasi yaratildi', COLLECTION_UPDATED: 'Undiruv vazifasi yangilandi', SETTINGS_UPDATED: 'Sozlamalar o‘zgardi', PERMISSIONS_UPDATED: 'Ruxsatlar o‘zgardi',
  PASSWORD_CHANGED: 'Parol o‘zgartirildi', '2FA_ENABLED': '2FA yoqildi', '2FA_DISABLED': '2FA o‘chirildi', TELEGRAM_LINKED: 'Telegram ulandi', BACKUP: 'Zaxira nusxa olindi', EXPORT: 'Eksport qilindi',
  BALANCE_ADJUSTED: 'Qoldiqqa texnik tuzatma kiritildi', BALANCE_ADJUSTMENT_REVERSED: 'Texnik tuzatma bekor qilindi', PLAN_CREATED: 'Reja kiritildi', PLAN_UPDATED: 'Reja o‘zgartirildi', BUDGET_SET: 'Byudjet kiritildi',
};
export const actionLabel = (a) => ACTION_LABEL[a] || a;
