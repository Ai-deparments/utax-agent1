/**
 * /tolov — tasdiqlangan, to'lanmagan xarajatlarni to'langan deb belgilash (web: Xarajatlar → «To'landi», expenses EDIT):
 *   🏦 bank — expenses.markPaid; 💵 kassa (treasury CREATE ham) — banking.createCashTransaction(EXPENSE + expense_id).
 * /xarajatlar [oy] — davr xarajatlari (web: Xarajatlar → xulosa).
 */
import { today, monthRange, addMonths, pct as foiz, sum } from '../../../core/util.mjs';
import { esc } from '../../shared/html.mjs';
import { money, date, lines, line, title, muted, clip, pct, monthLabel, statusLabel, PAYMENT_METHOD } from '../../shared/format.mjs';
import { T } from '../../shared/texts.mjs';
import { oyArg, oyNav, oyTekshir } from './umumiy.mjs';

const MAX_KARTA = 10;

function xarajatKartasi(ctx, e, { tasdiq } = {}) {
  const kassa = ctx.S.banking.cashAccounts()[0] || null;
  const html = lines(
    `💸 <b>${esc(e.code)}</b> · ${esc(clip(e.purpose, 90))}`,
    line('Summa', money(e.amount)),
    e.category_name ? line('Kategoriya', e.category_name) : null,
    e.department_name ? line('Bo‘lim', e.department_name) : null,
    e.requested_by_name ? line('So‘ragan', e.requested_by_name) : null,
    e.counterparty ? line('Kontragent', e.counterparty) : null,
    line('Kerakli sana', e.required_date ? date(e.required_date) : '—'),
    line('To‘lov usuli', PAYMENT_METHOD[e.payment_method] || e.payment_method || '—'),
    tasdiq === 'b' ? '\n🏦 <b>Bankdan to‘landi</b> deb belgilansinmi?' : null,
    tasdiq === 'c' ? `\n💵 <b>${esc(kassa?.name || 'Kassa')}</b> dan naqd to‘landi deb yozilsinmi? Kassa chiqimi yaratiladi.` : null,
  );
  let buttons;
  if (tasdiq) buttons = [[{ text: '✅ Ha, to‘landi', cb: `b.pay:y${tasdiq}:${e.id}` }, { text: '◀️ Orqaga', cb: `b.pay:v:${e.id}` }]];
  else {
    const row = [{ text: '🏦 Bankdan to‘landi', cb: `b.pay:b:${e.id}` }];
    if (ctx.can('treasury', 'CREATE') && kassa) row.push({ text: '💵 Kassadan to‘landi', cb: `b.pay:c:${e.id}` });
    buttons = [row, [{ text: '🌐 Xarajat', web: `expenses/${e.id}` }]];
  }
  return { html, buttons };
}

function xarajatlarXulosa(ctx, period) {
  const { from, to } = monthRange(period);
  const oldin = monthRange(addMonths(period, -1));
  const jami = ctx.S.expenses.total(from, to), oldingi = ctx.S.expenses.total(oldin.from, oldin.to);
  const kategoriyalar = ctx.S.expenses.totalsByCategory(from, to).filter((c) => c.amount > 0);
  const tolanmagan = ctx.S.expenses.approvedUnpaid();
  const kutmoqda = ctx.S.expenses.list({ status: 'PENDING' }, ctx.user);
  const ozgarish = oldingi ? foiz(jami - oldingi, oldingi) : null;
  return lines(
    title('🧾', `Xarajatlar — ${monthLabel(period)}`),
    line('Jami (tasdiqlangan + to‘langan)', money(jami)),
    ozgarish !== null ? muted(`O‘tgan oyga nisbatan: ${ozgarish > 0 ? '+' : ''}${pct(ozgarish)} (${monthLabel(addMonths(period, -1))}: ${money(oldingi)})`) : null,
    '',
    kategoriyalar.length ? '<b>Kategoriyalar bo‘yicha:</b>' : muted('Bu oyda xarajat yo‘q.'),
    ...kategoriyalar.slice(0, 8).map((c) => `• ${esc(c.name)}: <b>${esc(money(c.amount))}</b> · ${esc(pct(foiz(c.amount, jami)))}`),
    kategoriyalar.length > 8 ? muted(`… yana ${kategoriyalar.length - 8} ta kategoriya`) : null,
    '',
    line('💸 To‘lanishi kerak (tasdiqlangan)', `${tolanmagan.n} ta · ${money(tolanmagan.s)}`),
    line('⏳ Tasdiq kutmoqda', `${kutmoqda.length} ta · ${money(sum(kutmoqda, (e) => e.amount))}`),
  );
}

/**
 * Xarajat hali to'lanadigan holatda bo'lsa (APPROVED, reversal qilinmagan, bank/kassa tranzaksiyasiga bog'lanmagan — servisdagi
 * banking.expenseUnpayableReason qoidasi) — qaytaradi; aks holda kartani yangilab null qaytaradi.
 */
async function ochiqXarajat(ctx, id) {
  const e = ctx.S.expenses.get(Number(id));
  if (!e) { await ctx.answer('Xarajat topilmadi', true); return null; }
  if (!ctx.S.banking.expenseUnpayableReason(e)) return e;
  const holat = e.reversed_at ? 'Bekor qilingan (reversal)' : statusLabel(e.status === 'APPROVED' ? 'PAID' : e.status);
  await ctx.answer(`Holat: ${holat}`, true);
  await ctx.edit(lines(`💸 <b>${esc(e.code)}</b> · ${esc(clip(e.purpose, 90))}`, line('Holat', holat), e.paid_at ? line('To‘langan sana', date(e.paid_at)) : null), { buttons: [[{ text: '🌐 Xarajat', web: `expenses/${e.id}` }]] });
  return null;
}

/** Yozishdan bevosita oldin (await'siz) qayta tekshirish — tekshiruv va yozuv orasida boshqa update ishlab ulgurmaydi */
function hozirTolanadimi(ctx, id) {
  const e = ctx.S.expenses.get(Number(id));
  return { e, sabab: ctx.S.banking.expenseUnpayableReason(e) };
}

export default {
  commands: [
    {
      name: 'tolov', desc: 'Tasdiqlangan xarajatlarni to‘langan deb belgilash', button: '💸 To‘lov', usage: '/tolov', perm: ['expenses', 'EDIT'],
      async run(ctx) {
        const rows = ctx.S.expenses.list({ status: 'APPROVED' }, ctx.user);
        const jami = ctx.S.expenses.approvedUnpaid();
        if (!rows.length) return ctx.reply('✅ To‘lanishi kerak bo‘lgan tasdiqlangan xarajat yo‘q.', { buttons: [[{ text: '🌐 Xarajatlar', web: 'expenses' }]] });
        await ctx.reply(lines(title('💸', 'To‘lov navbati'), line('Tasdiqlangan, to‘lanmagan', `${jami.n} ta · ${money(jami.s)}`), rows.length > MAX_KARTA ? muted(`Birinchi ${MAX_KARTA} tasi ko‘rsatildi — qolgani web panelda.`) : null));
        for (const e of rows.slice(0, MAX_KARTA)) {
          const k = xarajatKartasi(ctx, e);
          await ctx.reply(k.html, { buttons: k.buttons });
        }
        return null;
      },
    },
    {
      name: 'xarajatlar', desc: 'Oy xarajatlari: kategoriyalar, to‘lanmagan, kutilayotgan', button: '🧾 Xarajatlar', usage: '/xarajatlar [oy]', perm: ['expenses', 'VIEW'],
      run(ctx) {
        const period = oyArg(ctx.args);
        return ctx.reply(xarajatlarXulosa(ctx, period), { buttons: [oyNav('b.xr', period), [ctx.can('expenses', 'EDIT') ? { text: '💸 To‘lov', cmd: 'tolov' } : null, { text: '🌐 Xarajatlar', web: 'expenses' }]] });
      },
    },
  ],
  callbacks: {
    'b.pay': {
      perm: ['expenses', 'EDIT'],
      async run(ctx) {
        const [amal, id] = ctx.cbArgs;
        if (amal === 'v') { const e = await ochiqXarajat(ctx, id); if (!e) return null; const k = xarajatKartasi(ctx, e); await ctx.answer(); return ctx.edit(k.html, { buttons: k.buttons }); }
        if (amal === 'b' || amal === 'c') {
          if (amal === 'c') ctx.need('treasury', 'CREATE');
          const e = await ochiqXarajat(ctx, id);
          if (!e) return null;
          const k = xarajatKartasi(ctx, e, { tasdiq: amal });
          await ctx.answer();
          return ctx.edit(k.html, { buttons: k.buttons });
        }
        if (amal === 'yb') {
          ctx.need('expenses', 'EDIT');
          if (!(await ochiqXarajat(ctx, id))) return null;
          const { e, sabab } = hozirTolanadimi(ctx, id);
          if (sabab) return ctx.answer(sabab, true);
          // «Bankdan to‘landi» — to'lov usuli haqiqatda bank: shunda keyingi bank ko'chirmasidagi chiqim shu xarajatga bog'lanadi (reconciliation nomzodi)
          if (e.payment_method !== 'BANK') ctx.S.expenses.update(e.id, { payment_method: 'BANK' }, ctx.actor);
          ctx.S.expenses.markPaid(e.id, { paid_at: today() }, ctx.actor);
          await ctx.answer('✅ To‘landi');
          return ctx.edit(lines(title('✅', `To‘landi (bank): ${e.code}`), `${esc(clip(e.purpose, 90))}`, line('Summa', money(e.amount)), line('Sana', date(today())), muted('Bank ko‘chirmasi kelganda shu summadagi chiqim bu xarajatga bog‘lanadi (avtomatik yoki /boglash orqali).')), { buttons: [[{ text: '🌐 Xarajat', web: `expenses/${e.id}` }]] });
        }
        if (amal === 'yc') {
          ctx.need('expenses', 'EDIT');
          ctx.need('treasury', 'CREATE');
          if (!(await ochiqXarajat(ctx, id))) return null;
          const kassa = ctx.S.banking.cashAccounts()[0];
          if (!kassa) return ctx.answer('Kassa hisobi yo‘q', true);
          const { e, sabab } = hozirTolanadimi(ctx, id);
          if (sabab) return ctx.answer(sabab, true);
          // Servis ham shartli UPDATE bilan himoyalaydi (boshqa jarayon/web parallel to'lasa — ikkinchi kassa chiqimi yozilmaydi, xato qaytadi)
          ctx.S.banking.createCashTransaction({ cash_account_id: kassa.id, tx_date: today(), amount: e.amount, direction: 'EXPENSE', purpose: `${e.code} · ${e.purpose}`.slice(0, 300), expense_id: e.id, counterparty_name: e.counterparty || null }, ctx.actor);
          const kassaQoldiq = ctx.S.banking.cashBalance().accounts.find((a) => a.id === kassa.id)?.balance ?? 0;
          await ctx.answer('✅ To‘landi');
          return ctx.edit(lines(title('✅', `To‘landi (kassa): ${e.code}`), `${esc(clip(e.purpose, 90))}`, line('Summa', money(e.amount)), line(`${kassa.name} qoldig‘i`, money(kassaQoldiq))), { buttons: [[{ text: '🌐 Xarajat', web: `expenses/${e.id}` }, { text: '🌐 Pul boshqaruvi', web: 'treasury' }]] });
        }
        return ctx.answer(T.expired, true);
      },
    },
    'b.xr': {
      perm: ['expenses', 'VIEW'],
      async run(ctx) {
        const period = ctx.cbArgs[0];
        if (!oyTekshir(period)) return ctx.answer(T.expired, true);
        await ctx.answer();
        return ctx.edit(xarajatlarXulosa(ctx, period), { buttons: [oyNav('b.xr', period), [ctx.can('expenses', 'EDIT') ? { text: '💸 To‘lov', cmd: 'tolov' } : null, { text: '🌐 Xarajatlar', web: 'expenses' }]] });
      },
    },
  },
};

