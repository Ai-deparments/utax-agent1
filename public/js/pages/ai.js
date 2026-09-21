import { get, post } from '../api.js';
import { h, card, fmt, money, short, badge, dt, mdLite, toast, err, confirmDlg, icon, alert, emptyState } from '../ui.js';

const SUGGEST = ['Bugun qancha pulimiz bor?', 'Kimlardan pul olishimiz kerak?', 'Qaysi qarzdorlik muddati o‘tgan?', 'Shu oy qancha daromad tan olindi?', 'Shu oy qancha xarajat bo‘ldi?', 'Sof foyda qancha?', 'Keyingi 7 kunda qancha pul tushishi kerak?', 'Shu haftada qancha xarajat kutilyapti?', 'Qaysi xizmat eng ko‘p foyda keltiryapti?', 'Avgust oyida nima uchun foyda kamaydi?', 'Plan necha foiz bajarildi?', 'Bog‘lanmagan tranzaksiyalar', 'Qaysi xarajatlar tasdiq kutmoqda?', 'Keyingi 30 kun prognozi', 'Bugungi holatni ber'];
const ACTION = { MATCH_TRANSACTION: 'Tranzaksiyani bog‘lash', SET_EXPENSE_CATEGORY: 'Kategoriya belgilash', RECOGNIZE_REVENUE: 'Daromadni tan olish', COMPUTE_PAYROLL: 'Oylikni hisoblash', CREATE_COLLECTION_TASK: 'Undiruv vazifasi', FLAG_ANOMALY: 'Anomaliya belgisi', REVIEW_CONTRACT: 'Shartnomani ko‘rib chiqish' };

export default async function render(root, { setTitle, can }) {
  setTitle('AI moliya markazi', 'Savol bering — javob real ma’lumotlar asosida');
  const msgs = h('div', { class: 'msgs' });
  const inp = h('input', { class: 'input', placeholder: 'Savol yozing… masalan: Bugun qancha pulimiz bor?' });
  const history = [];
  const add = (role, text, extra) => { const m = h('div', { class: 'msg ' + (role === 'user' ? 'u' : 'a') }, role === 'user' ? text : mdLite(text)); if (extra) m.append(extra); msgs.append(m); msgs.scrollTop = msgs.scrollHeight; return m; };
  const renderData = (d) => {
    if (!d) return null;
    if (d.kind === 'kpis') return h('div', { class: 'data kpimini' }, ...d.items.map(([l, v]) => h('div', {}, h('div', { class: 'l' }, l), h('div', { class: 'v' }, fmt(v)))));
    if (d.kind === 'table' && d.rows?.length) return h('div', { class: 'data tbl-wrap', style: { maxHeight: '320px', overflow: 'auto' } }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ...d.columns.map((c) => h('th', { class: c.money ? 'right' : '' }, c.label)))), h('tbody', {}, ...d.rows.slice(0, 30).map((r) => h('tr', {}, ...d.columns.map((c) => h('td', { class: c.money ? 'right' : '' }, c.money ? fmt(r[c.key]) : typeof r[c.key] === 'object' && r[c.key] !== null ? JSON.stringify(r[c.key]) : r[c.key] ?? '—')))))));
    if (d.kind === 'json') return h('details', { class: 'data' }, h('summary', { class: 'small muted' }, 'Manba ma’lumotlar: ' + d.tool), h('pre', { class: 'json' }, JSON.stringify(d.value, null, 1).slice(0, 4000)));
    return null;
  };
  async function ask(q) {
    if (!q.trim()) return; inp.value = ''; add('user', q);
    const wait = add('assistant', 'Tahlil qilinmoqda…');
    try {
      const r = await post('/api/ai/chat', { message: q, history: history.slice(-6) });
      wait.remove();
      const extra = h('div', {});
      const data = renderData(r.data); if (data) extra.append(data);
      if (r.confirm?.type === 'APPROVE') extra.append(h('div', { class: 'flex gap8 mt8' }, h('button', { class: 'btn good sm', onClick: async (e) => { e.target.disabled = true; try { const a = await post('/api/ai/confirm', { approval_id: r.confirm.approval_id }); add('assistant', `Tasdiqlandi: ${a.title} — holat: ${a.status === 'APPROVED' ? 'tasdiqlangan' : 'keyingi qadamga o‘tdi'}`); } catch (x) { err(x); } } }, icon('check', 14), 'Tasdiqlash'), h('button', { class: 'btn sm', onClick: (e) => { e.target.closest('.flex').remove(); add('assistant', 'Bekor qilindi.'); } }, 'Bekor qilish')));
      extra.append(h('div', { class: 'eng' }, `manba: ${r.engine === 'GEMINI' ? 'Gemini AI' : r.engine === 'LLM' ? 'Claude AI' : 'tizim qoidalari'}${r.model ? ' · ' + r.model : ''}`));
      add('assistant', r.answer, extra);
      history.push({ role: 'user', content: q }, { role: 'assistant', content: r.answer });
    } catch (e) { wait.remove(); err(e); }
  }
  const chat = h('div', { class: 'card chat' }, msgs, h('div', { class: 'inp' }, inp, h('button', { class: 'btn pri', onClick: () => ask(inp.value) }, icon('send', 15), 'Yuborish')));
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(inp.value); });
  add('assistant', 'Men UTAX moliya agentiman. Real ma’lumotlar asosida javob beraman — savollardan birini tanlang yoki o‘zingiz yozing.', h('div', { class: 'chips mt8' }, ...SUGGEST.map((s) => h('button', { class: 'chip', onClick: () => ask(s) }, s))));
  const side = h('div', {});
  async function loadSide() {
    const [agents, actions] = await Promise.all([get('/api/ai/agents'), get('/api/ai/actions?status=PROPOSED')]);
    side.replaceChildren(
      card('AI takliflari', actions.length ? h('div', { class: 'list' }, ...actions.map((a) => h('div', { class: 'li' }, h('div', { class: 'grow' }, h('div', { class: 't' }, a.title), h('div', { class: 's' }, `${ACTION[a.action_type] || a.action_type} · ishonchlilik ${a.confidence ?? '—'}% · ${dt(a.proposed_at)}`)), can('ai', 'APPROVE') ? h('span', { class: 'flex gap6' }, h('button', { class: 'btn xs good', title: 'Tasdiqlash', onClick: async () => { if (await confirmDlg(`Bajarilsinmi? ${a.title}`)) { try { await post(`/api/ai/actions/${a.id}/approve`); toast('Bajarildi, audit jurnaliga yozildi', 'ok'); loadSide(); } catch (e) { err(e); } } } }, icon('check', 13)), h('button', { class: 'btn xs ghost', title: 'Rad etish', onClick: async () => { await post(`/api/ai/actions/${a.id}/reject`); loadSide(); } }, icon('x', 13))) : null))) : emptyState('Kutayotgan taklif yo‘q', '', 'sparkles'), null, { sub: 'inson tasdiqlaydi' }),
      h('div', { class: 'mt16' }, card('AI agentlar', h('div', { class: 'list' }, ...agents.map((a) => h('div', { class: 'li' }, h('div', { class: 'grow' }, h('div', { class: 't' }, a.name, a.is_active ? '' : h('span', { class: 'badge', style: { marginLeft: '6px' } }, 'o‘chirilgan')), h('div', { class: 's' }, a.description), h('div', { class: 's' }, `${a.schedule} · oxirgi: ${a.last_run_at ? dt(a.last_run_at) : '—'}${a.proposed ? ` · ${a.proposed} taklif` : ''}`)), can('ai', 'CREATE') ? h('button', { class: 'btn xs', title: 'Hozir ishga tushirish', onClick: async (e) => { e.target.disabled = true; try { const r = await post(`/api/ai/agents/${a.code}/run`); toast(`${a.name}: ${JSON.stringify(r.result).slice(0, 120)}`, 'ok'); loadSide(); } catch (x) { err(x); } finally { e.target.disabled = false; } } }, icon('zap', 13)) : null))), null, { sub: agents.length + ' ta' })),
      h('div', { class: 'mt16' }, alert('mint', 'AI hech qachon mustaqil ravishda tranzaksiya o‘chirmaydi, pul yubormaydi, xarajat tasdiqlamaydi, shartnoma summasi yoki maoshni o‘zgartirmaydi. Tartib: aniqlaydi → taklif qiladi → inson tasdiqlaydi → tizim bajaradi → audit jurnali.', 'shield')));
  }
  root.append(h('div', { class: 'ai-grid' }, chat, side));
  await loadSide();
}
