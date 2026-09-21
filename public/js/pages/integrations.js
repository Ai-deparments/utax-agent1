import { get, post, patch } from '../api.js';
import { fileDrop, kpiCard, fmt, date, h, card, badge, dt, dataTable, formModal, modal, toast, err, icon, alert, emptyState } from '../ui.js';

export default async function render(root, { setTitle, can }) {
  setTitle('Integratsiyalar', 'Bank · ERP · 1C · Google Sheets · Excel · Telegram · Email — adapterlar');
  const adapters = await get('/api/integrations/adapters');
  const body = h('div', {});
  const AD_ICON = { BANK_API: 'bank', GOOGLE_SHEETS: 'file', EXCEL: 'upload', ONE_C: 'layers', ERP: 'briefcase', TELEGRAM: 'send', EMAIL: 'inbox', GEMINI: 'sparkles', LEDGER: 'layers', WEBHOOK_IN: 'link' };
  async function load() {
    const list = await get('/api/integrations');
    body.replaceChildren(
      h('div', { class: 'grid g4 mb16' }, ...adapters.map((a) => h('div', { class: 'card', style: { padding: '14px' } }, h('div', { class: 'flex gap8' }, h('div', { class: 'tile green', style: { width: '34px', height: '34px' } }, icon(AD_ICON[a.type] || 'plug', 17)), h('b', {}, a.name)), h('div', { class: 'small muted mt8', style: { minHeight: '34px' } }, a.description), a.type === 'EXCEL' ? (canUpload ? h('button', { class: 'btn xs pri mt8', onClick: () => uploadDlg() }, icon('upload', 13), 'Excel fayl yuklash') : null) : a.type === 'LEDGER' ? (canUpload ? h('button', { class: 'btn xs pri mt8', onClick: () => ledgerDlg() }, icon('upload', 13), 'Jurnal yuklash') : null) : can('integrations', 'CREATE') ? h('button', { class: 'btn xs soft mt8', onClick: () => addForm(a) }, icon('plus', 13), 'Ulash') : null))),
      card('Ulangan integratsiyalar', list.length ? dataTable({ columns: [{ key: 'name', label: 'Nomi', render: (r) => h('div', {}, h('b', {}, r.name), h('div', { class: 'xs muted' }, r.adapter?.name || r.type)) }, { key: 'type', label: 'Adapter', render: (r) => r.adapter?.name || r.type }, { key: 'is_active', label: 'Faol', render: (r) => badge(r.is_active ? 'OK' : 'CANCELLED', r.is_active ? 'Ha' : 'Yo‘q') }, { key: 'last_sync_at', label: 'Oxirgi sinxronlash', datetime: true }, { key: 'last_status', label: 'Holat', render: (r) => (r.last_status === 'Manual' ? 'Qo‘lda yuklanadi' : r.last_status || '—') },
        { key: 'id', label: '', render: (r) => h('span', { class: 'flex gap6' }, r.type === 'EXCEL' && canUpload ? h('button', { class: 'btn xs pri', onClick: (e) => { e.stopPropagation(); uploadDlg(r.id); } }, icon('upload', 13), 'Fayl yuklash') : null, can('integrations', 'EDIT') && r.type !== 'EXCEL' ? h('button', { class: 'btn xs', onClick: async (e) => { e.stopPropagation(); try { const t = await post(`/api/integrations/${r.id}/test`); toast((t.ok ? 'Ulanish yaxshi: ' : 'Xato: ') + t.message, t.ok ? 'ok' : 'err'); load(); } catch (x) { err(x); } } }, 'Tekshirish') : null, can('integrations', 'EDIT') && ['BANK_API', 'GOOGLE_SHEETS', 'ONE_C', 'ERP'].includes(r.type) ? h('button', { class: 'btn xs pri', onClick: async (e) => { e.stopPropagation(); try { const s = await post(`/api/integrations/${r.id}/sync`); toast(`Sinxronlash: ${s.created} yangi, ${s.duplicates} takroriy`, 'ok'); load(); } catch (x) { err(x); } } }, 'Sinxronlash') : null, h('button', { class: 'btn xs ghost', onClick: async (e) => { e.stopPropagation(); const logs = await get(`/api/integrations/${r.id}/logs`); modal({ title: 'Sinxronlash jurnali — ' + r.name, body: logs.length ? h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Boshlandi'), h('th', {}, 'Holat'), h('th', {}, 'Qatorlar'), h('th', {}, 'Xabar'))), h('tbody', {}, ...logs.map((l) => h('tr', {}, h('td', {}, dt(l.started_at)), h('td', {}, badge(l.status)), h('td', {}, `${l.rows_in} / ${l.rows_new} yangi`), h('td', { class: 'small' }, l.message || ''))))) : emptyState('Jurnal bo‘sh') }); } }, 'Jurnal')) }], rows: list, search: false, onRow: can('integrations', 'EDIT') ? (r) => editForm(r) : null }).el : emptyState('Integratsiya ulanmagan', 'Yuqoridagi adapterlardan birini ulang', 'plug'), null, { tight: true }),
      h('div', { class: 'mt16' }, alert('info', 'Maxfiy ma’lumotlar (API kalitlari, parollar) shifrlangan holda saqlanadi. Kiruvchi webhook manzili: POST /api/integrations/webhook/{token}. Yangi adapter — dasturchi tomonidan qo‘shiladi.')));
  }
  const canUpload = can('integrations', 'EDIT') && can('transactions', 'CREATE');
  /** Excel (.xlsx) / CSV bank ko'chirmasini yuklash: tanlash → oldindan ko'rish → import → bog'lash natijasi */
  function ledgerDlg() {
    const fd = fileDrop({ accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', hint: '.xlsx — yoki shu yerga sudrab tashlang' });
    const info = h('div', { class: 'mt16' });
    let payload = null;
    const readB64 = (f) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = () => rej(fr.error); fr.readAsDataURL(f); });
    const issues = (skipped, warnings) => [
      warnings.length ? alert('warn', h('div', {}, h('b', {}, 'Tekshiring: '), ...warnings.map((w) => h('div', { class: 'small' }, `${w.row}-qator: ${w.text}`)))) : null,
      skipped.length ? h('details', { class: 'mt8' }, h('summary', { class: 'small' }, `Import qilinmaydigan qatorlar: ${skipped.length} ta`), h('div', { class: 'tbl-wrap mt8' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Qator'), h('th', {}, 'Hisob'), h('th', {}, 'Kontragent'), h('th', { class: 'right' }, 'Summa'), h('th', {}, 'Sabab'))), h('tbody', {}, ...skipped.map((x) => h('tr', {}, h('td', {}, x.row), h('td', {}, x.acc), h('td', {}, x.cp), h('td', { class: 'right tnum' }, fmt(x.amount)), h('td', { class: 'xs' }, x.reason))))))) : null].filter(Boolean);
    fd.input.addEventListener('change', async () => {
      const f = fd.input.files[0]; payload = null; info.replaceChildren();
      if (!f) return;
      if (!/\.xlsx$/i.test(f.name)) { info.replaceChildren(alert('warn', 'Faqat .xlsx fayl yuklang.')); return; }
      try {
        payload = { xlsx_base64: await readB64(f), file_name: f.name };
        const p = await post('/api/integrations/ledger-upload', { ...payload, preview: true });
        info.replaceChildren(h('div', { class: 'kpis c4 mb12' },
          kpiCard({ size: 'sm', icon: 'contract', tone: 'blue', label: 'Sotuvlar (shartnoma)', value: p.sales_amount, sub: `${p.sales} ta` }),
          kpiCard({ size: 'sm', icon: 'inflow', tone: 'green', label: 'Tushumlar', value: p.receipts_amount, sub: `${p.receipts} ta` }),
          kpiCard({ size: 'sm', icon: 'receipt', tone: 'red', label: 'Chiqimlar', value: p.payments_amount, sub: `${p.payments} ta` }),
          kpiCard({ size: 'sm', icon: 'activity', tone: 'teal', label: 'Bank → kassa', value: p.transfers_amount, sub: `${p.transfers} ta` })), ...issues(p.skipped, p.warnings));
      } catch (e) { payload = null; info.replaceChildren(alert('crit', e.message)); }
    });
    const go = h('button', { class: 'btn pri', onClick: async () => {
      if (!payload) return toast('Avval faylni tanlang', 'err');
      go.disabled = true;
      try {
        const r = await post('/api/integrations/ledger-upload', payload);
        payload = null; fd.reset();
        info.replaceChildren(alert('good', h('div', {}, h('b', {}, 'Import qilindi. '), `Shartnoma: ${r.created.contracts} · bank yozuvi: ${r.created.bank} · kassa yozuvi: ${r.created.cash} · xarajat: ${r.created.expenses} · takroriy (o‘tkazib yuborildi): ${r.duplicates}${r.uncategorized ? ` · kategoriyasiz xarajat: ${r.uncategorized} (Xarajatlar sahifasida belgilang)` : ''}`)), ...issues(r.skipped, r.warnings));
        toast('Jurnal import qilindi', 'ok');
        load();
      } catch (e) { err(e); } finally { go.disabled = false; }
    } }, icon('upload', 15), 'Import qilish');
    const m = modal({ title: 'Moliya jurnalini yuklash (Excel)', size: 'lg', body: h('div', {}, h('div', { class: 'field' }, h('label', {}, 'Fayl'), fd.el),
      h('div', { class: 'xs muted mt8' }, 'Ustunlar: Dogovor No · Sana · To‘lov kuni · Valyuta · Summa · Shyot nomi · Kontragent · Napravleniye. Faqat fayldagi ma’lumot olinadi; faylda yo‘q maydonlar bo‘sh qoladi. Qayta yuklansa, takroriy operatsiyalar qo‘shilmaydi.'), info),
      footer: [h('button', { class: 'btn', onClick: () => m.close() }, 'Yopish'), go] });
  }
  async function uploadDlg(integrationId) {
    let accounts = [];
    try { accounts = (await get('/api/banking/accounts')).bank.accounts; } catch (e) { return err(e); }
    if (!accounts.length) return toast('Avval bank hisobini qo‘shing (Pul boshqaruvi → Bank hisobi)', 'err');
    const acc = h('select', { class: 'select' }, ...accounts.map((a) => h('option', { value: a.id }, `${a.bank_name}${a.account_number ? ' · ' + a.account_number : ''}`)));
    const fd = fileDrop({ accept: '.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', hint: '.xlsx yoki .csv — yoki shu yerga sudrab tashlang' });
    const file = fd.input;
    const info = h('div', { class: 'mt16' });
    let payload = null;
    const readB64 = (f) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = () => rej(fr.error); fr.readAsDataURL(f); });
    file.addEventListener('change', async () => {
      const f = file.files[0]; payload = null; info.replaceChildren();
      if (!f) return;
      if (/\.xls$/i.test(f.name)) { info.replaceChildren(alert('warn', 'Eski .xls format qo‘llab-quvvatlanmaydi. Faylni Excel’da ochib «Saqlash → .xlsx» qiling va qayta yuklang.')); return; }
      if (!/\.(xlsx|csv)$/i.test(f.name)) { info.replaceChildren(alert('warn', 'Faqat .xlsx yoki .csv fayl yuklang.')); return; }
      try {
        payload = /\.xlsx$/i.test(f.name) ? { xlsx_base64: await readB64(f) } : { csv: await f.text() };
        payload.file_name = f.name;
        const p = await post('/api/integrations/excel-upload', { ...payload, preview: true });
        if (!p.total) { payload = null; info.replaceChildren(alert('warn', `Faylda tranzaksiya topilmadi (${p.raw_rows} qator o‘qildi). Ustunlar: Sana va Summa (yoki Debet / Kredit) bo‘lishi kerak.`)); return; }
        const inc = p.rows.filter((r) => r.direction === 'INCOME'), exp = p.rows.filter((r) => r.direction === 'EXPENSE');
        info.replaceChildren(
          h('div', { class: 'small mb8' }, h('b', {}, `${p.total} ta tranzaksiya topildi`), h('span', { class: 'muted' }, ` · kirim ${inc.length} ta (${fmt(inc.reduce((a, r) => a + r.amount, 0))}) · chiqim ${exp.length} ta (${fmt(exp.reduce((a, r) => a + r.amount, 0))})${p.total > p.rows.length ? ' · birinchi ' + p.rows.length + ' tasi ko‘rsatilgan' : ''}`)),
          h('div', { class: 'tbl-wrap', style: { maxHeight: '280px', overflow: 'auto', border: '1px solid var(--border)', borderRadius: '8px' } }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Sana'), h('th', {}, 'Yo‘nalish'), h('th', { class: 'right' }, 'Summa'), h('th', {}, 'Kontragent'), h('th', {}, 'INN'), h('th', {}, 'Maqsad'))), h('tbody', {}, ...p.rows.slice(0, 100).map((r) => h('tr', {}, h('td', { class: 'nowrap' }, date(r.tx_date)), h('td', {}, badge(r.direction)), h('td', { class: 'right' }, fmt(r.amount)), h('td', {}, r.counterparty_name || '—'), h('td', {}, r.counterparty_inn || '—'), h('td', { class: 'small' }, r.purpose || '—')))))));
      } catch (e) { payload = null; info.replaceChildren(alert('crit', e.message)); }
    });
    const go = h('button', { class: 'btn pri', onClick: async () => {
      if (!payload) return toast('Avval faylni tanlang', 'err');
      go.disabled = true;
      try {
        const r = await post('/api/integrations/excel-upload', { ...payload, bank_account_id: Number(acc.value), integration_id: integrationId || null });
        payload = null; fd.reset();
        info.replaceChildren(alert('good', h('div', {}, h('b', {}, 'Yuklandi. '), `Yangi: ${r.created} · takroriy (o‘tkazib yuborildi): ${r.duplicates} · avtomatik bog‘landi: ${r.auto_matched} · taklif (tasdiq kerak): ${r.suggested} · bog‘lanmagan: ${r.unmatched}`, h('div', { class: 'mt8' }, h('a', { href: '#/transactions', onClick: () => m.close() }, 'Tushumlar sahifasida ko‘rish →')))));
        toast(`Excel yuklandi: ${r.created} ta yangi tranzaksiya`, 'ok');
        load();
      } catch (e) { err(e); } finally { go.disabled = false; }
    } }, icon('upload', 15), 'Yuklash');
    const m = modal({ title: 'Excel / CSV bank ko‘chirmasini yuklash', size: 'lg', body: h('div', {},
      h('div', { class: 'form-grid' }, h('div', { class: 'field' }, h('label', {}, 'Bank hisobi'), acc), h('div', { class: 'field' }, h('label', {}, 'Fayl'), fd.el)),
      h('div', { class: 'xs muted mt8' }, 'Ustunlar avtomatik aniqlanadi: Sana · Summa yoki Debet/Kredit · Kontragent · INN · To‘lov maqsadi · Hujjat raqami. Sarlavhadan oldingi qatorlar (bank nomi, hisob raqami) o‘tkazib yuboriladi. Takroriy yozuvlar qayta qo‘shilmaydi. Yuklangach tranzaksiyalar shartnomalar bilan avtomatik bog‘lanadi.'),
      info), footer: [h('button', { class: 'btn', onClick: () => m.close() }, 'Yopish'), go] });
  }
  const FIELD = {
    base_url: ['API manzili', 'masalan: https://api.bank.uz/v1'], account_id: ['Bankdagi hisob identifikatori', 'bank API’dagi hisob ID si'], bank_account_id: ['Tushumlar yoziladigan bank hisobi', 'import qilingan tranzaksiyalar shu hisobga yoziladi'],
    sheet_id: ['Google Sheets jadval ID', 'havoladagi /d/ va /edit orasidagi qism'], gid: ['Varaq raqami (gid)', 'birinchi varaq uchun 0'], mapping: ['Ustunlar moslashuvi (JSON)', 'ixtiyoriy — bo‘sh qoldirilsa avtomatik aniqlanadi'],
    endpoint: ['Endpoint yo‘li', 'masalan: /transactions'], api_key: ['API kalit', 'bank tomonidan beriladi'], username: ['Foydalanuvchi nomi'], password: ['Parol'], token: ['Kirish tokeni'],
    bot_token: ['Bot tokeni', 'Telegram’da @BotFather → /newbot orqali olinadi, masalan: 123456789:AAH…'], alert_chat_id: ['Ogohlantirishlar chati ID si', 'ixtiyoriy — kritik xabarlar yuboriladigan guruh yoki kanal ID si (masalan: -1001234567890)'],
    webhook_url: ['Webhook manzili', 'POST {to, subject, body} qabul qiladigan pochta servisi manzili'], recipients: ['Qabul qiluvchilar', 'elektron pochtalar, vergul bilan'],
    model: ['Model', 'masalan: gemini-flash-latest (har doim eng yangi Flash) yoki gemini-2.5-pro'],
  };
  const FIELD_BY_TYPE = { GEMINI: { api_key: ['API kalit', 'Google AI Studio → Get API key orqali olinadi'] } };
  let bankAccounts = null;
  try { bankAccounts = (await get('/api/banking/accounts')).bank.accounts; } catch {}
  function schemaFields(a, values = {}, secrets = {}) {
    const cfg = Object.entries(a.config_schema || {}).map(([k, v]) => {
      const [label, hint] = FIELD[k] || [k, ''];
      if (k === 'bank_account_id' && bankAccounts?.length) return { name: 'cfg_' + k, label, hint, type: 'select', options: bankAccounts.map((b) => [b.id, `${b.bank_name}${b.account_number ? ' · ' + b.account_number : ''}`]), value: values[k] ?? v };
      return { name: 'cfg_' + k, label, hint: hint || (typeof v === 'object' ? 'JSON' : ''), value: values[k] ?? (typeof v === 'object' ? JSON.stringify(v) : v), full: typeof v === 'object' || k === 'base_url' || k === 'webhook_url' };
    });
    const sec = Object.entries(a.secret_schema || {}).map(([k]) => { const [label, hint] = FIELD_BY_TYPE[a.type]?.[k] || FIELD[k] || [k, '']; const req = k === 'bot_token' || (a.type === 'GEMINI' && k === 'api_key' && !secrets[k]); return { name: 'sec_' + k, label, type: 'password', value: secrets[k] || '', hint: (hint ? hint + ' · ' : '') + 'shifrlangan holda saqlanadi', full: k === 'bot_token' || a.type === 'GEMINI', required: req }; });
    return [{ name: 'name', label: 'Nomi', required: true, value: values.name ?? a.name, full: true, hint: 'ro‘yxatda ko‘rinadigan nom' }, ...sec, ...cfg];
  }
  const parse = (v, a) => { const config = {}, secret_config = {}; for (const k of Object.keys(a.config_schema || {})) { const raw = v['cfg_' + k]; try { config[k] = typeof a.config_schema[k] === 'object' ? JSON.parse(raw || '{}') : /^\d+$/.test(raw) ? Number(raw) : raw; } catch { config[k] = raw; } } for (const k of Object.keys(a.secret_schema || {})) if (v['sec_' + k]) secret_config[k] = v['sec_' + k]; return { config, secret_config }; };
  function addForm(a) { formModal({ title: 'Ulash: ' + a.name, fields: schemaFields(a), submit: async (v) => { const r = await post('/api/integrations', { type: a.type, name: v.name, ...parse(v, a) }); toast('Ulandi' + (r.webhook_url ? ' · webhook: ' + r.webhook_url : ''), 'ok'); load(); } }); }
  function editForm(r) { const a = adapters.find((x) => x.type === r.type); if (!a) return; formModal({ title: 'Tahrirlash: ' + r.name, fields: [...schemaFields(a, { name: r.name, ...r.config }, r.secret_config), { name: 'is_active', label: 'Faol', type: 'checkbox', value: !!r.is_active }], submit: async (v) => { await patch('/api/integrations/' + r.id, { name: v.name, is_active: v.is_active, ...parse(v, a) }); toast('Saqlandi', 'ok'); load(); } }); }
  root.append(body);
  await load();
}
