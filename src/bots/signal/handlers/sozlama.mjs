/**
 * /sozlama — qaysi bildirishnoma turlari Telegram'ga kelsin va jim soatlar.
 * Web panel (Sozlamalar → Profil → Telegram botlar) bilan bitta manba: notifications.prefs / setPrefs.
 */
import { esc } from '../../shared/html.mjs';
import { lines, line, title, muted } from '../../shared/format.mjs';
import { btn, chunk } from '../../shared/keyboards.mjs';
import { ALERT_TYPES } from '../../../modules/notifications.mjs';

const PRESETLAR = { '2200-0800': { from: '22:00', to: '08:00' }, '2300-0700': { from: '23:00', to: '07:00' } };

export function sozlamaKorinish(ctx) {
  const p = ctx.S.notifications.prefs(ctx.user.id);
  const yoqilgan = p.types.filter((t) => t.telegram).length;
  const q = p.quiet;
  const html = lines(
    title('⚙️', 'Bildirishnoma sozlamalari'),
    line('Telegram’ga keladigan turlar', `${yoqilgan}/${p.types.length}`),
    q ? `🌙 Jim soat: <b>${esc(q.from)}–${esc(q.to)}</b> (Toshkent vaqti)` : '🔔 Jim soat: <b>o‘chiq</b>',
    '',
    muted('Jim soatda xabarlar navbatda turadi va jim soat tugagach yuboriladi. 🔴 Kritik ogohlantirishlar jim soatda ham darhol keladi.'),
    muted('Web panelda ham xuddi shu sozlamalar: Sozlamalar → Profil → Telegram botlar.'),
    '',
    'Turini yoqish/o‘chirish uchun bosing:',
  );
  const faol = (k) => !!q && q.from === PRESETLAR[k].from && q.to === PRESETLAR[k].to;
  const buttons = chunk(p.types.map((t) => btn.cb(`${t.telegram ? '✅' : '⬜'} ${t.label}`, `g.t:${t.type}`)), 2);
  buttons.push([btn.cb('✅ Hammasini yoqish', 'g.ta:on'), btn.cb('⬜ Hammasini o‘chirish', 'g.ta:off')]);
  buttons.push([btn.cb(`${faol('2200-0800') ? '● ' : ''}🌙 22:00–08:00`, 'g.q:2200-0800'), btn.cb(`${faol('2300-0700') ? '● ' : ''}🌙 23:00–07:00`, 'g.q:2300-0700')]);
  buttons.push([btn.cb(`${q ? '' : '● '}🔔 Jim soatsiz`, 'g.q:off')]);
  return { html, buttons };
}

async function qaytaChizish(ctx) {
  const v = sozlamaKorinish(ctx);
  return ctx.edit(v.html, { buttons: v.buttons });
}

export async function sozlama(ctx) {
  const v = sozlamaKorinish(ctx);
  return ctx.reply(v.html, { buttons: v.buttons });
}

/** g.t:<TYPE> — bitta turni yoqish/o'chirish */
export async function turniAlmashtirish(ctx) {
  const type = ctx.cbArgs[0];
  if (!ALERT_TYPES.includes(type)) return ctx.answer('Noma’lum bildirishnoma turi', true);
  const joriy = ctx.S.notifications.prefs(ctx.user.id).types.find((t) => t.type === type);
  ctx.S.notifications.setPrefs(ctx.user.id, { types: { [type]: !joriy.telegram } }, ctx.actor);
  await qaytaChizish(ctx);
  return ctx.answer(`${joriy.label}: ${joriy.telegram ? 'o‘chirildi' : 'yoqildi'}`);
}

/** g.ta:on|off — barcha turlar */
export async function hammasiniAlmashtirish(ctx) {
  const yoq = ctx.cbArgs[0] === 'on';
  ctx.S.notifications.setPrefs(ctx.user.id, { types: Object.fromEntries(ALERT_TYPES.map((t) => [t, yoq])) }, ctx.actor);
  await qaytaChizish(ctx);
  return ctx.answer(yoq ? '✅ Barcha turlar yoqildi' : '⬜ Barcha turlar o‘chirildi');
}

/** g.q:2200-0800 | 2300-0700 | off — jim soatlar */
export async function jimSoat(ctx) {
  const k = ctx.cbArgs[0];
  if (k !== 'off' && !PRESETLAR[k]) return ctx.answer('Noma’lum variant', true);
  const quiet = k === 'off' ? null : PRESETLAR[k];
  ctx.S.notifications.setPrefs(ctx.user.id, { quiet }, ctx.actor);
  await qaytaChizish(ctx);
  return ctx.answer(quiet ? `🌙 Jim soat: ${quiet.from}–${quiet.to}` : '🔔 Jim soat o‘chirildi');
}
