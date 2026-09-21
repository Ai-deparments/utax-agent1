import { forbidden } from './http.mjs';

export const ACTIONS = ['VIEW', 'CREATE', 'EDIT', 'APPROVE', 'REJECT', 'DELETE', 'EXPORT'];
export const RESOURCES = [
  'dashboard', 'treasury', 'contracts', 'transactions', 'reconciliation', 'revenue', 'receivables', 'collections',
  'expenses', 'approvals', 'pnl', 'cashflow', 'balance', 'planfact', 'forecast', 'payroll', 'ai', 'reports',
  'integrations', 'notifications', 'audit', 'settings', 'users',
];
export const ROLES = [
  { code: 'FOUNDER', name: 'Founder / Owner', rank: 100 },
  { code: 'CEO', name: 'CEO', rank: 90 },
  { code: 'CFO', name: 'CFO / Finance Director', rank: 85 },
  { code: 'FINANCE_MANAGER', name: 'Finance Manager', rank: 70 },
  { code: 'ACCOUNTANT', name: 'Accountant', rank: 60 },
  { code: 'SALES', name: 'Sales', rank: 40 },
  { code: 'DEPARTMENT_HEAD', name: 'Department Head', rank: 50 },
  { code: 'EMPLOYEE', name: 'Employee', rank: 10 },
  { code: 'AUDITOR', name: 'Auditor (read-only)', rank: 30 },
  { code: 'ADMIN', name: 'System Admin', rank: 95 },
  { code: 'AI_AGENT', name: 'AI Agent (service)', rank: 5 },
];

const ALL = ACTIONS;
const RO = ['VIEW', 'EXPORT'];
const VCE = ['VIEW', 'CREATE', 'EDIT', 'EXPORT'];
const VCEA = ['VIEW', 'CREATE', 'EDIT', 'APPROVE', 'REJECT', 'EXPORT'];

/** Boshlang'ich matritsa — admin panelda o'zgartiriladi (DB permissions jadvali) */
export const DEFAULT_MATRIX = {
  FOUNDER: Object.fromEntries(RESOURCES.map((r) => [r, ALL])),
  CEO: {
    dashboard: RO, treasury: RO, contracts: RO, transactions: RO, reconciliation: RO, revenue: ['VIEW', 'APPROVE', 'REJECT', 'EXPORT'],
    receivables: RO, collections: RO, expenses: ['VIEW', 'APPROVE', 'REJECT', 'EXPORT'], approvals: ['VIEW', 'APPROVE', 'REJECT'],
    pnl: RO, cashflow: RO, balance: RO, planfact: VCE, forecast: RO, payroll: ['VIEW', 'APPROVE', 'REJECT', 'EXPORT'],
    ai: ['VIEW', 'CREATE'], reports: RO, integrations: ['VIEW'], notifications: ['VIEW', 'EDIT'], audit: RO, settings: ['VIEW'], users: ['VIEW'],
  },
  CFO: {
    dashboard: RO, treasury: VCE, contracts: VCEA, transactions: VCEA, reconciliation: VCEA, revenue: VCEA,
    receivables: VCE, collections: VCE, expenses: VCEA, approvals: ['VIEW', 'APPROVE', 'REJECT'], pnl: RO, cashflow: RO, balance: RO,
    planfact: VCE, forecast: VCE, payroll: VCEA, ai: ['VIEW', 'CREATE', 'APPROVE', 'REJECT'], reports: RO, integrations: VCE,
    notifications: ['VIEW', 'EDIT'], audit: RO, settings: ['VIEW', 'EDIT'], users: ['VIEW'],
  },
  FINANCE_MANAGER: {
    dashboard: RO, treasury: RO, contracts: VCE, transactions: VCE, reconciliation: VCEA, revenue: VCE, receivables: VCE,
    collections: VCE, expenses: VCEA, approvals: ['VIEW', 'APPROVE', 'REJECT'], pnl: RO, cashflow: RO, balance: RO, planfact: VCE,
    forecast: RO, payroll: VCE, ai: ['VIEW', 'CREATE'], reports: RO, integrations: VCE, notifications: ['VIEW', 'EDIT'], audit: ['VIEW'], settings: ['VIEW'], users: ['VIEW'],
  },
  ACCOUNTANT: {
    dashboard: ['VIEW'], treasury: RO, contracts: RO, transactions: VCE, reconciliation: VCEA, revenue: RO, receivables: RO,
    collections: ['VIEW'], expenses: VCE, approvals: ['VIEW'], pnl: RO, cashflow: RO, balance: RO, planfact: RO, forecast: ['VIEW'],
    payroll: VCE, ai: ['VIEW', 'CREATE'], reports: RO, integrations: ['VIEW', 'EDIT'], notifications: ['VIEW', 'EDIT'], audit: ['VIEW'], settings: ['VIEW'], users: ['VIEW'],
  },
  SALES: {
    dashboard: ['VIEW'], contracts: VCE, receivables: ['VIEW'], collections: ['VIEW', 'EDIT'], expenses: ['VIEW', 'CREATE'],
    approvals: ['VIEW'], ai: ['VIEW', 'CREATE'], notifications: ['VIEW', 'EDIT'], users: ['VIEW'],
  },
  DEPARTMENT_HEAD: {
    dashboard: ['VIEW'], contracts: ['VIEW'], expenses: ['VIEW', 'CREATE', 'EDIT', 'APPROVE', 'REJECT'], approvals: ['VIEW', 'APPROVE', 'REJECT'],
    payroll: ['VIEW', 'CREATE', 'EDIT', 'APPROVE'], planfact: ['VIEW'], ai: ['VIEW', 'CREATE'], notifications: ['VIEW', 'EDIT'], users: ['VIEW'],
  },
  EMPLOYEE: { expenses: ['VIEW', 'CREATE'], approvals: ['VIEW'], notifications: ['VIEW', 'EDIT'], ai: ['VIEW', 'CREATE'], users: ['VIEW'] },
  AUDITOR: Object.fromEntries(RESOURCES.map((r) => [r, RO])),
  ADMIN: { dashboard: ['VIEW'], settings: ALL, users: ALL, integrations: ALL, audit: RO, notifications: ['VIEW', 'EDIT'], ai: ['VIEW', 'CREATE', 'EDIT'], reports: ['VIEW'] },
  AI_AGENT: {
    dashboard: ['VIEW'], treasury: ['VIEW'], contracts: ['VIEW'], transactions: ['VIEW'], reconciliation: ['VIEW', 'CREATE'], revenue: ['VIEW'],
    receivables: ['VIEW'], collections: ['VIEW', 'CREATE'], expenses: ['VIEW'], approvals: ['VIEW'], pnl: ['VIEW'], cashflow: ['VIEW'],
    balance: ['VIEW'], planfact: ['VIEW'], forecast: ['VIEW', 'CREATE'], payroll: ['VIEW'], ai: ['VIEW', 'CREATE'], reports: ['VIEW'], notifications: ['CREATE'],
  },
};

/** Ruxsat matritsasi (DB'dan) — keshlangan, o'zgarganda reload */
export function createRbac(db) {
  let cache = null;
  const load = () => {
    const m = new Map();
    for (const r of db.all('SELECT role_code, resource, action FROM permissions')) {
      m.add ? null : null;
      const k = `${r.role_code}:${r.resource}`;
      if (!m.has(k)) m.set(k, new Set());
      m.get(k).add(r.action);
    }
    cache = m;
  };
  return {
    reload: load,
    can(user, resource, action) {
      if (!user) return false;
      if (!cache) load();
      const s = cache.get(`${user.role_code}:${resource}`);
      return !!(s && s.has(action));
    },
    require(user, resource, action) {
      if (!this.can(user, resource, action)) throw forbidden(`Ruxsat yo‘q: ${resource}.${action}`);
    },
    matrix() {
      if (!cache) load();
      const out = {};
      for (const [k, set] of cache) {
        const [role, res] = k.split(':');
        out[role] ??= {};
        out[role][res] = [...set];
      }
      return out;
    },
    seedDefaults() {
      db.tx(() => {
        for (const r of ROLES) db.run('INSERT OR IGNORE INTO roles (code,name,rank) VALUES (?,?,?)', r.code, r.name, r.rank);
        const n = db.get('SELECT COUNT(*) c FROM permissions').c;
        if (n === 0) {
          for (const [role, res] of Object.entries(DEFAULT_MATRIX))
            for (const [resource, actions] of Object.entries(res))
              for (const a of actions) db.run('INSERT OR IGNORE INTO permissions (role_code,resource,action) VALUES (?,?,?)', role, resource, a);
        }
      });
      load();
    },
  };
}
