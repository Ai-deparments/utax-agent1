/**
 * Barcha botlarda ishlaydigan tugmalar (bildirishnomalar istalgan botdan kelishi mumkin):
 *   apr:*  / aprr:*  — tasdiqlash (approvals-ui.mjs)
 *   nr:<crmId>       — bildirishnoma "Ko'rildi" (web'dagi o'qilgan belgisi bilan sinxron)
 *   x                — tugmalarni yopish / bekor
 */
import { approvalCallbacks, approvalDialogs } from './approvals-ui.mjs';

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
      if (ctx.cbArgs[0] === 'seen') return ctx.answer('✅ Ko‘rildi');
      const had = ctx.dialog.get();
      if (had) ctx.dialog.clear();
      await ctx.setButtons(null);
      return ctx.answer('Yopildi');
    },
  },
};

export const sharedDialogs = { ...approvalDialogs };
