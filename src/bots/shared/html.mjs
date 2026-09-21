/**
 * Telegram HTML (parse_mode: 'HTML') yordamchilari.
 * Qoida: dinamik ma'lumot (mijoz nomi, maqsad, izoh) HAR DOIM esc() orqali o'tadi; teglar faqat shu fayldagi helperlar bilan.
 * Telegram ruxsat bergan teglar: b, i, u, s, code, pre, a, blockquote, tg-spoiler.
 */
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escAttr = (s) => esc(s).replace(/"/g, '&quot;');
export const b = (s) => `<b>${esc(s)}</b>`;
export const i = (s) => `<i>${esc(s)}</i>`;
export const code = (s) => `<code>${esc(s)}</code>`;
export const pre = (s) => `<pre>${esc(s)}</pre>`;
export const link = (url, label) => (/^https?:\/\//i.test(String(url || '')) ? `<a href="${escAttr(url)}">${esc(label ?? url)}</a>` : esc(label ?? ''));
export const quote = (html) => `<blockquote>${html}</blockquote>`;

/** HTML teglarni olib tashlab oddiy matnga (parse xatosi bo'lsa fallback) */
export function stripTags(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

/**
 * Markdown-lite (AI javoblari, ai.mjs "**qalin**") → Telegram HTML.
 * Qo'llab-quvvatlanadi: **qalin**, __qalin__, *kursiv*, _kursiv_, `kod`, ```blok```, # sarlavha, "- " / "* " ro'yxat, [matn](https://...)
 */
export function mdToHtml(md) {
  const src = String(md ?? '').replace(/\r\n/g, '\n');
  const out = [];
  const parts = src.split(/```/);
  parts.forEach((part, idx) => {
    if (idx % 2 === 1) { out.push(`<pre>${esc(part.replace(/^[a-z0-9_-]*\n/i, '').replace(/\n$/, ''))}</pre>`); return; }
    const lines = part.split('\n').map((line) => {
      let l = line;
      const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(l);
      if (h) return `<b>${inline(h[1])}</b>`;
      const li = /^(\s*)[-*•]\s+(.*)$/.exec(l);
      if (li) return `${li[1]}• ${inline(li[2])}`;
      if (/^\s*([-*_])\1{2,}\s*$/.test(l)) return '──────────';
      return inline(l);
    });
    out.push(lines.join('\n'));
  });
  return out.join('');
}

function inline(text) {
  // kod bo'laklarini ajratib olamiz — ularning ichida formatlash yo'q
  const segs = String(text).split(/(`[^`\n]+`)/);
  return segs.map((s) => {
    if (/^`[^`\n]+`$/.test(s)) return `<code>${esc(s.slice(1, -1))}</code>`;
    let h = esc(s);
    h = h.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="${u.replace(/"/g, '&quot;')}">${t}</a>`);
    h = h.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<b>$1</b>').replace(/__(?=\S)([\s\S]*?\S)__/g, '<b>$1</b>');
    h = h.replace(/(^|[\s(])\*(?=\S)([^*\n]*?\S)\*(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>');
    h = h.replace(/(^|[\s(])_(?=\S)([^_\n]*?\S)_(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>');
    return h;
  }).join('');
}

/**
 * Uzun HTML'ni Telegram chegarasi (4096) ostida bo'laklarga bo'lish.
 * Paragraf → qator → bo'sh joy chegarasida kesadi; ochiq teglar bo'lak oxirida yopiladi va keyingisida qayta ochiladi;
 * HTML entity (&amp;) o'rtasidan kesilmaydi.
 */
export function splitHtml(html, limit = 3900) {
  const s = String(html ?? '');
  if (s.length <= limit) return [s];
  const tokens = s.match(/<[^>]*>|[^<]+/g) || [];
  const parts = [];
  let cur = '';
  const stack = [];
  const closing = () => stack.slice().reverse().map((t) => `</${t.name}>`).join('');
  const hasText = (x) => x.replace(/<[^>]*>/g, '').trim().length > 0;
  const flush = () => {
    if (hasText(cur)) parts.push(cur + closing());
    cur = stack.map((t) => t.open).join('');
  };
  for (const tok of tokens) {
    if (tok[0] === '<') {
      const m = /^<\/?\s*([a-z-]+)/i.exec(tok);
      const name = m ? m[1].toLowerCase() : '';
      const isClose = tok.startsWith('</');
      if (!isClose && cur.length + tok.length + closing().length + name.length + 3 > limit) flush();
      cur += tok;
      if (isClose) { const idx = stack.map((t) => t.name).lastIndexOf(name); if (idx >= 0) stack.splice(idx, 1); }
      else if (!tok.endsWith('/>') && name) stack.push({ name, open: tok });
      continue;
    }
    let text = tok;
    while (text.length) {
      const room = limit - cur.length - closing().length;
      if (text.length <= room) { cur += text; break; }
      if (room < 40 && hasText(cur)) { flush(); continue; }
      let cut = breakAt(text, Math.max(1, room));
      const amp = text.lastIndexOf('&', cut - 1);
      if (amp >= 0 && amp > cut - 10) { const semi = text.indexOf(';', amp); if (semi >= cut) cut = amp || cut; }
      if (cut <= 0) cut = Math.max(1, room);
      cur += text.slice(0, cut);
      text = text.slice(cut);
      flush();
    }
  }
  if (hasText(cur)) parts.push(cur + closing());
  return parts.length ? parts : [s.slice(0, limit)];
}

function breakAt(text, room) {
  const win = text.slice(0, room);
  for (const sep of ['\n\n', '\n', ' ']) {
    const at = win.lastIndexOf(sep);
    if (at > room * 0.5) return at + sep.length;
  }
  return room;
}
