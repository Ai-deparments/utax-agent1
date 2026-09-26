import { URL } from 'node:url';
import { gzipSync } from 'node:zlib';

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const notFound = (msg = 'Topilmadi') => new HttpError(404, 'NOT_FOUND', msg);
export const badRequest = (msg, details) => new HttpError(400, 'BAD_REQUEST', msg, details);
export const forbidden = (msg = 'Ruxsat yo‘q') => new HttpError(403, 'FORBIDDEN', msg);
export const unauthorized = (msg = 'Avtorizatsiya talab qilinadi') => new HttpError(401, 'UNAUTHORIZED', msg);
export const conflict = (msg) => new HttpError(409, 'CONFLICT', msg);

export function parseUrl(req) {
  const u = new URL(req.url, 'http://localhost');
  const query = {};
  for (const [k, v] of u.searchParams) query[k] = v;
  return { path: u.pathname, query };
}

export async function readBody(req, limit = 25 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'So‘rov hajmi juda katta');
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks);
  const ct = String(req.headers['content-type'] || '');
  if (!raw.length) return {};
  if (ct.includes('application/json')) {
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch {
      throw badRequest('JSON noto‘g‘ri');
    }
  }
  if (ct.includes('text/')) return { text: raw.toString('utf8') };
  return { raw };
}

/**
 * Javobni gzip bilan siqish. Vercel Node funksiyalarining javobini o'zi siqmaydi, shuning uchun
 * katta ro'yxatlar (masalan 353 shartnoma — 345 KB JSON) to'liq holda tarmoqdan o'tardi.
 * `res.gzip` — so'rov boshida qo'yiladi (createHandler), mijoz gzip qabul qilsa true.
 * Kichik javobni siqish foyda bermaydi (CPU + sarlavha), shuning uchun chegara bor.
 */
const GZIP_MIN = 1400;
// Javob obyektiga oddiy xususiyat qo'shib bo'lmaydi (Node'da o'rnatilmaydi), shuning uchun WeakSet
const gzipClients = new WeakSet();
/** So'rov boshida: mijoz gzip qabul qiladimi (createHandler chaqiradi) */
export function setGzip(res, ok) { if (ok) gzipClients.add(res); else gzipClients.delete(res); }
export function sendBuffer(res, status, buf, headers = {}) {
  if (gzipClients.has(res) && buf.length >= GZIP_MIN) {
    const z = gzipSync(buf);
    res.writeHead(status, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': z.length, Vary: 'Accept-Encoding' });
    return res.end(z);
  }
  res.writeHead(status, { ...headers, 'Content-Length': buf.length });
  res.end(buf);
}

export function sendJson(res, status, data, headers = {}) {
  const body = Buffer.from(JSON.stringify(data), 'utf8');
  sendBuffer(res, status, body, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
}

export function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.socket?.remoteAddress || '';
}

/** Oddiy in-memory rate limiter (IP bo'yicha, sliding window) */
export function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  }, windowMs).unref();
  return (key) => {
    const now = Date.now();
    let h = hits.get(key);
    if (!h || now - h.start > windowMs) {
      h = { start: now, n: 0 };
      hits.set(key, h);
    }
    h.n++;
    return h.n <= max;
  };
}

/**
 * Javob keshi — og'ir GET hisobotlari uchun (dashboard, treasury, reports).
 *
 * Nega: Turso'da bitta dashboard ~82 ta tarmoq so'rovi. Bir xil sahifani qayta ochganda
 * hammasini qaytadan so'ramaslik uchun tayyor javob qisqa muddatga saqlanadi.
 *
 * Xavfsizlik qoidalari:
 *  - kalitga foydalanuvchi id'si kiradi — SALES o'z ko'lamidagi ma'lumotni ko'radi, boshqasinikini emas;
 *  - kesh faqat huquq tekshiruvidan KEYIN o'qiladi — ruxsatsiz foydalanuvchi keshga umuman yetmaydi;
 *  - har qanday yozuv (POST/PUT/PATCH/DELETE) keshni butunlay tozalaydi;
 *  - TTL qisqa (standart 30 s), shuning uchun boshqa instansiya yozgan o'zgarish ko'pi bilan shuncha kechikadi.
 */
export function responseCache(ttlMs) {
  const m = new Map();
  return {
    ttlMs,
    enabled: ttlMs > 0,
    key: (path, query, userId) => `${path}?${JSON.stringify(query)}|${userId || 0}`,
    get(k) {
      const e = m.get(k);
      if (!e) return null;
      if (Date.now() > e.exp) { m.delete(k); return null; }
      return e.v;
    },
    set(k, v) {
      if (m.size > 300) m.clear(); // xotira chegarasi (serverless instansiyasi kichik)
      m.set(k, { v, exp: Date.now() + ttlMs });
    },
    clear() { m.clear(); },
    get size() { return m.size; },
  };
}
