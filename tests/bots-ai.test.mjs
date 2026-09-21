/** AI miyasi: persona, RBAC tool'lar, niqoblash, suhbat xotirasi, Gemini→Groq zanjiri, jim fallback, /help /clear, formatlash, web. Tarmoqsiz. */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createBotHarness } from './helpers/bot-harness.mjs';
import { createServer } from '../src/server.mjs';
import { config } from '../src/core/config.mjs';
import { createLlm, LlmError } from '../src/core/llm.mjs';
import { mdToHtml, splitHtml } from '../src/bots/shared/html.mjs';
import { aiChatOptions } from '../src/bots/shared/ai-chat.mjs';
import { fmt, money } from '../src/bots/shared/format.mjs';

let H, S, db, server, base;
const ok = (text = 'Javob tayyor.', extra = {}) => ({ text, provider: 'gemini', model: 'gemini-3.6-flash', steps: 1, toolCalls: [], usage: { input: 1, output: 1 }, ...extra });
/** Soxta LLM: script(req, n) → natija; barcha chaqiruvlar calls da */
function fakeLlm(script = () => ok()) {
  const calls = [];
  return { calls, enabled: true, providers: ['gemini', 'groq'], stats: () => ({}), async chat(req) { calls.push(req); return script(req, calls.length); } };
}
const ctxOf = (email) => ({ user: H.user(email), ip: '127.0.0.1', source: 'TEST' });
const llmText = (req) => [req.system, ...req.messages.map((m) => m.content)].join('\n');
const tags = (html) => { const st = []; for (const m of html.matchAll(/<(\/?)([a-z-]+)[^>]*>/gi)) { if (m[1]) assert.equal(st.pop(), m[2].toLowerCase(), 'teg tartibi'); else st.push(m[2].toLowerCase()); } return st; };

before(async () => {
  H = await createBotHarness();
  S = H.S; db = H.db;
  server = createServer(H.app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { S.ai.useLlm(undefined); await new Promise((r) => server.close(r)); });
beforeEach(() => { S.ai.useLlm(undefined); H.app.settings.set('ai.allow_llm', true); });

// ---------------- persona va tizim prompti ----------------
test('rahbar: erkin matn → llm.chat; system: persona, rol, shu bot buyruqlari, faqat ruxsatli boshqa botlar', async () => {
  const f = fakeLlm(() => ok('**Pul holati** yaxshi.'));
  S.ai.useLlm(f);
  const ceo = H.link('ceo@utax.uz');
  const r = await H.send('rahbar', ceo, 'Pul holati qanday?');
  assert.equal(f.calls.length, 1);
  const sys = f.calls[0].system;
  assert.match(sys, /Bosh moliyaviy maslahatchi \(CFO-strateg\)/);
  assert.match(sys, /Bosh direktor/);
  assert.match(sys, /\/pul/);
  assert.match(sys, /@utax_signal_bot/);
  assert.doesNotMatch(sys, /@utax_buxgalter_bot/, 'CEO buxgalter botiga kira olmaydi — yo‘naltirilmaydi');
  assert.match(sys, /Formulani o‘zing tuzma/);
  assert.match(sys, /Mavzudan tashqari/);
  assert.match(r.text, /<b>Pul holati<\/b> yaxshi\./, 'Markdown → HTML');
});

test('persona: har bot o‘z ekspert roli bilan (buxgalter, sorov, signal) va o‘z tool’lari birinchi', async () => {
  const f = fakeLlm();
  S.ai.useLlm(f);
  const acc = H.link('accountant@utax.uz'), emp = H.link('employee@utax.uz'), sales = H.link('sales@utax.uz');
  await H.send('buxgalter', acc, 'Nima qilishim kerak bugun?');
  await H.send('sorov', emp, 'So‘rovim qayerda?');
  await H.send('signal', sales, 'Nima muhim?');
  assert.match(f.calls[0].system, /Bosh buxgalter va moliya operatsiyalari eksperti/);
  assert.equal(f.calls[0].tools[0].name, 'get_unmatched_transactions');
  assert.match(f.calls[1].system, /Xarajat so‘rovlari va xodim yordamchisi/);
  assert.equal(f.calls[1].tools[0].name, 'get_my_expense_requests');
  assert.match(f.calls[2].system, /Ogohlantirishlar tahlilchisi/);
  assert.equal(f.calls[2].tools[0].name, 'get_my_notifications');
  assert.ok(f.calls.every((c) => c.tools.length <= config.ai.maxTools + 1), 'token tejash: tool soni chegaralangan');
});

// ---------------- RBAC ----------------
test('RBAC: xodimda kompaniya moliyasi tool’lari yo‘q, o‘z tool’lari bor; CFO da get_treasury bor', async () => {
  const f = fakeLlm();
  S.ai.useLlm(f);
  await S.ai.chat('pul', ctxOf('employee@utax.uz'), { channel: 'TELEGRAM:sorov', bot: 'sorov' });
  const empTools = f.calls[0].tools.map((t) => t.name);
  assert.ok(!empTools.includes('get_treasury') && !empTools.includes('get_pnl') && !empTools.includes('get_receivables'));
  assert.ok(empTools.includes('get_my_expense_requests') && empTools.includes('get_my_payroll'));
  await S.ai.chat('pul', ctxOf('cfo@utax.uz'), { channel: 'TELEGRAM:rahbar', bot: 'rahbar' });
  assert.ok(f.calls[1].tools.map((t) => t.name).includes('get_treasury'));
});

test('tool: ruxsatsiz yoki noma’lum tool xato matnisiz rad etiladi (throw emas)', async () => {
  let res;
  S.ai.useLlm(fakeLlm(async (req) => { res = [await req.runTool('get_treasury', {}), await req.runTool('yoq_tool', {})]; return ok(); }));
  await S.ai.chat('pul', ctxOf('employee@utax.uz'), { channel: 'TELEGRAM:sorov', bot: 'sorov' });
  assert.match(res[0].error, /rolida mavjud emas/);
  assert.match(res[1].error, /rolida mavjud emas/);
});

test('tool: get_treasury haqiqiy servis raqamini o‘zbekcha kalitlar va tizim formulasi bilan qaytaradi', async () => {
  let got;
  S.ai.useLlm(fakeLlm(async (req) => { got = await req.runTool('get_treasury', {}); return ok(`Ishlatish mumkin: ${got.ishlatish_mumkin}`); }));
  const t = S.reports.treasury();
  const res = await S.ai.chat('Qancha pul ishlata olamiz?', ctxOf('cfo@utax.uz'), { channel: 'TELEGRAM:rahbar', bot: 'rahbar' });
  assert.equal(got.ishlatish_mumkin, Math.round(t.available_cash));
  assert.equal(got.xavfsiz_olish, Math.round(t.safe_withdrawal));
  assert.match(got.izoh.ishlatish_mumkin, /Available = Total/);
  assert.deepEqual(res.tools, ['get_treasury']);
  assert.equal(res.engine, 'LLM');
});

// ---------------- niqoblash ----------------
test('niqoblash: LLM ga ketgan matn va tool natijalarida mijoz nomi/INN yo‘q; javobda haqiqiy nom qaytadi', async () => {
  const companies = db.all("SELECT id, name, inn FROM companies WHERE length(name) >= 3");
  const top = S.receivables.list()[0];
  const co = db.get('SELECT id, name FROM companies WHERE name=?', top.client);
  let rcv;
  const f = fakeLlm(async (req) => { rcv = await req.runTool('get_receivables', {}); return ok(`Eng katta qarzdor: **MIJOZ_${co.id}**`); });
  S.ai.useLlm(f);
  const cfo = H.link('cfo@utax.uz');
  const r = await H.send('rahbar', cfo, `${co.name} qancha qarzdor? INN 301234567, tel +998 90 123 45 67`);
  const sent = llmText(f.calls[0]) + JSON.stringify(rcv);
  for (const c of companies) {
    assert.ok(!sent.includes(c.name), `mijoz nomi LLM ga ketdi: ${c.name}`);
    if (c.inn) assert.ok(!sent.includes(c.inn), `INN LLM ga ketdi: ${c.inn}`);
  }
  assert.ok(!sent.includes('+998 90 123 45 67') && !sent.includes('301234567'));
  assert.match(sent, /MIJOZ_\d+/);
  assert.ok(!sent.includes(H.user('cfo@utax.uz').name), 'foydalanuvchi ismi ham niqoblangan');
  assert.ok(r.text.includes(co.name), 'javobda haqiqiy nom');
  assert.ok(!r.text.includes(`MIJOZ_${co.id}`));
});

test('niqoblash: tool argumentidagi MIJOZ_n qidiruv uchun haqiqiy nomga ochiladi', async () => {
  const c = S.contracts.list({ active: true })[0];
  const orig = S.contracts.list;
  const seenQ = [];
  S.contracts.list = (f = {}) => { if (f.q !== undefined) seenQ.push(f.q); return orig(f); };
  let rows;
  try {
    S.ai.useLlm(fakeLlm(async (req) => { rows = await req.runTool('get_contracts', { q: `MIJOZ_${c.company_id}` }); return ok(); }));
    await S.ai.chat('shartnomalar', ctxOf('cfo@utax.uz'), { channel: 'TEST:ct', bot: 'buxgalter' });
  } finally { S.contracts.list = orig; }
  assert.deepEqual(seenQ, [c.company_name], 'servisga haqiqiy nom bilan qidirildi');
  assert.ok(Array.isArray(rows) && rows.length > 0, 'natija qator massivi (JSON kesilmagan)');
  assert.ok(rows.filter((x) => x.mijoz).every((x) => x.mijoz === `MIJOZ_${c.company_id}`), 'natijadagi nom ham niqoblangan');
});

// ---------------- xotira ----------------
test('xotira: 2-savolda 1-savol-javob tarixda; boshqa bot kanali aralashmaydi', async () => {
  const f = fakeLlm((req, n) => ok(`javob-${n}`));
  S.ai.useLlm(f);
  const founder = H.link('founder@utax.uz');
  await H.send('rahbar', founder, '/clear');
  await H.send('sorov', founder, '/clear');
  await H.send('rahbar', founder, 'Birinchi savol: pul qancha?');
  await H.send('rahbar', founder, 'u nimaga yetadi?');
  const second = f.calls.at(-1).messages;
  assert.equal(second.length, 3);
  assert.equal(second[0].role, 'user');
  assert.match(second[0].content, /Birinchi savol/);
  assert.equal(second[1].role, 'assistant');
  assert.match(second[1].content, /javob-\d+/);
  await H.send('sorov', founder, 'Sorov kanalida savol');
  assert.equal(f.calls.at(-1).messages.length, 1, 'rahbar tarixi sorov kanaliga o‘tmaydi');
});

test('xotira: memoryTurns chegarasi', async () => {
  const f = fakeLlm();
  S.ai.useLlm(f);
  const old = config.ai.memoryTurns;
  config.ai.memoryTurns = 2;
  try {
    const ctx = ctxOf('head.it@utax.uz');
    S.ai.clearMemory(ctx.user.id, 'TEST:mem');
    for (let i = 1; i <= 4; i++) await S.ai.chat(`savol ${i}`, ctx, { channel: 'TEST:mem', bot: 'web' });
    const last = f.calls.at(-1).messages;
    assert.equal(last.length, 5, '2 juft tarix + joriy savol');
    assert.match(last[0].content, /savol 2/);
  } finally { config.ai.memoryTurns = old; }
});

test('/clear va /tozalash: backend AI xotirasini tozalaydi (keyingi so‘rovda tarix bo‘sh)', async () => {
  const f = fakeLlm();
  S.ai.useLlm(f);
  const cfo = H.link('cfo@utax.uz');
  await H.send('rahbar', cfo, 'birinchi mavzu');
  let r = await H.send('rahbar', cfo, '/clear');
  assert.match(r.text, /AI suhbat tarixi tozalandi/);
  await H.send('rahbar', cfo, 'yangi mavzu');
  assert.equal(f.calls.at(-1).messages.length, 1);
  await H.send('rahbar', cfo, 'yana savol');
  r = await H.send('rahbar', cfo, '/tozalash');
  assert.match(r.text, /AI suhbat tarixi tozalandi/);
  await H.send('rahbar', cfo, 'toza');
  assert.equal(f.calls.at(-1).messages.length, 1);
});

// ---------------- jim fallback ----------------
test('LlmError → jim ravishda qoidalar javobi: raqam bor, texnik xato/provayder nomi yo‘q', async () => {
  S.ai.useLlm(fakeLlm(() => { throw new LlmError('all_failed', { attempts: [{ provider: 'gemini', code: 'auth', message: 'HTTP 403 denied' }, { provider: 'groq', code: 'rate_limited', message: 'HTTP 429' }] }); }));
  const cfo = H.link('cfo@utax.uz');
  const r = await H.send('rahbar', cfo, 'Bugun qancha pulimiz bor?');
  assert.ok(r.text.includes(fmt(S.reports.treasury().available_cash)));
  assert.doesNotMatch(r.text, /error|xato|gemini|groq|403|429|exception/i);
  assert.ok(r.button(/Web’da ochish/));
});

test('LlmError + tushunilmagan matn → persona yordami (xato matnisiz)', async () => {
  S.ai.useLlm(fakeLlm(() => { throw new Error('network down'); }));
  const acc = H.link('accountant@utax.uz');
  const r = await H.send('buxgalter', acc, 'kofe ichsak bo‘ladimi');
  assert.match(r.text, /Bosh buxgalter va moliya operatsiyalari eksperti/);
  assert.doesNotMatch(r.text, /network|error|xato/i);
});

test('LLM bo‘sh javob → qoidalarga o‘tadi', async () => {
  S.ai.useLlm(fakeLlm(() => ok('   ')));
  const r = await S.ai.chat('Kimlardan pul olishimiz kerak?', ctxOf('cfo@utax.uz'), { channel: 'TEST:empty', bot: 'rahbar' });
  assert.equal(r.engine, 'RULES');
  assert.equal(r.intent, 'DEBTORS');
});

test('ai.allow_llm=false → LLM chaqirilmaydi', async () => {
  const f = fakeLlm();
  S.ai.useLlm(f);
  H.app.settings.set('ai.allow_llm', false);
  const r = await S.ai.chat('Bugun qancha pulimiz bor?', ctxOf('cfo@utax.uz'), { channel: 'TEST:off', bot: 'rahbar' });
  assert.equal(f.calls.length, 0);
  assert.equal(r.engine, 'RULES');
});

test('test muhitida haqiqiy LLM hech qachon yaratilmaydi (config.ai.live=false) → qoidalar', async () => {
  S.ai.useLlm(undefined);
  assert.equal(config.ai.live, false);
  assert.equal(await S.ai.getLlm(), null);
  const r = await S.ai.chat('Sof foyda qancha?', ctxOf('cfo@utax.uz'), { channel: 'TEST:live', bot: 'web' });
  assert.equal(r.engine, 'RULES');
  assert.equal(r.intent, 'PROFIT');
});

test('tasdiqlash niyati → LLM emas, qoidalar ✅ tugmasi (apr:ok)', async () => {
  const f = fakeLlm();
  S.ai.useLlm(f);
  const cfo = H.link('cfo@utax.uz');
  const e = S.expenses.request({ amount: 152345678, purpose: 'AI test uskunasi' }, ctxOf('accountant@utax.uz'));
  const r = await H.send('rahbar', cfo, '152345678 so‘mlik so‘rovni tasdiqla');
  assert.equal(f.calls.length, 0);
  assert.equal(r.button(/^✅ Tasdiqlash$/)?.callback_data, `apr:ok:${e.approval_id}`);
});

// ---------------- tugmalar, typing, salom ----------------
test('javob tugmalari: ishlatilgan tool bo‘yicha 🌐 web sahifa va shu botdagi buyruq', async () => {
  S.ai.useLlm(fakeLlm(async (req) => { await req.runTool('get_pnl', {}); return ok('Foyda tahlili.'); }));
  const ceo = H.link('ceo@utax.uz');
  const r = await H.send('rahbar', ceo, 'Foyda qalay?');
  assert.match(r.button(/Web’da ochish/).web_app.url, /tgp=pnl/);
  assert.equal(r.button(/Foyda/)?.callback_data, 'cmd:foyda');
});

test('"yozmoqda" indikatori javob kelguncha takrorlanadi va keyin to‘xtaydi', async () => {
  const old = aiChatOptions.typingEveryMs;
  aiChatOptions.typingEveryMs = 15;
  try {
    S.ai.useLlm(fakeLlm(async () => { await new Promise((r) => setTimeout(r, 90)); return ok('Tayyor'); }));
    const cfo = H.link('cfo@utax.uz');
    const r = await H.send('rahbar', cfo, 'uzoq o‘ylanadigan savol');
    const n = r.method('sendChatAction').length;
    assert.ok(n >= 3, `typing ${n} marta`);
    const before = H.tg.calls.filter((c) => c.method === 'sendChatAction').length;
    await new Promise((res) => setTimeout(res, 60));
    assert.equal(H.tg.calls.filter((c) => c.method === 'sendChatAction').length, before, 'javobdan keyin to‘xtadi');
  } finally { aiChatOptions.typingEveryMs = old; }
});

test('salom: LLM’siz, har bot o‘z roli bilan tanishtiradi va ruxsatga mos misollar beradi', async () => {
  const f = fakeLlm();
  S.ai.useLlm(f);
  const acc = H.link('accountant@utax.uz'), emp = H.link('employee@utax.uz');
  let r = await H.send('buxgalter', acc, 'Salom!');
  assert.match(r.text, /UTAX Buxgalter/);
  assert.match(r.text, /bosh buxgalter yordamchingiz/);
  r = await H.send('sorov', emp, 'nima gap');
  assert.match(r.text, /xarajat so‘rovlari bo‘yicha yordamchingiz/);
  assert.doesNotMatch(r.text, /qo‘ng‘iroq qilishim/, 'undiruv vazifasi misoli xodimga ko‘rsatilmaydi');
  assert.equal(f.calls.length, 0);
  const salomQuestion = await S.ai.chat('Salom, bugun qancha pul bor?', ctxOf('cfo@utax.uz'), { channel: 'TEST:hi', bot: 'rahbar' });
  assert.equal(f.calls.length, 1, 'salom + savol → LLM');
  assert.equal(salomQuestion.engine, 'LLM');
});

// ---------------- menyu va /help ----------------
test('menyu: setMyCommands (ishga tushishda va chat scope) — start, bot buyruqlari, help, clear, bekor', async () => {
  const globalSets = H.tg.calls.filter((c) => c.method === 'setMyCommands' && !c.params.scope);
  assert.equal(new Set(globalSets.map((c) => c.bot)).size, 4, 'har 4 bot');
  for (const c of globalSets) {
    const names = c.params.commands.map((x) => x.command);
    assert.equal(names[0], 'start');
    assert.deepEqual(names.slice(-3), ['help', 'clear', 'bekor']);
    assert.ok(!names.includes('yordam') && !names.includes('tozalash'), 'aliaslar menyuda yo‘q');
  }
  const emp = H.link('head.revision@utax.uz');
  db.run("DELETE FROM bot_state WHERE key LIKE 'cmds:sorov:%'");
  const r = await H.send('sorov', emp, '/start');
  const sc = r.method('setMyCommands').at(-1);
  assert.equal(sc.scope.type, 'chat');
  assert.deepEqual(sc.commands.map((x) => x.command).slice(-3), ['help', 'clear', 'bekor']);
});

test('/help va /yordam: /clear, erkin savol va persona misollari', async () => {
  const cfo = H.link('cfo@utax.uz');
  for (const cmd of ['/help', '/yordam']) {
    const r = await H.send('rahbar', cfo, cmd);
    assert.match(r.text, /\/clear — AI suhbat tarixini tozalash/);
    assert.match(r.text, /Erkin savol/);
    assert.match(r.text, /Bugun xavfsiz qancha pul ishlata olamiz\?/);
  }
});

// ---------------- formatlash ----------------
test('mdToHtml: • ro‘yxat (ichki indent), <pre><code class>, so‘z ichidagi _ va * o‘zgarmaydi, jadval, iqtibos, escape', () => {
  const h = mdToHtml('### Sarlavha\n- bir\n  * ichki _kursiv_ va file_name, 2*3\n+ plus\n1. raqamli\n> iqtibos\n| A | B |\n|---|---|\n| **x** | 1 |\n```js\nif (a < b && c > d) {}\n```\nmatn <script> & "q"');
  assert.match(h, /^<b>Sarlavha<\/b>/);
  assert.match(h, /\n• bir\n {2}• ichki <i>kursiv<\/i> va file_name, 2\*3\n• plus\n1\. raqamli/);
  assert.match(h, /<blockquote>iqtibos<\/blockquote>/);
  assert.match(h, /<pre>A {2}B\nx {2}1<\/pre>/);
  assert.match(h, /<pre><code class="language-js">if \(a &lt; b &amp;&amp; c &gt; d\) \{\}<\/code><\/pre>/);
  assert.match(h, /matn &lt;script&gt; &amp; "q"$/);
  assert.deepEqual(tags(h), []);
});

test('uzun AI javobi (kod bloki bilan) 4096 dan kichik bo‘laklarda, teglar muvozanatli yuboriladi', async () => {
  const long = `# Hisobot\n${'- band **muhim** qator\n'.repeat(150)}\`\`\`\n${'x <y> & z\n'.repeat(500)}\`\`\``;
  S.ai.useLlm(fakeLlm(() => ok(long)));
  const cfo = H.link('cfo@utax.uz');
  const r = await H.send('rahbar', cfo, 'katta hisobot ber');
  const parts = r.method('sendMessage').map((p) => p.text);
  assert.ok(parts.length >= 2, `${parts.length} bo‘lak`);
  for (const p of parts) { assert.ok(p.length <= 4096); assert.deepEqual(tags(p), []); }
  assert.ok(r.method('sendMessage').every((p) => p.parse_mode === 'HTML'));
  const pieces = splitHtml(mdToHtml(long));
  assert.ok(pieces.some((p) => p.startsWith('<pre><code>')), 'kod bloki keyingi bo‘lakda qayta ochiladi');
});

// ---------------- saqlash ----------------
test('ai_conversations: engine/provider/model/tools yoziladi', async () => {
  S.ai.useLlm(fakeLlm(async (req) => { await req.runTool('get_forecast', { days: 30 }); return ok('Prognoz', { provider: 'groq', model: 'openai/gpt-oss-120b' }); }));
  const ctx = ctxOf('cfo@utax.uz');
  await S.ai.chat('prognoz?', ctx, { channel: 'TEST:store', bot: 'rahbar' });
  const row = db.get("SELECT * FROM ai_conversations WHERE channel='TEST:store' ORDER BY id DESC");
  assert.equal(row.engine, 'LLM');
  assert.equal(row.provider, 'groq');
  assert.equal(row.model, 'openai/gpt-oss-120b');
  assert.deepEqual(JSON.parse(row.tools), ['get_forecast']);
});

// ---------------- web ----------------
const login = async (email) => (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Utax2026!' }) })).json()).access_token;
const api = async (token, path, { method = 'GET', body } = {}) => { const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, body: await res.json().catch(() => null) }; };

test('web: /api/ai/chat (WEB kanal, CFO persona), /api/ai/history?channel=WEB, /api/ai/clear', async () => {
  const f = fakeLlm(() => ok('Web javob', { provider: 'groq' }));
  S.ai.useLlm(f);
  const token = await login('cfo@utax.uz');
  await api(token, '/api/ai/clear', { method: 'POST' });
  let r = await api(token, '/api/ai/chat', { method: 'POST', body: { message: 'Holat qanday?' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.engine, 'LLM');
  assert.equal(r.body.provider, 'groq');
  assert.match(f.calls.at(-1).system, /CFO agenti/);
  r = await api(token, '/api/ai/history?channel=WEB');
  assert.equal(r.body.length, 1);
  assert.equal(r.body[0].question, 'Holat qanday?');
  assert.equal((await api(token, '/api/ai/clear', { method: 'POST' })).status, 200);
  assert.equal((await api(token, '/api/ai/history?channel=WEB')).body.length, 0);
  await api(token, '/api/ai/chat', { method: 'POST', body: { message: 'yangi' } });
  assert.equal(f.calls.at(-1).messages.length, 1, 'tozalashdan keyin tarix bo‘sh');
});

// ---------------- integratsiya: haqiqiy createLlm + soxta fetch ----------------
test('integratsiya: createLlm — Gemini 403 → Groq tool chaqiradi → yakuniy javob (haqiqiy raqam bilan)', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push({ url, body });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (url.includes('generativelanguage')) return json({ error: { code: 403, message: 'Your project has been denied access.', status: 'PERMISSION_DENIED' } }, 403);
    const hasToolResult = body.messages.some((m) => m.role === 'tool');
    if (!hasToolResult) return json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_treasury', arguments: '{}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    const tr = JSON.parse(body.messages.find((m) => m.role === 'tool').content);
    return json({ choices: [{ message: { role: 'assistant', content: `Ishlatish mumkin: **${fmt(tr.ishlatish_mumkin)} so‘m**` } }], usage: { prompt_tokens: 20, completion_tokens: 8 } });
  };
  const llm = createLlm({ providers: [{ name: 'gemini', apiKey: 'G-KEY', model: 'gemini-3.6-flash' }, { name: 'groq', apiKey: 'Q-KEY', model: 'openai/gpt-oss-120b' }], fetchImpl, log: { warn() {}, error() {}, info() {} } });
  S.ai.useLlm(llm);
  const cfo = H.link('cfo@utax.uz');
  await H.send('rahbar', cfo, '/clear');
  const r = await H.send('rahbar', cfo, 'Hozir qancha pul ishlata olamiz?');
  assert.ok(r.text.includes(money(S.reports.treasury().available_cash)) || r.text.includes(fmt(S.reports.treasury().available_cash)));
  assert.doesNotMatch(r.text, /403|denied|error/i);
  const groqReqs = seen.filter((x) => x.url.includes('api.groq.com'));
  assert.equal(groqReqs.length, 2);
  assert.equal(groqReqs[0].body.messages[0].role, 'system');
  assert.ok(groqReqs[0].body.tools.some((t) => t.function.name === 'get_treasury'));
  const row = db.get("SELECT provider, tools FROM ai_conversations WHERE channel='TELEGRAM:rahbar' ORDER BY id DESC");
  assert.equal(row.provider, 'groq');
  assert.deepEqual(JSON.parse(row.tools), ['get_treasury']);
});
