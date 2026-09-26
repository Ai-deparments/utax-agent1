/**
 * SHIFRLANGAN FAYL FORMATI (UTAXVLT1) — repoga qo'yiladigan maxfiy fayllar shu yerda ochiladi/yopiladi.
 * AES-256-GCM (autentifikatsiyali) + gzip. Kalit: DATA_VAULT_KEY (.env da, git'ga tushmaydi).
 *
 * Ikki iste'molchi bor:
 *   - `scripts/data-vault.mjs` — baza va manba Excel fayllari (data/vault/finance.db.enc)
 *   - shu fayldagi `readSealedErpToken` — UTAXERP tokeni (data/vault/erp-token.enc)
 * Kriptografiya bitta joyda tursin uchun ikkalasi ham shu moduldan foydalanadi.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const MAGIC = Buffer.from('UTAXVLT1');

export function encrypt(plain, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(zlib.gzipSync(plain, { level: 9 })), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}

export function decrypt(blob, key) {
  if (!blob.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Seyf fayli emas (sarlavha mos emas)');
  const iv = blob.subarray(8, 20), tag = blob.subarray(20, 36), body = blob.subarray(36);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  try { return zlib.gunzipSync(Buffer.concat([d.update(body), d.final()])); }
  catch { throw new Error('Ochib bo‘lmadi: kalit noto‘g‘ri yoki fayl buzilgan'); }
}

export function parseKey(hex) {
  if (!/^[0-9a-f]{64}$/i.test(String(hex || '').trim())) throw new Error('DATA_VAULT_KEY yo‘q yoki noto‘g‘ri (64 ta hex belgi kerak). .env ga qo‘ying — kalitni loyiha egasidan so‘rang.');
  return Buffer.from(String(hex).trim(), 'hex');
}

export const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
/** Kalitning ochiq "barmoq izi" — qaysi kalit kerakligini maxfiylikni ochmasdan taqqoslash uchun */
export const keyFingerprint = (key) => sha(key).slice(0, 12);

/** JWT'ning ichidagi ochiq ma'lumot (imzo tekshirilmaydi — u ERP tomonida tekshiriladi). Token o'zi qaytarilmaydi. */
export function jwtInfo(token) {
  try {
    const p = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    return { username: p.username || p.sub || null, issued_at: p.iat ? new Date(p.iat * 1000).toISOString() : null, expires_at: p.exp ? new Date(p.exp * 1000).toISOString() : null };
  } catch { return null; }
}

export const ERP_TOKEN_FILE = 'erp-token.enc';
export const ERP_TOKEN_META = 'erp-token.json';

/**
 * data/vault/erp-token.enc dan UTAXERP tokenini ochadi.
 * HECH QACHON xato tashlamaydi: kalit bo'lmasa yoki fayl buzilgan bo'lsa null qaytaradi va server odatdagidek ishga tushadi.
 * @returns {{token: string, username: string|null, expires_at: string|null, expired: boolean}|null}
 */
export function readSealedErpToken(root, { vaultDir, key: rawKey, warn = () => {} } = {}) {
  const dir = vaultDir || path.join(root, 'data', 'vault');
  const file = path.join(dir, ERP_TOKEN_FILE);
  if (!fs.existsSync(file)) return null;
  let key;
  try { key = parseKey(rawKey ?? process.env.DATA_VAULT_KEY); }
  catch { warn('[erp] Seyfdagi token bor, lekin DATA_VAULT_KEY yo‘q — tokenni ochib bo‘lmadi. Kalitni loyiha egasidan so‘rang.'); return null; }
  let token;
  try { token = decrypt(fs.readFileSync(file), key).toString('utf8').trim(); }
  catch (e) { warn(`[erp] Seyfdagi tokenni ochib bo‘lmadi: ${e.message}`); return null; }
  const info = jwtInfo(token);
  if (!info?.expires_at) { warn('[erp] Seyfdagi token JWT formatida emas — e’tiborga olinmadi.'); return null; }
  const expired = new Date(info.expires_at) <= new Date();
  if (expired) warn(`[erp] Seyfdagi token muddati o‘tgan (${info.expires_at.slice(0, 10)}) — yangi token kerak: npm run erp:token:seal <token>`);
  return { token, username: info.username, expires_at: info.expires_at, expired };
}
