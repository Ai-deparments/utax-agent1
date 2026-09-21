/** /test — o'zimga test bildirishnoma: notify() → dispetcher yetkazadi → natija (yuborildi / navbatda / nega yuborilmadi). */
import { esc } from '../../shared/html.mjs';
import { btn } from '../../shared/keyboards.mjs';

export async function testXabar(ctx) {
  const n = ctx.S.notifications;
  const ids = n.notify({ user_ids: [ctx.user.id], type: 'DAILY_DIGEST', severity: 'INFO', title: '🧪 Test bildirishnoma', body: 'Signal bot ishlayapti — UTAX bildirishnomalari shu chatga keladi.' });
  await ctx.app.bots?.flush();
  if (!ids.length) return ctx.reply('⚠️ Bildirishnoma yaratilmadi.');
  const tg = ctx.db.get("SELECT * FROM notifications WHERE parent_id=? AND channel='TELEGRAM'", ids[0]);
  if (!tg) {
    if (!ctx.settings.get('notifications.telegram_enabled')) return ctx.reply('⚠️ Telegram bildirishnomalari tizimda o‘chirilgan (web: Sozlamalar → Biznes qoidalari). Bildirishnoma faqat web panelda yaratildi.');
    const pref = n.prefs(ctx.user.id).types.find((t) => t.type === 'DAILY_DIGEST');
    if (pref && !pref.telegram) return ctx.reply('⬜ «Kunlik xulosa» turi o‘chirilgan — test Telegram’ga yuborilmadi. /sozlama orqali yoqing.', { buttons: ctx.can('notifications', 'EDIT') ? [[btn.cmd('⚙️ Sozlama', 'sozlama')]] : undefined });
    return ctx.reply('⚠️ Telegram’ga yuborilmadi.');
  }
  if (tg.sent_at) return ctx.reply(`✅ Yuborildi${tg.bot_key && tg.bot_key !== ctx.bot.key ? ` (zaxira bot: ${esc(tg.bot_key)})` : ''}. Web paneldagi «Bildirishnomalar» sahifasida ham ko‘rinadi.`, { buttons: [[btn.web('🌐 Bildirishnomalar', 'notifications')]] });
  if (n.isQuietNow(ctx.user)) return ctx.reply('🌙 Hozir jim soat — test xabari navbatda turibdi, jim soat tugagach keladi.');
  return ctx.reply(`⚠️ Yuborilmadi: ${esc(tg.error || 'noma’lum sabab')}`);
}
