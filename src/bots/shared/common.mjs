/**
 * Barcha botlarda ishlaydigan tugmalar (bildirishnomalar istalgan botdan kelishi mumkin):
 *   apr:*  / aprr:*  — tasdiqlash (approvals-ui.mjs)
 *   nr:<crmId>       — bildirishnoma "Ko'rildi" (web'dagi o'qilgan belgisi bilan sinxron)
 *   x:<teg>          — shu dialogni bekor qilish (teg — dialog boshlanganda; factory «✖️ Bekor» tugmasiga o'zi qo'shadi)
 *   x                — tegsiz (dialogdan tashqari xabar yoki deploydan oldingi eski xabar): faqat tugmalarni yopadi, ochiq dialogni o'chirmaydi
 */
import { approvalCallbacks, approvalDialogs } from './approvals-ui.mjs';
import { dialogTag } from './dialogs.mjs';
import { T } from './texts.mjs';

export const sharedCallbacks = {
  ...approvalCallbacks,
  nr: {
    perm: ['notifications', 'EDIT'], // web /api/notifications/read bilan bir xil
    async run(ctx) {
      const id = Number(ctx.cbArgs[0]);
      const n = id ? ctx.S.notifications.markRead(ctx.user.id, { ids: [id] }) : 0;
      await ctx.setButtons([[{ text: '✅ Ko‘rildi', cb: 'x:seen' }]]);
      return ctx.answer(n ? '✅ O‘qilgan deb belgilandi' : 'Allaqachon o‘qilgan');
    },
  },
  x: {
    async run(ctx) {
      const tag = ctx.cbArgs[0];
      if (tag === 'seen') return ctx.answer('✅ Ko‘rildi');
      const cur = ctx.dialog.get();
      await ctx.setButtons(null); // bosilgan xabarning tugmalari har holda olib tashlanadi
      // Faqat tugma tegishli dialog bekor qilinadi: eski xabardagi «✖️ Bekor» keyin boshlangan boshqa dialogni o'chirmaydi
      if (tag && cur && dialogTag(cur) === tag) { ctx.dialog.clear(); return ctx.answer('✖️ Bekor qilindi'); }
      if (cur) return ctx.answer(T.cancelStale, true);
      return ctx.answer('Yopildi');
    },
  },
};

export const sharedDialogs = { ...approvalDialogs };
