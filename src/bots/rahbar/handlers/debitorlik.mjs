/** /debitorlik — web: Debitorlik (summary + aging + TOP-10, filtrlar). */
import { esc } from '../../shared/html.mjs';
import { money, lines, line, title, muted, bullet, numbered } from '../../shared/format.mjs';
import { P } from './common.mjs';

const FILTERS = { overdue: '🔴 Muddati o‘tgan', critical: '⚠️ Kritik', 7: '📅 7 kun ichida', 30: '📅 30 kun ichida', today: '📅 Bugun', '60+': '⏰ 60+ kun' };
const MAX_ROWS = 15;

/** Qarzdor qatori — receivables.list() elementi */
function debtorLine(x) {
  const when = x.days_overdue > 0 ? `🔴 ${x.days_overdue} kun o‘tdi` : x.due_date ? `muddat ${x.due_date.split('-').reverse().join('.')}` : 'muddat yo‘q';
  const part = x.overdue_amount > 0 && x.overdue_amount < x.debt ? ` (o‘tgan: ${esc(money(x.overdue_amount))})` : '';
  return `<b>${esc(x.client)}</b> — ${esc(x.contract_number)}: <b>${esc(money(x.debt))}</b>${part} · ${esc(when)}${x.manager ? ` · <i>${esc(x.manager)}</i>` : ''}`;
}

const filterRow = (skip) => ['overdue', 'critical', '7'].filter((k) => k !== skip).map((k) => ({ text: FILTERS[k], cb: `r.ar:${k}` }));

function summaryCard(ctx) {
  const s = ctx.S.receivables.summary();
  const a = ctx.S.receivables.aging();
  const crit = Number(ctx.settings.get('collection.critical_days') || 15);
  const html = lines(
    title('👥', 'Debitorlik'),
    line('Jami', `${money(s.total_receivable)} (${s.count} shartnoma)`),
    line('Muddati o‘tgan', `${money(s.overdue)} (${s.overdue_count} ta)`),
    line(`Kritik (${crit}+ kun)`, `${money(s.critical)} (${s.critical_count} ta)`),
    line('Kutilayotgan', `7 kun ${money(s.expected_7d)} · 30 kun ${money(s.expected_30d)}`),
    line('Ochiq undiruv vazifalari', `${s.open_tasks} ta`),
    '',
    '<b>📊 Aging</b>',
    ...a.buckets.map((b) => bullet(line(b.label, `${money(b.amount)} (${b.count})`))),
    '',
    `<b>🏆 TOP-${Math.min(10, s.top_debtors.length)} qarzdor</b>`,
    s.top_debtors.length ? numbered(s.top_debtors.slice(0, 10), debtorLine) : muted('Qarzdorlik yo‘q ✅'),
  );
  return { html, buttons: [filterRow(), [{ text: '🌐 Debitorlik', web: 'receivables' }]] };
}

function filterCard(ctx, f) {
  const rows = ctx.S.receivables.list({ filter: f });
  const sum = (fn) => rows.reduce((acc, x) => acc + (Number(fn(x)) || 0), 0);
  const html = lines(
    title('👥', `Debitorlik — ${FILTERS[f]}`),
    line('Shartnomalar', `${rows.length} ta`),
    line('Qarz', money(sum((x) => x.debt))),
    ['overdue', 'critical', '60+'].includes(f) ? line('Muddati o‘tgan qism', money(sum((x) => x.overdue_amount))) : null,
    f === '7' ? line('7 kunda to‘lanishi kerak', money(sum((x) => x.due_7d))) : null,
    f === '30' ? line('30 kunda to‘lanishi kerak', money(sum((x) => x.due_30d))) : null,
    f === 'today' ? line('Bugun to‘lanishi kerak', money(sum((x) => x.due_today))) : null,
    '',
    rows.length ? numbered(rows.slice(0, MAX_ROWS), debtorLine) : '✅ Bu filtr bo‘yicha qarzdor yo‘q.',
    rows.length > MAX_ROWS ? muted(`… yana ${rows.length - MAX_ROWS} ta — web panelda`) : null,
  );
  return { html, buttons: [filterRow(f), [{ text: '⬅️ Umumiy', cb: 'r.ar:sum' }], [{ text: '🌐 Debitorlik', web: 'receivables' }]] };
}

async function debitorlik(ctx) {
  const c = summaryCard(ctx);
  return ctx.reply(c.html, { buttons: c.buttons });
}

export const commands = [
  { name: 'debitorlik', desc: 'Debitorlik: aging va TOP-10 qarzdor', button: '👥 Debitorlik', perm: P.receivables, run: debitorlik },
];

export const callbacks = {
  'r.ar': {
    perm: P.receivables,
    run(ctx) {
      const f = String(ctx.cbArgs[0] || 'sum');
      const c = FILTERS[f] ? filterCard(ctx, f) : summaryCard(ctx);
      return ctx.edit(c.html, { buttons: c.buttons });
    },
  },
};
