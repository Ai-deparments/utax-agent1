import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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

export function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
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
    exec: (sql) => db.exec(sql),
    run: (sql, ...p) => {
      const r = prep(sql).run(...norm(p));
      return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
    },
    get: (sql, ...p) => prep(sql).get(...norm(p)) ?? null,
    all: (sql, ...p) => prep(sql).all(...norm(p)),
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
