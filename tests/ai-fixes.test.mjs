/**
 * AI review tuzatishlari (#4–#11, L2, L3, A, B) — regressiya testlari. Tarmoqsiz: soxta LLM yoki haqiqiy createLlm + soxta fetch.
 *  #4  persona asosiy tool'lari maxTools bilan kesilmaydi; runTool: "bu so'rovga berilmagan" ≠ "rolida mavjud emas"
 *  #5  'tasdiqla' so'zi bor holat savollari LLM'ga ketadi — faqat buyruq shakli APPROVE_REQUEST
 *  #6  provayder almashganda propose_action ikkinchi marta yozilmaydi (llmAnswer darajasidagi kesh)
 *  #7  Gemini sxemasida payload saqlanadi; majburiy maydonsiz taklif rad etiladi
 *  #8  kesilgan javob (MAX_TOKENS / finish_reason=length) → keyingi provayder yoki qoidalar
 *  #9  unmask o'zbekcha qo'shimchali tokenni qaytaradi; mask so'z ichida ishlamaydi
 *  #10 apostrof variantlari, mahalliy telefon, klient bo'lmagan INN niqoblanadi (summalar emas)
 *  #11 qoidalar fallback'ida o'z ma'lumoti intent'lari (MY_EXPENSES / MY_PAYROLL / MY_DEBTORS)
 *  L2  Gemini 400 API_KEY_INVALID → 'auth' (sovutish);  L3  stats(): asosiy va zaxira Groq alohida
 *  A   AI chat taklifini taklif qilgan shaxsning o'zi tasdiqlay olmaydi (web + bot, servis darajasida)
 *  B   HECH NIMA TO'QILMAYDI: prompt qoidasi barcha personalarda; null → "--" (0 emas) — tool natijasi, qoidalar, salom
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createBotHarness } from './helpers/bot-harness.mjs';
import { createServer } from '../src/server.mjs';
import { config } from '../src/core/config.mjs';
import { createLlm, LlmError, cleanGeminiSchema } from '../src/core/llm.mjs';
import { PERSONAS, personaFor, createMasker, compact } from '../src/modules/ai-context.mjs';
import { nowIso, today } from '../src/core/util.mjs';

let H, S, db, server, base;
const ctxOf = (email, source = 'TEST') => ({ user: H.user(email), ip: '127.0.0.1', source });
const ok = (text = 'Javob tayyor.', extra = {}) => ({ text, provider: 'gemini', model: 'gemini-3.6-flash', steps: 1, toolCalls: [], usage: { input: 1, output: 1 }, ...extra });
function fakeLlm(script = () => ok()) {
  const calls = [];
  return { calls, enabled: true, providers: ['gemini', 'groq'], stats: () => ({}), async chat(req) { calls.push(req); return script(req, calls.length); } };
}
const silent = { warn() {}, info() {}, error() {} };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
/** Soxta fetch: provayder bo'yicha navbat (obyekt | {status, json} | funksiya(body)) */
function fakeFetch({ gemini = [], groq = [] } = {}) {
  const calls = [];
  const q = { gemini: [...gemini], groq: [...groq] };
  async function fetchImpl(url, init = {}) {
    const provider = url.includes('generativelanguage') ? 'gemini' : 'groq';
    const body = JSON.parse(init.body);
    calls.push({ provider, url, body });
    let r = q[provider].shift();
    if (r === undefined) throw new Error(`kutilmagan ${provider} so‘rovi`);
    if (typeof r === 'function') r = await r(body);
    return json(r.json !== undefined ? r.json : r, r.status || 200);
  }
  return { fetchImpl, calls, of: (p) => calls.filter((c) => c.provider === p) };
}
const gText = (text, finishReason = 'STOP') => ({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 } });
const gCall = (name, args) => ({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args } }] }, finishReason: 'STOP' }], usageMetadata: {} });
const qText = (text, finish = 'stop') => ({ choices: [{ message: { role: 'assistant', content: text }, finish_reason: finish }], usage: {} });
const qCall = (id, name, args) => ({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }], usage: {} });
const twoProviders = (f, extra = {}) => createLlm({ providers: [{ name: 'gemini', apiKey: 'G-TEST-KEY', model: 'gemini-3.6-flash' }, { name: 'groq', apiKey: 'Q-TEST-KEY', model: 'openai/gpt-oss-120b' }], fetchImpl: f.fetchImpl, log: silent, timeoutMs: 2000, ...extra });
const aiRows = () => db.get('SELECT COUNT(*) n FROM ai_actions').n;
const anyTx = () => db.get('SELECT id FROM bank_transactions WHERE reversed_at IS NULL ORDER BY id LIMIT 1');
const toolNames = (email, bot) => S.ai.toolsFor(ctxOf(email), personaFor(bot)).map((t) => t.name);
const can = (email, perm) => H.app.rbac.can(H.user(email), perm[0], perm[1]);
/** Faqat shu chatga ketgan xabarlar (bir update ichida boshqalarga bildirishnoma ham yetkazilishi mumkin) */
const toChat = (r, tg) => r.messages.filter((m) => String(m.chat_id) === String(tg));
const textTo = (r, tg) => toChat(r, tg).map((m) => m.text).join('\n---\n');
const buttonsTo = (r, tg) => toChat(r, tg).flatMap((m) => (m.reply_markup?.inline_keyboard || []).flat());

before(async () => {
  H = await createBotHarness();
  S = H.S; db = H.db;
  server = createServer(H.app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { S.ai.useLlm(undefined); await new Promise((r) => server.close(r)); });
beforeEach(() => { S.ai.useLlm(undefined); H.app.settings.set('ai.allow_llm', true); });

const tokens = new Map();
async function api(email, path, { method = 'GET', body } = {}) {
  if (!tokens.has(email)) {
    const j = await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Utax2026!' }) })).json();
    tokens.set(email, j.access_token);
  }
  const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${tokens.get(email)}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// ================= #4 maxTools persona asosiy tool'larini kesmaydi =================
test('#4 har persona: RBAC ruxsat bergan persona tool’lari TO‘LIQ (maxTools kesmaydi); maxTools faqat qo‘shimchalarga', () => {
  assert.ok(config.ai.maxTools < PERSONAS.rahbar.tools.length, 'test sharti: persona ro‘yxati maxTools dan uzun');
  const TOOL = new Map(S.ai.TOOLS.map((t) => [t.name, t]));
  const cases = { rahbar: ['founder@utax.uz', 'ceo@utax.uz', 'cfo@utax.uz'], buxgalter: ['accountant@utax.uz', 'finance@utax.uz', 'cfo@utax.uz'], sorov: ['employee@utax.uz', 'sales@utax.uz'], signal: ['sales@utax.uz', 'cfo@utax.uz'], web: ['founder@utax.uz', 'cfo@utax.uz', 'employee@utax.uz'] };
  for (const [bot, emails] of Object.entries(cases)) {
    for (const email of emails) {
      const names = toolNames(email, bot);
      const expected = PERSONAS[bot].tools.filter((n) => TOOL.has(n) && (!TOOL.get(n).perm || can(email, TOOL.get(n).perm)));
      for (const n of expected) assert.ok(names.includes(n), `${bot}/${email}: ${n} yo‘q`);
      assert.deepEqual(names.filter((n) => PERSONAS[bot].tools.includes(n)), expected, `${bot}/${email}: persona tartibi`);
      const extras = names.filter((n) => !PERSONAS[bot].tools.includes(n) && n !== 'propose_action');
      assert.ok(extras.length <= Math.max(0, config.ai.maxTools - expected.length) || (!expected.length && extras.length <= config.ai.maxTools), `${bot}/${email}: qo‘shimchalar chegaralangan`);
    }
  }
  // Review'dagi aniq holatlar
  for (const n of ['get_receivables', 'get_approvals_for_me', 'get_pending_approvals', 'get_revenue', 'get_expenses', 'get_data_quality']) {
    assert.ok(toolNames('founder@utax.uz', 'rahbar').includes(n), `FOUNDER@rahbar: ${n}`);
    assert.ok(toolNames('ceo@utax.uz', 'rahbar').includes(n) || !can('ceo@utax.uz', TOOL.get(n).perm), `CEO@rahbar: ${n}`);
  }
  for (const n of ['get_plan_fact', 'get_unmatched_transactions', 'get_service_profitability', 'get_pending_approvals', 'get_contracts', 'get_balance_sheet']) assert.ok(toolNames('founder@utax.uz', 'web').includes(n), `FOUNDER@web: ${n}`);
  for (const n of ['get_treasury', 'get_cash_flow', 'get_pending_approvals', 'get_pnl']) assert.ok(toolNames('accountant@utax.uz', 'buxgalter').includes(n), `ACCOUNTANT@buxgalter: ${n}`);
});

test('#4 runTool: berilmagan (lekin ruxsatli) tool — "bu so‘rovga berilmagan", RBAC rad — "rolida mavjud emas"; prompt 2-qoidasi faqat haqiqiy yopiq bo‘limlar', async () => {
  let out;
  const f = fakeLlm(async (req) => { out = await req.runTool('get_budgets', {}); return ok(); });
  S.ai.useLlm(f);
  assert.ok(can('cfo@utax.uz', ['planfact', 'VIEW']) && !PERSONAS.rahbar.tools.includes('get_budgets'), 'test sharti');
  await S.ai.chat('byudjet', ctxOf('cfo@utax.uz'), { channel: 'TEST:t4a', bot: 'rahbar' });
  assert.match(out.error, /so‘rovga berilmagan/);
  assert.doesNotMatch(out.error, /rolida mavjud emas/);
  assert.match(f.calls[0].system, /suhbatdosh rolida yopiq bo‘lim yo‘q/, 'CFO: yopiq bo‘lim yo‘q');
  assert.match(f.calls[0].system, /«yopiq» DEMA/);
  // FOUNDER rahbar'da debitorlik so'raydi — tool beriladi va real ma'lumot qaytadi (avval "rolida mavjud emas" edi)
  const f2 = fakeLlm(async (req) => { out = await req.runTool('get_receivables', {}); return ok(); });
  S.ai.useLlm(f2);
  const fo = H.link('founder@utax.uz');
  await H.send('rahbar', fo, 'Kimlardan pul olishimiz kerak?');
  assert.ok(f2.calls[0].tools.some((t) => t.name === 'get_receivables'));
  assert.ok(!out.error && Array.isArray(out.qarzdorlar) && out.qarzdorlar.length > 0, JSON.stringify(out).slice(0, 200));
  // EMPLOYEE — haqiqiy RBAC rad; promptda yopiq bo'limlar sanaladi
  const f3 = fakeLlm(async (req) => { out = await req.runTool('get_treasury', {}); return ok(); });
  S.ai.useLlm(f3);
  await S.ai.chat('pul', ctxOf('employee@utax.uz'), { channel: 'TEST:t4c', bot: 'sorov' });
  assert.match(out.error, /rolida mavjud emas/);
  assert.match(f3.calls[0].system, /YOPIQ bo‘limlar — [^.]*Pul boshqaruvi/);
});

// ================= #5 'tasdiqla' bor savollar LLM'ga =================
test('#5 holat savollari (tasdiqlaydi / tasdiqlanadi / tasdiqlangan / tasdiqlandimi) — LLM’ga ketadi, ⛔ va ✅ tugma yo‘q', async () => {
  const f = fakeLlm(() => ok('Holat tushuntirildi.'));
  S.ai.useLlm(f);
  const emp = H.link('employee@utax.uz');
  for (const q of ['So‘rovimni kim tasdiqlaydi?', 'Reklama so‘rovim qachon tasdiqlanadi?', 'Mening so‘rovim tasdiqlanganmi?']) {
    const n = f.calls.length;
    const r = await H.send('sorov', emp, q);
    assert.equal(f.calls.length, n + 1, `${q}: LLM chaqirildi`);
    assert.doesNotMatch(textTo(r, emp), /⛔/, q);
  }
  const cfo = H.link('cfo@utax.uz');
  const e = S.expenses.request({ amount: 187654321, purpose: 'Server xarajati (#5 test)' }, ctxOf('accountant@utax.uz'));
  assert.ok(S.approvals.getFor(e.approval_id, H.user('cfo@utax.uz')).can_act, 'test sharti: CFO tasdiqlay oladi');
  await H.app.bots.flush(); // so'rov bildirishnomalari (✅ tugmali) AI javobiga aralashmasin
  for (const q of ['Tasdiqlangan xarajatlar qancha?', 'Kecha nechta xarajat tasdiqlandi?', '187 mln xarajat tasdiqlandimi?', '187 mln server xarajati qachon tasdiqlanadi?']) {
    const n = f.calls.length;
    const r = await H.send('rahbar', cfo, q);
    assert.equal(f.calls.length, n + 1, `${q}: LLM chaqirildi`);
    assert.ok(!buttonsTo(r, cfo).some((b) => /^apr:ok:/.test(b.callback_data || '')), `${q}: ✅ tugma yo‘q`);
  }
  // buyruq shakli — avvalgidek qoidalar (LLM'siz) ✅ tugma
  const n = f.calls.length;
  const r = await H.send('rahbar', cfo, '187654321 so‘mlik so‘rovni tasdiqla');
  assert.equal(f.calls.length, n);
  assert.equal(r.button(/^✅ Tasdiqlash$/)?.callback_data, `apr:ok:${e.approval_id}`);
});

test('#5 intent: faqat buyruq shakli APPROVE_REQUEST; LLM’siz holat savoli — rad emas', () => {
  const cfo = ctxOf('cfo@utax.uz');
  for (const q of ['Marketingning so‘rovini tasdiqla', 'Iltimos, tasdiqlang', 'shu so‘rovni tasdiqlab ber', 'approve 12 mln', 'утверди заявку']) assert.equal(S.ai.route(q, cfo).intent, 'APPROVE_REQUEST', q);
  for (const q of ['So‘rovimni kim tasdiqlaydi?', 'qachon tasdiqlanadi', 'tasdiqlangan xarajatlar qancha', 'tasdiqlandimi', 'kim approve qiladi?', 'кто утвердил заявку', 'approved list']) assert.notEqual(S.ai.route(q, cfo).intent, 'APPROVE_REQUEST', q);
  S.ai.useLlm(null);
  const r = S.ai.route('So‘rovimni kim tasdiqlaydi?', ctxOf('employee@utax.uz'));
  assert.ok(!r.denied, r.answer);
  assert.equal(r.intent, 'MY_EXPENSES');
  // "Tasdiqlangan xarajatlar qancha?" (qoidalar) — kutayotganlar ro'yxati emas, xarajatlar jami
  assert.equal(S.ai.route('Tasdiqlangan xarajatlar qancha?', cfo).intent, 'EXPENSES');
});

// ================= #6 provayder almashganda propose_action bir marta =================
test('#6 Gemini propose_action → 429 → Groq xuddi shu propose_action: ai_actions’da BITTA yozuv', async () => {
  const tx = anyTx();
  const args = { action_type: 'FLAG_ANOMALY', entity_type: 'bank_transaction', entity_id: tx.id, title: `Dublikat tx #${tx.id}`, payload: { transaction_id: tx.id, type: 'DUPLICATE' }, confidence: 80 };
  const f = fakeFetch({
    gemini: [gCall('propose_action', args), { status: 429, json: { error: { message: 'quota' } } }],
    groq: [qCall('c1', 'propose_action', { ...args, title: `Tx #${tx.id} dublikat`, entity_id: String(tx.id) }), (body) => { const tr = JSON.parse(body.messages.find((m) => m.role === 'tool').content); return qText(`Taklif #${tr.id} yaratildi.`); }],
  });
  S.ai.useLlm(twoProviders(f));
  const n0 = aiRows();
  const res = await S.ai.chat('Shu tranzaksiyani anomaliya deb belgilashni taklif qil', ctxOf('cfo@utax.uz'), { channel: 'TEST:t6', bot: 'web' });
  assert.equal(res.engine, 'LLM');
  assert.equal(res.provider, 'groq');
  assert.equal(f.of('gemini').length, 2);
  assert.equal(aiRows(), n0 + 1, 'faqat bitta taklif');
  const row = db.get('SELECT * FROM ai_actions ORDER BY id DESC LIMIT 1');
  assert.match(res.answer, new RegExp(`#${row.id} `), 'Groq keshlangan natijani oldi (o‘sha id)');
});

// ================= #7 payload sxemasi va majburiy maydonlar =================
test('#7 Gemini sxemasi: propose_action.payload aniq maydonlar bilan saqlanadi', async () => {
  const cleaned = cleanGeminiSchema(S.ai.TOOLS.find((t) => t.name === 'propose_action').parameters);
  const props = Object.keys(cleaned.properties.payload?.properties || {});
  for (const k of ['transaction_id', 'contract_id', 'expense_id', 'category_id', 'amount', 'date', 'method', 'type']) assert.ok(props.includes(k), `payload.${k}`);
  // Haqiqiy createLlm → Gemini so'rovidagi functionDeclarations
  const f = fakeFetch({ gemini: [gText('ok')] });
  S.ai.useLlm(twoProviders(f));
  await S.ai.chat('taklif', ctxOf('cfo@utax.uz'), { channel: 'TEST:t7', bot: 'web' });
  const decl = f.of('gemini')[0].body.tools[0].functionDeclarations.find((d) => d.name === 'propose_action');
  assert.ok(decl.parameters.properties.payload.properties.transaction_id, 'Gemini’ga payload ketdi');
  assert.match(decl.description, /FLAG_ANOMALY — transaction_id/, 'har tur uchun majburiy maydonlar tavsifda');
});

test('#7 majburiy payload maydoni yo‘q / yozuv yo‘q — taklif rad (tushunarli xato), entity_id dan to‘ldiriladi', () => {
  const cfo = ctxOf('cfo@utax.uz');
  const n0 = aiRows();
  assert.throws(() => S.ai.proposeFromChat({ action_type: 'MATCH_TRANSACTION', title: 'Bog‘lash' }, cfo), (e) => e.status === 400 && /majburiy maydon\(lar\) yo‘q: transaction_id, contract_id/.test(e.message));
  assert.throws(() => S.ai.proposeFromChat({ action_type: 'SET_EXPENSE_CATEGORY', title: 'Kategoriya', payload: { expense_id: 1 } }, cfo), (e) => e.status === 400 && /category_id/.test(e.message));
  assert.throws(() => S.ai.proposeFromChat({ action_type: 'FLAG_ANOMALY', title: 'x', payload: { transaction_id: 99999999 } }, cfo), (e) => e.status === 400 && /topilmadi/.test(e.message));
  assert.throws(() => S.ai.proposeFromChat({ action_type: 'RECOGNIZE_REVENUE', title: 'x', payload: { contract_id: db.get('SELECT id FROM contracts LIMIT 1').id, amount: -5 } }, cfo), (e) => e.status === 400);
  assert.equal(aiRows(), n0, 'rad etilganlar yozilmadi');
  const tx = anyTx();
  const p = S.ai.proposeFromChat({ action_type: 'FLAG_ANOMALY', entity_type: 'bank_transaction', entity_id: tx.id, title: 'Shubhali' }, cfo);
  assert.equal(JSON.parse(db.get('SELECT payload FROM ai_actions WHERE id=?', p.id).payload).transaction_id, tx.id, 'entity_id → payload.transaction_id');
  // Tool orqali (LLM) — xato {error} bo'lib qaytadi, throw emas
  let out;
  S.ai.useLlm(fakeLlm(async (req) => { out = await req.runTool('propose_action', { action_type: 'MATCH_TRANSACTION', title: 'x' }); return ok(); }));
  return S.ai.chat('taklif', cfo, { channel: 'TEST:t7b', bot: 'web' }).then(() => assert.match(out.error, /transaction_id/));
});

test('#7 FLAG_ANOMALY: o‘zgarmagan (yo‘q) tranzaksiya "Bajarildi" deb ko‘rsatilmaydi — FAILED', () => {
  const id = db.insert('ai_actions', { agent_code: 'AUDIT_ANOMALY', action_type: 'FLAG_ANOMALY', entity_type: 'bank_transaction', entity_id: 99999998, title: 'yo‘q tx', payload: JSON.stringify({ transaction_id: 99999998 }), status: 'PROPOSED', proposed_at: nowIso() });
  assert.throws(() => S.ai.decideAction(id, 'APPROVE', ctxOf('cfo@utax.uz')), /topilmadi/);
  assert.equal(S.ai.getAction(id).status, 'FAILED');
});

// ================= #8 kesilgan javob =================
test('#8 Gemini MAX_TOKENS → Groq; Groq finish_reason=length → LlmError; svc.chat → qoidalar (kesilgan matn chiqmaydi)', async () => {
  let f = fakeFetch({ gemini: [gText('Bugun ishlatish mumkin bo‘lgan pul **3', 'MAX_TOKENS')], groq: [qText('To‘liq javob.')] });
  let r = await twoProviders(f).chat({ messages: [{ role: 'user', content: 'x' }] });
  assert.equal(r.provider, 'groq');
  assert.equal(r.text, 'To‘liq javob.');
  f = fakeFetch({ groq: [qText('Debitorlik jami 432 5', 'length')] });
  const onlyGroq = createLlm({ providers: [{ name: 'groq', apiKey: 'Q-TEST-KEY' }], fetchImpl: f.fetchImpl, log: silent });
  await assert.rejects(onlyGroq.chat({ messages: [{ role: 'user', content: 'x' }] }), (e) => e instanceof LlmError && e.attempts[0].code === 'truncated');
  // Chat darajasida: ikkala provayder kesilgan → qoidalar (haqiqiy raqam)
  f = fakeFetch({ gemini: [{ status: 503, json: { error: { message: 'overloaded' } } }], groq: [qText('Debitorlik jami 432 5', 'length')] });
  S.ai.useLlm(twoProviders(f));
  r = await S.ai.chat('Kimlardan pul olishimiz kerak?', ctxOf('cfo@utax.uz'), { channel: 'TEST:t8', bot: 'rahbar' });
  assert.equal(r.engine, 'RULES');
  assert.equal(r.intent, 'DEBTORS');
  assert.doesNotMatch(r.answer, /432 5$/);
  assert.ok(!db.get("SELECT id FROM ai_conversations WHERE channel='TEST:t8' AND answer LIKE '%432 5'"), 'kesilgan javob xotiraga ham yozilmadi');
});

// ================= #9 unmask qo'shimcha bilan =================
test('#9 unmask: MIJOZ_nning / XODIM_ndan / kichik harf → haqiqiy nom; mask qo‘shimchani saqlaydi, so‘z ichida niqoblamaydi', () => {
  const co = db.get("SELECT id, name FROM companies WHERE length(name) >= 5 AND name NOT LIKE '%‘%' ORDER BY id LIMIT 1");
  const u = db.get("SELECT id, name FROM users WHERE email='cfo@utax.uz'");
  const m = createMasker(db, true);
  assert.equal(m.unmask(`MIJOZ_${co.id}ning qarzi`), `${co.name}ning qarzi`);
  assert.equal(m.unmask(`MIJOZ_${co.id}ga eslatma, XODIM_${u.id}dan`), `${co.name}ga eslatma, ${u.name}dan`);
  assert.equal(m.unmask(`mijoz_${co.id} va **MIJOZ_${co.id}**`), `${co.name} va **${co.name}**`);
  assert.equal(m.unmask(`MIJOZ_${co.id}0000`), `MIJOZ_${co.id}0000`, 'MIJOZ_1 ≠ MIJOZ_10000 (raqam davomi token emas)');
  assert.equal(m.mask(`${co.name}ning qarzi qancha?`), `MIJOZ_${co.id}ning qarzi qancha?`);
  assert.equal(m.mask(`${co.name}xyzabc`), `${co.name}xyzabc`, 'so‘z ichida niqoblanmaydi');
  const admin = db.get("SELECT id, name FROM users WHERE name LIKE '% %' ORDER BY id LIMIT 1");
  assert.equal(m.mask(`${admin.name}lik xizmat`), `${admin.name}lik xizmat`, 'nomning davomi (-lik) — boshqa so‘z');
});

test('#9 end-to-end: LLM "MIJOZ_nning" deb yozsa — foydalanuvchi haqiqiy nomni ko‘radi, token yo‘q', async () => {
  const co = db.get("SELECT id, name FROM companies WHERE length(name) >= 5 ORDER BY id LIMIT 1");
  const f = fakeLlm((req) => ok(`${req.messages.at(-1).content} — MIJOZ_${co.id}ning qarzi bor; MIJOZ_${co.id}ga eslatma yuboring.`));
  S.ai.useLlm(f);
  const cfo = H.link('cfo@utax.uz');
  const r = await H.send('rahbar', cfo, `${co.name}ning qarzi qancha?`);
  assert.match(f.calls[0].messages.at(-1).content, new RegExp(`^MIJOZ_${co.id}ning qarzi`), 'LLM’ga niqoblangan');
  assert.ok(r.text.includes(`${co.name}ning qarzi bor`) && r.text.includes(`${co.name}ga eslatma`), r.text);
  assert.doesNotMatch(r.text, /MIJOZ_\d/);
});

// ================= #10 niqoblash to'liqligi =================
test('#10 niqoblash: apostrof variantlari, mahalliy telefon, klient bo‘lmagan INN; summalar o‘zgarmaydi', () => {
  const coId = db.insert('companies', { name: 'Qo‘qon Sinov Metall', kind: 'CLIENT', created_at: nowIso() });
  const acc = db.get('SELECT id FROM bank_accounts ORDER BY id LIMIT 1');
  db.insert('bank_transactions', { bank_account_id: acc.id, tx_date: today(), amount: 1000, direction: 'EXPENSE', counterparty_name: 'Sinov Yetkazuvchi', counterparty_inn: '207654321', matching_status: 'IGNORED', created_at: nowIso() });
  const m = createMasker(db, true);
  for (const v of ["Qo'qon Sinov Metall", 'Qoʻqon Sinov Metall', 'Qo’qon Sinov Metall', 'Qo`qon Sinov Metall', 'qo‘qon  sinov metall']) assert.equal(m.mask(`${v} qancha to‘ladi?`), `MIJOZ_${coId} qancha to‘ladi?`, v);
  assert.equal(m.unmask(`MIJOZ_${coId}ning`), 'Qo‘qon Sinov Metallning');
  for (const ph of ['90 123 45 67', '(90) 123-45-67', '93-123-45-67', '+998 90 123 45 67']) assert.equal(m.mask(`Mijoz telefoni ${ph}.`), 'Mijoz telefoni ***.', ph);
  for (const inn of ['STIR: 207654321', 'INNsi 207 654 321', 'inn 408765432', 'yetkazib beruvchi 207654321 dan']) assert.doesNotMatch(m.mask(inn), /\d{3}\s?\d{3}\s?\d{3}/, inn);
  for (const amount of ['12 500 000 so‘m', '393 993 600', '90 000 000 so‘m', '654500000', 'Summa 1 234 567 890']) assert.equal(m.mask(amount), amount, `summa o‘zgarmasin: ${amount}`);
  assert.match(m.mask('Bugun 21.09.2026'), /21\.09\.2026/);
});

// ================= #11 o'z ma'lumoti intent'lari =================
test('#11 LLM’siz: xodim o‘z so‘rovlari/oyligi/KPI si, sotuvchi o‘z qarzdorlari — rad emas, faqat o‘ziniki', async () => {
  S.ai.useLlm(null);
  const emp = H.user('employee@utax.uz');
  const own = S.expenses.request({ amount: 777000, purpose: 'Kanselyariya (#11)' }, ctxOf('employee@utax.uz'));
  const other = S.expenses.request({ amount: 888000, purpose: 'Boshqaning xarajati (#11)' }, ctxOf('head.it@utax.uz'));
  await H.app.bots.flush();
  const tg = H.link('employee@utax.uz');
  let r = await H.send('sorov', tg, 'Mening xarajat so‘rovlarim qanday holatda?');
  const mine = textTo(r, tg);
  assert.doesNotMatch(mine, /⛔/);
  assert.ok(mine.includes(own.code) && !mine.includes(other.code), mine);
  const x = S.ai.route('Mening xarajat so‘rovlarim qanday holatda?', { user: emp });
  assert.equal(x.intent, 'MY_EXPENSES');
  assert.ok(x.data.rows.every((e) => e.requested_by === emp.id));
  for (const q of ['Bu oy KPI im qancha?', 'Oyligim qancha?', 'Bu oy qo‘limga qancha tegadi?']) {
    const y = S.ai.route(q, { user: emp });
    assert.equal(y.intent, 'MY_PAYROLL', q);
    assert.ok(!y.denied, q);
    r = await H.send('sorov', tg, q);
    assert.doesNotMatch(textTo(r, tg), /⛔/, q);
  }
  const sales = H.user('sales@utax.uz');
  const d = S.ai.route('Mening qarzdorlarim kimlar?', { user: sales });
  assert.equal(d.intent, 'MY_DEBTORS');
  assert.ok(d.data.rows.length && d.data.rows.every((row) => row.manager_user_id === sales.id));
  for (const n of db.all('SELECT contract_number FROM contracts WHERE manager_user_id<>?', sales.id).map((c) => c.contract_number)) assert.ok(!d.answer.includes(`${n}:`), n);
  // Kompaniya savollari o'zgarmagan ("-imiz" — bizning)
  const cfo = { user: H.user('cfo@utax.uz') };
  assert.equal(S.ai.route('Bu oy xarajatlarimiz qancha?', cfo).intent, 'EXPENSES');
  assert.equal(S.ai.route('Shu oy qancha xarajat bo‘ldi?', cfo).intent, 'EXPENSES');
  assert.equal(S.ai.route('Oylik fondi qancha?', cfo).intent, 'PAYROLL');
  assert.equal(S.ai.route('Qaysi xarajatlar tasdiq kutmoqda?', cfo).intent, 'APPROVALS');
});

// ================= L2 / L3 =================
test('L2 Gemini 400 API_KEY_INVALID → auth: 10 daqiqa sovutish, keyingi chatda Gemini’ga so‘rov yo‘q', async () => {
  let t = 1_000_000;
  const bad = { status: 400, json: { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', domain: 'googleapis.com' }] } } };
  const f = fakeFetch({ gemini: [bad], groq: [qText('q1'), qText('q2'), qText('q3')] });
  const llm = twoProviders(f, { now: () => t });
  assert.equal((await llm.chat({ messages: [{ role: 'user', content: '1' }] })).provider, 'groq');
  assert.match(llm.stats().gemini.lastError, /^auth:/);
  assert.ok(llm.stats().gemini.cooldownUntil);
  t += 60_000;
  await llm.chat({ messages: [{ role: 'user', content: '2' }] });
  await llm.chat({ messages: [{ role: 'user', content: '3' }] });
  assert.equal(f.of('gemini').length, 1, 'sovutish vaqtida Gemini chaqirilmadi');
});

test('L3 stats(): asosiy va zaxira Groq alohida (nom:model); bittadan bo‘lsa — nomning o‘zi', async () => {
  const f = fakeFetch({ groq: [{ status: 429, json: { error: { message: 'TPM' } } }, qText('zaxira javob')] });
  const llm = createLlm({ providers: [{ name: 'gemini', apiKey: '' }, { name: 'groq', apiKey: 'Q', model: 'openai/gpt-oss-120b' }, { name: 'groq', apiKey: 'Q', model: 'openai/gpt-oss-20b' }], fetchImpl: f.fetchImpl, log: silent });
  const r = await llm.chat({ messages: [{ role: 'user', content: 'x' }] });
  assert.equal(r.model, 'openai/gpt-oss-20b');
  const st = llm.stats();
  assert.deepEqual(Object.keys(st), ['groq:openai/gpt-oss-120b', 'groq:openai/gpt-oss-20b']);
  assert.ok(st['groq:openai/gpt-oss-120b'].cooldownUntil && /rate_limited/.test(st['groq:openai/gpt-oss-120b'].lastError), 'asosiy modelning sovutishi ko‘rinadi');
  assert.equal(st['groq:openai/gpt-oss-20b'].failures, 0);
  assert.deepEqual(llm.providers, ['groq', 'groq']);
  assert.deepEqual(Object.keys(createLlm({ providers: [{ name: 'gemini', apiKey: 'G' }, { name: 'groq', apiKey: 'Q' }] }).stats()), ['gemini', 'groq']);
});

// ================= A: vazifalar ajratilishi =================
test('A: AI chat taklifini taklif qilgan shaxs o‘zi tasdiqlay olmaydi (servis, web, bot); boshqa vakolatli — bajaradi; agent takliflari avvalgidek', async () => {
  const tx = anyTx();
  const cfo = ctxOf('cfo@utax.uz');
  const p = S.ai.proposeFromChat({ action_type: 'FLAG_ANOMALY', entity_type: 'bank_transaction', entity_id: tx.id, title: 'A test: shubhali' }, cfo);
  assert.throws(() => S.ai.decideAction(p.id, 'APPROVE', cfo), (e) => e.status === 403 && /O‘z taklifingizni o‘zingiz tasdiqlay olmaysiz/.test(e.message));
  const w = await api('cfo@utax.uz', `/api/ai/actions/${p.id}/approve`, { method: 'POST', body: {} });
  assert.equal(w.status, 403, 'web ham xuddi shu qoida');
  const tg = H.link('cfo@utax.uz');
  const b = await H.click('rahbar', tg, `r.act:ok:${p.id}`, { messageId: 77 });
  assert.match(b.answers.map((x) => x.text).join(' '), /O‘z taklifingizni/);
  assert.equal(S.ai.getAction(p.id).status, 'PROPOSED');
  const done = S.ai.decideAction(p.id, 'APPROVE', ctxOf('founder@utax.uz'));
  assert.equal(done.status, 'EXECUTED', 'boshqa vakolatli shaxs bajaradi');
  // o'z taklifini rad etish (qaytarib olish) mumkin
  const p2 = S.ai.proposeFromChat({ action_type: 'FLAG_ANOMALY', entity_type: 'bank_transaction', entity_id: tx.id, title: 'A test: qaytarib olish' }, cfo);
  assert.equal(S.ai.decideAction(p2.id, 'REJECT', cfo).status, 'REJECTED');
  // tizim agenti taklifi (proposed_by yo'q) — CFO tasdiqlaydi
  const ag = S.ai.propose({ agent_code: 'AUDIT_ANOMALY', action_type: 'FLAG_ANOMALY', entity_type: 'bank_transaction', entity_id: tx.id, title: 'agent taklifi', payload: { transaction_id: tx.id } }, S.ai.agentCtx('AUDIT_ANOMALY'));
  assert.equal(S.ai.decideAction(ag.id, 'APPROVE', cfo).status, 'EXECUTED');
});

// ================= B: HECH NIMA TO'QILMAYDI =================
test('B: barcha personalar (rahbar, buxgalter, sorov, signal, web) promptida "hech nima to‘qima" va "--" qoidasi', async () => {
  const f = fakeLlm();
  S.ai.useLlm(f);
  const cases = [['rahbar', 'cfo@utax.uz'], ['buxgalter', 'accountant@utax.uz'], ['sorov', 'employee@utax.uz'], ['signal', 'sales@utax.uz'], ['web', 'cfo@utax.uz']];
  for (const [bot, email] of cases) await S.ai.chat('Holat qanday?', ctxOf(email), { channel: `TEST:B:${bot}`, bot });
  assert.equal(f.calls.length, cases.length);
  for (const [i, c] of f.calls.entries()) {
    const sys = c.system;
    assert.match(sys, /HECH NIMA TO‘QIMA/, cases[i][0]);
    assert.match(sys, /UTAX Excel jurnalidan/, cases[i][0]);
    assert.match(sys, /«--» deb yoz va «Excel’da ko‘rsatilmagan» de/, cases[i][0]);
    assert.match(sys, /0 deb yozma/, cases[i][0]);
    assert.match(sys, /qaysi raqamlardan hisoblaganingni ayt/, cases[i][0]);
    assert.match(sys, /«💡 Maslahat:» deb belgila/, cases[i][0]);
    assert.doesNotMatch(sys, /12 500 000|2026-08/, `${cases[i][0]}: promptda to‘qima namunaviy raqam yo‘q`);
  }
});

test('B: tool natijasida null/undefined/NaN → "--" (0 emas) — qoldiq, avans, sana; kalit tushib qolmaydi', async () => {
  assert.deepEqual(compact({ a: null, b: undefined, c: Number.NaN, d: 0, e: [null, 5], f: { g: undefined } }), { a: '--', b: '--', c: '--', d: 0, e: ['--', 5], f: { g: '--' } });
  const orig = S.reports.treasury;
  const real = orig();
  S.reports.treasury = () => ({ ...real, bank_balance: null, customer_advances: undefined, cash_balance: Number.NaN, as_of: null, reserved: { ...real.reserved, total: null }, accounts: { bank: [{ bank_name: 'Sinov bank', balance: null, currency: 'UZS' }], cash: [] } });
  let got;
  try {
    S.ai.useLlm(fakeLlm(async (req) => { got = await req.runTool('get_treasury', {}); return ok(); }));
    await S.ai.chat('pul', ctxOf('cfo@utax.uz'), { channel: 'TEST:B2', bot: 'rahbar' });
  } finally { S.reports.treasury = orig; }
  assert.equal(got.bank, '--');
  assert.equal(got.mijoz_avanslari, '--', 'undefined ham "--" (kalit bor)');
  assert.equal(got.kassa, '--');
  assert.equal(got.sana, '--');
  assert.equal(got.rezerv.jami, '--');
  assert.equal(got.bank_hisoblari[0].qoldiq, '--');
  assert.equal(got.jami_pul, Math.round(real.total_cash), 'mavjud raqam o‘zgarmaydi');
});

test('B: qoidalar (LLM’siz) javobida null → "--" (0 so‘m emas); salom/yordam matnlarida to‘qima raqam yo‘q', async () => {
  S.ai.useLlm(null);
  const cfo = ctxOf('cfo@utax.uz');
  const origT = S.reports.treasury, origL = S.receivables.list, origS = S.receivables.summary;
  const real = origT();
  S.reports.treasury = () => ({ ...real, bank_balance: null, customer_advances: null });
  S.receivables.list = () => [{ client: 'Sinov mijoz', contract_number: 'UTAX-SINOV-1', debt: 1000, due_date: null, days_overdue: 0 }];
  S.receivables.summary = () => ({ total_receivable: null, count: 1, overdue: null, critical: 0, expected_7d: null, expected_30d: null, top_debtors: [] });
  let cash, debt;
  try {
    cash = S.ai.route('Bugun qancha pulimiz bor?', cfo);
    debt = S.ai.route('Kimlardan pul olishimiz kerak?', cfo);
  } finally { S.reports.treasury = origT; S.receivables.list = origL; S.receivables.summary = origS; }
  assert.match(cash.answer, /Bank: --/);
  assert.match(cash.answer, /avanslari \(cheklangan\): --/);
  assert.doesNotMatch(cash.answer, /Bank: 0 so‘m/);
  assert.match(debt.answer, /Jami debitorlik: -- \(1 shartnoma\)/);
  assert.match(debt.answer, /muddat --/);
  assert.match(debt.answer, /Kritik \(15\+ kun\): 0 so‘m/, 'haqiqiy 0 — 0 bo‘lib qoladi');
  assert.doesNotMatch(debt.answer, /null|undefined|NaN/);
  // salom va yordam — to'qima summa/oy misoli yo'q
  const hi = await S.ai.chat('Salom', cfo, { channel: 'TEST:B3', bot: 'rahbar' });
  const help = S.ai.route('kofe ichsak bo‘ladimi', cfo);
  for (const txt of [hi.answer, help.answer]) {
    assert.doesNotMatch(txt, /\d+\s*mln|\d{1,3}(?: \d{3})+ so‘m|avgust/i, txt);
  }
});
