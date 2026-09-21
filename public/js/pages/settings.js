import { get, post, put, patch } from '../api.js';
import { RESOURCE_LABEL, h, card, badge, dt, dataTable, formModal, modal, toast, err, kv, icon, alert, confirmDlg, emptyState } from '../ui.js';

export default async function render(root, { setTitle, can, params, me, roleLabel }) {
  const TABS = [['rules', 'Biznes qoidalari', 'settings'], ['services', 'Xizmat turlari', 'settings'], ['categories', 'Xarajat kategoriyalari', 'settings'], ['users', 'Foydalanuvchilar', 'users'], ['roles', 'Rollar va ruxsatlar', 'users'], ['departments', 'Bo‘limlar', 'settings'], ['recurring', 'Doimiy xarajatlar', 'expenses'], ['scheduler', 'Fon vazifalari va zaxira', 'settings'], ['bots', 'Telegram botlar', 'settings'], ['profile', 'Profil', null]];
  // Sozlamalarga ruxsati yo'q foydalanuvchi (xodim, sotuv, bo'lim rahbari…) — faqat o'z Profili
  const visibleTabs = () => (can('settings') ? TABS.filter(([, , p]) => !p || can(p)) : TABS.filter(([k]) => k === 'profile'));
  let tab = visibleTabs().some(([k]) => k === params[0]) ? params[0] : can('settings') ? 'rules' : 'profile';
  const tabs = h('div', { class: 'tabs mb16' });
  const body = h('div', {});
  // Tab manzilda saqlanadi (#/settings/<tab>) — yangilanganda va havola orqali o'sha tab ochiladi
  const drawTabs = () => {
    tabs.replaceChildren(...visibleTabs().map(([k, l]) => h('button', { class: k === tab ? 'active' : '', onClick: () => { tab = k; history.replaceState(null, '', '#/settings/' + k); drawTabs(); load(); } }, l)));
    revealActiveTab();
  };
  // Ko'p tab bo'lsa (tor ekran, Telegram Mini App) aktiv tab ko'rinib tursin — sahifa DOM'ga qo'shilgach, faqat tablar qatori suriladi
  const revealActiveTab = (tries = 60) => {
    if (!tabs.isConnected) { if (tries > 0) setTimeout(() => revealActiveTab(tries - 1), 50); return; }
    const a = tabs.querySelector('button.active');
    if (!a || tabs.scrollWidth <= tabs.clientWidth) return;
    tabs.scrollLeft += a.getBoundingClientRect().left - tabs.getBoundingClientRect().left - (tabs.clientWidth - a.offsetWidth) / 2;
  };
  const GROUPS = { 'Pul va ishlatish mumkin mablag‘': ['cash.advance_restriction_pct', 'cash.safety_reserve', 'cash.reserve_approved_unpaid_expenses', 'cash.reserve_pending_payroll', 'cash.low_liquidity_threshold'], 'Tranzaksiyalarni bog‘lash': ['reconciliation.auto_match_threshold', 'reconciliation.suggest_threshold', 'reconciliation.amount_tolerance_pct'], 'Daromadni tan olish': ['revenue.approval_threshold', 'revenue.require_acceptance_document'], Xarajatlar: ['expense.large_expense_alert', 'expense.category_confidence_threshold'], 'Undiruv agenti': ['collection.stages', 'collection.critical_days'], Prognoz: ['forecast.scenarios'], Oylik: ['payroll.pay_day', 'payroll.income_tax_pct', 'payroll.approval_steps'], 'Reja va fakt': ['planfact.tolerance_pct'], Bildirishnomalar: ['notifications.telegram_enabled', 'notifications.email_enabled', 'approvals.reminder_hours'], 'AI va xavfsizlik': ['ai.allow_llm', 'security.require_2fa_roles', 'security.session_hours'], Kompaniya: ['company.name', 'company.base_currency', 'fx.rates', 'backup.retention_days'] };
  const LABELS = { 'cash.advance_restriction_pct': 'Avanslarning cheklangan ulushi, %', 'cash.safety_reserve': 'Xavfsizlik rezervi, so‘m', 'cash.reserve_approved_unpaid_expenses': 'Tasdiqlangan to‘lanmagan xarajatlarni rezervga kiritish', 'cash.reserve_pending_payroll': 'Tasdiqlangan oylikni rezervga kiritish', 'cash.low_liquidity_threshold': 'Likvidlik pastligi chegarasi, so‘m', 'reconciliation.auto_match_threshold': 'Avtomatik bog‘lash chegarasi (ball)', 'reconciliation.suggest_threshold': 'Taklif chegarasi (ball)', 'reconciliation.amount_tolerance_pct': 'Summa farqi chegarasi, %', 'revenue.approval_threshold': 'Tasdiq talab qiladigan tan olish summasi', 'revenue.require_acceptance_document': 'Qabul akti talab qilinsin', 'expense.large_expense_alert': 'Katta xarajat ogohlantirishi, so‘m', 'expense.category_confidence_threshold': 'Kategoriya ishonchlilik chegarasi (0–1)', 'collection.stages': 'Undiruv bosqichlari (JSON)', 'collection.critical_days': 'Kritik qarz, kun', 'forecast.scenarios': 'Prognoz senariylari (JSON)', 'payroll.pay_day': 'Oylik to‘lov kuni', 'payroll.income_tax_pct': 'Daromad solig‘i, %', 'payroll.approval_steps': 'Oylik tasdiqlash qadamlari (JSON)', 'planfact.tolerance_pct': 'Reja/fakt ruxsat etilgan og‘ish, %', 'notifications.telegram_enabled': 'Telegram bildirishnomalari', 'notifications.email_enabled': 'Elektron pochta bildirishnomalari', 'approvals.reminder_hours': 'Tasdiq eslatmasi, soat', 'ai.allow_llm': 'LLM (Claude) dan foydalanish', 'security.require_2fa_roles': '2FA majburiy rollar (JSON)', 'security.session_hours': 'Sessiya muddati, soat', 'company.name': 'Kompaniya nomi', 'company.base_currency': 'Asosiy valyuta', 'fx.rates': 'Valyuta kurslari (JSON)', 'backup.retention_days': 'Zaxira saqlash muddati, kun' };
  async function load() {
    if (tab === 'rules') {
      setTitle('Sozlamalar', 'Biznes qoidalari — barcha chegaralar va formulalar shu yerda o‘zgartiriladi');
      const s = await get('/api/settings');
      const vals = { ...s.settings };
      const inputs = {};
      const fld = (k) => { const v = vals[k]; const isObj = typeof v === 'object' && v !== null; const inp = typeof v === 'boolean' ? h('input', { type: 'checkbox', checked: v }) : isObj ? h('textarea', { class: 'input', rows: 4 }, JSON.stringify(v, null, 1)) : h('input', { class: 'input', type: typeof v === 'number' ? 'number' : 'text', value: v ?? '' }); inputs[k] = { inp, type: typeof v === 'boolean' ? 'bool' : isObj ? 'json' : typeof v === 'number' ? 'num' : 'str' }; return h('div', { class: 'field' }, h('label', {}, LABELS[k] || k, h('span', { class: 'xs muted', style: { fontWeight: 400 } }, ' · ' + k)), inp); };
      const tgBots = s.env.telegram_bots ? `${Object.values(s.env.telegram_bots).filter(Boolean).length}/${Object.keys(s.env.telegram_bots).length} bot, rejim ${s.env.bot_mode}` : s.env.telegram ? 'ulangan' : 'ulanmagan';
      body.replaceChildren(alert('info', `Muhit: Node ${s.env.node} · LLM ${s.env.ai_llm ? 'ulangan (' + s.env.ai_model + ')' : 'ulanmagan (qoidalar rejimi)'} · Telegram ${tgBots} · Elektron pochta ${s.env.email ? 'ulangan' : 'ulanmagan'}`),
        h('div', { class: 'grid g2 mt16' }, ...Object.entries(GROUPS).map(([g, keys]) => card(g, h('div', { class: 'grid', style: { gap: '10px' } }, ...keys.filter((k) => k in vals || k in s.defaults).map(fld))))),
        can('settings', 'EDIT') ? h('button', { class: 'btn pri mt16', onClick: async () => { const b = {}; for (const [k, { inp, type }] of Object.entries(inputs)) { try { b[k] = type === 'bool' ? inp.checked : type === 'json' ? JSON.parse(inp.value) : type === 'num' ? Number(inp.value) : inp.value; } catch { return toast(`${k}: JSON noto‘g‘ri`, 'err'); } } try { await put('/api/settings', b); toast('Saqlandi', 'ok'); } catch (e) { err(e); } } }, 'Saqlash') : null);
    } else if (tab === 'services') {
      setTitle('Sozlamalar', 'Xizmat turlari — har biri uchun tan olish, to‘lov va KPI qoidalari');
      const sts = await get('/api/service-types');
      const RULE = { ON_COMPLETION: 'Yakunlanganda', STRAIGHT_LINE: 'Oyma-oy (obuna)', ON_PAYMENT: 'To‘lov kelganda', MILESTONE: 'Bosqichma-bosqich' };
      const form = (s = {}) => formModal({ title: s.id ? s.name : 'Yangi xizmat turi', size: 'lg', fields: [{ name: 'code', label: 'Kod', required: !s.id, value: s.code }, { name: 'name', label: 'Nomi', required: true, value: s.name }, { name: 'prefix', label: 'Shartnoma prefiksi (UTAX-X-)', required: !s.id, value: s.prefix }, { name: 'color', label: 'Rang', type: 'color', value: s.color || '#059669' }, { name: 'recognition_rule', label: 'Daromadni tan olish qoidasi (JSON): method — ON_COMPLETION | STRAIGHT_LINE | ON_PAYMENT | MILESTONE; require_acceptance_document', full: true, value: JSON.stringify(s.recognition_rule || { method: 'ON_COMPLETION', require_acceptance_document: true }) }, { name: 'payment_rule', label: 'To‘lov qoidasi (JSON)', full: true, value: JSON.stringify(s.payment_rule || { advance_pct: 50, due_days: 10 }) }, { name: 'kpi_rule', label: 'KPI qoidasi (JSON)', value: JSON.stringify(s.kpi_rule || {}) }, { name: 'expense_rule', label: 'Xarajat qoidasi (JSON)', value: JSON.stringify(s.expense_rule || {}) }, { name: 'collection_rule', label: 'Undiruv qoidasi (JSON)', value: JSON.stringify(s.collection_rule || {}) }, { name: 'is_active', label: 'Faol', type: 'checkbox', value: s.is_active ?? true }], submit: async (v) => { const b = { ...v }; for (const k of ['recognition_rule', 'payment_rule', 'kpi_rule', 'expense_rule', 'collection_rule']) b[k] = JSON.parse(v[k] || '{}'); if (s.id) await patch('/api/service-types/' + s.id, b); else await post('/api/service-types', b); toast('Saqlandi', 'ok'); load(); } });
      body.replaceChildren(card('Xizmat turlari', dataTable({ columns: [{ key: 'code', label: 'Kod', render: (r) => h('span', { class: 'badge', style: { background: 'transparent', border: '1px solid ' + (r.color || 'var(--border-strong)'), color: r.color || 'var(--text-2)' } }, r.code) }, { key: 'name', label: 'Nomi' }, { key: 'prefix', label: 'Prefiks' }, { key: 'recognition_rule', label: 'Tan olish', render: (r) => `${RULE[r.recognition_rule.method] || r.recognition_rule.method}${r.recognition_rule.require_acceptance_document ? ' + akt' : ''}` }, { key: 'payment_rule', label: 'To‘lov', render: (r) => `avans ${r.payment_rule.advance_pct ?? '—'}% · ${r.payment_rule.due_days ?? '—'} kun` }, { key: 'is_active', label: 'Faol', render: (r) => badge(r.is_active ? 'OK' : 'CANCELLED', r.is_active ? 'Ha' : 'Yo‘q') }], rows: sts, search: false, onRow: can('settings', 'EDIT') ? form : null }).el, [can('settings', 'EDIT') ? h('button', { class: 'btn xs pri', onClick: () => form() }, icon('plus', 13), 'Xizmat turi') : null], { tight: true }));
    } else if (tab === 'categories') {
      setTitle('Sozlamalar', 'Xarajat kategoriyalari va AI kalit so‘zlari');
      const cats = await get('/api/expenses/categories');
      const GRP = { DIRECT: 'To‘g‘ridan-to‘g‘ri', PAYROLL: 'Oylik', MARKETING: 'Marketing', ADMIN: 'Ma’muriy', IT: 'IT', OFFICE: 'Ofis', OTHER_OPEX: 'Boshqa operatsion', TAX: 'Soliq', OTHER: 'Boshqa' };
      const CF = { OPERATING: 'Operatsion', INVESTING: 'Investitsion', FINANCING: 'Moliyaviy' };
      const form = (c = {}) => formModal({ title: c.id ? c.name : 'Yangi kategoriya', fields: [{ name: 'code', label: 'Kod', required: !c.id, value: c.code }, { name: 'name', label: 'Nomi', required: true, value: c.name }, { name: 'pnl_group', label: 'Foyda-zarar guruhi', type: 'select', options: Object.entries(GRP), value: c.pnl_group }, { name: 'cf_class', label: 'Pul oqimi turi', type: 'select', options: Object.entries(CF), value: c.cf_class }, { name: 'keywords', label: 'AI kalit so‘zlar (vergul bilan)', full: true, value: (c.keywords || []).join(', ') }, { name: 'is_direct_cost', label: 'To‘g‘ridan-to‘g‘ri xarajat', type: 'checkbox', value: !!c.is_direct_cost }, { name: 'is_active', label: 'Faol', type: 'checkbox', value: c.is_active ?? true }], submit: async (v) => { const b = { ...v, keywords: v.keywords.split(',').map((x) => x.trim()).filter(Boolean) }; if (c.id) await patch('/api/expenses/categories/' + c.id, b); else await post('/api/expenses/categories', b); toast('Saqlandi', 'ok'); load(); } });
      body.replaceChildren(card('Xarajat kategoriyalari', dataTable({ columns: [{ key: 'code', label: 'Kod' }, { key: 'name', label: 'Nomi' }, { key: 'pnl_group', label: 'Guruh', render: (r) => GRP[r.pnl_group] || r.pnl_group }, { key: 'cf_class', label: 'Pul oqimi', render: (r) => CF[r.cf_class] || r.cf_class }, { key: 'keywords', label: 'Kalit so‘zlar', render: (r) => h('span', { class: 'xs muted' }, (r.keywords || []).join(', ')) }, { key: 'is_active', label: 'Faol', render: (r) => badge(r.is_active ? 'OK' : 'CANCELLED', r.is_active ? 'Ha' : 'Yo‘q') }], rows: cats, onRow: can('settings', 'EDIT') ? form : null }).el, [can('settings', 'EDIT') ? h('button', { class: 'btn xs pri', onClick: () => form() }, icon('plus', 13), 'Kategoriya') : null], { tight: true }));
    } else if (tab === 'users') {
      setTitle('Sozlamalar', 'Foydalanuvchilar');
      const [users, roles, depts] = await Promise.all([get('/api/users'), get('/api/roles'), get('/api/departments')]);
      const form = (u = {}) => formModal({ title: u.id ? u.name : 'Yangi foydalanuvchi', fields: [{ name: 'name', label: 'F.I.Sh.', required: true, value: u.name }, { name: 'email', label: 'Elektron pochta', required: !u.id, value: u.email, type: 'email' }, { name: 'role_code', label: 'Rol', type: 'select', options: roles.roles.map((r) => [r.code, roleLabel(r.code)]), value: u.role_code }, { name: 'department_id', label: 'Bo‘lim', type: 'select', options: [['', '—'], ...depts.map((d) => [d.id, d.name])], value: u.department_id }, { name: 'phone', label: 'Telefon', value: u.phone }, { name: 'password', label: u.id ? 'Yangi parol (bo‘sh — o‘zgarmaydi)' : 'Parol', type: 'password', required: !u.id }, { name: 'is_active', label: 'Faol', type: 'checkbox', value: u.is_active ?? true }], submit: async (v) => { const b = { ...v, department_id: v.department_id || null }; if (!b.password) delete b.password; if (u.id) await patch('/api/users/' + u.id, b); else await post('/api/users', b); toast('Saqlandi', 'ok'); load(); } });
      body.replaceChildren(card('Foydalanuvchilar', dataTable({ columns: [{ key: 'name', label: 'F.I.Sh.' }, { key: 'email', label: 'Elektron pochta' }, { key: 'role_code', label: 'Rol', render: (r) => roleLabel(r.role_code) }, { key: 'department', label: 'Bo‘lim' }, { key: 'totp_enabled', label: '2FA', render: (r) => badge(r.totp_enabled ? 'OK' : 'WARNING', r.totp_enabled ? 'yoqilgan' : 'yo‘q') }, { key: 'telegram_linked', label: 'Telegram', render: (r) => (r.telegram_linked ? badge('OK', r.telegram_username ? '@' + r.telegram_username : 'ulangan') : '—') }, { key: 'last_login_at', label: 'Oxirgi kirish', datetime: true }, { key: 'is_active', label: 'Faol', render: (r) => badge(r.is_active ? 'OK' : 'CANCELLED', r.is_active ? 'Ha' : 'Yo‘q') }], rows: users, onRow: can('users', 'EDIT') ? form : null, exportName: 'foydalanuvchilar' }).el, [can('users', 'CREATE') ? h('button', { class: 'btn xs pri', onClick: () => form() }, icon('plus', 13), 'Foydalanuvchi') : null], { tight: true }));
    } else if (tab === 'roles') {
      setTitle('Sozlamalar', 'Rollar va ruxsatlar — har bir harakat alohida boshqariladi');
      const r = await get('/api/roles');
      const ACT = { VIEW: 'Ko‘rish', CREATE: 'Yaratish', EDIT: 'Tahrirlash', APPROVE: 'Tasdiqlash', REJECT: 'Rad etish', DELETE: 'O‘chirish', EXPORT: 'Eksport' };
      let role = 'CFO';
      const draw = () => {
        const m = { ...(r.matrix[role] || {}) };
        const sel = h('select', { class: 'select sm', onChange: (e) => { role = e.target.value; draw(); } }, ...r.roles.map((x) => h('option', { value: x.code, selected: x.code === role }, `${roleLabel(x.code)} (${x.code})`)));
        const save = can('settings', 'EDIT') && role !== 'FOUNDER' ? h('button', { class: 'btn sm pri', onClick: async () => { try { await put(`/api/roles/${role}/permissions`, { matrix: m }); toast('Saqlandi', 'ok'); const nr = await get('/api/roles'); r.matrix = nr.matrix; } catch (e) { err(e); } } }, 'Saqlash') : null;
        const rowsEl = r.resources.map((res) => h('tr', {}, h('td', {}, RESOURCE_LABEL[res] || res), ...r.actions.map((a) => h('td', { class: 'center' }, h('input', { type: 'checkbox', checked: (m[res] || []).includes(a), disabled: role === 'FOUNDER' || !can('settings', 'EDIT'), onChange: (e) => { m[res] ??= []; if (e.target.checked) m[res].push(a); else m[res] = m[res].filter((x) => x !== a); } })))));
        const table = h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Bo‘lim (resurs)'), ...r.actions.map((a) => h('th', { class: 'center' }, ACT[a] || a)))), h('tbody', {}, ...rowsEl));
        body.replaceChildren(card('Ruxsatlar matritsasi', h('div', {}, h('div', { class: 'flex gap8 mb12' }, sel, save), h('div', { class: 'tbl-wrap' }, table))));
      };
      draw();
    } else if (tab === 'departments') {
      setTitle('Sozlamalar', 'Bo‘limlar — rahbar tasdiqlash zanjirida, xizmat turi rentabellikda ishlatiladi');
      const [depts, users, sts] = await Promise.all([get('/api/departments'), get('/api/users'), get('/api/service-types')]);
      const form = (d = {}) => formModal({ title: d.id ? d.name : 'Yangi bo‘lim', fields: [{ name: 'name', label: 'Nomi', required: true, value: d.name }, { name: 'code', label: 'Kod', value: d.code }, { name: 'head_user_id', label: 'Rahbar', type: 'select', options: [['', '—'], ...users.map((u) => [u.id, `${u.name} (${roleLabel(u.role_code)})`])], value: d.head_user_id }, { name: 'service_type_id', label: 'Xizmat turi', type: 'select', options: [['', '—'], ...sts.map((s) => [s.id, s.name])], value: d.service_type_id }], submit: async (v) => { const b = { ...v, head_user_id: v.head_user_id || null, service_type_id: v.service_type_id || null }; if (d.id) await patch('/api/departments/' + d.id, b); else await post('/api/departments', b); toast('Saqlandi', 'ok'); load(); } });
      body.replaceChildren(card('Bo‘limlar', dataTable({ columns: [{ key: 'code', label: 'Kod' }, { key: 'name', label: 'Nomi' }, { key: 'head_name', label: 'Rahbar' }, { key: 'service_code', label: 'Xizmat turi' }], rows: depts, search: false, onRow: can('settings', 'EDIT') ? form : null }).el, [can('settings', 'EDIT') ? h('button', { class: 'btn xs pri', onClick: () => form() }, icon('plus', 13), 'Bo‘lim') : null], { tight: true }));
    } else if (tab === 'recurring') {
      setTitle('Sozlamalar', 'Doimiy xarajatlar — kutilayotgan chiqim va prognozda hisobga olinadi');
      const [rx, cats] = await Promise.all([get('/api/recurring-expenses'), get('/api/expenses/categories')]);
      const form = (x = {}) => formModal({ title: x.id ? x.name : 'Doimiy xarajat', fields: [{ name: 'name', label: 'Nomi', required: true, value: x.name }, { name: 'category_id', label: 'Kategoriya', type: 'select', options: cats.map((c) => [c.id, c.name]), value: x.category_id }, { name: 'amount', label: 'Summa', type: 'number', required: true, value: x.amount }, { name: 'day_of_month', label: 'Oyning kuni', type: 'number', value: x.day_of_month || 1 }, { name: 'is_active', label: 'Faol', type: 'checkbox', value: x.is_active ?? true }], submit: async (v) => { if (x.id) await patch('/api/recurring-expenses/' + x.id, v); else await post('/api/recurring-expenses', v); toast('Saqlandi', 'ok'); load(); } });
      body.replaceChildren(card('Doimiy xarajatlar', dataTable({ columns: [{ key: 'name', label: 'Nomi' }, { key: 'category_name', label: 'Kategoriya' }, { key: 'amount', label: 'Summa', money: true }, { key: 'day_of_month', label: 'Kun' }, { key: 'is_active', label: 'Faol', render: (r) => badge(r.is_active ? 'OK' : 'CANCELLED', r.is_active ? 'Ha' : 'Yo‘q') }], rows: rx, search: false, onRow: can('expenses', 'EDIT') ? form : null }).el, [can('expenses', 'EDIT') ? h('button', { class: 'btn xs pri', onClick: () => form() }, icon('plus', 13), 'Qo‘shish') : null], { tight: true }));
    } else if (tab === 'scheduler') {
      setTitle('Sozlamalar', 'Fon vazifalari va zaxira nusxalar');
      const jobs = await get('/api/settings/scheduler');
      body.replaceChildren(h('div', { class: 'grid g2' }, card('Fon vazifalari', h('div', { class: 'list' }, ...jobs.map((j) => h('div', { class: 'li', style: { alignItems: 'center' } }, h('div', { class: 'grow' }, h('div', { class: 't' }, j.description || j.name), h('div', { class: 's' }, `${j.name} · ${j.schedule.replace('daily', 'har kuni').replace('every', 'har').replace('m', ' daqiqa')} · oxirgi: ${j.last_run ? dt(j.last_run) : '—'}`)), can('settings', 'EDIT') ? h('button', { class: 'btn xs', title: 'Hozir ishga tushirish', onClick: async (e) => { e.target.disabled = true; try { const r = await post(`/api/settings/scheduler/${j.name}/run`); toast(JSON.stringify(r.result).slice(0, 150), 'ok'); load(); } catch (x) { err(x); } } }, icon('zap', 13)) : null)))),
        card('Zaxira nusxa', h('div', {}, h('p', { class: 'small muted', style: { marginTop: 0 } }, 'Har kuni 03:00 da avtomatik zaxira (data/backups). Saqlash muddati «Biznes qoidalari» bo‘limida. Tiklash: serverni to‘xtatib, kerakli faylni DB_PATH o‘rniga qo‘ying (deploy/restore.sh).'), can('settings', 'EDIT') ? h('button', { class: 'btn pri', onClick: async (e) => { e.target.disabled = true; try { const r = await post('/api/settings/backup'); toast(`Zaxira: ${Math.round(r.size / 1024)} KB`, 'ok'); modal({ title: 'Zaxira nusxalar', body: h('ul', {}, ...r.backups.map((b) => h('li', {}, b))) }); } catch (x) { err(x); } finally { e.target.disabled = false; } } }, icon('download', 15), 'Hozir zaxiralash') : null))));
    } else if (tab === 'bots') {
      setTitle('Sozlamalar', 'Telegram botlar — holat, foydalanuvchilar va Mini App');
      body.replaceChildren(await botsAdmin());
    } else if (tab === 'profile') {
      setTitle('Sozlamalar', 'Profil, ikki bosqichli tasdiqlash va Telegram botlar');
      const [m, bots] = await Promise.all([get('/api/auth/me'), get('/api/bots').catch((e) => ({ error: e }))]);
      const u = m.user;
      body.replaceChildren(h('div', { class: 'grid g2' },
        card('Profil', h('div', {}, kv([['Ism', u.name], ['Elektron pochta', u.email], ['Rol', roleLabel(u.role_code)], ['Bo‘lim', m.department?.name || '—'], ['Oxirgi kirish', dt(u.last_login_at)]]), h('div', { class: 'mt16' }, h('button', { class: 'btn', onClick: () => formModal({ title: 'Parolni o‘zgartirish', fields: [{ name: 'current_password', label: 'Joriy parol', type: 'password', required: true }, { name: 'new_password', label: 'Yangi parol (kamida 8 belgi)', type: 'password', required: true }], submit: async (v) => { await post('/api/auth/password', v); toast('Parol o‘zgartirildi', 'ok'); } }) }, 'Parolni o‘zgartirish')))),
        card('Ikki bosqichli tasdiqlash (2FA)', h('div', {}, h('p', { style: { marginTop: 0 } }, 'Holat: ', badge(u.totp_enabled ? 'OK' : 'WARNING', u.totp_enabled ? 'yoqilgan' : 'o‘chirilgan')), u.totp_enabled ? h('button', { class: 'btn danger', onClick: () => formModal({ title: '2FA ni o‘chirish', fields: [{ name: 'password', label: 'Parol', type: 'password', required: true }], submit: async (v) => { await post('/api/auth/2fa/disable', v); toast('2FA o‘chirildi', 'ok'); load(); } }) }, '2FA ni o‘chirish') : h('button', { class: 'btn pri', onClick: async () => { const s = await post('/api/auth/2fa/setup'); formModal({ title: '2FA sozlash', fields: [{ name: 'code', label: 'Authenticator ilovasidagi 6 raqamli kod', required: true, full: true, hint: `Maxfiy kalit: ${s.secret} — Google Authenticator yoki Authy ga qo‘shing (${s.otpauth_url})` }], submit: async (v) => { await post('/api/auth/2fa/enable', v); toast('2FA yoqildi', 'ok'); load(); } }); } }, '2FA ni yoqish')))),
        h('div', { class: 'mt16' }, bots.error ? card('Telegram botlar', alert('crit', 'Botlar ma’lumotini olib bo‘lmadi: ' + bots.error.message)) : telegramCard(bots)),
        can('notifications') ? h('div', { class: 'mt16' }, await prefsCard(!!bots?.me?.linked)) : null);
    }
  }

  // ---------- Telegram botlar (Profil) ----------
  const BOT_ICON = { rahbar: 'briefcase', buxgalter: 'coins', sorov: 'receipt', signal: 'bell' };

  /** Mening Telegram ulanishim + menga ruxsat etilgan botlar (GET /api/bots) */
  function telegramCard(data) {
    const me = data.me;
    const mine = data.bots.filter((b) => b.allowed);
    const others = data.bots.filter((b) => !b.allowed);
    const status = h('div', { class: 'flex wrap gap8' },
      badge(me.linked ? 'OK' : 'WARNING', me.linked ? 'ulangan' : 'ulanmagan'),
      me.linked
        ? h('span', { class: 'small' }, me.telegram_username ? h('a', { href: `https://t.me/${me.telegram_username}`, target: '_blank', rel: 'noopener' }, '@' + me.telegram_username) : 'Telegram hisobi', me.linked_at ? h('span', { class: 'muted' }, ` · ${dt(me.linked_at)} dan beri`) : null)
        : h('span', { class: 'small muted' }, 'Bog‘lash bir marta qilinadi va barcha UTAX botlariga amal qiladi: buyruqlar, tasdiqlar va bildirishnomalar.'));
    const unlink = async () => {
      if (!(await confirmDlg('Telegram hisobini uzasizmi? UTAX botlari sizni tanimay qoladi va bildirishnomalar Telegram’ga kelmaydi.', { okLabel: 'Uzish', danger: true }))) return;
      try { await post('/api/auth/telegram-unlink'); toast('Telegram uzildi', 'ok'); load(); } catch (e) { err(e); }
    };
    const actions = [
      h('button', { class: 'btn sm ' + (me.linked ? '' : 'pri'), onClick: () => openLinkModal(me) }, icon('link', 14), me.linked ? 'Qayta ulash' : 'Ulash'),
      me.linked ? h('button', { class: 'btn sm ghost', onClick: unlink }, icon('x', 14), 'Uzish') : null,
    ];
    const signal = mine.find((b) => b.key === 'signal');
    return card('Telegram botlar', h('div', {},
      status,
      !data.running ? h('div', { class: 'mt12' }, alert('warn', `Botlar hozir ishlamayapti (server rejimi: ${data.mode}). Bog‘lash kodi baribir saqlanadi — botlar yoqilgach ishlaydi.`)) : null,
      me.linked && signal && !signal.started ? h('div', { class: 'mt12' }, alert('info', h('span', {}, 'Bildirishnomalar ', h('a', { href: signal.url, target: '_blank', rel: 'noopener' }, '@' + signal.username), ' orqali keladi — uni oching va «Start» ni bosing.'), 'bell')) : null,
      mine.length ? h('div', { class: 'list mt12' }, ...mine.map((b) => botRow(b, me))) : h('div', { class: 'mt12' }, emptyState('Rolingiz uchun bot yo‘q', '', 'bot')),
      others.length ? h('div', { class: 'xs muted mt8' }, `Rolingiz uchun mo‘ljallanmagan: ${others.map((b) => b.title).join(', ')}`) : null),
    actions, { sub: `${mine.length} ta bot` });
  }

  function botRow(b, me) {
    const started = b.started
      ? b.started.blocked ? badge('CRITICAL', 'siz bloklagansiz') : badge('INFO', `ochilgan · ${dt(b.started.last_seen_at || b.started.at)}`)
      : badge('WARNING', 'siz hali ochmagansiz');
    const test = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try { await post(`/api/bots/${b.key}/test`); toast(`Test xabar yuborildi — @${b.username} ni tekshiring`, 'ok'); } catch (x) { err(x); } finally { btn.disabled = false; }
    };
    return h('div', { class: 'li bot-row' },
      h('div', { class: 'tile green' }, icon(BOT_ICON[b.key] || 'bot', 18)),
      h('div', { class: 'grow' },
        h('div', { class: 't' }, b.title, ' ', h('a', { href: b.url, target: '_blank', rel: 'noopener', class: 'small', style: { fontWeight: 500 } }, '@' + b.username)),
        b.about ? h('div', { class: 's' }, b.about) : null,
        h('div', { class: 'flex wrap gap6 mt4' }, badge(b.running ? 'OK' : 'CANCELLED', b.running ? 'ishlayapti' : 'ishlamayapti'), started),
        b.commands?.length ? h('details', { class: 'cmds mt8' }, h('summary', {}, `Buyruqlar (${b.commands.length})`), h('div', { class: 'cmd-list' }, ...b.commands.map((c) => h('div', {}, h('code', {}, c.usage || '/' + c.name), ' — ', c.desc)))) : null),
      h('div', { class: 'flex wrap gap6 bot-acts' },
        h('a', { class: 'btn xs', href: b.url, target: '_blank', rel: 'noopener' }, icon('send', 13), 'Ochish'),
        h('button', { class: 'btn xs', disabled: !me.linked || !b.running, title: !me.linked ? 'Avval Telegramni ulang' : !b.running ? 'Bot ishlamayapti' : 'O‘zingizga test xabar', onClick: test }, icon('zap', 13), 'Test xabar')));
  }

  /** Bog'lash kodi + deep link'lar; bog'lanish sodir bo'lgach modal o'zi yopiladi */
  async function openLinkModal(me) {
    let r;
    try { r = await post('/api/auth/telegram-link'); } catch (e) { return err(e); }
    const sig = r.links.find((l) => l.key === 'signal');
    const wait = h('div', { class: 'small muted center mt12' }, '⏳ Bog‘lanish kutilmoqda…');
    let timer = null;
    const m = modal({
      title: 'Telegram’ni ulash', size: 'sm',
      body: h('div', {},
        h('p', { style: { marginTop: 0 } }, 'Quyidagi botlardan birini oching va «Start» tugmasini bosing — hisobingiz avtomatik bog‘lanadi. Bitta bog‘lash barcha UTAX botlariga amal qiladi.'),
        h('div', { class: 'tg-code', title: 'Bog‘lash kodi' }, r.code),
        r.links.length
          ? h('div', { class: 'grid mt12', style: { gap: '8px' } }, ...r.links.map((l) => h('a', { class: 'btn ' + (l.key === 'signal' ? 'pri' : ''), href: l.url, target: '_blank', rel: 'noopener', style: { justifyContent: 'center' } }, icon(BOT_ICON[l.key] || 'send', 14), `${l.title} · @${l.username}`)))
          : h('div', { class: 'mt12' }, alert('warn', 'Rolingiz uchun bot topilmadi.')),
        h('p', { class: 'xs muted mt12' }, `Kod ${dt(r.expires_at)} gacha amal qiladi. Qo‘lda ulash: botga `, h('code', {}, `/start ${r.code}`), ' yuboring.', sig ? ` Bildirishnomalar @${sig.username} orqali keladi — uni albatta oching.` : ''),
        wait),
      footer: [h('button', { class: 'btn', onClick: () => m.close() }, 'Yopish')],
      onClose: () => { clearInterval(timer); load(); },
    });
    const started = Date.now();
    timer = setInterval(async () => {
      if (Date.now() - started > 3 * 60e3) { clearInterval(timer); wait.textContent = 'Kutish vaqti tugadi. Botda «Start» ni bosganingizdan so‘ng oynani yoping.'; return; }
      try {
        const d = await get('/api/bots');
        if (d.me.linked && d.me.linked_at !== me.linked_at) { clearInterval(timer); toast('✅ Telegram ulandi' + (d.me.telegram_username ? ': @' + d.me.telegram_username : ''), 'ok'); m.close(); }
      } catch {}
    }, 4000);
  }

  /** Telegram bildirishnoma turlari va jim soatlar (GET/PUT /api/notifications/prefs) */
  async function prefsCard(linked) {
    let p;
    try { p = await get('/api/notifications/prefs'); } catch (e) { return card('Telegram bildirishnomalari', alert('crit', e.message)); }
    const editable = can('notifications', 'EDIT');
    const boxes = p.types.map((t) => ({ t, el: h('input', { type: 'checkbox', checked: t.telegram, disabled: !editable }) }));
    const qOn = h('input', { type: 'checkbox', checked: !!p.quiet, disabled: !editable });
    const qFrom = h('input', { class: 'input sm', type: 'time', value: p.quiet?.from || '22:00' });
    const qTo = h('input', { class: 'input sm', type: 'time', value: p.quiet?.to || '08:00' });
    const syncQuiet = () => { qFrom.disabled = qTo.disabled = !editable || !qOn.checked; };
    qOn.addEventListener('change', syncQuiet);
    syncQuiet();
    const setAll = (v) => boxes.forEach((b) => { b.el.checked = v; });
    const save = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        if (qOn.checked && (!qFrom.value || !qTo.value)) throw new Error('Jim soatlarning boshlanish va tugash vaqtini kiriting');
        if (qOn.checked && qFrom.value === qTo.value) throw new Error('Jim soatlarning boshlanishi va tugashi bir xil bo‘lmasin');
        await put('/api/notifications/prefs', { types: Object.fromEntries(boxes.map((b) => [b.t.type, b.el.checked])), quiet: qOn.checked ? { from: qFrom.value, to: qTo.value } : null });
        toast('Bildirishnoma sozlamalari saqlandi', 'ok');
      } catch (x) { err(x); } finally { btn.disabled = false; }
    };
    return card('Telegram bildirishnomalari', h('div', {},
      h('p', { class: 'small muted', style: { marginTop: 0 } }, 'Qaysi turdagi ogohlantirishlar Telegram’ga kelsin. Web paneldagi «Bildirishnomalar» sahifasida hammasi baribir ko‘rinadi.'),
      h('div', { class: 'chk-grid' }, ...boxes.map((b) => h('label', { class: 'chk' }, b.el, h('span', {}, b.t.label)))),
      h('div', { class: 'sec-title' }, 'Jim soatlar'),
      h('div', { class: 'flex wrap gap8' }, h('label', { class: 'chk' }, qOn, h('span', {}, 'Yoqilgan')), qFrom, h('span', { class: 'muted' }, '—'), qTo),
      h('div', { class: 'xs muted mt4' }, 'Jim soatlarda faqat kritik ogohlantirishlar darhol keladi, qolganlari jim soat tugagach yuboriladi (Toshkent vaqti).'),
      editable
        ? h('div', { class: 'flex wrap gap8 mt16' }, h('button', { class: 'btn pri', onClick: save }, icon('check', 14), 'Saqlash'), h('button', { class: 'btn ghost', onClick: () => setAll(true) }, 'Hammasini yoqish'), h('button', { class: 'btn ghost', onClick: () => setAll(false) }, 'Hammasini o‘chirish'))
        : h('div', { class: 'xs muted mt12' }, 'Sozlamalarni o‘zgartirishga ruxsatingiz yo‘q.')),
    null, { sub: linked ? '' : 'Telegram ulangach amal qiladi' });
  }

  // ---------- Telegram botlar (admin tab) ----------
  async function botsAdmin() {
    const [data, chats, linked] = await Promise.all([get('/api/bots'), get('/api/bots/chats'), can('users') ? get('/api/bots/linked-users').catch(() => null) : null]);
    const MODE = { polling: 'polling (lokal)', webhook: 'webhook (server)', off: 'o‘chirilgan' };
    const w = data.webapp || {};
    const configured = data.bots.filter((b) => b.configured).length;
    const modeAlert = alert(data.running ? 'good' : 'warn', `Rejim: ${MODE[data.mode] || data.mode} · ${data.running ? 'botlar ishlayapti' : 'botlar ishlamayapti'} · token sozlangan: ${configured}/${data.bots.length}`, 'bot');
    const webappAlert = w.mini_app
      ? alert('good', `Telegram Mini App yoqilgan: ${w.base} — botlardagi «Web’da ochish» tugmalari panelni Telegram ichida ochadi va avtomatik kiritadi.`)
      : w.enabled
        ? alert('warn', `Web havolalar oddiy URL sifatida ochiladi (${w.base}). Telegram Mini App uchun WEBAPP_URL https:// bilan boshlanishi kerak.`)
        : alert('info', 'WEBAPP_URL sozlanmagan yoki lokal manzil (localhost / ichki tarmoq) — botlardagi «Web’da ochish» tugmalari chiqmaydi. .env ga WEBAPP_URL=https://crm.domen.uz yozing.');
    const botsTable = dataTable({
      columns: [
        { key: 'title', label: 'Bot', render: (r) => h('div', {}, h('div', { class: 'bold' }, r.title), h('a', { href: r.url, target: '_blank', rel: 'noopener', class: 'xs' }, '@' + r.username)) },
        { key: 'configured', label: 'Token', render: (r) => badge(r.configured ? 'OK' : 'CRITICAL', r.configured ? 'sozlangan' : 'yo‘q') },
        { key: 'running', label: 'Holat', render: (r) => badge(r.running ? 'OK' : 'CANCELLED', r.running ? 'ishlayapti' : 'to‘xtagan') },
        { key: 'started_at', label: 'Ishga tushgan', datetime: true },
        { key: 'last_update_at', label: 'Oxirgi update', datetime: true },
        { key: 'last_poll_at', label: 'Oxirgi so‘rov', datetime: true },
        { key: 'handled', label: 'Update soni', right: true },
        { key: 'users', label: 'Foydalanuvchilar', right: true },
        { key: 'allowed_roles', label: 'Kimga', render: (r) => { const roles = r.allowed_roles || []; return h('span', { class: 'xs muted', title: roles.map(roleLabel).join(', ') }, roles.length >= 9 ? `Barcha xodimlar (${roles.length} rol)` : roles.map(roleLabel).join(', ')); } },
        { key: 'last_error', label: 'Oxirgi xato', render: (r) => (r.last_error ? h('span', { class: 'xs neg' }, r.last_error) : '—') },
      ],
      rows: data.bots, search: false, pageSize: 10,
    }).el;
    const BOT_TITLE = Object.fromEntries(data.bots.map((b) => [b.key, b.title]));
    const chatsEl = chats.length
      ? dataTable({
        columns: [
          { key: 'bot_key', label: 'Bot', render: (r) => BOT_TITLE[r.bot_key] || r.bot_key },
          { key: 'name', label: 'Foydalanuvchi', render: (r) => (r.name ? h('div', {}, h('div', {}, r.name), h('div', { class: 'xs muted' }, r.email)) : h('span', { class: 'muted' }, 'bog‘lanmagan')) },
          { key: 'role_code', label: 'Rol', render: (r) => (r.role_code ? roleLabel(r.role_code) : '—') },
          { key: 'tg_username', label: 'Telegram', render: (r) => (r.tg_username ? '@' + r.tg_username : '—') },
          { key: 'started_at', label: 'Boshlagan', datetime: true },
          { key: 'last_seen_at', label: 'Oxirgi faollik', datetime: true },
          { key: 'blocked_at', label: 'Holat', render: (r) => (r.blocked_at ? badge('CRITICAL', 'bloklagan') : badge('OK', 'faol')) },
        ],
        rows: chats, exportName: 'telegram-bot-foydalanuvchilari', filters: [{ key: 'bot_key', label: 'Barcha botlar', options: data.bots.map((b) => [b.key, b.title]) }],
      }).el
      : emptyState('Hali hech kim botlarni ochmagan', 'Foydalanuvchilar Profil → Telegram botlar orqali ulangach shu yerda ko‘rinadi', 'bot');
    const linkedEl = linked
      ? linked.length
        ? dataTable({
          columns: [
            { key: 'name', label: 'F.I.Sh.' }, { key: 'email', label: 'Elektron pochta' }, { key: 'role_code', label: 'Rol', render: (r) => roleLabel(r.role_code) },
            { key: 'telegram_username', label: 'Telegram', render: (r) => (r.telegram_username ? '@' + r.telegram_username : '—') },
            { key: 'telegram_linked_at', label: 'Bog‘langan', datetime: true },
            { key: 'is_active', label: 'Faol', render: (r) => badge(r.is_active ? 'OK' : 'CANCELLED', r.is_active ? 'Ha' : 'Bloklangan') },
          ],
          rows: linked, exportName: 'telegram-boglangan-foydalanuvchilar',
        }).el
        : emptyState('Telegram bog‘langan foydalanuvchi yo‘q', '', 'user')
      : null;
    const envHelp = kv([
      ['BOT_RAHBAR_TOKEN … BOT_SIGNAL_TOKEN', '4 ta bot tokeni (@BotFather)'],
      ['BOT_MODE', 'polling — lokal; webhook — server (PUBLIC_URL https + WEBHOOK_SECRET); off — o‘chiq'],
      ['WEBAPP_URL', 'Web panel manzili; https bo‘lsa botlardan Telegram Mini App sifatida ochiladi'],
      ['TELEGRAM_ALERT_CHAT_ID', 'Kritik ogohlantirishlar yuboriladigan guruh (ixtiyoriy)'],
    ]);
    return h('div', {},
      h('div', { class: 'grid', style: { gap: '10px' } }, modeAlert, webappAlert),
      h('div', { class: 'mt16' }, card('Botlar', botsTable, null, { tight: true, sub: 'token, holat, faollik' })),
      h('div', { class: 'mt16' }, card('Kim qaysi botda', chatsEl, null, { tight: !!chats.length, sub: `${chats.length} ta chat` })),
      linkedEl ? h('div', { class: 'mt16' }, card('Telegram bog‘langan foydalanuvchilar', linkedEl, null, { tight: !!linked.length, sub: `${linked.length} ta` })) : null,
      h('div', { class: 'mt16' }, card('Sozlash (.env)', envHelp, null, { sub: 'o‘zgartirgandan keyin serverni qayta ishga tushiring' })));
  }
  drawTabs();
  root.append(tabs, body);
  await load();
}
