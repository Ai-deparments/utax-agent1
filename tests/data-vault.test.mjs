/** Ma'lumot seyfi (scripts/data-vault.mjs): shifrlash ↔ ochish, noto'g'ri kalit va buzilgan fayl rad etiladi */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encrypt, decrypt, parseKey } from '../scripts/data-vault.mjs';

const key = crypto.randomBytes(32);
const plain = Buffer.from('SQLite format 3\u0000 — sinov baza tarkibi '.repeat(200));

test('seyf: shifrlangan fayl ochiq matnni saqlamaydi va to‘liq qaytariladi', () => {
  const blob = encrypt(plain, key);
  assert.equal(blob.includes(Buffer.from('sinov baza')), false);
  assert.deepEqual(decrypt(blob, key), plain);
});

test('seyf: noto‘g‘ri kalit va o‘zgartirilgan fayl rad etiladi', () => {
  const blob = encrypt(plain, key);
  assert.throws(() => decrypt(blob, crypto.randomBytes(32)), /kalit noto‘g‘ri yoki fayl buzilgan/);
  const bad = Buffer.from(blob); bad[bad.length - 1] ^= 1;
  assert.throws(() => decrypt(bad, key), /kalit noto‘g‘ri yoki fayl buzilgan/);
  assert.throws(() => decrypt(Buffer.from('boshqa fayl'), key), /Seyf fayli emas/);
});

test('seyf: kalit formati tekshiriladi', () => {
  assert.equal(parseKey('ab'.repeat(32)).length, 32);
  assert.throws(() => parseKey(''), /DATA_VAULT_KEY/);
  assert.throws(() => parseKey('xyz'), /DATA_VAULT_KEY/);
});
