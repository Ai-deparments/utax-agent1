/**
 * @utax_sorov_bot — barcha xodimlar uchun: xarajat so'rovi, holatini kuzatish, bo'lim tasdig'i,
 * o'z shartnoma/qarzdor/undiruv vazifalari, o'z oyligi va KPI.
 * Web: Xarajatlar → So'rov, Tasdiqlashlar, Shartnomalar, Debitorlik, KPI va oylik — bir xil servislar va RBAC.
 */
import { showApprovals } from '../shared/approvals-ui.mjs';
import { yangi, yangiDialog, yangiCallbacks, DIALOG as YANGI_DIALOG } from './handlers/yangi.mjs';
import { sorovlarim, sorovKartasi } from './handlers/sorovlarim.mjs';
import { shartnomalarim, shartnomaTugma, qarzdorlarim, vazifalarim, vazifaCallbacks, vazifaDialogs } from './handlers/sotuv.mjs';
import { oyligim, kpi, oylikCallbacks } from './handlers/oylik.mjs';
import { startText, helpExtra, faylKutilmagan } from './handlers/start.mjs';

export default {
  key: 'sorov',
  username: 'utax_sorov_bot',
  title: 'UTAX So‘rov',
  about: 'Barcha xodimlar uchun: xarajat so‘rovi yuborish, holatini kuzatish, bo‘lim tasdig‘i, o‘z shartnoma/qarzdor/oylik ma’lumotlari.',
  short: 'UTAX so‘rov boti: xarajat so‘rovi va holati',
  audience: ['FOUNDER', 'CEO', 'CFO', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES', 'DEPARTMENT_HEAD', 'EMPLOYEE', 'ADMIN', 'AUDITOR'],
  commands: [
    { name: 'yangi', desc: 'Yangi xarajat so‘rovi', button: '➕ Yangi so‘rov', usage: '/yangi [summa]', perm: ['expenses', 'CREATE'], run: yangi },
    { name: 'sorovlarim', desc: 'Mening so‘rovlarim va holati', button: '📋 So‘rovlarim', perm: ['expenses', 'VIEW'], run: sorovlarim },
    { name: 'tasdiqlash', desc: 'Bo‘lim so‘rovlarini tasdiqlash', button: '✅ Tasdiqlash', perm: ['approvals', 'APPROVE'], run: (ctx) => showApprovals(ctx, { entityType: 'EXPENSE', title: 'Xarajat so‘rovlari' }) },
    { name: 'shartnomalarim', desc: 'Mening shartnomalarim', button: '📄 Shartnomalarim', perm: ['contracts', 'VIEW'], run: shartnomalarim },
    { name: 'qarzdorlarim', desc: 'Mening qarzdorlarim', button: '👥 Qarzdorlarim', perm: ['receivables', 'VIEW'], run: qarzdorlarim },
    { name: 'vazifalarim', desc: 'Undiruv vazifalarim', button: '📞 Vazifalarim', perm: ['collections', 'VIEW'], run: vazifalarim },
    { name: 'oyligim', desc: 'Mening oyligim', button: '💳 Oyligim', usage: '/oyligim [oy]', run: oyligim },
    { name: 'kpi', desc: 'Mening KPI ko‘rsatkichlarim', button: '📈 KPI', usage: '/kpi [oy]', run: kpi },
  ],
  callbacks: {
    ...yangiCallbacks,
    's.my': { perm: ['expenses', 'VIEW'], run: sorovKartasi },
    's.ct': { perm: ['contracts', 'VIEW'], run: shartnomaTugma },
    ...vazifaCallbacks,
    ...oylikCallbacks,
  },
  dialogs: {
    [YANGI_DIALOG]: yangiDialog,
    ...vazifaDialogs,
  },
  jobs: [],
  startText,
  helpExtra,
  onFile: faylKutilmagan,
};
