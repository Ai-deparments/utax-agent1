/**
 * Eski XLS (BIFF8, OLE/CFB konteyner) o'quvchi — tashqi paketsiz.
 * Bank ko'chirmalari (ASBT "Справка о работе счета", FlexCube / Open Bank) shu formatda keladi.
 * Natija readXlsx (xlsx-reader.mjs) bilan bir xil shaklda: { sheet, sheets, rows: [{ r, cells: [{ v }] }] }.
 * Qo'llab-quvvatlanadi: SST/LABELSST (CONTINUE bilan), LABEL, NUMBER, RK, MULRK, FORMULA (+STRING), BOOLERR.
 * Sana kataklari son (Excel serial) bo'lib qaytadi — sanaga aylantirish chaqiruvchining ishi.
 */

const FREE = 0xffffffff, END = 0xfffffffe;

/** CFB (Compound File) ichidan nomi bo'yicha oqimni o'qish */
function readCfbStream(buf, names) {
  if (buf.length < 512 || buf.readUInt32LE(0) !== 0xe011cfd0 || buf.readUInt32LE(4) !== 0xe11ab1a1) throw new Error('XLS emas: OLE sarlavhasi topilmadi');
  const secSize = 1 << buf.readUInt16LE(30), miniSize = 1 << buf.readUInt16LE(32);
  const nFat = buf.readUInt32LE(44), dirStart = buf.readUInt32LE(48), cutoff = buf.readUInt32LE(56);
  const miniFatStart = buf.readUInt32LE(60), difatStart = buf.readUInt32LE(68);
  const secOff = (s) => 512 + s * secSize;
  // DIFAT → FAT sektorlari ro'yxati
  const fatSecs = [];
  for (let i = 0; i < 109 && fatSecs.length < nFat; i++) { const s = buf.readUInt32LE(76 + i * 4); if (s !== FREE) fatSecs.push(s); }
  for (let d = difatStart, guard = 0; d !== END && d !== FREE && fatSecs.length < nFat && guard < 10000; guard++) {
    const per = secSize / 4 - 1;
    for (let i = 0; i < per && fatSecs.length < nFat; i++) fatSecs.push(buf.readUInt32LE(secOff(d) + i * 4));
    d = buf.readUInt32LE(secOff(d) + per * 4);
  }
  const fat = [];
  for (const s of fatSecs) for (let i = 0; i < secSize / 4; i++) fat.push(buf.readUInt32LE(secOff(s) + i * 4));
  const chain = (start, table) => {
    const out = [];
    for (let s = start, guard = 0; s !== END && s !== FREE && s < table.length && guard < 1e6; guard++) { out.push(s); s = table[s]; }
    return out;
  };
  const readChain = (start) => Buffer.concat(chain(start, fat).map((s) => buf.subarray(secOff(s), secOff(s) + secSize)));
  const dir = readChain(dirStart);
  const entries = [];
  for (let p = 0; p + 128 <= dir.length; p += 128) {
    const nameLen = dir.readUInt16LE(p + 64);
    entries.push({ name: dir.toString('utf16le', p, p + Math.max(0, nameLen - 2)), type: dir[p + 66], start: dir.readUInt32LE(p + 116), size: dir.readUInt32LE(p + 120) });
  }
  const entry = entries.find((e) => e.type === 2 && names.includes(e.name));
  if (!entry) throw new Error(`XLS ichida ${names.join('/')} oqimi topilmadi`);
  if (entry.size >= cutoff) return readChain(entry.start).subarray(0, entry.size);
  // Kichik oqim — mini stream (root entry zanjiri) + mini FAT orqali
  const root = entries.find((e) => e.type === 5);
  const miniStream = readChain(root.start);
  const miniFatBuf = readChain(miniFatStart);
  const miniFat = [];
  for (let i = 0; i + 4 <= miniFatBuf.length; i += 4) miniFat.push(miniFatBuf.readUInt32LE(i));
  return Buffer.concat(chain(entry.start, miniFat).map((s) => miniStream.subarray(s * miniSize, (s + 1) * miniSize))).subarray(0, entry.size);
}

/** RK qiymat → son */
function rkNumber(rk) {
  let v;
  if (rk & 2) v = rk >> 2;
  else { const b = Buffer.alloc(8); b.writeUInt32LE(rk & 0xfffffffc, 4); v = b.readDoubleLE(0); }
  return rk & 1 ? v / 100 : v;
}

/**
 * CONTINUE bilan bo'lingan SST'ni o'qish uchun kursor: satr belgilari yozuv chegarasidan o'tsa,
 * yangi bo'lak boshida yana bitta flag bayt (siqilgan/UTF-16) keladi.
 */
function readSst(chunks) {
  let ci = 0, pos = 0;
  const cur = () => chunks[ci];
  const ensure = () => { while (ci < chunks.length && pos >= cur().length) { ci++; pos = 0; } };
  const u8 = () => { ensure(); return cur()[pos++]; };
  const u16 = () => { const a = u8(), b = u8(); return a | (b << 8); };
  const u32 = () => (u16() | (u16() << 16)) >>> 0;
  const skip = (n) => { while (n > 0) { ensure(); const k = Math.min(n, cur().length - pos); pos += k; n -= k; } };
  u32();
  const unique = u32();
  const out = [];
  for (let i = 0; i < unique && ci < chunks.length; i++) {
    const cch = u16(), flags = u8();
    let wide = flags & 1;
    const runs = flags & 8 ? u16() : 0, ext = flags & 4 ? u32() : 0;
    let s = '', left = cch;
    while (left > 0) {
      ensure();
      if (pos >= cur().length) break;
      const avail = wide ? Math.floor((cur().length - pos) / 2) : cur().length - pos;
      const take = Math.min(left, avail);
      s += wide ? cur().toString('utf16le', pos, pos + take * 2) : cur().toString('latin1', pos, pos + take);
      pos += take * (wide ? 2 : 1);
      left -= take;
      if (left > 0) { ci++; pos = 0; wide = u8() & 1; }
    }
    skip(runs * 4 + ext);
    out.push(s);
  }
  return out;
}

/** BIFF8 XLUnicodeString (uzunlik 16-bit) */
function xlString(b, p) {
  const cch = b.readUInt16LE(p), flags = b[p + 2];
  return flags & 1 ? b.toString('utf16le', p + 3, p + 3 + cch * 2) : b.toString('latin1', p + 3, p + 3 + cch);
}

/**
 * @returns {{ sheet: string, sheets: string[], rows: Array<{ r: number, cells: Array<{ v: any } | undefined> }> }}
 *   r — 1 dan boshlanadigan Excel qator raqami.
 */
export function readXls(buf, { sheet } = {}) {
  const wb = readCfbStream(buf, ['Workbook', 'Book']);
  const recs = [];
  for (let p = 0; p + 4 <= wb.length;) {
    const type = wb.readUInt16LE(p), len = wb.readUInt16LE(p + 2);
    recs.push({ type, off: p, data: wb.subarray(p + 4, p + 4 + len) });
    p += 4 + len;
  }
  if (!recs.length || recs[0].type !== 0x0809) throw new Error('XLS emas: BIFF BOF yozuvi topilmadi');
  if (recs[0].data.readUInt16LE(0) !== 0x0600) throw new Error('Faqat BIFF8 (Excel 97–2003) XLS qo‘llab-quvvatlanadi');
  const sheets = [];
  let sst = [];
  for (let i = 0; i < recs.length; i++) {
    const { type, data } = recs[i];
    if (type === 0x0085) {
      const cch = data[6], flags = data[7];
      sheets.push({ pos: data.readUInt32LE(0), name: flags & 1 ? data.toString('utf16le', 8, 8 + cch * 2) : data.toString('latin1', 8, 8 + cch) });
    } else if (type === 0x00fc) {
      const chunks = [data];
      while (recs[i + 1]?.type === 0x003c) chunks.push(recs[++i].data);
      sst = readSst(chunks);
    } else if (type === 0x000a) break; // globals EOF
  }
  const pick = sheet ? sheets.find((s) => s.name === sheet) : sheets[0];
  if (!pick) throw new Error(sheet ? `Varaq topilmadi: "${sheet}" (bor: ${sheets.map((s) => s.name).join(', ')})` : 'XLS ichida varaq topilmadi');
  const start = recs.findIndex((x) => x.off === pick.pos);
  if (start < 0) throw new Error('XLS varag‘i boshi topilmadi');
  const grid = new Map();
  const put = (r, c, v) => {
    if (!grid.has(r)) grid.set(r, []);
    grid.get(r)[c] = { v };
  };
  let pendingFormula = null;
  for (let i = start + 1; i < recs.length; i++) {
    const { type, data } = recs[i];
    if (type === 0x000a) break;
    if (type === 0x00fd) put(data.readUInt16LE(0), data.readUInt16LE(2), sst[data.readUInt32LE(6)] ?? '');
    else if (type === 0x0203) put(data.readUInt16LE(0), data.readUInt16LE(2), data.readDoubleLE(6));
    else if (type === 0x027e) put(data.readUInt16LE(0), data.readUInt16LE(2), rkNumber(data.readUInt32LE(6)));
    else if (type === 0x00bd) {
      const r = data.readUInt16LE(0), c0 = data.readUInt16LE(2), n = (data.length - 6) / 6;
      for (let k = 0; k < n; k++) put(r, c0 + k, rkNumber(data.readUInt32LE(4 + k * 6 + 2)));
    } else if (type === 0x0204) put(data.readUInt16LE(0), data.readUInt16LE(2), xlString(data, 6));
    else if (type === 0x0205) put(data.readUInt16LE(0), data.readUInt16LE(2), data[7] ? null : Boolean(data[6]));
    else if (type === 0x0006) {
      const r = data.readUInt16LE(0), c = data.readUInt16LE(2);
      if (data.readUInt16LE(12) !== 0xffff) put(r, c, data.readDoubleLE(6));
      else if (data[6] === 0) pendingFormula = { r, c };
      else if (data[6] === 1) put(r, c, Boolean(data[8]));
      else put(r, c, null);
    } else if (type === 0x0207 && pendingFormula) {
      put(pendingFormula.r, pendingFormula.c, xlString(data, 0));
      pendingFormula = null;
    }
  }
  const rows = [...grid.keys()].sort((a, b) => a - b).map((r) => ({ r: r + 1, cells: grid.get(r) }));
  return { sheet: pick.name, sheets: sheets.map((s) => s.name), rows };
}

/** Fayl baytlari eski XLS (OLE) ekanini aniqlash */
export const isXls = (buf) => buf?.length > 8 && buf.readUInt32LE(0) === 0xe011cfd0 && buf.readUInt32LE(4) === 0xe11ab1a1;
