import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * Ma'lumotlar bazasi adapteri.
 * Hozir: SQLite (node:sqlite, tashqi paketsiz). Interfeys ataylab tor — `run/get/all/exec/tx` —
 * shuning uchun PostgreSQL adapteri (pg) shu 5 metodni implement qilsa, modullar o'zgarmaydi.
 */
function norm(p) {
  return p.map((v) => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof Date) return v.toISOString();
    if (v !== null && typeof v === 'object' && !(v instanceof Uint8Array)) return JSON.stringify(v);
    return v;
  });
}

/**
 * Baza drayveri:
 *  - standart: node:sqlite (lokal fayl, WAL) — VPS / lokal ishga tushirish
 *  - TURSO_DATABASE_URL berilsa: libSQL embedded replica (Vercel kabi serverless muhit). Lokal nusxa `dbPath` da
 *    (Vercel'da /tmp), o'qish lokal nusxadan, yozuvlar Turso'dagi asosiy bazaga yuboriladi (readYourWrites).
 *    `db.sync()` boshqa instansiyalar yozgan o'zgarishlarni tortib oladi.
 * Ikkala drayver ham sinxron API beradi — modullar o'zgarmaydi.
 */
function openDriver(dbPath, remote) {
  if (remote?.url) {
    const Database = createRequire(import.meta.url)('libsql');
    const db = new Database(dbPath, { syncUrl: remote.url, authToken: remote.authToken || undefined, readYourWrites: true });
    db.sync();
    db.exec('PRAGMA foreign_keys = ON;');
    return { db, kind: 'libsql', remote: true, sync: () => db.sync() };
  }
  if (process.env.DB_DRIVER === 'libsql') { // lokal tekshiruv: libSQL drayverini sinxronlashsiz sinash (scripts/vercel-check.mjs)
    const Database = createRequire(import.meta.url)('libsql');
    const db = new Database(dbPath);
    db.exec('PRAGMA foreign_keys = ON;');
    return { db, kind: 'libsql', sync: () => {} };
  }
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return { db, kind: 'sqlite', sync: () => {} };
}
// libSQL qator obyektlariga `_metadata` qo'shadi — API javoblari va spread'larga tushmasligi uchun olib tashlanadi
const clean = (row) => { if (row && typeof row === 'object' && '_metadata' in row) delete row._metadata; return row; };

export function openDb(dbPath, { remote = remoteFromEnv() } = {}) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const drv = openDriver(dbPath, dbPath === ':memory:' ? null : remote);
  const db = drv.db;
  const cache = new Map();
  const prep = (sql) => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
  let depth = 0;
  const api = {
    raw: db,
    path: dbPath,
    driver: drv.kind,
    /** true — Turso (masofaviy) baza: lokal zaxira fayli kerak emas */
    remote: !!drv.remote,
    /** Serverless: boshqa instansiyalar yozgan o'zgarishlarni tortib olish (sqlite'da hech narsa qilmaydi) */
    sync: () => drv.sync(),
    exec: (sql) => db.exec(sql),
    run: (sql, ...p) => {
      const r = prep(sql).run(...norm(p));
      return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
    },
    get: (sql, ...p) => clean(prep(sql).get(...norm(p))) ?? null,
    all: (sql, ...p) => { const rows = prep(sql).all(...norm(p)); for (const r of rows) clean(r); return rows; },
    tx: (fn) => {
      if (depth > 0) return fn();
      depth++;
      db.exec('BEGIN');
      try {
        const r = fn();
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
    close: () => db.close(),
    /** Insert helper: db.insert('table', {col: val}) → id */
    insert: (table, obj) => {
      const keys = Object.keys(obj);
      const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
      return api.run(sql, ...keys.map((k) => obj[k])).lastId;
    },
    update: (table, id, obj) => {
      const keys = Object.keys(obj);
      if (!keys.length) return 0;
      const sql = `UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`;
      return api.run(sql, ...keys.map((k) => obj[k]), id).changes;
    },
  };
  return api;
}

/** TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) — libSQL masofaviy baza; bo'lmasa lokal node:sqlite */
export function remoteFromEnv() {
  const url = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL || '';
  return url ? { url, authToken: process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || '' } : null;
}
