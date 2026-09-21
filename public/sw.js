/* UTAX Finance — service worker (PWA).
 * Qoidalar:
 *  - /api/* va GET bo'lmagan so'rovlar HECH QACHON keshlanmaydi (moliyaviy ma'lumot va sessiya har doim serverdan).
 *  - /v/<build>/... aktivlari o'zgarmas (immutable) → cache-first; yangi build kelganda eskilari o'chiriladi.
 *  - Sahifa (navigate) → network-first; internet yo'q bo'lsa keshdagi ilova qobig'i yoki oflayn sahifa.
 */
const SHELL = 'utax-shell-v1';
const ASSETS = 'utax-assets-v1';
const PRECACHE = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png', '/icons/favicon-32.png'];

const OFFLINE_HTML = `<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#059669"><title>UTAX Finance — oflayn</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6f9;color:#0f1b2d;font:13.5px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Arial,sans-serif}
.box{background:#fff;border:1px solid #e6eaf0;border-radius:12px;box-shadow:0 1px 3px rgba(15,27,45,.05);padding:28px;max-width:360px;text-align:center}
.mk{width:48px;height:48px;border-radius:12px;background:#059669;margin:0 auto 14px;display:grid;place-items:center}
h1{font-size:17px;font-weight:650;margin:0 0 6px}p{color:#6b7a8f;margin:0 0 16px}
button{background:#059669;color:#fff;border:0;border-radius:8px;padding:8px 16px;font:600 13px inherit;cursor:pointer}</style></head>
<body><div class="box"><div class="mk"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></div>
<h1>Internet aloqasi yo‘q</h1><p>UTAX Finance ma’lumotlari serverdan olinadi. Aloqa tiklangach sahifani yangilang.</p>
<button onclick="location.reload()">Qayta urinish</button></div></body></html>`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // hech qachon keshlanmaydi

  // Sahifa: network-first
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) { const c = await caches.open(SHELL); c.put('/', res.clone()); }
        return res;
      } catch {
        return (await caches.match('/')) || new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  // Versiyali aktivlar: cache-first, eski build'lar tozalanadi
  const vm = /^\/v\/([a-z0-9]+)\//.exec(url.pathname);
  if (vm) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) {
        const c = await caches.open(ASSETS);
        await c.put(req, res.clone());
        for (const k of await c.keys()) { const b = /\/v\/([a-z0-9]+)\//.exec(new URL(k.url).pathname)?.[1]; if (b && b !== vm[1]) c.delete(k); }
      }
      return res;
    })());
    return;
  }

  // Ikon va manifest: stale-while-revalidate
  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    e.respondWith((async () => {
      const c = await caches.open(SHELL);
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })());
  }
});
