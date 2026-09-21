/** Bildirishnomalar qutisi: /bugun, /oqilmagan, /tarix va ularning tugmalari (g.o — ochish, g.all — hammasini o'qish, g.h — sahifa). */
import { esc } from '../../shared/html.mjs';
import { lines, line, title, muted, dt, date, clip, money } from '../../shared/format.mjs';
import { btn, chunk, paginate } from '../../shared/keyboards.mjs';
import { belgi, turNomi, bugunToshkent, ozBildirishnoma } from './common.mjs';

const OQILMAGAN_LIMIT = 10;
const TARIX_SAHIFA = 15;
const TARIX_LIMIT = 150;
const webTugma = () => [btn.web('🌐 Bildirishnomalar', 'notifications')];

/** /bugun — bugungi bildirishnomalar, daraja bo'yicha soni, qisqa holat (ruxsat bo'lsa) */
export async function bugun(ctx) {
  const { sana, boshi } = bugunToshkent();
  const rows = ctx.db.all("SELECT * FROM notifications WHERE user_id=? AND channel='CRM' AND created_at>=? ORDER BY created_at DESC, id DESC", ctx.user.id, boshi);
  const soni = (s) => rows.filter((n) => (n.severity || 'INFO') === s).length;
  const qatorlar = [
    title('📅', `Bugun · ${date(sana)}`),
    rows.length
      ? `🔴 Kritik: <b>${soni('CRITICAL')}</b> · 🟡 Ogohlantirish: <b>${soni('WARNING')}</b> · 🔵 Ma’lumot: <b>${soni('INFO')}</b>`
      : 'Bugun bildirishnoma bo‘lmadi ✅',
    line('O‘qilmagan (jami)', `${ctx.S.notifications.unreadCount(ctx.user.id)} ta`),
  ];
  if (ctx.can('treasury', 'VIEW')) qatorlar.push(`💰 ${line('Ishlatish mumkin', money(ctx.S.reports.treasury().available_cash))}`);
  if (ctx.can('approvals', 'VIEW')) qatorlar.push(`✅ ${line('Navbatingizdagi tasdiqlar', `${ctx.S.approvals.pendingFor(ctx.user).length} ta`)}`);
  if (rows.length) {
    qatorlar.push('', '<b>Oxirgi bildirishnomalar:</b>');
    for (const n of rows.slice(0, 10)) qatorlar.push(`${esc(dt(n.created_at).slice(11))} ${belgi(n.severity)} ${n.is_read ? '' : '🆕 '}${esc(clip(n.title, 90))}`);
    if (rows.length > 10) qatorlar.push(muted(`… yana ${rows.length - 10} ta — /tarix`));
  }
  const buttons = [
    [btn.cmd('🔔 O‘qilmagan', 'oqilmagan'), ...(ctx.can('notifications', 'EDIT') ? [btn.cmd('⚙️ Sozlama', 'sozlama')] : [])],
    webTugma(),
  ];
  return ctx.reply(lines(qatorlar), { buttons });
}

/** /oqilmagan — o'qilmaganlar (≤ 10), raqam tugmasi → to'liq karta */
export async function oqilmagan(ctx) {
  const jami = ctx.S.notifications.unreadCount(ctx.user.id);
  if (!jami) return ctx.reply('🔕 O‘qilmagan bildirishnoma yo‘q.', { buttons: [[btn.cmd('🗂 Tarix', 'tarix')], webTugma()] });
  const items = ctx.S.notifications.listFor(ctx.user.id, { unread: true, limit: OQILMAGAN_LIMIT });
  const html = lines(
    title('🔔', `O‘qilmagan: ${jami} ta`),
    '',
    ...items.map((n, i) => `${i + 1}. ${belgi(n.severity)} <b>${esc(clip(n.title, 90))}</b>\n    ${muted(`${turNomi(n.type)} · ${dt(n.created_at)}`)}`),
    jami > items.length ? `\n${muted(`… yana ${jami - items.length} ta — web panelda`)}` : null,
    '',
    muted('Raqamni bosing — to‘liq ko‘rinish va tugmalar.'),
  );
  const buttons = chunk(items.map((n, i) => btn.cb(String(i + 1), `g.o:${n.id}`)), 5);
  if (ctx.can('notifications', 'EDIT')) buttons.push([btn.cb('✅ Hammasini o‘qilgan qilish', 'g.all')]);
  buttons.push(webTugma());
  return ctx.reply(html, { buttons });
}

/** g.o:<id> — bildirishnoma kartasi (signal orqali kelgani bilan bir xil ko'rinish: ✅ Ko'rildi, 🌐 Ochish, tasdiq tugmalari) */
export async function ochish(ctx) {
  const n = ozBildirishnoma(ctx, ctx.cbArgs[0]);
  if (!n) return ctx.answer('Bildirishnoma topilmadi', true);
  const { html, buttons } = ctx.app.bots.formatNotification(n, ctx.user);
  await ctx.reply(n.is_read ? `${html}\n${muted('✅ O‘qilgan')}` : html, { buttons });
  return ctx.answer();
}

/** g.all — barcha o'qilmaganlarni o'qilgan qilish (web «Barchasini o‘qilgan qilish» bilan bir xil) */
export async function hammasiniOqish(ctx) {
  const n = ctx.S.notifications.markRead(ctx.user.id, { all: true });
  await ctx.edit(lines(title('🔔', 'O‘qilmagan bildirishnomalar'), '', n ? `✅ ${n} ta bildirishnoma o‘qilgan deb belgilandi.` : 'O‘qilmagan bildirishnoma qolmagan.'), { buttons: [[btn.cmd('🗂 Tarix', 'tarix')], webTugma()] });
  return ctx.answer(n ? `✅ ${n} ta o‘qildi` : 'Hammasi o‘qilgan');
}

function tarixKorinish(ctx, page) {
  const jami = ctx.db.get("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND channel='CRM'", ctx.user.id).n;
  if (!jami) return { html: '🗂 Bildirishnomalar tarixi bo‘sh.', buttons: [webTugma()] };
  const items = ctx.S.notifications.listFor(ctx.user.id, { limit: TARIX_LIMIT });
  const p = paginate(items, page, TARIX_SAHIFA, (x) => `g.h:${x}`);
  const html = lines(
    title('🗂', `Bildirishnomalar tarixi — jami ${jami} ta`),
    muted(`Sahifa ${p.page + 1}/${p.pages}${jami > TARIX_LIMIT ? ` · oxirgi ${TARIX_LIMIT} tasi` : ''} · 🆕 — o‘qilmagan`),
    '',
    ...p.slice.map((n) => `${n.is_read ? '▫️' : '🆕'} ${belgi(n.severity)} <b>${esc(clip(n.title, 80))}</b>\n      ${muted(`${turNomi(n.type)} · ${dt(n.created_at)}`)}`),
  );
  const buttons = [];
  if (p.nav.length) buttons.push(p.nav);
  buttons.push(webTugma());
  return { html, buttons };
}

/** /tarix — oxirgi bildirishnomalar (o'qilgan/o'qilmagan), 15 tadan sahifa */
export async function tarix(ctx) {
  const v = tarixKorinish(ctx, 0);
  return ctx.reply(v.html, { buttons: v.buttons });
}

/** g.h:<sahifa> */
export async function tarixSahifa(ctx) {
  const v = tarixKorinish(ctx, Number(ctx.cbArgs[0]) || 0);
  await ctx.edit(v.html, { buttons: v.buttons });
  return ctx.answer();
}
