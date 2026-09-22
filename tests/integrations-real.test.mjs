// Integratsiya adapterlari HAQIQIY tarmoq orqali: lokal soxta serverlar (Bank API, ERP, 1C OData, Google Sheets CSV, SMTP)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createApp, createHandler } from '../src/server.mjs';
import { seed } from './fixtures/demo-seed.mjs'; // to'qima test ma'lumotlari — faqat testlar uchun
import { encryptSecret } from '../src/core/auth.mjs';
import { ADAPTERS } from '../src/modules/integrations.mjs';

let app, ctx, api, base, smtp, smtpPort, mails = [], appSrv, appBase;
const hits = [];

before(async () => {
  app = createApp({ dbPath: ':memory:' });
  await seed(app, { log: () => {} });
  ctx = { user: app.db.get("SELECT * FROM users WHERE email='founder@utax.uz'"), ip: '127.0.0.1', source: 'TEST' };
  // --- Soxta tashqi tizimlar ---
  api = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    hits.push({ path: decodeURIComponent(u.pathname), q: Object.fromEntries(u.searchParams), auth: req.headers.authorization, key: req.headers['x-api-key'] });
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const p = decodeURIComponent(u.pathname);
    if (p === '/bank/accounts/ACC-1/statement') {
      if (req.headers.authorization !== 'Bearer bank-key') return json(401, { error: 'bad key' });
      return json(200, { data: { operations: [
        { operDate: '05.07.2026', debet: 0, kredit: 12500000, partner: { name: 'ALFA MCHJ', tin: '301234567' }, details: 'Oplata po dogovoru', docId: 'B-1' },
        { operDate: '06.07.2026', debet: 3200000, kredit: 0, partner: { name: 'Ijara MCHJ', tin: '309999999' }, details: 'Arenda iyul', docId: 'B-2' },
        { operDate: '', debet: 0, kredit: 100, docId: 'B-bad' },
      ] } });
    }
    if (p === '/erp/api/bank-transactions') {
      if (req.headers['x-api-key'] !== 'erp-key') return json(403, {});
      return json(200, { items: [{ date: '2026-07-10', amount: -450000, counterparty: 'Uzbektelecom', purpose: 'Internet', id: 'E-1' }, { date: '2026-07-11', amount: 900000, counterparty: 'Beta', id: 'E-2' }] });
    }
    if (p.startsWith('/buh/odata/standard.odata/')) {
      const expect = 'Basic ' + Buffer.from('odata:pw').toString('base64');
      if (req.headers.authorization !== expect) return json(401, {});
      const doc = p.split('/').pop();
      if (doc === 'Document_ПоступлениеНаРасчетныйСчет') return json(200, { value: [{ Ref_Key: 'r-in-1', Date: '2026-07-15T10:00:00', СуммаДокумента: 7000000, НазначениеПлатежа: 'Оплата по договору UTAX-R-00001', Контрагент: { Description: 'GAMMA MCHJ', ИНН: '305555555' } }] });
      if (doc === 'Document_СписаниеСРасчетногоСчета') return json(200, { value: [{ Ref_Key: 'r-out-1', Date: '2026-07-16T09:00:00', СуммаДокумента: 1500000, НазначениеПлатежа: 'Hosting', Контрагент: { Description: 'AHOST' } }] });
      return json(404, {});
    }
    if (p === '/sheet.csv') { res.writeHead(200, { 'content-type': 'text/csv' }); return res.end('Sana;Summa;Kontragent;Maqsad\n01.07.2026;2 000 000;DELTA;To‘lov\n02.07.2026;-350 000;Taksi;Transport\n'); }
    if (p === '/private.csv') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html><body>Sign in</body></html>'); }
    json(404, {});
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${api.address().port}`;
  // --- Soxta SMTP server (himoyasiz, ichki tarmoq rejimi) ---
  smtp = net.createServer((s) => {
    let data = false, buf = '', mail = { rcpt: [] };
    s.write('220 test ESMTP\r\n');
    s.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data) { if (line === '.') { data = false; mails.push(mail); mail = { rcpt: [] }; s.write('250 queued\r\n'); } else mail.body = (mail.body || '') + line + '\n'; continue; }
        if (/^EHLO/i.test(line)) s.write('250-test\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n');
        else if (/^AUTH PLAIN/i.test(line)) { mail.auth = Buffer.from(line.split(' ')[2], 'base64').toString(); s.write(mail.auth === '\0mailer@utax.uz\0app-pass' ? '235 ok\r\n' : '535 bad\r\n'); }
        else if (/^MAIL FROM/i.test(line)) { mail.from = line; s.write('250 ok\r\n'); }
        else if (/^RCPT TO/i.test(line)) { mail.rcpt.push(line); s.write('250 ok\r\n'); }
        else if (/^DATA/i.test(line)) { data = true; s.write('354 go\r\n'); }
        else if (/^QUIT/i.test(line)) { s.write('221 bye\r\n'); s.end(); }
        else s.write('250 ok\r\n');
      }
    });
  });
  await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
  smtpPort = smtp.address().port;
  appSrv = http.createServer(createHandler(app));
  await new Promise((r) => appSrv.listen(0, '127.0.0.1', r));
  appBase = `http://127.0.0.1:${appSrv.address().port}`;
});
after(() => { api?.close(); smtp?.close(); appSrv?.close(); });

const add = (type, cfg, sec = {}) => app.db.get('SELECT * FROM integrations WHERE id=?', app.db.insert('integrations', { type, name: type + ' test', config: JSON.stringify(cfg), secret_config: encryptSecret(JSON.stringify(sec)), created_at: new Date().toISOString() }));
const txCount = () => app.db.get('SELECT COUNT(*) n FROM bank_transactions').n;

test('Bank API: maydonlar moslashuvi (debet/kredit, ichki yo‘l), Bearer kalit, sana parametri, takroriy sinxronlash', async () => {
  const cfg = { base_url: base + '/bank', endpoint: '/accounts/{account_id}/statement', account_id: 'ACC-1', auth_type: 'bearer', since_param: 'from', list_path: 'data.operations', field_map: { date: 'operDate', debit: 'debet', credit: 'kredit', counterparty: 'partner.name', inn: 'partner.tin', purpose: 'details', id: 'docId' }, days_back: 30, bank_account_id: 1 };
  const msg = await ADAPTERS.BANK_API.test(cfg, { api_key: 'bank-key' });
  assert.match(msg, /2 ta tranzaksiya o‘qildi, 1 tasi tashlab yuborildi/);
  assert.ok(hits.at(-1).q.from, 'sana parametri yuborildi');
  await assert.rejects(ADAPTERS.BANK_API.test(cfg, { api_key: 'wrong' }), /401 — login\/parol yoki kalit noto‘g‘ri/);
  const i = add('BANK_API', cfg, { api_key: 'bank-key' });
  const before = txCount();
  const r = await app.services.integrations.sync(i, ctx);
  assert.equal(r.created, 2);
  const inc = app.db.get("SELECT * FROM bank_transactions WHERE external_id='B-1'");
  assert.equal(inc.direction, 'INCOME'); assert.equal(inc.amount, 12500000); assert.equal(inc.counterparty_inn, '301234567'); assert.equal(inc.tx_date, '2026-07-05');
  assert.equal(app.db.get("SELECT direction FROM bank_transactions WHERE external_id='B-2'").direction, 'EXPENSE');
  const r2 = await app.services.integrations.sync(app.db.get('SELECT * FROM integrations WHERE id=?', i.id), ctx);
  assert.equal(r2.created, 0); assert.equal(txCount(), before + 2);
});

test('ERP: X-API-Key sarlavhasi, avtomatik maydonlar, manfiy summa → chiqim', async () => {
  const cfg = { base_url: base + '/erp', endpoint: '/api/bank-transactions', auth_type: 'header', since_param: '', bank_account_id: 1 };
  await assert.rejects(ADAPTERS.ERP.test(cfg, { api_key: 'nope' }), /403/);
  const r = await app.services.integrations.sync(add('ERP', cfg, { api_key: 'erp-key' }), ctx);
  assert.equal(r.created, 2);
  const t = app.db.get("SELECT * FROM bank_transactions WHERE external_id='E-1'");
  assert.equal(t.direction, 'EXPENSE'); assert.equal(t.amount, 450000);
  assert.equal(hits.at(-1).q.from, undefined, 'since_param bo‘sh — sana yuborilmaydi');
});

test('1C OData: standart hujjatlar (Поступление/Списание), Basic login, $filter, kontragent $expand', async () => {
  const cfg = { mode: 'odata', base_url: base + '/buh', days_back: 60, bank_account_id: 1 };
  assert.match(await ADAPTERS.ONE_C.test(cfg, { username: 'odata', password: 'pw' }), /1C OData ulandi/);
  await assert.rejects(ADAPTERS.ONE_C.test(cfg, { username: 'odata', password: 'x' }), /401/);
  const r = await app.services.integrations.sync(add('ONE_C', cfg, { username: 'odata', password: 'pw' }), ctx);
  assert.equal(r.created, 2);
  const inc = app.db.get("SELECT * FROM bank_transactions WHERE external_id='1c:r-in-1'");
  assert.equal(inc.direction, 'INCOME'); assert.equal(inc.counterparty_name, 'GAMMA MCHJ'); assert.equal(inc.counterparty_inn, '305555555'); assert.equal(inc.tx_date, '2026-07-15');
  assert.equal(app.db.get("SELECT direction FROM bank_transactions WHERE external_id='1c:r-out-1'").direction, 'EXPENSE');
  const q = hits.filter((h) => h.path.includes('odata')).at(-1).q;
  assert.match(q.$filter, /Date ge datetime'\d{4}-\d{2}-\d{2}T00:00:00' and Posted eq true/);
  assert.equal(q.$expand, 'Контрагент');
});

test('Google Sheets: CSV havola, ustunlar avtomatik; yopiq jadval → tushunarli xato', async () => {
  assert.match(await ADAPTERS.GOOGLE_SHEETS.test({ sheet_url: base + '/sheet.csv?output=csv' }), /2 ta tranzaksiya topildi/);
  await assert.rejects(ADAPTERS.GOOGLE_SHEETS.test({ sheet_url: base + '/private.csv?output=csv' }), /Anyone with the link/);
  const r = await app.services.integrations.sync(add('GOOGLE_SHEETS', { sheet_url: base + '/sheet.csv?output=csv', bank_account_id: 1 }), ctx);
  assert.equal(r.created, 2);
});

test('Email SMTP: sinov xati haqiqiy SMTP suhbati orqali (AUTH PLAIN, UTF-8 mavzu); bildirishnoma ham SMTP bilan', async () => {
  const cfg = { mode: 'smtp', smtp_host: '127.0.0.1', smtp_port: smtpPort, smtp_security: 'none', from: 'mailer@utax.uz', recipients: 'cfo@utax.uz, ceo@utax.uz' };
  const msg = await ADAPTERS.EMAIL.test(cfg, { smtp_user: 'mailer@utax.uz', smtp_pass: 'app-pass' });
  assert.match(msg, /Sinov xati yuborildi: cfo@utax.uz, ceo@utax.uz/);
  const m = mails.at(-1);
  assert.equal(m.rcpt.length, 2);
  assert.match(m.body, /Subject: UTAX Finance: email ulanish tekshiruvi/);
  const text = Buffer.from(m.body.split('\n\n').slice(1).join('').replace(/\s/g, ''), 'base64').toString('utf8');
  assert.match(text, /email bildirishnomalari ulandi/);
  await assert.rejects(ADAPTERS.EMAIL.test(cfg, { smtp_user: 'mailer@utax.uz', smtp_pass: 'wrong' }), /SMTP 535/);
  // Runtime: integratsiya yozuvi → config.email → notifications.sendEmail SMTP orqali
  add('EMAIL', cfg, { smtp_user: 'mailer@utax.uz', smtp_pass: 'app-pass' });
  await app.services.applyIntegrationsRuntime();
  app.settings.set('notifications.email_enabled', true);
  const n = mails.length;
  const r = await app.services.notifications.sendEmail('cfo@utax.uz', 'Kritik: pul qoldig‘i past', 'Ishlatish mumkin pul 0 dan past');
  assert.equal(r.ok, true, r.error);
  assert.equal(mails.length, n + 1);
  const sub = /Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(mails.at(-1).body)?.[1];
  assert.equal(Buffer.from(sub, 'base64').toString('utf8'), 'Kritik: pul qoldig‘i past', 'UTF-8 mavzu (RFC 2047)');
});

test('Inbound webhook: token, maydonlar moslashuvi, xato holatlar', async () => {
  const i = add('WEBHOOK_IN', { bank_account_id: 1, field_map: { date: 'd', amount: 's', counterparty: 'who', id: 'ref' } }, { token: 'tok-123' });
  assert.match(await ADAPTERS.WEBHOOK_IN.test({}, { token: 'tok-123' }), /\/api\/integrations\/webhook\/tok-123/);
  const post = (tok, body) => fetch(`${appBase}/api/integrations/webhook/${tok}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('wrong', { rows: [] })).status, 401);
  assert.equal((await post('tok-123', { rows: [{ d: '', s: 0 }] })).status, 400);
  const res = await post('tok-123', { rows: [{ d: '2026-07-20', s: 555000, who: 'OMEGA', ref: 'W-1' }] });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).created, 1);
  assert.equal(app.db.get("SELECT counterparty_name FROM bank_transactions WHERE external_id='W-1'").counterparty_name, 'OMEGA');
  assert.match(app.db.get('SELECT last_status FROM integrations WHERE id=?', i.id).last_status, /1 yangi/);
});
