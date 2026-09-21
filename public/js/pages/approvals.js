import { get, post, put, qs } from '../api.js';
import { SOURCE_LABEL, dateRange, rangeLabel, h, kpiCard, card, fmt, money, badge, dt, date, dataTable, drawer, toast, err, promptDlg, statusLabel, icon, alert, kv } from '../ui.js';

const TYPE = { EXPENSE: 'Xarajat', REVENUE_RECOGNITION: 'Daromad', PAYROLL: 'Oylik', CONTRACT_CHANGE: 'Shartnoma', AI_ACTION: 'AI harakati' };
const ROLE = { DEPARTMENT_HEAD: 'Bo‘lim rahbari', FINANCE_MANAGER: 'Moliya menejeri', CFO: 'Moliya direktori', CEO: 'Bosh direktor', FOUNDER: 'Ta’sischi', ACCOUNTANT: 'Buxgalteriya', EXECUTIVE_DIRECTOR: 'Ijrochi direktor' };
export default async function render(root, { setTitle, can, params, me, roleLabel }) {
  let tab = 'mine';
  const tabs = h('div', { class: 'tabs mb16' });
  const drawTabs = () => tabs.replaceChildren(...[['mine', 'Men tasdiqlashim kerak'], ['pending', 'Barcha kutayotganlar'], ['requested', 'Mening so‘rovlarim'], ['all', 'Tarix'], ...(can('settings', 'EDIT') ? [['rules', 'Qoidalar va limitlar']] : [])].map(([k, l]) => h('button', { class: k === tab ? 'active' : '', onClick: () => { tab = k; drawTabs(); load(); } }, l)));
  const body = h('div', {});
  const cols = [{ key: 'id', label: '№' }, { key: 'entity_type', label: 'Turi', render: (r) => badge('INFO', TYPE[r.entity_type] || r.entity_type) }, { key: 'title', label: 'Nomi' }, { key: 'amount', label: 'Summa', money: true }, { key: 'requested_by_name', label: 'So‘ragan' }, { key: 'department_name', label: 'Bo‘lim' }, { key: 'current_step', label: 'Qadam', render: (r) => `${Math.min(r.current_step + 1, r.steps.length)}/${r.steps.length} · ${ROLE[r.steps[r.current_step]?.role] || r.steps[r.current_step]?.role || '—'}` }, { key: 'status', label: 'Holat', badge: true }, { key: 'created_at', label: 'Yaratilgan', datetime: true }, { key: 'can_act', label: '', render: (r) => (r.can_act ? badge('WARNING', 'Sizning navbatingiz') : '') }];
  const rng = dateRange({ allowEmpty: true, onChange: () => load() });
  async function load() {
    rng.el.style.display = tab === 'rules' ? 'none' : '';
    if (tab === 'rules') return rules();
    const R = rng.active, per = R ? rng.value : {};
    const q = tab === 'mine' ? { status: 'PENDING', mine: '1' } : tab === 'pending' ? { status: 'PENDING' } : {};
    let rows = await get('/api/approvals' + qs({ ...q, ...per }));
    if (tab === 'requested') rows = rows.filter((a) => a.is_mine);
    if (tab === 'pending') rows = [...rows, ...(await get('/api/approvals' + qs({ status: 'POSTPONED', ...per })))];
    setTitle('Tasdiqlashlar', 'Universal tasdiqlash zanjiri — limitlar qoidalarda' + (R ? ' · ' + rangeLabel(rng.value) : ''));
    const pend = rows.filter((a) => a.status === 'PENDING');
    body.replaceChildren(h('div', { class: 'kpis c4 mb16' }, kpiCard({ size: 'sm', icon: 'clock', tone: pend.length ? 'amber' : 'green', label: 'Kutilmoqda', value: String(pend.length) + ' ta' }), kpiCard({ size: 'sm', icon: 'coins', tone: 'blue', label: 'Kutayotgan summa', value: pend.reduce((s, a) => s + (a.amount || 0), 0) }), kpiCard({ size: 'sm', icon: 'clock', tone: 'gray', label: 'Kechiktirilgan', value: String(rows.filter((a) => a.status === 'POSTPONED').length) + ' ta' }), kpiCard({ size: 'sm', icon: 'checkSquare', tone: 'green', label: 'Sizning navbatingiz', value: String(rows.filter((a) => a.can_act).length) + ' ta' })), h('div', { class: 'card' }, dataTable({ columns: cols, rows, onRow: (r) => open(r.id), exportName: 'tasdiqlashlar' }).el));
  }
  async function open(id) {
    const a = await get('/api/approvals/' + id);
    const list = await get('/api/approvals?status=' + (a.status === 'POSTPONED' ? 'POSTPONED' : 'PENDING'));
    const canAct = list.find((x) => x.id === a.id)?.can_act;
    const dr = drawer({ title: `№${a.id} · ${a.title}`, body: '' });
    const act = async (path, comment) => { try { await post(`/api/approvals/${a.id}/${path}`, { comment }); toast('Bajarildi', 'ok'); dr.close(); load(); } catch (e) { err(e); } };
    dr.setBody(h('div', {}, card(h('div', { class: 'flex between grow' }, h('h3', {}, TYPE[a.entity_type] || a.entity_type), badge(a.status)), h('div', {}, kv([['Summa', h('b', {}, money(a.amount))], ['So‘ragan', a.requested_by_name || '—'], ['Bo‘lim', a.department_name || '—'], ['Yaratilgan', dt(a.created_at)], a.postponed_until ? ['Kechiktirilgan', date(a.postponed_until)] : null]),
      a.entity_type === 'EXPENSE' ? h('a', { class: 'btn sm mt12', href: '#/expenses/' + a.entity_id }, 'Xarajatni ochish') : a.entity_type === 'REVENUE_RECOGNITION' ? h('div', { class: 'mt12' }, alert('info', 'Daromadni tan olish — summa belgilangan chegaradan yuqori, moliya direktori tasdig‘i talab qilinadi. Tasdiqlansa mijoz avanslari tan olingan daromadga o‘tadi.')) : null,
      canAct ? h('div', { class: 'flex gap8 mt16' }, h('button', { class: 'btn good', onClick: () => act('approve') }, icon('check', 15), 'Tasdiqlash'), h('button', { class: 'btn danger', onClick: async () => { const c = await promptDlg('Rad etish sababi'); if (c !== null) act('reject', c); } }, icon('x', 15), 'Rad etish'), h('button', { class: 'btn', onClick: async () => { const c = await promptDlg('Kechiktirish izohi'); if (c !== null) act('postpone', c); } }, icon('clock', 15), 'Kechiktirish')) : ['PENDING', 'POSTPONED'].includes(a.status) ? h('div', { class: 'small muted mt12' }, `Bu qadamni ${ROLE[a.steps[a.current_step]?.role] || a.steps[a.current_step]?.role} tasdiqlaydi (siz: ${roleLabel(me.role_code)})`) : null)),
      card('Tasdiqlash zanjiri', h('div', { class: 'steps' }, ...a.steps.map((s, i) => h('div', { class: 'step ' + (s.status === 'APPROVED' ? 'ok' : s.status === 'REJECTED' ? 'bad' : i === a.current_step && ['PENDING', 'POSTPONED'].includes(a.status) ? 'cur' : '') }, h('div', { class: 'ic' }, s.status === 'APPROVED' ? '✓' : s.status === 'REJECTED' ? '✕' : i + 1), h('div', {}, h('div', { class: 't' }, ROLE[s.role] || s.role), h('div', { class: 's' }, s.user_name ? `${s.user_name} · ${dt(s.decided_at)} · ${statusLabel(s.status)}${s.source ? ' · ' + (SOURCE_LABEL[s.source] || s.source) : ''}` : 'kutilmoqda', s.comment ? h('div', {}, '«' + s.comment + '»') : null))))))));
  }
  async function rules() {
    setTitle('Tasdiqlashlar', 'Qoidalar va limitlar — kod o‘zgarmasdan sozlanadi');
    const rs = await get('/api/approvals/rules');
    const rows = rs.map((r) => ({ ...r }));
    const draw = () => body.replaceChildren(card('Tasdiqlash qoidalari', h('div', {}, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Turi'), h('th', {}, 'Nomi'), h('th', {}, 'Minimal summa'), h('th', {}, 'Maksimal (bo‘sh = cheksiz)'), h('th', {}, 'Qadamlar (rollar, vergul bilan)'), h('th', {}))), h('tbody', {}, ...rows.map((r, i) => h('tr', {}, h('td', {}, h('select', { class: 'select sm', onChange: (e) => (r.entity_type = e.target.value) }, ...Object.entries(TYPE).map(([t, l]) => h('option', { value: t, selected: r.entity_type === t }, l)))), h('td', {}, h('input', { class: 'input sm', value: r.name || '', onInput: (e) => (r.name = e.target.value) })), h('td', {}, h('input', { class: 'input sm', type: 'number', value: r.min_amount, onInput: (e) => (r.min_amount = Number(e.target.value)) })), h('td', {}, h('input', { class: 'input sm', type: 'number', value: r.max_amount ?? '', onInput: (e) => (r.max_amount = e.target.value === '' ? null : Number(e.target.value)) })), h('td', {}, h('input', { class: 'input sm', style: { width: '320px' }, value: r.steps.join(', '), onInput: (e) => (r.steps = e.target.value.split(',').map((x) => x.trim()).filter(Boolean)) })), h('td', {}, h('button', { class: 'btn xs ghost', onClick: () => { rows.splice(i, 1); draw(); } }, icon('x', 13)))))))),
      h('div', { class: 'flex gap8 mt16' }, h('button', { class: 'btn', onClick: () => { rows.push({ entity_type: 'EXPENSE', min_amount: 0, max_amount: null, steps: ['DEPARTMENT_HEAD'], name: '' }); draw(); } }, icon('plus', 14), 'Qoida qo‘shish'), h('button', { class: 'btn pri', onClick: async () => { try { await put('/api/approvals/rules', { rules: rows }); toast('Saqlandi', 'ok'); } catch (e) { err(e); } } }, 'Saqlash')),
      h('div', { class: 'small muted mt8' }, 'Rollar: DEPARTMENT_HEAD (bo‘lim rahbari), FINANCE_MANAGER, CFO, CEO, FOUNDER, ACCOUNTANT. Masalan: 5 mln gacha — bo‘lim rahbari; 5–20 mln — bo‘lim rahbari, moliya menejeri; 20–100 mln — bo‘lim rahbari, moliya direktori; 100 mln+ — moliya direktori, bosh direktor.'))));
    draw();
  }
  drawTabs();
  setTitle('Tasdiqlashlar', 'Universal tasdiqlash zanjiri — limitlar qoidalarda', [rng.el]);
  root.append(tabs, body);
  await load();
  if (params[0]) open(params[0]);
}
