/**
 * /oylik [oy] — oylik vedomosti (web: KPI va oylik): xulosa, bo'limlar, tasdiq zanjiri;
 * 🧮 Hisoblash (payroll CREATE) · 📤 Tasdiqqa yuborish (payroll CREATE) · 💸 To'landi (payroll EDIT).
 */
import { today, monthOf, addMonths } from '../../../core/util.mjs';
import { esc } from '../../shared/html.mjs';
import { money, date, lines, line, title, muted, status, stepLabel, monthLabel, statusLabel } from '../../shared/format.mjs';
import { T } from '../../shared/texts.mjs';
import { oyArg, oyNav, oyTekshir } from './umumiy.mjs';

/** Standart davr: oxirgi hisoblangan oy, bo'lmasa o'tgan oy */
function standartDavr(db) {
  return db.get('SELECT period FROM payrolls ORDER BY period DESC LIMIT 1')?.period || addMonths(monthOf(today()), -1);
}

function oylikKartasi(ctx, period, { tasdiq } = {}) {
  const s = ctx.S.payroll.summary(period);
  const a = s.approval;
  const zanjir = a ? (a.steps || []).map((x, i) => `${x.status === 'APPROVED' ? '✅' : x.status === 'REJECTED' ? '❌' : i === a.current_step && ['PENDING', 'POSTPONED'].includes(a.status) ? '👉' : '▫️'} ${esc(stepLabel(x.role))}${x.user_name ? ` — ${esc(x.user_name)}` : ''}`) : [];
  const html = lines(
    title('💼', `Oylik — ${monthLabel(period)}`),
    `Holat: ${status(s.status)}`,
    s.rows ? line('Xodimlar', `${s.rows} ta`) : muted('Bu oy uchun oylik hali hisoblanmagan.'),
    s.rows ? line('Hisoblangan (gross)', money(s.gross)) : null,
    s.rows ? line('KPI ustamasi', money(s.kpi)) : null,
    s.rows ? line('Qo‘lga (net)', money(s.net)) : null,
    s.by_department?.length ? '\n<b>Bo‘limlar:</b>' : null,
    ...(s.by_department || []).map((d) => `• ${esc(d.department)}: <b>${esc(money(d.net))}</b> · ${esc(d.n)} kishi`),
    zanjir.length ? `\n<b>Tasdiqlash zanjiri</b> (${esc(statusLabel(a.status))}):` : null,
    ...zanjir,
    tasdiq === 's' ? `\n📤 ${esc(monthLabel(period))} oyligi (${esc(money(s.net))}) tasdiqqa yuborilsinmi?` : null,
    tasdiq === 'p' ? `\n💸 ${esc(monthLabel(period))} oyligi <b>to‘landi</b> deb belgilansinmi? (${esc(date(today()))})` : null,
  );
  const buttons = [];
  if (tasdiq) buttons.push([{ text: '✅ Ha', cb: `b.pr:${tasdiq}y:${period}` }, { text: '◀️ Orqaga', cb: `b.pr:v:${period}` }]);
  else {
    const amal = [];
    if (['EMPTY', 'DRAFT'].includes(s.status) && ctx.can('payroll', 'CREATE')) amal.push({ text: s.rows ? '🧮 Qayta hisoblash' : '🧮 Hisoblash', cb: `b.pr:c:${period}` });
    if (s.status === 'DRAFT' && s.rows && ctx.can('payroll', 'CREATE')) amal.push({ text: '📤 Tasdiqqa yuborish', cb: `b.pr:s:${period}` });
    if (s.status === 'APPROVED' && ctx.can('payroll', 'EDIT')) amal.push({ text: '💸 To‘landi', cb: `b.pr:p:${period}` });
    if (amal.length) buttons.push(amal);
    buttons.push(oyNav('b.pr:v', period));
    buttons.push([{ text: '🌐 KPI va oylik', web: 'payroll' }]);
  }
  return { html, buttons, summary: s };
}

export default {
  commands: [
    {
      name: 'oylik', desc: 'Oylik vedomosti: hisoblash, tasdiqqa yuborish, to‘lash', button: '💼 Oylik', usage: '/oylik [oy]', perm: ['payroll', 'VIEW'],
      run(ctx) {
        const period = oyArg(ctx.args, standartDavr(ctx.db));
        const k = oylikKartasi(ctx, period);
        return ctx.reply(k.html, { buttons: k.buttons });
      },
    },
  ],
  callbacks: {
    'b.pr': {
      perm: ['payroll', 'VIEW'],
      async run(ctx) {
        const [amal, period] = ctx.cbArgs;
        if (!oyTekshir(period)) return ctx.answer(T.expired, true);
        const joriy = ctx.S.payroll.summary(period);
        let xabar;
        if (amal === 'c') {
          ctx.need('payroll', 'CREATE');
          if (!['EMPTY', 'DRAFT'].includes(joriy.status)) return ctx.answer(`Davr allaqachon: ${statusLabel(joriy.status)}`, true);
          const rows = ctx.S.payroll.compute(period, ctx.actor);
          xabar = `🧮 Hisoblandi: ${rows.length} xodim`;
        } else if (amal === 's' || amal === 'p') {
          ctx.need('payroll', amal === 's' ? 'CREATE' : 'EDIT');
          if (amal === 's' && joriy.status !== 'DRAFT') return ctx.answer(`Yuborib bo‘lmaydi: ${statusLabel(joriy.status)}`, true);
          if (amal === 'p' && joriy.status !== 'APPROVED') return ctx.answer(`To‘lab bo‘lmaydi: ${statusLabel(joriy.status)}`, true);
          const k = oylikKartasi(ctx, period, { tasdiq: amal });
          await ctx.answer();
          return ctx.edit(k.html, { buttons: k.buttons });
        } else if (amal === 'sy') {
          ctx.need('payroll', 'CREATE');
          if (joriy.status !== 'DRAFT') return ctx.answer(`Yuborib bo‘lmaydi: ${statusLabel(joriy.status)}`, true);
          ctx.S.payroll.submit(period, ctx.actor);
          xabar = '📤 Tasdiqqa yuborildi';
        } else if (amal === 'py') {
          ctx.need('payroll', 'EDIT');
          if (joriy.status !== 'APPROVED') return ctx.answer(`To‘lab bo‘lmaydi: ${statusLabel(joriy.status)}`, true);
          ctx.S.payroll.markPaid(period, today(), ctx.actor);
          xabar = '💸 To‘landi deb belgilandi';
        } else if (amal !== 'v') return ctx.answer(T.expired, true);
        const k = oylikKartasi(ctx, period);
        await ctx.answer(xabar);
        return ctx.edit(k.html, { buttons: k.buttons });
      },
    },
  },
};
