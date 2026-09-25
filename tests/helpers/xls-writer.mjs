/**
 * Minimal BIFF8 (.xls) yozuvchi — faqat testlar uchun (xls-reader.mjs ni tekshirish).
 * Bitta varaq; satrlar SST orqali (8224 baytdan uzun SST CONTINUE yozuvlariga bo'linadi), sonlar NUMBER yozuvi bilan.
 * Konteyner: 512 baytli sektorli CFB — FAT (0-sektor), katalog (1-sektor), Workbook oqimi (2-sektordan).
 */
const rec = (type, data) => { const b = Buffer.alloc(4 + data.length); b.writeUInt16LE(type, 0); b.writeUInt16LE(data.length, 2); data.copy(b, 4); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const bof = (dt) => rec(0x0809, Buffer.concat([u16(0x0600), u16(dt), u16(0), u16(0), u32(0), u32(0)]));
const MAX = 8224;

function sstRecords(strings) {
  const chunks = [[]];
  let size = 0;
  const cur = () => chunks[chunks.length - 1];
  const push = (b) => { cur().push(b); size += b.length; };
  const next = () => { chunks.push([]); size = 0; };
  push(Buffer.concat([u32(strings.length), u32(strings.length)]));
  for (const s of strings) {
    if (MAX - size < 5) next();
    push(Buffer.concat([u16(s.length), Buffer.from([1])]));
    let rest = s;
    while (rest.length) {
      const room = Math.floor((MAX - size) / 2);
      if (room < 1) { next(); push(Buffer.from([1])); continue; }
      const part = rest.slice(0, room);
      push(Buffer.from(part, 'utf16le'));
      rest = rest.slice(part.length);
    }
  }
  return chunks.map((c, i) => rec(i === 0 ? 0x00fc : 0x003c, Buffer.concat(c)));
}

/** rows: massivlar massivi; null/undefined — bo'sh katak */
export function buildXls(rows, { sheetName = 'Sheet1' } = {}) {
  const strings = [], index = new Map();
  const cells = [];
  rows.forEach((row, r) => row.forEach((v, c) => {
    if (v === null || v === undefined || v === '') return;
    if (typeof v === 'number') { const d = Buffer.alloc(8); d.writeDoubleLE(v); cells.push(rec(0x0203, Buffer.concat([u16(r), u16(c), u16(0), d]))); return; }
    const s = String(v);
    if (!index.has(s)) { index.set(s, strings.length); strings.push(s); }
    cells.push(rec(0x00fd, Buffer.concat([u16(r), u16(c), u16(0), u32(index.get(s))])));
  }));
  const name = Buffer.concat([Buffer.from([sheetName.length, 1]), Buffer.from(sheetName, 'utf16le')]);
  const build = (pos) => Buffer.concat([bof(0x0005), rec(0x0085, Buffer.concat([u32(pos), Buffer.from([0, 0]), name])), ...sstRecords(strings), rec(0x000a, Buffer.alloc(0))]);
  const globalsLen = build(0).length;
  const sheet = Buffer.concat([bof(0x0010), ...cells, rec(0x000a, Buffer.alloc(0))]);
  let wb = Buffer.concat([build(globalsLen), sheet]);
  const size = wb.length;
  const nSec = Math.max(8, Math.ceil(size / 512)); // >= 4096 bayt — mini oqim emas
  wb = Buffer.concat([wb, Buffer.alloc(nSec * 512 - size)]);

  const header = Buffer.alloc(512, 0);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(0x3e, 24); header.writeUInt16LE(3, 26); header.writeUInt16LE(0xfffe, 28);
  header.writeUInt16LE(9, 30); header.writeUInt16LE(6, 32);
  header.writeUInt32LE(1, 44); header.writeUInt32LE(1, 48); header.writeUInt32LE(4096, 56);
  header.writeUInt32LE(0xfffffffe, 60); header.writeUInt32LE(0xfffffffe, 68);
  for (let i = 0; i < 109; i++) header.writeUInt32LE(i === 0 ? 0 : 0xffffffff, 76 + i * 4);
  const fat = Buffer.alloc(512, 0xff);
  fat.writeUInt32LE(0xfffffffd, 0); fat.writeUInt32LE(0xfffffffe, 4);
  for (let i = 0; i < nSec; i++) fat.writeUInt32LE(i === nSec - 1 ? 0xfffffffe : 3 + i, (2 + i) * 4);
  const dir = Buffer.alloc(512, 0);
  const entry = (i, nm, type, start, sz, child) => {
    const o = i * 128; Buffer.from(nm + '\0', 'utf16le').copy(dir, o); dir.writeUInt16LE((nm.length + 1) * 2, o + 64);
    dir[o + 66] = type; dir.writeUInt32LE(0xffffffff, o + 68); dir.writeUInt32LE(0xffffffff, o + 72); dir.writeUInt32LE(child, o + 76);
    dir.writeUInt32LE(start, o + 116); dir.writeUInt32LE(sz, o + 120);
  };
  entry(0, 'Root Entry', 5, 0xfffffffe, 0, 1);
  entry(1, 'Workbook', 2, 2, nSec * 512, 0xffffffff); // o'lcham >= 4096 — oddiy (mini emas) oqim
  for (let i = 2; i < 4; i++) { const o = i * 128; dir.writeUInt32LE(0xffffffff, o + 68); dir.writeUInt32LE(0xffffffff, o + 72); dir.writeUInt32LE(0xffffffff, o + 76); }
  return Buffer.concat([header, fat, dir, wb]);
}
