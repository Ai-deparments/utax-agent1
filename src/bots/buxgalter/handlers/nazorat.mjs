/**
 * Nazorat buyruqlari: /byudjet (web: Reja / Fakt → byudjet), /integratsiyalar (web: Integratsiyalar), /sifat (ma'lumot sifati), /tasdiqlash.
 */
import { esc } from '../../shared/html.mjs';
import { money, dt, lines, line, title, muted, clip, pct, monthLabel, SEVERITY_ICON } from '../../shared/format.mjs';
import { T } from '../../shared/texts.mjs';
import { showApprovals } from '../../shared/approvals-ui.mjs';
import { oyArg, oyNav, oyTekshir, chiziq } from './umumiy.mjs';

/** Web integratsiyalar sahifasida «Sinxronlash» tugmasi faqat shu turlarda */
const SINXRON = ['BANK_API', 'GOOGLE_SHEETS', 'ONE_C', 'ERP'];

function byudjetHtml(ctx, period) {
  const rows = ctx.S.budget.budgets(period);
  const pf = ctx.S.budget.planFact(period).items.find((x) => (x.key || x.name) === 'Expense');
  const jamiReja = rows.reduce((s, x) => s + x.amount, 0), jamiFakt = rows.reduce((s, x) => s + x.fact, 0);
  const oshgan = rows.filter((x) => x.exceeded);
  return lines(
    title('🎯', `Byudjet — ${monthLabel(period)}`),
    rows.length ? line('Byudjet / fakt', `${money(jamiFakt)} / ${money(jamiReja)}`) : muted('Bu oy uchun bo‘lim byudjetlari kiritilmagan (web → Reja / Fakt).'),
    oshgan.length ? `⚠️ Byudjetdan oshgan: <b>${oshgan.length}</b> ta` : rows.length ? '✅ Byudjetdan oshgan bo‘lim yo‘q' : null,
    '',
    ...rows.map((x) => lines(
      `${x.exceeded ? '⚠️' : x.pct >= 90 ? '🟡' : '🟢'} <b>${esc(x.department_name || 'Umumiy')}${x.category_name ? ` · ${esc(x.category_name)}` : ''}</b>`,
      `    ${esc(money(x.fact))} / ${esc(money(x.amount))}  ${esc(chiziq(x.pct))}`,
    )),
    pf && pf.plan ? `\n${line('Oy xarajat rejasi (plan/fakt)', `${money(pf.fact)} / ${money(pf.plan)} · ${pct(pf.pct)}`)}` : null,
  );
}

function integratsiyalarHtml(ctx) {
  const rows = ctx.S.integrations.list();
  return {
    html: lines(
      title('🔌', 'Integratsiyalar'),
      '',
      rows.length ? rows.map((i) => {
        const xato = /ERROR/i.test(i.last_status || '');
        const icon = !i.is_active ? '⚪' : xato ? '🔴' : i.last_sync_at || /OK|Manual/i.test(i.last_status || '') ? '🟢' : '🟡';
        return lines(
          `${icon} <b>${esc(i.name)}</b> · ${esc(i.adapter?.name || i.type)}${i.is_active ? '' : ' <i>(o‘chiq)</i>'}`,
          `    ${esc(i.last_sync_at ? `oxirgi sinxron: ${dt(i.last_sync_at)}` : 'hali sinxronlanmagan')}${i.last_status ? ` · ${esc(clip(i.last_status, 70))}` : ''}`,
        );
      }).join('\n') : muted('Integratsiyalar ulanmagan.'),
    ),
    buttons: [
      ...(ctx.can('integrations', 'EDIT') ? rows.filter((i) => SINXRON.includes(i.type)).map((i) => [{ text: `🔄 ${clip(i.name, 30)}`, cb: `b.int:${i.id}` }]) : []),
      [{ text: '🌐 Integratsiyalar', web: 'integrations' }],
    ],
  };
}

export default {
  commands: [
    {
      name: 'byudjet', desc: 'Bo‘limlar byudjeti vs fakt', button: '🎯 Byudjet', usage: '/byudjet [oy]', perm: ['planfact', 'VIEW'],
      run(ctx) {
        const period = oyArg(ctx.args);
        return ctx.reply(byudjetHtml(ctx, period), { buttons: [oyNav('b.bj', period), [{ text: '🌐 Reja / Fakt', web: 'planfact' }]] });
      },
    },
    {
      name: 'integratsiyalar', desc: 'Integratsiyalar holati va sinxronlash', button: '🔌 Integratsiyalar', usage: '/integratsiyalar', perm: ['integrations', 'VIEW'],
      run(ctx) { const k = integratsiyalarHtml(ctx); return ctx.reply(k.html, { buttons: k.buttons }); },
    },
    {
      name: 'sifat', desc: 'Ma’lumot sifati muammolari', button: '🩺 Sifat', usage: '/sifat', perm: ['dashboard', 'VIEW'],
      run(ctx) {
        const dq = ctx.S.reports.dataQuality();
        const kodlar = new Set(dq.issues.map((x) => x.code));
        return ctx.reply(lines(
          title('🩺', 'Ma’lumot sifati'),
          dq.total ? line('Jami muammolar', dq.total) : '✅ Ma’lumot sifati muammolari yo‘q.',
          '',
          ...dq.issues.map((x) => lines(
            `${SEVERITY_ICON[x.severity] || '🔵'} <b>${esc(x.title)}</b> — ${esc(x.count)} ta`,
            ...x.items.slice(0, 3).map((it) => `    • ${esc(clip(it.label, 70))}`),
            x.count > 3 ? `    ${muted(`… yana ${x.count - 3} ta`)}` : null,
          )),
        ), {
          buttons: [
            [kodlar.has('TX_UNMATCHED') && ctx.can('reconciliation', 'VIEW') ? { text: '🔗 Bog‘lash', cmd: 'boglash' } : null, kodlar.has('COMPLETED_NO_ACT') && ctx.can('contracts', 'EDIT') ? { text: '📎 Akt yuklash', cmd: 'akt' } : null],
            [{ text: '🌐 Bosh sahifa', web: 'dashboard' }],
          ],
        });
      },
    },
    { name: 'tasdiqlash', desc: 'Tasdiq kutayotgan so‘rovlar', button: '✅ Tasdiqlash', usage: '/tasdiqlash', perm: ['approvals', 'VIEW'], run: (ctx) => showApprovals(ctx) },
  ],
  callbacks: {
    'b.bj': {
      perm: ['planfact', 'VIEW'],
      async run(ctx) {
        const period = ctx.cbArgs[0];
        if (!oyTekshir(period)) return ctx.answer(T.expired, true);
        await ctx.answer();
        return ctx.edit(byudjetHtml(ctx, period), { buttons: [oyNav('b.bj', period), [{ text: '🌐 Reja / Fakt', web: 'planfact' }]] });
      },
    },
    'b.int': {
      perm: ['integrations', 'EDIT'],
      async run(ctx) {
        const i = ctx.S.integrations.get(Number(ctx.cbArgs[0]));
        if (!i) return ctx.answer('Integratsiya topilmadi', true);
        if (!SINXRON.includes(i.type)) return ctx.answer('Bu integratsiya qo‘lda yuklanadi (sinxronlash yo‘q)', true);
        await ctx.answer('🔄 Sinxronlanmoqda…');
        await ctx.typing();
        let natija;
        try {
          const r = await ctx.S.integrations.sync(i, ctx.actor);
          natija = lines(
            title('✅', `${i.name}: sinxronlandi`),
            line('Qatorlar', r.rows ?? 0),
            line('Yangi', r.created ?? 0),
            line('Takroriy', r.duplicates ?? 0),
            r.auto_matched !== undefined ? line('Avtomatik bog‘landi', r.auto_matched) : null,
            r.suggested !== undefined ? line('Taklif (tasdiq kerak)', r.suggested) : null,
          );
        } catch (e) {
          natija = lines(title('❌', `${i.name}: sinxronlash xatosi`), esc(clip(e.message, 300)), muted('Sozlamalarni web → Integratsiyalar bo‘limida tekshiring.'));
        }
        await ctx.reply(natija, { buttons: [[{ text: '🔄 Qayta urinish', cb: `b.int:${i.id}` }, { text: '🌐 Integratsiyalar', web: 'integrations' }]] });
        const k = integratsiyalarHtml(ctx);
        return ctx.edit(k.html, { buttons: k.buttons });
      },
    },
  },
};

