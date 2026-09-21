/** Signal bot /start va /yordam matnlari. */
import { esc } from '../../shared/html.mjs';
import { lines, line, roleLabel } from '../../shared/format.mjs';

export function startText(ctx) {
  const p = ctx.S.notifications.prefs(ctx.user.id);
  const ochirilgan = p.types.filter((t) => !t.telegram).length;
  return lines(
    `👋 Assalomu alaykum, <b>${esc(ctx.user.name)}</b>!`,
    `<b>${esc(ctx.bot.def.title)}</b> · ${esc(roleLabel(ctx.user.role_code))}`,
    '',
    'Bildirishnomalar markazi: to‘lov muddatlari, tasdiqlar, likvidlik, byudjet va boshqa ogohlantirishlar shu chatga keladi — web paneldagi «Bildirishnomalar» bilan sinxron.',
    '',
    line('O‘qilmagan', `${ctx.S.notifications.unreadCount(ctx.user.id)} ta`),
    p.quiet ? `🌙 Jim soat: <b>${esc(p.quiet.from)}–${esc(p.quiet.to)}</b> (Toshkent vaqti)` : '🔔 Jim soat: <b>o‘chiq</b>',
    ochirilgan ? `⬜ O‘chirilgan turlar: <b>${ochirilgan} ta</b>${ctx.can('notifications', 'EDIT') ? ' — /sozlama' : ''}` : null,
  );
}

export const helpExtra = () => lines(
  '',
  '<b>Bildirishnomadagi tugmalar:</b>',
  '✅ Tasdiqlash / ❌ Rad etish — so‘rov sizning navbatingizda bo‘lsa chiqadi (web «Tasdiqlashlar» bilan bir xil qoida; rad etishda sabab so‘raladi).',
  '✅ Ko‘rildi — web paneldagi bildirishnoma ham o‘qilgan bo‘ladi.',
  '🌐 Ochish — tegishli sahifa (shartnoma, xarajat, tasdiq) web panelda.',
  '',
  '<i>Signal botni bloklasangiz, bildirishnomalar siz ochgan boshqa UTAX boti orqali keladi.</i>',
);
