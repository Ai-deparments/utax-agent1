import { badRequest } from '../core/http.mjs';
import { config } from '../core/config.mjs';
import { nowIso } from '../core/util.mjs';

export const ALERT_TYPES = ['PAYMENT_OVERDUE', 'PAYMENT_UPCOMING', 'LARGE_EXPENSE', 'LOW_LIQUIDITY', 'BUDGET_EXCEEDED', 'UNMATCHED_TRANSACTION', 'MISSING_DOCUMENT', 'MISSING_CONTRACT_INFO', 'PAYROLL_READY', 'APPROVAL_WAITING', 'APPROVAL_DECIDED', 'FORECAST_RISK', 'UNUSUAL_TRANSACTION', 'OVERPAYMENT', 'DAILY_DIGEST', 'AI_ACTION'];

export function register(app) {
  const { r, db, settings } = app;

  async function sendTelegram(chatId, text, extra = {}) {
    if (!config.telegramToken || !chatId) return { ok: false, error: 'no token/chat' };
    try {
      const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }) });
      const j = await res.json();
      return j.ok ? { ok: true } : { ok: false, error: j.description };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  async function sendEmail(to, subject, body) {
    if (!config.emailWebhook || !settings.get('notifications.email_enabled')) return { ok: false, error: 'email disabled' };
    try { const res = await fetch(config.emailWebhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, subject, body }) }); return { ok: res.ok }; } catch (e) { return { ok: false, error: e.message }; }
  }
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const svc = {
    sendTelegram, sendEmail,
    /** notify({user_ids, roles, department_id, type, severity, title, body, entity_type, entity_id, dedupe_key}) */
    notify(n) {
      const users = new Map();
      for (const id of n.user_ids || []) { const u = db.get('SELECT * FROM users WHERE id=? AND is_active=1', id); if (u) users.set(u.id, u); }
      for (const role of n.roles || []) {
        const rows = role === 'DEPARTMENT_HEAD' && n.department_id ? db.all('SELECT u.* FROM users u JOIN departments d ON d.head_user_id=u.id WHERE d.id=? AND u.is_active=1', n.department_id) : db.all('SELECT * FROM users WHERE role_code=? AND is_active=1', role);
        for (const u of rows) users.set(u.id, u);
      }
      const created = [];
      for (const u of users.values()) {
        const key = n.dedupe_key ? `${n.dedupe_key}:u${u.id}` : null;
        if (key && db.get('SELECT id FROM notifications WHERE dedupe_key=?', key)) continue;
        const id = db.insert('notifications', { user_id: u.id, channel: 'CRM', type: n.type, severity: n.severity || 'INFO', title: n.title, body: n.body || null, entity_type: n.entity_type || null, entity_id: n.entity_id || null, dedupe_key: key, created_at: nowIso() });
        created.push(id);
        if (u.telegram_chat_id && settings.get('notifications.telegram_enabled') && config.telegramToken) {
          const tid = db.insert('notifications', { user_id: u.id, channel: 'TELEGRAM', type: n.type, severity: n.severity || 'INFO', title: n.title, body: n.body || null, entity_type: n.entity_type || null, entity_id: n.entity_id || null, dedupe_key: key ? key + ':tg' : null, created_at: nowIso() });
          const icon = { CRITICAL: '🔴', WARNING: '🟡', INFO: '🔵' }[n.severity || 'INFO'] || '🔵';
          sendTelegram(u.telegram_chat_id, `${icon} <b>${esc(n.title)}</b>\n${esc(n.body || '')}`).then((res) => db.run('UPDATE notifications SET sent_at=?, error=? WHERE id=?', res.ok ? nowIso() : null, res.ok ? null : res.error, tid));
        }
        if (u.email && settings.get('notifications.email_enabled') && (n.severity === 'CRITICAL' || n.type === 'DAILY_DIGEST')) sendEmail(u.email, n.title, n.body || '').catch(() => {});
      }
      if (n.severity === 'CRITICAL' && config.telegramAlertChat) sendTelegram(config.telegramAlertChat, `🔴 <b>${esc(n.title)}</b>\n${esc(n.body || '')}`).catch(() => {});
      return created;
    },
    listFor(userId, { unread } = {}) {
      return db.all(`SELECT * FROM notifications WHERE user_id=? AND channel='CRM' ${unread ? 'AND is_read=0' : ''} ORDER BY created_at DESC LIMIT 200`, userId);
    },
  };
  app.services.notifications = svc;

  r.get('/api/notifications', { perm: ['notifications', 'VIEW'], tags: ['notifications'], summary: 'Mening bildirishnomalarim', query: ['unread'] }, async (ctx) => ({ items: svc.listFor(ctx.user.id, { unread: ctx.query.unread === '1' }), unread: db.get("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND channel='CRM' AND is_read=0", ctx.user.id).n }));
  r.post('/api/notifications/read', { perm: ['notifications', 'EDIT'], tags: ['notifications'], summary: 'O‘qilgan deb belgilash {ids | all}' }, async (ctx) => {
    if (ctx.body?.all) db.run("UPDATE notifications SET is_read=1 WHERE user_id=? AND channel='CRM'", ctx.user.id);
    else for (const id of ctx.body?.ids || []) db.run('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?', id, ctx.user.id);
    return { ok: true };
  });
  r.get('/api/notifications/types', { tags: ['notifications'], summary: 'Alert turlari' }, async () => ALERT_TYPES);
  r.post('/api/notifications/test', { perm: ['settings', 'EDIT'], tags: ['notifications'], summary: 'Test bildirishnoma (o‘zimga)' }, async (ctx) => {
    const ids = svc.notify({ user_ids: [ctx.user.id], type: 'DAILY_DIGEST', title: 'Test bildirishnoma', body: 'UTAX Finance CRM notification engine ishlayapti.' });
    return { ok: true, created: ids.length, telegram: !!ctx.user.telegram_chat_id && !!config.telegramToken };
  });
  r.get('/api/notifications/log', { perm: ['audit', 'VIEW'], tags: ['notifications'], summary: 'Barcha yuborilgan bildirishnomalar (admin)' }, async () => db.all('SELECT n.*, u.name AS user_name FROM notifications n LEFT JOIN users u ON u.id=n.user_id ORDER BY n.created_at DESC LIMIT 300'));
}
