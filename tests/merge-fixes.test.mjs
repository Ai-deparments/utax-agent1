/**
 * Merge review tuzatishlari (#28 TZ sana, #29 alert guruh dedupe, #30 Docker/AI env) — xato qaytmasin.
 * Tarmoqsiz: Telegram — soxta (bot-harness) yoki stub, LLM chaqirilmaydi; baza — :memory:.
 */
import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config, ROOT } from '../src/core/config.mjs';
import { today, localDate, appTimeZone } from '../src/core/util.mjs';
import { createApp } from '../src/server.mjs';
import { seed } from './fixtures/demo-seed.mjs';
import { createBotHarness } from './helpers/bot-harness.mjs';
import { providersFromEnv, envReader } from '../scripts/llm-check.mjs';

/** process.env.TZ ni vaqtincha almashtirish (Node Date mahalliy vaqti ham darhol o'zgaradi) */
async function withTz(tz, fn) {
  const old = process.env.TZ;
  process.env.TZ = tz;
  try { return await fn(); } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
}
/** Soxta soat (faqat Date) — test tugagach doim tiklanadi */
async function atTime(iso, fn) {
  mock.timers.enable({ apis: ['Date'], now: Date.parse(iso) });
  try { return await fn(); } finally { mock.timers.reset(); }
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ---------------------------------------------------------------- #28
describe('#28 today() — jarayon TZ bo‘yicha mahalliy kalendar sana (UTC emas)', () => {
  test('Toshkent 2026-10-01 00:30 (+05:00) → today() = 2026-10-01 (UTC bo‘yicha hali 30-sentyabr)', async () => {
    await withTz('Asia/Tashkent', () => atTime('2026-10-01T00:30:00+05:00', () => {
      assert.equal(new Date().toISOString().slice(0, 10), '2026-09-30', 'UTC sana — kechagi kun (xato manbai)');
      assert.equal(today(), '2026-10-01');
    }));
  });

  test('kun chegaralari: 23:59:59 va 00:00:00 Toshkent', async () => {
    await withTz('Asia/Tashkent', async () => {
      await atTime('2026-10-01T23:59:59+05:00', () => assert.equal(today(), '2026-10-01'));
      await atTime('2026-10-02T00:00:00+05:00', () => assert.equal(today(), '2026-10-02'));
      await atTime('2026-12-31T19:00:00Z', () => assert.equal(today(), '2027-01-01', 'yil almashishi'));
    });
  });

  test('TZ jarayonga ergashadi: TZ=UTC → UTC sana (scheduler setHours bilan bir zonada)', async () => {
    await withTz('UTC', () => atTime('2026-10-01T00:30:00+05:00', () => {
      assert.equal(appTimeZone(), 'UTC');
      assert.equal(today(), '2026-09-30');
    }));
  });

  test('localDate: aniq zona va Intl tanimaydigan TZ uchun zaxira (Node mahalliy vaqti)', () => {
    const d = new Date('2026-09-30T19:30:00Z');
    assert.equal(localDate(d, 'Asia/Tashkent'), '2026-10-01');
    assert.equal(localDate(d, 'UTC'), '2026-09-30');
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    assert.equal(localDate(d, 'Yoq/Bunday_Zona'), local, 'buzuq TZ yiqitmaydi');
  });

  describe('scheduler: oyning 1-kuni Toshkent 01:00 REVENUE va 03:00 backup yangi sana bilan', () => {
    let app, cid, backupDir;
    const oldBackupDir = config.backupDir;
    before(async () => {
      app = createApp({ dbPath: ':memory:' });
      await seed(app, { log: () => {} });
      const st = app.db.get("SELECT id FROM service_types WHERE code='SUBSCRIPTION'");
      const co = app.db.get('SELECT id FROM companies LIMIT 1');
      cid = app.db.insert('contracts', { contract_number: 'UTAX-SB-TZ-28', company_id: co.id, service_type_id: st.id, amount: 6e6, contract_date: '2026-09-15', start_date: '2026-10-01', end_date: '2027-03-31', contract_status: 'ACTIVE', service_status: 'IN_PROGRESS', created_at: new Date().toISOString() });
      backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utax-backup-tz-'));
      config.backupDir = backupDir; // haqiqiy data/backups ga tegilmaydi
    });
    after(() => { config.backupDir = oldBackupDir; try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch {} app?.db.close(); });

    test('REVENUE (dailyAt 01:00) 1-oktabr 01:00 da oktabr obuna daromadini tan oladi', async () => {
      await withTz('Asia/Tashkent', () => atTime('2026-10-01T01:00:30+05:00', async () => {
        const kecha = new Date(Date.now() - 86400e3).toISOString();
        app.db.run('INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'scheduler.last_run.revenue', JSON.stringify(kecha), kecha);
        const r = await app.scheduler.run('revenue', false); // force=false — haqiqiy dailyAt hisobi
        assert.ok(r && !r.error, 'job ishladi: ' + JSON.stringify(r?.error || r));
      }));
      const recs = app.db.all('SELECT period, recognized_at FROM revenue_recognition WHERE contract_id=?', cid).map((x) => ({ ...x }));
      assert.deepEqual(recs, [{ period: '2026-10', recognized_at: '2026-10-01' }]);
    });

    test('backup (dailyAt 03:00) fayli Toshkent sanasi bilan: finance-2026-10-01.db', async () => {
      await withTz('Asia/Tashkent', () => atTime('2026-10-01T03:00:30+05:00', async () => {
        const r = await app.scheduler.run('backup', false);
        assert.ok(!r?.error, String(r?.error));
      }));
      const files = fs.readdirSync(backupDir);
      assert.ok(files.includes('finance-2026-10-01.db'), files.join(','));
      assert.ok(!files.includes('finance-2026-09-30.db'));
    });
  });
});

// ---------------------------------------------------------------- #29
describe('#29 CRITICAL alert guruhi — alohida dedupe (dedupe_key:alert)', () => {
  let app, S, sent, result;
  const oldChat = config.telegramAlertChat;
  const alertRows = (key) => app.db.all("SELECT * FROM notifications WHERE channel='ALERT' AND dedupe_key=?", key);
  before(async () => {
    app = createApp({ dbPath: ':memory:' });
    await seed(app, { log: () => {} });
    S = app.services;
    config.telegramAlertChat = '-100555';
    sent = [];
    result = true;
    // Stub: signal bot facade'ining alertChat qismi (tarmoqsiz)
    app.bots = { alertChat: async (n) => { if (result === 'throw') throw new Error('tarmoq'); if (result) sent.push(n); return result; }, dispatch() {} };
  });
  after(() => { config.telegramAlertChat = oldChat; app?.db.close(); });
  const critical = (extra = {}) => ({ roles: ['FOUNDER', 'CEO', 'CFO'], type: 'LOW_LIQUIDITY', severity: 'CRITICAL', title: 'Likvidlik past!', body: 'test', ...extra });

  test('ikki marta notify (bir xil dedupe_key) → guruhga bitta xabar', async () => {
    sent.length = 0; result = true;
    const a = S.notifications.notify(critical({ dedupe_key: 'lowliq:t1' }));
    const b = S.notifications.notify(critical({ dedupe_key: 'lowliq:t1' }));
    await S.notifications.flushAlerts();
    assert.ok(a.length > 0);
    assert.equal(b.length, 0, 'foydalanuvchi yozuvlari ham dedupe');
    assert.equal(sent.length, 1);
    const [row] = alertRows('lowliq:t1:alert');
    assert.ok(row.sent_at, 'yuborilgan deb belgilandi');
    assert.equal(row.user_id, null);
    assert.equal(row.tg_chat_id, '-100555');
    // uchinchi chaqiruv ham yubormaydi
    S.notifications.notify(critical({ dedupe_key: 'lowliq:t1' }));
    await S.notifications.flushAlerts();
    assert.equal(sent.length, 1);
  });

  test('maqsad rollarda faol foydalanuvchi bo‘lmasa ham alert guruhga bir marta yetadi', async () => {
    sent.length = 0; result = true;
    const n = { roles: ['YOQ_ROL'], type: 'FORECAST_RISK', severity: 'CRITICAL', title: 'Forecast risk', dedupe_key: 'fc-risk:t2' };
    assert.deepEqual(S.notifications.notify(n), []);
    assert.deepEqual(S.notifications.notify(n), []);
    await S.notifications.flushAlerts();
    assert.equal(sent.length, 1);
  });

  test('yuborilmasa — backoff tugagach keyingi notify() qayta urinadi, keyin yana takrorlanmaydi', async () => {
    sent.length = 0; result = false;
    const n = critical({ dedupe_key: 'lowliq:t3' });
    S.notifications.notify(n);
    await S.notifications.flushAlerts();
    let [row] = alertRows('lowliq:t3:alert');
    assert.equal(row.sent_at, null);
    assert.equal(row.attempts, 1);
    assert.ok(row.error);
    result = true;
    S.notifications.notify(n); // backoff hali tugamagan — urinmaydi
    await S.notifications.flushAlerts();
    assert.equal(sent.length, 0);
    app.db.run('UPDATE notifications SET next_try_at=? WHERE id=?', new Date(Date.now() - 1000).toISOString(), row.id);
    S.notifications.notify(n);
    await S.notifications.flushAlerts();
    assert.equal(sent.length, 1);
    [row] = alertRows('lowliq:t3:alert');
    assert.ok(row.sent_at);
    assert.equal(row.error, null);
    S.notifications.notify(n);
    await S.notifications.flushAlerts();
    assert.equal(sent.length, 1);
  });

  test('alertChat xato tashlasa ham notify yiqilmaydi; 5 urinishdan keyin to‘xtaydi', async () => {
    sent.length = 0; result = 'throw';
    const n = critical({ dedupe_key: 'lowliq:t4' });
    for (let i = 0; i < 7; i++) {
      S.notifications.notify(n);
      await S.notifications.flushAlerts();
      app.db.run("UPDATE notifications SET next_try_at=NULL WHERE dedupe_key='lowliq:t4:alert'");
    }
    const [row] = alertRows('lowliq:t4:alert');
    assert.equal(row.attempts, 5);
    assert.equal(row.sent_at, null);
    assert.match(row.error, /tarmoq/);
  });

  test('tranzaksiya rollback bo‘lsa — guruhga xabar ketmaydi', async () => {
    sent.length = 0; result = true;
    assert.throws(() => app.db.tx(() => { S.notifications.notify(critical({ dedupe_key: 'lowliq:t5' })); throw new Error('rollback'); }), /rollback/);
    await S.notifications.flushAlerts();
    assert.equal(sent.length, 0);
    assert.equal(alertRows('lowliq:t5:alert').length, 0);
  });

  test('dedupe_key yo‘q bo‘lsa — avvalgidek har chaqiruvda; CRITICAL bo‘lmasa — guruhga emas', async () => {
    sent.length = 0; result = true;
    S.notifications.notify(critical());
    S.notifications.notify(critical());
    S.notifications.notify(critical({ severity: 'WARNING', dedupe_key: 'warn:t6' }));
    await S.notifications.flushAlerts();
    assert.equal(sent.length, 2);
  });

  test('TELEGRAM_ALERT_CHAT_ID bo‘sh yoki botlar yo‘q — yozuv ham, xabar ham yo‘q', async () => {
    sent.length = 0; result = true;
    config.telegramAlertChat = '';
    S.notifications.notify(critical({ dedupe_key: 'lowliq:t7' }));
    config.telegramAlertChat = '-100555';
    const bots = app.bots;
    app.bots = null;
    S.notifications.notify(critical({ dedupe_key: 'lowliq:t8' }));
    app.bots = bots;
    await S.notifications.flushAlerts();
    assert.equal(sent.length, 0);
    assert.equal(alertRows('lowliq:t7:alert').length + alertRows('lowliq:t8:alert').length, 0);
  });

  test('bot-harness (soxta Telegram): CASH_FLOW agenti 3 marta, likvidlik past → guruhga bitta sendMessage', async () => {
    const H = await createBotHarness();
    const old = config.telegramAlertChat;
    config.telegramAlertChat = '-100777';
    try {
      H.app.settings.set('cash.low_liquidity_threshold', 1e15);
      assert.equal(H.S.reports.treasury().low_liquidity, true);
      for (let i = 0; i < 3; i++) {
        await H.S.ai.runAgent('CASH_FLOW');
        await H.S.notifications.flushAlerts();
        await H.app.bots.flush();
      }
      const toGroup = H.tg.calls.filter((c) => c.method === 'sendMessage' && String(c.params.chat_id) === '-100777');
      assert.equal(toGroup.length, 1, 'avval har yugurishda (30 daqiqada) yangi xabar ketardi');
      assert.match(toGroup[0].params.text, /Likvidlik past/);
      assert.equal(H.db.get("SELECT COUNT(*) n FROM notifications WHERE channel='ALERT' AND type='LOW_LIQUIDITY' AND sent_at IS NOT NULL").n, 1);
    } finally {
      config.telegramAlertChat = old;
      await H.app.bots.stop?.();
    }
  });
});

// ---------------------------------------------------------------- #30
describe('#30 Docker/AI env: compose, .env.example, DEPLOY.md, README, llm-check — config.mjs bilan mos', () => {
  const configSrc = read('src/core/config.mjs');
  const configNames = [...new Set([...configSrc.matchAll(/\b(?:env|intEnv)\('([A-Z0-9_]+)'/g)].map((m) => m[1]))];
  // Deploy uchun muhim: AI zanjiri, vaqt zonasi, botlar (AI_LIVE_IN_TESTS — faqat testlar uchun)
  const deployNames = configNames.filter((k) => /^(GEMINI_|GROQ_|AI_|BOT_|APP_TZ$)/.test(k) && k !== 'AI_LIVE_IN_TESTS');
  const compose = read('docker-compose.yml');
  const composeEnv = [...compose.matchAll(/^\s*-\s*([A-Z0-9_]+)=/gm)].map((m) => m[1]);

  test('config.mjs dan nomlar topildi (himoya: regex sinmasin)', () => {
    for (const k of ['GEMINI_API_KEY', 'GEMINI_FALLBACK_MODELS', 'GROQ_API_KEY', 'GROQ_FALLBACK_MODEL', 'AI_TIMEOUT_MS', 'APP_TZ', 'BOT_SIGNAL_TOKEN']) assert.ok(deployNames.includes(k), k);
  });

  test('docker-compose: env_file .env (required: false) + Gemini/Groq/AI/APP_TZ/BOT o‘zgaruvchilari; ANTHROPIC yo‘q', () => {
    assert.match(compose, /env_file:\s*\n\s*-\s*path:\s*\.env\s*\n\s*required:\s*false/);
    for (const k of deployNames) assert.ok(composeEnv.includes(k), `docker-compose.yml da ${k} yo‘q`);
    assert.doesNotMatch(compose, /ANTHROPIC|AI_MODEL|claude/i);
  });

  test('docker-compose: PORT/HOST/DB_PATH konteyner uchun override (env_file dan ustun) saqlangan', () => {
    assert.match(compose, /^\s*-\s*PORT=8100$/m);
    assert.match(compose, /^\s*-\s*HOST=0\.0\.0\.0$/m);
    assert.match(compose, /^\s*-\s*DB_PATH=\/app\/data\/finance\.db$/m);
    assert.match(compose, /JWT_SECRET=\$\{JWT_SECRET:\?/);
    // Model default'lari compose'da takrorlanmaydi (yagona manba — config.mjs): bo'sh = config default
    for (const k of deployNames.filter((x) => /^(GEMINI_|GROQ_|AI_)/.test(x))) assert.match(compose, new RegExp(`- ${k}=\\$\\{${k}:-\\}$`, 'm'), k);
  });

  test('.env.example: barcha AI/TZ/BOT nomlari bor, maxfiy qiymat yo‘q', () => {
    const ex = read('.env.example');
    const kv = Object.fromEntries([...ex.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)].map((m) => [m[1], m[2].trim()]));
    for (const k of deployNames) assert.ok(k in kv, `.env.example da ${k} yo‘q`);
    for (const [k, v] of Object.entries(kv)) if (/(_API_KEY|_TOKEN|WEBHOOK_SECRET)$/.test(k)) assert.equal(v, '', `${k} bo‘sh bo‘lishi kerak`);
    assert.doesNotMatch(ex, /ANTHROPIC/);
    // Default'lar config bilan bir xil
    const def = (k) => new RegExp(`env\\('${k}', '([^']*)'\\)`).exec(configSrc)?.[1];
    for (const k of ['GEMINI_MODEL', 'GEMINI_FALLBACK_MODELS', 'GROQ_MODEL', 'GROQ_FALLBACK_MODEL', 'APP_TZ']) assert.equal(kv[k], def(k), k);
  });

  test('DEPLOY.md jadvali va README: Gemini → Groq zanjiri, ANTHROPIC/optionalDependencies qoldig‘i yo‘q', () => {
    const deploy = read('docs/DEPLOY.md');
    for (const k of deployNames) assert.ok(deploy.includes('`' + k + '`'), `DEPLOY.md da ${k} yo‘q`);
    assert.match(deploy, /env_file/);
    const readme = read('README.md');
    for (const doc of [deploy, readme]) assert.doesNotMatch(doc, /ANTHROPIC|anthropic-ai|claude-opus|optionalDependencies/i);
    assert.match(readme, /GEMINI_API_KEY/);
    assert.match(readme, /Gemini → Groq/);
  });

  test('llm-check: GEMINI_FALLBACK_MODELS (ko‘plik) o‘qiladi, config kabi ajratiladi; import tarmoq/exit qilmaydi', () => {
    const [g] = providersFromEnv(envReader({ GEMINI_API_KEY: 'k', GEMINI_FALLBACK_MODELS: 'm-a, m-b;m-c' }, {}));
    assert.deepEqual(g.fallbackModels, ['m-a', 'm-b', 'm-c']);
    // .env fayldagi qiymat (process.env bo'sh bo'lsa)
    const [g2] = providersFromEnv(envReader({ GEMINI_FALLBACK_MODELS: '' }, { GEMINI_FALLBACK_MODELS: 'fayl-1,fayl-2' }));
    assert.deepEqual(g2.fallbackModels, ['fayl-1', 'fayl-2']);
    // eski birlik nom — moslik uchun
    const [g3] = providersFromEnv(envReader({ GEMINI_FALLBACK_MODEL: 'eski' }, {}));
    assert.deepEqual(g3.fallbackModels, ['eski']);
    // default'lar config.mjs bilan bir xil
    const [gd, qd] = providersFromEnv(envReader({}, {}));
    const def = (k) => new RegExp(`env\\('${k}', '([^']*)'\\)`).exec(configSrc)?.[1];
    assert.deepEqual(gd.fallbackModels, def('GEMINI_FALLBACK_MODELS').split(/[\s,;]+/).filter(Boolean));
    assert.equal(gd.model, def('GEMINI_MODEL'));
    assert.equal(qd.model, def('GROQ_MODEL'));
    assert.equal(gd.apiKey, '');
  });
});
