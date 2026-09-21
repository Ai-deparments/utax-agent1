/**
 * /yangi — xarajat so'rovi dialogi. Maydonlar web «Xarajatlar → So‘rov» formasi bilan bir xil,
 * yakunda app.services.expenses.request(...) → approval engine (limitlar approval_rules jadvalidan).
 * Qadamlar: summa → maqsad → kategoriya → kerakli sana → to'lov usuli → kontragent → hujjat → tekshirish → yuborish.
 */
import { esc } from '../../shared/html.mjs';
import { money, date, line, lines, clip, parseAmount, parseDate, stepLabel, PAYMENT_METHOD } from '../../shared/format.mjs';
import { btn, chunk } from '../../shared/keyboards.mjs';
import { T } from '../../shared/texts.mjs';
import { today, addDays } from '../../../core/util.mjs';

export const DIALOG = 's.new';
const QADAMLAR = ['amount', 'purpose', 'category', 'date', 'method', 'counterparty', 'receipt'];
const QADAM_NOMI = { amount: 'summa', purpose: 'maqsad', category: 'kategoriya', date: 'kerakli sana', method: 'to‘lov usuli', counterparty: 'kontragent', receipt: 'hujjat', confirm: 'tasdiqlash' };
const raqam = (step) => `${QADAMLAR.indexOf(step) + 1}/${QADAMLAR.length}`;
/** Hujjat sifatida qabul qilinadigan fayllar: rasm, PDF, Word, Excel */
const HUJJAT_MIME = /^(image\/|application\/pdf$|application\/msword$|application\/vnd\.ms-excel$|application\/vnd\.openxmlformats-officedocument\.)/;
const bekor = () => [btn.cb('✖️ Bekor qilish', 'x')];
const SANA_TUGMALAR = () => [[btn.cb('Bugun', 's.date:0'), btn.cb('Ertaga', 's.date:1')], [btn.cb('3 kundan keyin', 's.date:3'), btn.cb('1 haftadan keyin', 's.date:7')], [btn.cb('⏭ Muhim emas', 's.date:skip')]];
const USUL_TUGMALAR = () => [[btn.cb('🏦 Bank o‘tkazmasi', 's.pm:BANK'), btn.cb('💵 Naqd (kassa)', 's.pm:CASH')]];

/** Kategoriya tugmalari: AI taklifi birinchi, keyin barcha faol kategoriyalar (oylik — alohida modul orqali) */
function kategoriyaTugmalari(ctx, data) {
  const cats = ctx.S.expenses.categories().filter((c) => c.code !== 'PAYROLL');
  const rows = [];
  if (data.suggest) rows.push([btn.cb(`✅ ${data.suggest.name} (AI taklifi)`, `s.cat:${data.suggest.id}`)]);
  rows.push(...chunk(cats.filter((c) => c.id !== data.suggest?.id).map((c) => btn.cb(c.name, `s.cat:${c.id}`)), 2));
  rows.push([btn.cb('🤖 AI o‘zi tanlasin', 's.cat:auto')]);
  return rows;
}

function bolimNomi(ctx) {
  return ctx.S.users.get(ctx.user.id)?.department || null;
}

/** Yakuniy tekshirish kartasi */
function xulosa(ctx, d) {
  return lines(
    '📝 <b>Xarajat so‘rovi — tekshiring</b>',
    '',
    line('Summa', money(d.amount)),
    line('Maqsad', clip(d.purpose, 300)),
    line('Kategoriya', d.category_name || 'AI tanlaydi'),
    line('Kerakli sana', d.required_date ? date(d.required_date) : 'ko‘rsatilmagan'),
    line('To‘lov usuli', PAYMENT_METHOD[d.payment_method] || d.payment_method || PAYMENT_METHOD.BANK),
    line('Kontragent', d.counterparty || 'ko‘rsatilmagan'),
    d.receipt_path ? `📎 Hujjat: <b>${esc(clip(d.receipt_name || 'fayl', 60))}</b>` : '📎 Hujjat: biriktirilmagan',
    bolimNomi(ctx) ? line('Bo‘lim', bolimNomi(ctx)) : null,
    '',
    '«✅ Yuborish» dan so‘ng so‘rov tasdiqlash zanjiriga tushadi (limitlar web paneldagi qoidalar bo‘yicha).',
  );
}

/** Har qadam uchun savol matni va tugmalar */
function savol(ctx, step, d) {
  const hint = T.dialogHint;
  switch (step) {
    case 'amount':
      return { html: lines('💸 <b>Yangi xarajat so‘rovi</b>', '', `<b>${raqam('amount')} · Summa</b>`, 'Qancha kerak? Masalan: <code>12 500 000</code> yoki <code>12,5 mln</code>') + hint, buttons: [bekor()] };
    case 'purpose':
      return { html: lines(d.amount ? line('Summa', money(d.amount)) : null, '', `<b>${raqam('purpose')} · Maqsad</b>`, 'Nima uchun kerak? Qisqa va aniq yozing (masalan: «Oktabr uchun Telegram Ads reklama kampaniyasi»).') + hint, buttons: [bekor()] };
    case 'category':
      return { html: lines(`<b>${raqam('category')} · Kategoriya</b>`, d.suggest ? `🤖 AI taklifi: <b>${esc(d.suggest.name)}</b> (${Math.round((d.suggest.confidence || 0) * 100)}%)` : 'AI maqsad bo‘yicha kategoriya topa olmadi.', 'Kategoriyani tanlang:') + hint, buttons: [...kategoriyaTugmalari(ctx, d), bekor()] };
    case 'date':
      return { html: lines(`<b>${raqam('date')} · Kerakli sana</b>`, 'Pul qachongacha kerak? Tanlang yoki yozing (masalan <code>' + esc(date(addDays(today(), 5))) + '</code>).') + hint, buttons: [...SANA_TUGMALAR(), bekor()] };
    case 'method':
      return { html: lines(`<b>${raqam('method')} · To‘lov usuli</b>`, 'Qanday to‘lanadi?') + hint, buttons: [...USUL_TUGMALAR(), bekor()] };
    case 'counterparty':
      return { html: lines(`<b>${raqam('counterparty')} · Kontragent</b>`, 'Kimga to‘lanadi? Tashkilot yoki shaxs nomini yozing.') + hint, buttons: [[btn.cb('⏭ O‘tkazib yuborish', 's.skip:cp')], bekor()] };
    case 'receipt':
      return { html: lines(`<b>${raqam('receipt')} · Hujjat</b>`, 'Chek, hisob-faktura yoki shartnoma rasmini / PDF faylini yuboring (≤ 10 MB).') + hint, buttons: [[btn.cb('⏭ Hujjatsiz davom etish', 's.skip:file')], bekor()] };
    case 'confirm':
      return { html: xulosa(ctx, d), buttons: [[btn.cb('✅ Yuborish', 's.send')], [btn.cmd('✏️ Qaytadan', 'yangi'), btn.cb('✖️ Bekor', 'x')]] };
    default:
      return { html: T.staleDialog, buttons: [] };
  }
}

/** Keyingi qadamga o'tish: holat saqlanadi va yangi savol yuboriladi */
async function keyingi(ctx, step, patch = {}) {
  const st = ctx.dialog.update({ step, data: patch });
  if (!st) return ctx.reply(T.staleDialog);
  const s = savol(ctx, step, st.data);
  return ctx.reply(s.html, { buttons: s.buttons });
}

/** Tugma shu dialog va shu qadamga tegishlimi (eskirgan tugmalarni ushlaydi) */
async function faolQadam(ctx, step) {
  const st = ctx.dialog.get();
  if (!st || st.name !== DIALOG) { await ctx.answer('⌛ Bu so‘rov oynasi eskirgan. /yangi bilan qaytadan boshlang.', true); return null; }
  if (st.step !== step) { await ctx.answer('Bu bosqich allaqachon o‘tgan — oxirgi xabardagi tugmalardan foydalaning.', true); return null; }
  return st;
}

// ---------- buyruq ----------
export async function yangi(ctx) {
  const summa0 = ctx.args ? parseAmount(ctx.args) : null;
  const summa = summa0 && summa0 <= 1e12 ? summa0 : null; // matn qadami bilan bir xil yuqori chegara
  const st = ctx.dialog.start(DIALOG, summa ? { amount: summa } : {}, summa ? 'purpose' : 'amount');
  const s = savol(ctx, st.step, st.data);
  return ctx.reply(s.html, { buttons: s.buttons });
}

// ---------- dialog: matn va fayl ----------
export const yangiDialog = {
  async onText(ctx, st) {
    const d = st.data || {};
    const matn = ctx.text.replace(/\s+/g, ' ').trim();
    switch (st.step) {
      case 'amount': {
        const summa = parseAmount(matn);
        if (!summa) return ctx.reply('❌ Summani tushunmadim. Raqam bilan yozing: <code>12 500 000</code>, <code>12,5 mln</code> yoki <code>800 ming</code>.' + T.dialogHint);
        if (summa > 1e12) return ctx.reply('❌ Summa juda katta — tekshirib qayta yozing.' + T.dialogHint);
        return keyingi(ctx, 'purpose', { amount: summa });
      }
      case 'purpose': {
        if (matn.length < 5) return ctx.reply('✍️ Maqsadni batafsilroq yozing (kamida 5 belgi).' + T.dialogHint);
        const s = ctx.S.expenses.suggestCategory(matn);
        return keyingi(ctx, 'category', { purpose: clip(matn, 500), suggest: s.category_id ? { id: s.category_id, name: s.name, confidence: s.confidence } : null });
      }
      case 'category': {
        const q = matn.toLowerCase();
        const c = q.length >= 3 ? ctx.S.expenses.categories().find((x) => x.code !== 'PAYROLL' && x.name.toLowerCase().includes(q)) : null;
        if (!c) return ctx.reply('👇 Kategoriyani tugmalardan tanlang.' + T.dialogHint, { buttons: kategoriyaTugmalari(ctx, d) });
        return keyingi(ctx, 'date', { category_id: c.id, category_name: c.name });
      }
      case 'date': {
        const kun = parseDate(matn);
        if (!kun) return ctx.reply('📅 Sanani tushunmadim. Masalan: <code>25.10.2026</code>, «ertaga» yoki tugmani bosing.' + T.dialogHint, { buttons: SANA_TUGMALAR() });
        if (kun < today()) return ctx.reply('📅 O‘tgan sana bo‘lishi mumkin emas — bugun yoki keyingi sanani kiriting.' + T.dialogHint, { buttons: SANA_TUGMALAR() });
        return keyingi(ctx, 'method', { required_date: kun });
      }
      case 'method': {
        const usul = /naqd|kassa|cash|нал/i.test(matn) ? 'CASH' : /bank|o['‘ʻ’]?tkazma|perechis|безнал/i.test(matn) ? 'BANK' : null;
        if (!usul) return ctx.reply('👇 To‘lov usulini tugma orqali tanlang.' + T.dialogHint, { buttons: USUL_TUGMALAR() });
        return keyingi(ctx, 'counterparty', { payment_method: usul });
      }
      case 'counterparty': {
        if (matn.length < 2) return ctx.reply('✍️ Kontragent nomini yozing yoki «⏭ O‘tkazib yuborish» ni bosing.' + T.dialogHint, { buttons: [[btn.cb('⏭ O‘tkazib yuborish', 's.skip:cp')]] });
        return keyingi(ctx, 'receipt', { counterparty: clip(matn, 200) });
      }
      case 'receipt':
        return ctx.reply('📎 Hujjatni rasm yoki fayl sifatida yuboring yoki «⏭ Hujjatsiz davom etish» ni bosing.' + T.dialogHint, { buttons: [[btn.cb('⏭ Hujjatsiz davom etish', 's.skip:file')]] });
      case 'confirm':
      case 'sending':
        return ctx.reply('👆 So‘rovni tekshiring va «✅ Yuborish» tugmasini bosing (yoki /bekor).');
      default:
        ctx.dialog.clear();
        return ctx.reply(T.staleDialog);
    }
  },
  async onFile(ctx, st) {
    if (st.step !== 'receipt') return ctx.reply(`📎 Hozir fayl emas — <b>${esc(QADAM_NOMI[st.step] || st.step)}</b> kutilmoqda.` + T.dialogHint);
    const f = ctx.file;
    if (f.kind !== 'photo' && f.mime_type && !HUJJAT_MIME.test(f.mime_type)) return ctx.reply('📎 Faqat rasm, PDF, Word yoki Excel fayl qabul qilinadi.' + T.dialogHint);
    const buf = await ctx.download();
    const yol = ctx.saveFile(buf, 'receipts', f.file_name);
    return keyingi(ctx, 'confirm', { receipt_path: yol, receipt_name: f.file_name });
  },
};

// ---------- tugmalar ----------
export const yangiCallbacks = {
  /** s.cat:<id|auto> */
  's.cat': async (ctx) => {
    if (!(await faolQadam(ctx, 'category'))) return null;
    const arg = ctx.cbArgs[0];
    if (arg === 'auto') {
      await ctx.edit(`<b>${raqam('category')} · Kategoriya:</b> AI tanlaydi 🤖`);
      await ctx.answer();
      return keyingi(ctx, 'date', { category_id: null, category_name: null });
    }
    const c = ctx.S.expenses.categories().find((x) => x.id === Number(arg) && x.code !== 'PAYROLL');
    if (!c) return ctx.answer('Kategoriya topilmadi', true);
    await ctx.edit(`<b>${raqam('category')} · Kategoriya:</b> ${esc(c.name)} ✅`);
    await ctx.answer();
    return keyingi(ctx, 'date', { category_id: c.id, category_name: c.name });
  },
  /** s.date:<0|1|3|7|skip> */
  's.date': async (ctx) => {
    if (!(await faolQadam(ctx, 'date'))) return null;
    const arg = ctx.cbArgs[0];
    const kunlar = { 0: 0, 1: 1, 3: 3, 7: 7 };
    if (arg !== 'skip' && kunlar[arg] === undefined) return ctx.answer(T.expired, true);
    const kun = arg === 'skip' ? null : addDays(today(), kunlar[arg]);
    await ctx.edit(`<b>${raqam('date')} · Kerakli sana:</b> ${kun ? esc(date(kun)) : 'ko‘rsatilmagan'} ✅`);
    await ctx.answer();
    return keyingi(ctx, 'method', { required_date: kun });
  },
  /** s.pm:<BANK|CASH> */
  's.pm': async (ctx) => {
    if (!(await faolQadam(ctx, 'method'))) return null;
    const usul = ctx.cbArgs[0];
    if (!['BANK', 'CASH'].includes(usul)) return ctx.answer(T.expired, true);
    await ctx.edit(`<b>${raqam('method')} · To‘lov usuli:</b> ${esc(PAYMENT_METHOD[usul])} ✅`);
    await ctx.answer();
    return keyingi(ctx, 'counterparty', { payment_method: usul });
  },
  /** s.skip:<cp|file> */
  's.skip': async (ctx) => {
    const nima = ctx.cbArgs[0];
    if (nima === 'cp') {
      if (!(await faolQadam(ctx, 'counterparty'))) return null;
      await ctx.edit(`<b>${raqam('counterparty')} · Kontragent:</b> ko‘rsatilmadi`);
      await ctx.answer();
      return keyingi(ctx, 'receipt', { counterparty: null });
    }
    if (nima === 'file') {
      if (!(await faolQadam(ctx, 'receipt'))) return null;
      await ctx.edit(`<b>${raqam('receipt')} · Hujjat:</b> biriktirilmadi`);
      await ctx.answer();
      return keyingi(ctx, 'confirm', { receipt_path: null, receipt_name: null });
    }
    return ctx.answer(T.expired, true);
  },
  /** s.send — expenses.request (web /api/expenses/request bilan bir xil servis va perm) */
  's.send': async (ctx) => {
    const st = await faolQadam(ctx, 'confirm');
    if (!st) return null;
    ctx.need('expenses', 'CREATE');
    const d = st.data || {};
    if (!d.amount || !d.purpose) { ctx.dialog.clear(); return ctx.answer('⌛ So‘rov ma’lumotlari to‘liq emas. /yangi bilan qaytadan boshlang.', true); }
    ctx.dialog.update({ step: 'sending' });
    let e;
    try {
      e = ctx.S.expenses.request({ amount: d.amount, purpose: d.purpose, category_id: d.category_id || undefined, required_date: d.required_date || undefined, payment_method: d.payment_method || 'BANK', counterparty: d.counterparty || undefined }, ctx.actor);
    } catch (err) {
      ctx.dialog.update({ step: 'confirm' });
      throw err;
    }
    if (d.receipt_path) e = ctx.S.expenses.update(e.id, { receipt_path: d.receipt_path }, ctx.actor);
    ctx.dialog.clear();
    const a = ctx.S.approvals.get(e.approval_id);
    const zanjir = (a?.steps || []).map((s, i) => `${i === a.current_step ? '👉' : '▫️'} ${i + 1}. ${esc(stepLabel(s.role))}`);
    await ctx.edit(lines(
      `✅ <b>So‘rov yuborildi: ${esc(e.code)}</b>`,
      `${money(e.amount)} · ${esc(clip(e.purpose, 120))}`,
      e.category_name ? line('Kategoriya', e.category_name) : null,
      '',
      '<b>Tasdiqlash zanjiri:</b>',
      ...zanjir,
      '',
      'Holatini /sorovlarim orqali kuzating — har bir qarorda @utax_signal_bot xabar beradi.',
    ), { buttons: [[btn.cmd('📋 So‘rovlarim', 'sorovlarim'), btn.web('🌐 Web’da ochish', `expenses/${e.id}`)]] });
    return ctx.answer('✅ Yuborildi');
  },
};
