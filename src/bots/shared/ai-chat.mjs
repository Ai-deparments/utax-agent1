/**
 * Erkin matn → AI moliya yordamchisi (app.services.ai.chat) — web "AI moliya" bilan bir xil dvigatel va RBAC.
 * Har bot o'z ekspert personasi bilan (rahbar / buxgalter / sorov / signal), suhbat xotirasi kanal bo'yicha (TELEGRAM:<bot>).
 * LLM (Gemini → Groq) ishlamasa — jim ravishda qoidalar; texnik xato foydalanuvchiga chiqmaydi.
 */
import { mdToHtml } from './html.mjs';
import { btn } from './keyboards.mjs';
import { T } from './texts.mjs';
import { personaFor } from '../../modules/ai-context.mjs';

/** Sozlamalar (testlarda qisqartiriladi): Telegram "yozmoqda" ~5 s ko'rinadi — javob kelguncha har 4 s takrorlanadi */
export const aiChatOptions = { typingEveryMs: 4000 };

/** Intent (qoidalar) → web sahifa */
export const INTENT_PAGE = {
  CASH: 'treasury', DAILY_STATUS: 'dashboard', DEBTORS: 'receivables', OVERDUE: 'receivables', EXPECTED_INCOME: 'receivables',
  REVENUE: 'pnl', EXPENSES: 'expenses', EXPECTED_EXPENSES: 'expenses', PROFIT: 'pnl', WHY_PROFIT: 'pnl', SERVICE_PROFIT: 'pnl',
  UNMATCHED: 'transactions', APPROVALS: 'approvals', APPROVE_REQUEST: 'approvals', FORECAST: 'forecast', PLAN: 'planfact',
  PAYROLL: 'payroll', CONTRACTS: 'contracts', DATA_QUALITY: 'dashboard',
  MY_EXPENSES: 'expenses', MY_PAYROLL: 'payroll', MY_DEBTORS: 'receivables',
};
/** Tool (LLM) → web sahifa */
export const TOOL_PAGE = {
  get_dashboard: 'dashboard', get_treasury: 'treasury', get_receivables: 'receivables', get_pnl: 'pnl', get_expenses: 'expenses', get_revenue: 'pnl',
  get_forecast: 'forecast', get_service_profitability: 'pnl', get_plan_fact: 'planfact', get_budgets: 'planfact', get_cash_flow: 'cashflow',
  get_balance_sheet: 'balance', get_pending_approvals: 'approvals', get_approvals_for_me: 'approvals', get_unmatched_transactions: 'transactions',
  get_contracts: 'contracts', get_data_quality: 'dashboard', get_my_expense_requests: 'expenses', get_my_payroll: 'payroll',
  get_my_notifications: 'notifications', get_my_contracts: 'contracts', get_my_debtors: 'receivables', get_my_collection_tasks: 'receivables',
};
/** Intent → persona tool (qoidalar javobida ham tegishli buyruq tugmasi chiqishi uchun) */
const INTENT_TOOL = {
  CASH: 'get_treasury', DAILY_STATUS: 'get_dashboard', DEBTORS: 'get_receivables', OVERDUE: 'get_receivables', EXPECTED_INCOME: 'get_receivables',
  REVENUE: 'get_revenue', EXPENSES: 'get_expenses', EXPECTED_EXPENSES: 'get_expenses', PROFIT: 'get_pnl', WHY_PROFIT: 'get_pnl', SERVICE_PROFIT: 'get_service_profitability',
  UNMATCHED: 'get_unmatched_transactions', APPROVALS: 'get_pending_approvals', FORECAST: 'get_forecast', PLAN: 'get_plan_fact', CONTRACTS: 'get_contracts', DATA_QUALITY: 'get_data_quality',
  // o'z ma'lumoti → sorov botidagi /sorovlarim, /oyligim, /qarzdorlarim tugmalari
  MY_EXPENSES: 'get_my_expense_requests', MY_PAYROLL: 'get_my_payroll', MY_DEBTORS: 'get_my_debtors',
};

/** "yozmoqda…" — darhol va har `everyMs` da; qaytgan funksiya to'xtatadi (xato bo'lsa ham finally'da) */
export function keepTyping(ctx, everyMs = aiChatOptions.typingEveryMs) {
  ctx.typing();
  const timer = setInterval(() => ctx.typing(), Math.max(10, everyMs));
  return () => clearInterval(timer);
}

/** Javob ostidagi tugmalar: confirm (tasdiq niyati), ishlatilgan ma'lumotga mos 🌐 web sahifa va 1–2 ta tegishli buyruq */
export function answerButtons(ctx, res) {
  const rows = [];
  if (res.confirm?.type === 'APPROVE' && res.confirm.approval_id) rows.push([btn.cb('✅ Tasdiqlash', `apr:ok:${res.confirm.approval_id}`), btn.cb('✖️ Bekor', 'x')]);
  if (res.denied) return rows;
  const tools = res.tools?.length ? res.tools : INTENT_TOOL[res.intent] ? [INTENT_TOOL[res.intent]] : [];
  const page = res.intent && INTENT_PAGE[res.intent] ? INTENT_PAGE[res.intent] : tools.map((t) => TOOL_PAGE[t]).find(Boolean);
  const persona = personaFor(ctx.bot.key);
  const allowed = new Map((ctx.bot.allowedCommands?.(ctx.user) || []).map((c) => [c.name, c]));
  const cmds = [...new Set(tools.map((t) => persona.commands?.[t]).filter((n) => n && allowed.has(n)))].slice(0, 2);
  const row = cmds.map((n) => ({ text: allowed.get(n).button || `/${n}`, cmd: n }));
  if (page) row.push(btn.web('🌐 Web’da ochish', page));
  if (row.length) rows.push(row);
  return rows;
}

export async function aiReply(ctx, question) {
  if (!ctx.can('ai', 'CREATE')) return ctx.reply(T.aiNoAccess);
  const stop = keepTyping(ctx);
  let res;
  try {
    res = await ctx.S.ai.chat(String(question).slice(0, 2000), ctx.actor, { channel: `TELEGRAM:${ctx.bot.key}`, bot: ctx.bot.key });
  } finally {
    stop();
  }
  return ctx.reply(mdToHtml(res.answer || '--'), { buttons: answerButtons(ctx, res) });
}
