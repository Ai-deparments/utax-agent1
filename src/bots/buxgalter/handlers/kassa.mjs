/**
 * /kassa — naqd kassa kirim/chiqim (web: Pul boshqaruvi → Kassa operatsiyasi; POST /api/cash-transactions, treasury CREATE):
 * kassa → kirim/chiqim → summa → maqsad → (kirim: shartnoma | chiqim: tasdiqlangan xarajat) → tasdiq → banking.createCashTransaction.
 */
import { today } from '../../../core/util.mjs';
import { esc } from '../../shared/html.mjs';
import { money, date, lines, line, title, muted, clip, fmt, parseAmount, statusLabel } from '../../shared/format.mjs';
import { BotError } from '../../shared/errors.mjs';
import { T } from '../../shared/texts.mjs';
import { shartnomaQidir, yonalish } from './umumiy.mjs';

const D = 'b.kassa';
const PERM = ['treasury', 'CREATE'];
/** Bitta kassa operatsiyasi uchun oqilona yuqori chegara (/yangi summa qadami bilan bir xil) — xato yozilgan ortiqcha nollardan himoya */
const KASSA_MAX = 1e12;

const kassaOl = (S, id) => S.banking.cashAccounts().find((k) => k.id === Number(id)) || null;
const qoldiq = (S, id) => S.banking.cashBalance().accounts.find((a) => a.id === Number(id))?.balance ?? 0;
const tasdiqlanganXarajatlar = (ctx, q) => ctx.S.expenses.list({ status: 'APPROVED', ...(q ? { q } : {}) }, ctx.user).sort((a, b) => (b.payment_method === 'CASH') - (a.payment_method === 'CASH')); // naqd to'lanadiganlar birinchi

function yonalishSorovi(ctx, k) {
  return {
    html: lines(title('💵', `Kassa: ${k.name}`), line('Joriy qoldiq', money(qoldiq(ctx.S, k.id))), '', 'Operatsiya turi?') + T.dialogHint,
    buttons: [[{ text: '🟢 Kirim', cb: 'b.ks:d:INCOME' }, { text: '🔴 Chiqim', cb: 'b.ks:d:EXPENSE' }], [{ text: '✖️ Bekor', cb: 'x' }]],
  };
}

function tasdiqKartasi(ctx, d) {
  const k = kassaOl(ctx.S, d.account_id);
  const c = d.contract_id ? ctx.S.contracts.get(d.contract_id) : null;
  const e = d.expense_id ? ctx.S.expenses.get(d.expense_id) : null;
  const html = lines(
    title('💵', 'Kassa operatsiyasi — tasdiqlang'),
    line('Kassa', k?.name || '--'),
    `Turi: <b>${yonalish(d.direction)}</b>`,
    line('Summa', money(d.amount)),
    line('Maqsad', d.purpose),
    c ? line('Shartnoma', `${c.contract_number} · ${c.company_name} (qoldiq ${money(c.remaining)})`) : null,
    c && d.amount > c.remaining + 1 ? '⚠️ Summa shartnoma qoldig‘idan katta — ortiqcha to‘lov sifatida qayd etiladi.' : null,
    e ? line('Xarajat', `${e.code} · ${clip(e.purpose, 60)} (${money(e.amount)})`) : null,
    e && Math.abs(d.amount - e.amount) > 0.5 ? `⚠️ Summa xarajat summasidan farq qiladi (${esc(money(e.amount))}).` : null,
    !c && !e ? muted(d.direction === 'INCOME' ? 'Shartnomasiz kirim' : 'Xarajat so‘roviga bog‘lanmagan chiqim') : null,
    line('Sana', date(today())),
  );
  return { html, buttons: [[{ text: '✅ Saqlash', cb: 'b.ks:ok' }, { text: '✖️ Bekor', cb: 'x' }]] };
}

function xarajatTanlash(ctx, rows) {
  return {
    html: lines('Qaysi tasdiqlangan xarajat kassadan to‘lanyapti?', muted('Ro‘yxatda yo‘q bo‘lsa — xarajat kodini yozing (EXP-000123) yoki ⏭.')) + T.dialogHint,
    buttons: [...rows.slice(0, 8).map((e) => [{ text: `💸 ${e.code} · ${fmt(e.amount)} · ${clip(e.purpose, 18)}`, cb: `b.ks:ex:${e.id}` }]), [{ text: '⏭ Xarajatsiz', cb: 'b.ks:skip' }]],
  };
}

export default {
  commands: [
    {
      name: 'kassa', desc: 'Naqd kassa kirim/chiqim yozish', button: '💵 Kassa', usage: '/kassa', perm: PERM,
      async run(ctx) {
        const kassalar = ctx.S.banking.cashAccounts();
        if (!kassalar.length) throw new BotError('Kassa hisobi yo‘q. Web → Pul boshqaruvi bo‘limida kassa qo‘shing.');
        if (kassalar.length === 1) {
          ctx.dialog.start(D, { account_id: kassalar[0].id }, 'direction');
          const s = yonalishSorovi(ctx, kassalar[0]);
          return ctx.reply(s.html, { buttons: s.buttons });
        }
        ctx.dialog.start(D, {}, 'account');
        return ctx.reply(lines(title('💵', 'Kassa operatsiyasi'), '', 'Qaysi kassa?'), { buttons: [...kassalar.map((k) => [{ text: `💵 ${k.name}`, cb: `b.ks:a:${k.id}` }]), [{ text: '✖️ Bekor', cb: 'x' }]] });
      },
    },
  ],
  callbacks: {
    'b.ks': {
      perm: PERM,
      async run(ctx) {
        const st = ctx.dialog.get();
        if (!st || st.name !== D) return ctx.answer(T.expired, true);
        const [amal, arg] = ctx.cbArgs;
        const d = st.data;
        if (amal === 'a') {
          const k = kassaOl(ctx.S, arg);
          if (!k) return ctx.answer('Kassa topilmadi', true);
          ctx.dialog.update({ step: 'direction', data: { account_id: k.id } });
          const s = yonalishSorovi(ctx, k);
          await ctx.answer();
          return ctx.edit(s.html, { buttons: s.buttons });
        }
        if (amal === 'd') {
          if (!d.account_id || !['INCOME', 'EXPENSE'].includes(arg)) return ctx.answer(T.expired, true);
          ctx.dialog.update({ step: 'amount', data: { direction: arg } });
          await ctx.answer();
          return ctx.edit(lines(`💵 <b>${yonalish(arg)}</b>`, '', 'Summani yozing: <code>2 500 000</code> yoki <code>2,5 mln</code>') + T.dialogHint);
        }
        if (amal === 'ct') {
          if (st.step !== 'link' || d.direction !== 'INCOME') return ctx.answer(T.expired, true);
          const c = ctx.S.contracts.get(Number(arg));
          if (!c) return ctx.answer('Shartnoma topilmadi', true);
          ctx.dialog.update({ step: 'confirm', data: { contract_id: c.id, counterparty: c.company_name } });
          const k = tasdiqKartasi(ctx, ctx.dialog.get().data);
          await ctx.answer();
          return ctx.edit(k.html, { buttons: k.buttons });
        }
        if (amal === 'ex') {
          if (st.step !== 'link' || d.direction !== 'EXPENSE') return ctx.answer(T.expired, true);
          const e = ctx.S.expenses.get(Number(arg));
          const sabab = ctx.S.banking.expenseUnpayableReason(e); // servisdagi qoida: APPROVED, reversal emas, hali to'lanmagan
          if (sabab) return ctx.answer(sabab, true);
          ctx.dialog.update({ step: 'confirm', data: { expense_id: e.id, counterparty: e.counterparty || null } });
          const k = tasdiqKartasi(ctx, ctx.dialog.get().data);
          await ctx.answer();
          return ctx.edit(k.html, { buttons: k.buttons });
        }
        if (amal === 'skip') {
          if (st.step !== 'link') return ctx.answer(T.expired, true);
          ctx.dialog.update({ step: 'confirm', data: { contract_id: null, expense_id: null } });
          const k = tasdiqKartasi(ctx, ctx.dialog.get().data);
          await ctx.answer();
          return ctx.edit(k.html, { buttons: k.buttons });
        }
        if (amal === 'ok') {
          if (st.step !== 'confirm' || !d.amount || !d.direction || !d.account_id) return ctx.answer(T.expired, true);
          ctx.need('treasury', 'CREATE');
          const k = kassaOl(ctx.S, d.account_id);
          if (!k) return ctx.answer('Kassa topilmadi', true);
          if (d.expense_id) {
            // Tasdiq kartasi 30 daqiqagacha eskirishi mumkin: shu orada xarajat /tolov, web yoki bank bog'lash orqali to'langan / bekor qilingan bo'lsa — yozilmaydi
            const e0 = ctx.S.expenses.get(d.expense_id);
            const sabab = ctx.S.banking.expenseUnpayableReason(e0);
            if (sabab) {
              ctx.dialog.clear();
              await ctx.answer(sabab, true);
              return ctx.edit(lines(title('⚠️', 'Kassa chiqimi yozilmadi'), esc(sabab), e0 ? line('Xarajat holati', e0.reversed_at ? 'Bekor qilingan (reversal)' : statusLabel(e0.status)) : null, muted('Qaytadan: /kassa')), e0 ? { buttons: [[{ text: '🌐 Xarajat', web: `expenses/${e0.id}` }]] } : {});
            }
          }
          let tx;
          try {
            tx = ctx.S.banking.createCashTransaction({ cash_account_id: k.id, tx_date: today(), amount: d.amount, direction: d.direction, purpose: d.purpose, contract_id: d.contract_id || null, expense_id: d.expense_id || null, counterparty_name: d.counterparty || null }, ctx.actor);
          } catch (err) {
            if (err?.status && err.status < 500) ctx.dialog.clear(); // servis rad etdi (masalan, parallel to'lov) — eskirgan dialog qolmasin; xato matni foydalanuvchiga chiqadi
            throw err;
          }
          ctx.dialog.clear();
          const c = d.contract_id ? ctx.S.contracts.get(d.contract_id) : null;
          const e = d.expense_id ? ctx.S.expenses.get(d.expense_id) : null;
          await ctx.answer('✅ Saqlandi');
          return ctx.edit(lines(
            title('✅', `Kassa: ${d.direction === 'INCOME' ? 'kirim' : 'chiqim'} yozildi`),
            line('Summa', money(tx.amount)),
            line('Maqsad', tx.purpose || '--'),
            c ? line(`Shartnoma ${c.contract_number}`, `to‘langan ${money(c.paid)}, qoldiq ${money(c.remaining)}`) : null,
            e ? line(`Xarajat ${e.code}`, e.status === 'PAID' ? 'To‘langan' : e.status) : null,
            line(`${k.name} qoldig‘i`, money(qoldiq(ctx.S, k.id))),
          ), { buttons: [[{ text: '🌐 Pul boshqaruvi', web: 'treasury' }, c ? { text: '🌐 Shartnoma', web: `contracts/${c.id}` } : e ? { text: '🌐 Xarajat', web: `expenses/${e.id}` } : null]] });
        }
        return ctx.answer(T.expired, true);
      },
    },
  },
  dialogs: {
    [D]: {
      async onText(ctx, st) {
        const d = st.data;
        if (st.step === 'amount') {
          const amount = parseAmount(ctx.text);
          if (!amount) return ctx.reply('❌ Summani tushunmadim. Masalan: <code>2 500 000</code> yoki <code>2,5 mln</code>.' + T.dialogHint);
          if (amount > KASSA_MAX) return ctx.reply(`❌ Summa juda katta (kassa operatsiyasi ${esc(money(KASSA_MAX))} dan oshmaydi) — tekshirib qayta yozing.` + T.dialogHint);
          ctx.dialog.update({ step: 'purpose', data: { amount } });
          return ctx.reply(lines(line('Summa', money(amount)), '', '✍️ Maqsad (izoh) ni yozing:') + T.dialogHint);
        }
        if (st.step === 'purpose') {
          const purpose = ctx.text.trim();
          if (purpose.length < 3) return ctx.reply('Maqsad kamida 3 belgi bo‘lsin.' + T.dialogHint);
          ctx.dialog.update({ step: 'link', data: { purpose: purpose.slice(0, 300) } });
          if (d.direction === 'INCOME') {
            return ctx.reply(lines('📄 Qaysi shartnoma bo‘yicha to‘lov? Shartnoma raqamini (<code>UTAX-R-00001</code>) yoki mijoz nomini yozing.', muted('Shartnomaga bog‘lansa — to‘lov jadvali va mijoz avansi yangilanadi.')) + T.dialogHint, { buttons: [[{ text: '⏭ Shartnomasiz kirim', cb: 'b.ks:skip' }]] });
          }
          const x = xarajatTanlash(ctx, tasdiqlanganXarajatlar(ctx));
          return ctx.reply(x.html, { buttons: x.buttons });
        }
        if (st.step === 'link') {
          if (d.direction === 'INCOME') {
            const rows = shartnomaQidir(ctx.S, ctx.text, { faqatQarzli: true });
            if (!rows.length) return ctx.reply(`🔍 «${esc(clip(ctx.text, 40))}» bo‘yicha qarzi bor shartnoma topilmadi. Qayta yozing yoki ⏭.`, { buttons: [[{ text: '⏭ Shartnomasiz kirim', cb: 'b.ks:skip' }]] });
            if (rows.length === 1) {
              ctx.dialog.update({ step: 'confirm', data: { contract_id: rows[0].id, counterparty: rows[0].company_name } });
              const k = tasdiqKartasi(ctx, ctx.dialog.get().data);
              return ctx.reply(k.html, { buttons: k.buttons });
            }
            return ctx.reply('Qaysi shartnoma?', { buttons: [...rows.slice(0, 8).map((c) => [{ text: `📄 ${c.contract_number} · ${clip(c.company_name, 18)} · ${fmt(c.remaining)}`, cb: `b.ks:ct:${c.id}` }]), [{ text: '⏭ Shartnomasiz kirim', cb: 'b.ks:skip' }]] });
          }
          const rows = tasdiqlanganXarajatlar(ctx, ctx.text.trim());
          if (!rows.length) return ctx.reply(`🔍 «${esc(clip(ctx.text, 40))}» bo‘yicha tasdiqlangan xarajat topilmadi.`, { buttons: [[{ text: '⏭ Xarajatsiz', cb: 'b.ks:skip' }]] });
          const x = xarajatTanlash(ctx, rows);
          return ctx.reply(x.html, { buttons: x.buttons });
        }
        if (st.step === 'confirm') return ctx.reply('Tugma orqali tasdiqlang (✅ Saqlash) yoki /bekor.');
        return ctx.reply('Tugmalardan birini tanlang yoki /bekor.');
      },
    },
  },
};

