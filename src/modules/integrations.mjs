import { badRequest, notFound, unauthorized } from '../core/http.mjs';
import { encryptSecret, decryptSecret, maskSecret } from '../core/auth.mjs';
import { config } from '../core/config.mjs';
import { nowIso, parseJson, sha256, uid } from '../core/util.mjs';
import { parseCsv, parseXlsx } from '../core/export.mjs';

/**
 * ADAPTER-BASED INTEGRATIONS. Har adapter: {type, name, description, config_schema, secret_schema, test(cfg,sec), pull(cfg,sec,since) → rows}
 * rows = normalizatsiya qilinmagan jadval (header + qatorlar) yoki tayyor {tx_date, amount, direction, ...} obyektlari.
 */
async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
const genericJsonRows = (data) => (Array.isArray(data) ? data : data.items || data.data || data.transactions || []).map((x) => ({
  tx_date: x.tx_date || x.date || x.value_date, amount: Math.abs(Number(x.amount ?? x.sum ?? 0)), direction: x.direction || ((x.type || '').toString().toUpperCase().includes('DEB') || Number(x.amount) < 0 ? 'EXPENSE' : 'INCOME'),
  counterparty_name: x.counterparty_name || x.counterparty || x.name, counterparty_inn: x.counterparty_inn || x.inn, purpose: x.purpose || x.description || x.details, external_id: x.external_id || x.id || x.doc_number,
}));

export const ADAPTERS = {
  BANK_API: { name: 'Bank API', description: 'Bank REST API (JSON) — kirish/chiqish ko‘chirmasi', config_schema: { base_url: 'https://bank.example/api', account_id: '', bank_account_id: 1 }, secret_schema: { api_key: '' },
    async test(cfg, sec) { await fetchJson(`${cfg.base_url.replace(/\/$/, '')}/accounts/${cfg.account_id}`, { Authorization: `Bearer ${sec.api_key}` }); return 'OK'; },
    async pull(cfg, sec, since) { const d = await fetchJson(`${cfg.base_url.replace(/\/$/, '')}/accounts/${cfg.account_id}/transactions?since=${since || ''}`, { Authorization: `Bearer ${sec.api_key}` }); return genericJsonRows(d); } },
  GOOGLE_SHEETS: { name: 'Google Sheets', description: 'Jadval (ommaviy/“link bilan”) CSV export orqali', config_schema: { sheet_id: '', gid: '0', bank_account_id: 1, mapping: {} }, secret_schema: {},
    url: (cfg) => `https://docs.google.com/spreadsheets/d/${cfg.sheet_id}/export?format=csv&gid=${cfg.gid || 0}`,
    async test(cfg) { const res = await fetch(this.url(cfg)); if (!res.ok) throw new Error(`HTTP ${res.status}`); return 'OK'; },
    async pull(cfg) { const res = await fetch(this.url(cfg)); const text = await res.text(); return { table: parseCsv(text), mapping: cfg.mapping }; } },
  EXCEL: { name: 'Excel / CSV fayl', description: 'Bank ko‘chirmasini Excel (.xlsx) yoki CSV fayl sifatida yuklash', config_schema: { bank_account_id: 1 }, secret_schema: {}, async test() { return 'Manual'; }, async pull() { return []; } },
  ONE_C: { name: '1C', description: '1C HTTP-servis (JSON) — bank/kassa hujjatlari', config_schema: { base_url: 'http://1c.local/base/hs/finance', endpoint: '/transactions', bank_account_id: 1 }, secret_schema: { username: '', password: '' },
    auth: (sec) => ({ Authorization: 'Basic ' + Buffer.from(`${sec.username}:${sec.password}`).toString('base64') }),
    async test(cfg, sec) { await fetchJson(`${cfg.base_url}${cfg.endpoint}?limit=1`, this.auth(sec)); return 'OK'; },
    async pull(cfg, sec, since) { return genericJsonRows(await fetchJson(`${cfg.base_url}${cfg.endpoint}?since=${since || ''}`, this.auth(sec))); } },
  ERP: { name: 'ERP', description: 'Umumiy ERP REST (JSON) adapteri', config_schema: { base_url: '', endpoint: '/api/bank-transactions', bank_account_id: 1 }, secret_schema: { token: '' },
    async test(cfg, sec) { await fetchJson(`${cfg.base_url}${cfg.endpoint}?limit=1`, { Authorization: `Bearer ${sec.token}` }); return 'OK'; },
    async pull(cfg, sec, since) { return genericJsonRows(await fetchJson(`${cfg.base_url}${cfg.endpoint}?since=${since || ''}`, { Authorization: `Bearer ${sec.token}` })); } },
  TELEGRAM: { name: 'Telegram', description: '4 ta bot: rahbar, buxgalter, so‘rov, signal (BOT_*_TOKEN .env); kritik ogohlantirishlar guruhi — alert_chat_id', config_schema: { alert_chat_id: '' }, secret_schema: {},
    async test(cfg) {
      const out = [];
      for (const [key, token] of Object.entries(config.bots)) {
        if (!token) { out.push(`${key}: token yo‘q`); continue; }
        try { const j = await fetchJson(`https://api.telegram.org/bot${token}/getMe`); out.push(`${key}: @${j.result?.username}`); } catch (e) { out.push(`${key}: xato (${e.message})`); }
      }
      if (!out.some((x) => x.includes('@'))) throw new Error(out.join(' · '));
      let msg = 'Botlar: ' + out.join(' · ');
      const alertToken = config.bots.signal || Object.values(config.bots).find(Boolean);
      if (cfg.alert_chat_id && alertToken) {
        const s = await (await fetch(`https://api.telegram.org/bot${alertToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: cfg.alert_chat_id, text: '✅ UTAX Finance: kritik ogohlantirishlar guruhi ulandi' }) })).json().catch(() => ({}));
        msg += s.ok ? ' · test xabar guruhga yuborildi' : ` · guruhga yuborib bo‘lmadi (${s.description || 'chat ID noto‘g‘ri yoki signal bot guruhga qo‘shilmagan'})`;
      }
      return msg;
    }, async pull() { return []; } },
  EMAIL: { name: 'Email', description: 'Webhook servis orqali elektron pochta xabarlari', config_schema: { webhook_url: '', recipients: '' }, secret_schema: {},
    async test(cfg) {
      const url = cfg.webhook_url || config.emailWebhook;
      if (!url) throw new Error('Webhook manzili kiritilmagan');
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: cfg.recipients || '', subject: 'UTAX Finance: ulanish tekshiruvi', body: 'Elektron pochta integratsiyasi ishlayapti.' }) });
      if (!res.ok) throw new Error(`Webhook javobi: HTTP ${res.status}`);
      return 'Webhook javob berdi (HTTP ' + res.status + ')';
    }, async pull() { return []; } },
  GEMINI: { name: 'Gemini AI', description: 'Google Gemini — AI javoblar uchun asosiy provayder (xato/limitda Groq). Javoblar faqat tizimdagi real ma’lumotlar asosida', config_schema: { model: 'gemini-3.6-flash' }, secret_schema: { api_key: '' },
    async test(cfg, sec) {
      const key = sec.api_key || config.ai.geminiKey;
      if (!key) throw new Error('API kalit kiritilmagan');
      const model = cfg.model || config.ai.geminiModel;
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Faqat "OK" deb javob ber.' }] }] }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Gemini javobi: ${String(j.error?.message || 'HTTP ' + res.status).replaceAll(key, '***')}`);
      return `Gemini ulandi (${j.modelVersion || model})`;
    }, async pull() { return []; } },
  GROQ: { name: 'Groq AI', description: 'Groq — Gemini xato bersa yoki limitga yetsa AI javoblarini beradigan zaxira provayder (OpenAI-mos, tool calling)', config_schema: { model: 'openai/gpt-oss-120b' }, secret_schema: { api_key: '' },
    async test(cfg, sec) {
      const key = sec.api_key || config.ai.groqKey;
      if (!key) throw new Error('API kalit kiritilmagan');
      const model = cfg.model || config.ai.groqModel;
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Faqat "OK" deb javob ber.' }], max_tokens: 16 }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Groq javobi: ${String(j.error?.message || 'HTTP ' + res.status).replaceAll(key, '***')}`);
      return `Groq ulandi (${j.model || model})`;
    }, async pull() { return []; } },
  WEBHOOK_IN: { name: 'Inbound webhook', description: 'Tashqi tizim POST /api/integrations/webhook/:token orqali tranzaksiya yuboradi', config_schema: { bank_account_id: 1 }, secret_schema: { token: '' }, async test() { return 'OK'; }, async pull() { return []; } },
};

export function register(app) {
  const { r, db, audit } = app;
  const ENV = { telegramAlertChat: config.telegramAlertChat, emailWebhook: config.emailWebhook, geminiKey: config.ai.geminiKey, geminiModel: config.ai.geminiModel, groqKey: config.ai.groqKey, groqModel: config.ai.groqModel };
  /** Tizimda saqlangan sozlamalar .env qiymatlaridan ustun: Telegram kritik guruhi, Email webhook, Gemini/Groq kalitlari (shifrlangan). Bot tokenlari — faqat .env (BOT_*_TOKEN). */
  async function applyRuntime() {
    const tg = db.get("SELECT * FROM integrations WHERE type='TELEGRAM' AND is_active=1 ORDER BY id DESC LIMIT 1");
    const tgCfg = tg ? parseJson(tg.config, {}) : {};
    config.telegramAlertChat = tgCfg.alert_chat_id || ENV.telegramAlertChat;
    const em = db.get("SELECT * FROM integrations WHERE type='EMAIL' AND is_active=1 ORDER BY id DESC LIMIT 1");
    config.emailWebhook = (em && parseJson(em.config, {}).webhook_url) || ENV.emailWebhook;
    const gm = db.get("SELECT * FROM integrations WHERE type='GEMINI' AND is_active=1 ORDER BY id DESC LIMIT 1");
    const gq = db.get("SELECT * FROM integrations WHERE type='GROQ' AND is_active=1 ORDER BY id DESC LIMIT 1");
    const before = JSON.stringify([config.ai.geminiKey, config.ai.geminiModel, config.ai.groqKey, config.ai.groqModel]);
    config.ai.geminiKey = (gm && parseJson(decryptSecret(gm.secret_config) || '{}', {}).api_key) || ENV.geminiKey;
    config.ai.geminiModel = (gm && parseJson(gm.config, {}).model) || ENV.geminiModel;
    config.ai.groqKey = (gq && parseJson(decryptSecret(gq.secret_config) || '{}', {}).api_key) || ENV.groqKey;
    config.ai.groqModel = (gq && parseJson(gq.config, {}).model) || ENV.groqModel;
    // Kalit yoki model o'zgarsa AI zanjiri yangi sozlama bilan qayta yaratiladi
    if (JSON.stringify([config.ai.geminiKey, config.ai.geminiModel, config.ai.groqKey, config.ai.groqModel]) !== before) app.services.ai?.resetLlm?.();
  }
  app.services.applyIntegrationsRuntime = applyRuntime;
  applyRuntime();
  const view = (i) => ({ ...i, config: parseJson(i.config, {}), secret_config: Object.fromEntries(Object.entries(parseJson(decryptSecret(i.secret_config) || '{}', {})).map(([k, v]) => [k, maskSecret(v)])), adapter: ADAPTERS[i.type] ? { name: ADAPTERS[i.type].name, description: ADAPTERS[i.type].description } : null });

  async function sync(integration, ctx) {
    const ad = ADAPTERS[integration.type];
    if (!ad) throw badRequest('Adapter topilmadi: ' + integration.type);
    const cfg = parseJson(integration.config, {}), sec = parseJson(decryptSecret(integration.secret_config) || '{}', {});
    const logId = db.insert('integration_sync_logs', { integration_id: integration.id, started_at: nowIso(), status: 'RUNNING' });
    try {
      const pulled = await ad.pull(cfg, sec, integration.last_sync_at ? integration.last_sync_at.slice(0, 10) : null);
      let rows = Array.isArray(pulled) ? pulled : app.services.banking.normalizeRows(pulled.table || [], pulled.mapping || {});
      const res = cfg.bank_account_id && rows.length ? app.services.banking.importRows(cfg.bank_account_id, rows, ctx, integration.type) : { rows: rows.length, created: 0, duplicates: 0 };
      db.run('UPDATE integration_sync_logs SET finished_at=?, status=?, rows_in=?, rows_new=?, message=? WHERE id=?', nowIso(), 'OK', res.rows, res.created, JSON.stringify(res), logId);
      db.run('UPDATE integrations SET last_sync_at=?, last_status=? WHERE id=?', nowIso(), `Sinxronlandi: ${res.created} yangi`, integration.id);
      audit(ctx, { action: 'SYNC', entity: 'integration', entityId: integration.id, newValue: res });
      return res;
    } catch (e) {
      db.run('UPDATE integration_sync_logs SET finished_at=?, status=?, message=? WHERE id=?', nowIso(), 'ERROR', e.message, logId);
      db.run('UPDATE integrations SET last_sync_at=?, last_status=? WHERE id=?', nowIso(), 'Xato: ' + e.message, integration.id);
      throw badRequest('Sync xato: ' + e.message);
    }
  }
  app.services.integrations = {
    sync, ADAPTERS,
    list() { return db.all('SELECT * FROM integrations ORDER BY id').map(view); },
    get(id) { return db.get('SELECT * FROM integrations WHERE id=?', id); },
  };

  r.get('/api/integrations', { perm: ['integrations', 'VIEW'], tags: ['integrations'], summary: 'Integratsiyalar' }, async () => db.all('SELECT * FROM integrations ORDER BY id').map(view));
  r.post('/api/integrations/excel-upload', { perm: ['integrations', 'EDIT'], tags: ['integrations'], summary: 'Excel (.xlsx) yoki CSV bank ko‘chirmasini yuklash: {bank_account_id, xlsx_base64|csv, preview?, integration_id?}' }, async (ctx) => {
    app.rbac.require(ctx.user, 'transactions', 'CREATE');
    const b = ctx.body || {};
    let table;
    try { table = b.xlsx_base64 ? parseXlsx(Buffer.from(b.xlsx_base64, 'base64')) : b.csv ? parseCsv(b.csv) : null; }
    catch (e) { throw badRequest('Faylni o‘qib bo‘lmadi: ' + e.message + '. Faqat .xlsx yoki .csv formatini yuklang.'); }
    if (!table) throw badRequest('Fayl kerak (.xlsx yoki .csv)');
    const rows = app.services.banking.normalizeRows(table, b.mapping || {});
    if (b.preview) return { total: rows.length, rows: rows.slice(0, 200), raw_rows: table.length };
    if (!b.bank_account_id) throw badRequest('Bank hisobini tanlang');
    if (!rows.length) throw badRequest('Faylda tranzaksiya topilmadi: sana va summa (yoki debet/kredit) ustunlari bo‘lishi kerak');
    const integ = b.integration_id ? db.get('SELECT * FROM integrations WHERE id=?', b.integration_id) : db.get("SELECT * FROM integrations WHERE type='EXCEL' ORDER BY is_active DESC, id LIMIT 1");
    const logId = integ ? db.insert('integration_sync_logs', { integration_id: integ.id, started_at: nowIso(), status: 'RUNNING' }) : null;
    const res = app.services.banking.importRows(Number(b.bank_account_id), rows, ctx, 'EXCEL');
    if (integ) {
      db.run('UPDATE integration_sync_logs SET finished_at=?, status=?, rows_in=?, rows_new=?, message=? WHERE id=?', nowIso(), 'OK', res.rows, res.created, JSON.stringify({ file: b.file_name || null, ...res }), logId);
      db.run('UPDATE integrations SET last_sync_at=?, last_status=? WHERE id=?', nowIso(), `Yuklandi: ${res.created} yangi, ${res.duplicates} takroriy`, integ.id);
    }
    audit(ctx, { action: 'EXCEL_UPLOAD', entity: 'integration', entityId: integ?.id, newValue: { file: b.file_name || null, bank_account_id: b.bank_account_id, ...res } });
    return res;
  });
  r.get('/api/integrations/adapters', { perm: ['integrations', 'VIEW'], tags: ['integrations'], summary: 'Mavjud adapterlar va config sxemasi' }, async () => Object.entries(ADAPTERS).map(([type, a]) => ({ type, name: a.name, description: a.description, config_schema: a.config_schema, secret_schema: a.secret_schema })));
  r.post('/api/integrations', { perm: ['integrations', 'CREATE'], tags: ['integrations'], summary: 'Integratsiya qo‘shish (secretlar shifrlanadi)' }, async (ctx) => {
    const b = ctx.body || {};
    if (!ADAPTERS[b.type] || !b.name) throw badRequest('type (adapter) va name majburiy');
    const sec = { ...(b.secret_config || {}) };
    if (b.type === 'WEBHOOK_IN' && !sec.token) sec.token = uid(16);
    const id = db.insert('integrations', { type: b.type, name: b.name, config: JSON.stringify(b.config || {}), secret_config: encryptSecret(JSON.stringify(sec)), created_at: nowIso() });
    audit(ctx, { action: 'CREATE', entity: 'integration', entityId: id, newValue: { type: b.type, name: b.name } });
    const out = view(db.get('SELECT * FROM integrations WHERE id=?', id));
    if (b.type === 'WEBHOOK_IN') out.webhook_url = `/api/integrations/webhook/${sec.token}`;
    if (['TELEGRAM', 'EMAIL', 'GEMINI', 'GROQ'].includes(b.type)) await applyRuntime();
    return out;
  });
  r.patch('/api/integrations/:id', { perm: ['integrations', 'EDIT'], tags: ['integrations'], summary: 'Integratsiyani tahrirlash' }, async (ctx) => {
    const i = db.get('SELECT * FROM integrations WHERE id=?', ctx.params.id);
    if (!i) throw notFound();
    const b = ctx.body || {}, upd = {};
    if (b.name !== undefined) upd.name = b.name;
    if (b.is_active !== undefined) upd.is_active = b.is_active;
    if (b.config !== undefined) upd.config = JSON.stringify(b.config);
    if (b.secret_config !== undefined) { const old = parseJson(decryptSecret(i.secret_config) || '{}', {}); const merged = { ...old }; for (const [k, v] of Object.entries(b.secret_config)) if (v && !String(v).includes('••')) merged[k] = v; upd.secret_config = encryptSecret(JSON.stringify(merged)); }
    db.update('integrations', i.id, upd);
    audit(ctx, { action: 'UPDATE', entity: 'integration', entityId: i.id, newValue: { name: b.name, config: b.config, secrets_changed: !!b.secret_config } });
    if (['TELEGRAM', 'EMAIL', 'GEMINI', 'GROQ'].includes(i.type)) await applyRuntime();
    return view(db.get('SELECT * FROM integrations WHERE id=?', i.id));
  });
  r.post('/api/integrations/:id/test', { perm: ['integrations', 'EDIT'], tags: ['integrations'], summary: 'Ulanishni tekshirish' }, async (ctx) => {
    const i = db.get('SELECT * FROM integrations WHERE id=?', ctx.params.id);
    if (!i) throw notFound();
    try { const msg = await ADAPTERS[i.type].test(parseJson(i.config, {}), parseJson(decryptSecret(i.secret_config) || '{}', {})); db.run('UPDATE integrations SET last_status=? WHERE id=?', 'Tekshiruv: ' + msg, i.id); return { ok: true, message: msg }; }
    catch (e) { db.run('UPDATE integrations SET last_status=? WHERE id=?', 'Tekshiruv xatosi: ' + e.message, i.id); return { ok: false, message: e.message }; }
  });
  r.post('/api/integrations/:id/sync', { perm: ['integrations', 'EDIT'], tags: ['integrations'], summary: 'Sinxronizatsiya (pull → import → reconciliation)' }, async (ctx) => { const i = db.get('SELECT * FROM integrations WHERE id=?', ctx.params.id); if (!i) throw notFound(); return sync(i, ctx); });
  r.get('/api/integrations/:id/logs', { perm: ['integrations', 'VIEW'], tags: ['integrations'], summary: 'Sync loglari' }, async (ctx) => db.all('SELECT * FROM integration_sync_logs WHERE integration_id=? ORDER BY id DESC LIMIT 100', ctx.params.id));
  r.post('/api/integrations/webhook/:token', { auth: false, tags: ['integrations'], summary: 'Inbound webhook: {rows:[{tx_date,amount,direction,counterparty_name,counterparty_inn,purpose,external_id}]}' }, async (ctx) => {
    const all = db.all("SELECT * FROM integrations WHERE type='WEBHOOK_IN' AND is_active=1");
    const i = all.find((x) => parseJson(decryptSecret(x.secret_config) || '{}', {}).token === ctx.params.token);
    if (!i) throw unauthorized('Webhook token noto‘g‘ri');
    const cfg = parseJson(i.config, {});
    const rows = genericJsonRows(ctx.body?.rows || ctx.body || []);
    const res = app.services.banking.importRows(cfg.bank_account_id, rows, { source: 'WEBHOOK', ip: ctx.ip, user: null }, 'WEBHOOK');
    db.insert('integration_sync_logs', { integration_id: i.id, started_at: nowIso(), finished_at: nowIso(), status: 'OK', rows_in: res.rows, rows_new: res.created, message: JSON.stringify(res) });
    db.run('UPDATE integrations SET last_sync_at=?, last_status=? WHERE id=?', nowIso(), `Qabul qilindi: ${res.created} yangi`, i.id);
    return res;
  });
}
