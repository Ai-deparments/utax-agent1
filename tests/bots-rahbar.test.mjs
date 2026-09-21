/** @utax_rahbar_bot — buyruqlar web servislari bilan bir xil raqam beradi, RBAC web matritsasi bilan bir xil. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createBotHarness } from './helpers/bot-harness.mjs';
import { money, fmt } from '../src/bots/shared/format.mjs';
import { monthOf, today, addMonths } from '../src/core/util.mjs';

let H, ceo, cfo, founder, admin;
before(async () => {
  H = await createBotHarness();
  ceo = H.link('ceo@utax.uz');
  cfo = H.link('cfo@utax.uz');
  founder = H.link('founder@utax.uz');
  admin = H.link('admin@utax.uz');
});
const has = (r, s) => assert.ok(r.text.includes(s), `matnda yo‘q: «${s}»\n---\n${r.text}`);
const cbs = (r) => r.buttons.map((b) => b.callback_data).filter(Boolean);

test('/start — emoji menyu, tezkor ko‘rsatkich, chat uchun buyruqlar (setMyCommands scope=chat)', async () => {
  const r = await H.send('rahbar', ceo, '/start');
  has(r, 'UTAX Rahbar');
  has(r, 'Bosh direktor');
  has(r, money(H.S.reports.treasury().available_cash));
  for (const label of ['📊 Holat', '💰 Pul', '📈 Foyda', '🔮 Prognoz', '👥 Debitorlik', '✅ Tasdiqlash', '🤖 AI takliflari', '📑 Hisobot', '👤 Xodimlar', '🧪 Sifat']) assert.ok(r.button(label), label);
  assert.match(r.button('🌐 Web panel').web_app.url, /tgp=dashboard/);
  const sc = r.method('setMyCommands').at(-1);
  assert.equal(sc.scope.type, 'chat');
  assert.ok(sc.commands.some((c) => c.command === 'holat') && sc.commands.some((c) => c.command === 'xodimlar'));
});

test('/holat — CEO/CFO/FOUNDER: raqamlar reports.dashboard() bilan bir xil', async () => {
  for (const who of [ceo, cfo, founder]) {
    const d = H.S.reports.dashboard();
    const r = await H.send('rahbar', who, '/holat');
    for (const v of [d.kpi.bank_balance, d.kpi.cash_balance, d.kpi.total_cash, d.kpi.available_cash, d.kpi.customer_advances, d.kpi.recognized_revenue, d.kpi.expenses_month, d.kpi.net_profit, d.kpi.accounts_receivable, d.kpi.overdue_receivable]) has(r, money(v));
    has(r, `${d.pending.approvals.n} ta · ${money(d.pending.approvals.s)}`);
    has(r, `${d.pending.unmatched_transactions} ta`);
    assert.deepEqual(cbs(r).filter((c) => c.startsWith('cmd:')), ['cmd:pul', 'cmd:foyda', 'cmd:debitorlik', 'cmd:tasdiqlash', 'cmd:sifat']);
  }
});

test('ADMIN: /holat ishlaydi, lekin ruxsatsiz bo‘lim tugmalari yo‘q; /pul va /hisobot — ruxsat yo‘q', async () => {
  let r = await H.send('rahbar', admin, '/holat');
  has(r, 'Bugungi holat');
  assert.deepEqual(cbs(r).filter((c) => c.startsWith('cmd:')), ['cmd:sifat']);
  r = await H.send('rahbar', admin, '/pul');
  has(r, 'Ruxsat yo‘q');
  has(r, 'Pul boshqaruvi');
  assert.ok(!r.text.includes('ISHLATISH MUMKIN'));
  r = await H.send('rahbar', admin, '/hisobot');
  has(r, 'Ruxsat yo‘q');
  r = await H.send('rahbar', admin, '/start');
  assert.ok(!r.button('💰 Pul') && !r.button('📈 Foyda') && !r.button('📑 Hisobot'));
  assert.ok(r.button('👤 Xodimlar') && r.button('🛰 Agentlar'));
});

test('/pul — bank/kassa hisoblari, rezerv tarkibi va ISHLATISH MUMKIN = reports.treasury()', async () => {
  const t = H.S.reports.treasury();
  const r = await H.send('rahbar', founder, '/pul');
  for (const a of [...t.accounts.bank, ...t.accounts.cash]) { has(r, a.bank_name || a.name); has(r, money(a.balance)); }
  has(r, `ISHLATISH MUMKIN: ${money(t.available_cash)}`);
  for (const v of [t.total_cash, t.restricted_cash, t.reserved.total, t.reserved.safety_reserve, t.safe_withdrawal, t.expected_30d_income, t.expected_30d_expense]) has(r, money(v));
  assert.ok(r.button('🔮 Prognoz'));
});

test('/foyda 2026-08 — P&L = reports.pnl(); ◀️ oldingi oyga (edit), joriy oydan keyinga o‘tmaydi', async () => {
  const p = H.S.reports.pnl({ month: '2026-08' });
  let r = await H.send('rahbar', cfo, '/foyda 2026-08');
  has(r, 'Avgust 2026');
  for (const v of [p.totals.revenue, p.totals.gross, p.totals.operating, p.totals.net, p.previous.net]) has(r, money(v));
  const prev = r.button(/^◀️/);
  assert.equal(prev.callback_data, 'r.pnl:2026-07');
  r = await H.click('rahbar', cfo, prev.callback_data, { messageId: r.last.message_id });
  assert.equal(r.messages[0].method, 'editMessageText');
  has(r, 'Iyul 2026');
  has(r, money(H.S.reports.pnl({ month: '2026-07' }).totals.net));
  const cur = monthOf(today());
  r = await H.click('rahbar', cfo, `r.pnl:${cur}`, { messageId: 7 });
  assert.ok(!cbs(r).includes(`r.pnl:${addMonths(cur, 1)}`), 'kelajak oyi tugmasi bo‘lmasligi kerak');
  r = await H.send('rahbar', cfo, '/foyda xyz');
  has(r, 'Oyni tushunmadim');
});

test('/xizmatlar, /pul_oqimi, /balans, /reja — servis raqamlari bilan bir xil', async () => {
  const sp = H.S.reports.serviceProfitability({ month: '2026-08' });
  let r = await H.send('rahbar', cfo, '/xizmatlar 2026-08');
  for (const row of sp.rows) { has(r, row.name); has(r, money(row.net_profit)); }
  const cf = H.S.reports.cashFlow({ month: '2026-08' });
  r = await H.send('rahbar', cfo, '/pul_oqimi 2026-08');
  for (const v of [cf.opening_cash, cf.closing_cash, cf.total_inflow, cf.total_outflow]) has(r, money(v));
  const b = H.S.reports.balance();
  r = await H.send('rahbar', founder, '/balans');
  for (const v of [b.total_assets, b.total_liabilities, b.equity]) has(r, money(v));
  const pf = H.S.budget.planFact('2026-08');
  r = await H.send('rahbar', ceo, '/reja 2026-08');
  for (const it of pf.items) has(r, money(it.fact));
  for (const name of ['Daromad', 'Xarajat', 'Foyda', 'Pul qoldig‘i', 'Tushum (undiruv)']) has(r, name);
});

test('/prognoz 90 — 3 senariy = forecast.compute(90); r.fc:7 gorizontni almashtiradi', async () => {
  const f = H.S.forecast.compute(90);
  let r = await H.send('rahbar', cfo, '/prognoz 90');
  has(r, 'Prognoz — 90 kun');
  for (const k of ['conservative', 'base', 'optimistic']) has(r, money(f.scenarios[k].projected_cash));
  assert.ok(r.button('• 90 kun •'));
  r = await H.click('rahbar', cfo, 'r.fc:7', { messageId: r.last.message_id });
  has(r, 'Prognoz — 7 kun');
  has(r, money(H.S.forecast.compute(7).scenarios.base.projected_cash));
  r = await H.send('rahbar', cfo, '/prognoz 999');
  has(r, '1–365');
});

test('/debitorlik — summary/aging = servis; filtrlar (muddati o‘tgan / kritik) ro‘yxatni almashtiradi', async () => {
  const s = H.S.receivables.summary();
  let r = await H.send('rahbar', ceo, '/debitorlik');
  for (const v of [s.total_receivable, s.overdue, s.critical, s.expected_7d, s.expected_30d]) has(r, money(v));
  for (const b of H.S.receivables.aging().buckets) has(r, money(b.amount));
  has(r, s.top_debtors[0].client);
  r = await H.click('rahbar', ceo, 'r.ar:overdue', { messageId: r.last.message_id });
  const od = H.S.receivables.list({ filter: 'overdue' });
  has(r, `${od.length} ta`);
  for (const x of od.slice(0, 15)) has(r, `${x.contract_number}:`);
  for (const x of H.S.receivables.list().filter((y) => !(y.overdue_amount > 0))) assert.ok(!r.text.includes(`${x.contract_number}:`), x.contract_number);
  r = await H.click('rahbar', ceo, 'r.ar:critical', { messageId: 9 });
  has(r, 'Kritik');
  for (const x of H.S.receivables.list({ filter: 'critical' })) has(r, `${x.contract_number}:`);
  r = await H.click('rahbar', ceo, 'r.ar:sum', { messageId: 9 });
  has(r, 'Aging');
});

test('/tasdiqlash — navbatdagi so‘rovlar kartalari (umumiy approvals UI)', async () => {
  const u = H.user('cfo@utax.uz');
  const mine = [...H.S.approvals.list({ status: 'PENDING' }, u), ...H.S.approvals.list({ status: 'POSTPONED' }, u)].filter((a) => a.can_act);
  const r = await H.send('rahbar', cfo, '/tasdiqlash');
  has(r, 'Tasdiqlashlar');
  has(r, `${mine.length} ta`);
  assert.ok(mine.length > 0 && cbs(r).some((c) => c.startsWith('apr:ok:')));
});

test('/takliflar — CEO faqat ko‘radi (ai APPROVE yo‘q); CFO bajaradi → EXECUTED + audit; rad etish', async () => {
  const a = H.S.ai.listActions('PROPOSED').find((x) => x.action_type === 'SET_EXPENSE_CATEGORY');
  assert.ok(a, 'seed’da kategoriya taklifi bo‘lishi kerak');
  let r = await H.send('rahbar', ceo, '/takliflar');
  has(r, 'AI takliflari');
  has(r, 'faqat ko‘rish');
  assert.ok(!cbs(r).some((c) => c.startsWith('r.act:')));
  r = await H.click('rahbar', ceo, `r.act:ok:${a.id}`, { messageId: 3 });
  assert.match(r.answers[0].text, /Ruxsat yo‘q/);
  assert.equal(H.S.ai.getAction(a.id).status, 'PROPOSED');

  r = await H.send('rahbar', cfo, '/takliflar');
  const ok = r.buttons.find((b) => b.callback_data === `r.act:ok:${a.id}`);
  assert.ok(ok);
  r = await H.click('rahbar', cfo, ok.callback_data, { messageId: 11 });
  assert.equal(H.S.ai.getAction(a.id).status, 'EXECUTED');
  assert.equal(H.S.expenses.get(a.payload.expense_id).category_id, a.payload.category_id);
  has(r, 'Bajarildi');
  assert.equal(r.answers.at(-1).text, '✅ Bajarildi');
  assert.ok(H.db.get("SELECT id FROM audit_logs WHERE action='AI_ACTION_EXECUTED' AND entity_id=?", a.id));
  r = await H.click('rahbar', cfo, ok.callback_data, { messageId: 11 });
  assert.match(r.answers[0].text, /Allaqachon/);

  const b2 = H.S.ai.listActions('PROPOSED')[0];
  r = await H.click('rahbar', cfo, `r.act:no:${b2.id}`, { messageId: 12 });
  assert.equal(H.S.ai.getAction(b2.id).status, 'REJECTED');
});

test('/agentlar — 14 agent; ▶ agentni ishga tushiradi (last_run_at, audit)', async () => {
  let r = await H.send('rahbar', cfo, '/agentlar');
  const agents = H.S.ai.listAgents();
  assert.equal(agents.length, 14);
  for (const a of agents) has(r, a.name);
  const run = r.buttons.find((b) => b.callback_data === 'r.run:DATA_QUALITY');
  assert.ok(run);
  r = await H.click('rahbar', cfo, run.callback_data, { messageId: 20 });
  has(r, 'ishladi');
  assert.ok(H.db.get("SELECT last_run_at FROM ai_agents WHERE code='DATA_QUALITY'").last_run_at);
  assert.ok(H.db.get("SELECT id FROM audit_logs WHERE action='AGENT_RUN_REQUESTED' AND source='TELEGRAM'"));
  r = await H.click('rahbar', cfo, 'r.run:YOQ_AGENT', { messageId: 20 });
  assert.match(r.answers[0].text, /topilmadi/);
});

test('/hisobot — XLSX fayllar sendDocument bilan, audit EXPORT (TELEGRAM)', async () => {
  let r = await H.send('rahbar', ceo, '/hisobot 2026-08');
  const b = r.button(/Foyda va zarar/);
  assert.equal(b.callback_data, 'r.xls:pnl:2026-08');
  r = await H.click('rahbar', ceo, b.callback_data, { messageId: r.last.message_id });
  assert.equal(r.documents.length, 1);
  assert.equal(r.documents[0].document.name, 'foyda-zarar-2026-08.xlsx');
  assert.ok(r.documents[0].document.size > 500);
  r = await H.click('rahbar', ceo, 'r.xls:ar:now', { messageId: 30 });
  assert.match(r.documents[0].document.name, /^debitorlik-\d{4}-\d{2}-\d{2}\.xlsx$/);
  r = await H.click('rahbar', ceo, 'r.xls:cf:2026-08', { messageId: 30 });
  assert.equal(r.documents[0].document.name, 'pul-oqimi-2026-08.xlsx');
  assert.ok(H.db.all("SELECT id FROM audit_logs WHERE action='EXPORT' AND source='TELEGRAM'").length >= 3);
});

test('/xodimlar — FOUNDER: 🔒 tugmalari (o‘zi va ta’sischisiz), sahifalash; CEO: faqat ko‘rish, soxta callback rad', async () => {
  let r = await H.send('rahbar', founder, '/xodimlar');
  const locks = r.buttons.filter((b) => /^r\.usr:ask:/.test(b.callback_data || ''));
  assert.ok(locks.length > 0);
  const fid = H.user('founder@utax.uz').id;
  assert.ok(!locks.some((b) => b.callback_data.startsWith(`r.usr:ask:${fid}:`)));
  r = await H.click('rahbar', founder, 'r.usr:pg:1', { messageId: 41 });
  has(r, '9.');
  r = await H.send('rahbar', ceo, '/xodimlar');
  has(r, 'Xodimlar');
  assert.ok(!cbs(r).some((c) => /^r\.usr:(ask|do):/.test(c)));
  r = await H.click('rahbar', ceo, `r.usr:do:${H.user('cfo@utax.uz').id}:0:0`, { messageId: 40 });
  assert.match(r.answers[0].text, /Ruxsat yo‘q/);
  assert.equal(H.user('cfo@utax.uz').is_active, 1);
});

test('Kill switch: FOUNDER CEO ni bloklaydi → CEO hech bir botda ishlamaydi; blokdan chiqarish', async () => {
  const H2 = await createBotHarness();
  const f = H2.link('founder@utax.uz'), c = H2.link('ceo@utax.uz');
  const ceoId = H2.user('ceo@utax.uz').id;
  let r = await H2.click('rahbar', f, `r.usr:ask:${ceoId}:0`, { messageId: 50 });
  has(r, 'bloklaysizmi');
  const yes = r.button(/Ha, bloklash/);
  assert.equal(yes.callback_data, `r.usr:do:${ceoId}:0:0`);
  r = await H2.click('rahbar', f, yes.callback_data, { messageId: 50 });
  assert.equal(H2.user('ceo@utax.uz').is_active, 0);
  has(r, 'bloklandi');
  assert.ok(H2.db.get("SELECT id FROM audit_logs WHERE action='USER_BLOCKED' AND entity_id=?", ceoId));
  r = await H2.send('rahbar', c, '/holat');
  has(r, 'bloklangan');
  assert.ok(!r.text.includes('Bugungi holat'));
  r = await H2.send('signal', c, '/start');
  has(r, 'bloklangan');
  r = await H2.click('rahbar', f, `r.usr:do:${ceoId}:1:0`, { messageId: 50 });
  assert.equal(H2.user('ceo@utax.uz').is_active, 1);
  r = await H2.send('rahbar', c, '/holat');
  has(r, 'Bugungi holat');
});

test('O‘zini va ta’sischini bloklab bo‘lmaydi (soxta callback bilan ham)', async () => {
  const fid = H.user('founder@utax.uz').id, aid = H.user('admin@utax.uz').id;
  let r = await H.click('rahbar', admin, `r.usr:do:${aid}:0:0`, { messageId: 60 });
  assert.match(r.answers[0].text, /O‘zingizni bloklay olmaysiz/);
  r = await H.click('rahbar', admin, `r.usr:do:${fid}:0:0`, { messageId: 60 });
  assert.match(r.answers[0].text, /Ta’sischini bloklab bo‘lmaydi/);
  assert.equal(H.user('admin@utax.uz').is_active, 1);
  assert.equal(H.user('founder@utax.uz').is_active, 1);
});

test('EMPLOYEE rahbar botiga kira olmaydi — mos botlar taklif qilinadi', async () => {
  const emp = H.link('employee@utax.uz');
  const r = await H.send('rahbar', emp, '/holat');
  has(r, 'mo‘ljallanmagan');
  has(r, 'utax_sorov_bot');
  assert.ok(!r.text.includes('Bugungi holat'));
});

test('/sifat — reports.dataQuality() bilan bir xil', async () => {
  const dq = H.S.reports.dataQuality();
  const r = await H.send('rahbar', ceo, '/sifat');
  has(r, `<b>${dq.total}</b> ta muammo`);
  for (const i of dq.issues) has(r, i.title);
});

test('Erkin matn — AI moliya yordamchisi: raqam bilan javob + web tugma', async () => {
  const t = H.S.reports.treasury();
  const r = await H.send('rahbar', ceo, 'Bugun qancha pulimiz bor?');
  has(r, fmt(t.available_cash));
  assert.match(r.button(/Web’da ochish/).web_app.url, /tgp=treasury/);
});

test('/yordam — foydalanish namunalari va argumentli buyruqlar', async () => {
  const r = await H.send('rahbar', cfo, '/yordam');
  for (const s of ['/foyda [oy]', '/prognoz [kun]', '/hisobot [oy]', '/prognoz 90', 'Erkin savol']) has(r, s);
  assert.equal(H.errors.length, 0, H.errors.join('\n'));
});
