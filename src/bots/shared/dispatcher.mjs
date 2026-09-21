/**
 * Bildirishnomalar dispetcheri: notifications (channel='TELEGRAM') → @utax_signal_bot.
 * Foydalanuvchi signal botni ochmagan/bloklagan bo'lsa — u /start qilgan boshqa UTAX botlari orqali (zaxira).
 * Muvaffaqiyatsiz yuborish: attempts++, next_try_at (backoff); runtime har daqiqada qayta urinadi (24 soat, 5 urinish).
 */
import { config } from '../../core/config.mjs';
import { nowIso } from '../../core/util.mjs';
import { ALERT_LABELS, isQuietNow } from '../../modules/notifications.mjs';
import { esc } from './html.mjs';
import { dt, lines, muted, SEVERITY_ICON } from './format.mjs';
import { btn, entityPath } from './keyboards.mjs';
import { TelegramError } from './telegram-api.mjs';
import { markChatBlocked, startedBots } from './auth.mjs';

/** Yuborish davomida yozuv band turadigan muddat (Telegram 429 kutishi ≤ 60 s × 3 va 30 s timeout × 3 dan uzun) */
export const CLAIM_MS = 5 * 60e3;

export function createDispatcher(app, runtime, { log = console } = {}) {
  const { db } = app;
  const S = () => app.services;
  const inflight = new Set();

  /** Bildirishnoma matni va tugmalari (foydalanuvchi ruxsatiga qarab) */
  function format(n, user) {
    const icon = SEVERITY_ICON[n.severity] || '🔵';
    const html = lines(
      `${icon} <b>${esc(n.title)}</b>`,
      n.body ? esc(n.body) : null,
      '',
      muted(`${ALERT_LABELS[n.type] || n.type} · ${dt(n.created_at)}`),
    );
    const buttons = [];
    if (n.type === 'APPROVAL_WAITING' && n.entity_type === 'approval' && n.entity_id) {
      const a = S().approvals.getFor(n.entity_id, user);
      if (a?.can_act) buttons.push([btn.cb('✅ Tasdiqlash', `apr:ok:${a.id}`), btn.cb('❌ Rad etish', `apr:no:${a.id}`)]);
    }
    const row = [];
    if (n.entity_type) row.push(btn.web('🌐 Ochish', entityPath(n.entity_type, n.entity_id)));
    if (app.rbac.can(user, 'notifications', 'EDIT')) row.push(btn.cb('✅ Ko‘rildi', `nr:${n.parent_id || n.id}`));
    buttons.push(row);
    return { html, buttons };
  }

  /** Qaysi botlar orqali urinib ko'rish: signal → foydalanuvchi ochgan boshqa botlar (auditoriyasiga kirsa) */
  function candidates(user) {
    const started = startedBots(db, user.id).map((x) => x.bot_key);
    const out = [];
    const signal = runtime.get('signal');
    const signalFirst = !started.length || started.includes('signal');
    if (signal?.running && signalFirst) out.push(signal);
    for (const key of started) {
      const b = runtime.get(key);
      if (b?.running && b.key !== 'signal' && b.def.audience.includes(user.role_code)) out.push(b);
    }
    if (signal?.running && !signalFirst) out.push(signal);
    return out;
  }

  const bump = (id, error, minutes) => db.run('UPDATE notifications SET attempts=COALESCE(attempts,0)+1, error=?, next_try_at=? WHERE id=?', String(error).slice(0, 300), new Date(Date.now() + minutes * 60e3).toISOString(), id);

  /**
   * Atomik band qilish: dispatch() va retryPending() (yoki ustma-ust tick'lar) bitta yozuvni parallel yubormasin.
   * Band belgisi — next_try_at = hozir + CLAIM_MS: yuborilsa (sent_at, next_try_at=NULL) yoki bump() uni almashtiradi;
   * jarayon yuborish o'rtasida yiqilsa — band muddati o'tgach retryPending qayta oladi. Qaytaradi: band qilindimi.
   */
  const claim = (id) => db.run("UPDATE notifications SET next_try_at=? WHERE id=? AND channel='TELEGRAM' AND sent_at IS NULL AND (next_try_at IS NULL OR next_try_at <= ?)",
    new Date(Date.now() + CLAIM_MS).toISOString(), id, nowIso()).changes === 1;

  async function deliver(id) {
    const n = db.get("SELECT * FROM notifications WHERE id=? AND channel='TELEGRAM'", id);
    if (!n || n.sent_at) return false;
    if (!claim(id)) return false; // boshqa deliver yuboryapti yoki backoff hali tugamagan
    const user = db.get('SELECT * FROM users WHERE id=?', n.user_id);
    if (!user?.telegram_user_id || !user.is_active) { db.run('UPDATE notifications SET error=?, attempts=99 WHERE id=?', 'Telegram bog‘lanmagan yoki foydalanuvchi bloklangan', id); return false; }
    const list = candidates(user);
    if (!list.length) { bump(id, 'Botlar ishlamayapti', 5); return false; }
    const { html, buttons } = format(n, user);
    let lastErr = null;
    for (const bot of list) {
      try {
        const m = await bot.send(user.telegram_user_id, html, { buttons, canView: (r) => app.rbac.can(user, r, 'VIEW') });
        db.run('UPDATE notifications SET sent_at=?, error=NULL, next_try_at=NULL, bot_key=?, tg_chat_id=?, tg_message_id=?, attempts=COALESCE(attempts,0)+1 WHERE id=?', nowIso(), bot.key, String(user.telegram_user_id), m?.message_id ? String(m.message_id) : null, id);
        return true;
      } catch (e) {
        lastErr = e;
        if (e instanceof TelegramError && e.isUnreachable) { markChatBlocked(db, bot.key, user.telegram_user_id, true); continue; }
        break;
      }
    }
    const unreachable = lastErr instanceof TelegramError && lastErr.isUnreachable;
    bump(id, unreachable ? 'Foydalanuvchi UTAX botlarini ochmagan yoki bloklagan (/start kerak)' : `Yuborilmadi: ${lastErr?.description || lastErr?.message || 'noma’lum'}`, unreachable ? 60 : 2);
    if (!unreachable) log.warn?.(`[bots] bildirishnoma #${id} yuborilmadi: ${lastErr?.message}`);
    return false;
  }

  /** notify() sinxron (ko'pincha db.tx ichida) chaqiradi — yetkazish tranzaksiya tugagach (microtask) boshlanadi, rollback bo'lsa yozuv yo'q → xabar ketmaydi */
  function dispatch(id) {
    const p = Promise.resolve().then(() => deliver(id)).catch((e) => { log.error?.(`[bots] dispatch #${id}:`, e?.stack || e); return false; }).finally(() => inflight.delete(p));
    inflight.add(p);
    return p;
  }

  async function flush() { while (inflight.size) await Promise.allSettled([...inflight]); }

  /** Navbatdagi (yuborilmagan) bildirishnomalar: jim soat tugagan, backoff o'tgan, 24 soatdan yangi */
  async function retryPending({ limit = 30 } = {}) {
    const since = new Date(Date.now() - 24 * 3600e3).toISOString();
    const rows = db.all(`SELECT n.id, n.severity, u.tg_quiet_from, u.tg_quiet_to FROM notifications n JOIN users u ON u.id=n.user_id
      WHERE n.channel='TELEGRAM' AND n.sent_at IS NULL AND COALESCE(n.attempts,0) < 5 AND n.created_at >= ? AND (n.next_try_at IS NULL OR n.next_try_at <= ?) ORDER BY n.id LIMIT ?`, since, nowIso(), limit);
    let sent = 0;
    for (const r of rows) {
      if (r.severity !== 'CRITICAL' && isQuietNow(r)) continue;
      if (await deliver(r.id)) sent++;
    }
    return { checked: rows.length, sent };
  }

  /** CRITICAL → TELEGRAM_ALERT_CHAT_ID guruhiga (signal bot) */
  async function alertChat(n) {
    const chat = config.telegramAlertChat;
    const bot = runtime.get('signal')?.running ? runtime.get('signal') : runtime.list().find((b) => b.running);
    if (!chat || !bot) return false;
    try {
      await bot.send(chat, lines(`🔴 <b>${esc(n.title)}</b>`, n.body ? esc(n.body) : null, muted(`${ALERT_LABELS[n.type] || n.type} · ${dt(nowIso())}`)), { buttons: n.entity_type ? [[{ text: '🌐 Ochish', web: entityPath(n.entity_type, n.entity_id) }]] : undefined, urlButtons: true });
      return true;
    } catch (e) { log.warn?.(`[bots] alert chat: ${e.message}`); return false; }
  }

  return { format, deliver, dispatch, flush, retryPending, alertChat, candidates };
}
