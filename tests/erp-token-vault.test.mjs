/**
 * Seyfdagi UTAXERP tokeni: muhrlash ↔ ochish, noto'g'ri kalit/buzuq fayl, muddat nazorati.
 * Maqsad — jamoa a'zosi `.env` da ERP_TOKEN'siz `git pull` qilib ishlay olsin, lekin yaroqsiz token repoga tushmasin.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encrypt, readSealedErpToken, jwtInfo, ERP_TOKEN_FILE, ERP_TOKEN_META } from '../src/core/sealed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'erp-token.mjs');
const KEY_HEX = crypto.randomBytes(32).toString('hex');
const KEY = Buffer.from(KEY_HEX, 'hex');

/** Imzosi tekshirilmaydigan sinov JWT'si (ERP tokeni shaklida) */
function fakeJwt(expDaysFromNow, username = 'testuser') {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ username, id: 'a-b-c', iat: now, exp: now + Math.round(expDaysFromNow * 86400) })}.${crypto.randomBytes(32).toString('base64url')}`;
}

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'utax-erp-token-'));
const seal = (dir, args, env = {}) => execFileSync(process.execPath, [SCRIPT, ...args, '--vault', dir, '--env', path.join(dir, '.env')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATA_VAULT_KEY: KEY_HEX, ...env } });

test('seal → readSealedErpToken: token aynan qaytadi, muddati o‘qiladi', () => {
  const dir = tmpdir();
  const token = fakeJwt(30);
  const out = seal(dir, ['seal', token]);
  assert.match(out, /Token seyfga yozildi/);

  const got = readSealedErpToken(ROOT, { vaultDir: dir, key: KEY_HEX });
  assert.equal(got.token, token, 'ochilgan token asl token bilan bir xil');
  assert.equal(got.username, 'testuser');
  assert.equal(got.expired, false);
  assert.equal(got.expires_at, jwtInfo(token).expires_at);

  // .env ham yangilanadi (egasi uchun qulaylik)
  assert.match(fs.readFileSync(path.join(dir, '.env'), 'utf8'), new RegExp(`^ERP_TOKEN=${token}$`, 'm'));
  // Ochiq yon-faylda tokenning o'zi YO'Q, faqat muddat va kalit izi
  const meta = JSON.parse(fs.readFileSync(path.join(dir, ERP_TOKEN_META), 'utf8'));
  assert.equal(meta.expires_at, jwtInfo(token).expires_at);
  assert.ok(!JSON.stringify(meta).includes(token.slice(0, 40)), 'yon-faylda token bo‘lmasligi kerak');
  // Shifrlangan faylda ham token ochiq matn sifatida yotmaydi
  assert.ok(!fs.readFileSync(path.join(dir, ERP_TOKEN_FILE)).includes(Buffer.from(token.slice(0, 40))), 'token shifrlanmagan holda saqlanmaydi');
});

test('noto‘g‘ri kalit, kalitsiz va buzuq fayl — null qaytadi, xato tashlanmaydi', () => {
  const dir = tmpdir();
  seal(dir, ['seal', fakeJwt(30)]);

  const wrong = crypto.randomBytes(32).toString('hex');
  const warns = [];
  assert.equal(readSealedErpToken(ROOT, { vaultDir: dir, key: wrong, warn: (m) => warns.push(m) }), null);
  assert.equal(readSealedErpToken(ROOT, { vaultDir: dir, key: '', warn: (m) => warns.push(m) }), null);
  assert.ok(warns.some((w) => /DATA_VAULT_KEY/.test(w)), 'kalit yo‘qligi haqida ogohlantiradi');

  fs.writeFileSync(path.join(dir, ERP_TOKEN_FILE), Buffer.from('bu seyf fayli emas'));
  assert.equal(readSealedErpToken(ROOT, { vaultDir: dir, key: KEY_HEX, warn: () => {} }), null);
});

test('fayl yo‘q bo‘lsa null (eski o‘rnatishlar buzilmaydi)', () => {
  assert.equal(readSealedErpToken(ROOT, { vaultDir: tmpdir(), key: KEY_HEX }), null);
});

test('muddati o‘tgan token: seal rad etadi, ochishda ogohlantiriladi', () => {
  const dir = tmpdir();
  assert.throws(() => seal(dir, ['seal', fakeJwt(-1)]), /muddati allaqachon o‘tgan|Command failed/);
  assert.equal(fs.existsSync(path.join(dir, ERP_TOKEN_FILE)), false, 'yaroqsiz token repoga tushmaydi');

  // Muhrlanganidan keyin eskirgan token — ochiladi, lekin "expired" bayrog'i bilan
  fs.writeFileSync(path.join(dir, ERP_TOKEN_FILE), encrypt(Buffer.from(fakeJwt(-2)), KEY));
  const warns = [];
  const got = readSealedErpToken(ROOT, { vaultDir: dir, key: KEY_HEX, warn: (m) => warns.push(m) });
  assert.equal(got.expired, true);
  assert.ok(warns.some((w) => /muddati o‘tgan/.test(w)));
});

test('JWT bo‘lmagan qiymat: seal rad etadi, ochishda e’tiborga olinmaydi', () => {
  const dir = tmpdir();
  assert.throws(() => seal(dir, ['seal', 'shunchaki-matn']), /JWT formatida emas|Command failed/);
  fs.writeFileSync(path.join(dir, ERP_TOKEN_FILE), encrypt(Buffer.from('shunchaki-matn'), KEY));
  assert.equal(readSealedErpToken(ROOT, { vaultDir: dir, key: KEY_HEX, warn: () => {} }), null);
});

test('show: muddat va foydalanuvchini ko‘rsatadi, tokenning o‘zini chiqarmaydi', () => {
  const dir = tmpdir();
  const token = fakeJwt(10, 'dbabajanov');
  seal(dir, ['seal', token]);
  const out = seal(dir, ['show']);
  assert.match(out, /dbabajanov/);
  assert.match(out, /kun qoldi/);
  assert.ok(!out.includes(token.slice(0, 40)), 'token ekranga chiqmasligi kerak');
});

test('export: seyfdagi token .env ga yoziladi', () => {
  const dir = tmpdir();
  const token = fakeJwt(15);
  seal(dir, ['seal', token]);
  fs.writeFileSync(path.join(dir, '.env'), 'PORT=1\n');
  seal(dir, ['export']);
  assert.match(fs.readFileSync(path.join(dir, '.env'), 'utf8'), new RegExp(`^ERP_TOKEN=${token}$`, 'm'));
});

test('repodagi haqiqiy seyf: ochiq yon-fayl bor va kalit izi baza seyfi bilan bir xil', () => {
  const vault = path.join(ROOT, 'data', 'vault');
  if (!fs.existsSync(path.join(vault, ERP_TOKEN_META))) return; // token hali muhrlanmagan bo'lsa test o'tkazib yuboriladi
  const meta = JSON.parse(fs.readFileSync(path.join(vault, ERP_TOKEN_META), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(vault, 'manifest.json'), 'utf8'));
  assert.equal(meta.key_fingerprint, manifest.key_fingerprint, 'token va baza bitta DATA_VAULT_KEY bilan shifrlangan');
  assert.match(meta.expires_at, /^\d{4}-\d{2}-\d{2}T/);
});
