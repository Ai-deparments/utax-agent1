import fs from 'node:fs';
import path from 'node:path';
import { badRequest } from '../core/http.mjs';
import { DEFAULT_SETTINGS } from '../core/settings.mjs';
import { buildXlsx } from '../core/export.mjs';
import { config } from '../core/config.mjs';
import { nowIso } from '../core/util.mjs';

export function register(app) {
  const { r, db, settings, audit, scheduler } = app;
  const HIDDEN = /^scheduler\./;

  r.get('/api/settings', { perm: ['settings', 'VIEW'], tags: ['settings'], summary: 'Biznes qoidalari (barcha sozlamalar)' }, async () => {
    const all = settings.all();
    const out = {};
    for (const [k, v] of Object.entries(all)) if (!HIDDEN.test(k)) out[k] = v;
    return { settings: out, defaults: DEFAULT_SETTINGS, env: { ai_llm: !!config.anthropicKey, ai_model: config.aiModel, telegram: Object.values(config.bots).some(Boolean), telegram_bots: Object.fromEntries(Object.entries(config.bots).map(([k, v]) => [k, !!v])), bot_mode: config.botMode, email: !!config.emailWebhook, db: config.dbPath, node: process.version } };
  });
  r.put('/api/settings', { perm: ['settings', 'EDIT'], tags: ['settings'], summary: 'Sozlamalarni yangilash {key: value}' }, async (ctx) => {
    const b = ctx.body || {};
    const old = settings.all();
    for (const [k, v] of Object.entries(b)) {
      if (HIDDEN.test(k)) continue;
      if (ctx.user.role_code === 'AI_AGENT') throw badRequest('AI agent sozlamalarni o‘zgartira olmaydi');
      settings.set(k, v, ctx.user.id);
    }
    audit(ctx, { action: 'SETTINGS_UPDATED', entity: 'settings', oldValue: Object.fromEntries(Object.keys(b).map((k) => [k, old[k]])), newValue: b });
    return { ok: true };
  });
  r.get('/api/settings/scheduler', { perm: ['settings', 'VIEW'], tags: ['settings'], summary: 'Fon vazifalari' }, async () => scheduler.list());
  r.post('/api/settings/scheduler/:name/run', { perm: ['settings', 'EDIT'], tags: ['settings'], summary: 'Fon vazifasini hozir ishga tushirish' }, async (ctx) => ({ result: await scheduler.run(ctx.params.name) }));
  r.post('/api/settings/backup', { perm: ['settings', 'EDIT'], tags: ['settings'], summary: 'Bazani zaxiralash (SQLite backup API)' }, async (ctx) => {
    fs.mkdirSync(config.backupDir, { recursive: true });
    const file = path.join(config.backupDir, `finance-${nowIso().replace(/[:.]/g, '-')}.db`);
    try { const { backup } = await import('node:sqlite'); await backup(db.raw, file); } catch { db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`); }
    audit(ctx, { action: 'BACKUP', entity: 'system', newValue: { file } });
    return { ok: true, file, size: fs.statSync(file).size, backups: fs.readdirSync(config.backupDir).filter((f) => f.endsWith('.db')).sort().reverse().slice(0, 30) };
  });

  // Universal export: front jadvalni yuboradi → xlsx
  r.post('/api/export/xlsx', { perm: ['reports', 'EXPORT'], tags: ['reports'], summary: 'Excel eksport {title, columns:[{key,label}], rows:[...]}', raw: true }, async (ctx) => {
    const { title = 'export', columns = [], rows = [] } = ctx.body || {};
    if (!columns.length) throw badRequest('columns kerak');
    const header = columns.map((c) => c.label || c.key);
    const data = rows.map((row) => columns.map((c) => { const v = row[c.key]; return v === null || v === undefined ? '' : typeof v === 'number' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v); }));
    const buf = buildXlsx({ sheetName: String(title).slice(0, 30), header, rows: data });
    audit(ctx, { action: 'EXPORT', entity: 'report', newValue: { title, rows: rows.length } });
    ctx.res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${encodeURIComponent(title)}.xlsx"` });
    ctx.res.end(buf);
    return null;
  });
}
