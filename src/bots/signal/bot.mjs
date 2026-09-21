/**
 * @utax_signal_bot — bildirishnomalar markazi (web: Bildirishnomalar).
 * Barcha notify() lar dispatcher orqali shu botga keladi; bu yerda — qutisi, tarix, sozlamalar (turlar, jim soat) va test.
 */
import { bugun, oqilmagan, tarix, ochish, hammasiniOqish, tarixSahifa } from './handlers/inbox.mjs';
import { sozlama, turniAlmashtirish, hammasiniAlmashtirish, jimSoat } from './handlers/sozlama.mjs';
import { testXabar } from './handlers/test.mjs';
import { startText, helpExtra } from './handlers/start.mjs';

const KORISH = ['notifications', 'VIEW'];
const TAHRIR = ['notifications', 'EDIT'];

export default {
  key: 'signal',
  username: 'utax_signal_bot',
  title: 'UTAX Signal',
  about: 'Bildirishnomalar markazi: to‘lov muddatlari, tasdiqlar, likvidlik, byudjet va boshqa ogohlantirishlar — web panel bilan sinxron.',
  short: 'UTAX bildirishnomalari',
  audience: ['FOUNDER', 'CEO', 'CFO', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES', 'DEPARTMENT_HEAD', 'EMPLOYEE', 'ADMIN', 'AUDITOR'],
  commands: [
    { name: 'bugun', desc: 'Bugungi bildirishnomalar va qisqa holat', button: '📅 Bugun', perm: KORISH, run: bugun },
    { name: 'oqilmagan', desc: 'O‘qilmagan bildirishnomalar', button: '🔔 O‘qilmagan', perm: KORISH, run: oqilmagan },
    { name: 'tarix', desc: 'Bildirishnomalar tarixi', button: '🗂 Tarix', perm: KORISH, run: tarix },
    { name: 'sozlama', desc: 'Qaysi turlar kelsin, jim soatlar', button: '⚙️ Sozlama', perm: TAHRIR, run: sozlama },
    { name: 'test', desc: 'O‘zimga test bildirishnoma', button: '🧪 Test', perm: KORISH, run: testXabar },
  ],
  callbacks: {
    'g.o': { perm: KORISH, run: ochish },
    'g.all': { perm: TAHRIR, run: hammasiniOqish },
    'g.h': { perm: KORISH, run: tarixSahifa },
    'g.t': { perm: TAHRIR, run: turniAlmashtirish },
    'g.ta': { perm: TAHRIR, run: hammasiniAlmashtirish },
    'g.q': { perm: TAHRIR, run: jimSoat },
  },
  dialogs: {},
  jobs: [],
  startText,
  helpExtra,
};
