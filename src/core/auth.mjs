import crypto from 'node:crypto';
import { config } from './config.mjs';

// ---------- Parol (scrypt) ----------
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}
export function verifyPassword(pw, stored) {
  if (!stored || !stored.startsWith('scrypt:')) return false;
  const [, salt, hash] = stored.split(':');
  const h = crypto.scryptSync(String(pw), salt, 64);
  const s = Buffer.from(hash, 'hex');
  return h.length === s.length && crypto.timingSafeEqual(h, s);
}

// ---------- JWT (HS256) ----------
const b64u = (b) => Buffer.from(b).toString('base64url');
export function signJwt(payload, ttlSec, secret = config.jwtSecret) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...payload, iat: now, exp: now + ttlSec }));
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}
export function verifyJwt(token, secret = config.jwtSecret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, b, s] = parts;
  const expect = crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url');
  const a = Buffer.from(s), e = Buffer.from(expect);
  if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return null;
  try {
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------- TOTP (RFC 6238, 2FA) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of str.replace(/=+$/, '').toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export function totpSecret() {
  return base32Encode(crypto.randomBytes(20));
}
export function totpCode(secret, t = Date.now(), step = 30) {
  const counter = Math.floor(t / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3];
  return String(code % 1000000).padStart(6, '0');
}
export function totpVerify(secret, code, window = 1) {
  const c = String(code || '').replace(/\s/g, '');
  for (let i = -window; i <= window; i++) {
    if (totpCode(secret, Date.now() + i * 30000) === c) return true;
  }
  return false;
}
export function otpauthUrl(secret, email, issuer = 'UTAX Finance') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}

// ---------- Maxfiy ma'lumotlarni shifrlash (AES-256-GCM) ----------
function secretKey() {
  return crypto.createHash('sha256').update(String(config.secretsKey)).digest();
}
export function encryptSecret(plain) {
  if (plain === null || plain === undefined) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `gcm:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}
export function decryptSecret(blob) {
  if (!blob || !String(blob).startsWith('gcm:')) return null;
  const [, iv, tag, data] = String(blob).split(':');
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    // SECRETS_KEY almashgan yoki yozuv buzilgan — server yiqilmaydi, sir shunchaki "yo'q" deb qaraladi
    // (Integratsiyalar sahifasida qayta kiritiladi; .env dagi kalitlar zaxira sifatida ishlaydi)
    console.warn('[secrets] Sirni ochib bo‘lmadi — SECRETS_KEY mos kelmayapti yoki yozuv buzilgan');
    return null;
  }
}
export function maskSecret(s) {
  if (!s) return '';
  const str = String(s);
  return str.length <= 6 ? '••••' : `${str.slice(0, 3)}••••${str.slice(-3)}`;
}
