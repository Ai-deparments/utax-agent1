/** /holat, /pul, /sifat va /start matni — web: Bosh sahifa, Pul boshqaruvi, Ma'lumot sifati. */
import { esc } from '../../shared/html.mjs';
import { money, pct, date, lines, line, title, muted, bullet, clip, roleLabel, monthLabel, SEVERITY_ICON } from '../../shared/format.mjs';
import { P, delta, cmdIf } from './common.mjs';

const ABOUT = 'Rahbariyat uchun: pul, foyda, debitorlik va tasdiqlar — web panel bilan bir xil raqamlar.';

/** /start — salomlashish + tezkor ko'rsatkichlar (faqat ruxsat bo'lganlari) */
export function startText(ctx) {
  const out = [
    `👋 Assalomu alaykum, <b>${esc(ctx.user.name)}</b>!`,
    `<b>UTAX Rahbar</b> · ${esc(roleLabel(ctx.user.role_code))}`,
    '',
    esc(ABOUT),
  ];
  const quick = [];
  if (ctx.can(...P.treasury)) {
    const t = ctx.S.reports.treasury();
    quick.push(`${line('💰 Ishlatish mumkin', money(t.available_cash))}${t.low_liquidity ? ' ⚠️' : ''}`);
  }
  if (ctx.can(...P.approvals)) {
    const mine = ctx.S.approvals.pendingFor(ctx.user);
    if (mine.length) quick.push(line('✅ Sizning tasdig‘ingizni kutmoqda', `${mine.length} ta · ${money(mine.reduce((s, a) => s + (Number(a.amount) || 0), 0))}`));
  }
  if (quick.length) out.push('', ...quick);
  out.push('', 'Bo‘limni tanlang yoki savolingizni oddiy matn bilan yozing:');
  return lines(out);
}

async function holat(ctx) {
  const d = ctx.S.reports.dashboard(null, ctx.user);
  const k = d.kpi, dl = d.deltas, pd = d.pending;
  const html = lines(
    `${title('📊', 'Bugungi holat')} · ${esc(date(d.as_of))}`,
    '',
    '<b>💰 Pul</b>',
    line('Bank', money(k.bank_balance)) + delta(dl.bank_balance),
    line('Kassa', money(k.cash_balance)) + delta(dl.cash_balance),
    line('Jami pul', money(k.total_cash)) + delta(dl.total_cash),
    line('Mijoz avanslari (cheklangan)', money(k.customer_advances)) + delta(dl.customer_advances),
    line('Rezerv', money(k.reserved)),
    `✅ ${line('Ishlatish mumkin', money(k.available_cash))}`,
    k.low_liquidity ? '⚠️ <b>Likvidlik chegaradan past!</b>' : null,
    '',
    `<b>📅 ${esc(monthLabel(d.month))}</b> <i>(o‘tgan oyga nisbatan)</i>`,
    line('Tan olingan daromad', money(k.recognized_revenue)) + delta(dl.recognized_revenue),
    line('Xarajatlar', money(k.expenses_month)) + delta(dl.expenses_month),
    line('Sof foyda', money(k.net_profit)) + delta(dl.net_profit),
    '',
    '<b>👥 Debitorlik</b>',
    line('Jami', money(k.accounts_receivable)) + delta(dl.accounts_receivable),
    line('Muddati o‘tgan', money(k.overdue_receivable)),
    line('30 kunda kutilayotgan kirim', money(k.expected_income)),
    line('30 kunda kutilayotgan chiqim', money(k.expected_expenses)),
    '',
    '<b>⏳ Diqqat talab qiladi</b>',
    bullet(line('Tasdiq kutmoqda', `${pd.approvals.n} ta · ${money(pd.approvals.s)}`)),
    bullet(line('Xarajat so‘rovlari', `${pd.expense_requests.n} ta · ${money(pd.expense_requests.s)}`)),
    bullet(line('Bog‘lanmagan tranzaksiyalar', `${pd.unmatched_transactions} ta (kirim ${money(pd.unmatched_income_amount)})`)),
    bullet(line('Ma’lumot sifati muammolari', `${pd.data_quality} ta`)),
  );
  return ctx.reply(html, {
    buttons: [
      [cmdIf(ctx, P.treasury, '💰 Pul', 'pul'), cmdIf(ctx, P.pnl, '📈 Foyda', 'foyda')],
      [cmdIf(ctx, P.receivables, '👥 Debitorlik', 'debitorlik'), cmdIf(ctx, P.approvals, '✅ Tasdiqlash', 'tasdiqlash')],
      [cmdIf(ctx, P.dashboard, '🧪 Ma’lumot sifati', 'sifat')],
      [{ text: '🌐 Bosh sahifa', web: 'dashboard' }],
    ],
  });
}

const tail4 = (acc) => { const d = String(acc || '').replace(/\s/g, ''); return d ? ` <i>…${esc(d.slice(-4))}</i>` : ''; };
const cur = (a) => (a.currency && a.currency !== 'UZS' ? ` <i>(${esc(a.currency)})</i>` : '');

async function pul(ctx) {
  const t = ctx.S.reports.treasury();
  const restriction = Number(ctx.settings.get('cash.advance_restriction_pct') ?? 100);
  const bank = t.accounts?.bank || [], cash = t.accounts?.cash || [];
  const html = lines(
    `${title('💰', 'Pul boshqaruvi')} · ${esc(date(t.as_of))}`,
    '',
    '<b>🏦 Bank hisoblari</b>',
    ...(bank.length ? bank.map((a) => bullet(`${esc(a.bank_name)}${tail4(a.account_number)}: <b>${esc(money(a.balance))}</b>${cur(a)}`)) : [muted('Bank hisobi yo‘q')]),
    '<b>💵 Kassalar</b>',
    ...(cash.length ? cash.map((a) => bullet(`${esc(a.name)}: <b>${esc(money(a.balance))}</b>${cur(a)}`)) : [muted('Kassa yo‘q')]),
    '',
    line('Jami pul', money(t.total_cash)),
    `− ${line(`Mijoz avanslari (${pct(restriction, 0)} cheklangan)`, money(t.restricted_cash))}`,
    `− ${line('Rezerv', money(t.reserved.total))}`,
    `    • ${line('Tasdiqlangan, to‘lanmagan xarajatlar', money(t.reserved.approved_unpaid_expenses))}`,
    `    • ${line('Tasdiqlangan oylik', money(t.reserved.pending_payroll))}`,
    `    • ${line('Xavfsizlik rezervi', money(t.reserved.safety_reserve))}`,
    `= ✅ <b>ISHLATISH MUMKIN: ${esc(money(t.available_cash))}</b>`,
    line('Xavfsiz olish mumkin (30 kunlik chiqim hisobga olinganda)', money(t.safe_withdrawal)),
    t.low_liquidity ? '⚠️ <b>Likvidlik chegaradan past!</b>' : null,
    '',
    '<b>📅 Kutilayotgan</b>',
    line('7 kun', `kirim ${money(t.expected_7d_income)} · chiqim ${money(t.expected_7d_expense)}`),
    line('30 kun', `kirim ${money(t.expected_30d_income)} · chiqim ${money(t.expected_30d_expense)}`),
    line('Muddati o‘tgan debitorlik', money(t.overdue_receivable)),
    '',
    muted('Bankdagi pul ≠ daromad ≠ ishlatish mumkin bo‘lgan pul: mijoz avansi xizmat bajarilib akt yopilguncha cheklangan.'),
  );
  return ctx.reply(html, {
    buttons: [
      [cmdIf(ctx, P.forecast, '🔮 Prognoz', 'prognoz'), cmdIf(ctx, P.receivables, '👥 Debitorlik', 'debitorlik')],
      [{ text: '🌐 Pul boshqaruvi', web: 'treasury' }],
    ],
  });
}

const SEV_ORDER = { CRITICAL: 0, WARNING: 1, INFO: 2 };

async function sifat(ctx) {
  const dq = ctx.S.reports.dataQuality();
  const buttons = [[{ text: '🌐 Bosh sahifa', web: 'dashboard' }]];
  if (!dq.total) return ctx.reply(`${title('🧪', 'Ma’lumot sifati')}\n\n✅ Muammo topilmadi.`, { buttons });
  const issues = [...dq.issues].sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3));
  const html = lines(
    `${title('🧪', 'Ma’lumot sifati')}: <b>${dq.total}</b> ta muammo`,
    muted(`Tekshirildi: ${date(dq.checked_at)} · noto‘liq ma’lumot bilan hisobotlar noto‘g‘ri chiqadi`),
    '',
    ...issues.map((it) => lines(
      `${SEVERITY_ICON[it.severity] || '🔵'} <b>${esc(it.title)}</b> — ${it.count} ta`,
      it.items?.length ? `    <i>${esc(clip(it.items.slice(0, 4).map((x) => x.label).join('; '), 200))}${it.count > 4 ? ' …' : ''}</i>` : null,
    )),
  );
  return ctx.reply(html, { buttons });
}

export const commands = [
  { name: 'holat', desc: 'Bugungi moliyaviy holat', button: '📊 Holat', perm: P.dashboard, run: holat },
  { name: 'pul', desc: 'Pul: bank, kassa, avans, rezerv, ishlatish mumkin', button: '💰 Pul', perm: P.treasury, run: pul },
];
export const qualityCommand = { name: 'sifat', desc: 'Ma’lumot sifati muammolari', button: '🧪 Sifat', perm: P.dashboard, run: sifat };
