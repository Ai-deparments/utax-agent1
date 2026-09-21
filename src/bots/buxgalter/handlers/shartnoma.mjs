/**
 * /shartnoma <raqam|mijoz> — shartnoma kartasi (web: Shartnomalar → karta), xizmatni yakunlash (contracts EDIT).
 * /akt — qabul aktini yuklash → contracts.addDocument(ACT) → daromad tan olish qoidasi ishga tushadi.
 * /daromad — joriy oy daromadi va tasdiq kutayotgan tan olishlar (web: Foyda va zarar, Tasdiqlashlar).
 */
import { today, monthOf, monthRange } from '../../../core/util.mjs';
import { esc } from '../../shared/html.mjs';
import { money, date, lines, line, title, muted, clip, pct, status, statusIcon, statusLabel, monthLabel } from '../../shared/format.mjs';
import { BotError } from '../../shared/errors.mjs';
import { T } from '../../shared/texts.mjs';
import { approvalCard } from '../../shared/approvals-ui.mjs';
import { shartnomaQidir, chiziq } from './umumiy.mjs';

const DA = 'b.akt';
const DQ = 'b.ctq';
const JADVAL = { ADVANCE: 'Avans', FINAL: 'Yakuniy', INSTALLMENT: 'Bo‘lib to‘lash', REMAINDER: 'Qoldiq' };
const QOIDA = { ON_COMPLETION: 'xizmat yakunlanganda', ON_ACCEPTANCE: 'akt qabul qilinganda', STRAIGHT_LINE: 'oyma-oy (obuna)', ON_PAYMENT: 'to‘lov kelganda', MILESTONE: 'bosqichlar bo‘yicha' };

function kartaHtml(d) {
  const aktlar = (d.documents || []).filter((x) => x.doc_type === 'ACT');
  return lines(
    `📄 <b>${esc(d.contract_number)}</b> · ${esc(d.company_name)}`,
    line('Xizmat', d.service_name),
    d.title ? line('Mavzu', clip(d.title, 80)) : null,
    line('Summa', money(d.amount)),
    `To‘langan: <b>${esc(money(d.paid))}</b>  ${esc(chiziq(d.paid_pct))}`,
    line('Qoldiq', money(d.remaining)),
    `Holat: ${status(d.contract_status)} · Xizmat: ${status(d.service_status)}`,
    d.next_due_date ? line('Keyingi muddat', `${date(d.next_due_date)}${d.overdue_days > 0 ? ` (${d.overdue_days} kun o‘tdi)` : ''}`) : null,
    line('Tan olingan daromad', money(d.recognized)),
    line('Mijoz avansi qoldig‘i', money(d.advance_balance)),
    d.manager_name ? line('Menejer', d.manager_name) : null,
    d.recognition_rule?.method ? muted(`Daromad qoidasi: ${QOIDA[d.recognition_rule.method] || d.recognition_rule.method}${d.recognition_rule.require_acceptance_document ? ', akt talab qilinadi' : ''}`) : null,
    d.schedules?.length ? '\n<b>To‘lov jadvali:</b>' : null,
    ...(d.schedules || []).map((s) => `${statusIcon(s.status)} ${esc(JADVAL[s.kind] || s.kind)} · ${esc(date(s.due_date))} · ${esc(money(s.amount))} — ${esc(statusLabel(s.status))}`),
    '',
    aktlar.length ? `📎 Qabul akti: <b>bor</b> (${aktlar.length})` : d.recognition_rule?.require_acceptance_document ? '📎 Qabul akti: <b>yo‘q</b> ⚠️' : `📎 Hujjatlar: ${esc(d.documents_count || 0)}`,
  );
}

function kartaTugmalar(ctx, d) {
  const rows = [];
  if (ctx.can('contracts', 'EDIT')) {
    const row = [];
    if (!['COMPLETED', 'CANCELLED'].includes(d.service_status) && !['CANCELLED', 'CLOSED', 'DRAFT'].includes(d.contract_status)) row.push({ text: '✅ Xizmat yakunlandi', cb: `b.ct:dn:${d.id}` });
    row.push({ text: '📎 Akt yuklash', cb: `b.ct:ak:${d.id}` });
    rows.push(row);
  }
  rows.push([{ text: '🌐 Web’da ochish', web: `contracts/${d.id}` }]);
  return rows;
}

async function kartaKorsat(ctx, id, { tahrir = false } = {}) {
  const d = ctx.S.contracts.detail(Number(id));
  if (!d) throw new BotError('Shartnoma topilmadi.');
  const opts = { buttons: kartaTugmalar(ctx, d) };
  return tahrir ? ctx.edit(kartaHtml(d), opts) : ctx.reply(kartaHtml(d), opts);
}

/** Qidiruv natijasi: 0 → topilmadi, 1 → karta, ko'p → tanlash */
async function qidiruvNatija(ctx, q, cbPrefix = 'b.ct:v') {
  const rows = shartnomaQidir(ctx.S, q);
  if (!rows.length) return ctx.reply(`🔍 «${esc(clip(q, 40))}» bo‘yicha shartnoma topilmadi. Raqam (<code>UTAX-R-00001</code>), mijoz nomi yoki INN yozing.`);
  if (rows.length === 1 && cbPrefix === 'b.ct:v') return kartaKorsat(ctx, rows[0].id);
  return ctx.reply(lines(`🔍 «${esc(clip(q, 40))}» — ${rows.length} ta shartnoma:`, rows.length > 10 ? muted('Birinchi 10 tasi — aniqroq yozing.') : null), {
    buttons: rows.slice(0, 10).map((c) => [{ text: `${statusIcon(c.contract_status)} ${c.contract_number} · ${clip(c.company_name, 18)} · ${pct(c.paid_pct, 0)}`, cb: `${cbPrefix}:${c.id}` }]),
  });
}

/** setServiceStatus natijasi → matn */
function yakunlashNatija(c, rec) {
  if (!rec) return muted(`Daromad qoidasi bo‘yicha (${c.service_code}) yakunlash alohida tan olish yaratmaydi.`);
  if (rec.status === 'BLOCKED') return '⚠️ <b>Qabul akti yo‘q</b> — daromad tan olinmadi. Aktni yuklang: tan olish avtomatik bajariladi.';
  if (rec.status === 'ALREADY_RECOGNIZED') return muted('Daromad avval to‘liq tan olingan.');
  if (rec.status === 'PENDING_APPROVAL') return `⏳ Daromad tan olish <b>${esc(money(rec.amount))}</b> — Moliya direktori tasdig‘ini kutmoqda.`;
  if (rec.status === 'RECOGNIZED') return `✅ Daromad tan olindi: <b>${esc(money(rec.amount))}</b>`;
  return muted(`Tan olish holati: ${statusLabel(rec.status)}`);
}

function aktSorovi(c) {
  return lines(title('📎', `Qabul akti: ${c.contract_number}`), `${esc(c.company_name)} · ${esc(money(c.amount))}`, '', 'Akt faylini yuboring: <b>PDF</b> yoki <b>rasm</b> (≤ 10 MB).') + T.dialogHint;
}

async function aktBoshla(ctx, id, { tahrir = false } = {}) {
  ctx.need('contracts', 'EDIT');
  const c = ctx.S.contracts.get(Number(id));
  if (!c) throw new BotError('Shartnoma topilmadi.');
  ctx.dialog.start(DA, { contract_id: c.id }, 'file');
  return tahrir ? ctx.edit(aktSorovi(c)) : ctx.reply(aktSorovi(c));
}

export default {
  commands: [
    {
      name: 'shartnoma', desc: 'Shartnoma kartasi: to‘lov, qoldiq, jadval, akt', button: '📄 Shartnoma', usage: '/shartnoma <raqam yoki mijoz>', perm: ['contracts', 'VIEW'],
      run(ctx) {
        if (ctx.args) return qidiruvNatija(ctx, ctx.args);
        ctx.dialog.start(DQ, {}, 'search');
        return ctx.reply('📄 Shartnoma raqami (<code>UTAX-R-00001</code>), mijoz nomi yoki INN ni yozing:' + T.dialogHint);
      },
    },
    {
      name: 'akt', desc: 'Qabul aktini yuklash — daromad tan olish', button: '📎 Akt', usage: '/akt [shartnoma]', perm: ['contracts', 'EDIT'],
      async run(ctx) {
        if (ctx.args) {
          const rows = shartnomaQidir(ctx.S, ctx.args);
          if (rows.length === 1) return aktBoshla(ctx, rows[0].id);
          ctx.dialog.start(DA, {}, 'search');
          return qidiruvNatija(ctx, ctx.args, 'b.ak:c');
        }
        ctx.dialog.start(DA, {}, 'search');
        const dq = ctx.S.reports.dataQuality().issues.find((x) => x.code === 'COMPLETED_NO_ACT');
        return ctx.reply(lines(title('📎', 'Qabul akti'), '', 'Shartnoma raqami yoki mijoz nomini yozing.', dq ? `\n⚠️ Xizmat yakunlangan, lekin akti yo‘q: <b>${dq.count}</b> ta — tanlang:` : null) + T.dialogHint, {
          buttons: dq ? dq.items.slice(0, 8).map((x) => [{ text: `📎 ${x.label}`, cb: `b.ak:c:${x.id}` }]) : undefined,
        });
      },
    },
    {
      name: 'daromad', desc: 'Oy daromadi, avanslar, tasdiq kutayotgan tan olishlar', button: '📈 Daromad', usage: '/daromad', perm: ['revenue', 'VIEW'],
      async run(ctx) {
        const oy = monthOf(today());
        const { from, to } = monthRange(oy);
        const qator = ctx.S.revenue.monthlySeries(1)[0] || {};
        const kutmoqda = ctx.S.revenue.listRecognitions({ status: 'PENDING_APPROVAL' });
        const aktsiz = ctx.S.reports.dataQuality().issues.find((x) => x.code === 'COMPLETED_NO_ACT');
        await ctx.reply(lines(
          title('📈', `Daromad — ${monthLabel(oy)}`),
          line('Tan olingan daromad', money(ctx.S.revenue.recognizedInPeriod(from, to))),
          line('Kelib tushgan pul', money(qator.cash_received || 0)),
          line('Jadval bo‘yicha kutilgan', money(qator.expected || 0)),
          line('Mijoz avanslari (hali daromad emas)', money(ctx.S.revenue.advancesBalance())),
          line('Kelgusi daromad (shartnomalar qoldig‘i)', money(ctx.S.revenue.expectedRevenue())),
          '',
          line('⏳ Tasdiq kutayotgan tan olish', `${kutmoqda.length} ta · ${money(kutmoqda.reduce((s, r) => s + r.amount, 0))}`),
          aktsiz ? `📎 Akt yo‘q sabab tan olinmagan: <b>${aktsiz.count}</b> ta (${esc(aktsiz.items.slice(0, 3).map((x) => x.label).join(', '))})` : null,
          muted('Bankdagi pul ≠ daromad: avans xizmat bajarilib akt yopilgach tan olinadi.'),
        ), { buttons: [[aktsiz && ctx.can('contracts', 'EDIT') ? { text: '📎 Akt yuklash', cmd: 'akt' } : null, { text: '🌐 Foyda va zarar', web: 'pnl' }]] });
        for (const r of kutmoqda.slice(0, 5)) {
          const a = r.approval_id ? ctx.S.approvals.getFor(r.approval_id, ctx.user) : null;
          if (!a) continue;
          const k = approvalCard(ctx.S, a);
          await ctx.reply(k.html, { buttons: k.buttons });
        }
        return null;
      },
    },
  ],
  callbacks: {
    'b.ct': {
      perm: ['contracts', 'VIEW'],
      async run(ctx) {
        const [amal, id] = ctx.cbArgs;
        if (amal === 'v') { await ctx.answer(); return kartaKorsat(ctx, id, { tahrir: true }); }
        if (amal === 'ak') { await ctx.answer(); return aktBoshla(ctx, id); }
        if (amal === 'dn' || amal === 'dy') {
          ctx.need('contracts', 'EDIT');
          const c = ctx.S.contracts.get(Number(id));
          if (!c) return ctx.answer('Shartnoma topilmadi', true);
          if (c.service_status === 'COMPLETED') { await ctx.answer('Xizmat allaqachon yakunlangan', true); return kartaKorsat(ctx, c.id, { tahrir: true }); }
          if (amal === 'dn') {
            await ctx.answer();
            return ctx.edit(lines(`📄 <b>${esc(c.contract_number)}</b> · ${esc(c.company_name)}`, '', '✅ Xizmat <b>yakunlandi</b> deb belgilansinmi?', muted('Akt bo‘lsa (yoki talab qilinmasa) daromad qoidaga ko‘ra tan olinadi.')), { buttons: [[{ text: '✅ Ha, yakunlandi', cb: `b.ct:dy:${c.id}` }, { text: '◀️ Orqaga', cb: `b.ct:v:${c.id}` }]] });
          }
          const res = ctx.S.contracts.setServiceStatus(c.id, 'COMPLETED', ctx.actor);
          await ctx.answer('✅ Xizmat yakunlandi');
          const d = ctx.S.contracts.detail(c.id);
          return ctx.edit(lines(kartaHtml(d), '', yakunlashNatija(c, res.recognition)), { buttons: kartaTugmalar(ctx, d) });
        }
        return ctx.answer(T.expired, true);
      },
    },
    'b.ak': {
      perm: ['contracts', 'EDIT'],
      async run(ctx) {
        const [amal, id] = ctx.cbArgs;
        if (amal !== 'c') return ctx.answer(T.expired, true);
        await ctx.answer();
        return aktBoshla(ctx, id, { tahrir: true });
      },
    },
  },
  dialogs: {
    [DQ]: {
      async onText(ctx) {
        if (shartnomaQidir(ctx.S, ctx.text).length) ctx.dialog.clear(); // topilmasa — qayta yozish mumkin
        return qidiruvNatija(ctx, ctx.text);
      },
    },
    [DA]: {
      async onText(ctx, st) {
        if (st.step === 'file') return ctx.reply('📎 Akt faylini yuboring (PDF yoki rasm).' + T.dialogHint);
        const rows = shartnomaQidir(ctx.S, ctx.text);
        if (rows.length === 1) return aktBoshla(ctx, rows[0].id);
        return qidiruvNatija(ctx, ctx.text, 'b.ak:c');
      },
      async onFile(ctx, st) {
        if (st.step !== 'file' || !st.data.contract_id) return ctx.reply('Avval shartnomani tanlang: raqam yoki mijoz nomini yozing.' + T.dialogHint);
        ctx.need('contracts', 'EDIT');
        const nom = ctx.file.file_name || 'akt';
        if (ctx.file.kind !== 'photo' && !/\.(pdf|jpe?g|png|heic|webp|docx?)$/i.test(nom) && !/pdf|image|word/i.test(ctx.file.mime_type || '')) throw new BotError('❌ Akt uchun PDF, rasm yoki Word fayl yuboring.');
        const oldin = ctx.S.contracts.get(st.data.contract_id);
        if (!oldin) throw new BotError('Shartnoma topilmadi.');
        const kutganlar = new Set(ctx.S.revenue.listRecognitions({ status: 'PENDING_APPROVAL' }).filter((r) => r.contract_id === oldin.id).map((r) => r.id));
        await ctx.typing();
        const buf = await ctx.download();
        const yol = ctx.saveFile(buf, `contracts/${oldin.id}`, nom);
        ctx.S.contracts.addDocument(oldin.id, { doc_type: 'ACT', name: nom, file_path: yol }, ctx.actor);
        ctx.dialog.clear();
        const keyin = ctx.S.contracts.get(oldin.id);
        const yangiKutgan = ctx.S.revenue.listRecognitions({ status: 'PENDING_APPROVAL' }).find((r) => r.contract_id === oldin.id && !kutganlar.has(r.id));
        const tanolindi = Math.round((keyin.recognized - oldin.recognized) * 100) / 100;
        const natija = tanolindi > 0.005 ? `✅ Daromad tan olindi: <b>${esc(money(tanolindi))}</b>`
          : yangiKutgan ? `⏳ Daromad tan olish <b>${esc(money(yangiKutgan.amount))}</b> — Moliya direktori tasdig‘ini kutmoqda.`
            : keyin.service_status !== 'COMPLETED' ? 'ℹ️ Xizmat hali yakunlanmagan — yakunlanganda daromad avtomatik tan olinadi.'
              : muted('Akt biriktirildi (tan olinadigan qoldiq yo‘q).');
        const buttons = [];
        if (keyin.service_status !== 'COMPLETED' && ctx.can('contracts', 'EDIT')) buttons.push([{ text: '✅ Xizmat yakunlandi', cb: `b.ct:dn:${keyin.id}` }]);
        buttons.push([{ text: '🌐 Shartnoma', web: `contracts/${keyin.id}` }]);
        return ctx.reply(lines(title('📎', `Akt biriktirildi: ${keyin.contract_number}`), `${esc(keyin.company_name)} · ${esc(nom)}`, '', natija, line('Tan olingan jami', money(keyin.recognized))), { buttons });
      },
    },
  },
};
