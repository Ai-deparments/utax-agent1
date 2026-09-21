import { badRequest, notFound } from '../core/http.mjs';
import { config } from '../core/config.mjs';
import { botCatalog } from '../bots/index.mjs';
import { webLinks } from '../bots/shared/keyboards.mjs';

/** Telegram botlar — web panel uchun: holat, mening bog'lanishim, test xabar, kim qaysi botda (admin). */
export function register(app) {
  const { r, db, audit } = app;

  r.get('/api/bots', { tags: ['bots'], summary: '4 ta Telegram bot: holat, buyruqlar, mening bog‘lanishim' }, async (ctx) => {
    const admin = app.rbac.can(ctx.user, 'settings', 'VIEW');
    const status = Object.fromEntries((app.bots?.status() || []).map((s) => [s.key, s]));
    const me = db.get('SELECT telegram_user_id, telegram_username, telegram_linked_at, telegram_link_code, telegram_link_expires FROM users WHERE id=?', ctx.user.id);
    const started = Object.fromEntries(db.all('SELECT bot_key, started_at, last_seen_at, blocked_at FROM bot_chats WHERE user_id=?', ctx.user.id).map((x) => [x.bot_key, x]));
    const links = webLinks(config);
    return {
      mode: config.botMode,
      running: !!app.bots?.running(),
      webapp: { enabled: links.enabled, mini_app: links.miniApp, base: links.base || null },
      me: { linked: !!me?.telegram_user_id, telegram_username: me?.telegram_username || null, linked_at: me?.telegram_linked_at || null, pending_code: me?.telegram_link_code && me?.telegram_link_expires > new Date().toISOString() ? me.telegram_link_code : null },
      bots: botCatalog(app).map((b) => {
        const s = status[b.key] || {};
        const allowed = b.allowed_roles.includes(ctx.user.role_code);
        return {
          key: b.key, title: b.title, about: b.about, username: b.username, url: `https://t.me/${b.username}`, configured: b.configured, running: !!s.running, allowed,
          started: started[b.key] ? { at: started[b.key].started_at, last_seen_at: started[b.key].last_seen_at, blocked: !!started[b.key].blocked_at } : null,
          commands: allowed ? b.commands.filter((c) => (!c.roles || c.roles.includes(ctx.user.role_code)) && (!c.perm || app.rbac.can(ctx.user, c.perm[0], c.perm[1] || 'VIEW'))) : [],
          ...(admin ? { allowed_roles: b.allowed_roles, last_update_at: s.last_update_at || null, last_poll_at: s.last_poll_at || null, last_error: s.last_error || null, handled: s.handled || 0, started_at: s.started_at || null, users: db.get('SELECT COUNT(*) n FROM bot_chats WHERE bot_key=? AND user_id IS NOT NULL AND blocked_at IS NULL', b.key).n } : {}),
        };
      }),
    };
  });

  r.post('/api/bots/:key/test', { tags: ['bots'], summary: 'Shu bot orqali o‘zimga test xabar' }, async (ctx) => {
    const b = botCatalog(app).find((x) => x.key === ctx.params.key);
    if (!b) throw notFound('Bot topilmadi');
    if (!b.allowed_roles.includes(ctx.user.role_code)) throw badRequest('Bu bot sizning rolingiz uchun emas');
    if (!app.bots?.get(b.key)?.running) throw badRequest('Bot ishlamayapti (token yoki BOT_MODE ni tekshiring)');
    const res = await app.bots.send(b.key, ctx.user.id, `🧪 <b>Test xabar</b>\n${b.title} ishlayapti. Web panel bilan ulanish ✅`, { buttons: [[{ text: '🌐 Web panel', web: 'dashboard' }]] });
    audit(ctx, { action: 'BOT_TEST', entity: 'bot', newValue: { bot: b.key, ok: res.ok, error: res.error || null } });
    if (!res.ok) throw badRequest(res.error === 'Telegram bog‘lanmagan' ? 'Avval Telegram hisobingizni ulang' : `Yuborilmadi: ${res.error}. Botni Telegram’da oching va «Start» ni bosing.`);
    return { ok: true };
  });

  r.get('/api/bots/chats', { perm: ['settings', 'VIEW'], tags: ['bots'], summary: 'Kim qaysi botdan foydalanadi (admin)' }, async () =>
    db.all(`SELECT bc.bot_key, bc.started_at, bc.last_seen_at, bc.blocked_at, bc.tg_username, u.id AS user_id, u.name, u.email, u.role_code FROM bot_chats bc LEFT JOIN users u ON u.id=bc.user_id ORDER BY bc.last_seen_at DESC LIMIT 500`));

  r.get('/api/bots/linked-users', { perm: ['settings', 'VIEW'], tags: ['bots'], summary: 'Telegram bog‘langan foydalanuvchilar' }, async () =>
    db.all('SELECT id, name, email, role_code, telegram_username, telegram_linked_at, is_active FROM users WHERE telegram_user_id IS NOT NULL ORDER BY name'));
}
