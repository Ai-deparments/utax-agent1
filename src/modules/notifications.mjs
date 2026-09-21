import { badRequest } from '../core/http.mjs';
import { config } from '../core/config.mjs';
import { nowIso } from '../core/util.mjs';

export const ALERT_TYPES = ['PAYMENT_OVERDUE', 'PAYMENT_UPCOMING', 'LARGE_EXPENSE', 'LOW_LIQUIDITY', 'BUDGET_EXCEEDED', 'UNMATCHED_TRANSACTION', 'MISSING_DOCUMENT', 'MISSING_CONTRACT_INFO', 'PAYROLL_READY', 'APPROVAL_WAITING', 'APPROVAL_DECIDED', 'FORECAST_RISK', 'UNUSUAL_TRANSACTION', 'OVERPAYMENT', 'DAILY_DIGEST', 'AI_ACTION', 'REMINDER'];
export const ALERT_LABELS = {
  PAYMENT_OVERDUE: 'To‘lov muddati o‘tdi', PAYMENT_UPCOMING: 'To‘lov yaqinlashmoqda', LARGE_EXPENSE: 'Katta xarajat', LOW_LIQUIDITY: 'Likvidlik past', BUDGET_EXCEEDED: 'Byudjet oshdi',
  UNMATCHED_TRANSACTION: 'Bog‘lanmagan tranzaksiya', MISSING_DOCUMENT: 'Hujjat yetishmaydi', MISSING_CONTRACT_INFO: 'Ma’lumot to‘liq emas', PAYROLL_READY: 'Oylik tayyor',
  APPROVAL_WAITING: 'Tasdiq kutilmoqda', APPROVAL_DECIDED: 'Tasdiq qarori', FORECAST_RISK: 'Prognoz riski', UNUSUAL_TRANSACTION: 'G‘ayrioddiy tranzaksiya', OVERPAYMENT: 'Ortiqcha to‘lov',
  DAILY_DIGEST: 'Kunlik xulosa', AI_ACTION: 'AI harakati', REMINDER: 'Eslatma',
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Toshkent vaqti bo'yicha HH:MM (server qaysi zonada bo'lishidan qat'i nazar) */
export function tashkentHHMM(d = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
/** Jim soatlar: from=22:00, to=08:00 → 22:00–07:59 jim (tun orqali ham ishlaydi) */
export function isQuietNow(user, d = new Date()) {
  const from = user?.tg_quiet_from, to = user?.tg_quiet_to;
  if (!from || !to || from === to) return false;
  const now = tashkentHHMM(d);
  return from < to ? now >= from && now < to : now >= from || now < to;
}

export function register(app) {
  const { r, db, settings } = app;

  async function sendEmail(to, subject, body) {
    if (!config.emailWebhook || !settings.get('notifications.email_enabled')) return { ok: false, error: 'email disabled' };
    try { const res = await fetch(config.emailWebhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, subject, body }) }); return { ok: res.ok }; } catch (e) { return { ok: false, error: e.message }; }
  }
  const telegramAllowed = (userId, type) => (db.get('SELECT telegram FROM notification_prefs WHERE user_id=? AND type=?', userId, type)?.telegram ?? 1) === 1;

  /**
   * CRITICAL → TELEGRAM_ALERT_CHAT_ID guruhi. Guruh uchun alohida dedupe: notifications jadvalida user_id NULL, channel='ALERT',
   * dedupe_key = `${dedupe_key}:alert` yozuvi (foydalanuvchi yozuvlariga bog'liq emas — maqsad rollarda faol foydalanuvchi
   * bo'lmasa ham alert guruhga bir marta yetadi). Yuborilgan bo'lsa (sent_at) — qayta yuborilmaydi; yuborilmasa — shu kalit bilan
   * keyingi notify() da qayta urinadi (backoff, 5 urinish). dedupe_key yo'q bo'lsa — avvalgidek har chaqiruvda.
   */
  const ALERT_MAX_ATTEMPTS = 5;
  const ALERT_LEASE_MS = 2 * 60e3; // yuborish davomida qayta olinmasligi uchun
  const ALERT_RETRY_MS = 5 * 60e3;
  const alertInflight = new Set();
  function claimAlert(n) {
    const now = nowIso();
    const lease = new Date(Date.now() + ALERT_LEASE_MS).toISOString();
    const key = n.dedupe_key ? `${n.dedupe_key}:alert` : null;
    const row = { user_id: null, channel: 'ALERT', type: n.type, severity: n.severity, title: n.title, body: n.body || null, entity_type: n.entity_type || null, entity_id: n.entity_id || null, bot_key: 'signal', tg_chat_id: String(config.telegramAlertChat), attempts: 0, next_try_at: lease, dedupe_key: key, created_at: now };
    if (!key) return db.insert('notifications', row);
    const cols = Object.keys(row);
    const ins = db.run(`INSERT INTO notifications (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')}) ON CONFLICT(dedupe_key) DO NOTHING`, ...cols.map((k) => row[k]));
    if (ins.changes) return ins.lastId;
    // Mavjud: yuborilgan / urinishlar tugagan / yuborilayotgan (lease) bo'lsa — o'tkazib yuboriladi; aks holda atomar qayta olish
    const ex = db.get("SELECT id FROM notifications WHERE dedupe_key=? AND channel='ALERT'", key);
    if (!ex) return null;
    const upd = db.run("UPDATE notifications SET next_try_at=? WHERE id=? AND sent_at IS NULL AND COALESCE(attempts,0) < ? AND (next_try_at IS NULL OR next_try_at <= ?)", lease, ex.id, ALERT_MAX_ATTEMPTS, now);
    return upd.changes ? ex.id : null;
  }
  function sendAlert(n) {
    if (!config.telegramAlertChat || typeof app.bots?.alertChat !== 'function') return;
    const id = claimAlert(n);
    if (!id) return;
    // notify() ko'pincha db.tx ichida — yuborish tranzaksiya tugagach (microtask); rollback bo'lsa yozuv yo'q → xabar ketmaydi
    const p = Promise.resolve()
      .then(async () => {
        if (!db.get("SELECT id FROM notifications WHERE id=? AND channel='ALERT' AND sent_at IS NULL", id)) return;
        let ok = false, err = null;
        try { ok = (await app.bots?.alertChat?.(n)) !== false; } catch (e) { err = e; }
        if (ok) db.run('UPDATE notifications SET sent_at=?, error=NULL, next_try_at=NULL, attempts=COALESCE(attempts,0)+1 WHERE id=?', nowIso(), id);
        else db.run('UPDATE notifications SET attempts=COALESCE(attempts,0)+1, error=?, next_try_at=? WHERE id=?', String(err?.message || 'Alert guruhiga yuborilmadi (bot ishlamayapti yoki chat topilmadi)').slice(0, 300), new Date(Date.now() + ALERT_RETRY_MS).toISOString(), id);
      })
      .catch(() => {})
      .finally(() => alertInflight.delete(p));
    alertInflight.add(p);
  }

  const svc = {
    sendEmail, isQuietNow,
    /** Navbatdagi alert-guruh yuborishlari tugashini kutish (testlar, to'xtatish) */
    async flushAlerts() { while (alertInflight.size) await Promise.allSettled([...alertInflight]); },
    /**
     * notify({user_ids, roles, department_id, type, severity, title, body, entity_type, entity_id, dedupe_key})
     * Har foydalanuvchiga CRM yozuvi; Telegram bog'langan bo'lsa — TELEGRAM kanal yozuvi (parent_id → CRM) va signal bot orqali yetkazish.
     */
    notify(n) {
      const users = new Map();
      for (const id of n.user_ids || []) { const u = db.get('SELECT * FROM users WHERE id=? AND is_active=1', id); if (u) users.set(u.id, u); }
      for (const role of n.roles || []) {
        if (!role) continue;
        const rows = role === 'DEPARTMENT_HEAD' && n.department_id ? db.all('SELECT u.* FROM users u JOIN departments d ON d.head_user_id=u.id WHERE d.id=? AND u.is_active=1', n.department_id) : db.all('SELECT * FROM users WHERE role_code=? AND is_active=1', role);
        for (const u of rows) users.set(u.id, u);
      }
      const created = [];
      const tgEnabled = !!settings.get('notifications.telegram_enabled');
      for (const u of users.values()) {
        const key = n.dedupe_key ? `${n.dedupe_key}:u${u.id}` : null;
        if (key && db.get('SELECT id FROM notifications WHERE dedupe_key=?', key)) continue;
        const base = { user_id: u.id, type: n.type, severity: n.severity || 'INFO', title: n.title, body: n.body || null, entity_type: n.entity_type || null, entity_id: n.entity_id || null, created_at: nowIso() };
        const id = db.insert('notifications', { ...base, channel: 'CRM', dedupe_key: key });
        created.push(id);
        if (tgEnabled && u.telegram_user_id && telegramAllowed(u.id, n.type)) {
          const tid = db.insert('notifications', { ...base, channel: 'TELEGRAM', parent_id: id, bot_key: 'signal', attempts: 0, dedupe_key: key ? key + ':tg' : null });
          // Jim soatda (CRITICAL'dan tashqari) navbatda qoladi — jim soat tugagach bots runtime yuboradi
          if (n.severity === 'CRITICAL' || !isQuietNow(u)) app.bots?.dispatch(tid);
        }
        if (u.email && settings.get('notifications.email_enabled') && (n.severity === 'CRITICAL' || n.type === 'DAILY_DIGEST')) sendEmail(u.email, n.title, n.body || '').catch(() => {});
      }
      if (n.severity === 'CRITICAL') sendAlert(n);
      return created;
    },
    /** {unread, from, to, limit} — from/to: sana oralig'i (web filtri) */
    listFor(userId, { unread, from, to, limit } = {}) {
      const w = ['user_id=?', "channel='CRM'"], p = [userId];
      if (unread) w.push('is_read=0');
      if (from) { w.push('substr(created_at,1,10)>=?'); p.push(from); }
      if (to) { w.push('substr(created_at,1,10)<=?'); p.push(to); }
      const lim = Math.min(1000, Math.max(1, Number(limit) || (from || to ? 1000 : 200)));
      return db.all(`SELECT * FROM notifications WHERE ${w.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ${lim}`, ...p);
    },
    unreadCount(userId) { return db.get("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND channel='CRM' AND is_read=0", userId).n; },
    /** {ids:[...]} yoki {all:true}; faqat o'z bildirishnomalari */
    markRead(userId, { ids, all } = {}) {
      if (all) return db.run("UPDATE notifications SET is_read=1 WHERE user_id=? AND channel='CRM' AND is_read=0", userId).changes;
      let n = 0;
      for (const id of ids || []) n += db.run("UPDATE notifications SET is_read=1 WHERE id=? AND user_id=? AND channel='CRM'", id, userId).changes;
      return n;
    },
    prefs(userId) {
      const rows = Object.fromEntries(db.all('SELECT type, telegram FROM notification_prefs WHERE user_id=?', userId).map((x) => [x.type, x.telegram]));
      const u = db.get('SELECT tg_quiet_from, tg_quiet_to FROM users WHERE id=?', userId);
      return { types: ALERT_TYPES.map((type) => ({ type, label: ALERT_LABELS[type] || type, telegram: (rows[type] ?? 1) === 1 })), quiet: u?.tg_quiet_from && u?.tg_quiet_to ? { from: u.tg_quiet_from, to: u.tg_quiet_to } : null };
    },
    /** {types: {TYPE: bool}, quiet: {from:'22:00', to:'08:00'} | null} */
    setPrefs(userId, { types, quiet } = {}, ctx) {
      db.tx(() => {
        for (const [type, on] of Object.entries(types || {})) {
          if (!ALERT_TYPES.includes(type)) throw badRequest('Noma’lum bildirishnoma turi: ' + type);
          db.run('INSERT INTO notification_prefs (user_id, type, telegram) VALUES (?,?,?) ON CONFLICT(user_id, type) DO UPDATE SET telegram=excluded.telegram', userId, type, on ? 1 : 0);
        }
        if (quiet !== undefined) {
          if (quiet && (!HHMM.test(quiet.from || '') || !HHMM.test(quiet.to || ''))) throw badRequest('Jim soatlar HH:MM formatida bo‘lishi kerak');
          db.run('UPDATE users SET tg_quiet_from=?, tg_quiet_to=? WHERE id=?', quiet?.from || null, quiet?.to || null, userId);
        }
      });
      app.audit(ctx, { action: 'NOTIFICATION_PREFS', entity: 'user', entityId: userId, newValue: { types, quiet } });
      return svc.prefs(userId);
    },
  };
  app.services.notifications = svc;

  r.get('/api/notifications', { perm: ['notifications', 'VIEW'], tags: ['notifications'], summary: 'Mening bildirishnomalarim', query: ['unread', 'from', 'to'] }, async (ctx) => ({ items: svc.listFor(ctx.user.id, { unread: ctx.query.unread === '1', from: ctx.query.from, to: ctx.query.to }), unread: svc.unreadCount(ctx.user.id) }));
  r.post('/api/notifications/read', { perm: ['notifications', 'EDIT'], tags: ['notifications'], summary: 'O‘qilgan deb belgilash {ids | all}' }, async (ctx) => { svc.markRead(ctx.user.id, { ids: ctx.body?.ids, all: !!ctx.body?.all }); return { ok: true }; });
  r.get('/api/notifications/types', { tags: ['notifications'], summary: 'Alert turlari' }, async () => ALERT_TYPES);
  r.get('/api/notifications/prefs', { perm: ['notifications', 'VIEW'], tags: ['notifications'], summary: 'Telegram bildirishnoma sozlamalari (turlar, jim soatlar)' }, async (ctx) => svc.prefs(ctx.user.id));
  r.put('/api/notifications/prefs', { perm: ['notifications', 'EDIT'], tags: ['notifications'], summary: 'Sozlamalarni saqlash {types:{TYPE:bool}, quiet:{from,to}|null}' }, async (ctx) => svc.setPrefs(ctx.user.id, ctx.body || {}, ctx));
  r.post('/api/notifications/test', { perm: ['settings', 'EDIT'], tags: ['notifications'], summary: 'Test bildirishnoma (o‘zimga)' }, async (ctx) => {
    const ids = svc.notify({ user_ids: [ctx.user.id], type: 'DAILY_DIGEST', title: 'Test bildirishnoma', body: 'UTAX Finance CRM notification engine ishlayapti.' });
    return { ok: true, created: ids.length, telegram: !!ctx.user.telegram_user_id && !!app.bots?.running() };
  });
  r.get('/api/notifications/log', { perm: ['audit', 'VIEW'], tags: ['notifications'], summary: 'Barcha yuborilgan bildirishnomalar (admin)', query: ['from', 'to'] }, async (ctx) => { const { from, to } = ctx.query; const w = [], p = []; if (from) { w.push('substr(n.created_at,1,10)>=?'); p.push(from); } if (to) { w.push('substr(n.created_at,1,10)<=?'); p.push(to); } return db.all(`SELECT n.*, u.name AS user_name FROM notifications n LEFT JOIN users u ON u.id=n.user_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY n.created_at DESC LIMIT ${w.length ? 2000 : 300}`, ...p); });
}
