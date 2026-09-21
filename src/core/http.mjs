import { URL } from 'node:url';

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

export function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
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
