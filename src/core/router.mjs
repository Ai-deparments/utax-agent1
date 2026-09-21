import { HttpError } from './http.mjs';

/**
 * Minimal router: r.get('/api/x/:id', {summary, tags, perm:[resource, action], auth:true}, handler)
 * Har bir route OpenAPI'ga avtomatik kiradi.
 */
export class Router {
  constructor() {
    this.routes = [];
  }
  add(method, path, opts, handler) {
    if (typeof opts === 'function') {
      handler = opts;
      opts = {};
    }
    const keys = [];
    const re = new RegExp(
      '^' + path.replace(/\/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$'
    );
    this.routes.push({ method, path, re, keys, opts, handler });
    return this;
  }
  get(p, o, h) { return this.add('GET', p, o, h); }
  post(p, o, h) { return this.add('POST', p, o, h); }
  put(p, o, h) { return this.add('PUT', p, o, h); }
  patch(p, o, h) { return this.add('PATCH', p, o, h); }
  delete(p, o, h) { return this.add('DELETE', p, o, h); }

  match(method, path) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { route: r, params };
    }
    const anyMethod = this.routes.some((r) => r.re.test(path));
    if (anyMethod) throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Metod ruxsat etilmagan');
    return null;
  }
}
