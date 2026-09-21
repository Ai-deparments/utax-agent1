// API mijoz — Bearer token, avtomatik refresh, xato → toast
const TOK = { get a() { return localStorage.getItem('uf_access'); }, get r() { return localStorage.getItem('uf_refresh'); } };
export function setTokens(t) { if (!t) { localStorage.removeItem('uf_access'); localStorage.removeItem('uf_refresh'); return; } localStorage.setItem('uf_access', t.access_token); localStorage.setItem('uf_refresh', t.refresh_token); }
let refreshing = null;
async function refresh() {
  if (!TOK.r) return false;
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: TOK.r }) }).then(async (r) => { if (!r.ok) { setTokens(null); return false; } setTokens(await r.json()); return true; }).finally(() => (refreshing = null));
  return refreshing;
}
export class ApiError extends Error { constructor(status, body) { super(body?.message || body?.error || `HTTP ${status}`); this.status = status; this.code = body?.error; this.details = body?.details; } }
export async function api(path, { method = 'GET', body, raw = false, retry = true } = {}) {
  const headers = {};
  if (TOK.a) headers.Authorization = 'Bearer ' + TOK.a;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 401 && retry && (await refresh())) return api(path, { method, body, raw, retry: false });
  if (raw) { if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({}))); return res; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
export const get = (p) => api(p);
export const post = (p, body = {}) => api(p, { method: 'POST', body });
export const put = (p, body = {}) => api(p, { method: 'PUT', body });
export const patch = (p, body = {}) => api(p, { method: 'PATCH', body });
export const qs = (o) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(o || {})) if (v !== undefined && v !== null && v !== '') u.set(k, v); const s = u.toString(); return s ? '?' + s : ''; };
export async function downloadXlsx(title, columns, rows) {
  const res = await api('/api/export/xlsx', { method: 'POST', body: { title, columns, rows }, raw: true });
  const blob = await res.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${title}.xlsx`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export const isLoggedIn = () => !!TOK.a || !!TOK.r;
