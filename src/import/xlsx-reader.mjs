/**
 * XLSX o'quvchi (import uchun, tashqi paketsiz).
 * core/export.mjs parseXlsx dan farqi: Excel qator raqami (r="N") saqlanadi (bo'sh qatorlar XML'da yo'q — massiv indeksi
 * qator raqamiga teng emas), formulali katakning keshlangan qiymati va xato katak (#N/A, t="e") alohida belgilanadi,
 * varaq nomi bo'yicha tanlash mumkin (workbook.xml + rels).
 */
import zlib from 'node:zlib';

function unzip(buf) {
  const out = {};
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('XLSX emas: ZIP oxiri (EOCD) topilmadi');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const data = buf.subarray(start, start + csize);
    out[name] = method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    p += 46 + nlen + elen + clen;
  }
  return out;
}
const unxml = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16))).replace(/&amp;/g, '&');
/** <si>/<is> ichidagi matn: <t> bo'laklari birlashtiriladi, fonetik (<rPh>) qism tashlanadi */
const richText = (inner) => unxml([...String(inner).replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
export function colLetters(i) {
  let s = '';
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}
const colIndex = (letters) => [...letters].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/**
 * @returns {{ sheet: string, sheets: string[], rows: Array<{ r: number, cells: Array<{ v: any, f?: string, error?: string } | undefined> }> }}
 *   v — son | matn | boolean | null (xato katakda null, error='#N/A'); f — formula matni (bo'lsa).
 */
export function readXlsx(buf, { sheet } = {}) {
  const files = unzip(buf);
  const shared = [];
  if (files['xl/sharedStrings.xml']) for (const m of files['xl/sharedStrings.xml'].toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(richText(m[1]));
  // Varaqlar: workbook.xml (nom → r:id) + workbook.xml.rels (r:id → fayl)
  const wb = files['xl/workbook.xml']?.toString('utf8') || '';
  const rels = files['xl/_rels/workbook.xml.rels']?.toString('utf8') || '';
  const target = Object.fromEntries([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1], /Target="([^"]+)"/.exec(m[0])?.[1]]));
  const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ name: unxml(/name="([^"]*)"/.exec(m[0])?.[1] || ''), rid: /r:id="([^"]+)"/.exec(m[0])?.[1] }));
  const pick = sheet ? sheets.find((s) => s.name === sheet) : sheets[0];
  if (sheet && !pick) throw new Error(`Varaq topilmadi: "${sheet}" (bor: ${sheets.map((s) => s.name).join(', ')})`);
  let file = pick?.rid && target[pick.rid] ? 'xl/' + target[pick.rid].replace(/^\/?xl\//, '').replace(/^\//, '') : null;
  if (!file || !files[file]) file = Object.keys(files).find((k) => /^xl\/worksheets\/sheet1\.xml$/.test(k)) || Object.keys(files).find((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
  if (!file) throw new Error('XLSX ichida varaq topilmadi');
  const sx = files[file].toString('utf8');
  const rows = [];
  let seq = 0;
  for (const rm of sx.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    seq++;
    const r = Number(/\br="(\d+)"/.exec(rm[1])?.[1]) || seq;
    seq = r;
    const cells = [];
    for (const cm of String(rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1] || '', inner = cm[2] || '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      if (!ref) continue;
      const t = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
      const f = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(inner)?.[1];
      const cell = { v: null };
      if (t === 's') cell.v = vm ? shared[Number(vm[1])] ?? '' : null;
      else if (t === 'inlineStr') cell.v = richText(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] || '');
      else if (t === 'str') cell.v = vm ? unxml(vm[1]) : null;
      else if (t === 'e') { cell.v = null; cell.error = vm ? unxml(vm[1]) : '#ERROR'; }
      else if (t === 'b') cell.v = vm ? vm[1] === '1' : null;
      else if (vm) { const n = Number(vm[1]); cell.v = Number.isFinite(n) ? n : unxml(vm[1]); }
      if (f !== undefined) cell.f = unxml(f);
      cells[colIndex(ref)] = cell;
    }
    rows.push({ r, cells });
  }
  return { sheet: pick?.name || 'Sheet1', sheets: sheets.map((s) => s.name), rows };
}
