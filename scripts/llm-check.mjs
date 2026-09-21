/**
 * AI provayderlarini tekshirish: npm run llm:check
 * Har provayderga alohida "ping" va sun'iy tool chaqiruvi (kompaniya ma'lumoti YUBORILMAYDI). Kalit ekranga chiqmaydi.
 * .env ni o'zi o'qiydi (src/core/config.mjs ga bog'liq emas).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLlm } from '../src/core/llm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(ROOT, '.env');
const fileEnv = {};
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) fileEnv[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const env = (k, d = '') => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : fileEnv[k] !== undefined && fileEnv[k] !== '' ? fileEnv[k] : d);

const PROVIDERS = [
  { name: 'gemini', label: 'Gemini', apiKey: env('GEMINI_API_KEY'), model: env('GEMINI_MODEL', 'gemini-3.6-flash'), fallbackModels: [env('GEMINI_FALLBACK_MODEL', 'gemini-3.5-flash')], rpm: env('GEMINI_RPM', '') || undefined },
  { name: 'groq', label: 'Groq', apiKey: env('GROQ_API_KEY'), model: env('GROQ_MODEL', 'openai/gpt-oss-120b') },
];
const quiet = { warn() {}, info() {}, error() {} };
const TOOL = { name: 'vaqt_ol', description: 'Sinov: hozirgi soatni qaytaradi', parameters: { type: 'object', properties: { shahar: { type: 'string', description: 'Shahar nomi' } }, required: ['shahar'] } };

let ok = 0;
for (const p of PROVIDERS) {
  const keyInfo = p.apiKey ? `bor (${p.apiKey.length} belgi)` : 'yo‘q';
  console.log(`\n${p.label}: kalit ${keyInfo}, model ${p.model}`);
  if (!p.apiKey) { console.log(`  ❌ ${p.name.toUpperCase()}_API_KEY bo‘sh`); continue; }
  const llm = createLlm({ providers: [p], log: quiet, timeoutMs: 30000 });
  try {
    const t0 = Date.now();
    const r = await llm.chat({ system: 'Faqat bitta so‘z bilan javob ber: pong', messages: [{ role: 'user', content: 'ping' }], maxTokens: 400 });
    console.log(`  ✅ ping — ${r.model}, ${Date.now() - t0} ms, javob: «${r.text.slice(0, 40)}»`);
    const t1 = Date.now();
    const called = [];
    const rt = await llm.chat({
      system: 'Soatni bilish uchun vaqt_ol tool’idan foydalan va natijani bitta jumla bilan ayt.',
      messages: [{ role: 'user', content: 'Toshkentda soat necha?' }], tools: [TOOL], maxTokens: 600,
      runTool: async (name, args) => { called.push(name); return { shahar: args.shahar || 'Toshkent', soat: '12:00' }; },
    });
    console.log(`  ${called.length ? '✅' : '⚠️'} tool — ${called.length ? `${called.join(', ')} chaqirildi` : 'tool chaqirilmadi'}, ${Date.now() - t1} ms, javob: «${rt.text.replace(/\s+/g, ' ').slice(0, 60)}»`);
    ok++;
  } catch (e) {
    const a = e.attempts?.[0];
    console.log(`  ❌ ${a ? `${a.code}: ${a.message}` : e.message}`);
  }
}
console.log(`\nNatija: ${ok}/${PROVIDERS.length} provayder ishlayapti${ok ? '' : ' — AI qoidalar rejimida javob beradi'}.`);
process.exit(ok ? 0 : 1);
