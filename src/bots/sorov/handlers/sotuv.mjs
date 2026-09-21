/**
 * Sotuv menejeri (va mas'ul xodim) ma'lumotlari — FAQAT o'ziniki:
 *   /shartnomalarim — contracts.list({manager_user_id: men})       (web: Shartnomalar, SALES scope)
 *   /qarzdorlarim   — receivables.list({manager_user_id: men})     (web: Debitorlik)
 *   /vazifalarim    — receivables.listCollections({assigned_to})   (web: Debitorlik → Undiruv vazifalari)
 */
import { esc } from '../../shared/html.mjs';
import { money, date, dt, line, lines, title, muted, clip, bar, status, statusIcon, statusLabel, parseDate } from '../../shared/format.mjs';
import { btn, chunk, toReplyMarkup } from '../../shared/keyboards.mjs';
import { BotError } from '../../shared/errors.mjs';
import { T } from '../../shared/texts.mjs';
import { today, addDays, daysBetween, nowIso } from '../../../core/util.mjs';

const LIMIT_SHARTNOMA = 15;
const LIMIT_QARZ = 15;
const LIMIT_VAZIFA = 8;
const TO_LOV_TURI = { ADVANCE: 'avans', FINAL: 'yakuniy', INSTALLMENT: 'bo‘lib to‘lash', REMAINDER: 'qoldiq' };
const BOSQICH = {
  'T-7': 'To‘lovga 7 kun qoldi', 'T-3': 'To‘lovga 3 kun qoldi', 'T-0': 'Bugun to‘lov kuni', 'T+1': 'To‘lov muddati o‘tdi',
  'T+3': 'Undiruv: 3 kun kechikish', 'T+7': 'Eskalatsiya: 7 kun kechikish', 'T+15': 'Kritik qarz: 15+ kun kechikish',
};
const BOSQICH_BELGI = { 'T-7': '🔵', 'T-3': '🔵', 'T-0': '🟡', 'T+1': '🟠', 'T+3': '🟠', 'T+7': '🔴', 'T+15': '🔴' };
/** Boshqa odamlarning vazifasini ham yopa oladigan rollar (moliya nazorati) */
const NAZORATCHI = ['FINANCE_MANAGER', 'CFO', 'FOUNDER'];

// ---------- shartnomalar ----------
/** Shartnoma kartasini ko'rish huquqi: o'ziniki yoki (SALES bo'lmagan va contracts VIEW) */
function shartnomagaRuxsat(ctx, c) {
  if (!c || !ctx.can('contracts', 'VIEW')) return false;
  if (c.manager_user_id === ctx.user.id) return true;
  return ctx.user.role_code !== 'SALES';
}

export async function shartnomalarim(ctx) {
  const rows = ctx.S.contracts.list({ manager_user_id: ctx.user.id, active: true });
  if (!rows.length) return ctx.reply(lines(title('📄', 'Shartnomalarim'), '', 'Sizga biriktirilgan faol shartnoma yo‘q.'), { buttons: [[btn.web('🌐 Shartnomalar', 'contracts')]] });
  const jami = rows.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const tolangan = rows.reduce((s, c) => s + (Number(c.paid) || 0), 0);
  const qoldiq = rows.reduce((s, c) => s + (Number(c.remaining) || 0), 0);
  const korsat = rows.slice(0, LIMIT_SHARTNOMA);
  const html = lines(
    title('📄', 'Shartnomalarim'),
    line('Faol shartnomalar', `${rows.length} ta · ${money(jami)}`),
    line('To‘langan', money(tolangan)),
    line('Qoldiq', money(qoldiq)),
    '',
    ...korsat.map((c) => lines(
      `${statusIcon(c.contract_status)} <b>${esc(c.contract_number)}</b> · ${esc(clip(c.company_name, 40))}`,
      `   ${money(c.amount)} · ${bar(c.paid_pct, 8)}`,
      `   <i>${esc(statusLabel(c.contract_status))} · qoldiq ${money(c.remaining)}${c.overdue_days > 0 ? ` · ${c.overdue_days} kun kechikish` : ''}</i>`,
    )),
    rows.length > LIMIT_SHARTNOMA ? `\n<i>Birinchi ${LIMIT_SHARTNOMA} tasi — qolganlari web panelda.</i>` : null,
  );
  return ctx.reply(html, { buttons: [...chunk(korsat.map((c) => btn.cb(c.contract_number, `s.ct:${c.id}`)), 2), [btn.web('🌐 Shartnomalar', 'contracts')]] });
}

/** Shartnoma kartasi (contracts.detail) */
export function shartnomaKartasi(ctx, id) {
  const d = ctx.S.contracts.detail(id);
  if (!d) return null;
  const ochiqVazifa = (d.collections || []).filter((k) => k.status === 'OPEN').length;
  const html = lines(
    `📄 <b>${esc(d.contract_number)}</b> · ${status(d.contract_status)}`,
    `<b>${esc(d.company_name)}</b>${d.company_inn ? ` · INN ${esc(d.company_inn)}` : ''}`,
    d.title ? `<i>${esc(clip(d.title, 120))}</i>` : null,
    '',
    line('Xizmat', d.service_name),
    line('Summa', money(d.amount)),
    `To‘langan: <b>${money(d.paid)}</b> · ${bar(d.paid_pct, 8)}`,
    line('Qoldiq', money(d.remaining)),
    d.advance_balance > 0 ? line('Mijoz avansi (tan olinmagan)', money(d.advance_balance)) : null,
    line('Tan olingan daromad', money(d.recognized)),
    line('Xizmat holati', statusLabel(d.service_status)),
    d.next_due_date ? `${line('Keyingi to‘lov muddati', date(d.next_due_date))}${d.overdue_days > 0 ? ` · 🔴 ${d.overdue_days} kun o‘tdi` : ''}` : null,
    d.schedules?.length ? '\n<b>To‘lov jadvali:</b>' : null,
    ...(d.schedules || []).map((s) => `${statusIcon(s.status)} ${esc(date(s.due_date))} — ${money(s.amount)} (${esc(TO_LOV_TURI[s.kind] || s.kind)}, ${esc(statusLabel(s.status).toLowerCase())})`),
    '',
    `📎 Hujjatlar: ${d.documents?.length || 0} ta${d.act_count ? ' · qabul akti bor ✅' : ' · qabul akti yo‘q'}`,
    ochiqVazifa ? `📞 Ochiq undiruv vazifalari: ${ochiqVazifa} ta` : null,
  );
  return { html, buttons: [[btn.web('🌐 Web’da ochish', `contracts/${d.id}`)], [ctx.can('receivables', 'VIEW') ? btn.cmd('👥 Qarzdorlarim', 'qarzdorlarim') : null, ctx.can('collections', 'VIEW') ? btn.cmd('📞 Vazifalarim', 'vazifalarim') : null]] };
}

/** s.ct:<contractId> */
export async function shartnomaTugma(ctx) {
  const id = Number(ctx.cbArgs[0]);
  const c = id ? ctx.S.contracts.get(id) : null;
  if (!shartnomagaRuxsat(ctx, c)) return ctx.answer('⛔ Bu shartnoma sizga biriktirilmagan yoki topilmadi.', true);
  const k = shartnomaKartasi(ctx, id);
  await ctx.answer();
  return ctx.reply(k.html, { buttons: k.buttons });
}

// ---------- qarzdorlar ----------
export async function qarzdorlarim(ctx) {
  const rows = ctx.S.receivables.list({ manager_user_id: ctx.user.id });
  if (!rows.length) return ctx.reply(lines(title('👥', 'Qarzdorlarim'), '', 'Sizning mijozlaringizda qarz yo‘q ✅'), { buttons: [[btn.web('🌐 Debitorlik', 'receivables')]] });
  const jami = rows.reduce((s, x) => s + (Number(x.debt) || 0), 0);
  const kechikkan = rows.filter((x) => x.overdue_amount > 0);
  const kechikkanSumma = kechikkan.reduce((s, x) => s + (Number(x.overdue_amount) || 0), 0);
  const kritik = rows.filter((x) => x.is_critical).length;
  const korsat = rows.slice(0, LIMIT_QARZ);
  const html = lines(
    title('👥', 'Qarzdorlarim'),
    line('Jami qarz', `${money(jami)} · ${rows.length} shartnoma`),
    line('Muddati o‘tgan', `${money(kechikkanSumma)} · ${kechikkan.length} ta`),
    kritik ? line('Kritik (15+ kun)', `${kritik} ta`) : null,
    '',
    ...korsat.map((x) => lines(
      `${x.overdue_amount > 0 ? (x.is_critical ? '🔴' : '🟠') : '🟢'} <b>${esc(clip(x.client, 40))}</b> · ${esc(x.contract_number)}`,
      `   Qarz: <b>${money(x.debt)}</b>${x.overdue_amount > 0 ? ` · muddati o‘tgan ${money(x.overdue_amount)} (${x.days_overdue} kun)` : ''}`,
      x.due_date ? `   <i>Keyingi muddat: ${esc(date(x.due_date))}${x.due_amount ? ` · ${money(x.due_amount)}` : ''}</i>` : null,
    )),
    rows.length > LIMIT_QARZ ? `\n<i>Birinchi ${LIMIT_QARZ} tasi — qolganlari web panelda.</i>` : null,
  );
  return ctx.reply(html, { buttons: [...chunk(korsat.map((x) => btn.cb(x.contract_number, `s.ct:${x.contract_id}`)), 2), [ctx.can('collections', 'VIEW') ? btn.cmd('📞 Vazifalarim', 'vazifalarim') : null, btn.web('🌐 Debitorlik', 'receivables')]] });
}

// ---------- undiruv vazifalari ----------
/** Bitta vazifa (listCollections bilan bir xil ustunlar) */
function vazifa(ctx, id) {
  return ctx.db.get(`SELECT k.*, c.contract_number, c.company_id, co.name AS client, co.phone AS client_phone, u.name AS assigned_name
    FROM collections k JOIN contracts c ON c.id=k.contract_id JOIN companies co ON co.id=c.company_id LEFT JOIN users u ON u.id=k.assigned_to WHERE k.id=?`, id);
}
const egasimi = (ctx, k) => !!k && (k.assigned_to === ctx.user.id || NAZORATCHI.includes(ctx.user.role_code));

/** Sozlamalardagi bosqich yorlig'i (collection.stages) — izoh tarixida takrorlanmasin */
function bosqichYorliqlari(ctx) {
  return new Set((ctx.settings.get('collection.stages') || []).map((s) => s.label));
}

function vazifaKartasi(ctx, k) {
  const yorliq = bosqichYorliqlari(ctx);
  const tarix = String(k.note || '').split('\n').map((s) => s.trim()).filter((s) => s && !yorliq.has(s));
  const kechikish = k.due_date && k.due_date < today() ? daysBetween(k.due_date, today()) : 0;
  const html = lines(
    `${BOSQICH_BELGI[k.stage] || '📞'} <b>${esc(BOSQICH[k.stage] || k.stage)}</b>${k.status !== 'OPEN' ? ` · ${status(k.status)}` : ''}`,
    `<b>${esc(k.client)}</b> · ${esc(k.contract_number)}`,
    line('Qarz', money(k.debt)),
    k.due_date ? `${line('To‘lov muddati', date(k.due_date))}${kechikish > 0 ? ` · 🔴 ${kechikish} kun o‘tdi` : ''}` : null,
    k.client_phone ? `📱 Mijoz: ${esc(k.client_phone)}` : null,
    muted(`Vazifa: ${date(k.task_date)}${k.assigned_name ? ` · mas’ul: ${k.assigned_name}` : ''}`),
    tarix.length ? '\n<b>Tarix:</b>' : null,
    ...tarix.slice(-6).map((s) => `• ${esc(clip(s, 150))}`),
  );
  const buttons = [];
  if (k.status === 'OPEN' && ctx.can('collections', 'EDIT')) {
    buttons.push([btn.cb('📞 Aloqa qildim', `s.col:call:${k.id}`), btn.cb('🤝 Va’da berdi', `s.col:prom:${k.id}`)]);
    buttons.push([btn.cb('✅ Bajarildi', `s.col:done:${k.id}`)]);
  }
  buttons.push([btn.web('🌐 Shartnoma', `contracts/${k.contract_id}`)]);
  return { html, buttons };
}

export async function vazifalarim(ctx) {
  const tasks = ctx.S.receivables.listCollections({ status: 'OPEN', assigned_to: ctx.user.id });
  if (!tasks.length) return ctx.reply(lines(title('📞', 'Undiruv vazifalarim'), '', 'Ochiq vazifa yo‘q ✅'), { buttons: [[ctx.can('receivables', 'VIEW') ? btn.cmd('👥 Qarzdorlarim', 'qarzdorlarim') : null, btn.web('🌐 Debitorlik', 'receivables')]] });
  const jami = tasks.reduce((s, k) => s + (Number(k.debt) || 0), 0);
  await ctx.reply(lines(
    title('📞', 'Undiruv vazifalarim'),
    line('Ochiq', `${tasks.length} ta · ${money(jami)}`),
    tasks.length > LIMIT_VAZIFA ? muted(`Birinchi ${LIMIT_VAZIFA} tasi ko‘rsatilmoqda — qolganlari web panelda`) : null,
    ctx.can('collections', 'EDIT') ? 'Mijoz bilan gaplashgach, natijani tugma orqali belgilang.' : null,
  ));
  for (const k of tasks.slice(0, LIMIT_VAZIFA)) {
    const c = vazifaKartasi(ctx, k);
    await ctx.reply(c.html, { buttons: c.buttons });
  }
  return null;
}

const izohQosh = (oldin, yangi) => {
  const t = oldin ? `${oldin}\n${yangi}` : yangi;
  return t.length > 2000 ? t.slice(t.length - 2000) : t;
};

/** Karta xabarini yangilash (callback'dan yoki dialogdan) */
async function kartaniYangila(ctx, id, messageId) {
  const k = vazifa(ctx, id);
  if (!k) return;
  const c = vazifaKartasi(ctx, k);
  if (ctx.callback && !messageId) { await ctx.edit(c.html, { buttons: c.buttons }); return; }
  if (messageId) await ctx.bot.api.editMessageText(ctx.chatId, messageId, c.html, { reply_markup: toReplyMarkup(c.buttons, ctx.links, (r) => ctx.can(r, 'VIEW')) }).catch(() => {});
}

/** Vazifani o'zgartirishdan oldingi tekshiruv: ruxsat, egalik, ochiqlik */
function ochiqVazifa(ctx, id) {
  ctx.need('collections', 'EDIT');
  const k = vazifa(ctx, id);
  if (!k) throw new BotError('Vazifa topilmadi.');
  if (!egasimi(ctx, k)) throw new BotError('⛔ Bu vazifa sizga biriktirilmagan.');
  if (k.status !== 'OPEN') throw new BotError(`Vazifa allaqachon yopilgan: ${statusLabel(k.status)}.`);
  return k;
}

/** Va'dani qayd etish (dialog yoki tez tugma) */
async function vadaQayd(ctx, id, kun, messageId) {
  const k = ochiqVazifa(ctx, id);
  const note = izohQosh(k.note, `🤝 Va’da: ${date(kun)} — ${dt(nowIso())}, ${ctx.user.name}`);
  ctx.S.receivables.updateCollection(k.id, { note }, ctx.actor);
  if (ctx.dialog.get()?.name === 's.promise') ctx.dialog.clear();
  await kartaniYangila(ctx, k.id, messageId);
  return k;
}

export const vazifaCallbacks = {
  /** s.col:<call|prom|done>:<id> */
  's.col': async (ctx) => {
    const [amal, idStr] = ctx.cbArgs;
    const id = Number(idStr);
    const k = ochiqVazifa(ctx, id);
    if (amal === 'call') {
      ctx.S.receivables.updateCollection(k.id, { note: izohQosh(k.note, `📞 ${dt(nowIso())} — aloqa qilindi (${ctx.user.name})`) }, ctx.actor);
      await kartaniYangila(ctx, k.id);
      return ctx.answer('📞 Aloqa qayd etildi');
    }
    if (amal === 'done') {
      ctx.S.receivables.updateCollection(k.id, { status: 'DONE', note: izohQosh(k.note, `✅ ${dt(nowIso())} — bajarildi (${ctx.user.name})`) }, ctx.actor);
      await kartaniYangila(ctx, k.id);
      return ctx.answer('✅ Vazifa yopildi');
    }
    if (amal === 'prom') {
      ctx.dialog.start('s.promise', { id: k.id, message_id: ctx.callback?.message?.message_id || null }, 'date');
      await ctx.answer();
      return ctx.reply(lines(
        `🤝 <b>${esc(k.client)}</b> qachon to‘lashga va’da berdi?`,
        `Sanani yozing (masalan <code>${esc(date(addDays(today(), 3)))}</code>) yoki tanlang:`,
      ) + T.dialogHint, { buttons: [[btn.cb('Ertaga', `s.pd:${k.id}:1`), btn.cb('3 kun', `s.pd:${k.id}:3`), btn.cb('1 hafta', `s.pd:${k.id}:7`)]] });
    }
    return ctx.answer(T.expired, true);
  },
  /** s.pd:<id>:<kun> — va'da sanasi tez tugma bilan */
  's.pd': async (ctx) => {
    const [idStr, kunStr] = ctx.cbArgs;
    const kunlar = { 1: 1, 3: 3, 7: 7 };
    if (kunlar[kunStr] === undefined) return ctx.answer(T.expired, true);
    const st = ctx.dialog.get();
    const messageId = st?.name === 's.promise' && Number(st.data.id) === Number(idStr) ? st.data.message_id : null;
    const kun = addDays(today(), kunlar[kunStr]);
    const k = await vadaQayd(ctx, Number(idStr), kun, messageId);
    await ctx.edit(`🤝 Va’da qayd etildi: <b>${esc(date(kun))}</b> — ${esc(k.client)}`);
    return ctx.answer('🤝 Qayd etildi');
  },
};

export const vazifaDialogs = {
  's.promise': {
    async onText(ctx, st) {
      const kun = parseDate(ctx.text);
      if (!kun) return ctx.reply('📅 Sanani tushunmadim. Masalan: <code>25.10.2026</code> yoki «ertaga».' + T.dialogHint);
      if (kun < today()) return ctx.reply('📅 Va’da sanasi o‘tgan kun bo‘lishi mumkin emas.' + T.dialogHint);
      const k = await vadaQayd(ctx, Number(st.data.id), kun, st.data.message_id);
      return ctx.reply(`🤝 Va’da qayd etildi: <b>${esc(date(kun))}</b> — ${esc(k.client)}\nMuddat kelganda eslatma undiruv agenti orqali keladi.`);
    },
  },
};
