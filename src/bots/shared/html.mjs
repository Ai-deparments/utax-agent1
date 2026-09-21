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
 * AI Markdown → Telegram HTML (parse_mode: 'HTML'). Telegram <ul>/<li> ni qo'llamaydi, shuning uchun:
 *   ```til\n…``` → <pre><code class="language-til">…</code></pre>   `kod` → <code>
 *   **qalin** / __qalin__ → <b>        *kursiv* / _kursiv_ → <i> (so'z ichidagi file_name, 2*3 ga tegilmaydi)
 *   satr boshidagi "- " / "* " / "+ " → "• " (ichki ro'yxat indentatsiyasi saqlanadi), "1. " raqamli ro'yxat o'zgarmaydi
 *   # sarlavha → <b>   > iqtibos → <blockquote>   [matn](https://…) → <a>   | jadval | → <pre> (monospace)   --- → chiziq
 * Qolgan < > & escape qilinadi. Uzun natija splitHtml bilan 4096 chegarasida teglarni buzmasdan bo'laklanadi.
 */
export function mdToHtml(md) {
  const src = String(md ?? '').replace(/\r\n?/g, '\n');
  const out = [];
  const parts = src.split(/```/);
  parts.forEach((part, idx) => {
    if (idx % 2 === 1) {
      // kod bloki (yopilmagan oxirgi blok ham kod sifatida)
      const m = /^([a-z0-9_+#.-]{1,20})[ \t]*\n/i.exec(part);
      const lang = m ? m[1].toLowerCase() : '';
      const body = (m ? part.slice(m[0].length) : part.replace(/^\n/, '')).replace(/\n$/, '');
      out.push(`<pre><code${lang ? ` class="language-${escAttr(lang)}"` : ''}>${esc(body)}</code></pre>`);
      return;
    }
    out.push(blocks(part));
  });
  return out.join('');
}

/** Kod blokidan tashqari matn: satrlar guruhlanadi (jadval, iqtibos), qolgani satrma-satr */
function blocks(text) {
  const src = text.split('\n');
  const out = [];
  for (let k = 0; k < src.length; k++) {
    const line = src[k];
    // | jadval | — ketma-ket satrlar monospace <pre> ga
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows = [];
      while (k < src.length && /^\s*\|.*\|\s*$/.test(src[k])) rows.push(src[k++]);
      k--;
      out.push(table(rows));
      continue;
    }
    // > iqtibos — ketma-ket satrlar bitta <blockquote>
    if (/^\s{0,3}>\s?/.test(line)) {
      const q = [];
      while (k < src.length && /^\s{0,3}>\s?/.test(src[k])) q.push(src[k++].replace(/^\s{0,3}>\s?/, ''));
      k--;
      out.push(`<blockquote>${q.map(inline).join('\n')}</blockquote>`);
      continue;
    }
    const h = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { out.push(`<b>${inline(h[1])}</b>`); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push('──────────'); continue; }
    const li = /^(\s*)[-*+•]\s+(.*)$/.exec(line);
    if (li) { out.push(`${li[1].replace(/\t/g, '  ')}• ${inline(li[2])}`); continue; }
    out.push(inline(line));
  }
  return out.join('\n');
}

/** Markdown jadvali → tekislangan monospace matn (<pre>); ajratuvchi |---| qatori tashlanadi */
function table(rows) {
  const cells = rows
    .map((r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/\*\*|__|`/g, '')))
    .filter((cs) => !cs.every((c) => /^:?-{2,}:?$/.test(c) || c === ''));
  if (!cells.length) return '';
  const n = Math.max(...cells.map((cs) => cs.length));
  const width = Array.from({ length: n }, (_, j) => Math.min(28, Math.max(...cells.map((cs) => (cs[j] || '').length))));
  const fit = (s, w) => (s.length > w ? s.slice(0, w - 1) + '…' : s.padEnd(w));
  return `<pre>${esc(cells.map((cs) => width.map((w, j) => fit(cs[j] || '', w)).join('  ').trimEnd()).join('\n'))}</pre>`;
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
