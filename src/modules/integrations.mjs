import { badRequest, notFound, unauthorized } from '../core/http.mjs';
import { encryptSecret, decryptSecret, maskSecret } from '../core/auth.mjs';
import { config } from '../core/config.mjs';
import { nowIso, parseJson, sha256, uid } from '../core/util.mjs';
import { parseCsv, parseXlsx, excelDate } from '../core/export.mjs';
import { sendMail } from '../core/smtp.mjs';
import { parseLedger, importLedger } from '../import/ledger-journal.mjs';

/**
 * ADAPTER-BASED INTEGRATIONS. Har adapter: {type, name, description, config_schema, secret_schema, test(cfg,sec), pull(cfg,sec,since) → rows}
 * rows = normalizatsiya qilinmagan jadval (header + qatorlar) yoki tayyor {tx_date, amount, direction, ...} obyektlari.
 */
let normalizeRowsRef = () => []; // register() da banking.normalizeRows ga ulanadi (Google Sheets ustunlarini aniqlash)
async function fetchJson(url, headers = {}, { timeoutMs = 30000 } = {}) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try { res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: ac.signal }); }
  catch (e) { throw new Error(e.name === 'AbortError' ? 'Server javob bermadi (timeout)' : `Ulanib bo‘lmadi: ${e.cause?.code || e.message}`); }
  finally { clearTimeout(t); }
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new Error(`HTTP ${res.status} — login/parol yoki kalit noto‘g‘ri`);
  if (!res.ok) throw new Error(`HTTP ${res.status}${text ? ': ' + text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) : ''}`);
  try { return JSON.parse(text); } catch { throw new Error('Javob JSON emas' + (/<html/i.test(text) ? ' (HTML sahifa qaytdi — manzil noto‘g‘ri yoki login sahifasi)' : '')); }
}

// ---- Umumiy JSON → tranzaksiya moslashtirish (Bank API, ERP, 1C HTTP, Inbound webhook) ----
const getPath = (o, p) => (p ? String(p).split('.').reduce((a, k) => (a == null ? a : a[k]), o) : undefined);
const DEFAULT_FIELDS = {
  date: ['tx_date', 'date', 'value_date', 'operation_date', 'doc_date', 'Date', 'Дата'],
  amount: ['amount', 'sum', 'summa', 'Amount', 'Сумма', 'СуммаДокумента'],
  debit: ['debit', 'debet', 'Дебет'], credit: ['credit', 'kredit', 'Кредит'],
  direction: ['direction', 'type', 'operation_type', 'dc'],
  counterparty: ['counterparty_name', 'counterparty', 'name', 'payer_name', 'receiver_name', 'partner', 'Контрагент'],
  inn: ['counterparty_inn', 'inn', 'tin', 'payer_inn', 'receiver_inn', 'ИНН'],
  purpose: ['purpose', 'description', 'details', 'narrative', 'Назначение', 'НазначениеПлатежа'],
  id: ['external_id', 'id', 'doc_number', 'document_number', 'transaction_id', 'Номер'],
};
const pick = (row, map, key) => { if (map[key]) return getPath(row, map[key]); for (const k of DEFAULT_FIELDS[key]) if (row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k]; return undefined; };
const num = (v) => { if (v === undefined || v === null || v === '') return NaN; if (typeof v === 'number') return v; const n = Number(String(v ?? '').replace(/\s| /g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
function isoDate(v) {
  if (!v) return null;
  const x = excelDate(typeof v === 'number' && v < 100000 ? v : String(v));
  if (x) return x;
  const d = new Date(v); return Number.isNaN(+d) ? null : d.toISOString().slice(0, 10);
}
/** JSON javobdan ro'yxatni topadi: list_path yoki umumiy kalitlar (items/data/transactions/results/value/records) */
function listOf(data, listPath) {
  const v = listPath ? getPath(data, listPath) : data;
  if (Array.isArray(v)) return v;
  for (const k of ['items', 'data', 'transactions', 'results', 'value', 'records', 'rows']) if (Array.isArray(v?.[k])) return v[k];
  return [];
}
/** Har bir yozuvni {tx_date, amount, direction, ...} ga keltiradi. Sana yoki summa yo'q qatorlar tashlab yuboriladi (skipped). */
function mapRows(list, fieldMap = {}) {
  const rows = [], skipped = [];
  for (const x of list) {
    const tx_date = isoDate(pick(x, fieldMap, 'date'));
    const deb = num(pick(x, fieldMap, 'debit')), cre = num(pick(x, fieldMap, 'credit'));
    let amount = num(pick(x, fieldMap, 'amount')), direction;
    if (Number.isFinite(deb) || Number.isFinite(cre)) {
      // Bank ko'chirmasi: Debet — chiqim, Kredit — kirim (hisob egasi nuqtai nazaridan)
      if ((cre || 0) > 0) { amount = cre; direction = 'INCOME'; } else { amount = deb; direction = 'EXPENSE'; }
    } else {
      const d = String(pick(x, fieldMap, 'direction') ?? '').toUpperCase();
      direction = /EXP|OUT|DEB|CHIQ|РАСХ|СПИС|^D$|^-$/.test(d) || amount < 0 ? 'EXPENSE' : 'INCOME';
    }
    amount = Math.abs(amount);
    if (!tx_date || !Number.isFinite(amount) || amount <= 0) { skipped.push(x); continue; }
    const cp = pick(x, fieldMap, 'counterparty');
    const id = pick(x, fieldMap, 'id');
    rows.push({ tx_date, amount, direction, counterparty_name: typeof cp === 'object' ? cp?.Description || cp?.name || null : cp ?? null, counterparty_inn: pick(x, fieldMap, 'inn') ?? (typeof cp === 'object' ? cp?.ИНН || cp?.inn || null : null), purpose: pick(x, fieldMap, 'purpose') ?? null, external_id: id !== undefined && id !== null && id !== '' ? String(id) : undefined });
  }
  return { rows, skipped: skipped.length };
}

/** REST API (Bank API / ERP): manzil, autentifikatsiya, sana parametri va maydonlar sozlanadi */
function restAuth(cfg, sec) {
  const t = cfg.auth_type || 'bearer';
  if (t === 'none') return {};
  if (t === 'basic') return { Authorization: 'Basic ' + Buffer.from(`${sec.username || ''}:${sec.password || sec.api_key || ''}`).toString('base64') };
  if (t === 'header') return { [cfg.auth_header || 'X-API-Key']: sec.api_key || '' };
  return { Authorization: `Bearer ${sec.api_key || sec.token || ''}` };
}
function restUrl(cfg, since, extra = {}) {
  if (!cfg.base_url) throw new Error('API manzili (base_url) kiritilmagan');
  const u = new URL(String(cfg.base_url).replace(/\/$/, '') + String(cfg.endpoint || '').replace('{account_id}', encodeURIComponent(cfg.account_id || '')));
  if (since && cfg.since_param !== '') u.searchParams.set(cfg.since_param || 'from', since);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}
const fieldMapOf = (cfg) => (typeof cfg.field_map === 'string' ? parseJson(cfg.field_map, {}) : cfg.field_map) || {};
async function restPull(cfg, sec, since) {
  const data = await fetchJson(restUrl(cfg, since || daysAgo(cfg.days_back)), restAuth(cfg, sec));
  return mapRows(listOf(data, cfg.list_path), fieldMapOf(cfg)).rows;
}
async function restTest(cfg, sec) {
  const data = await fetchJson(restUrl(cfg, daysAgo(cfg.days_back || 30)), restAuth(cfg, sec));
  const list = listOf(data, cfg.list_path);
  const { rows, skipped } = mapRows(list, fieldMapOf(cfg));
  if (list.length && !rows.length) throw new Error(`Ulandi, lekin ${list.length} ta yozuvdan sana/summa aniqlanmadi — "Maydonlar moslashuvi"ni to‘ldiring. Namuna kalitlar: ${Object.keys(list[0] || {}).slice(0, 12).join(', ')}`);
  const x = rows[0];
  return `Ulandi: ${rows.length} ta tranzaksiya o‘qildi${skipped ? `, ${skipped} tasi tashlab yuborildi` : ''}${x ? ` · namuna: ${x.tx_date} ${x.direction === 'INCOME' ? '+' : '−'}${x.amount.toLocaleString('ru-RU')} ${x.counterparty_name || ''}` : ''}`;
}
const daysAgo = (n) => { const d = new Date(Date.now() - (Number(n) || 90) * 864e5); return d.toISOString().slice(0, 10); };

// ---- 1C: standart OData interfeysi (1C:Бухгалтерия 3.0 — "Стандартный интерфейс OData") ----
const ONEC_DOCS = [['Document_ПоступлениеНаРасчетныйСчет', 'INCOME'], ['Document_СписаниеСРасчетногоСчета', 'EXPENSE']];
function onecBase(cfg) { if (!cfg.base_url) throw new Error('1C baza manzili (base_url) kiritilmagan'); return String(cfg.base_url).replace(/\/$/, '').replace(/\/odata\/standard\.odata.*$/i, '') + '/odata/standard.odata/'; }
const onecAuth = (sec) => ({ Authorization: 'Basic ' + Buffer.from(`${sec.username || ''}:${sec.password || ''}`).toString('base64') });
async function onecOdataPull(cfg, sec, since) {
  const from = since || daysAgo(cfg.days_back);
  const rows = [];
  for (const [doc, direction] of ONEC_DOCS) {
    const q = `?$format=json&$filter=${encodeURIComponent(`Date ge datetime'${from}T00:00:00' and Posted eq true`)}&$expand=Контрагент`;
    let data;
    try { data = await fetchJson(onecBase(cfg) + encodeURIComponent(doc) + q, onecAuth(sec)); }
    catch (e) { if (/HTTP 400/.test(e.message)) data = await fetchJson(onecBase(cfg) + encodeURIComponent(doc) + q.replace('&$expand=Контрагент', ''), onecAuth(sec)); else throw e; }
    for (const d of listOf(data, 'value')) {
      const amount = Math.abs(num(d.СуммаДокумента));
      const tx_date = isoDate(d.Date);
      if (!tx_date || !(amount > 0)) continue;
      rows.push({ tx_date, amount, direction, counterparty_name: d.Контрагент?.Description || d.Контрагент?.НаименованиеПолное || null, counterparty_inn: d.Контрагент?.ИНН || null, purpose: d.НазначениеПлатежа || d.Комментарий || null, external_id: `1c:${d.Ref_Key}` });
    }
  }
  return rows;
}
async function onecOdataTest(cfg, sec) {
  const base = onecBase(cfg);
  let n = 0;
  for (const [doc] of ONEC_DOCS) {
    try { const d = await fetchJson(`${base}${encodeURIComponent(doc)}?$format=json&$top=1`, onecAuth(sec)); n += listOf(d, 'value').length; }
    catch (e) { if (/HTTP 404/.test(e.message)) throw new Error(`${doc} topilmadi — 1C'da "Стандартный интерфейс OData" ni yoqing va shu hujjatni tarkibga qo‘shing (Администрирование → Настройки синхронизации данных)`); throw e; }
  }
  return `1C OData ulandi (${base}) — bank hujjatlari o‘qildi${n ? '' : ', hozircha hujjat yo‘q'}`;
}

// ---- Google Sheets: oddiy havola, ID yoki "Publish to web" CSV havolasi ----
function sheetCsvUrl(cfg) {
  const link = String(cfg.sheet_url || '').trim();
  if (/output=csv|format=csv/.test(link)) return link;
  const id = /\/d\/(?:e\/)?([\w-]{20,})/.exec(link)?.[1] || cfg.sheet_id;
  if (!id) throw new Error('Google Sheets havolasi yoki ID kiritilmagan');
  const gid = /[#&?]gid=(\d+)/.exec(link)?.[1] ?? cfg.gid ?? 0;
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}
async function fetchSheet(cfg) {
  const res = await fetch(sheetCsvUrl(cfg), { redirect: 'follow' });
  const text = await res.text();
  if (!res.ok || /<html/i.test(text.slice(0, 300))) throw new Error(`Jadvalni o‘qib bo‘lmadi (HTTP ${res.status}) — Google Sheets'da "Share → Anyone with the link → Viewer" qiling`);
  return parseCsv(text);
}

export const ADAPTERS = {
  BANK_API: { name: 'Bank API', description: 'Bankning REST API (JSON) — ko‘chirma avtomatik tortiladi (har soatda). Manzil, kalit va maydonlar bank hujjatiga ko‘ra sozlanadi', config_schema: { base_url: '', endpoint: '/accounts/{account_id}/transactions', account_id: '', auth_type: 'bearer', since_param: 'from', list_path: '', field_map: {}, days_back: 90, bank_account_id: 1 }, secret_schema: { api_key: '' },
    test: (cfg, sec) => restTest(cfg, sec), pull: (cfg, sec, since) => restPull(cfg, sec, since) },
  GOOGLE_SHEETS: { name: 'Google Sheets', description: 'Jadval havolasi (Share → Anyone with the link) — ustunlar avtomatik aniqlanadi, har soatda sinxronlanadi', config_schema: { sheet_url: '', bank_account_id: 1, mapping: {} }, secret_schema: {},
    async test(cfg) { const table = await fetchSheet(cfg); const rows = normalizeRowsRef(table, cfg.mapping); if (!rows.length) throw new Error(`Jadval o‘qildi (${table.length} qator), lekin tranzaksiya topilmadi — Sana va Summa (yoki Debet/Kredit) ustunlari bo‘lishi kerak`); return `Ulandi: ${rows.length} ta tranzaksiya topildi (${table.length} qator)`; },
    async pull(cfg) { return { table: await fetchSheet(cfg), mapping: cfg.mapping }; } },
  LEDGER: { name: 'Moliya jurnali (Excel)', description: 'Double-entry jurnal: shartnomalar (sotuv), bank/kassa tushumlari, xarajatlar, dividend va o‘tkazmalar — faqat fayldagi ma’lumot', config_schema: {}, secret_schema: {}, async test() { return 'Qo‘lda yuklanadi'; }, async pull() { return []; } },
  EXCEL: { name: 'Excel / CSV fayl', description: 'Bank ko‘chirmasini Excel (.xlsx) yoki CSV fayl sifatida yuklash', config_schema: { bank_account_id: 1 }, secret_schema: {}, async test() { return 'Manual'; }, async pull() { return []; } },
  ONE_C: { name: '1C', description: '1C:Бухгалтерия — standart OData (Поступление/Списание с расчетного счета) yoki o‘z HTTP-servisingiz (JSON). Har soatda sinxronlanadi', config_schema: { mode: 'odata', base_url: '', endpoint: '/transactions', days_back: 90, bank_account_id: 1 }, secret_schema: { username: '', password: '' },
    async test(cfg, sec) { if ((cfg.mode || 'odata') === 'odata') return onecOdataTest(cfg, sec); return restTest({ ...cfg, auth_type: 'basic' }, sec); },
    async pull(cfg, sec, since) { if ((cfg.mode || 'odata') === 'odata') return onecOdataPull(cfg, sec, since); return restPull({ ...cfg, auth_type: 'basic' }, sec, since); } },
  ERP: { name: 'ERP', description: 'Istalgan ERP/hisob tizimining REST API (JSON) — manzil, autentifikatsiya va maydonlar sozlanadi', config_schema: { base_url: '', endpoint: '/api/bank-transactions', auth_type: 'bearer', since_param: 'from', list_path: '', field_map: {}, days_back: 90, bank_account_id: 1 }, secret_schema: { api_key: '' },
    test: (cfg, sec) => restTest(cfg, sec), pull: (cfg, sec, since) => restPull(cfg, sec, since) },
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
  EMAIL: { name: 'Email', description: 'SMTP orqali email bildirishnomalari (Gmail, Yandex, mail.uz, korporativ server) — kritik ogohlantirishlar va kunlik xulosa', config_schema: { mode: 'smtp', smtp_host: '', smtp_port: 465, smtp_security: 'ssl', from: '', recipients: '', webhook_url: '' }, secret_schema: { smtp_user: '', smtp_pass: '' },
    async test(cfg, sec) {
      if (!cfg.recipients) throw new Error('Qabul qiluvchi email kiritilmagan (sinov xati shu manzilga yuboriladi)');
      if ((cfg.mode || 'smtp') === 'webhook') {
        const url = cfg.webhook_url || config.emailWebhook;
        if (!url) throw new Error('Webhook manzili kiritilmagan');
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: cfg.recipients, subject: 'UTAX Finance: ulanish tekshiruvi', body: 'Elektron pochta integratsiyasi ishlayapti.' }) });
        if (!res.ok) throw new Error(`Webhook javobi: HTTP ${res.status}`);
        return 'Webhook javob berdi (HTTP ' + res.status + ')';
      }
      const r = await sendMail({ host: cfg.smtp_host, port: cfg.smtp_port, security: cfg.smtp_security, user: sec.smtp_user, pass: sec.smtp_pass, from: cfg.from || sec.smtp_user, to: cfg.recipients, subject: 'UTAX Finance: email ulanish tekshiruvi', text: 'Salom!\n\nUTAX Finance email bildirishnomalari ulandi. Kritik ogohlantirishlar va kunlik xulosa shu manzilga yuboriladi.\n\n— UTAX Finance' });
      return `Sinov xati yuborildi: ${r.accepted.join(', ')}`;
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
  WEBHOOK_IN: { name: 'Inbound webhook', description: 'Tashqi tizim (bank, 1C, Zapier/Make) POST /api/integrations/webhook/<token> ga tranzaksiyalarni yuboradi: {rows:[{date, amount, direction, counterparty, inn, purpose, id}]}', config_schema: { bank_account_id: 1, field_map: {} }, secret_schema: { token: '' },
    async test(cfg, sec) { if (!sec.token) throw new Error('Token yo‘q — integratsiyani qayta yarating'); return `Qabul manzili: POST ${config.publicUrl || '<sayt manzili>'}/api/integrations/webhook/${sec.token} · JSON: {"rows":[{"date":"2026-07-01","amount":1000000,"direction":"INCOME","counterparty":"…","purpose":"…","id":"…"}]}`; },
    async pull() { return []; } },
};

export function register(app) {
  const { r, db, audit } = app;
  normalizeRowsRef = (table, mapping) => app.services.banking.normalizeRows(table || [], mapping || {});
  const ENV = { telegramAlertChat: config.telegramAlertChat, emailWebhook: config.emailWebhook, geminiKey: config.ai.geminiKey, geminiModel: config.ai.geminiModel, groqKey: config.ai.groqKey, groqModel: config.ai.groqModel };
  /** Tizimda saqlangan sozlamalar .env qiymatlaridan ustun: Telegram kritik guruhi, Email webhook, Gemini/Groq kalitlari (shifrlangan). Bot tokenlari — faqat .env (BOT_*_TOKEN). */
  async function applyRuntime() {
    const tg = db.get("SELECT * FROM integrations WHERE type='TELEGRAM' AND is_active=1 ORDER BY id DESC LIMIT 1");
    const tgCfg = tg ? parseJson(tg.config, {}) : {};
    config.telegramAlertChat = tgCfg.alert_chat_id || ENV.telegramAlertChat;
    const em = db.get("SELECT * FROM integrations WHERE type='EMAIL' AND is_active=1 ORDER BY id DESC LIMIT 1");
    const emCfg = em ? parseJson(em.config, {}) : {};
    config.emailWebhook = emCfg.webhook_url || ENV.emailWebhook;
    // SMTP (asosiy): parol shifrlangan holda saqlanadi, faqat xotirada ochiladi
    if (em && (emCfg.mode || 'smtp') === 'smtp' && emCfg.smtp_host) {
      const emSec = parseJson(decryptSecret(em.secret_config) || '{}', {});
      config.email = { mode: 'smtp', host: emCfg.smtp_host, port: emCfg.smtp_port, security: emCfg.smtp_security || 'ssl', user: emSec.smtp_user || '', pass: emSec.smtp_pass || '', from: emCfg.from || emSec.smtp_user || '' };
    } else config.email = null;
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
  r.post('/api/integrations/ledger-upload', { perm: ['integrations', 'EDIT'], tags: ['integrations'], summary: 'Moliya jurnalini (Excel) yuklash: {xlsx_base64, file_name, preview?}' }, async (ctx) => {
    app.rbac.require(ctx.user, 'transactions', 'CREATE');
    const b = ctx.body || {};
    let table;
    try { table = b.xlsx_base64 ? parseXlsx(Buffer.from(b.xlsx_base64, 'base64')) : null; }
    catch (e) { throw badRequest('Faylni o‘qib bo‘lmadi: ' + e.message + '. Faqat .xlsx formatini yuklang.'); }
    if (!table) throw badRequest('Fayl kerak (.xlsx)');
    const fileName = String(b.file_name || 'jurnal.xlsx').slice(0, 200);
    let parsed;
    try { parsed = parseLedger(table); } catch (e) { throw badRequest(e.message); }
    if (b.preview) return { file: fileName, ...parsed.stats, skipped: parsed.skipped, warnings: parsed.warnings };
    let res;
    try { res = importLedger(app, table, ctx, { fileName }); } catch (e) { throw badRequest(e.message); }
    let integ = db.get("SELECT * FROM integrations WHERE type='LEDGER' ORDER BY id LIMIT 1");
    if (!integ) { const id = db.insert('integrations', { type: 'LEDGER', name: 'Moliya jurnali (Excel)', config: '{}', secret_config: encryptSecret('{}'), created_at: nowIso() }); integ = { id }; }
    db.insert('integration_sync_logs', { integration_id: integ.id, started_at: nowIso(), finished_at: nowIso(), status: 'OK', rows_in: res.rows, rows_new: res.created.bank + res.created.cash + res.created.contracts, message: JSON.stringify({ file: fileName, created: res.created, duplicates: res.duplicates, skipped: res.skipped.length }) });
    db.run('UPDATE integrations SET last_sync_at=?, last_status=? WHERE id=?', nowIso(), `Yuklandi: ${fileName} — ${res.created.contracts} shartnoma, ${res.created.bank} bank, ${res.created.cash} kassa, ${res.duplicates} takroriy`, integ.id);
    audit(ctx, { action: 'IMPORT', entity: 'integration', entityId: integ.id, newValue: { file: fileName, created: res.created, duplicates: res.duplicates, skipped: res.skipped.length, warnings: res.warnings.length } });
    return res;
  });
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
    const { rows, skipped } = mapRows(listOf(ctx.body?.rows ? ctx.body.rows : ctx.body || []), fieldMapOf(cfg));
    if (!rows.length) throw badRequest(`Yaroqli tranzaksiya yo‘q${skipped ? ` (${skipped} ta yozuvda sana yoki summa aniqlanmadi)` : ''}`);
    const res = app.services.banking.importRows(cfg.bank_account_id, rows, { source: 'WEBHOOK', ip: ctx.ip, user: null }, 'WEBHOOK');
    db.insert('integration_sync_logs', { integration_id: i.id, started_at: nowIso(), finished_at: nowIso(), status: 'OK', rows_in: res.rows, rows_new: res.created, message: JSON.stringify(res) });
    db.run('UPDATE integrations SET last_sync_at=?, last_status=? WHERE id=?', nowIso(), `Qabul qilindi: ${res.created} yangi`, i.id);
    return res;
  });
}
