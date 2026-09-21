/**
 * @utax_rahbar_bot — rahbariyat boti (FOUNDER, CEO, CFO, ADMIN).
 * Web panel bilan bir xil raqamlar va ruxsatlar: Bosh sahifa, Pul boshqaruvi, P&L, Pul oqimi, Balans, Reja/Fakt, Prognoz,
 * Debitorlik, Tasdiqlashlar, AI moliya, Hisobotlar, Foydalanuvchilar. Erkin matn — AI moliya yordamchisi (default).
 */
import { showApprovals } from '../shared/approvals-ui.mjs';
import { P } from './handlers/common.mjs';
import * as overview from './handlers/overview.mjs';
import * as finance from './handlers/finance.mjs';
import * as debitorlik from './handlers/debitorlik.mjs';
import * as ai from './handlers/ai.mjs';
import * as hisobot from './handlers/hisobot.mjs';
import * as xodimlar from './handlers/xodimlar.mjs';

const byName = (list, name) => list.find((c) => c.name === name);

export default {
  key: 'rahbar',
  username: 'utax_rahbar_bot',
  title: 'UTAX Rahbar',
  about: 'Rahbariyat uchun: pul, foyda, debitorlik va tasdiqlar — web panel bilan bir xil raqamlar.',
  short: 'UTAX rahbariyat boti: pul, foyda, tasdiqlar',
  audience: ['FOUNDER', 'CEO', 'CFO', 'ADMIN'],
  commands: [
    byName(overview.commands, 'holat'),
    byName(overview.commands, 'pul'),
    byName(finance.commands, 'foyda'),
    byName(finance.commands, 'xizmatlar'),
    byName(finance.commands, 'pul_oqimi'),
    byName(finance.commands, 'balans'),
    byName(finance.commands, 'reja'),
    byName(finance.commands, 'prognoz'),
    ...debitorlik.commands,
    { name: 'tasdiqlash', desc: 'Tasdiq kutayotgan so‘rovlar', button: '✅ Tasdiqlash', perm: P.approvals, run: (ctx) => showApprovals(ctx) },
    ...ai.commands,
    ...hisobot.commands,
    ...xodimlar.commands,
    overview.qualityCommand,
  ],
  callbacks: {
    ...finance.callbacks,
    ...debitorlik.callbacks,
    ...ai.callbacks,
    ...hisobot.callbacks,
    ...xodimlar.callbacks,
  },
  dialogs: {},
  jobs: [],
  startText: overview.startText,
  helpExtra: () => [
    '',
    '<b>Misollar:</b>',
    '/foyda avgust · /foyda 2026-08 — oy bo‘yicha foyda va zarar',
    '/prognoz 90 — 90 kunlik pul prognozi',
    '/hisobot o‘tgan oy — Excel hisobotlar',
  ].join('\n'),
};
