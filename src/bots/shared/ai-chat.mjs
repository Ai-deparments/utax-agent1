/**
 * Erkin matn → AI moliya yordamchisi (app.services.ai.chat) — web "AI moliya" chati bilan bir xil dvigatel va RBAC:
 * foydalanuvchi web'da ko'ra olmaydigan ma'lumot so'ralsa, javob "ruxsat yo'q" bo'ladi (ai.mjs INTENT_PERM).
 */
import { mdToHtml } from './html.mjs';
import { btn } from './keyboards.mjs';
import { T } from './texts.mjs';

/** Intent → web sahifa ("Web'da ochish" tugmasi) */
export const INTENT_PAGE = {
  CASH: 'treasury', DAILY_STATUS: 'dashboard', DEBTORS: 'receivables', OVERDUE: 'receivables', EXPECTED_INCOME: 'receivables',
  REVENUE: 'pnl', EXPENSES: 'expenses', EXPECTED_EXPENSES: 'expenses', PROFIT: 'pnl', WHY_PROFIT: 'pnl', SERVICE_PROFIT: 'pnl',
  UNMATCHED: 'transactions', APPROVALS: 'approvals', APPROVE_REQUEST: 'approvals', FORECAST: 'forecast', PLAN: 'planfact',
  PAYROLL: 'payroll', CONTRACTS: 'contracts', DATA_QUALITY: 'dashboard',
};

export async function aiReply(ctx, question) {
  if (!ctx.can('ai', 'CREATE')) return ctx.reply(T.aiNoAccess);
  await ctx.typing();
  const res = await ctx.S.ai.chat(String(question).slice(0, 2000), ctx.actor, { channel: 'TELEGRAM' });
  const buttons = [];
  if (res.confirm?.type === 'APPROVE' && res.confirm.approval_id) buttons.push([btn.cb('✅ Tasdiqlash', `apr:ok:${res.confirm.approval_id}`), btn.cb('✖️ Bekor', 'x')]);
  const page = !res.denied && INTENT_PAGE[res.intent];
  if (page) buttons.push([btn.web('🌐 Web’da ochish', page)]);
  return ctx.reply(mdToHtml(res.answer || '—'), { buttons });
}
