#!/usr/bin/env node
/**
 * MA'LUMOT SEYFI — haqiqiy bazani (va manba Excel'ni) SHIFRLANGAN holda repoga qo'yish, jamoa a'zolari kalit bilan ochadi.
 *
 *   node scripts/data-vault.mjs keygen                       — yangi kalit yaratib .env ga DATA_VAULT_KEY sifatida yozadi (chiqarmaydi)
 *   node scripts/data-vault.mjs pack [--add fayl.xlsx ...]   — data/finance.db (+ --add fayllar) → data/vault/*.enc + manifest.json
 *   node scripts/data-vault.mjs unpack                       — data/vault/finance.db.enc → data/finance.db (eskisi data/backups/ ga)
 *   node scripts/data-vault.mjs verify                       — kalit to'g'riligini va fayllar butunligini tekshiradi (hech narsa yozmaydi)
 *
 * Xavfsizlik:
 *  - AES-256-GCM (autentifikatsiyali): kalitsiz o'qib ham, sezdirmay o'zgartirib ham bo'lmaydi.
 *  - Kalit (DATA_VAULT_KEY, 64 hex) faqat .env da — git'ga tushmaydi. Jamoaga shaxsiy kanal orqali beriladi.
 *  - Repoga faqat .enc fayllar va manifest (sana, hajm, xesh — biznes ma'lumoti emas) tushadi.
 *  - unpack serverni to'xtatib bajariladi (baza fayli band bo'lsa — hech narsa o'zgartirilmaydi).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { encrypt, decrypt, parseKey, sha, keyFingerprint } from '../src/core/sealed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV = path.join(ROOT, '.env');

// Kriptografiya src/core/sealed.mjs da (bitta joyda) — bu yerdan qayta eksport qilinadi
export { encrypt, decrypt, parseKey };

function readEnvKey() {
  if (process.env.DATA_VAULT_KEY) return process.env.DATA_VAULT_KEY;
  if (!fs.existsSync(ENV)) return '';
  const m = /^DATA_VAULT_KEY=(.*)$/m.exec(fs.readFileSync(ENV, 'utf8'));
  return m ? m[1].trim() : '';
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const dbPath = path.resolve(ROOT, opt('--db', 'data/finance.db'));
  const vault = path.resolve(ROOT, opt('--vault', 'data/vault'));
  const manifestPath = path.join(vault, 'manifest.json');

  if (cmd === 'keygen') {
    const env = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : '';
    if (/^DATA_VAULT_KEY=[0-9a-f]{64}\s*$/im.test(env)) { console.log('.env da DATA_VAULT_KEY allaqachon bor — o‘zgartirilmadi (eski .enc fayllar shu kalit bilan ochiladi).'); return; }
    const key = crypto.randomBytes(32).toString('hex');
    const next = /^DATA_VAULT_KEY=.*$/m.test(env) ? env.replace(/^DATA_VAULT_KEY=.*$/m, `DATA_VAULT_KEY=${key}`) : `${env.replace(/\s*$/, '')}\n\n# Ma'lumot seyfi kaliti (scripts/data-vault.mjs) — git'ga tushmaydi, jamoaga shaxsiy kanal orqali beriladi\nDATA_VAULT_KEY=${key}\n`;
    fs.writeFileSync(ENV, next);
    console.log('Yangi DATA_VAULT_KEY .env ga yozildi (ekranga chiqarilmadi).');
    return;
  }

  const key = parseKey(readEnvKey());

  if (cmd === 'pack') {
    if (!fs.existsSync(dbPath)) throw new Error(`Baza topilmadi: ${dbPath}`);
    fs.mkdirSync(vault, { recursive: true });
    // Ishlab turgan bazadan ham izchil nusxa (WAL bilan): VACUUM INTO vaqtinchalik faylga
    const { DatabaseSync } = await import('node:sqlite');
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'utax-vault-')), 'snap.db');
    const src = new DatabaseSync(dbPath, { readOnly: true });
    src.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    src.close();
    const items = [{ name: 'finance.db', data: fs.readFileSync(tmp) }];
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    for (let i = 0; i < args.length; i++) if (args[i] === '--add') { const f = path.resolve(args[i + 1]); items.push({ name: `source/${path.basename(f)}`, data: fs.readFileSync(f) }); }
    const files = [];
    for (const it of items) {
      const out = path.join(vault, `${it.name}.enc`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const blob = encrypt(it.data, key);
      fs.writeFileSync(out, blob);
      files.push({ name: it.name, enc: path.relative(vault, out).replace(/\\/g, '/'), bytes: it.data.length, sha256: sha(it.data), enc_bytes: blob.length });
    }
    const manifest = { format: 'UTAXVLT1 (AES-256-GCM + gzip)', created_at: new Date().toISOString(), key_fingerprint: keyFingerprint(key), files };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Seyf yangilandi: ${path.relative(ROOT, vault)}`);
    for (const f of files) console.log(`  ${f.enc}  (${f.bytes} bayt → ${f.enc_bytes} bayt shifrlangan)`);
    return;
  }

  if (cmd === 'verify' || cmd === 'unpack') {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.key_fingerprint !== keyFingerprint(key)) throw new Error('Kalit bu seyfga mos emas (fingerprint farq qiladi) — to‘g‘ri DATA_VAULT_KEY ni so‘rang');
    const opened = manifest.files.map((f) => {
      const plain = decrypt(fs.readFileSync(path.join(vault, f.enc)), key);
      if (sha(plain) !== f.sha256) throw new Error(`${f.name}: xesh mos emas — fayl buzilgan`);
      return { ...f, plain };
    });
    if (cmd === 'verify') { for (const f of opened) console.log(`OK  ${f.name}  ${f.bytes} bayt  sha256 ${f.sha256.slice(0, 12)}…`); console.log(`Seyf sanasi: ${manifest.created_at}`); return; }
    const db = opened.find((f) => f.name === 'finance.db');
    if (fs.existsSync(dbPath)) {
      const dir = path.join(path.dirname(dbPath), 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const target = path.join(dir, `finance-pre-unpack-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
      try { for (const sfx of ['', '-wal', '-shm']) if (fs.existsSync(dbPath + sfx)) fs.renameSync(dbPath + sfx, target + sfx); }
      catch (e) { throw new Error(`Joriy bazani ko‘chirib bo‘lmadi (${e.code || e.message}) — server ishlayaptimi? Avval to‘xtating. Hech narsa o‘zgartirilmadi.`); }
      console.log(`Joriy baza saqlandi: ${path.relative(ROOT, target)}`);
    }
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, db.plain);
    for (const f of opened.filter((x) => x !== db)) { const out = path.join(ROOT, 'data', 'imports', f.name); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, f.plain); console.log(`Manba fayl: ${path.relative(ROOT, out)}`); }
    console.log(`Baza ochildi: ${path.relative(ROOT, dbPath)} (seyf sanasi ${manifest.created_at}). Endi: npm start`);
    return;
  }
  console.log('Foydalanish: node scripts/data-vault.mjs keygen | pack [--add fayl] | unpack | verify');
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
