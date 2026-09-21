import { hashPassword, verifyPassword, signJwt, verifyJwt, totpSecret, totpVerify, otpauthUrl } from '../core/auth.mjs';
import { badRequest, unauthorized, forbidden, rateLimiter } from '../core/http.mjs';
import { config } from '../core/config.mjs';
import { nowIso, sha256, uid } from '../core/util.mjs';
import { verifyInitData } from '../bots/shared/webapp-auth.mjs';
import { revokeTelegramSessions, detachTelegram } from '../bots/shared/auth.mjs';

/** Mini App initData yangi bo'lsin: 1 soatdan eski imzo qabul qilinmaydi (Telegram har ochilishda yangisini beradi) */
export const WEBAPP_INIT_MAX_AGE_SEC = 3600;

export function register(app) {
  const { r, db, audit } = app;
  const loginLimit = rateLimiter({ windowMs: 60_000, max: 10 });
  // 2FA kodi: bitta foydalanuvchiga daqiqasiga 5 urinish (temp token qayta olinsa ham — 6 raqamni tanlab bo'lmaydi)
  const twoFaLimit = rateLimiter({ windowMs: 60_000, max: 5 });
  // Mini App: IP bo'yicha keng (ofis NAT — ko'p xodim bitta IP), initData tekshirilgach — Telegram hisobi bo'yicha alohida
  const webappIpLimit = rateLimiter({ windowMs: 60_000, max: 60 });
  const webappTgLimit = rateLimiter({ windowMs: 60_000, max: 10 });

  const publicUser = (u) => u && ({
    id: u.id, email: u.email, name: u.name, role_code: u.role_code, department_id: u.department_id,
    phone: u.phone, totp_enabled: !!u.totp_enabled, telegram_linked: !!u.telegram_user_id, telegram_username: u.telegram_username || null, last_login_at: u.last_login_at,
  });

  /**
   * Sessiya + tokenlar. opts.source: 'WEB' (default) | 'TELEGRAM' (Mini App, opts.tgUserId bilan).
   * TELEGRAM sessiyasining access tokeni Telegram hisobiga bog'langan (tg): uzilsa / boshqa hisobga o'tsa — darhol yaroqsiz
   * (sessiya qatoriga emas — refresh rotatsiyasi parallel so'rovlardagi tokenni o'ldirmasin).
   */
  function issueTokens(user, ctx, { source = 'WEB', tgUserId = null } = {}) {
    const refresh = uid(32);
    const tg = source === 'TELEGRAM' && tgUserId ? String(tgUserId) : null;
    db.insert('sessions', {
      user_id: user.id, refresh_hash: sha256(refresh), ip: ctx.ip, user_agent: String(ctx.req?.headers['user-agent'] || '').slice(0, 200),
      expires_at: new Date(Date.now() + config.refreshTtl * 1000).toISOString(), created_at: nowIso(), source, tg_user_id: tg,
    });
    const access = signJwt({ sub: user.id, role: user.role_code, typ: 'access', ...(source === 'TELEGRAM' ? { src: 'TELEGRAM', tg } : {}) }, config.accessTtl);
    return { access_token: access, refresh_token: refresh, expires_in: config.accessTtl, token_type: 'Bearer' };
  }
  /** TELEGRAM sessiyasi faqat foydalanuvchi hali shu Telegram hisobiga bog'langan bo'lsa amal qiladi */
  const telegramSessionOk = (s, u) => s.source !== 'TELEGRAM' || (!!s.tg_user_id && s.tg_user_id === u.telegram_user_id);

  app.services.auth = {
    /** Authorization: Bearer <jwt> yoki X-Api-Key (AI agent) */
    resolveUser(req) {
      const h = String(req.headers['authorization'] || '');
      if (h.startsWith('Bearer ')) {
        const p = verifyJwt(h.slice(7));
        if (!p || p.typ !== 'access') return null;
        const u = db.get('SELECT * FROM users WHERE id=? AND is_active=1', p.sub);
        if (!u) return null;
        // Mini App tokeni: foydalanuvchi hali shu Telegram hisobiga bog'langan bo'lishi shart
        if (p.src === 'TELEGRAM' && !telegramSessionOk({ source: 'TELEGRAM', tg_user_id: p.tg ? String(p.tg) : null }, u)) return null;
        return u;
      }
      const key = req.headers['x-api-key'];
      if (key) {
        const ag = db.get('SELECT * FROM ai_agents WHERE api_key_hash=? AND is_active=1', sha256(key));
        if (ag) return { id: null, name: ag.name, role_code: 'AI_AGENT', agent_code: ag.code, is_agent: true };
      }
      return null;
    },
    publicUser,
    issueTokens,
  };

  r.post('/api/auth/login', { auth: false, tags: ['auth'], summary: 'Login (email + parol); 2FA yoqilgan bo‘lsa temp token qaytaradi' }, async (ctx) => {
    // Cheklov IP + email bo'yicha: bir ofis (bitta IP) xodimlari bir-birini bloklamaydi, bitta hisobni parol tanlash bilan buzish esa to'xtatiladi
    if (!loginLimit(`${ctx.ip}|${String(ctx.body?.email || '').toLowerCase()}`)) throw new Error('RATE_LIMIT');
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
    if (!twoFaLimit(`2fa|${p.sub}`)) throw new Error('RATE_LIMIT');
    const u = db.get('SELECT * FROM users WHERE id=? AND is_active=1', p.sub);
    // Mini App oqimi: temp token Telegram hisobiga bog'langan — oraliqda uzilgan/boshqaga o'tgan bo'lsa rad
    const viaTelegram = p.src === 'TELEGRAM';
    if (u && viaTelegram && (!p.tg || u.telegram_user_id !== String(p.tg))) throw unauthorized('Telegram bog‘lanishi o‘zgargan — Mini App’ni qayta oching');
    if (!u || !totpVerify(u.totp_secret, code)) {
      audit({ ...ctx, user: u || null, ...(viaTelegram ? { source: 'TELEGRAM' } : {}) }, { action: 'LOGIN_2FA_FAILED', entity: 'user', entityId: u?.id ?? p.sub, newValue: viaTelegram ? { via: 'TELEGRAM_WEBAPP', bot: p.bot || null } : undefined });
      throw unauthorized('2FA kodi noto‘g‘ri');
    }
    db.run('UPDATE users SET last_login_at=? WHERE id=?', nowIso(), u.id);
    if (viaTelegram) {
      audit({ ...ctx, user: u, source: 'TELEGRAM' }, { action: 'LOGIN_TELEGRAM_WEBAPP', entity: 'user', entityId: u.id, newValue: { bot: p.bot || null, two_factor: true } });
      return { ...issueTokens(u, ctx, { source: 'TELEGRAM', tgUserId: p.tg }), user: publicUser(u) };
    }
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
    if (!telegramSessionOk(s, u)) throw unauthorized('Telegram bog‘lanishi o‘zgargan — qayta kiring');
    // Yangi sessiya eskisining manbasini meros oladi (Mini App sessiyasi rotatsiyadan keyin ham Telegram'ga bog'liq qoladi)
    return { ...issueTokens(u, ctx, { source: s.source || 'WEB', tgUserId: s.tg_user_id }), user: publicUser(u) };
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

  const LINK_TTL_MS = 24 * 3600e3;
  r.post('/api/auth/telegram-link', { tags: ['auth'], summary: 'Telegram bog‘lash kodi + 4 bot uchun deep link (t.me/<bot>?start=KOD)' }, async (ctx) => {
    const code = uid(6).toUpperCase(); // 12 hex (48 bit) — bot LINK_CODE_RE bilan mos
    const expires = new Date(Date.now() + LINK_TTL_MS).toISOString();
    db.run('UPDATE users SET telegram_link_code=?, telegram_link_expires=? WHERE id=?', code, expires, ctx.user.id);
    audit(ctx, { action: 'TELEGRAM_LINK_CODE', entity: 'user', entityId: ctx.user.id });
    const links = (app.botCatalog?.() || []).filter((b) => b.allowed_roles.includes(ctx.user.role_code)).map((b) => ({ key: b.key, title: b.title, username: b.username, url: `https://t.me/${b.username}?start=${code}` }));
    return { code, expires_at: expires, links, instruction: `Botni oching va «Start» ni bosing (yoki yuboring: /start ${code}). Bitta bog‘lash barcha UTAX botlariga amal qiladi.` };
  });
  r.post('/api/auth/telegram-unlink', { tags: ['auth'], summary: 'Telegram hisobini uzish' }, async (ctx) => {
    const u = db.get('SELECT telegram_user_id FROM users WHERE id=?', ctx.user.id);
    let revoked = 0;
    db.tx(() => {
      revoked = detachTelegram(db, ctx.user.id, u?.telegram_user_id || null);
      db.run('UPDATE users SET telegram_link_code=NULL, telegram_link_expires=NULL WHERE id=?', ctx.user.id);
      db.run('UPDATE bot_chats SET user_id=NULL WHERE user_id=?', ctx.user.id);
      // Telegram (Mini App) orqali ochilgan barcha sessiyalar — shu so'rovnikini ham — yopiladi
      revoked += revokeTelegramSessions(db, ctx.user.id);
    });
    audit(ctx, { action: 'TELEGRAM_UNLINKED', entity: 'user', entityId: ctx.user.id, oldValue: { telegram_user_id: u?.telegram_user_id || null }, newValue: { revoked_sessions: revoked } });
    return { ok: true };
  });
  /** Telegram Mini App: initData (HMAC, bot tokeni bilan imzolangan) → shu Telegram hisobiga bog'langan foydalanuvchi sessiyasi */
  r.post('/api/auth/telegram-webapp', { auth: false, tags: ['auth'], summary: 'Telegram Mini App orqali kirish {init_data}' }, async (ctx) => {
    if (!webappIpLimit(ctx.ip)) throw new Error('RATE_LIMIT');
    const initData = String(ctx.body?.init_data || '');
    if (!initData) throw badRequest('init_data kerak');
    let verified = null, botKey = null;
    for (const [key, token] of Object.entries(config.bots)) {
      if (!token) continue;
      verified = verifyInitData(initData, token, { maxAgeSec: WEBAPP_INIT_MAX_AGE_SEC });
      if (verified) { botKey = key; break; }
    }
    if (!verified) {
      audit(ctx, { action: 'TELEGRAM_WEBAPP_DENIED', entity: 'user', newValue: { reason: 'invalid_init_data' } });
      throw unauthorized('Telegram ma’lumotlari tasdiqlanmadi');
    }
    const tgUserId = String(verified.user.id);
    if (!webappTgLimit(`tg|${tgUserId}`)) throw new Error('RATE_LIMIT');
    const u = db.get('SELECT * FROM users WHERE telegram_user_id=?', tgUserId);
    if (!u || !u.is_active) {
      audit(ctx, { action: 'TELEGRAM_WEBAPP_DENIED', entity: 'user', entityId: u?.id, newValue: { telegram_user_id: verified.user.id, reason: u ? 'blocked' : 'not_linked' } });
      throw unauthorized(u ? 'Hisobingiz bloklangan' : 'Telegram hisobingiz UTAX foydalanuvchisiga bog‘lanmagan. Web → Sozlamalar → Profil → Telegram botlar.');
    }
    // 2FA yoqilgan — parol bilan kirish kabi: to'liq token emas, temp token (kod /api/auth/2fa/verify da tekshiriladi)
    if (u.totp_enabled) {
      const temp = signJwt({ sub: u.id, typ: '2fa', src: 'TELEGRAM', tg: tgUserId, bot: botKey }, 300);
      return { requires_2fa: true, temp_token: temp, start_param: verified.start_param || null };
    }
    db.run('UPDATE users SET last_login_at=? WHERE id=?', nowIso(), u.id);
    audit({ ...ctx, user: u, source: 'TELEGRAM' }, { action: 'LOGIN_TELEGRAM_WEBAPP', entity: 'user', entityId: u.id, newValue: { bot: botKey } });
    return { ...issueTokens(u, ctx, { source: 'TELEGRAM', tgUserId }), user: publicUser(u), start_param: verified.start_param || null };
  });
}
