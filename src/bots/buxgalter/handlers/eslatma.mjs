/**
 * Fon vazifasi: ish kunlari 17:00 da buxgalterga «Bugungi bank vipiskasini yuboring» eslatmasi —
 * agar bugun vipiska (IMPORT/TELEGRAM) yuklanmagan va faol Bank API integratsiyasi bo'lmasa. Bildirishnoma signal bot orqali keladi.
 */
const HAFTA_KUNI = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tashkent', weekday: 'short' });
const TOSHKENT_SANA = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' });

/** @param now test uchun sana (standart — hozir) */
export function vipiskaEslatma(app, now = new Date()) {
  if (['Sat', 'Sun'].includes(HAFTA_KUNI.format(now))) return { skipped: 'dam olish kuni' };
  const kun = TOSHKENT_SANA.format(now); // YYYY-MM-DD (Toshkent)
  const boshi = new Date(`${kun}T00:00:00+05:00`).toISOString(), oxiri = new Date(`${kun}T23:59:59.999+05:00`).toISOString();
  const yuklangan = app.db.get("SELECT COUNT(*) n FROM bank_transactions WHERE source IN ('IMPORT','TELEGRAM') AND reversed_at IS NULL AND created_at BETWEEN ? AND ?", boshi, oxiri).n;
  if (yuklangan) return { skipped: 'bugun vipiska yuklangan', rows: yuklangan };
  if (app.services.integrations.list().some((i) => i.type === 'BANK_API' && i.is_active)) return { skipped: 'Bank API ulangan' };
  const ids = app.services.notifications.notify({
    roles: ['ACCOUNTANT'], type: 'REMINDER', severity: 'INFO',
    title: 'Bugungi bank vipiskasini yuboring',
    body: 'Bugun bank ko‘chirmasi yuklanmagan. @utax_buxgalter_bot → /vipiska (CSV yoki XLSX).',
    dedupe_key: `vipiska:${kun}`,
  });
  return { notified: ids.length, date: kun };
}

export default {
  name: 'vipiska-eslatma',
  description: 'Ish kunlari 17:00 — bugungi bank vipiskasi eslatmasi (buxgalterga)',
  dailyAt: '17:00',
  run: (app, now) => vipiskaEslatma(app, now),
};
