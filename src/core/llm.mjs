/**
 * LLM provayder yadrosi (tashqi paketsiz, global fetch): Gemini asosiy, xato bo'lsa Groq.
 * Retail IT DEPARTMENT saboqlari asosida:
 *  - ishonchli zanjir: provayderlar tartibida, birinchi muvaffaqiyatli javobda to'xtaydi; o'rtada yiqilsa keyingisi BOSHIDAN boshlaydi
 *  - xato HECH QACHON matn sifatida qaytmaydi — faqat throw LlmError (texnik kod chatga chiqmaydi)
 *  - Gemini daqiqalik global byudjeti (kalit bo'yicha kvota) — tugasa Groq'ga o'tadi, ish to'xtamaydi
 *  - 429 → darhol keyingi provayder; Gemini 429 dan keyin 60 s sovutish; 401/403 dan keyin 10 daqiqa sovutish
 *  - kalit hech qachon log/xato/stats'ga tushmaydi
 *
 *   const llm = createLlm({ providers: [{ name: 'gemini', apiKey, model, fallbackModels, rpm }, { name: 'groq', apiKey, model }] });
 *   const res = await llm.chat({ system, messages, tools, runTool, maxSteps, temperature, maxTokens });
 *   // res = { text, provider, model, steps, toolCalls: [{ name, args }], usage: { input, output } }
 */

export class LlmError extends Error {
  constructor(code, { attempts = [] } = {}) {
    super(`LLM: ${code}`);
    this.name = 'LlmError';
    this.code = code;
    this.attempts = attempts;
  }
}

/** Bitta provayderning xatosi — zanjir ichida ushlanadi va keyingi provayderga o'tiladi */
class ProviderError extends Error {
  constructor(code, message, { status = null, retryAfter = null } = {}) {
    super(message || code);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export const DEFAULT_RPM = 12;
const MINUTE = 60_000;
const GEMINI_COOLDOWN_MS = 60_000;
const AUTH_COOLDOWN_MS = 10 * 60_000; // 401/403 (kalit yaroqsiz / loyiha bloklangan) — har xabarda behuda so'rov yubormaslik uchun
const MAX_TOOL_JSON = 30_000;
const DEFAULT_MODELS = { gemini: 'gemini-3.6-flash', groq: 'openai/gpt-oss-120b' };
const BASE_URLS = { gemini: 'https://generativelanguage.googleapis.com', groq: 'https://api.groq.com' };
const BLOCK_REASONS = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'LANGUAGE']);
const MODEL_MISSING = /not[ _]found|is not supported|unknown model|does not exist|model_not_found|decommissioned|no longer (?:available|supported)/i;
// Provayder xatosini "javob" deb yuborib qo'ymaslik uchun (Retail IT'dagi eski bug) — faqat aniq texnik naqshlar
const ERROR_LIKE = /^\s*(?:❌|\{\s*"error"|(?:error|exception|traceback|internal server error|service unavailable)\b)/i;

/** rpm: musbat butun son; buzuq qiymat ishga tushishni yiqitmaydi — default + ogohlantirish */
function parseRpm(value, log) {
  if (value === undefined || value === null || value === '') return DEFAULT_RPM;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    log.warn?.(`[llm] noto‘g‘ri rpm qiymati (${String(value).slice(0, 20)}) — default ${DEFAULT_RPM} ishlatiladi`);
    return DEFAULT_RPM;
  }
  return n;
}

/** Tool natijasi juda katta bo'lsa — kesilgan satr (model uchun yetarli, token limitini buzmaydi) */
function limitResult(result) {
  let json;
  try { json = JSON.stringify(result ?? null); } catch { return { error: 'natijani JSON ga o‘girib bo‘lmadi' }; }
  if (json === undefined) return null;
  if (json.length <= MAX_TOOL_JSON) return result ?? null;
  return `${json.slice(0, MAX_TOOL_JSON)}…(qisqartirildi)`;
}

const GEMINI_SCHEMA_KEYS = new Set(['type', 'format', 'description', 'nullable', 'enum', 'items', 'properties', 'required', 'minItems', 'maxItems', 'minimum', 'maximum', 'anyOf']);
/** JSON Schema → Gemini qabul qiladigan kichik to'plam (additionalProperties, $schema, default, examples... olib tashlanadi) */
export function cleanGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (!GEMINI_SCHEMA_KEYS.has(k)) continue;
    if (k === 'type' && Array.isArray(v)) {
      const t = v.filter((x) => x !== 'null');
      out.type = t[0] || 'string';
      if (v.includes('null')) out.nullable = true;
    } else if (k === 'properties') {
      const props = {};
      for (const [pk, pv] of Object.entries(v || {})) { const c = cleanGeminiSchema(pv); if (c) props[pk] = c; }
      out.properties = props;
    } else if (k === 'items') {
      const c = cleanGeminiSchema(v);
      if (c) out.items = c;
    } else if (k === 'anyOf') {
      const list = (Array.isArray(v) ? v : []).map(cleanGeminiSchema).filter(Boolean);
      if (list.length) out.anyOf = list;
    } else out[k] = v;
  }
  if (String(out.type).toLowerCase() === 'object') {
    if (!out.properties || !Object.keys(out.properties).length) return undefined; // Gemini: OBJECT uchun properties bo'sh bo'lmasligi kerak
    if (Array.isArray(out.required)) {
      out.required = out.required.filter((r) => r in out.properties);
      if (!out.required.length) delete out.required;
    }
  }
  return out;
}

// ---------------- Gemini ----------------
const gemini = {
  init({ system, messages, tools }) {
    const contents = [];
    for (const m of messages || []) {
      const text = String(m?.content ?? '');
      if (!text.trim()) continue;
      const role = m.role === 'assistant' ? 'model' : 'user';
      if (!contents.length && role === 'model') continue; // birinchi navbat user bo'lishi kerak
      const last = contents[contents.length - 1];
      if (last && last.role === role && last.parts.every((p) => typeof p.text === 'string')) last.parts.push({ text });
      else contents.push({ role, parts: [{ text }] });
    }
    const declarations = (tools || []).map((t) => {
      const d = { name: t.name, description: t.description || '' };
      const params = cleanGeminiSchema(t.parameters);
      if (params) d.parameters = params;
      return d;
    });
    return { system, contents, declarations };
  },
  request(p, st, model, { forceText, temperature, maxTokens }) {
    const body = {
      contents: st.contents,
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    };
    if (st.system) body.systemInstruction = { parts: [{ text: st.system }] };
    if (st.declarations.length) {
      body.tools = [{ functionDeclarations: st.declarations }];
      if (forceText) body.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
    }
    return {
      url: `${p.baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.apiKey },
      body,
    };
  },
  parse(j) {
    const cand = j?.candidates?.[0];
    if (!cand) {
      const reason = j?.promptFeedback?.blockReason;
      throw new ProviderError('blocked', reason ? `so‘rov bloklandi: ${reason}` : 'javobda candidates yo‘q');
    }
    if (BLOCK_REASONS.has(cand.finishReason)) throw new ProviderError('blocked', `javob bloklandi: ${cand.finishReason}`);
    const parts = Array.isArray(cand.content?.parts) ? cand.content.parts : [];
    const calls = parts.filter((x) => x?.functionCall?.name).map((x, i) => ({ id: x.functionCall.id || `g${i}`, rawId: x.functionCall.id || null, name: x.functionCall.name, args: x.functionCall.args && typeof x.functionCall.args === 'object' ? x.functionCall.args : {}, bad: false }));
    const text = parts.filter((x) => typeof x?.text === 'string' && !x.thought).map((x) => x.text).join('');
    const usage = { input: Number(j?.usageMetadata?.promptTokenCount) || 0, output: Number(j?.usageMetadata?.candidatesTokenCount) || 0 };
    return { text, calls, raw: cand.content, usage };
  },
  /** Model javobini O'ZGARTIRMASDAN qo'shamiz (Gemini 3.x thoughtSignature qismlarini qaytarishni talab qiladi) */
  appendAssistant(st, raw) {
    st.contents.push(raw && raw.role ? raw : { ...(raw || { parts: [] }), role: 'model' });
  },
  appendResults(st, results) {
    st.contents.push({
      role: 'user',
      parts: results.map((r) => ({ functionResponse: { ...(r.call.rawId ? { id: r.call.rawId } : {}), name: r.call.name, response: { result: r.result } } })),
    });
  },
};

// ---------------- Groq (OpenAI-mos) ----------------
const groq = {
  init({ system, messages, tools }) {
    const msgs = [];
    if (system) msgs.push({ role: 'system', content: system });
    for (const m of messages || []) {
      const text = String(m?.content ?? '');
      if (!text.trim()) continue;
      msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: text });
    }
    const defs = (tools || []).map((t) => ({ type: 'function', function: { name: t.name, description: t.description || '', parameters: t.parameters && typeof t.parameters === 'object' ? t.parameters : { type: 'object', properties: {} } } }));
    return { messages: msgs, defs };
  },
  request(p, st, model, { forceText, temperature, maxTokens }) {
    const body = { model, messages: st.messages, temperature, max_tokens: maxTokens };
    if (st.defs.length) { body.tools = st.defs; body.tool_choice = forceText ? 'none' : 'auto'; }
    return {
      url: `${p.baseUrl}/openai/v1/chat/completions`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
      body,
    };
  },
  parse(j) {
    const msg = j?.choices?.[0]?.message;
    if (!msg) throw new ProviderError('bad_response', 'javobda choices yo‘q');
    const calls = (Array.isArray(msg.tool_calls) ? msg.tool_calls : []).map((tc, i) => {
      let args = {}, bad = false;
      const rawArgs = tc?.function?.arguments;
      if (rawArgs && typeof rawArgs === 'object') args = rawArgs;
      else if (typeof rawArgs === 'string' && rawArgs.trim()) {
        try { const v = JSON.parse(rawArgs); if (v && typeof v === 'object' && !Array.isArray(v)) args = v; else bad = true; } catch { bad = true; }
      }
      return { id: tc?.id || `call_${i}`, name: tc?.function?.name || '', args, bad };
    });
    const text = typeof msg.content === 'string' ? msg.content : ''; // gpt-oss "reasoning" maydoni olinmaydi
    const usage = { input: Number(j?.usage?.prompt_tokens) || 0, output: Number(j?.usage?.completion_tokens) || 0 };
    return { text, calls, raw: { role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls }, usage };
  },
  appendAssistant(st, raw) {
    st.messages.push({ role: 'assistant', content: raw.content ?? null, ...(raw.tool_calls?.length ? { tool_calls: raw.tool_calls } : {}) });
  },
  appendResults(st, results) {
    for (const r of results) st.messages.push({ role: 'tool', tool_call_id: r.call.id, content: typeof r.result === 'string' ? r.result : JSON.stringify(r.result) });
  },
};

const ADAPTERS = { gemini, groq };

/**
 * @param opts.providers  [{ name: 'gemini'|'groq', apiKey, model, fallbackModels?, rpm?, baseUrl? }] — kaliti bo'sh provayder tashlab yuboriladi; tartib = zanjir
 */
export function createLlm({ providers = [], fetchImpl = globalThis.fetch, log = console, timeoutMs = 25000, now = () => Date.now() } = {}) {
  const active = [];
  for (const cfg of providers) {
    const adapter = ADAPTERS[cfg?.name];
    const apiKey = String(cfg?.apiKey || '').trim();
    if (!adapter || !apiKey) continue;
    const models = [cfg.model || DEFAULT_MODELS[cfg.name], ...(cfg.fallbackModels || [])].filter(Boolean);
    const hasBudget = cfg.name === 'gemini' || cfg.rpm !== undefined;
    active.push({
      name: cfg.name, adapter, apiKey, models, modelIndex: 0, baseUrl: String(cfg.baseUrl || BASE_URLS[cfg.name]).replace(/\/+$/, ''),
      rpm: hasBudget ? parseRpm(cfg.rpm, log) : null, hits: [], cooldownUntil: 0,
      calls: 0, failures: 0, lastError: null,
    });
  }
  const keys = active.map((p) => p.apiKey);
  const scrub = (s) => keys.reduce((acc, k) => acc.split(k).join('***'), String(s ?? ''));

  // ---- byudjet (sirpanuvchi 60 s oyna, foydalanuvchiga bog'liq emas) ----
  const prune = (p) => { const edge = now() - MINUTE; while (p.hits.length && p.hits[0] <= edge) p.hits.shift(); };
  const budgetLeft = (p) => { if (p.rpm === null) return null; prune(p); return Math.max(0, p.rpm - p.hits.length); };
  const takeBudget = (p) => { if (p.rpm === null) return true; prune(p); if (p.hits.length >= p.rpm) return false; p.hits.push(now()); return true; };

  async function post(p, { url, headers, body }) {
    if (!takeBudget(p)) throw new ProviderError('budget', 'daqiqalik byudjet tugadi');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res, raw;
    try {
      res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
      raw = await res.text();
    } catch (e) {
      throw new ProviderError(ctrl.signal.aborted ? 'timeout' : 'network', ctrl.signal.aborted ? `javob ${timeoutMs} ms ichida kelmadi` : scrub(e?.message || e).slice(0, 200));
    } finally {
      clearTimeout(timer);
    }
    let j = null;
    try { j = raw ? JSON.parse(raw) : null; } catch { j = null; }
    if (!res.ok) {
      const detail = j?.error?.message || j?.error?.code || (typeof j?.error === 'string' ? j.error : '') || String(raw || '').slice(0, 120);
      const retryAfter = Number(res.headers?.get?.('retry-after')) || null;
      throw new ProviderError(res.status === 429 ? 'rate_limited' : res.status === 401 || res.status === 403 ? 'auth' : 'http', scrub(`HTTP ${res.status}${detail ? ': ' + detail : ''}`).slice(0, 300), { status: res.status, retryAfter });
    }
    if (!j || typeof j !== 'object') throw new ProviderError('bad_json', `JSON emas javob (HTTP ${res.status})`);
    return j;
  }

  /** Bitta so'rov; model topilmasa (404 / "not found") — fallbackModels dagi keyingisi, keyingi chaqiruvlar ham shu modeldan */
  async function requestWithFallback(p, st, opts) {
    for (;;) {
      const model = p.models[p.modelIndex];
      try {
        const j = await post(p, p.adapter.request(p, st, model, opts));
        return { ...p.adapter.parse(j), model };
      } catch (e) {
        const missing = e instanceof ProviderError && (e.status === 404 || (e.status === 400 && MODEL_MISSING.test(e.message)));
        if (missing && p.modelIndex < p.models.length - 1) {
          log.warn?.(`[llm] ${p.name}: ${model} topilmadi — ${p.models[p.modelIndex + 1]} ga o‘tildi`);
          p.modelIndex++;
          continue;
        }
        throw e;
      }
    }
  }

  async function runLoop(p, { system, messages, tools, runTool, maxSteps, temperature, maxTokens }) {
    const st = p.adapter.init({ system, messages, tools });
    const declared = new Set((tools || []).map((t) => t.name));
    const toolCalls = [];
    const usage = { input: 0, output: 0 };
    let model = p.models[p.modelIndex];
    for (let step = 1; step <= maxSteps; step++) {
      const forceText = step === maxSteps;
      const r = await requestWithFallback(p, st, { forceText, temperature, maxTokens });
      model = r.model;
      usage.input += r.usage.input;
      usage.output += r.usage.output;
      if (r.calls.length) {
        if (forceText) throw new ProviderError('max_steps', `${maxSteps} qadamda yakuniy javob bo‘lmadi`);
        p.adapter.appendAssistant(st, r.raw);
        const results = [];
        for (const call of r.calls) {
          toolCalls.push({ name: call.name, args: call.args });
          let result;
          if (call.bad) result = { error: 'tool argumentlari JSON formatida emas — qayta urinib ko‘ring' };
          else if (!declared.has(call.name)) result = { error: `noma’lum tool: ${call.name}` };
          else if (typeof runTool !== 'function') result = { error: 'tool bajaruvchi berilmagan' };
          else {
            try { result = await runTool(call.name, call.args); } catch (e) { result = { error: String(e?.message || e).slice(0, 500) }; }
          }
          results.push({ call, result: limitResult(result === undefined ? null : result) });
        }
        p.adapter.appendResults(st, results);
        continue;
      }
      const text = String(r.text || '').trim();
      if (!text) throw new ProviderError('empty', 'bo‘sh javob');
      if (ERROR_LIKE.test(text)) throw new ProviderError('error_text', 'javob xato matniga o‘xshaydi');
      return { text, provider: p.name, model, steps: step, toolCalls, usage };
    }
    throw new ProviderError('max_steps', `${maxSteps} qadamda yakuniy javob bo‘lmadi`);
  }

  async function chat({ system = '', messages = [], tools = [], runTool, maxSteps = 5, temperature = 0.3, maxTokens = 1500 } = {}) {
    const steps = Math.max(1, Math.min(10, Number(maxSteps) || 5));
    const attempts = [];
    for (const p of active) {
      const model = p.models[p.modelIndex];
      if (p.cooldownUntil > now()) { attempts.push({ provider: p.name, model, code: 'cooldown', message: 'sovutish (429 yoki 401/403 dan keyin)' }); continue; }
      if (p.rpm !== null && budgetLeft(p) === 0) { attempts.push({ provider: p.name, model, code: 'budget', message: 'daqiqalik byudjet tugadi' }); continue; }
      p.calls++;
      try {
        return await runLoop(p, { system, messages, tools, runTool, maxSteps: steps, temperature, maxTokens });
      } catch (e) {
        const code = e instanceof ProviderError ? e.code : 'internal';
        const message = scrub(e?.message || e).slice(0, 300);
        p.failures++;
        p.lastError = `${code}: ${message}`;
        attempts.push({ provider: p.name, model: p.models[p.modelIndex], code, message });
        if (code === 'rate_limited') {
          const wait = p.name === 'gemini' ? Math.max(GEMINI_COOLDOWN_MS, (e.retryAfter || 0) * 1000) : Math.max(5000, (e.retryAfter || 20) * 1000);
          p.cooldownUntil = now() + wait;
        } else if (code === 'auth') p.cooldownUntil = now() + AUTH_COOLDOWN_MS;
        log.warn?.(`[llm] ${p.name} (${p.models[p.modelIndex]}) yiqildi — ${code}: ${message}`);
      }
    }
    throw new LlmError(active.length ? 'all_failed' : 'no_providers', { attempts });
  }

  return {
    get enabled() { return active.length > 0; },
    get providers() { return active.map((p) => p.name); },
    chat,
    /** Web admin uchun holat (kalitsiz) */
    stats() {
      return Object.fromEntries(active.map((p) => [p.name, {
        model: p.models[p.modelIndex], calls: p.calls, failures: p.failures, lastError: p.lastError ? scrub(p.lastError) : null,
        budgetLeft: budgetLeft(p), rpm: p.rpm, cooldownUntil: p.cooldownUntil > now() ? new Date(p.cooldownUntil).toISOString() : null,
      }]));
    },
  };
}
