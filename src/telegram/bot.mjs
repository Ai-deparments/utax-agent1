import { config } from '../core/config.mjs';
import { nowIso } from '../core/util.mjs';

/** Telegram Finance Agent — long polling, buyruqlar + natural language + tasdiqlash (CONFIRM/CANCEL). */
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const md2html = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const COMMANDS = {
  '/balance': 'Bugun qancha pulimiz bor?', '/cash': 'Bugun qancha pulimiz bor?', '/revenue': 'Shu oy qancha daromad tan olindi?', '/expenses': 'Shu oy qancha xarajat bo‘ldi?',
  '/debtors': 'Kimlardan pul olishimiz kerak?', '/forecast': 'Keyingi 30 kun forecast', '/approvals': 'Tasdiq kutayotgan so‘rovlar', '/report': 'Bugungi holatni ber', '/status': 'Bugungi holatni ber', '/help': 'help',
};

export function startTelegramBot(app) {
  const token = config.telegramToken;
  if (!token) { console.log('[telegram] TELEGRAM_BOT_TOKEN yo‘q — bot ishga tushmadi'); return null; }
  const { db } = app;
  const api = async (method, body) => { const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); return res.json(); };
  const send = (chatId, text, extra = {}) => api('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }).catch(() => {});
  const userByChat = (chatId) => db.get('SELECT * FROM users WHERE telegram_chat_id=? AND is_active=1', String(chatId));
  const ctxFor = (u) => ({ user: u, ip: null, source: 'TELEGRAM' });

  async function handleMessage(msg) {
    const chatId = msg.chat.id;
    const text = String(msg.text || '').trim();
    if (!text) return;
    if (text.startsWith('/start')) {
      const code = text.split(/\s+/)[1];
      if (code) {
        const u = db.get('SELECT * FROM users WHERE telegram_link_code=? AND is_active=1', code.toUpperCase());
        if (u) { db.run('UPDATE users SET telegram_chat_id=?, telegram_link_code=NULL WHERE id=?', String(chatId), u.id); app.audit(ctxFor(u), { action: 'TELEGRAM_LINKED', entity: 'user', entityId: u.id }); return send(chatId, `✅ Bog‘landi: <b>${esc(u.name)}</b> (${u.role_code}). /help — buyruqlar`); }
        return send(chatId, '❌ Kod noto‘g‘ri yoki eskirgan. CRM → Profil → Telegram bog‘lash.');
      }
      return send(chatId, 'UTAX Finance bot. Hisobingizni bog‘lash uchun CRM profilidan kod oling va yuboring: /start KOD');
    }
    const u = userByChat(chatId);
    if (!u) return send(chatId, '⛔ Hisob bog‘lanmagan. CRM → Profil → Telegram bog‘lash, keyin /start KOD');
    const question = COMMANDS[text.split(/\s|@/)[0]] || text;
    if (question === 'help') return send(chatId, ['<b>Buyruqlar</b>', '/balance — pul holati', '/revenue — daromad', '/expenses — xarajatlar', '/debtors — qarzdorlar', '/forecast — prognoz', '/approvals — tasdiqlar', '/report — bugungi holat', '', 'Yoki oddiy yozing: “Kim bizdan eng ko‘p qarzdor?”, “Marketingning 12 mln so‘rovini tasdiqla”'].join('\n'));
    const res = await app.services.ai.chat(question, ctxFor(u), { channel: 'TELEGRAM' });
    let extra = {};
    if (res.confirm?.type === 'APPROVE') extra = { reply_markup: { inline_keyboard: [[{ text: '✅ CONFIRM', callback_data: `apr:${res.confirm.approval_id}:yes` }, { text: '❌ CANCEL', callback_data: `apr:${res.confirm.approval_id}:no` }]] } };
    const answer = md2html(res.answer).slice(0, 3900);
    return send(chatId, answer, extra);
  }
  async function handleCallback(cb) {
    const chatId = cb.message?.chat?.id;
    const u = userByChat(chatId);
    const [kind, id, yes] = String(cb.data || '').split(':');
    await api('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
    if (!u) return send(chatId, '⛔ Hisob bog‘lanmagan');
    if (kind === 'apr') {
      if (yes !== 'yes') return send(chatId, 'Bekor qilindi.');
      try { const a = app.services.approvals.decide(Number(id), 'APPROVE', ctxFor(u), 'Telegram orqali tasdiqlandi'); return send(chatId, `✅ Tasdiqlandi: ${esc(a.title)} — status ${a.status}`); }
      catch (e) { return send(chatId, `❌ Xato: ${esc(e.message)}`); }
    }
  }

  let offset = 0, running = true;
  (async function loop() {
    console.log('[telegram] bot ishga tushdi (long polling)');
    while (running) {
      try {
        const j = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
        if (!j.ok) { await new Promise((r) => setTimeout(r, 5000)); continue; }
        for (const up of j.result) {
          offset = up.update_id + 1;
          try { if (up.message) await handleMessage(up.message); else if (up.callback_query) await handleCallback(up.callback_query); }
          catch (e) { console.error('[telegram] update error:', e.message); }
        }
      } catch (e) { console.error('[telegram] poll error:', e.message); await new Promise((r) => setTimeout(r, 5000)); }
    }
  })();
  return { stop() { running = false; }, api, send };
}
