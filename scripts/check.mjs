/** Sintaksis tekshiruvi: src/, public/js/, tests/, scripts/ dagi barcha .mjs/.js fayllar `node --check` dan o'tadi. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['src', 'public/js', 'tests', 'scripts'];
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(mjs|js)$/.test(e.name)) files.push(p);
  }
};
for (const d of DIRS) if (fs.existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d));

let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed++;
    console.error(`✖ ${path.relative(ROOT, f)}\n${r.stderr}`);
  }
}
console.log(`${files.length} fayl tekshirildi, ${failed} xato`);
process.exit(failed ? 1 : 0);
