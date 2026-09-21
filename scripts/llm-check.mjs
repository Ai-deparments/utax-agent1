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

/** .env faylini o'qish (faqat skript to'g'ridan-to'g'ri ishga tushirilganda — import qilinganda emas) */
function readEnvFile(file = path.join(ROOT, '.env')) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
/** process.env ustun, keyin .env, keyin default (bo'sh qiymat = yo'q) */
export function envReader(procEnv = process.env, fileEnv = {}) {
  return (k, d = '') => (procEnv[k] !== undefined && procEnv[k] !== '' ? procEnv[k] : fileEnv[k] !== undefined && fileEnv[k] !== '' ? fileEnv[k] : d);
}
/** Ro'yxat sozlamasi — src/core/config.mjs dagi kabi (vergul / probel / nuqtali vergul) */
const list = (v) => String(v).split(/[\s,;]+/).filter(Boolean);

/** Provayderlar — src/core/config.mjs va src/modules/ai.mjs dagi zanjir bilan bir xil nomlar va default'lar */
export function providersFromEnv(env) {
  // GEMINI_FALLBACK_MODELS (config nomi); eski birlik GEMINI_FALLBACK_MODEL — moslik uchun
  const fallback = env('GEMINI_FALLBACK_MODELS', '') || env('GEMINI_FALLBACK_MODEL', '') || 'gemini-3.5-flash,gemini-flash-latest';
  return [
    { name: 'gemini', label: 'Gemini', apiKey: env('GEMINI_API_KEY'), model: env('GEMINI_MODEL', 'gemini-3.6-flash'), fallbackModels: list(fallback), rpm: env('GEMINI_RPM', '') || undefined },
    { name: 'groq', label: 'Groq', apiKey: env('GROQ_API_KEY'), model: env('GROQ_MODEL', 'openai/gpt-oss-120b') },
  ];
}
const isMain = !!process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) await main();

async function main() {
  const PROVIDERS = providersFromEnv(envReader(process.env, readEnvFile()));
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
}
