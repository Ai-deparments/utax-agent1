import { nowIso } from './util.mjs';

/** Audit log — moliyaviy tarix o'chirilmaydi; har muhim action shu yerdan o'tadi. */
export function createAudit(db) {
  return function audit(ctx, { action, entity, entityId, oldValue, newValue, approvalId, aiAgentCode }) {
    const u = ctx?.user || null;
    db.run(
      `INSERT INTO audit_logs (user_id, role, action, entity, entity_id, old_value, new_value, ts, ip, source, approval_id, ai_agent_code)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      u?.id ?? null, u?.role_code ?? (aiAgentCode ? 'AI_AGENT' : 'SYSTEM'), action, entity, entityId ?? null,
      oldValue === undefined ? null : JSON.stringify(oldValue), newValue === undefined ? null : JSON.stringify(newValue),
      nowIso(), ctx?.ip ?? null, ctx?.source ?? 'SYSTEM', approvalId ?? null, aiAgentCode ?? null
    );
  };
}
