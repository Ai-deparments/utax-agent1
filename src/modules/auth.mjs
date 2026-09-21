import { hashPassword, verifyPassword, signJwt, verifyJwt, totpSecret, totpVerify, otpauthUrl } from '../core/auth.mjs';
import { badRequest, unauthorized, forbidden, rateLimiter } from '../core/http.mjs';
import { config } from '../core/config.mjs';
import { nowIso, sha256, uid, addDays } from '../core/util.mjs';

export function register(app) {
  const { r, db, audit } = app;
  const loginLimit = rateLimiter({ windowMs: 60_000, max: 10 });

  const publicUser = (u) => u && ({
    id: u.id, email: u.email, name: u.name, role_code: u.role_code, department_id: u.department_id,
    phone: u.phone, totp_enabled: !!u.totp_enabled, telegram_linked: !!u.telegram_chat_id, last_login_at: u.last_login_at,
  });

  function issueTokens(user, ctx) {
    const access = signJwt({ sub: user.id, role: user.role_code, typ: 'access' }, config.accessTtl);
    const refresh = uid(32);
    db.insert('sessions', {
      user_id: user.id, refresh_hash: sha256(refresh), ip: ctx.ip, user_agent: String(ctx.req?.headers['user-agent'] || '').slice(0, 200),
      expires_at: new Date(Date.now() + config.refreshTtl * 1000).toISOString(), created_at: nowIso(),
    });
    return { access_token: access, refresh_token: refresh, expires_in: config.accessTtl, token_type: 'Bearer' };
  }

  app.services.auth = {
    /** Authorization: Bearer <jwt> yoki X-Api-Key (AI agent) */
    resolveUser(req) {
      const h = String(req.headers['authorization'] || '');
      if (h.startsWith('Bearer ')) {
        const p = verifyJwt(h.slice(7));
        if (!p || p.typ !== 'access') return null;
        const u = db.get('SELECT * FROM users WHERE id=? AND is_active=1', p.sub);
        return u || null;
      }
      const key = req.headers['x-api-key'];
      if (key) {
        const ag = db.get('SELECT * FROM ai_agents WHERE api_key_hash=? AND is_active=1', sha256(key));
        if (ag) return { id: null, name: ag.name, role_code: 'AI_AGENT', agent_code: ag.code, is_agent: true };
      }
      return null;
    },
    publicUser,
  };

  r.post('/api/auth/login', { auth: false, tags: ['auth'], summary: 'Login (email + parol); 2FA yoqilgan bo‘lsa temp token qaytaradi' }, async (ctx) => {
    if (!loginLimit(ctx.ip)) throw new Error('RATE_LIMIT');
    const { email, password } = ctx.body || {};
    if (!email || !password) throw badRequest('Email va parol talab qilinadi');
    const u = db.get('SELECT * FROM users WHERE lower(email)=lower(?)', String(email).trim());
    if (!u || !u.is_active || !verifyPassword(password, u.password_hash)) {
      audit(ctx, { action: 'LOGIN_FAILED', entity: 'user', entityId: u?.id, newValue: { email } });
      throw unauthorized('Email yoki parol noto‘g‘ri');
    }
    if (u.totp_enabled) {
      const temp = signJwt({ sub: u.id, typ: '2fa' }, 300);
      return { requires_2fa: true, temp_token: temp };
    }
    db.run('UPDATE users SET last_login_at=? WHERE id=?', nowIso(), u.id);
    audit({ ...ctx, user: u }, { action: 'LOGIN', entity: 'user', entityId: u.id });
    return { ...issueTokens(u, ctx), user: publicUser(u) };
  });

  r.post('/api/auth/2fa/verify', { auth: false, tags: ['auth'], summary: '2FA kodini tekshirish (temp token bilan)' }, async (ctx) => {
    const { temp_token, code } = ctx.body || {};
    const p = verifyJwt(temp_token);
    if (!p || p.typ !== '2fa') throw unauthorized('Temp token yaroqsiz');
    const u = db.get('SELECT * FROM users WHERE id=? AND is_active=1', p.sub);
    if (!u || !totpVerify(u.totp_secret, code)) throw unauthorized('2FA kodi noto‘g‘ri');
    db.run('UPDATE users SET last_login_at=? WHERE id=?', nowIso(), u.id);
    audit({ ...ctx, user: u }, { action: 'LOGIN_2FA', entity: 'user', entityId: u.id });
    return { ...issueTokens(u, ctx), user: publicUser(u) };
  });

  r.post('/api/auth/refresh', { auth: false, tags: ['auth'], summary: 'Refresh token orqali yangi access token' }, async (ctx) => {
    const { refresh_token } = ctx.body || {};
    if (!refresh_token) throw badRequest('refresh_token kerak');
    const s = db.get('SELECT * FROM sessions WHERE refresh_hash=? AND revoked_at IS NULL', sha256(refresh_token));
    if (!s || s.expires_at < nowIso()) throw unauthorized('Sessiya muddati tugagan');
    const u = db.get('SELECT * FROM users WHERE id=? AND is_active=1', s.user_id);
    if (!u) throw unauthorized();
    db.run('UPDATE sessions SET revoked_at=? WHERE id=?', nowIso(), s.id); // rotation
    return { ...issueTokens(u, ctx), user: publicUser(u) };
  });

  r.post('/api/auth/logout', { tags: ['auth'], summary: 'Logout (refresh tokenni bekor qilish)' }, async (ctx) => {
    const { refresh_token } = ctx.body || {};
    if (refresh_token) db.run('UPDATE sessions SET revoked_at=? WHERE refresh_hash=?', nowIso(), sha256(refresh_token));
    audit(ctx, { action: 'LOGOUT', entity: 'user', entityId: ctx.user.id });
    return { ok: true };
  });

  r.get('/api/auth/me', { tags: ['auth'], summary: 'Joriy foydalanuvchi + ruxsatlar' }, async (ctx) => {
    const perms = app.rbac.matrix()[ctx.user.role_code] || {};
    const dept = ctx.user.department_id ? db.get('SELECT id,name,code FROM departments WHERE id=?', ctx.user.department_id) : null;
    return { user: publicUser(ctx.user), permissions: perms, department: dept, settings: { company: app.settings.get('company.name'), currency: app.settings.get('company.base_currency') } };
  });

  r.post('/api/auth/password', { tags: ['auth'], summary: 'Parolni o‘zgartirish' }, async (ctx) => {
    const { current_password, new_password } = ctx.body || {};
    if (!verifyPassword(current_password, ctx.user.password_hash)) throw badRequest('Joriy parol noto‘g‘ri');
    if (!new_password || String(new_password).length < 8) throw badRequest('Yangi parol kamida 8 belgi');
    db.run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(new_password), ctx.user.id);
    audit(ctx, { action: 'PASSWORD_CHANGED', entity: 'user', entityId: ctx.user.id });
    return { ok: true };
  });

  r.post('/api/auth/2fa/setup', { tags: ['auth'], summary: '2FA sozlash — secret va otpauth URL' }, async (ctx) => {
    const secret = totpSecret();
    db.run('UPDATE users SET totp_secret=?, totp_enabled=0 WHERE id=?', secret, ctx.user.id);
    return { secret, otpauth_url: otpauthUrl(secret, ctx.user.email, app.settings.get('company.name') + ' Finance') };
  });
  r.post('/api/auth/2fa/enable', { tags: ['auth'], summary: '2FA ni yoqish (kod tekshiriladi)' }, async (ctx) => {
    const u = db.get('SELECT * FROM users WHERE id=?', ctx.user.id);
    if (!u.totp_secret || !totpVerify(u.totp_secret, ctx.body?.code)) throw badRequest('Kod noto‘g‘ri');
    db.run('UPDATE users SET totp_enabled=1 WHERE id=?', u.id);
    audit(ctx, { action: '2FA_ENABLED', entity: 'user', entityId: u.id });
    return { ok: true };
  });
  r.post('/api/auth/2fa/disable', { tags: ['auth'], summary: '2FA ni o‘chirish' }, async (ctx) => {
    if (!verifyPassword(ctx.body?.password, ctx.user.password_hash)) throw forbidden('Parol noto‘g‘ri');
    db.run('UPDATE users SET totp_enabled=0, totp_secret=NULL WHERE id=?', ctx.user.id);
    audit(ctx, { action: '2FA_DISABLED', entity: 'user', entityId: ctx.user.id });
    return { ok: true };
  });

  r.post('/api/auth/telegram-link', { tags: ['auth'], summary: 'Telegram bog‘lash kodi (botga /start KOD)' }, async (ctx) => {
    const code = uid(4).toUpperCase();
    db.run('UPDATE users SET telegram_link_code=? WHERE id=?', code, ctx.user.id);
    return { code, instruction: `Telegram botga yuboring: /start ${code}`, expires: addDays(nowIso().slice(0, 10), 1) };
  });
}
