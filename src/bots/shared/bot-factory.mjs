/**
 * Bot factory — namunadagi (utax-agent, grammY) arxitektura tashqi paketsiz:
 *   update → dedupe → faqat shaxsiy chat → rate limit → /start KOD (bog'lash) → auth (bog'langan, faol, auditoriya)
 *          → callback | buyruq (RBAC) | ochiq dialog | fayl | erkin matn (AI) → xato middleware
 * Har handler `ctx` oladi (pastda). Ruxsat — web bilan bir xil app.rbac matritsasi; amallar — app.services.
 */
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from '../../core/http.mjs';
import { config, ROOT } from '../../core/config.mjs';
import { nowIso, sha256 } from '../../core/util.mjs';
import { esc, splitHtml, stripTags } from './html.mjs';
import { toReplyMarkup, chunk, tagCancel, hasBareCancel } from './keyboards.mjs';
import { dialogTag, newDialogTag } from './dialogs.mjs';
import { T } from './texts.mjs';
import { roleLabel, lines } from './format.mjs';
import { linkByCode, confirmPendingLink, cancelPendingLink, userByTelegram, touchChat, markChatBlocked, LINK_CODE_RE } from './auth.mjs';
import { isOwnerId, ensureOwner } from './owners.mjs';
import { TelegramError } from './telegram-api.mjs';
import { BotError } from './errors.mjs';
import { sharedCallbacks, sharedDialogs } from './common.mjs';
import { aiReply } from './ai-chat.mjs';
import { personaFor, exampleText } from '../../modules/ai-context.mjs';

export { BotError };

const CMD_RE = /^\/([a-z0-9_]+)(?:@([a-z0-9_]+))?(?:\s+([\s\S]*))?$/i;
const MAX_FILE = 10 * 1024 * 1024;
export const ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member'];

/** Telegram "Menyu": start → bot buyruqlari → help, clear, bekor (/yordam va /tozalash — aliaslar, menyuda ko'rinmaydi) */
export function menuCommands(list) {
  return [
    { command: 'start', description: 'Botni boshlash / qayta ishga tushirish' },
    ...list.map((c) => ({ command: c.name, description: String(c.desc).slice(0, 250) })),
    { command: 'help', description: 'Qo‘llanma va buyruqlar' },
    { command: 'clear', description: 'AI suhbat tarixini tozalash' },
    { command: 'bekor', description: 'Ochiq amalni bekor qilish' },
  ];
}

export function createBot(def, { app, api, dialogs, state, registry, links, log = console, rateLimit = { windowMs: 60000, max: 30 }, ownerIds = config.botOwnerIds }) {
  const db = app.db;
  const bot = { key: def.key, def, api, links, username: def.username, running: false, startedAt: null, lastUpdateAt: null, lastError: null, handled: 0 };
  const commands = new Map(def.commands.map((c) => [c.name, c]));
  const callbacks = { ...sharedCallbacks, ...(def.callbacks || {}) };
  const dialogDefs = { ...sharedDialogs, ...(def.dialogs || {}) };
  const seen = new Set();
  const hits = new Map();
  const deniedAt = new Map();
  const chains = new Map();

  const isAllowed = (spec, user) => {
    if (!user) return false;
    if (spec.roles && !spec.roles.includes(user.role_code)) return false;
    if (spec.perm && !app.rbac.can(user, spec.perm[0], spec.perm[1] || 'VIEW')) return false;
    if (spec.allow && !spec.allow(user, app)) return false;
    return true;
  };
  const allowedCommands = (user) => def.commands.filter((c) => !c.hidden && isAllowed(c, user));

  // ---------- yuborish ----------
  /** urlButtons: guruh chatlari uchun (web_app tugmalar faqat shaxsiy chatda ishlaydi) */
  async function send(chatId, html, { buttons, canView, replyTo, silent, urlButtons } = {}) {
    const parts = splitHtml(String(html ?? '').trim() || '--');
    const markup = toReplyMarkup(buttons, urlButtons ? { ...links, miniApp: false } : links, canView);
    let last = null;
    for (let k = 0; k < parts.length; k++) {
      const extra = {
        ...(k === parts.length - 1 && markup ? { reply_markup: markup } : {}),
        ...(replyTo && k === 0 ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
        ...(silent ? { disable_notification: true } : {}),
      };
      try {
        last = await api.sendMessage(chatId, parts[k], extra);
      } catch (e) {
        if (!(e instanceof TelegramError) || !e.isParseError) throw e;
        log.warn?.(`[bots:${def.key}] HTML xato (${e.description}) — oddiy matn yuborildi`);
        last = await api.call('sendMessage', { chat_id: chatId, text: stripTags(parts[k]).slice(0, 4096), link_preview_options: { is_disabled: true }, ...extra });
      }
    }
    return last;
  }
  async function sendDocument(chatId, buffer, filename, caption) {
    return api.sendDocument(chatId, buffer, filename, caption ? { caption: String(caption).slice(0, 1000) } : {});
  }

  // ---------- ctx ----------
  function buildCtx(update) {
    const cb = update.callback_query || null;
    const msg = update.message || null;
    const from = cb?.from || msg?.from || null;
    const chat = msg?.chat || cb?.message?.chat || null;
    const chatId = chat?.id ?? null;
    const photo = msg?.photo?.length ? msg.photo[msg.photo.length - 1] : null;
    const doc = msg?.document || null;
    const file = doc ? { file_id: doc.file_id, file_name: doc.file_name || 'fayl', mime_type: doc.mime_type || null, file_size: doc.file_size || null, kind: 'document' }
      : photo ? { file_id: photo.file_id, file_name: `rasm_${photo.file_unique_id || photo.file_id.slice(-8)}.jpg`, mime_type: 'image/jpeg', file_size: photo.file_size || null, kind: 'photo' } : null;
    const dkey = `${def.key}:${chatId}`;
    let answered = false;
    let dialogCache;
    /** «✖️ Bekor» (cb 'x') → 'x:<joriy dialog tegi>' — eski xabardagi tugma keyingi dialogni o'chirmasin (L5) */
    const withCancelTag = (buttons) => (hasBareCancel(buttons) ? tagCancel(buttons, dialogTag(ctx.dialog.get())) : buttons);
    const ctx = {
      bot, app, S: app.services, db, settings: app.settings, links,
      update, message: msg, callback: cb, from, chat, chatId,
      text: String(msg?.text ?? msg?.caption ?? '').trim(),
      file, command: null, args: '', cbData: cb?.data || '', cbArgs: [],
      user: null, actor: null,
      can: (resource, action = 'VIEW') => !!ctx.user && app.rbac.can(ctx.user, resource, action),
      need(resource, action = 'VIEW') { if (!ctx.can(resource, action)) throw new BotError(T.forbidden(resource, action)); },
      reply: (html, opts = {}) => send(chatId, html, { ...opts, buttons: withCancelTag(opts.buttons), canView: (r) => ctx.can(r, 'VIEW') }),
      /** Oddiy matn (avtomatik esc) */
      replyText: (text, opts = {}) => ctx.reply(esc(text), opts),
      async edit(html, opts = {}) {
        const mid = cb?.message?.message_id;
        if (!mid || String(html).length > 4000) return ctx.reply(html, opts);
        const markup = toReplyMarkup(withCancelTag(opts.buttons), links, (r) => ctx.can(r, 'VIEW'));
        try {
          return await api.editMessageText(chatId, mid, html, markup ? { reply_markup: markup } : {});
        } catch (e) {
          if (e instanceof TelegramError && e.isNotModified) return null;
          if (e instanceof TelegramError && e.isParseError) return api.call('editMessageText', { chat_id: chatId, message_id: mid, text: stripTags(html).slice(0, 4096), ...(markup ? { reply_markup: markup } : {}) });
          if (e instanceof TelegramError && e.code === 400) return ctx.reply(html, opts); // xabar juda eski / o'chirilgan
          throw e;
        }
      },
      /** Callback xabaridagi tugmalarni almashtirish (matn o'zgarmaydi); buttons bo'sh → tugmalar olib tashlanadi */
      async setButtons(buttons) {
        const mid = cb?.message?.message_id;
        if (!mid) return null;
        try { return await api.editMessageReplyMarkup(chatId, mid, toReplyMarkup(withCancelTag(buttons), links, (r) => ctx.can(r, 'VIEW'))); }
        catch (e) { if (e instanceof TelegramError && (e.isNotModified || e.code === 400)) return null; throw e; }
      },
      async answer(text, alert = false) {
        if (!cb || answered) return;
        answered = true;
        await api.answerCallbackQuery(cb.id, text, alert).catch(() => {});
      },
      get answered() { return answered; },
      typing: () => api.sendChatAction(chatId, 'typing').catch(() => {}),
      sendDocument: (buffer, filename, caption) => sendDocument(chatId, buffer, filename, caption),
      /** Yuborilgan faylni yuklab olish (Telegram → Buffer), ≤ 10 MB */
      async download(maxBytes = MAX_FILE) {
        if (!file) throw new BotError(T.fileUnexpected);
        if (file.file_size && file.file_size > maxBytes) throw new BotError(`📎 Fayl juda katta (${Math.round(file.file_size / 1048576)} MB). Chegara: ${Math.round(maxBytes / 1048576)} MB.`);
        const f = await api.getFile(file.file_id);
        if (!f?.file_path) throw new BotError('📎 Faylni Telegram’dan olib bo‘lmadi, qayta yuboring.');
        return api.downloadFile(f.file_path, maxBytes);
      },
      /** Faylni uploads/<subdir>/ ga saqlash → loyiha ildiziga nisbatan yo'l (contract_documents.file_path, expenses.receipt_path); uploads loyihadan tashqarida bo'lsa — absolyut */
      saveFile(buffer, subdir, name) {
        const safe = String(name || 'fayl').replace(/[^\w.\-]+/g, '_').slice(-80) || 'fayl';
        const dir = path.join(config.uploadsDir, String(subdir || 'telegram').replace(/[^\w\-/]+/g, '_'));
        fs.mkdirSync(dir, { recursive: true });
        const fileName = `${Date.now()}_${safe}`;
        const abs = path.join(dir, fileName);
        fs.writeFileSync(abs, buffer);
        const rel = path.relative(ROOT, abs);
        return rel.startsWith('..') || path.isAbsolute(rel) ? abs : rel.replace(/\\/g, '/');
      },
      dialog: {
        get() { if (dialogCache === undefined) dialogCache = dialogs.get(dkey); return dialogCache && !dialogCache.expired ? dialogCache : null; },
        start(name, data = {}, step = 'start') { dialogCache = { name, step, data, started_at: nowIso(), tag: newDialogTag() }; return dialogs.set(dkey, dialogCache); },
        update({ step, data } = {}) {
          const cur = ctx.dialog.get();
          if (!cur) return null;
          dialogCache = { ...cur, ...(step !== undefined ? { step } : {}), data: { ...cur.data, ...(data || {}) } };
          return dialogs.set(dkey, dialogCache);
        },
        clear() { dialogCache = null; return dialogs.clear(dkey); },
      },
      /** Shu botdagi boshqa buyruqni ishga tushirish (RBAC tekshiriladi) */
      runCommand: (name, args = '') => runCommand(ctx, commands.get(name), args, name),
      send: (toChatId, html, opts) => send(toChatId, html, opts),
    };
    return ctx;
  }

  // ---------- pipeline ----------
  async function handleUpdate(update) {
    if (!update || typeof update.update_id !== 'number') return;
    if (seen.has(update.update_id)) return;
    seen.add(update.update_id);
    if (seen.size > 2000) seen.delete(seen.values().next().value);
    bot.lastUpdateAt = nowIso();
    bot.handled++;
    if (update.my_chat_member) return onChatMember(update.my_chat_member);
    if (!update.message && !update.callback_query) return;
    const ctx = buildCtx(update);
    if (!ctx.chatId || !ctx.from || ctx.from.is_bot) return;
    if (ctx.chat?.type && ctx.chat.type !== 'private') {
      if (ctx.text.startsWith('/')) await send(ctx.chatId, T.privateOnly).catch(() => {});
      return;
    }
    if (!rateOk(ctx)) return;
    try {
      await pipeline(ctx);
    } catch (e) {
      await onError(ctx, e);
    } finally {
      if (ctx.callback && !ctx.answered) await ctx.answer();
    }
  }

  function rateOk(ctx) {
    const now = Date.now();
    const id = String(ctx.from.id);
    let h = hits.get(id);
    if (!h || now - h.start > rateLimit.windowMs) { h = { start: now, n: 0, warned: false }; hits.set(id, h); }
    h.n++;
    if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > rateLimit.windowMs) hits.delete(k);
    if (h.n <= rateLimit.max) return true;
    if (!h.warned) { h.warned = true; send(ctx.chatId, T.rateLimited).catch(() => {}); }
    if (ctx.callback) api.answerCallbackQuery(ctx.callback.id, T.rateLimited, false).catch(() => {});
    return false;
  }

  async function pipeline(ctx) {
    const cmd = ctx.message && !ctx.file ? parseCommand(ctx.text) : null;

    const owner = isOwnerId(ownerIds, ctx.from.id);
    let justLinked = false;
    // 1) /start KOD — web'dan olingan kod bilan bog'lash (auth'dan oldin). Ega — faqat FOUNDER hisob kodi; boshqa hisobga bog'langan tg id — tasdiq kartasi
    if (cmd?.name === 'start' && cmd.args && LINK_CODE_RE.test(cmd.args.trim())) {
      const res = linkByCode(app, cmd.args.trim(), ctx.from, def.key, { owner });
      if (!res.ok) {
        if (res.reason === 'confirm') {
          return ctx.reply(T.linkConfirm(res.target, res.current), { buttons: [[{ text: '✅ Ha, bog‘lash', cb: `lnk:ok:${res.hash}` }, { text: '✖️ Bekor', cb: `lnk:no:${res.hash}` }]] });
        }
        if (res.reason === 'owner_foreign') return ctx.reply(T.linkOwnerForeign);
        if (res.blocked_until) return ctx.reply(T.linkBlocked(res.blocked_until));
        return ctx.reply(res.reason === 'expired' ? T.linkExpired : T.linkInvalid);
      }
      await ctx.reply(T.linked(res.user), { buttons: signalButton() });
    }
    // 1b) tasdiq kartasi (lnk:ok|no:<kod xeshi>) — auth'dan oldin: joriy hisob bu bot auditoriyasida bo'lmasa ham ishlaydi
    if (ctx.callback && ctx.cbData.startsWith('lnk:')) {
      if (!(await onLinkCallback(ctx, owner))) return;
      justLinked = true;
    }

    // 2) auth: bog'langan, faol, shu bot auditoriyasida. Egalar (BOT_OWNER_IDS) — har doim FOUNDER hisobida (boshqa rol ko'tarilmaydi)
    const user = owner ? ensureOwner(app, ctx.from.id, ctx.from) : userByTelegram(db, ctx.from.id);
    if (!user) {
      auditDenied(ctx, 'not_linked');
      return ctx.reply(T.notLinked(links.enabled ? `🌐 Web panel: ${esc(links.url('settings/profile'))}` : null));
    }
    if (!user.is_active) { auditDenied(ctx, 'blocked', user); return ctx.reply(T.blocked); }
    ctx.user = user;
    ctx.actor = { user, ip: 'telegram', source: 'TELEGRAM', bot: def.key };
    if (!def.audience.includes(user.role_code)) {
      auditDenied(ctx, 'wrong_role', user);
      return ctx.reply(T.wrongBot(user.role_code, registry.suggestFor(user.role_code, def.key)), { buttons: registry.suggestFor(user.role_code, def.key).map((s) => [{ text: `➡️ ${s.title}`, url: `https://t.me/${s.username}` }]) });
    }
    touchChat(db, def.key, ctx.chatId, user, ctx.from);
    if (justLinked) return showMenu(ctx);

    // 3) tugmalar
    if (ctx.callback) return onCallback(ctx);

    // 4) buyruqlar
    if (cmd) return onCommand(ctx, cmd);

    // 5) ochiq dialog. Muddati o'tgan dialogga javob — ogohlantirish va TO'XTASH: matn/fayl AI'ga (tashqi LLM) yoki boshqa amalga tushmaydi
    //    (eskirgan qator purgeExpired'da 24 soat saqlanadi — ogohlantirish haqiqatan chiqadi, keyin qator o'chadi)
    const raw = dialogs.get(`${def.key}:${ctx.chatId}`);
    if (raw?.expired) return ctx.reply(T.staleDialog);
    if (raw?.name) {
      const d = dialogDefs[raw.name];
      if (d) {
        if (ctx.file) return d.onFile ? d.onFile(ctx, raw) : ctx.reply('✍️ Bu bosqichda matn kutilmoqda.' + T.dialogHint);
        if (ctx.text) return d.onText ? d.onText(ctx, raw) : ctx.reply('📎 Bu bosqichda fayl yoki tugma kutilmoqda.' + T.dialogHint);
        return ctx.reply('✍️ Javobni matn ko‘rinishida yuboring.' + T.dialogHint);
      }
      ctx.dialog.clear();
    }

    // 6) fayl
    if (ctx.file) return def.onFile ? def.onFile(ctx) : ctx.reply(T.fileUnexpected);

    // 7) erkin matn → bot-agent (default: AI moliya yordamchisi, web "AI moliya" chati bilan bir xil)
    if (ctx.text) return def.onText ? def.onText(ctx) : aiReply(ctx, ctx.text);
    return ctx.reply('Matn yoki buyruq yuboring. /yordam');
  }

  const signalButton = () => (def.key !== 'signal' ? [[{ text: '🔔 Signal botni ochish', url: `https://t.me/${registry.usernameOf('signal')}` }]] : undefined);

  /** lnk:ok:<xesh> — kutilayotgan bog'lashni tasdiqlash; lnk:no:<xesh> — bekor. Qaytaradi: bog'landimi */
  async function onLinkCallback(ctx, owner) {
    const [, op, hash] = ctx.cbData.split(':');
    if (op === 'no') {
      cancelPendingLink(db, ctx.from.id);
      await ctx.edit(T.linkCancelled);
      await ctx.answer('Bekor qilindi');
      return false;
    }
    if (op !== 'ok') { await ctx.answer(T.expired, true); return false; }
    const res = confirmPendingLink(app, ctx.from, hash, def.key, { owner });
    if (!res.ok) {
      await ctx.edit(res.reason === 'owner_foreign' ? T.linkOwnerForeign : T.linkConfirmExpired);
      await ctx.answer();
      return false;
    }
    await ctx.edit(T.linked(res.user), { buttons: signalButton() });
    await ctx.answer('✅ Bog‘landi');
    return true;
  }

  function parseCommand(text) {
    const m = CMD_RE.exec(text || '');
    if (!m) return null;
    if (m[2] && bot.username && m[2].toLowerCase() !== String(bot.username).toLowerCase()) return null;
    return { name: m[1].toLowerCase(), args: (m[3] || '').trim() };
  }

  async function onCommand(ctx, cmd) {
    switch (cmd.name) {
      case 'start': ctx.dialog.clear(); return showMenu(ctx);
      case 'yordam': case 'help': return showHelp(ctx);
      case 'bekor': case 'cancel': {
        const open = !!ctx.dialog.get(); // muddati o'tgan dialog «bekor qilindi» deb ko'rsatilmaydi
        ctx.dialog.clear();
        return ctx.reply(open ? T.cancelled : T.nothingToCancel);
      }
      case 'tozalash': case 'clear':
        // AI suhbat xotirasi (backend, shu bot kanali) + ochiq dialog tozalanadi
        ctx.dialog.clear();
        app.services.ai?.clearMemory?.(ctx.user.id, `TELEGRAM:${def.key}`);
        return ctx.reply(T.aiCleared);
      case 'menu': return showMenu(ctx);
      default: break;
    }
    // Noto'g'ri yozilgan (/bekr) yoki ruxsatsiz buyruq ochiq dialogni o'chirmaydi — faqat buyruq topilib, ruxsat o'tgach (runCommand) yopiladi
    const spec = commands.get(cmd.name);
    if (!spec) return ctx.reply(T.unknownCommand(cmd.name) + (ctx.dialog.get() ? T.dialogKept : ''));
    return runCommand(ctx, spec, cmd.args, cmd.name, { replaceDialog: true });
  }

  /** @param opts.replaceDialog  foydalanuvchi boshqa buyruqni tanladi — ruxsat o'tsa ochiq dialog yopiladi (ruxsatsiz bo'lsa saqlanadi) */
  async function runCommand(ctx, spec, args = '', name, { replaceDialog = false } = {}) {
    if (!spec) return ctx.reply(T.unknownCommand(name || '?'));
    if (!isAllowed(spec, ctx.user)) {
      const kept = replaceDialog && ctx.dialog.get() ? T.dialogKept : '';
      if (spec.perm && !app.rbac.can(ctx.user, spec.perm[0], spec.perm[1] || 'VIEW')) return ctx.reply(T.forbidden(spec.perm[0], spec.perm[1] || 'VIEW') + kept);
      return ctx.reply(T.forbiddenPlain + kept);
    }
    if (replaceDialog) ctx.dialog.clear(); // boshqa buyruq ochiq dialogni yopadi
    ctx.command = spec.name;
    ctx.args = String(args || '').trim();
    return spec.run(ctx);
  }

  async function onCallback(ctx) {
    const data = ctx.cbData;
    const [prefix, ...rest] = data.split(':');
    ctx.cbArgs = rest;
    if (prefix === 'cmd') {
      const spec = commands.get(rest[0]);
      if (!spec) return ctx.answer(T.expired, true);
      await ctx.answer();
      return runCommand(ctx, spec, rest.slice(1).join(':'), rest[0], { replaceDialog: true });
    }
    const entry = callbacks[prefix];
    if (!entry) return ctx.answer(T.expired, true);
    const h = typeof entry === 'function' ? { run: entry } : entry;
    const sentAt = ctx.callback.message?.date;
    if (h.ttlHours && sentAt && Date.now() / 1000 - sentAt > h.ttlHours * 3600) return ctx.answer(T.expired, true);
    if (h.perm && !ctx.can(h.perm[0], h.perm[1] || 'VIEW')) return ctx.answer(T.forbiddenPlain, true);
    return h.run(ctx);
  }

  async function showMenu(ctx) {
    const list = allowedCommands(ctx.user).filter((c) => c.menu !== false);
    const html = def.startText
      ? await def.startText(ctx)
      : lines(
        `👋 Assalomu alaykum, <b>${esc(ctx.user.name)}</b>!`,
        `<b>${esc(def.title)}</b> · ${esc(roleLabel(ctx.user.role_code))}`,
        def.about ? `\n${esc(def.about)}` : null,
        '',
        list.length ? 'Bo‘limni tanlang yoki savolingizni oddiy matn bilan yozing:' : 'Sizning rolingiz uchun bu botda buyruqlar yo‘q.',
      );
    const buttons = chunk(list.map((c) => ({ text: c.button || `/${c.name}`, cmd: c.name })), 2);
    buttons.push([{ text: '🌐 Web panel', web: 'dashboard' }]);
    await ctx.reply(html, { buttons });
    await syncChatCommands(ctx, list);
  }

  async function showHelp(ctx) {
    const list = allowedCommands(ctx.user);
    const aiOn = !def.onText && ctx.can('ai', 'CREATE');
    const html = lines(
      `📖 <b>Yordam — ${esc(def.title)}</b>`,
      '',
      ...list.map((c) => `${esc(c.usage || '/' + c.name)} — ${esc(c.desc)}`),
      '',
      '/start — botni boshlash / menyu',
      '/help — shu qo‘llanma',
      '/clear — AI suhbat tarixini tozalash (yangi mavzu)',
      '/bekor — ochiq amalni bekor qilish',
      aiOn ? `\n💬 <b>Erkin savol</b> — ${esc(personaFor(def.key).title)} sifatida oddiy matnga javob beraman: tizim ma’lumotlari asosida, so‘rasangiz maslahat bilan, oldingi suhbatni eslab. Masalan:\n${personaFor(def.key).examples.slice(0, 4).map((x) => `• «${esc(exampleText(x))}»`).join('\n')}` : null,
      def.helpExtra ? def.helpExtra(ctx) : null,
      '',
      `<i>Rolingiz: ${esc(roleLabel(ctx.user.role_code))} — buyruqlar ruxsatingizga qarab ko‘rsatiladi.</i>`,
    );
    return ctx.reply(html, { buttons: [[{ text: '🌐 Web panel', web: 'dashboard' }]] });
  }

  /** Telegram "Menyu" tugmasi — shu chat uchun faqat ruxsat etilgan buyruqlar (rol o'zgarsa yangilanadi) */
  async function syncChatCommands(ctx, list) {
    const cmds = menuCommands(list);
    const hash = sha256(JSON.stringify(cmds)).slice(0, 16);
    const key = `cmds:${def.key}:${ctx.chatId}`;
    if (state.get(key) === hash) return;
    try { await api.setMyCommands(cmds, { type: 'chat', chat_id: ctx.chatId }); state.set(key, hash); }
    catch (e) { log.warn?.(`[bots:${def.key}] setMyCommands(chat) xato: ${e.message}`); }
  }

  function auditDenied(ctx, reason, user) {
    const k = `${ctx.from.id}:${reason}`;
    const last = deniedAt.get(k) || 0;
    if (Date.now() - last < 10 * 60e3) return;
    deniedAt.set(k, Date.now());
    app.audit({ user: user || null, ip: 'telegram', source: 'TELEGRAM' }, { action: 'TELEGRAM_ACCESS_DENIED', entity: 'bot', newValue: { bot: def.key, reason, tg_user_id: String(ctx.from.id), tg_username: ctx.from.username || null } });
  }

  async function onError(ctx, e) {
    const say = (html) => (ctx.callback && !ctx.answered && stripTags(html).length <= 190 ? ctx.answer(stripTags(html), true) : ctx.reply(html)).catch(() => {});
    if (e instanceof BotError) return say(e.message);
    if (e instanceof HttpError && e.status < 500) return say(`${e.status === 403 ? '⛔' : '⚠️'} ${esc(e.message)}`);
    if (e instanceof TelegramError && e.isNotModified) return;
    bot.lastError = `${nowIso()} ${e?.message || e}`.slice(0, 300);
    log.error?.(`[bots:${def.key}] xato:`, e?.stack || e);
    try { app.audit(ctx.actor || { source: 'TELEGRAM' }, { action: 'BOT_ERROR', entity: 'bot', newValue: { bot: def.key, message: String(e?.message || e).slice(0, 300), data: ctx.cbData || ctx.text.slice(0, 80) } }); } catch {}
    return ctx.reply(T.error).catch(() => {});
  }

  function onChatMember(m) {
    if (m.chat?.type !== 'private') return;
    const st = m.new_chat_member?.status;
    if (st === 'kicked') markChatBlocked(db, def.key, m.chat.id, true);
    else if (st === 'member') markChatBlocked(db, def.key, m.chat.id, false);
  }

  /** Bir chatning update'lari ketma-ket (tartib buzilmaydi), turli chatlar parallel */
  function enqueue(update) {
    const chatKey = String(update.message?.chat?.id ?? update.callback_query?.message?.chat?.id ?? update.my_chat_member?.chat?.id ?? 'x');
    const prev = chains.get(chatKey) || Promise.resolve();
    const next = prev.then(() => handleUpdate(update)).catch((e) => log.error?.(`[bots:${def.key}] update:`, e?.stack || e)).finally(() => { if (chains.get(chatKey) === next) chains.delete(chatKey); });
    chains.set(chatKey, next);
    return next;
  }

  async function init({ mode } = {}) {
    const me = await api.getMe();
    bot.username = me.username;
    bot.id = me.id;
    const all = def.commands.filter((c) => !c.hidden);
    const cmds = menuCommands(all);
    const soft = (p, what) => p.catch((e) => log.warn?.(`[bots:${def.key}] ${what}: ${e.message}`));
    await soft(api.setMyCommands(cmds), 'setMyCommands');
    if (def.about) {
      await soft(api.setMyDescription(`${def.title}\n\n${def.about}\n\nBog‘lash: web panel → Sozlamalar → Profil → Telegram botlar.`.slice(0, 512)), 'setMyDescription');
      await soft(api.setMyShortDescription(String(def.short || def.about).slice(0, 120)), 'setMyShortDescription');
    }
    await soft(api.setChatMenuButton(links.miniApp ? { type: 'web_app', text: '📊 Dashboard', web_app: { url: links.appUrl('dashboard') } } : { type: 'commands' }), 'setChatMenuButton');
    if (mode === 'polling') await soft(api.deleteWebhook(), 'deleteWebhook');
    return me;
  }

  Object.assign(bot, { handleUpdate, enqueue, init, send, sendDocument, allowedCommands, isAllowed });
  return bot;
}
