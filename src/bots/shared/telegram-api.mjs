/**
 * Yupqa Telegram Bot API klienti (tashqi paketsiz, global fetch).
 * - 429 → retry_after kutib qayta urinish; 5xx / tarmoq xatosi → backoff bilan qayta urinish
 * - Token hech qachon log yoki xato matniga chiqmaydi
 * - fetchImpl almashtiriladi (testlarda soxta Telegram)
 */
export class TelegramError extends Error {
  constructor(method, code, description, parameters) {
    super(`Telegram ${method}: ${code} ${description}`);
    this.name = 'TelegramError';
    this.method = method;
    this.code = code;
    this.description = String(description || '');
    this.parameters = parameters || null;
  }
  /** Foydalanuvchi botni bloklagan / chat yo'q — shu bot orqali yuborib bo'lmaydi */
  get isUnreachable() { return this.code === 403 || (this.code === 400 && /chat not found|user not found|PEER_ID_INVALID/i.test(this.description)); }
  get isParseError() { return this.code === 400 && /can't parse entities|unsupported start tag|can't find end tag|Unclosed/i.test(this.description); }
  get isNotModified() { return this.code === 400 && /message is not modified/i.test(this.description); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createTelegramApi(token, { fetchImpl = globalThis.fetch, baseUrl = 'https://api.telegram.org', sleepImpl = sleep } = {}) {
  if (!token) throw new Error('Telegram token bo‘sh');
  const methodUrl = (m) => `${baseUrl}/bot${token}/${m}`;

  async function call(method, params = {}, { timeoutMs = 30000, retries = 2, signal } = {}) {
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const onAbort = () => ctrl.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      let res, body;
      try {
        const multipart = typeof FormData !== 'undefined' && params instanceof FormData;
        res = await fetchImpl(methodUrl(method), {
          method: 'POST',
          headers: multipart ? undefined : { 'Content-Type': 'application/json' },
          body: multipart ? params : JSON.stringify(params ?? {}),
          signal: ctrl.signal,
        });
        body = await res.json().catch(() => ({ ok: false, error_code: res.status, description: 'JSON emas javob' }));
      } catch (e) {
        if (signal?.aborted) throw new TelegramError(method, 0, 'aborted');
        if (attempt < retries) { await sleepImpl(800 * (attempt + 1)); continue; }
        throw new TelegramError(method, 0, e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).replaceAll(token, '***'));
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
      if (body?.ok) return body.result;
      const code = Number(body?.error_code || res?.status || 0);
      if (code === 429 && attempt <= retries) { await sleepImpl(Math.min(60, Number(body?.parameters?.retry_after) || 2) * 1000); continue; }
      if (code >= 500 && attempt < retries) { await sleepImpl(800 * (attempt + 1)); continue; }
      throw new TelegramError(method, code, String(body?.description || 'xato').replaceAll(token, '***'), body?.parameters);
    }
  }

  const noPreview = { link_preview_options: { is_disabled: true } };
  return {
    call,
    getMe: () => call('getMe'),
    getUpdates: (params, opts) => call('getUpdates', params, opts),
    sendMessage: (chat_id, text, extra = {}) => call('sendMessage', { chat_id, text, parse_mode: 'HTML', ...noPreview, ...extra }),
    editMessageText: (chat_id, message_id, text, extra = {}) => call('editMessageText', { chat_id, message_id, text, parse_mode: 'HTML', ...noPreview, ...extra }),
    editMessageReplyMarkup: (chat_id, message_id, reply_markup) => call('editMessageReplyMarkup', { chat_id, message_id, ...(reply_markup ? { reply_markup } : {}) }),
    deleteMessage: (chat_id, message_id) => call('deleteMessage', { chat_id, message_id }),
    answerCallbackQuery: (callback_query_id, text, show_alert = false) => call('answerCallbackQuery', { callback_query_id, ...(text ? { text: String(text).slice(0, 190), show_alert } : {}) }, { retries: 0 }),
    sendChatAction: (chat_id, action = 'typing') => call('sendChatAction', { chat_id, action }, { retries: 0 }),
    sendDocument(chat_id, buffer, filename, extra = {}) {
      const fd = new FormData();
      fd.append('chat_id', String(chat_id));
      fd.append('document', new Blob([buffer]), filename);
      for (const [k, v] of Object.entries({ parse_mode: 'HTML', ...extra })) if (v !== undefined && v !== null) fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      return call('sendDocument', fd, { timeoutMs: 90000, retries: 1 });
    },
    setMyCommands: (commands, scope) => call('setMyCommands', { commands, ...(scope ? { scope } : {}) }),
    setMyDescription: (description) => call('setMyDescription', { description }),
    setMyShortDescription: (short_description) => call('setMyShortDescription', { short_description }),
    setChatMenuButton: (menu_button, chat_id) => call('setChatMenuButton', { menu_button, ...(chat_id ? { chat_id } : {}) }),
    setWebhook: (url, secret_token, allowed_updates) => call('setWebhook', { url, secret_token, allowed_updates, drop_pending_updates: false }),
    deleteWebhook: () => call('deleteWebhook', { drop_pending_updates: false }),
    getFile: (file_id) => call('getFile', { file_id }),
    /** Telegram serveridan fayl (≤ maxBytes; Bot API chegarasi 20 MB) */
    async downloadFile(filePath, maxBytes = 10 * 1024 * 1024) {
      const res = await fetchImpl(`${baseUrl}/file/bot${token}/${filePath}`);
      if (!res.ok) throw new TelegramError('downloadFile', res.status, 'fayl yuklanmadi');
      const len = Number(res.headers?.get?.('content-length'));
      if (Number.isFinite(len) && len > maxBytes) throw new TelegramError('downloadFile', 413, 'fayl juda katta');
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) throw new TelegramError('downloadFile', 413, 'fayl juda katta');
      return buf;
    },
  };
}
