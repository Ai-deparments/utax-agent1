// PWA: service worker, "Ilovani o'rnatish" va oflayn/onlayn xabarlari.
import { h, icon, toast, modal, alert } from './ui.js';

let deferred = null; // Chrome/Edge/Android: beforeinstallprompt hodisasi
const listeners = new Set();
const notify = () => listeners.forEach((f) => f());

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const inFrame = () => { try { return window.top !== window; } catch { return true; } }; // Telegram Mini App va boshqa iframe
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isMacSafari = () => /Macintosh/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(navigator.userAgent) && navigator.maxTouchPoints <= 1;

/** O'rnatish mumkinmi (tugmani ko'rsatish uchun) */
export const canInstall = () => !isStandalone() && !inFrame() && (!!deferred || isIOS() || isMacSafari());
export const onInstallChange = (f) => { listeners.add(f); return () => listeners.delete(f); };

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; notify(); });
window.addEventListener('appinstalled', () => { deferred = null; notify(); toast('UTAX Finance ilova sifatida o‘rnatildi', 'ok'); });

function manualGuide() {
  const steps = isIOS()
    ? ['Safari’da pastdagi «Ulashish» tugmasini bosing (kvadrat va yuqoriga strelka)', '«Bosh ekranga qo‘shish» (Add to Home Screen) ni tanlang', '«Qo‘shish» ni bosing — UTAX Finance ikonkasi bosh ekranda paydo bo‘ladi']
    : ['Safari menyusida «Fayl» ni oching', '«Dock’ga qo‘shish» (Add to Dock) ni tanlang', '«Qo‘shish» ni bosing — ilova Dock va Launchpad’da paydo bo‘ladi'];
  const m = modal({ title: 'Ilovani o‘rnatish', size: 'sm', body: h('div', {},
    h('ol', { class: 'guide' }, ...steps.map((s) => h('li', {}, s))),
    alert('mint', 'O‘rnatilgan ilova alohida oynada ochiladi va brauzer panelisiz ishlaydi. Ma’lumotlar har doim serverdan olinadi.', 'info')),
    footer: [h('button', { class: 'btn pri', onClick: () => m.close() }, 'Tushunarli')] });
}

/** Foydalanuvchi "Ilovani o'rnatish" ni bosganda */
export async function promptInstall() {
  if (deferred) {
    const ev = deferred;
    deferred = null;
    ev.prompt();
    try { const { outcome } = await ev.userChoice; if (outcome !== 'accepted') toast('O‘rnatish bekor qilindi'); } catch {}
    notify();
    return;
  }
  if (isIOS() || isMacSafari()) return manualGuide();
  toast('Brauzer manzil satridagi «O‘rnatish» belgisidan foydalaning');
}

/** Menyu elementi: o'rnatish mumkin bo'lgandagina ko'rinadi */
export function installMenuItem(onDone) {
  const el = h('button', { onClick: () => { onDone?.(); promptInstall(); } }, icon('download', 16), 'Ilovani o‘rnatish');
  const sync = () => { el.style.display = canInstall() ? '' : 'none'; };
  sync();
  onInstallChange(sync);
  return el;
}

/** Service worker — faqat HTTPS yoki localhost'da, iframe'dan tashqarida */
export function registerSW() {
  if (!('serviceWorker' in navigator) || inFrame()) return;
  if (!(location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) return;
  const reg = () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((e) => console.warn('[pwa] SW:', e.message));
  if (document.readyState === 'complete') reg(); else window.addEventListener('load', reg, { once: true });
}

window.addEventListener('offline', () => toast('Internet aloqasi uzildi — ma’lumotlar yangilanmaydi', 'err'));
window.addEventListener('online', () => toast('Aloqa tiklandi', 'ok'));
