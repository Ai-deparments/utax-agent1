/**
 * /boglash — bog'lanmagan va taklif qilingan bank tranzaksiyalarini birma-bir ko'rib chiqish (web: Tushumlar → tranzaksiya kartasi):
 *   kirim → shartnoma nomzodlari (reconciliation.confirm), chiqim → xarajat nomzodlari (confirmExpense), 🚫 e'tiborsiz (ignore).
 * /tushumlar — oxirgi kirimlar.
 */
import { esc } from '../../shared/html.mjs';
import { money, date, lines, line, title, muted, clip, fmt, pct, status, statusIcon } from '../../shared/format.mjs';
import { yonalish, sabablar, imzoliSumma } from './umumiy.mjs';

const SABAB_KIRIM = [['NON_CONTRACT', 'Shartnomasiz kirim'], ['LOAN', 'Kredit / ta’sischi mablag‘i'], ['REFUND', 'Qaytarilgan mablag‘'], ['INTEREST', 'Bank foizlari'], ['OTHER_INCOME', 'Boshqa kirim']];
const SABAB_CHIQIM = [['NON_CONTRACT', 'So‘rovsiz chiqim'], ['LOAN', 'Kredit to‘lovi'], ['REFUND', 'Mijozga qaytarish'], ['PAYROLL', 'Oylik'], ['OTHER', 'Boshqa chiqim']];
const PUL_OQIMI = { LOAN: 'FINANCING' };
const sababRoyxati = (direction) => (direction === 'INCOME' ? SABAB_KIRIM : SABAB_CHIQIM);

const navbat = (S) => S.banking.listTransactions({ statuses: ['SUGGESTED', 'UNMATCHED'] });
const txOl = (db, id) => db.get('SELECT * FROM bank_transactions WHERE id=?', Number(id));

function karta(ctx, t, off, jami) {
  const { candidates = [] } = ctx.S.reconciliation.suggest(t.id);
  const kirim = t.direction === 'INCOME';
  const html = lines(
    `🔗 <b>Bog‘lash</b> · ${off + 1}/${jami}`,
    `${yonalish(t.direction)} · ${esc(date(t.tx_date))} · ${esc(t.bank_name || '')}`,
    line('Summa', money(t.amount)),
    t.counterparty_name ? line('Kontragent', t.counterparty_name) : null,
    t.counterparty_inn ? line('INN', t.counterparty_inn) : null,
    t.purpose ? `Maqsad: <i>${esc(clip(t.purpose, 160))}</i>` : null,
    `Holat: ${status(t.matching_status)}${t.confidence ? ` · ${esc(t.confidence)}%` : ''}`,
    '',
    candidates.length ? `<b>${kirim ? 'Shartnoma' : 'Xarajat'} nomzodlari:</b>` : muted(kirim ? 'Mos shartnoma topilmadi — e’tiborsiz qoldiring yoki web’da qo‘lda tanlang.' : 'Mos xarajat so‘rovi topilmadi.'),
    ...candidates.map((c, i) => (kirim
      ? `${i + 1}. <b>${esc(c.contract_number)}</b> · ${esc(c.company_name)} — qoldiq ${esc(money(c.remaining))} · <b>${esc(c.score)}%</b>\n     <i>${esc(sabablar(c.reasons))}</i>`
      : `${i + 1}. <b>${esc(c.code)}</b> · ${esc(clip(c.purpose, 50))} — ${esc(money(c.amount))} · <b>${esc(c.score)}%</b>${c.status === 'PAID' ? ' · <i>bankdan to‘landi deb belgilangan</i>' : ''}\n     <i>${esc(sabablar(c.reasons))}</i>`)),
  );
  const buttons = [];
  if (ctx.can('reconciliation', 'APPROVE')) {
    for (const c of candidates.slice(0, 4)) {
      buttons.push([kirim
        ? { text: `✅ ${c.contract_number} · ${clip(c.company_name, 16)} (${c.score}%)`, cb: `b.rc:m:${t.id}:${c.contract_id}:${off}` }
        : { text: `✅ ${c.code} · ${fmt(c.amount)} (${c.score}%)`, cb: `b.rc:e:${t.id}:${c.expense_id}:${off}` }]);
    }
  }
  const row = [];
  if (ctx.can('reconciliation', 'EDIT')) row.push({ text: '🚫 E’tiborsiz', cb: `b.rc:i:${t.id}:${off}` });
  if (jami > 1) row.push({ text: '⏭ Keyingi', cb: `b.rc:n:${(off + 1) % jami}` });
  buttons.push(row);
  buttons.push([{ text: '🌐 Tushumlar', web: 'transactions' }]);
  return { html, buttons };
}

/** Navbatdagi kartani ko'rsatish (tahrir — joriy xabar o'rnida) */
async function korsat(ctx, off = 0, { tahrir = false } = {}) {
  const q = navbat(ctx.S);
  if (!q.length) {
    const st = ctx.S.reconciliation.stats();
    const html = lines(title('✅', 'Bog‘lanmagan tranzaksiya qolmadi'), line('Bog‘langan', st.matched || 0), line('E’tiborsiz', st.ignored || 0));
    const opts = { buttons: [[{ text: '🟢 Tushumlar', cmd: 'tushumlar' }, { text: '🌐 Web', web: 'transactions' }]] };
    return tahrir ? ctx.edit(html, opts) : ctx.reply(html, opts);
  }
  const i = Math.min(Math.max(0, Number(off) || 0), q.length - 1);
  const k = karta(ctx, q[i], i, q.length);
  return tahrir ? ctx.edit(k.html, { buttons: k.buttons }) : ctx.reply(k.html, { buttons: k.buttons });
}

/** Tranzaksiya hali ko'rib chiqilmaganmi (MATCHED/IGNORED/reversal bo'lsa — yo'q) */
async function ochiqTx(ctx, id, off) {
  const tx = txOl(ctx.db, id);
  if (!tx || tx.reversed_at) { await ctx.answer('Tranzaksiya topilmadi', true); return null; }
  if (!['UNMATCHED', 'SUGGESTED'].includes(tx.matching_status)) {
    await ctx.answer(`Allaqachon ko‘rib chiqilgan: ${tx.matching_status === 'MATCHED' ? 'bog‘langan' : 'e’tiborsiz'}`, true);
    await korsat(ctx, off, { tahrir: true });
    return null;
  }
  return tx;
}

function tushumlar(ctx, faqatBoglanmagan) {
  const rows = ctx.S.banking.listTransactions({ direction: 'INCOME', ...(faqatBoglanmagan ? { statuses: ['UNMATCHED', 'SUGGESTED'] } : {}), limit: 10 });
  const st = ctx.S.reconciliation.stats();
  const html = lines(
    title('🟢', faqatBoglanmagan ? 'Bog‘lanmagan kirimlar' : 'Oxirgi kirimlar'),
    line('Bog‘lanmagan / taklif', `${(st.unmatched || 0) + (st.suggested || 0)} ta · kirim ${money(st.unmatched_income_amount || 0)}`),
    '',
    rows.length ? rows.map((t) => {
      const obyekt = t.matched_contract_number ? ` → <b>${esc(t.matched_contract_number)}</b>` : t.suggested_contract_number ? ` → ${esc(t.suggested_contract_number)}?` : '';
      return `${statusIcon(t.matching_status)} ${esc(date(t.tx_date))} · <b>${esc(money(t.amount))}</b> · ${esc(clip(t.counterparty_name || t.purpose || '--', 32))}${obyekt}`;
    }).join('\n') : muted(faqatBoglanmagan ? 'Bog‘lanmagan kirim yo‘q ✅' : 'Kirimlar yo‘q.'),
  );
  const buttons = [
    [faqatBoglanmagan ? { text: '📋 Hammasi', cb: 'b.tx:a' } : { text: '🔴 Faqat bog‘lanmagan', cb: 'b.tx:u' }],
    [ctx.can('reconciliation', 'VIEW') ? { text: '🔗 Bog‘lash', cmd: 'boglash' } : null, { text: '🌐 Tushumlar', web: 'transactions' }],
  ];
  return { html, buttons };
}

export default {
  commands: [
    { name: 'boglash', desc: 'Tranzaksiyalarni shartnoma/xarajatga bog‘lash', button: '🔗 Bog‘lash', usage: '/boglash', perm: ['reconciliation', 'VIEW'], run: (ctx) => korsat(ctx, 0) },
    {
      name: 'tushumlar', desc: 'Oxirgi kirimlar', button: '🟢 Tushumlar', usage: '/tushumlar [boglanmagan]', perm: ['transactions', 'VIEW'],
      run(ctx) { const k = tushumlar(ctx, /bog|unm/i.test(ctx.args)); return ctx.reply(k.html, { buttons: k.buttons }); },
    },
  ],
  callbacks: {
    'b.rc': {
      perm: ['reconciliation', 'VIEW'],
      async run(ctx) {
        const [amal, a1, a2, a3] = ctx.cbArgs;
        if (amal === 'n') { await ctx.answer(); return korsat(ctx, a1, { tahrir: true }); }
        if (amal === 'v') { const q = navbat(ctx.S); const i = q.findIndex((t) => t.id === Number(a1)); await ctx.answer(); return korsat(ctx, i >= 0 ? i : a2, { tahrir: true }); }
        if (amal === 'm') {
          ctx.need('reconciliation', 'APPROVE');
          const tx = await ochiqTx(ctx, a1, a3);
          if (!tx) return null;
          if (tx.direction !== 'INCOME') return ctx.answer('Faqat kirim shartnomaga bog‘lanadi', true);
          const c = ctx.S.contracts.get(Number(a2));
          if (!c) return ctx.answer('Shartnoma topilmadi', true);
          ctx.S.reconciliation.confirm(tx.id, c.id, ctx.actor, { reason: 'Telegram orqali tasdiqlandi' });
          const k = ctx.S.contracts.get(c.id);
          await ctx.edit(lines(
            title('✅', 'Bog‘landi'),
            `${esc(date(tx.tx_date))} · ${esc(imzoliSumma(tx.direction, tx.amount))} · ${esc(tx.counterparty_name || '')}`,
            `→ <b>${esc(k.contract_number)}</b> · ${esc(k.company_name)}`,
            line('To‘langan', `${money(k.paid)} (${pct(k.paid_pct, 0)})`),
            line('Qoldiq', money(k.remaining)),
          ), { buttons: [[{ text: '🌐 Shartnoma', web: `contracts/${k.id}` }]] });
          await ctx.answer('✅ Bog‘landi');
          return korsat(ctx, a3);
        }
        if (amal === 'e') {
          ctx.need('reconciliation', 'APPROVE');
          const tx = await ochiqTx(ctx, a1, a3);
          if (!tx) return null;
          if (tx.direction !== 'EXPENSE') return ctx.answer('Faqat chiqim xarajatga bog‘lanadi', true);
          const e = ctx.S.expenses.get(Number(a2));
          if (!e) return ctx.answer('Xarajat topilmadi', true);
          // Karta eskirgan bo'lishi mumkin: shu orada xarajat kassadan to'langan / boshqa chiqimga bog'langan / bekor qilingan bo'lsa — bog'lanmaydi,
          // karta yangi nomzodlar bilan qayta chiziladi (qoida servisda: reconciliation.expenseLinkBlockReason, confirmExpense ham shuni tekshiradi)
          const sabab = ctx.S.reconciliation.expenseLinkBlockReason(e, tx);
          if (sabab) {
            await ctx.answer(sabab, true);
            return korsat(ctx, a3, { tahrir: true });
          }
          ctx.S.reconciliation.confirmExpense(tx.id, e.id, ctx.actor);
          await ctx.edit(lines(title('✅', 'Xarajatga bog‘landi'), `${esc(date(tx.tx_date))} · ${esc(imzoliSumma(tx.direction, tx.amount))} · ${esc(tx.counterparty_name || '')}`, `→ <b>${esc(e.code)}</b> · ${esc(clip(e.purpose, 80))}`, line('Xarajat holati', 'To‘langan')), { buttons: [[{ text: '🌐 Xarajat', web: `expenses/${e.id}` }]] });
          await ctx.answer('✅ Bog‘landi');
          return korsat(ctx, a3);
        }
        if (amal === 'i') {
          ctx.need('reconciliation', 'EDIT');
          const tx = await ochiqTx(ctx, a1, a2);
          if (!tx) return null;
          await ctx.answer();
          return ctx.setButtons([...sababRoyxati(tx.direction).map(([kod, nom]) => [{ text: `🚫 ${nom}`, cb: `b.rc:ig:${tx.id}:${kod}:${a2 || 0}` }]), [{ text: '◀️ Orqaga', cb: `b.rc:v:${tx.id}:${a2 || 0}` }]]);
        }
        if (amal === 'ig') {
          ctx.need('reconciliation', 'EDIT');
          const tx = await ochiqTx(ctx, a1, a3);
          if (!tx) return null;
          const sabab = sababRoyxati(tx.direction).find(([kod]) => kod === a2);
          if (!sabab) return ctx.answer('Noma’lum sabab', true);
          ctx.S.reconciliation.ignore(tx.id, ctx.actor, sabab[0], PUL_OQIMI[sabab[0]] || 'OPERATING');
          await ctx.edit(lines(title('🚫', 'E’tiborsiz qoldirildi'), `${esc(date(tx.tx_date))} · ${esc(imzoliSumma(tx.direction, tx.amount))} · ${esc(tx.counterparty_name || '')}`, line('Sabab', sabab[1]), PUL_OQIMI[sabab[0]] ? line('Pul oqimi', 'Moliyaviy faoliyat') : null));
          await ctx.answer('🚫 Belgilandi');
          return korsat(ctx, a3);
        }
        return ctx.answer('Eskirgan tugma', true);
      },
    },
    'b.tx': {
      perm: ['transactions', 'VIEW'],
      async run(ctx) {
        const k = tushumlar(ctx, ctx.cbArgs[0] === 'u');
        await ctx.answer();
        return ctx.edit(k.html, { buttons: k.buttons });
      },
    },
  },
};
