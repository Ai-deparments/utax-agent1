/** Signal bot uchun umumiy yordamchilar: Toshkent sanasi, daraja belgisi, o'z bildirishnomasini olish. */
import { SEVERITY_ICON } from '../../shared/format.mjs';
import { ALERT_LABELS } from '../../../modules/notifications.mjs';

/** Toshkent bo'yicha bugungi sana (YYYY-MM-DD) va kun boshining UTC vaqti (created_at bilan solishtirish uchun) */
export function bugunToshkent(d = new Date()) {
  const sana = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return { sana, boshi: new Date(`${sana}T00:00:00+05:00`).toISOString() };
}

export const belgi = (severity) => SEVERITY_ICON[severity] || '🔵';
export const turNomi = (type) => ALERT_LABELS[type] || type;

/** Faqat joriy foydalanuvchiga tegishli CRM bildirishnomasi (callback argumentiga ishonilmaydi) */
export const ozBildirishnoma = (ctx, id) =>
  ctx.db.get("SELECT * FROM notifications WHERE id=? AND user_id=? AND channel='CRM'", Number(id) || 0, ctx.user.id);
