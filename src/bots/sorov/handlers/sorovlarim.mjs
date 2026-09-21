/**
 * /sorovlarim — foydalanuvchining FAQAT o'z xarajat so'rovlari (requested_by = men, approval engine orqali yaratilganlari).
 * Web: Xarajatlar ro'yxati (EMPLOYEE uchun ham shu scope). Batafsil — approval kartasi (tasdiqlash zanjiri).
 */
import { esc } from '../../shared/html.mjs';
import { money, date, line, lines, title, clip, statusIcon, statusLabel, stepLabel } from '../../shared/format.mjs';
import { btn, chunk } from '../../shared/keyboards.mjs';
import { approvalCard } from '../../shared/approvals-ui.mjs';

const LIMIT = 10;
const OCHIQ = ['PENDING', 'POSTPONED'];

/** So'rovning ko'rinadigan holati: xarajat PENDING bo'lsa approval holati (kechiktirilgan) hisobga olinadi */
const holatKodi = (e) => (e.status === 'PENDING' && e.approval_status === 'POSTPONED' ? 'POSTPONED' : e.status);

/** "Kutilmoqda — 2/2 Moliya menejeri" */
function holatMatni(e) {
  const s = holatKodi(e);
  const steps = Array.isArray(e.approval_steps) ? e.approval_steps : [];
  if (OCHIQ.includes(s) && steps.length) {
    const cur = Math.min(e.approval_step ?? 0, steps.length - 1);
    return `${statusLabel(s)} — ${cur + 1}/${steps.length} · ${stepLabel(steps[cur]?.role)} ko‘rib chiqmoqda`;
  }
  if (s === 'APPROVED') return 'Tasdiqlangan — to‘lov kutilmoqda';
  if (s === 'PAID') return `To‘langan${e.paid_at ? ` · ${date(e.paid_at)}` : ''}`;
  return statusLabel(s);
}

/** Foydalanuvchining o'z so'rovlari (web scope + requested_by filtri) */
export function meningSorovlarim(ctx, filtr = {}) {
  return ctx.S.expenses.list(filtr, ctx.user).filter((e) => e.requested_by === ctx.user.id && e.approval_id);
}

export async function sorovlarim(ctx) {
  const hammasi = meningSorovlarim(ctx);
  if (!hammasi.length) {
    return ctx.reply(lines(title('📋', 'So‘rovlarim'), '', 'Hali xarajat so‘rovi yubormagansiz.', ctx.can('expenses', 'CREATE') ? 'Yangi so‘rov — /yangi' : null), { buttons: ctx.can('expenses', 'CREATE') ? [[btn.cmd('➕ Yangi so‘rov', 'yangi')]] : [] });
  }
  const ochiq = hammasi.filter((e) => OCHIQ.includes(holatKodi(e)));
  const qator = hammasi.slice(0, LIMIT);
  const html = lines(
    title('📋', 'So‘rovlarim'),
    line('Jami', `${hammasi.length} ta`),
    ochiq.length ? line('Ko‘rib chiqilmoqda', `${ochiq.length} ta · ${money(ochiq.reduce((s, e) => s + (Number(e.amount) || 0), 0))}`) : null,
    '',
    ...qator.map((e) => lines(
      `${statusIcon(holatKodi(e))} <b>${esc(e.code)}</b> · ${money(e.amount)}`,
      `   ${esc(clip(e.purpose, 70))}`,
      `   <i>${esc(holatMatni(e))}</i>`,
    )),
    hammasi.length > LIMIT ? `\n<i>Oxirgi ${LIMIT} tasi ko‘rsatildi — qolganlari web panelda.</i>` : null,
    '',
    'Batafsil ko‘rish uchun so‘rovni tanlang:',
  );
  const buttons = [
    ...chunk(qator.map((e) => btn.cb(`${statusIcon(holatKodi(e))} ${e.code}`, `s.my:${e.id}`)), 2),
    [ctx.can('expenses', 'CREATE') ? btn.cmd('➕ Yangi so‘rov', 'yangi') : null, btn.web('🌐 Xarajatlar', 'expenses')],
  ];
  return ctx.reply(html, { buttons });
}

/** s.my:<expenseId> — batafsil karta (faqat o'z so'rovi) */
export async function sorovKartasi(ctx) {
  const id = Number(ctx.cbArgs[0]);
  const e = id ? ctx.S.expenses.get(id) : null;
  if (!e || e.requested_by !== ctx.user.id) return ctx.answer('⛔ Bu so‘rov sizniki emas yoki topilmadi.', true);
  const a = e.approval_id ? ctx.S.approvals.getFor(e.approval_id, ctx.user) : null;
  const karta = a ? approvalCard(ctx.S, a) : null;
  const html = lines(
    karta ? karta.html : lines(`📝 <b>${esc(e.code)}</b>`, line('Summa', money(e.amount)), line('Maqsad', clip(e.purpose, 200))),
    '',
    `${line('Xarajat holati', statusLabel(holatKodi(e)))}${e.status === 'PAID' && e.paid_at ? ` · ${esc(date(e.paid_at))}` : ''}`,
    e.receipt_path ? null : '📎 Hujjat biriktirilmagan',
  );
  await ctx.answer();
  return ctx.reply(html, {
    buttons: [
      ...(karta ? karta.buttons : []),
      [btn.web('🌐 Xarajat kartasi', `expenses/${e.id}`)],
      [btn.cmd('◀️ So‘rovlarim', 'sorovlarim')],
    ],
  });
}
