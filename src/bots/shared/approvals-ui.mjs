/**
 * Tasdiqlash (approval engine) — barcha botlar uchun umumiy UI: karta, ro'yxat, ✅/❌/⏸ tugmalari, rad etish sababi dialogi.
 * Qaror har doim app.services.approvals.decide(...) orqali — web "Tasdiqlashlar" sahifasi bilan bir xil qoida (canAct, zanjir, audit).
 */
import { esc } from './html.mjs';
import { money, date, dt, statusLabel, stepLabel, approvalType, lines, line, muted, clip, PAYMENT_METHOD } from './format.mjs';
import { btn } from './keyboards.mjs';
import { T } from './texts.mjs';

const OPEN = ['PENDING', 'POSTPONED'];
const REJECT_REASONS = { 1: 'Byudjetda ko‘zda tutilmagan', 2: 'Hujjatlar yetarli emas', 3: 'Summa asoslanmagan', 4: 'Keyinroq qayta ko‘rib chiqiladi' };

/** Xarajat so'rovi bo'lsa — qo'shimcha tafsilotlar (kategoriya, muddat, to'lov usuli); `user` berilsa — faqat web'da ham ko'ra oladigan xarajat (expenses scope) */
function expenseLines(S, a, user) {
  if (a.entity_type !== 'EXPENSE' || !a.entity_id) return [];
  const e = user ? S.expenses.getFor(a.entity_id, user) : S.expenses.get(a.entity_id);
  if (!e) return [];
  return [
    e.category_name ? line('Kategoriya', e.category_name) : null,
    e.counterparty ? line('Kontragent', e.counterparty) : null,
    e.required_date ? line('Kerakli sana', date(e.required_date)) : null,
    e.payment_method ? line('To‘lov usuli', PAYMENT_METHOD[e.payment_method] || e.payment_method) : null,
    e.receipt_path ? '📎 Hujjat biriktirilgan' : null,
  ];
}

/** Approval kartasi: { html, buttons } — `a` = approvals.getFor(id, user) yoki list() qatori (can_act bilan); `user` — xarajat tafsilotlari scope'i uchun */
export function approvalCard(S, a, user) {
  const step = a.steps?.[a.current_step];
  const open = OPEN.includes(a.status);
  const chain = (a.steps || []).map((s, idx) => {
    const icon = s.status === 'APPROVED' ? '✅' : s.status === 'REJECTED' ? '❌' : s.status === 'POSTPONED' ? '⏸' : idx === a.current_step && open ? '👉' : '▫️';
    const who = s.user_name ? ` — ${esc(s.user_name)}, ${esc(dt(s.decided_at))}${s.source ? ` (${esc(s.source === 'TELEGRAM' ? 'Telegram' : s.source === 'WEB' ? 'web' : s.source)})` : ''}` : '';
    return `${icon} ${esc(stepLabel(s.role))}${who}${s.comment ? `\n      «${esc(clip(s.comment, 90))}»` : ''}`;
  });
  const html = lines(
    `📝 <b>#${a.id} · ${esc(approvalType(a.entity_type))}</b>`,
    `<b>${esc(clip(a.title, 140))}</b>`,
    a.amount !== null && a.amount !== undefined ? line('Summa', money(a.amount)) : null,
    a.requested_by_name ? line('So‘ragan', `${a.requested_by_name}${a.department_name ? ` (${a.department_name})` : ''}`) : null,
    ...expenseLines(S, a, user),
    `${line('Holat', statusLabel(a.status))}${a.status === 'POSTPONED' && a.postponed_until ? ` · ${esc(date(a.postponed_until))} gacha` : ''}`,
    muted(`Yaratilgan: ${dt(a.created_at)}`),
    '',
    '<b>Tasdiqlash zanjiri:</b>',
    ...chain,
    a.can_act ? '\n👉 <b>Sizning navbatingiz</b>' : open && step ? `\n${muted(a.is_mine ? `Bu sizning so‘rovingiz — uni ${stepLabel(step.role)} (boshqa vakolatli shaxs) tasdiqlaydi` : `Bu qadamni ${stepLabel(step.role)} tasdiqlaydi`)}` : null,
  );
  const buttons = [];
  if (a.can_act) {
    buttons.push([btn.cb('✅ Tasdiqlash', `apr:ok:${a.id}`), btn.cb('❌ Rad etish', `apr:no:${a.id}`)]);
    if (a.status === 'PENDING') buttons.push([btn.cb('⏸ 3 kunga kechiktirish', `apr:later:${a.id}`)]);
  }
  buttons.push([btn.web('🌐 Web’da ochish', `approvals/${a.id}`)]);
  return { html, buttons };
}

/** Kutilayotgan tasdiqlar ro'yxati (web /api/approvals bilan bir xil scope) */
export function pendingApprovals(ctx, { entityType } = {}) {
  let rows = [...ctx.S.approvals.list({ status: 'PENDING' }, ctx.user), ...ctx.S.approvals.list({ status: 'POSTPONED' }, ctx.user)];
  if (entityType) rows = rows.filter((a) => (Array.isArray(entityType) ? entityType.includes(a.entity_type) : a.entity_type === entityType));
  return rows.filter((a) => ctx.S.approvals.visibleTo(a, ctx.user)); // EMPLOYEE/SALES — faqat o'ziniki
}

/**
 * /tasdiqlash — foydalanuvchi navbatidagi so'rovlar, har biri alohida karta (tugmalar bilan).
 * @param opts.entityType  'EXPENSE' | ['EXPENSE','PAYROLL'] — filtr
 * @param opts.limit       nechta karta yuboriladi (qolgani web'ga)
 */
export async function showApprovals(ctx, { entityType, limit = 6, title = 'Tasdiqlashlar' } = {}) {
  ctx.need('approvals', 'VIEW');
  const rows = pendingApprovals(ctx, { entityType });
  const mine = rows.filter((a) => a.can_act);
  const total = mine.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const head = lines(
    `✅ <b>${esc(title)}</b>`,
    line('Sizning navbatingizda', `${mine.length} ta · ${money(total)}`),
    rows.length !== mine.length ? line('Jami kutmoqda', `${rows.length} ta`) : null,
  );
  if (!mine.length) return ctx.reply(`${head}\n\nSizda tasdiq kutayotgan so‘rov yo‘q ✅`, { buttons: [[btn.web('🌐 Tasdiqlashlar', 'approvals')]] });
  await ctx.reply(head);
  for (const a of mine.slice(0, limit)) {
    const c = approvalCard(ctx.S, a, ctx.user);
    await ctx.reply(c.html, { buttons: c.buttons });
  }
  if (mine.length > limit) await ctx.reply(`Yana <b>${mine.length - limit}</b> ta so‘rov — web panelda.`, { buttons: [[btn.web('🌐 Barchasi', 'approvals')]] });
  return null;
}

async function refreshCard(ctx, id) {
  const a = ctx.S.approvals.getFor(id, ctx.user);
  if (!a) return null;
  const c = approvalCard(ctx.S, a, ctx.user);
  await ctx.edit(c.html, { buttons: c.buttons });
  return a;
}

function decideReject(ctx, id, reason) {
  ctx.need('approvals', 'REJECT');
  return ctx.S.approvals.decide(id, 'REJECT', ctx.actor, reason);
}

export const approvalCallbacks = {
  /** apr:<ok|no|later|view>:<id> */
  apr: {
    ttlHours: 24 * 7,
    async run(ctx) {
      const [action, idStr] = ctx.cbArgs;
      const id = Number(idStr);
      ctx.need('approvals', 'VIEW');
      const a = ctx.S.approvals.getFor(id, ctx.user); // scope: EMPLOYEE/SALES — faqat o'ziniki (web /api/approvals/:id bilan bir xil)
      if (!a) return ctx.answer('So‘rov topilmadi', true);
      if (action === 'view') { await refreshCard(ctx, id); return ctx.answer(); }
      if (!a.can_act) {
        await refreshCard(ctx, id);
        if (OPEN.includes(a.status) && a.is_mine) return ctx.answer('O‘z so‘rovingizni o‘zingiz tasdiqlay olmaysiz — uni boshqa vakolatli shaxs ko‘rib chiqadi', true);
        return ctx.answer(OPEN.includes(a.status) ? `Bu qadamni ${stepLabel(a.steps[a.current_step]?.role)} tasdiqlaydi` : `Allaqachon hal qilingan: ${statusLabel(a.status)}`, true);
      }
      if (action === 'ok') {
        ctx.need('approvals', 'APPROVE');
        const r = ctx.S.approvals.decide(id, 'APPROVE', ctx.actor, 'Telegram orqali tasdiqlandi');
        await refreshCard(ctx, id);
        return ctx.answer(r.status === 'APPROVED' ? '✅ Tasdiqlandi' : '✅ Tasdiqlandi — keyingi qadamga o‘tdi');
      }
      if (action === 'later') {
        ctx.need('approvals', 'APPROVE');
        ctx.S.approvals.decide(id, 'POSTPONE', ctx.actor, 'Telegram: 3 kunga kechiktirildi');
        await refreshCard(ctx, id);
        return ctx.answer('⏸ 3 kunga kechiktirildi');
      }
      if (action === 'no') {
        ctx.need('approvals', 'REJECT');
        ctx.dialog.start('apr.reject', { id, message_id: ctx.callback?.message?.message_id || null });
        await ctx.answer();
        return ctx.reply(`❌ <b>#${id}</b> — rad etish sababini yozing yoki tanlang:${T.dialogHint}`, {
          buttons: Object.entries(REJECT_REASONS).map(([k, v]) => [btn.cb(v, `aprr:${id}:${k}`)]),
        });
      }
      return ctx.answer(T.expired, true);
    },
  },
  /** aprr:<id>:<reasonNo> — tayyor sabab bilan rad etish */
  aprr: {
    ttlHours: 24,
    async run(ctx) {
      const [idStr, k] = ctx.cbArgs;
      const id = Number(idStr);
      const reason = REJECT_REASONS[k];
      if (!reason) return ctx.answer(T.expired, true);
      const cur = ctx.dialog.get();
      const r = decideReject(ctx, id, reason);
      if (cur?.name === 'apr.reject') ctx.dialog.clear();
      await ctx.edit(`❌ <b>#${id}</b> rad etildi.\nSabab: ${esc(reason)}`);
      await ctx.answer('❌ Rad etildi');
      return r;
    },
  },
};

export const approvalDialogs = {
  'apr.reject': {
    async onText(ctx, st) {
      const reason = ctx.text.trim();
      if (reason.length < 3) return ctx.reply('Sabab kamida 3 belgi bo‘lsin.' + T.dialogHint);
      const id = Number(st.data.id);
      decideReject(ctx, id, reason.slice(0, 500));
      ctx.dialog.clear();
      if (st.data.message_id) {
        const a = ctx.S.approvals.getFor(id, ctx.user);
        if (a) { const c = approvalCard(ctx.S, a, ctx.user); await ctx.bot.api.editMessageText(ctx.chatId, st.data.message_id, c.html, { reply_markup: undefined }).catch(() => {}); }
      }
      return ctx.reply(`❌ <b>#${id}</b> rad etildi.\nSabab: «${esc(clip(reason, 200))}»\nSo‘rovchiga xabar yuborildi.`);
    },
  },
};
