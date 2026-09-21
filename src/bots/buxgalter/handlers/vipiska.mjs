/**
 * /vipiska — bank ko'chirmasini import qilish (web: Tushumlar → Import bilan bir xil):
 * hisob tanlash → CSV/XLSX fayl → banking.normalizeRows → ko'rib chiqish → banking.importRows (+ avtomatik bog'lash).
 */
import { parseCsv, parseXlsx } from '../../../core/export.mjs';
import { sum } from '../../../core/util.mjs';
import { esc } from '../../shared/html.mjs';
import { money, date, lines, line, title, muted, clip, fmt } from '../../shared/format.mjs';
import { BotError } from '../../shared/errors.mjs';
import { T } from '../../shared/texts.mjs';
import { hisobNomi } from './umumiy.mjs';

const D = 'b.vipiska';
const MAX_QATOR = 3000;
const BUZILGAN = String.fromCharCode(0xfffd);

const USTUNLAR = lines(
  'Kutilgan ustunlar (sarlavha qatorida):',
  '• <b>sana</b> (date / дата)',
  '• <b>summa</b> (amount / сумма) <i>yoki</i> <b>debet</b> + <b>kredit</b> (kirim / chiqim)',
  '• <b>kontragent</b> (nomi / name / контрагент)',
  '• <b>inn</b> (stir / инн)',
  '• <b>maqsad</b> (purpose / назначение / izoh)',
);

function hisobOl(S, id) {
  const a = S.banking.bankAccounts().find((x) => x.id === Number(id));
  if (!a) throw new BotError('Bank hisobi topilmadi yoki faol emas.');
  return a;
}

/** Fayl → jadval qatorlari (XLSX yoki CSV; CSV UTF-8 bo'lmasa Windows-1251 sinab ko'riladi) */
function jadvalOqi(buf, name) {
  const nom = String(name || '').toLowerCase();
  if (/\.xls$/.test(nom)) throw new BotError('❌ Eski XLS formati qo‘llab-quvvatlanmaydi. Faylni Excel’da <b>XLSX</b> yoki <b>CSV</b> qilib saqlab yuboring.');
  const zip = buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b;
  if (/\.xlsx$/.test(nom) || zip) {
    try { return parseXlsx(buf); } catch { throw new BotError('❌ XLSX faylni o‘qib bo‘lmadi. Excel’da qayta saqlab yoki CSV qilib yuboring.'); }
  }
  let text = buf.toString('utf8');
  if (text.includes(BUZILGAN)) { try { text = new TextDecoder('windows-1251').decode(buf); } catch { /* utf8 qoladi */ } }
  return parseCsv(text);
}

function korinish(hisob, fayl, rows) {
  const kirim = rows.filter((r) => r.direction === 'INCOME'), chiqim = rows.filter((r) => r.direction === 'EXPENSE');
  const sanalar = rows.map((r) => r.tx_date).sort();
  return lines(
    title('📥', 'Vipiska — ko‘rib chiqish'),
    line('Hisob', hisobNomi(hisob)),
    line('Fayl', fayl),
    line('Qatorlar', `${rows.length} ta`),
    line('Davr', `${date(sanalar[0])} — ${date(sanalar[sanalar.length - 1])}`),
    line('Kirim', `${kirim.length} ta · ${money(sum(kirim, (r) => r.amount))}`),
    line('Chiqim', `${chiqim.length} ta · ${money(sum(chiqim, (r) => r.amount))}`),
    '',
    '<b>Birinchi qatorlar:</b>',
    ...rows.slice(0, 5).map((r) => `${r.direction === 'INCOME' ? '🟢 +' : '🔴 −'}${esc(fmt(r.amount))} · ${esc(date(r.tx_date))} · ${esc(clip(r.counterparty_name || r.purpose || '—', 40))}`),
    rows.length > 5 ? muted(`… yana ${rows.length - 5} ta`) : null,
    '',
    'Import qilinsinmi? Takroriy qatorlar o‘tkazib yuboriladi, kirimlar shartnomalar bilan avtomatik bog‘lanadi.',
  );
}

async function boshla(ctx, hisob, { tahrir = false } = {}) {
  ctx.dialog.start(D, { account_id: hisob.id }, 'file');
  const html = lines(
    title('📥', `Vipiska: ${hisobNomi(hisob)}`),
    '',
    '📎 Bank ko‘chirmasi faylini yuboring: <b>CSV</b> yoki <b>XLSX</b> (≤ 10 MB).',
    '',
    USTUNLAR,
  ) + T.dialogHint;
  return tahrir ? ctx.edit(html) : ctx.reply(html);
}

export default {
  commands: [
    {
      name: 'vipiska', desc: 'Bank vipiskasini import qilish (CSV/XLSX)', button: '📥 Vipiska', usage: '/vipiska', perm: ['transactions', 'CREATE'],
      async run(ctx) {
        const hisoblar = ctx.S.banking.bankAccounts();
        if (!hisoblar.length) throw new BotError('Bank hisobi yo‘q. Web → Pul boshqaruvi bo‘limida hisob qo‘shing.');
        if (hisoblar.length === 1) return boshla(ctx, hisoblar[0]);
        return ctx.reply(lines(title('📥', 'Bank vipiskasi'), '', 'Qaysi hisob ko‘chirmasini yuklaysiz?'), {
          buttons: [...hisoblar.map((a) => [{ text: `🏦 ${hisobNomi(a)}`, cb: `b.vp:acc:${a.id}` }]), [{ text: '🌐 Tushumlar', web: 'transactions' }]],
        });
      },
    },
  ],
  callbacks: {
    'b.vp': {
      perm: ['transactions', 'CREATE'],
      async run(ctx) {
        const [amal, arg] = ctx.cbArgs;
        if (amal === 'acc') { await ctx.answer(); return boshla(ctx, hisobOl(ctx.S, arg), { tahrir: true }); }
        const st = ctx.dialog.get();
        if (amal === 'no') { if (st?.name === D) ctx.dialog.clear(); await ctx.edit(T.cancelled); return ctx.answer('Bekor qilindi'); }
        if (amal === 'ok') {
          if (st?.name !== D || st.step !== 'preview' || !Array.isArray(st.data.rows)) return ctx.answer(T.expired, true);
          ctx.need('transactions', 'CREATE');
          const hisob = hisobOl(ctx.S, st.data.account_id);
          await ctx.answer('⏳ Import qilinmoqda…');
          const r = ctx.S.banking.importRows(hisob.id, st.data.rows, ctx.actor, 'TELEGRAM');
          ctx.dialog.clear();
          const qoldi = (r.suggested || 0) + (r.unmatched || 0);
          await ctx.edit(lines(
            title('✅', `Import yakunlandi — ${hisobNomi(hisob)}`),
            line('Qatorlar', r.rows),
            line('Yangi', r.created),
            line('Takroriy (o‘tkazib yuborildi)', r.duplicates),
            '',
            line('🟢 Avtomatik bog‘landi', r.auto_matched),
            line('🟡 Taklif (tasdiq kerak)', r.suggested),
            line('🔴 Bog‘lanmagan', r.unmatched),
            qoldi ? `\n👉 ${qoldi} ta tranzaksiyani /boglash orqali ko‘rib chiqing.` : '',
          ), { buttons: [qoldi && ctx.can('reconciliation', 'VIEW') ? [{ text: '🔗 Bog‘lash', cmd: 'boglash' }] : null, [{ text: '🟢 Tushumlar', cmd: 'tushumlar' }, { text: '🌐 Web', web: 'transactions' }]] });
          return r;
        }
        return ctx.answer(T.expired, true);
      },
    },
  },
  dialogs: {
    [D]: {
      async onFile(ctx, st) {
        if (st.step !== 'file') return ctx.reply('Fayl allaqachon qabul qilindi — tugma orqali tasdiqlang yoki /bekor.');
        if (ctx.file.kind === 'photo') throw new BotError('📷 Rasm emas — bank ko‘chirmasini <b>CSV</b> yoki <b>XLSX</b> fayl (hujjat) sifatida yuboring.');
        const nom = ctx.file.file_name || 'vipiska';
        if (!/\.(csv|txt|xlsx|xls)$/i.test(nom) && !/csv|spreadsheet|excel|text\/plain/i.test(ctx.file.mime_type || '')) throw new BotError(`❌ «${esc(clip(nom, 60))}» qo‘llab-quvvatlanmaydi. Faqat <b>CSV</b> yoki <b>XLSX</b> fayl yuboring.`);
        await ctx.typing();
        const buf = await ctx.download();
        const jadval = jadvalOqi(buf, nom);
        const rows = ctx.S.banking.normalizeRows(jadval);
        if (!rows.length) {
          const sarlavha = (jadval[0] || []).map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 12);
          return ctx.reply(lines(
            '❌ <b>Ustunlar topilmadi</b> — fayldan birorta ham tranzaksiya o‘qilmadi.',
            sarlavha.length ? `Fayldagi sarlavha: <i>${esc(clip(sarlavha.join(' | '), 300))}</i>` : 'Fayl bo‘sh yoki sarlavha qatori yo‘q.',
            '',
            USTUNLAR,
            '',
            'Faylni tuzatib qayta yuboring yoki /bekor.',
          ));
        }
        if (rows.length > MAX_QATOR) throw new BotError(`Faylda ${rows.length} ta qator — bot orqali ko‘pi bilan ${MAX_QATOR} ta. Katta fayllarni web panel orqali import qiling (Tushumlar → Import).`);
        const hisob = hisobOl(ctx.S, st.data.account_id);
        ctx.dialog.update({ step: 'preview', data: { rows, file_name: nom } });
        return ctx.reply(korinish(hisob, nom, rows), { buttons: [[{ text: '✅ Import qilish', cb: 'b.vp:ok' }, { text: '✖️ Bekor', cb: 'b.vp:no' }]] });
      },
      async onText(ctx, st) {
        if (st.step === 'preview') return ctx.reply('Tugma orqali tasdiqlang (✅ Import qilish) yoki /bekor.');
        return ctx.reply('📎 Vipiska faylini <b>hujjat</b> sifatida yuboring (CSV yoki XLSX).' + T.dialogHint);
      },
    },
  },
};
