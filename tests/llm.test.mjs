/** LLM yadrosi (src/core/llm.mjs): Gemini → Groq zanjiri, tool halqasi, byudjet, sovutish, xatolar — soxta fetch bilan, tarmoqsiz. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLlm, LlmError, DEFAULT_RPM } from '../src/core/llm.mjs';

const GKEY = 'AQ.test-gemini-kalit-123456';
const QKEY = 'gsk_test_groq_kalit_987654';

/** Soxta fetch: har provayderga navbatdagi javob (obyekt | {status, json, headers} | funksiya) */
function fake({ gemini = [], groq = [] } = {}) {
  const calls = [];
  const queues = { gemini: [...gemini], groq: [...groq] };
  async function fetchImpl(url, init = {}) {
    const provider = url.includes('generativelanguage') ? 'gemini' : 'groq';
    const body = JSON.parse(init.body);
    calls.push({ provider, url, headers: init.headers, body: structuredClone(body) });
    let r = queues[provider].shift();
    if (r === undefined) throw new Error(`kutilmagan ${provider} so‘rovi`);
    if (typeof r === 'function') r = await r(body, init);
    const status = r.status || 200;
    const json = r.json !== undefined ? r.json : r;
    return new Response(typeof json === 'string' ? json : JSON.stringify(json), { status, headers: r.headers || { 'content-type': 'application/json' } });
  }
  return { fetchImpl, calls, of: (p) => calls.filter((c) => c.provider === p) };
}
const gText = (text) => ({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4 } });
const gCalls = (...calls) => ({ candidates: [{ content: { role: 'model', parts: calls.map(([name, args, sig]) => ({ functionCall: { name, args }, ...(sig ? { thoughtSignature: sig } : {}) })) }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 2 } });
const qText = (text) => ({ choices: [{ message: { role: 'assistant', content: text, reasoning: 'ichki fikrlash…' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5 } });
const qCall = (id, name, args) => ({ choices: [{ message: { role: 'assistant', content: null, reasoning: 'tool kerak', tool_calls: [{ id, type: 'function', function: { name, arguments: args } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 15, completion_tokens: 3 } });
const silent = () => { const lines = []; return { lines, warn: (m) => lines.push(String(m)), info: (m) => lines.push(String(m)), error: (m) => lines.push(String(m)) }; };
const both = (f, extra = {}) => createLlm({ providers: [{ name: 'gemini', apiKey: GKEY, model: 'gemini-3.6-flash', fallbackModels: ['gemini-2.5-flash'], rpm: extra.rpm ?? 12 }, { name: 'groq', apiKey: QKEY, model: 'openai/gpt-oss-120b' }], fetchImpl: f.fetchImpl, log: extra.log || silent(), timeoutMs: extra.timeoutMs || 2000, now: extra.now });
const TOOLS = [
  { name: 'get_treasury', description: 'Pul holati', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'get_pnl', description: 'P&L', parameters: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', additionalProperties: false, properties: { month: { type: 'string', default: '2026-08', description: 'YYYY-MM' }, period: { type: ['string', 'null'] } }, required: ['month', 'yoq'] } },
];

test('Gemini: oddiy javob; kalit URL’da emas, sarlavhada; system va generationConfig yuboriladi', async () => {
  const f = fake({ gemini: [gText('Salom! Men UTAX moliya yordamchisiman.')] });
  const llm = both(f);
  assert.equal(llm.enabled, true);
  assert.deepEqual(llm.providers, ['gemini', 'groq']);
  const r = await llm.chat({ system: 'Sen UTAX yordamchisisan', messages: [{ role: 'user', content: 'salom' }] });
  assert.equal(r.text, 'Salom! Men UTAX moliya yordamchisiman.');
  assert.equal(r.provider, 'gemini');
  assert.equal(r.model, 'gemini-3.6-flash');
  assert.equal(r.steps, 1);
  assert.deepEqual(r.usage, { input: 10, output: 4 });
  const c = f.calls[0];
  assert.match(c.url, /\/v1beta\/models\/gemini-3\.6-flash:generateContent$/);
  assert.ok(!c.url.includes(GKEY));
  assert.equal(c.headers['x-goog-api-key'], GKEY);
  assert.equal(c.body.systemInstruction.parts[0].text, 'Sen UTAX yordamchisisan');
  assert.deepEqual(c.body.generationConfig, { temperature: 0.3, maxOutputTokens: 1500 });
  assert.deepEqual(c.body.contents, [{ role: 'user', parts: [{ text: 'salom' }] }]);
});

test('Gemini: functionCall → runTool → yakuniy javob; model content (thoughtSignature) o‘zgarmay qaytariladi; sxema tozalanadi', async () => {
  const f = fake({ gemini: [gCalls(['get_treasury', {}, 'SIG-abc-123']), gText('Ishlatish mumkin: 393 993 600 so‘m')] });
  const ran = [];
  const r = await both(f).chat({ system: 's', messages: [{ role: 'user', content: 'qancha pul bor?' }], tools: TOOLS, runTool: async (name, args) => { ran.push([name, args]); return { available_cash: 393993600 }; } });
  assert.equal(r.text, 'Ishlatish mumkin: 393 993 600 so‘m');
  assert.equal(r.steps, 2);
  assert.deepEqual(r.toolCalls, [{ name: 'get_treasury', args: {} }]);
  assert.deepEqual(ran, [['get_treasury', {}]]);
  const [first, second] = f.of('gemini');
  const decl = first.body.tools[0].functionDeclarations;
  assert.equal(decl[0].parameters, undefined, 'bo‘sh OBJECT parametrlar yuborilmaydi (Gemini rad etadi)');
  assert.deepEqual(decl[1].parameters, { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM' }, period: { type: 'string', nullable: true } }, required: ['month'] });
  const modelTurn = second.body.contents[1];
  assert.deepEqual(modelTurn, { role: 'model', parts: [{ functionCall: { name: 'get_treasury', args: {} }, thoughtSignature: 'SIG-abc-123' }] });
  assert.deepEqual(second.body.contents[2], { role: 'user', parts: [{ functionResponse: { name: 'get_treasury', response: { result: { available_cash: 393993600 } } } }] });
});

test('Gemini: parallel functionCall — hammasi bajariladi, javoblar bitta user navbatida', async () => {
  const f = fake({ gemini: [gCalls(['get_treasury', {}], ['get_pnl', { month: '2026-08' }]), gText('Ikkala ma’lumot bo‘yicha xulosa.')] });
  const r = await both(f).chat({ messages: [{ role: 'user', content: 'pul va foyda' }], tools: TOOLS, runTool: async (name) => ({ ok: name }) });
  assert.equal(r.toolCalls.length, 2);
  const parts = f.of('gemini')[1].body.contents[2].parts;
  assert.deepEqual(parts.map((p) => p.functionResponse.name), ['get_treasury', 'get_pnl']);
  assert.deepEqual(parts[1].functionResponse.response, { result: { ok: 'get_pnl' } });
});

test('zanjir: Gemini 500 → Groq javob beradi (boshidan boshlanadi)', async () => {
  const f = fake({ gemini: [{ status: 500, json: { error: { message: 'internal' } } }], groq: [qText('Groq javobi')] });
  const r = await both(f).chat({ system: 'sys', messages: [{ role: 'user', content: 'savol' }] });
  assert.equal(r.provider, 'groq');
  assert.equal(r.text, 'Groq javobi');
  assert.equal(r.model, 'openai/gpt-oss-120b');
  const q = f.of('groq')[0];
  assert.equal(q.headers.Authorization, `Bearer ${QKEY}`);
  assert.deepEqual(q.body.messages, [{ role: 'system', content: 'sys' }, { role: 'user', content: 'savol' }]);
});

test('429: darhol Groq; Gemini 60 s sovutiladi (chaqirilmaydi), keyin yana ishlatiladi', async () => {
  let t = 1_000_000;
  const f = fake({ gemini: [{ status: 429, json: { error: { message: 'quota' } } }, gText('Gemini qaytdi')], groq: [qText('g1'), qText('g2')] });
  const llm = both(f, { now: () => t });
  assert.equal((await llm.chat({ messages: [{ role: 'user', content: '1' }] })).provider, 'groq');
  t += 30_000;
  assert.equal((await llm.chat({ messages: [{ role: 'user', content: '2' }] })).provider, 'groq');
  assert.equal(f.of('gemini').length, 1, 'sovutish vaqtida Gemini chaqirilmadi');
  assert.ok(llm.stats().gemini.cooldownUntil);
  t += 31_000;
  const r = await llm.chat({ messages: [{ role: 'user', content: '3' }] });
  assert.equal(r.provider, 'gemini');
  assert.equal(r.text, 'Gemini qaytdi');
});

test('Gemini byudjeti: rpm=2 → 3-chaqiruv Groq; tool qadamlari ham byudjetdan yeydi; oyna o‘tgach tiklanadi', async () => {
  let t = 5_000_000;
  const f = fake({ gemini: [gText('a'), gText('b'), gCalls(['get_treasury', {}]), gText('d')], groq: [qText('c'), qText('e')] });
  const llm = both(f, { rpm: 2, now: () => t });
  assert.equal((await llm.chat({ messages: [{ role: 'user', content: '1' }] })).provider, 'gemini');
  assert.equal((await llm.chat({ messages: [{ role: 'user', content: '2' }] })).provider, 'gemini');
  assert.equal(llm.stats().gemini.budgetLeft, 0);
  assert.equal((await llm.chat({ messages: [{ role: 'user', content: '3' }] })).provider, 'groq');
  t += 61_000;
  // 2 ta slot: tool qadami (1) + yakuniy (1) — to'liq sig'adi
  const r = await llm.chat({ messages: [{ role: 'user', content: '4' }], tools: TOOLS, runTool: async () => ({}) });
  assert.equal(r.provider, 'gemini');
  assert.equal(r.text, 'd');
  // endi byudjet 0 → Groq
  assert.equal((await llm.chat({ messages: [{ role: 'user', content: '5' }] })).provider, 'groq');
});

test('byudjet: tool halqasi o‘rtasida tugasa — Groq boshidan boshlaydi', async () => {
  const f = fake({ gemini: [gCalls(['get_treasury', {}])], groq: [qText('Groq yakunladi')] });
  const r = await both(f, { rpm: 1 }).chat({ messages: [{ role: 'user', content: 'x' }], tools: TOOLS, runTool: async () => ({ a: 1 }) });
  assert.equal(r.provider, 'groq');
  assert.deepEqual(r.toolCalls, []);
});

test('buzuq rpm ("abc", "12.5", -1, 0) — ishga tushish yiqilmaydi, default va ogohlantirish', () => {
  for (const bad of ['abc', '12.5', -1, 0]) {
    const log = silent();
    const llm = createLlm({ providers: [{ name: 'gemini', apiKey: GKEY, rpm: bad }], fetchImpl: async () => { throw new Error('x'); }, log });
    assert.equal(llm.stats().gemini.rpm, DEFAULT_RPM);
    assert.equal(llm.stats().gemini.budgetLeft, DEFAULT_RPM);
    assert.match(log.lines.join('\n'), /noto‘g‘ri rpm/);
  }
  assert.equal(createLlm({ providers: [{ name: 'gemini', apiKey: GKEY }] }).stats().gemini.rpm, DEFAULT_RPM);
});

test('Groq: tool_calls halqasi — tool xabari tool_call_id bilan, reasoning qaytarilmaydi', async () => {
  const f = fake({ groq: [qCall('call_1', 'get_pnl', '{"month":"2026-08"}'), qText('Avgust sof foydasi: 50 mln')] });
  const llm = createLlm({ providers: [{ name: 'groq', apiKey: QKEY }], fetchImpl: f.fetchImpl, log: silent() });
  const got = [];
  const r = await llm.chat({ system: 's', messages: [{ role: 'user', content: 'avgust foyda' }], tools: TOOLS, runTool: async (n, a) => { got.push([n, a]); return { net: 50e6 }; } });
  assert.equal(r.text, 'Avgust sof foydasi: 50 mln');
  assert.deepEqual(got, [['get_pnl', { month: '2026-08' }]]);
  const second = f.calls[1].body;
  assert.equal(f.calls[0].body.tool_choice, 'auto');
  assert.equal(f.calls[0].body.tools[0].type, 'function');
  const assistant = second.messages[2];
  assert.equal(assistant.role, 'assistant');
  assert.equal(assistant.reasoning, undefined);
  assert.equal(assistant.tool_calls[0].id, 'call_1');
  assert.deepEqual(second.messages[3], { role: 'tool', tool_call_id: 'call_1', content: JSON.stringify({ net: 50e6 }) });
});

test('Groq: buzuq arguments → tool bajarilmaydi, modelga xato qaytadi, javob davom etadi', async () => {
  const f = fake({ groq: [qCall('c9', 'get_pnl', '{month: avgust'), qText('Oyni aniqlashtiring')] });
  let ran = false;
  const r = await createLlm({ providers: [{ name: 'groq', apiKey: QKEY }], fetchImpl: f.fetchImpl, log: silent() }).chat({ messages: [{ role: 'user', content: 'x' }], tools: TOOLS, runTool: async () => { ran = true; return {}; } });
  assert.equal(ran, false);
  assert.equal(r.text, 'Oyni aniqlashtiring');
  assert.match(JSON.parse(f.calls[1].body.messages.at(-1).content).error, /JSON/);
});

test('ikkalasi yiqilsa — LlmError (attempts bilan), xato matni javob sifatida qaytmaydi', async () => {
  const f = fake({ gemini: [{ status: 503, json: { error: { message: 'overloaded' } } }], groq: [{ status: 401, json: { error: { message: 'Invalid API Key' } } }] });
  await assert.rejects(both(f).chat({ messages: [{ role: 'user', content: 'x' }] }), (e) => {
    assert.ok(e instanceof LlmError);
    assert.equal(e.code, 'all_failed');
    assert.deepEqual(e.attempts.map((a) => [a.provider, a.code]), [['gemini', 'http'], ['groq', 'auth']]);
    assert.match(e.attempts[0].message, /HTTP 503/);
    return true;
  });
});

test('bo‘sh matn va xato-ko‘rinishli matn ("❌ …") — javob hisoblanmaydi, keyingi provayder', async () => {
  let f = fake({ gemini: [gText('   ')], groq: [qText('To‘g‘ri javob')] });
  assert.equal((await both(f).chat({ messages: [{ role: 'user', content: 'x' }] })).text, 'To‘g‘ri javob');
  f = fake({ gemini: [gText('❌ Xato: Gemini quota exceeded')], groq: [qText('Groq javobi')] });
  assert.equal((await both(f).chat({ messages: [{ role: 'user', content: 'x' }] })).provider, 'groq');
  f = fake({ gemini: [{ candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] }], groq: [qText('ok')] });
  assert.equal((await both(f).chat({ messages: [{ role: 'user', content: 'x' }] })).provider, 'groq');
});

test('timeout: javob kelmasa AbortController bilan uziladi → Groq', async () => {
  const f = fake({
    gemini: [(body, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))],
    groq: [qText('tez javob')],
  });
  const log = silent();
  const r = await both(f, { timeoutMs: 40, log }).chat({ messages: [{ role: 'user', content: 'x' }] });
  assert.equal(r.provider, 'groq');
  assert.match(log.lines.join('\n'), /timeout/);
});

test('model 404 → fallback model; keyingi chaqiruvlar to‘g‘ridan-to‘g‘ri fallback modeldan', async () => {
  const f = fake({ gemini: [{ status: 404, json: { error: { message: 'models/gemini-3.6-flash is not found for API version v1beta' } } }, gText('fallback ishladi'), gText('yana')] });
  const llm = both(f);
  const r = await llm.chat({ messages: [{ role: 'user', content: 'x' }] });
  assert.equal(r.model, 'gemini-2.5-flash');
  assert.equal(r.text, 'fallback ishladi');
  await llm.chat({ messages: [{ role: 'user', content: 'y' }] });
  assert.deepEqual(f.of('gemini').map((c) => c.url.match(/models\/([^:]+)/)[1]), ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-2.5-flash']);
  assert.equal(llm.stats().gemini.model, 'gemini-2.5-flash');
});

test('kalit hech qayerda chiqmaydi: log, LlmError, stats (xato matnida kalit bo‘lsa ham)', async () => {
  const log = silent();
  const f = fake({ gemini: [{ status: 400, json: { error: { message: `API key ${GKEY} not valid` } } }], groq: [{ status: 401, json: { error: { message: `Invalid API Key: ${QKEY}` } } }] });
  const llm = both(f, { log });
  let err;
  try { await llm.chat({ messages: [{ role: 'user', content: 'x' }] }); } catch (e) { err = e; }
  const blob = JSON.stringify({ lines: log.lines, attempts: err.attempts, message: err.message, stats: llm.stats() });
  assert.ok(!blob.includes(GKEY), 'Gemini kaliti chiqdi');
  assert.ok(!blob.includes(QKEY), 'Groq kaliti chiqdi');
  assert.match(blob, /\*\*\*/);
});

test('kalitsiz provayder tashlab yuboriladi; hech biri bo‘lmasa enabled=false va no_providers', async () => {
  const f = fake({ groq: [qText('faqat groq')] });
  const llm = createLlm({ providers: [{ name: 'gemini', apiKey: '' }, { name: 'groq', apiKey: QKEY }, { name: 'nomalum', apiKey: 'x' }], fetchImpl: f.fetchImpl, log: silent() });
  assert.deepEqual(llm.providers, ['groq']);
  assert.equal((await llm.chat({ messages: [{ role: 'user', content: 'x' }] })).text, 'faqat groq');
  const none = createLlm({ providers: [{ name: 'gemini', apiKey: '  ' }] });
  assert.equal(none.enabled, false);
  await assert.rejects(none.chat({ messages: [{ role: 'user', content: 'x' }] }), (e) => e instanceof LlmError && e.code === 'no_providers');
});

test('runTool xato otsa — modelga {error}, noma’lum tool bajarilmaydi, zanjir to‘xtamaydi', async () => {
  const f = fake({ gemini: [gCalls(['get_treasury', {}], ['drop_database', {}]), gText('Ma’lumotni ololmadim, keyinroq urinib ko‘ring.')] });
  const ran = [];
  const r = await both(f).chat({ messages: [{ role: 'user', content: 'x' }], tools: TOOLS, runTool: async (name) => { ran.push(name); throw new Error('Ruxsat yo‘q'); } });
  assert.equal(r.provider, 'gemini');
  assert.deepEqual(ran, ['get_treasury'], 'e’lon qilinmagan tool runTool’ga yetmaydi');
  const parts = f.of('gemini')[1].body.contents[2].parts;
  assert.deepEqual(parts[0].functionResponse.response, { result: { error: 'Ruxsat yo‘q' } });
  assert.match(parts[1].functionResponse.response.result.error, /noma’lum tool/);
});

test('maxSteps: oxirgi qadamda tool o‘chiriladi (Gemini mode NONE, Groq tool_choice none); baribir tool so‘rasa → keyingi provayder', async () => {
  const f = fake({ gemini: [gCalls(['get_treasury', {}]), gCalls(['get_treasury', {}])], groq: [qCall('a', 'get_treasury', '{}'), qText('yakuniy')] });
  const r = await both(f).chat({ messages: [{ role: 'user', content: 'x' }], tools: TOOLS, runTool: async () => ({}), maxSteps: 2 });
  assert.equal(r.provider, 'groq');
  assert.deepEqual(f.of('gemini')[1].body.toolConfig, { functionCallingConfig: { mode: 'NONE' } });
  assert.equal(f.of('groq')[1].body.tool_choice, 'none');
});

test('katta tool natijasi 30 000 belgida kesiladi', async () => {
  const f = fake({ groq: [qCall('b', 'get_treasury', '{}'), qText('ok')] });
  await createLlm({ providers: [{ name: 'groq', apiKey: QKEY }], fetchImpl: f.fetchImpl, log: silent() }).chat({ messages: [{ role: 'user', content: 'x' }], tools: TOOLS, runTool: async () => ({ rows: 'x'.repeat(50_000) }) });
  const content = f.calls[1].body.messages.at(-1).content;
  assert.ok(content.length < 30_100);
  assert.match(content, /…\(qisqartirildi\)$/);
});

test('suhbat tarixi: ketma-ket bir xil rollar birlashadi, boshidagi assistant tashlanadi, bo‘sh xabarlar o‘tkaziladi', async () => {
  const f = fake({ gemini: [gText('ok')], groq: [] });
  await both(f).chat({ messages: [{ role: 'assistant', content: 'oldingi' }, { role: 'user', content: 'a' }, { role: 'user', content: 'b' }, { role: 'assistant', content: '' }, { role: 'assistant', content: 'javob' }, { role: 'user', content: 'c' }] });
  assert.deepEqual(f.calls[0].body.contents, [{ role: 'user', parts: [{ text: 'a' }, { text: 'b' }] }, { role: 'model', parts: [{ text: 'javob' }] }, { role: 'user', parts: [{ text: 'c' }] }]);
});

test('401/403 (kalit yaroqsiz / loyiha bloklangan) → Groq; Gemini 10 daqiqa sovutiladi, keyin qayta sinaladi', async () => {
  let t = 9_000_000;
  const f = fake({ gemini: [{ status: 403, json: { error: { status: 'PERMISSION_DENIED', message: 'Your project has been denied access. Please contact support.' } } }, gText('Gemini tiklandi')], groq: [qText('q1'), qText('q2')] });
  const llm = both(f, { now: () => t });
  assert.equal((await llm.chat({ messages: [{ role: 'user', content: '1' }] })).provider, 'groq');
  t += 5 * 60_000;
  assert.equal((await llm.chat({ messages: [{ role: 'user', content: '2' }] })).provider, 'groq');
  assert.equal(f.of('gemini').length, 1, 'sovutish vaqtida Gemini’ga so‘rov ketmadi');
  assert.match(llm.stats().gemini.lastError, /auth: HTTP 403/);
  t += 6 * 60_000;
  assert.equal((await llm.chat({ messages: [{ role: 'user', content: '3' }] })).provider, 'gemini');
});
