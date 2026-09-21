/** /takliflar va /agentlar — web: AI moliya (takliflar: propose → inson tasdiqlaydi → bajariladi → audit). */
import { esc } from '../../shared/html.mjs';
import { money, pct, dt, lines, line, title, muted, bullet, clip, status, statusLabel, STATUS_LABEL } from '../../shared/format.mjs';
import { chunk } from '../../shared/keyboards.mjs';
import { T } from '../../shared/texts.mjs';
import { parseJson } from '../../../core/util.mjs';
import { P, cbIf, cmdIf } from './common.mjs';

const CARD_LIMIT = 6;
const ACTION_LABEL = {
  MATCH_TRANSACTION: 'Tranzaksiyani shartnomaga bog‘lash', SET_EXPENSE_CATEGORY: 'Xarajat kategoriyasini belgilash', RECOGNIZE_REVENUE: 'Daromadni tan olish',
  COMPUTE_PAYROLL: 'Oylikni hisoblash', CREATE_COLLECTION_TASK: 'Undiruv vazifasi', FLAG_ANOMALY: 'Anomaliyani belgilash', REVIEW_CONTRACT: 'Shartnomani ko‘rib chiqish',
};

const agentNames = (ctx) => Object.fromEntries(ctx.S.ai.listAgents().map((a) => [a.code, a.name]));

// ---------- natija xulosasi (agent / taklif) ----------
const KEY_LABEL = {
  digest: 'Xulosa', analysis: 'Tahlil', synced: 'Sinxronlangan integratsiyalar', checked: 'Tekshirildi', matched: 'Bog‘landi', suggested: 'Taklif qilindi', unmatched: 'Bog‘lanmagan',
  straight_line: 'Obuna tan olish yozuvlari', missing_act: 'Akt yetishmaydi', expired_in_progress: 'Muddati tugagan, jarayonda', categorized: 'Kategoriyalandi', proposed: 'Taklif qilindi',
  reminded: 'Eslatma yuborildi', available: 'Ishlatish mumkin', low_liquidity: 'Likvidlik past', created: 'Yangi vazifalar', as_of: 'Sana', period_checked: 'Tekshirilgan davr',
  computed: 'Hisoblangan', risk_30: 'Risk (30 kun)', risk_90: 'Risk (90 kun)', base_30: 'Asosiy senariy (30 kun)', total: 'Jami', findings: 'Topilmalar', issues: 'Muammolar',
  tasks: 'Vazifalar', aging: 'Aging', summary: 'Xulosa', checked_at: 'Tekshirildi', rows: 'Qatorlar', flagged: 'Belgilandi', reviewed: 'Ko‘rib chiqildi', error: 'Xato',
};
const MONEY_KEYS = /available|base_30|amount|receivable|overdue|critical/;
function fmtVal(key, v) {
  if (typeof v === 'boolean') return v ? 'ha' : 'yo‘q';
  if (typeof v === 'number') return MONEY_KEYS.test(key) ? money(v) : String(v);
  if (typeof v === 'string' && STATUS_LABEL[v]) return statusLabel(v);
  return String(v ?? '—');
}
export function summarize(result) {
  if (result === null || result === undefined) return muted('Natija yo‘q');
  if (typeof result !== 'object') return esc(String(result));
  if (result.skipped) return '⚪ Agent o‘chirilgan — ishlamadi.';
  const out = [];
  for (const [k, v] of Object.entries(result)) {
    const label = KEY_LABEL[k] || k;
    if (typeof v === 'string' && v.length > 60) out.push(`<b>${esc(label)}:</b>\n${esc(v.length > 1500 ? v.slice(0, 1499) + '…' : v)}`);
    else if (Array.isArray(v)) out.push(bullet(line(label, `${v.length} ta`)));
    else if (v && typeof v === 'object') {
      const inner = Object.entries(v).filter(([, x]) => x === null || typeof x !== 'object').map(([a, x]) => `${KEY_LABEL[a] || a}: ${fmtVal(a, x)}`).join(', ');
      out.push(bullet(line(label, inner || `${Object.keys(v).length} ta`)));
    } else out.push(bullet(line(label, fmtVal(k, v))));
  }
  return out.length ? lines(out) : muted('Natija bo‘sh');
}

// ---------- AI takliflari ----------
/** Bajarilgan taklif natijasi — amal turiga qarab ixcham (ai.mjs EXECUTORS qaytargan obyekt) */
function actionResult(a) {
  const r = parseJson(a.result, a.result);
  if (r === null || r === undefined || r === '') return null;
  if (a.status === 'FAILED') return `⚠️ ${esc(clip(typeof r === 'string' ? r : JSON.stringify(r), 300))}`;
  if (typeof r !== 'object') return esc(String(r));
  switch (a.action_type) {
    case 'MATCH_TRANSACTION': return lines(line('Tranzaksiya', `#${r.id} · ${statusLabel(r.matching_status)}`), r.matched_contract_id ? line('Shartnoma ID', r.matched_contract_id) : null);
    case 'SET_EXPENSE_CATEGORY': return lines(line('Xarajat', r.code || `#${r.id}`), r.category_name ? line('Kategoriya', r.category_name) : null);
    case 'RECOGNIZE_REVENUE': return lines(line('Holat', statusLabel(r.status)), r.amount !== undefined ? line('Summa', money(r.amount)) : null);
    case 'COMPUTE_PAYROLL': return line('Hisoblangan qatorlar', `${r.rows ?? 0} ta`);
    case 'CREATE_COLLECTION_TASK': return line('Yangi undiruv vazifalari', `${r.created ?? 0} ta`);
    case 'FLAG_ANOMALY': return line('Belgilangan tranzaksiya', `#${r.flagged}`);
    case 'REVIEW_CONTRACT': return line('Ko‘rib chiqilgan shartnoma', `#${r.reviewed}`);
    default: {
      const scalar = Object.entries(r).filter(([, v]) => v === null || typeof v !== 'object').slice(0, 6);
      return summarize(Object.fromEntries(scalar));
    }
  }
}

function actionCard(ctx, a, names) {
  const conf = a.confidence !== null && a.confidence !== undefined ? ` · ishonch <b>${esc(pct(a.confidence, 0))}</b>` : '';
  const decided = a.status !== 'PROPOSED'
    ? `${status(a.status)}${a.decided_by_name ? ` — ${esc(a.decided_by_name)}` : ''}${a.decided_at ? `, ${esc(dt(a.decided_at))}` : ''}`
    : null;
  const result = a.status === 'EXECUTED' || a.status === 'FAILED' ? actionResult(a) : null;
  const html = lines(
    `🤖 <b>#${a.id} · ${esc(ACTION_LABEL[a.action_type] || a.action_type)}</b>`,
    esc(clip(a.title, 200)),
    `${line('Agent', names[a.agent_code] || a.agent_code)}${conf}`,
    muted(`Taklif: ${dt(a.proposed_at)}`),
    decided,
    result ? `<b>Natija:</b>\n${result}` : null,
  );
  const buttons = [];
  if (a.status === 'PROPOSED') buttons.push([cbIf(ctx, P.aiApprove, '✅ Bajarish', `r.act:ok:${a.id}`), cbIf(ctx, P.aiReject, '❌ Rad etish', `r.act:no:${a.id}`)]);
  buttons.push([{ text: '🌐 AI moliya', web: 'ai' }]);
  return { html, buttons };
}

async function takliflar(ctx) {
  const rows = ctx.S.ai.listActions('PROPOSED');
  const names = agentNames(ctx);
  const canDecide = ctx.can(...P.aiApprove) || ctx.can(...P.aiReject);
  const head = lines(
    title('🤖', 'AI takliflari'),
    line('Tasdiq kutmoqda', `${rows.length} ta`),
    muted('AI hech narsani o‘zi bajarmaydi: siz tasdiqlaganingizdan so‘ng tizim bajaradi va audit jurnaliga yozadi.'),
    canDecide ? null : muted('Sizning rolingizda takliflarni tasdiqlash yopiq — faqat ko‘rish (web bilan bir xil).'),
  );
  if (!rows.length) return ctx.reply(`${head}\n\n✅ Yangi taklif yo‘q.`, { buttons: [[{ text: '🌐 AI moliya', web: 'ai' }]] });
  await ctx.reply(head);
  for (const a of rows.slice(0, CARD_LIMIT)) {
    const c = actionCard(ctx, a, names);
    await ctx.reply(c.html, { buttons: c.buttons });
  }
  if (rows.length > CARD_LIMIT) return ctx.reply(`Yana <b>${rows.length - CARD_LIMIT}</b> ta taklif — web panelda.`, { buttons: [[{ text: '🌐 Barcha takliflar', web: 'ai' }]] });
  return null;
}

/** r.act:<ok|no>:<id> — inson qarori (ai APPROVE / ai REJECT, web /api/ai/actions/:id/approve|reject bilan bir xil) */
async function actionDecide(ctx) {
  const [op, idStr] = ctx.cbArgs;
  const id = Number(idStr);
  if (!['ok', 'no'].includes(op) || !Number.isInteger(id)) return ctx.answer(T.expired, true);
  ctx.need(...(op === 'ok' ? P.aiApprove : P.aiReject));
  const names = agentNames(ctx);
  const fresh = () => ctx.S.ai.listActions().find((x) => x.id === id) || ctx.S.ai.getAction(id);
  const cur = ctx.S.ai.getAction(id);
  if (!cur) return ctx.answer('Taklif topilmadi', true);
  if (cur.status !== 'PROPOSED') {
    const c = actionCard(ctx, fresh(), names);
    await ctx.edit(c.html, { buttons: c.buttons });
    return ctx.answer(`Allaqachon hal qilingan: ${statusLabel(cur.status)}`, true);
  }
  try {
    ctx.S.ai.decideAction(id, op === 'ok' ? 'APPROVE' : 'REJECT', ctx.actor);
  } catch (e) {
    const after = fresh();
    if (after) { const c = actionCard(ctx, after, names); await ctx.edit(c.html, { buttons: c.buttons }); }
    throw e;
  }
  const c = actionCard(ctx, fresh(), names);
  await ctx.edit(c.html, { buttons: c.buttons });
  return ctx.answer(op === 'ok' ? '✅ Bajarildi' : '❌ Rad etildi');
}

// ---------- AI agentlar ----------
const scheduleLabel = (s) => String(s || '—')
  .replace(/^daily\s+(\d{2}:\d{2})$/, 'har kuni $1').replace(/^daily$/, 'har kuni').replace(/^monthly$/, 'har oy')
  .replace(/every\s+(\d+)m/, 'har $1 daqiqa').replace(/on import/, 'importda').replace(/hourly/, 'har soat');

async function agentlar(ctx) {
  const list = ctx.S.ai.listAgents();
  const html = lines(
    `${title('🛰', 'AI agentlar')} (${list.length})`,
    muted('Har agent jadval bo‘yicha avtomatik ishlaydi; ▶ tugmasi bilan hozir ishga tushirish mumkin.'),
    '',
    ...list.map((a, n) => lines(
      `${n + 1}. ${a.is_active ? '🟢' : '⚪'} <b>${esc(a.name)}</b>${a.proposed ? ` · 🤖 ${a.proposed} taklif` : ''}`,
      `    <i>${esc(a.description || '')} · ${esc(scheduleLabel(a.schedule))} · oxirgi: ${esc(a.last_run_at ? dt(a.last_run_at) : '—')}</i>`,
    )),
  );
  const buttons = ctx.can(...P.aiRun) ? chunk(list.filter((a) => a.is_active).map((a) => ({ text: `▶ ${clip(a.name.replace(/\s+agenti$/i, ''), 24)}`, cb: `r.run:${a.code}` })), 2) : [];
  buttons.push([cmdIf(ctx, P.ai, '🤖 Takliflar', 'takliflar'), { text: '🌐 AI moliya', web: 'ai' }]);
  return ctx.reply(html, { buttons });
}

/** r.run:<CODE> — web /api/ai/agents/:code/run bilan bir xil (ai CREATE, agent konteksti bilan) */
async function agentRun(ctx) {
  const code = String(ctx.cbArgs[0] || '');
  const ag = ctx.S.ai.listAgents().find((a) => a.code === code);
  if (!ag) return ctx.answer('Agent topilmadi', true);
  if (!ag.is_active) return ctx.answer('Agent o‘chirilgan (web → AI moliya)', true);
  await ctx.answer(`⏳ ${ag.name} ishga tushirildi…`);
  ctx.app.audit(ctx.actor, { action: 'AGENT_RUN_REQUESTED', entity: 'ai_agent', entityId: ag.id, newValue: { code, bot: 'rahbar' } });
  await ctx.typing();
  const result = await ctx.S.ai.runAgent(code, ctx.S.ai.agentCtx(code));
  return ctx.reply(lines(`✅ <b>${esc(ag.name)}</b> ishladi`, muted(dt(new Date().toISOString())), '', summarize(result)), {
    buttons: [[cmdIf(ctx, P.ai, '🤖 Takliflar', 'takliflar'), { text: '🌐 AI moliya', web: 'ai' }]],
  });
}

export const commands = [
  { name: 'takliflar', desc: 'AI takliflari: tasdiqlash / rad etish', button: '🤖 AI takliflari', perm: P.ai, run: takliflar },
  { name: 'agentlar', desc: 'AI agentlar holati va ishga tushirish', button: '🛰 Agentlar', perm: P.ai, run: agentlar },
];

export const callbacks = {
  'r.act': { perm: P.ai, ttlHours: 24 * 7, run: actionDecide },
  'r.run': { perm: P.aiRun, run: agentRun },
};
