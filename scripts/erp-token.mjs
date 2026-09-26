#!/usr/bin/env node
/**
 * UTAXERP TOKENI — jamoa bilan SHIFRLANGAN holda ulashish.
 *
 * Muammo: token har oy yangilanadi va faqat bitta odamda bo'ladi. `.env` git'ga tushmaydi,
 * shuning uchun boshqa a'zolar pull qilganda ERP ishlamay qolardi (HTTP 401).
 * Yechim: token `data/vault/erp-token.enc` da AES-256-GCM bilan shifrlanadi va repoga tushadi.
 * A'zoda `DATA_VAULT_KEY` (seyf kaliti, allaqachon kerak) bo'lsa — `git pull` + `npm start` yetarli.
 *
 *   node scripts/erp-token.mjs seal [<token>]   — tokenni seyfga yozadi (tokensiz — .env dagisini oladi)
 *   node scripts/erp-token.mjs show             — kim uchun va qachongacha (tokenning O'ZI chiqmaydi)
 *   node scripts/erp-token.mjs export           — seyfdagi tokenni .env ga yozadi (odatda kerak emas)
 *
 * Qo'shimcha: --vault <papka>, --env <fayl> (testlar uchun).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encrypt, decrypt, parseKey, keyFingerprint, jwtInfo, ERP_TOKEN_FILE, ERP_TOKEN_META } from '../src/core/sealed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const readEnv = (envFile) => (fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '');
const envValue = (envFile, name) => new RegExp(`^${name}=(.*)$`, 'm').exec(readEnv(envFile))?.[1]?.trim().replace(/^["']|["']$/g, '') || '';

function writeEnvValue(envFile, name, value) {
  const cur = readEnv(envFile);
  const next = new RegExp(`^${name}=.*$`, 'm').test(cur) ? cur.replace(new RegExp(`^${name}=.*$`, 'm'), `${name}=${value}`) : `${cur.replace(/\s*$/, '')}\n${name}=${value}\n`;
  fs.writeFileSync(envFile, next);
}

/** Token yaroqlimi: JWT bo'lsin va muddati o'tmagan bo'lsin (noto'g'ri token repoga tushmasin) */
function checkToken(token) {
  const t = String(token || '').trim();
  if (!t) throw new Error('Token bo‘sh. Foydalanish: node scripts/erp-token.mjs seal <token>');
  const info = jwtInfo(t);
  if (!info?.expires_at) throw new Error(`Token JWT formatida emas (payload ochilmadi). Nusxa olishda kesilib qolgan bo‘lishi mumkin — uzunligi ${t.length} belgi, 3 qism bo‘lishi kerak.`);
  if (new Date(info.expires_at) <= new Date()) throw new Error(`Token muddati allaqachon o‘tgan (${info.expires_at.slice(0, 10)}) — yangisini oling.`);
  return { token: t, ...info };
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const envFile = path.resolve(ROOT, opt('--env', '.env'));
  const vault = path.resolve(ROOT, opt('--vault', 'data/vault'));
  const encPath = path.join(vault, ERP_TOKEN_FILE);
  const metaPath = path.join(vault, ERP_TOKEN_META);
  const key = parseKey(process.env.DATA_VAULT_KEY || envValue(envFile, 'DATA_VAULT_KEY'));

  if (cmd === 'seal') {
    const given = args[1] && !args[1].startsWith('--') ? args[1] : '';
    const info = checkToken(given || envValue(envFile, 'ERP_TOKEN'));
    fs.mkdirSync(vault, { recursive: true });
    fs.writeFileSync(encPath, encrypt(Buffer.from(info.token, 'utf8'), key));
    // Ochiq yon-fayl: kalitsiz ham tokenning qachon tugashini ko'rish uchun (tokenning o'zi yo'q)
    fs.writeFileSync(metaPath, JSON.stringify({ file: ERP_TOKEN_FILE, format: 'UTAXVLT1 (AES-256-GCM + gzip)', key_fingerprint: keyFingerprint(key), expires_at: info.expires_at, sealed_at: new Date().toISOString() }, null, 2) + '\n');
    if (given) writeEnvValue(envFile, 'ERP_TOKEN', info.token);
    console.log(`Token seyfga yozildi: ${path.relative(ROOT, encPath)} (${info.expires_at.slice(0, 10)} gacha)`);
    console.log('Endi git\'ga qo‘ying: git add data/vault/erp-token.enc data/vault/erp-token.json');
    return;
  }

  if (cmd === 'show') {
    if (!fs.existsSync(encPath)) { console.log('Seyfda token yo‘q. Qo‘shish: node scripts/erp-token.mjs seal <token>'); return; }
    const info = jwtInfo(decrypt(fs.readFileSync(encPath), key).toString('utf8').trim());
    const left = Math.round((new Date(info.expires_at) - Date.now()) / 86400000);
    console.log(`Foydalanuvchi : ${info.username || '—'}`);
    console.log(`Berilgan      : ${info.issued_at || '—'}`);
    console.log(`Amal qiladi   : ${info.expires_at} (${left > 0 ? `${left} kun qoldi` : 'MUDDATI O‘TGAN'})`);
    console.log(`Kalit izi     : ${keyFingerprint(key)}`);
    return;
  }

  if (cmd === 'export') {
    const info = checkToken(decrypt(fs.readFileSync(encPath), key).toString('utf8').trim());
    writeEnvValue(envFile, 'ERP_TOKEN', info.token);
    console.log(`.env dagi ERP_TOKEN seyfdagi token bilan yangilandi (${info.expires_at.slice(0, 10)} gacha).`);
    return;
  }

  console.log('Foydalanish: node scripts/erp-token.mjs seal [<token>] | show | export');
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}
