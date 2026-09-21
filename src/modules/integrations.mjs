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
  EXCEL: { name: 'Excel / CSV fayl', description: 'Qo‘lda yuklash (Tranzaksiyalar → Import)', config_schema: { bank_account_id: 1 }, secret_schema: {}, async test() { return 'Manual'; }, async pull() { return []; } },
  ONE_C: { name: '1C', description: '1C HTTP-servis (JSON) — bank/kassa hujjatlari', config_schema: { base_url: 'http://1c.local/base/hs/finance', endpoint: '/transactions', bank_account_id: 1 }, secret_schema: { username: '', password: '' },
    auth: (sec) => ({ Authorization: 'Basic ' + Buffer.from(`${sec.username}:${sec.password}`).toString('base64') }),
    async test(cfg, sec) { await fetchJson(`${cfg.base_url}${cfg.endpoint}?limit=1`, this.auth(sec)); return 'OK'; },
    async pull(cfg, sec, since) { return genericJsonRows(await fetchJson(`${cfg.base_url}${cfg.endpoint}?since=${since || ''}`, this.auth(sec))); } },
  ERP: { name: 'ERP', description: 'Umumiy ERP REST (JSON) adapteri', config_schema: { base_url: '', endpoint: '/api/bank-transactions', bank_account_id: 1 }, secret_schema: { token: '' },
    async test(cfg, sec) { await fetchJson(`${cfg.base_url}${cfg.endpoint}?limit=1`, { Authorization: `Bearer ${sec.token}` }); return 'OK'; },
    async pull(cfg, sec, since) { return genericJsonRows(await fetchJson(`${cfg.base_url}${cfg.endpoint}?since=${since || ''}`, { Authorization: `Bearer ${sec.token}` })); } },
  TELEGRAM: { name: 'Telegram', description: 'Bot orqali bildirishnoma va buyruqlar (TELEGRAM_BOT_TOKEN .env)', config_schema: {}, secret_schema: {},
    async test() { if (!config.telegramToken) throw new Error('TELEGRAM_BOT_TOKEN sozlanmagan'); const j = await fetchJson(`https://api.telegram.org/bot${config.telegramToken}/getMe`); return `OK @${j.result?.username}`; }, async pull() { return []; } },
  EMAIL: { name: 'Email', description: 'Webhook orqali email (EMAIL_WEBHOOK_URL)', config_schema: {}, secret_schema: {}, async test() { if (!config.emailWebhook) throw new Error('EMAIL_WEBHOOK_URL sozlanmagan'); return 'OK'; }, async pull() { return []; } },
  WEBHOOK_IN: { name: 'Inbound webhook', description: 'Tashqi tizim POST /api/integrations/webhook/:token orqali tranzaksiya yuboradi', config_schema: { bank_account_id: 1 }, secret_schema: { token: '' }, async test() { return 'OK'; }, async pull() { return []; } },
};

export function register(app) {
  const { r, db, audit } = app;
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
      db.run('UPDATE integrations SET last_sync_at=?, last_status=? WHERE id=?', nowIso(), 'OK', integration.id);
      audit(ctx, { action: 'SYNC', entity: 'integration', entityId: integration.id, newValue: res });
      return res;
    } catch (e) {
      db.run('UPDATE integration_sync_logs SET finished_at=?, status=?, message=? WHERE id=?', nowIso(), 'ERROR', e.message, logId);
      db.run('UPDATE integrations SET last_sync_at=?, last_status=? WHERE id=?', nowIso(), 'ERROR: ' + e.message, integration.id);
      throw badRequest('Sync xato: ' + e.message);
    }
  }
  app.services.integrations = { sync, ADAPTERS };

  r.get('/api/integrations', { perm: ['integrations', 'VIEW'], tags: ['integrations'], summary: 'Integratsiyalar' }, async () => db.all('SELECT * FROM integrations ORDER BY id').map(view));
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
    return view(db.get('SELECT * FROM integrations WHERE id=?', i.id));
  });
  r.post('/api/integrations/:id/test', { perm: ['integrations', 'EDIT'], tags: ['integrations'], summary: 'Ulanishni tekshirish' }, async (ctx) => {
    const i = db.get('SELECT * FROM integrations WHERE id=?', ctx.params.id);
    if (!i) throw notFound();
    try { const msg = await ADAPTERS[i.type].test(parseJson(i.config, {}), parseJson(decryptSecret(i.secret_config) || '{}', {})); db.run('UPDATE integrations SET last_status=? WHERE id=?', 'TEST ' + msg, i.id); return { ok: true, message: msg }; }
    catch (e) { db.run('UPDATE integrations SET last_status=? WHERE id=?', 'TEST ERROR: ' + e.message, i.id); return { ok: false, message: e.message }; }
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
    db.run('UPDATE integrations SET last_sync_at=?, last_status=? WHERE id=?', nowIso(), 'OK', i.id);
    return res;
  });
}
