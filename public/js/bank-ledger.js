// Dashboard: ko'p kompaniyali bank qatlami (UGS / UTAX / Global) + ERP holati banneri.
// Ma'lumot: /api/bank-ledger/* — bank ko'chirmasi fayli va qo'lda kiritilgan kassa. ERP'dan mustaqil yuklanadi:
// ERP yoki asosiy dashboard xato bersa ham bu blok ishlaydi (va aksincha).
import { get, post, put, qs, api } from './api.js';
import { h, card, kpiCard, fmt, money, date, dt, badge, monthLabel, emptyState, alert, drawer, modal, formModal, dataTable, fileDrop, toast, err, icon, kv } from './ui.js';

const SRC_BADGE = { BANK_FILE: 'SRC_BANK_FILE', MANUAL: 'SRC_MANUAL', ERP: 'SRC_ERP' };
const readB64 = (f) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = () => rej(fr.error); fr.readAsDataURL(f); });
const fmt2 = (n) => fmt(n, 2);
const srcOf = (a) => a.source_file || a.statement?.source_file || null;
/** Manba faylini yuklab olish — raqam aynan qaysi fayldan olinganini tekshirish uchun */
async function downloadSource(f) {
  try {
    const res = await api(`/api/bank-ledger/source-files/${f.entity}/${f.entity_id}`, { raw: true });
    const url = URL.createObjectURL(await res.blob());
    const a = h('a', { href: url, download: f.file_name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { err(e); }
}
/** Manba badge'i: fayl saqlangan bo'lsa — bosilganda asl fayl yuklanadi */
function sourceBadge(a) {
  const f = srcOf(a);
  const b = badge(SRC_BADGE[a.source]);
  if (!f) return b;
  b.classList.add('link'); b.setAttribute('role', 'button'); b.tabIndex = 0;
  b.title = `Asl faylni yuklab olish: ${f.file_name}`;
  b.prepend(icon('download', 11), ' ');
  b.addEventListener('click', () => downloadSource(f));
  b.addEventListener('keydown', (e) => { if (e.key === 'Enter') downloadSource(f); });
  return b;
}
/** Doiradagi barcha manba fayllari ro'yxati */
function sourcesDlg(d) {
  const rows = d.accounts.filter((a) => a.has_data);
  modal({ title: `Manba fayllari · ${monthLabel(d.month)}`, body: h('div', {},
    h('div', { class: 'list' }, ...rows.map((a) => {
      const f = srcOf(a);
      return h('div', { class: 'li' }, h('div', { class: 'grow' }, h('div', { class: 't' }, `${a.company_code} · ${a.label}`),
        h('div', { class: 's' }, f ? `${f.file_name} · ${(f.size / 1024).toFixed(0)} KB · yuklangan ${dt(f.stored_at)}` : a.source === 'MANUAL' ? 'Qo‘lda kiritilgan, fayl biriktirilmagan' : 'Asl fayl saqlanmagan — qayta import qiling')),
        badge(SRC_BADGE[a.source]), f ? h('button', { class: 'btn xs', onClick: () => downloadSource(f) }, icon('download', 13), 'Yuklab olish') : null);
    })),
    h('div', { class: 'mt12' }, alert('mint', 'Dashboard’dagi har bir raqam shu fayllardan olingan. Faylni yuklab, Excel’da ochib solishtirishingiz mumkin.'))) });
}

/** ERP holati banneri: token eskirgan yoki oxirgi sinxron xato bo'lsa — sariq ogohlantirish + "Tokenni yangilash" */
export async function erpBanner(el, { can }) {
  let s;
  try { s = await get('/api/bank-ledger/erp-status'); } catch { el.replaceChildren(); return; }
  if (!s.connected || !s.stale) { el.replaceChildren(); return; }
  const btn = can('integrations', 'EDIT') ? h('button', { class: 'btn sm', onClick: () => tokenDlg(() => erpBanner(el, { can })) }, icon('refresh', 15), 'Tokenni yangilash') : null;
  const why = s.token_expired ? `ERP tokeni eskirgan (${date(s.token_expires_at)})` : 'ERP javob bermayapti';
  el.replaceChildren(h('div', { class: 'alert warn mb16 flex wrap gap12' }, icon('alert', 16),
    h('div', { class: 'grow' }, `${why}, oxirgi sinxronizatsiya: ${s.last_sync_at ? dt(s.last_sync_at) : '--'}. ERP ko‘rsatkichlari shu holatdagi ma’lumotdan, bank ma’lumotlari fayl importidan ko‘rsatilmoqda.`), btn));
}

function tokenDlg(done) {
  const inp = h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: 'eyJhbGciOi…' });
  const m = modal({ title: 'ERP tokenini yangilash', size: 'sm',
    body: h('div', { class: 'field' }, h('label', {}, 'Yangi access token'), inp, h('div', { class: 'hint' }, 'Token shifrlangan holda saqlanadi, ekranda va logda ko‘rsatilmaydi.')),
    footer: [h('button', { class: 'btn', onClick: () => m.close() }, 'Bekor qilish'), h('button', { class: 'btn pri', onClick: async (e) => {
      e.target.disabled = true;
      try { const r = await post('/api/integrations/erp-token', { token: inp.value }); toast(`Token saqlandi · ${date(r.token_expires_at)} gacha amal qiladi`, 'ok'); m.close(); done?.(); }
      catch (x) { err(x); } finally { e.target.disabled = false; }
    } }, 'Saqlash')] });
  setTimeout(() => inp.focus(), 50);
}

/**
 * Bank bloki. Tanlov URL'da saqlanadi: #/dashboard?company=ugs&account=<raqam>&month=2026-07
 */
export async function bankBlock(el, { can, query }) {
  const st = { company: (query.company || 'global').toLowerCase(), account: query.account || 'all', month: query.month || '' };
  const saveUrl = () => {
    const q = qs({ company: st.company !== 'global' ? st.company : '', account: st.account !== 'all' ? st.account : '', month: st.month });
    history.replaceState(null, '', '#/dashboard' + q);
  };
  async function load() {
    let d;
    try { d = await get('/api/bank-ledger/summary' + qs({ company: st.company, account: st.account, month: st.month })); }
    catch (e) {
      // Noto'g'ri URL tanlovi (masalan, o'chirilgan hisob) — globalga qaytamiz
      if (e.status === 404 && (st.company !== 'global' || st.account !== 'all')) { st.company = 'global'; st.account = 'all'; saveUrl(); return load(); }
      el.replaceChildren(card('Bank hisoblari', alert('crit', 'Bank bloki yuklanmadi: ' + e.message))); return;
    }
    st.month = d.month || '';
    saveUrl();
    el.replaceChildren(render(d));
    if (d.has_data) {
      // Kartalar ostida — tanlovga bog'liq jadvallar: hisoblar kesimi (Excel ko'rinishi) va operatsiyalar ro'yxati
      const ops = h('div', { class: 'mt16' }, card('Operatsiyalar', h('div', { class: 'empty-state' }, 'Yuklanmoqda…'), null, { tight: true }));
      el.append(h('div', { class: 'mt16' }, summaryTable(d)), ops);
      opsTable(ops, d, st);
    }
  }

  /** Karta sarlavhasidagi tugmalar. `d` bo'lmasa ham ishlaydi (reyestr bo'sh holati) */
  function bankActions(d) {
    return [
      can('treasury', 'CREATE') && d ? h('button', { class: 'btn xs', onClick: () => cashDlg(d, load) }, icon('plus', 13), 'Kassa') : null,
      can('transactions', 'CREATE') ? h('button', { class: 'btn xs', onClick: () => importDlg(load) }, icon('upload', 13), 'Bank ko‘chirmasi') : null,
    ].filter(Boolean);
  }

  function render(d) {
    // Reyestr bo'sh bo'lsa pastdagi hech narsa kerak emas — va `d.sources` hali javobda ham bo'lmaydi
    if (!d.registry.length) return card('Bank hisoblari', emptyState('Reyestr bo‘sh', 'Kompaniya va hisoblar hali kiritilmagan — scripts/bank-import.mjs --registry yoki API orqali qo‘shing', 'bank'), bankActions());
    const comps = d.registry;
    const selCompany = h('select', { class: 'select sm', 'aria-label': 'Kompaniya', onChange: (e) => { st.company = e.target.value; st.account = 'all'; load(); } },
      h('option', { value: 'global', selected: st.company === 'global' }, 'Global — barcha kompaniyalar'),
      ...comps.map((c) => h('option', { value: c.code.toLowerCase(), selected: st.company === c.code.toLowerCase() }, `${c.code} — ${c.name}`)));
    const visibleAccs = comps.filter((c) => st.company === 'global' || c.code.toLowerCase() === st.company).flatMap((c) => c.accounts.map((a) => ({ ...a, cc: c.code })));
    const selAccount = h('select', { class: 'select sm', 'aria-label': 'Hisob', onChange: (e) => { st.account = e.target.value; load(); } },
      h('option', { value: 'all', selected: st.account === 'all' }, 'Barcha hisoblar'),
      h('option', { value: 'banks', selected: st.account === 'banks' }, 'Barcha bank hisoblari (UGS + UTAX, kassasiz)'),
      ...visibleAccs.map((a) => h('option', { value: a.account_number, selected: st.account === a.account_number }, `${st.company === 'global' ? a.cc + ' · ' : ''}${a.label}`)));
    const selMonth = h('select', { class: 'select sm', 'aria-label': 'Oy', onChange: (e) => { st.month = e.target.value; load(); } },
      ...(d.months.length ? d.months.map((m) => h('option', { value: m, selected: m === d.month }, monthLabel(m))) : [h('option', { value: '' }, 'Oy yo‘q')]));
    const actions = bankActions(d);
    const scopeName = d.level === 'banks' ? 'Barcha bank hisoblari' : d.level === 'account' ? d.accounts[0]?.label : d.company ? d.company.code : 'Global';
    const sources = h('button', { class: 'btn xs ghost', title: 'Ma’lumot olingan asl fayllar', onClick: () => sourcesDlg(d) }, ...(d.sources || []).map((s) => badge(SRC_BADGE[s] || s)), icon('download', 13));
    const filters = h('div', { class: 'flex wrap gap8 mb12' }, selCompany, selAccount, selMonth, h('div', { class: 'grow' }), sources);
    if (!d.has_data) return card('Bank hisoblari', h('div', {}, filters, emptyState('Ma’lumot yo‘q', `${d.month ? monthLabel(d.month) + ' uchun' : 'Hali'} bank ko‘chirmasi yuklanmagan — “Bank ko‘chirmasi” tugmasi orqali .xls faylni yuklang`, 'upload')), actions, { sub: scopeName });

    const net = d.internal_excluded && (d.internal_in || d.internal_out);
    const inSub = net ? `Yalpi ${fmt(d.inflow_gross)} · ichki o‘tkazmasiz` : d.internal_in ? `Shundan ichki o‘tkazma ${fmt(d.internal_in)}` : 'Oy davomida kirim';
    const outSub = net ? `Yalpi ${fmt(d.outflow_gross)} · ichki o‘tkazmasiz` : d.internal_out ? `Shundan ichki o‘tkazma ${fmt(d.internal_out)}` : 'Oy davomida chiqim';
    const link = (el2, fn) => { el2.addEventListener('click', (e) => { e.preventDefault(); fn(); }); return el2; };
    const kpis = h('div', { class: 'kpis c4 mb12' },
      link(kpiCard({ size: 'sm', icon: 'wallet', tone: 'blue', href: '#', label: `Boshlang‘ich qoldiq · ${monthLabel(d.month)}`, value: d.opening, sub: d.missing.length ? `Ma’lumot yo‘q: ${d.missing.join(', ')}` : 'Bank ko‘chirmasidan' }), () => breakdown(d)),
      link(kpiCard({ size: 'sm', icon: 'inflow', tone: 'green', href: '#', label: 'Tushum', value: d.inflow, sub: inSub }), () => linesDrawer(d, st, 'IN')),
      link(kpiCard({ size: 'sm', icon: 'receipt', tone: 'orange', href: '#', label: 'Xarajat', value: d.outflow, sub: outSub }), () => linesDrawer(d, st, 'OUT')),
      link(kpiCard({ size: 'sm', accent: true, icon: 'coins', tone: 'green', href: '#', label: 'Balans (yakuniy qoldiq)', value: d.closing, sub: d.check_ok ? 'Fayldagi yakuniy qoldiq bilan mos' : 'Tekshiring: fayl bilan farq bor', cls: d.check_ok ? '' : 'warn' }), () => breakdown(d)));
    return card('Bank hisoblari', h('div', {}, filters, kpis,
      net ? h('div', { class: 'small muted' }, `Ichki o‘tkazmalar (${scopeName} hisoblari orasida) tushum va xarajatdan chiqarilgan: ${fmt(d.internal_in)} so‘m. Hisob darajasida ular saqlanadi.`) : null),
    actions, { sub: `${scopeName} · ${monthLabel(d.month)}` });
  }

  await load();
}

/** Boshlang'ich/Balans kartasi → hisoblar kesimidagi tekshiruv jadvali */
function breakdown(d) {
  const rows = d.accounts;
  const tr = (a) => h('tr', {},
    h('td', {}, h('div', {}, `${a.company_code} · ${a.label}`), h('div', { class: 'xs muted' }, a.account_number)),
    h('td', { class: 'right tnum' }, fmt2(a.opening)), h('td', { class: 'right tnum' }, fmt2(a.inflow_gross)), h('td', { class: 'right tnum' }, fmt2(a.outflow_gross)),
    h('td', { class: 'right tnum bold' }, fmt2(a.closing)), h('td', { class: 'right tnum' }, fmt2(a.closing_file)), h('td', {}, a.has_data ? badge(a.check_ok ? 'OK' : 'BAD', a.check_ok ? 'Mos' : 'Farq') : badge('NO_DATA')), h('td', {}, a.has_data ? sourceBadge(a) : null));
  const total = h('tr', { class: 'total' }, h('td', {}, `Jami (${d.internal_excluded ? 'ichki o‘tkazmasiz' : 'yalpi'})`), h('td', { class: 'right tnum' }, fmt2(d.opening)), h('td', { class: 'right tnum' }, fmt2(d.inflow)), h('td', { class: 'right tnum' }, fmt2(d.outflow)), h('td', { class: 'right tnum' }, fmt2(d.closing)), h('td', {}), h('td', {}), h('td', {}));
  const table = h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
    h('thead', {}, h('tr', {}, ...['Hisob', 'Boshlang‘ich', 'Tushum', 'Xarajat', 'Balans', 'Fayldagi qoldiq', 'Tekshiruv', 'Manba'].map((t, i) => h('th', { class: i && i < 6 ? 'right' : '' }, t)))),
    h('tbody', {}, ...rows.map(tr), total)));
  drawer({ title: `Hisoblar kesimi · ${monthLabel(d.month)}`, body: h('div', {}, card('Boshlang‘ich + tushum − xarajat = balans', table, null, { tight: true }),
    alert('mint', 'Bank hisoblari bo‘yicha qoldiq har doim bank ko‘chirmasidan olinadi. Kassa — qo‘lda kiritilgan oylik yig‘indi.')) });
}

/** Tushum/Xarajat kartasi → operatsiyalar ro'yxati (kartadagi raqam bilan bir xil doira) */
async function linesDrawer(d, st, direction) {
  const title = `${direction === 'IN' ? 'Tushum' : 'Xarajat'} · ${d.level === 'banks' ? 'Barcha bank hisoblari' : d.level === 'account' ? d.accounts[0]?.label : d.company?.code || 'Global'} · ${monthLabel(d.month)}`;
  const dr = drawer({ title, body: h('div', { class: 'empty-state' }, 'Yuklanmoqda…') });
  try {
    const net = d.internal_excluded ? 1 : 0;
    const r = await get('/api/bank-ledger/lines' + qs({ company: st.company, account: st.account, month: d.month, direction, net }));
    const t = dataTable({
      columns: [
        { key: 'tx_date', label: 'Sana', date: true, nowrap: true },
        { key: 'account_label', label: 'Hisob', render: (x) => h('div', {}, `${x.company_code} · ${x.account_label}`) },
        { key: 'doc_no', label: 'Hujjat №', nowrap: true },
        { key: 'corr_name', label: 'Korrespondent', render: (x) => h('div', {}, h('div', {}, x.corr_name || '--'), h('div', { class: 'xs muted' }, [x.corr_account, x.corr_inn ? 'INN ' + x.corr_inn : null, x.corr_mfo ? 'MFO ' + x.corr_mfo : null].filter(Boolean).join(' · '))), exportValue: (x) => x.corr_name },
        { key: 'purpose', label: 'To‘lov mazmuni', render: (x) => h('div', { class: 'small' }, x.purpose || '--') },
        { key: 'op_code', label: 'Op', nowrap: true },
        { key: 'is_internal', label: 'Turi', render: (x) => (x.is_internal ? badge('INTERNAL') : badge(x.direction === 'IN' ? 'INCOME' : 'EXPENSE')), exportValue: (x) => (x.is_internal ? 'Ichki o‘tkazma' : '') },
        { key: 'amount', label: 'Summa', money: true },
      ],
      rows: r.rows, exportName: `bank-${direction === 'IN' ? 'tushum' : 'xarajat'}-${d.month}`, emptyText: 'Bu doirada operatsiya yo‘q',
      footer: (rows) => h('tr', { class: 'total' }, h('td', { colspan: 7 }, `Jami: ${rows.length} ta`), h('td', { class: 'right tnum' }, fmt2(rows.reduce((s, x) => s + x.amount, 0)))),
    });
    const cashNote = r.has_cash ? alert('info', 'Kassa bo‘yicha operatsiyalar ro‘yxati yo‘q — kassa oylik yig‘indi sifatida qo‘lda kiritilgan va kartadagi jamiga qo‘shilgan.') : null;
    const netNote = net ? alert('mint', 'Ichki o‘tkazmalar (shu doiradagi o‘z hisoblarimiz orasida) ro‘yxatda ko‘rsatilmaydi — kartadagi raqam bilan bir xil.') : null;
    dr.setBody(h('div', {}, ...[netNote, cashNote].filter(Boolean).map((x) => h('div', { class: 'mb12' }, x)), card(null, t.el, null, { tight: true })));
  } catch (e) { dr.setBody(alert('crit', e.message)); }
}

function importDlg(done) {
  const fd = fileDrop({ accept: '.xls,.xlsx,application/vnd.ms-excel', hint: '.xls — ASBT (Ipoteka) yoki Open Bank (Smart) ko‘chirmasi' });
  const info = h('div', { class: 'mt16' });
  let payload = null;
  const go = h('button', { class: 'btn pri', disabled: true, onClick: async () => {
    go.disabled = true;
    try { const r = await post('/api/bank-ledger/import', payload); toast(`Import qilindi: ${r.new_ops} ta yangi, ${r.duplicates} ta takror`, 'ok'); m.close(); done(); }
    catch (e) { err(e); go.disabled = false; }
  } }, 'Import qilish');
  fd.input.addEventListener('change', async () => {
    const f = fd.input.files[0]; payload = null; go.disabled = true; info.replaceChildren();
    if (!f) return;
    try {
      payload = { file_base64: await readB64(f), file_name: f.name };
      const p = await post('/api/bank-ledger/import', { ...payload, preview: true });
      info.replaceChildren(
        p.ok ? alert('good', 'Fayl nazoratdan o‘tdi: boshlang‘ich + tushum − xarajat = yakuniy qoldiq.') : alert('crit', h('div', {}, h('b', {}, 'Import qilinmaydi:'), ...p.problems.map((x) => h('div', { class: 'small' }, x)))),
        h('div', { class: 'mt12' }, kv([
          ['Format', p.format === 'ASBT' ? 'ASBT (Справка о работе счета)' : 'Open Bank (FlexCube)'], ['Kompaniya', p.company ? `${p.company} · ${p.company_name || ''}` : p.company_name], ['Hisob', `${p.account} · ${p.label || '—'}`],
          ['Davr', `${date(p.period_from)} — ${date(p.period_to)}`], ['Boshlang‘ich qoldiq', money(p.opening)], ['Tushum', money(p.inflow)], ['Xarajat', money(p.outflow)], ['Yakuniy qoldiq', money(p.closing)],
          ['Operatsiyalar', `${p.ops} ta · yangi ${p.new_ops} · takror ${p.duplicates}`], p.internal.length ? ['Ichki o‘tkazmalar', `${p.internal.length} ta · ${fmt(p.internal.reduce((s, x) => s + x.amount, 0))} so‘m`] : null,
        ])));
      go.disabled = !p.ok;
    } catch (e) { info.replaceChildren(alert('crit', e.message)); }
  });
  const m = modal({ title: 'Bank ko‘chirmasini import qilish', body: h('div', {}, fd.el, info), footer: [h('button', { class: 'btn', onClick: () => m.close() }, 'Bekor qilish'), go] });
}

function cashDlg(d, done) {
  const cash = d.registry.flatMap((c) => c.accounts.filter((a) => a.kind === 'CASH').map((a) => [a.account_number, `${c.code} · ${a.label}`]));
  if (!cash.length) { toast('Reyestrda kassa yo‘q', 'err'); return; }
  formModal({ title: 'Kassa — oylik yig‘indi (qo‘lda)', size: 'sm', values: { account_number: cash[0][0], period: d.month },
    fields: [
      { name: 'account_number', label: 'Kassa', type: 'select', options: cash, required: true, full: true },
      { name: 'period', label: 'Oy', type: 'month', required: true, full: true },
      { name: 'opening', label: 'Boshlang‘ich qoldiq', type: 'number', required: true },
      { name: 'inflow', label: 'Tushum', type: 'number', required: true },
      { name: 'outflow', label: 'Xarajat', type: 'number', required: true },
      { name: 'closing', label: 'Balans (nazorat uchun)', type: 'number', hint: 'Kiritilsa: boshlang‘ich + tushum − xarajat bilan solishtiriladi' },
    ],
    submit: async (v) => { await put('/api/bank-ledger/cash-period', v); toast('Saqlandi', 'ok'); done(); } });
}

/** Hisoblar kesimi — Excel'dagi jadval ko'rinishi: kompaniya → hisoblar → jami; oxirida barcha banklar, kassa va umumiy jami (yalpi) */
function summaryTable(d) {
  const rows = d.accounts;
  const cents = (n) => Math.round((Number(n) || 0) * 100);
  const sumOf = (list, k) => (list.some((a) => a[k] === null || a[k] === undefined) ? null : list.reduce((s, a) => s + cents(a[k]), 0) / 100);
  const line = (a) => h('tr', { class: 'sub' },
    h('td', {}, a.label), h('td', { class: 'tnum small muted' }, a.kind === 'CASH' ? 'Naqd pul' : a.account_number),
    ...['opening', 'inflow_gross', 'outflow_gross', 'closing'].map((k) => h('td', { class: 'right tnum' }, a.has_data ? fmt(a[k]) : '--')),
    h('td', {}, a.has_data ? sourceBadge(a) : badge('NO_DATA')));
  const tot = (label, list, cls = 'total') => h('tr', { class: cls },
    h('td', { colspan: 2 }, label), ...['opening', 'inflow_gross', 'outflow_gross', 'closing'].map((k) => h('td', { class: 'right tnum' }, fmt(sumOf(list.filter((a) => a.has_data), k)))), h('td', {}));
  const body = [];
  const companies = [...new Set(rows.map((a) => a.company_code))];
  for (const c of companies) {
    const accs = rows.filter((a) => a.company_code === c);
    const banks = accs.filter((a) => a.kind === 'BANK'), cash = accs.filter((a) => a.kind === 'CASH');
    body.push(h('tr', { class: 'sec' }, h('td', { colspan: 7 }, c)), ...banks.map(line));
    if (banks.length > 1 || cash.length) body.push(tot(`${c} bank hisoblari jami`, banks));
    body.push(...cash.map(line));
    body.push(tot(`${c} jami`, accs));
  }
  if (companies.length > 1) {
    const banks = rows.filter((a) => a.kind === 'BANK');
    body.push(tot('Barcha bank hisoblari (kassasiz)', banks), tot('UMUMIY JAMI', rows));
  }
  const table = h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
    h('thead', {}, h('tr', {}, ...['Bank hisobi', 'Hisob raqami', 'Boshlang‘ich qoldiq', 'Tushum', 'Xarajat', 'Balans', 'Manba'].map((t, i) => h('th', { class: i >= 2 && i <= 5 ? 'right' : '' }, t)))),
    h('tbody', {}, ...body)));
  const note = d.internal_in || d.internal_out ? h('div', { class: 'small muted', style: { padding: '10px 16px' } }, `Jadvaldagi summalar yalpi (ichki o‘tkazmalar bilan, bank ko‘chirmasidagidek). Ichki o‘tkazmalar: ${fmt(d.internal_in)} so‘m.`) : null;
  return card('Hisoblar kesimi', h('div', {}, table, note), null, { tight: true, sub: monthLabel(d.month) });
}

/** Operatsiyalar — tanlangan doiradagi barcha kirim/chiqimlar (bank ko'chirmasi qatorlari) */
async function opsTable(box, d, st) {
  try {
    const r = await get('/api/bank-ledger/lines' + qs({ company: st.company, account: st.account, month: d.month }));
    const accs = [...new Map(r.rows.map((x) => [x.account_number, `${x.company_code} · ${x.account_label}`])).entries()];
    const t = dataTable({
      columns: [
        { key: 'tx_date', label: 'Sana', date: true, nowrap: true },
        { key: 'account_number', label: 'Hisob', render: (x) => `${x.company_code} · ${x.account_label}`, exportValue: (x) => `${x.company_code} · ${x.account_label}` },
        { key: 'doc_no', label: 'Hujjat №', nowrap: true },
        { key: 'corr_name', label: 'Korrespondent', render: (x) => h('div', {}, h('div', {}, x.corr_name || '--'), h('div', { class: 'xs muted' }, [x.corr_account, x.corr_inn ? 'INN ' + x.corr_inn : null].filter(Boolean).join(' · '))), exportValue: (x) => x.corr_name },
        { key: 'purpose', label: 'To‘lov mazmuni', render: (x) => h('div', { class: 'small' }, x.purpose || '--') },
        { key: 'direction', label: 'Turi', render: (x) => (x.is_internal ? badge('INTERNAL') : badge(x.direction === 'IN' ? 'INCOME' : 'EXPENSE')), exportValue: (x) => (x.is_internal ? 'Ichki o‘tkazma' : x.direction === 'IN' ? 'Kirim' : 'Chiqim') },
        { key: 'in_amount', label: 'Tushum', money: true },
        { key: 'out_amount', label: 'Xarajat', money: true },
      ],
      rows: r.rows.map((x) => ({ ...x, in_amount: x.direction === 'IN' ? x.amount : null, out_amount: x.direction === 'OUT' ? x.amount : null, internal: x.is_internal ? '1' : '0' })),
      filters: [
        { key: 'direction', label: 'Kirim va chiqim', options: [['IN', 'Faqat kirim'], ['OUT', 'Faqat chiqim']] },
        ...(accs.length > 1 ? [{ key: 'account_number', label: 'Barcha hisoblar', options: accs }] : []),
        { key: 'internal', label: 'Ichki o‘tkazmalar bilan', options: [['0', 'Ichki o‘tkazmasiz'], ['1', 'Faqat ichki o‘tkazmalar']] },
      ],
      exportName: `bank-operatsiyalar-${d.month}`, emptyText: 'Bu doirada operatsiya yo‘q',
      footer: (rows) => h('tr', { class: 'total' }, h('td', { colspan: 6 }, `Jami: ${rows.length} ta`),
        h('td', { class: 'right tnum' }, fmt(rows.reduce((s, x) => s + (x.in_amount || 0), 0))), h('td', { class: 'right tnum' }, fmt(rows.reduce((s, x) => s + (x.out_amount || 0), 0)))),
    });
    const cashNote = r.has_cash ? h('div', { class: 'small muted', style: { padding: '10px 16px' } }, 'Kassa operatsiyalari ro‘yxati yo‘q — kassa oylik yig‘indi sifatida qo‘lda kiritilgan.') : null;
    box.replaceChildren(card('Operatsiyalar', h('div', {}, t.el, cashNote), null, { tight: true, sub: `${r.rows.length} ta · ${monthLabel(d.month)}` }));
  } catch (e) { box.replaceChildren(alert('crit', 'Operatsiyalar yuklanmadi: ' + e.message)); }
}
