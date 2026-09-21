/**
 * RBAC xavfsizlik tuzatishlari (bot = web oynasi): AI propose_action ruxsati va muallifi, o'z so'rovini tasdiqlash taqiqi,
 * tasdiq/xarajat kartalari scope'i, SALES debitorlik scope'i (AI + web), signal /test ruxsati. Tarmoqsiz (faqat 127.0.0.1 test serveri).
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createBotHarness } from './helpers/bot-harness.mjs';
import { createServer } from '../src/server.mjs';

let H, S, db, server, base;
const ctxOf = (email, source = 'TEST') => ({ user: H.user(email), ip: '127.0.0.1', source });
const aiCount = () => db.get('SELECT COUNT(*) n FROM ai_actions').n;
/** Soxta LLM: bitta tool chaqiradi va natijasini saqlaydi; berilgan tool nomlari ham yoziladi */
function toolCaller(name, args) {
  const seen = { tools: null, out: undefined };
  return { seen, llm: { enabled: true, async chat(req) { seen.tools = req.tools.map((t) => t); seen.out = await req.runTool(name, args); return { text: 'ok', provider: 'fake' }; } } };
}
async function chatTool(email, name, args) {
  const { seen, llm } = toolCaller(name, args);
  S.ai.useLlm(llm);
  await S.ai.chat('taklif', ctxOf(email), { channel: 'WEB', bot: 'web' });
  return seen;
}
const tokens = new Map();
async function login(email) {
  if (!tokens.has(email)) {
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Utax2026!' }) });
    const j = await res.json();
    assert.ok(j.access_token, `login: ${email}`);
    tokens.set(email, j.access_token);
  }
  return tokens.get(email);
}
async function api(email, path, { method = 'GET', body } = {}) {
  const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${await login(email)}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const kbOf = (call) => (call?.params?.reply_markup?.inline_keyboard || []).flat();
/** Faqat shu chatga ketgan xabarlar (bir update ichida boshqa foydalanuvchilarga bildirishnoma ham yetkazilishi mumkin) */
const toChat = (r, tgId) => r.messages.filter((m) => String(m.chat_id) === String(tgId));
const textTo = (r, tgId) => toChat(r, tgId).map((m) => m.text).join('\n---\n');
const buttonsTo = (r, tgId) => toChat(r, tgId).flatMap((m) => (m.reply_markup?.inline_keyboard || []).flat());

before(async () => {
  H = await createBotHarness();
  S = H.S; db = H.db;
  server = createServer(H.app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { S.ai.useLlm(undefined); await new Promise((r) => server.close(r)); });
beforeEach(() => { S.ai.useLlm(undefined); H.app.settings.set('ai.allow_llm', true); });

// ---------------- 1) propose_action: faqat amalning web ruxsati bilan; muallif ko'rinadi ----------------
const revenueArgs = () => {
  const c = db.get("SELECT id, contract_number FROM contracts WHERE contract_status NOT IN ('CANCELLED','CLOSED','DRAFT') ORDER BY id LIMIT 1");
  return { action_type: 'RECOGNIZE_REVENUE', entity_type: 'contract', entity_id: c.id, title: `${c.contract_number}: daromad tan olinsin`, payload: { contract_id: c.id, amount: 1000000, method: 'MILESTONE' }, confidence: 95 };
};

test('propose_action: EMPLOYEE va SALES — tool berilmaydi, chaqirilsa ham rad; ai_actions yozuvi yaratilmaydi', async () => {
  for (const email of ['employee@utax.uz', 'sales@utax.uz']) {
    const n0 = aiCount();
    const seen = await chatTool(email, 'propose_action', revenueArgs());
    assert.ok(!seen.tools.some((t) => t.name === 'propose_action'), `${email}: propose_action LLM ga berilmaydi`);
    assert.ok(seen.out?.error, `${email}: tool chaqiruvi xato bilan qaytadi`);
    assert.equal(aiCount(), n0, `${email}: taklif yaratilmadi`);
    // Servis darajasida ham (boshqa kanal chaqirsa) — 403
    assert.throws(() => S.ai.proposeFromChat(revenueArgs(), ctxOf(email)), (e) => e.status === 403);
    assert.equal(aiCount(), n0);
  }
});

test('propose_action: har amal turi o‘z web ruxsatini talab qiladi; ro‘yxatda yo‘q tur (FOUNDER ham) — rad', async () => {
  // DEPARTMENT_HEAD: faqat expenses EDIT → SET_EXPENSE_CATEGORY; daromad tan olish — yo'q
  const n0 = aiCount();
  let seen = await chatTool('head.marketing@utax.uz', 'propose_action', revenueArgs());
  const tool = seen.tools.find((t) => t.name === 'propose_action');
  assert.ok(tool, 'bo‘lim rahbarida kamida bitta ruxsatli tur bor');
  assert.match(tool.description, /action_type: SET_EXPENSE_CATEGORY$/, 'tavsifda faqat ruxsat etilgan turlar');
  assert.match(seen.out.error, /RECOGNIZE_REVENUE.*ruxsati kerak/);
  assert.equal(aiCount(), n0);
  // ACCOUNTANT: bog'lash (reconciliation APPROVE) bor, daromad yaratish (revenue CREATE) yo'q
  seen = await chatTool('accountant@utax.uz', 'propose_action', revenueArgs());
  assert.match(seen.tools.find((t) => t.name === 'propose_action').description, /MATCH_TRANSACTION \| SET_EXPENSE_CATEGORY \| FLAG_ANOMALY$/);
  assert.ok(seen.out.error);
  assert.equal(aiCount(), n0);
  // Ro'yxatda yo'q tur — FOUNDER (hamma ruxsat) uchun ham 400
  assert.throws(() => S.ai.proposeFromChat({ action_type: 'COMPUTE_PAYROLL', title: 'Oylik hisoblansin', payload: { period: '2026-08' } }, ctxOf('founder@utax.uz')), (e) => e.status === 400);
  assert.throws(() => S.ai.proposeFromChat({ action_type: 'REVIEW_CONTRACT', title: 'x' }, ctxOf('founder@utax.uz')), (e) => e.status === 400);
  // AI agent konteksti chat taklifini yubora olmaydi
  assert.throws(() => S.ai.proposeFromChat(revenueArgs(), S.ai.agentCtx('CFO')), (e) => e.status === 403);
  assert.equal(aiCount(), n0);
});

test('propose_action: agent_code argumentdan olinmaydi; kim yuborgani payload/audit/sarlavhada; rahbar /takliflar kartasida ko‘rinadi', async () => {
  const fm = H.user('finance@utax.uz');
  const e = db.get("SELECT id FROM expenses WHERE reversed_at IS NULL ORDER BY id LIMIT 1");
  const cat = db.get('SELECT id FROM expense_categories WHERE is_active=1 ORDER BY id LIMIT 1');
  const seen = await chatTool('finance@utax.uz', 'propose_action', {
    action_type: 'set_expense_category', agent_code: 'RECONCILIATION', entity_type: 'expense', entity_id: e.id, title: 'Xarajat kategoriyasini to‘g‘rilash', confidence: 88,
    payload: { expense_id: e.id, category_id: cat.id, proposed_by: { user_id: 999, name: 'Soxta CFO' } },
  });
  assert.equal(seen.out.status, 'PROPOSED');
  const row = db.get('SELECT * FROM ai_actions WHERE id=?', seen.out.id);
  assert.equal(row.agent_code, 'CFO', 'agent_code server belgilaydi (LLM argumenti e’tiborsiz)');
  assert.equal(row.action_type, 'SET_EXPENSE_CATEGORY');
  const p = JSON.parse(row.payload);
  assert.deepEqual({ id: p.proposed_by.user_id, name: p.proposed_by.name, via: p.proposed_by.via }, { id: fm.id, name: fm.name, via: 'AI_CHAT' }, 'soxta proposed_by almashtirildi');
  assert.equal(p.expense_id, e.id);
  assert.match(row.title, new RegExp(`Taklif qilgan: ${fm.name} \\(AI chat orqali\\)$`));
  const au = db.get("SELECT * FROM audit_logs WHERE action='AI_PROPOSED' AND entity='ai_action' AND entity_id=?", row.id);
  assert.equal(au.user_id, fm.id, 'audit — taklif qilgan foydalanuvchi nomidan');
  assert.equal(JSON.parse(au.new_value).proposed_by.user_id, fm.id);
  // CFO rahbar botda kartani ko'radi — muallif bilan
  const cfo = H.link('cfo@utax.uz');
  const r = await H.send('rahbar', cfo, '/takliflar');
  const card = r.texts.find((t) => t.includes(`#${row.id} `));
  assert.ok(card, 'taklif kartasi bor');
  assert.ok(card.includes(`Taklif qilgan: ${fm.name} (AI chat orqali)`), card);
});

// ---------------- 2) o'z so'rovini o'zi tasdiqlay olmaydi (web + botlar, bitta canAct) ----------------
test('o‘z so‘rovi: bo‘lim rahbari — signalda tugma yo‘q, apr:ok rad, servis/web 403; CEO (ACT_AS) xabardor va tasdiqlaydi', async () => {
  const headEmail = 'head.marketing@utax.uz';
  const head = H.link(headEmail); H.started('signal', headEmail);
  const before = H.tg.calls.length;
  const e = S.expenses.request({ amount: 4900000, purpose: 'Shaxsiy noutbuk (o‘z so‘rovi)' }, ctxOf(headEmail, 'TELEGRAM'));
  await H.app.bots.flush();
  const sig = H.tg.calls.slice(before).filter((c) => c.method === 'sendMessage' && String(c.params.chat_id) === String(head));
  assert.ok(sig.length, 'bo‘lim rahbariga bildirishnoma keldi');
  assert.ok(!sig.some((c) => kbOf(c).some((b) => /^apr:(ok|no):/.test(b.callback_data || ''))), 'o‘z so‘roviga ✅/❌ tugmasi yo‘q');

  const a = S.approvals.getFor(e.approval_id, H.user(headEmail));
  assert.equal(a.is_mine, true);
  assert.equal(a.can_act, false);
  const r = await H.click('signal', head, `apr:ok:${e.approval_id}`);
  assert.match(r.answers[0].text, /O‘z so‘rovingizni o‘zingiz tasdiqlay olmaysiz/);
  assert.ok(!r.buttons.some((b) => /^apr:ok:/.test(b.callback_data || '')), 'yangilangan kartada ham tugma yo‘q');
  assert.throws(() => S.approvals.decide(e.approval_id, 'APPROVE', ctxOf(headEmail)), (x) => x.status === 403);
  assert.throws(() => S.approvals.decide(e.approval_id, 'REJECT', ctxOf(headEmail), 'o‘zim'), (x) => x.status === 403);
  const w = await api(headEmail, `/api/approvals/${e.approval_id}/approve`, { method: 'POST', body: {} });
  assert.equal(w.status, 403, 'web ham xuddi shu qoida');
  const wd = await api(headEmail, `/api/approvals/${e.approval_id}`);
  assert.equal(wd.status, 200);
  assert.equal(wd.body.is_mine, true);
  assert.equal(wd.body.can_act, false);
  assert.equal(db.get('SELECT status FROM expenses WHERE id=?', e.id).status, 'PENDING');

  // Zanjir jim to'xtamaydi: qadam egasi so'rovchining o'zi → ACT_AS rollari (CEO, FOUNDER) ham xabardor
  for (const email of ['ceo@utax.uz', 'founder@utax.uz']) {
    assert.ok(db.get("SELECT id FROM notifications WHERE user_id=? AND type='APPROVAL_WAITING' AND entity_type='approval' AND entity_id=? AND channel='CRM'", H.user(email).id, e.approval_id), `${email} xabardor`);
  }
  // Oddiy holatda (xodim so'rovi) eskalatsiya yo'q — faqat bo'lim rahbari
  const e2 = S.expenses.request({ amount: 1200000, purpose: 'Kanselyariya' }, ctxOf('employee@utax.uz'));
  assert.equal(db.get("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND type='APPROVAL_WAITING' AND entity_id=?", H.user('ceo@utax.uz').id, e2.approval_id).n, 0);
  assert.equal(S.approvals.getFor(e2.approval_id, H.user(headEmail)).can_act, true, 'boshqaning so‘rovi — rahbar navbatida');

  const ceo = ctxOf('ceo@utax.uz');
  assert.equal(S.approvals.getFor(e.approval_id, ceo.user).can_act, true);
  const done = S.approvals.decide(e.approval_id, 'APPROVE', ceo, 'OK');
  assert.equal(done.status, 'APPROVED');
  assert.equal(db.get('SELECT status, approver_id FROM expenses WHERE id=?', e.id).approver_id, ceo.user.id);
});

test('o‘z so‘rovi: FOUNDER ham tasdiqlay olmaydi; /tasdiqlash ro‘yxatida va AI "tasdiqla" niyatida chiqmaydi', async () => {
  const f = ctxOf('founder@utax.uz');
  const e = S.expenses.request({ amount: 2345678, purpose: 'Ta’sischi xarajati' }, f);
  const a = S.approvals.getFor(e.approval_id, f.user);
  assert.equal(a.can_act, false);
  assert.ok(!S.approvals.pendingFor(f.user).some((x) => x.id === e.approval_id));
  assert.throws(() => S.approvals.decide(e.approval_id, 'APPROVE', f), (x) => x.status === 403);
  const r = S.ai.route('2 345 678 so‘mlik so‘rovni tasdiqla', f);
  assert.ok(!r.confirm, 'AI tasdiqlash tugmasi berilmaydi');
  const fo = H.link('founder@utax.uz');
  const t = await H.send('rahbar', fo, '/tasdiqlash');
  assert.ok(toChat(t, fo).length, 'ro‘yxat yuborildi');
  assert.ok(!buttonsTo(t, fo).some((b) => b.callback_data === `apr:ok:${e.approval_id}`), 'o‘z so‘rovi FOUNDER navbatida emas');
  // boshqa tasdiqlovchi (CEO — ACT_AS DEPARTMENT_HEAD) uchun ochiq
  assert.equal(S.approvals.getFor(e.approval_id, H.user('ceo@utax.uz')).can_act, true);
});

// ---------------- 3) apr:view va web detal scope'i ----------------
test('apr:view: EMPLOYEE/SALES boshqaning tasdiq kartasini ocha olmaydi ("topilmadi"), o‘zinikini ochadi; web GET /api/approvals/:id xuddi shunday', async () => {
  const secret = S.expenses.request({ amount: 3200000, purpose: 'Maxfiy: server litsenziyasi', counterparty: 'Secret Vendor LLC' }, ctxOf('head.it@utax.uz'));
  const own = S.expenses.request({ amount: 800000, purpose: 'Mening kanselyariyam' }, ctxOf('employee@utax.uz'));
  for (const email of ['employee@utax.uz', 'sales@utax.uz']) {
    const tg = H.link(email);
    const r = await H.click('sorov', tg, `apr:view:${secret.approval_id}`);
    assert.equal(r.answers[0].text, 'So‘rov topilmadi', email);
    const got = textTo(r, tg);
    assert.ok(!got.includes('Secret Vendor') && !got.includes('Maxfiy'), `${email}: karta ochilmadi: ${got}`);
    assert.equal(S.approvals.getFor(secret.approval_id, H.user(email)), null);
    // Hech bir boshqa kishining approval'i ochilmaydi (enumeratsiya)
    let seen = 0;
    for (const { id } of db.all('SELECT id FROM approvals WHERE requested_by IS NULL OR requested_by<>?', H.user(email).id)) { const x = await H.click('sorov', tg, `apr:view:${id}`); if (/So‘ragan|Summa/.test(textTo(x, tg))) seen++; }
    assert.equal(seen, 0, `${email}: boshqalarning kartalari yopiq`);
    assert.equal((await api(email, `/api/approvals/${secret.approval_id}`)).status, 404, `${email}: web detal ham 404`);
    // Rad etish/kechiktirish tugmalari ham (boshqa kartaga) ishlamaydi
    assert.equal((await H.click('sorov', tg, `apr:no:${secret.approval_id}`)).answers[0].text, 'So‘rov topilmadi');
  }
  const emp = H.link('employee@utax.uz');
  const mine = await H.click('sorov', emp, `apr:view:${own.approval_id}`);
  assert.match(mine.text, /Mening kanselyariyam/);
  assert.match(mine.text, /Bu sizning so‘rovingiz/);
  const w = await api('employee@utax.uz', `/api/approvals/${own.approval_id}`);
  assert.equal(w.status, 200);
  assert.equal(w.body.is_mine, true);
  // Tasdiqlovchi rollar uchun o'zgarmagan
  assert.equal((await api('cfo@utax.uz', `/api/approvals/${secret.approval_id}`)).status, 200);
});

test('xarajat kartasi: GET /api/expenses/:id va bot kartasi — ro‘yxat scope’i (xodim — o‘ziniki, bo‘lim rahbari — bo‘limi yoki o‘zi)', async () => {
  const it = S.expenses.request({ amount: 2100000, purpose: 'IT: maxfiy litsenziya', counterparty: 'Hidden Vendor LLC' }, ctxOf('head.it@utax.uz'));
  const empOwn = S.expenses.request({ amount: 450000, purpose: 'Xodim: taksi' }, ctxOf('employee@utax.uz'));
  const cases = [
    ['employee@utax.uz', it.id, 404], ['employee@utax.uz', empOwn.id, 200],
    ['head.marketing@utax.uz', it.id, 404], ['head.marketing@utax.uz', empOwn.id, 200], // xodim Marketing bo'limida
    ['head.it@utax.uz', it.id, 200], ['cfo@utax.uz', it.id, 200],
  ];
  for (const [email, id, status] of cases) {
    const r = await api(email, `/api/expenses/${id}`);
    assert.equal(r.status, status, `${email} → expense #${id}`);
    assert.equal(!!S.expenses.getFor(id, H.user(email)), status === 200);
    // ro'yxat bilan bir xil
    assert.equal(S.expenses.list({}, H.user(email)).some((x) => x.id === id), status === 200, `${email}: list bilan mos`);
  }
  // Bo'lim rahbari boshqa bo'lim tasdiq kartasini (web ro'yxatidagi kabi) ko'radi, lekin xarajat tafsilotlari (kontragent) yopiq
  const hm = H.link('head.marketing@utax.uz');
  const card = await H.click('sorov', hm, `apr:view:${it.approval_id}`);
  assert.match(card.text, /IT: maxfiy litsenziya/);
  assert.ok(!card.text.includes('Hidden Vendor'), 'kontragent ko‘rinmaydi');
  const hi = H.link('head.it@utax.uz');
  assert.match((await H.click('sorov', hi, `apr:view:${it.approval_id}`)).text, /Hidden Vendor LLC/);
});

// ---------------- 4) SALES — debitorlik faqat o'z mijozlari (AI + web) ----------------
test('SALES: AI qoidalari va tool’lar faqat o‘z shartnomalari qarzini beradi (boshqa sotuvchiniki yo‘q)', async () => {
  const sales = H.user('sales@utax.uz');
  const other = db.all('SELECT contract_number FROM contracts WHERE manager_user_id<>?', sales.id).map((x) => x.contract_number);
  const ownRows = S.receivables.list({ manager_user_id: sales.id });
  assert.ok(ownRows.length && other.length, 'test ma’lumoti: ikkala sotuvchida ham shartnoma bor');
  S.ai.useLlm(null);
  const tg = H.link('sales@utax.uz');
  for (const q of ['Kimlar bizdan qarzdor?', 'Qaysi qarzdorlik muddati o‘tgan?', 'Keyingi 30 kunda qancha pul tushishi kerak?']) {
    const r = await H.send('sorov', tg, q);
    const leaked = other.filter((n) => r.text.includes(n));
    assert.deepEqual(leaked, [], `${q}: boshqa sotuvchi shartnomalari`);
    const x = S.ai.route(q, { user: sales });
    assert.ok(['DEBTORS', 'OVERDUE', 'EXPECTED_INCOME'].includes(x.intent), q);
    assert.ok(x.data.rows.every((row) => row.manager_user_id === sales.id), `${q}: jadval faqat o‘ziniki`);
  }
  const d = S.ai.route('Kimlar bizdan qarzdor?', { user: sales });
  const own = S.receivables.summary(undefined, { manager_user_id: sales.id });
  assert.match(d.answer, new RegExp(`\\(${own.count} shartnoma\\)`), 'jami ham o‘z shartnomalari bo‘yicha');
  // LLM tool'lari (to'g'ridan-to'g'ri run — niqoblashsiz)
  const ctx = { user: sales };
  const rcv = S.ai.TOOLS.find((t) => t.name === 'get_receivables').run({}, ctx);
  assert.ok(rcv.qarzdorlar.length && rcv.qarzdorlar.every((x) => x.menejer === sales.name));
  assert.equal(rcv.xulosa.total_receivable, own.total_receivable);
  const dash = S.ai.TOOLS.find((t) => t.name === 'get_dashboard').run({}, ctx);
  const ownClients = new Set(ownRows.map((x) => x.client));
  assert.ok(dash.top_qarzdorlar.length && dash.top_qarzdorlar.every((x) => ownClients.has(x.mijoz)), 'top qarzdorlar — faqat o‘z mijozlari');
  // Rahbariyat uchun o'zgarmagan (butun kompaniya)
  const cfoRcv = S.ai.TOOLS.find((t) => t.name === 'get_receivables').run({}, { user: H.user('cfo@utax.uz') });
  assert.ok(cfoRcv.xulosa.count > own.count);
});

test('SALES: web /api/receivables, /summary, /aging va undiruv vazifalari — faqat o‘ziniki (manager_user_id so‘rovda almashtirib bo‘lmaydi)', async () => {
  const sales = H.user('sales@utax.uz'), s2 = H.user('sales2@utax.uz');
  const list = await api('sales@utax.uz', `/api/receivables?manager_user_id=${s2.id}`);
  assert.equal(list.status, 200);
  assert.ok(list.body.length && list.body.every((x) => x.manager_user_id === sales.id), 'boshqa sotuvchini so‘rab bo‘lmaydi');
  const own = S.receivables.summary(undefined, { manager_user_id: sales.id });
  const sum = await api('sales@utax.uz', '/api/receivables/summary');
  assert.equal(sum.body.total_receivable, own.total_receivable);
  assert.equal(sum.body.count, own.count);
  assert.ok(sum.body.top_debtors.every((x) => x.manager_user_id === sales.id));
  const ag = await api('sales@utax.uz', '/api/receivables/aging');
  assert.equal(ag.body.total, own.total_receivable);
  const rng = await api('sales@utax.uz', '/api/receivables/summary?from=2020-01-01&to=2030-12-31');
  assert.equal(rng.body.total_receivable, S.receivables.summaryRange('2020-01-01', '2030-12-31', undefined, { manager_user_id: sales.id }).total_receivable);
  const agr = await api('sales@utax.uz', '/api/receivables/aging?from=2020-01-01&to=2030-12-31');
  assert.equal(agr.body.total, rng.body.total_receivable);
  // CFO — butun kompaniya
  const all = await api('cfo@utax.uz', '/api/receivables/summary');
  assert.ok(all.body.count > own.count);
  assert.ok((await api('cfo@utax.uz', '/api/receivables')).body.some((x) => x.manager_user_id === s2.id));
  // Undiruv vazifalari
  const tasks = await api('sales@utax.uz', '/api/collections?status=OPEN');
  const mineContracts = new Set(db.all('SELECT id FROM contracts WHERE manager_user_id=?', sales.id).map((x) => x.id));
  assert.ok(tasks.body.length && tasks.body.every((k) => k.assigned_to === sales.id || mineContracts.has(k.contract_id)));
  const foreign = db.get("SELECT k.id FROM collections k JOIN contracts c ON c.id=k.contract_id WHERE k.status='OPEN' AND c.manager_user_id=? AND COALESCE(k.assigned_to,0)<>?", s2.id, sales.id);
  assert.ok(foreign, 'boshqa sotuvchining vazifasi bor');
  assert.equal((await api('sales@utax.uz', `/api/collections/${foreign.id}`, { method: 'PATCH', body: { note: 'begona' } })).status, 404);
  assert.notEqual(db.get('SELECT note FROM collections WHERE id=?', foreign.id).note, 'begona');
  assert.ok((await api('cfo@utax.uz', '/api/collections?status=OPEN')).body.some((k) => k.id === foreign.id));
});

// ---------------- 5) signal /test — yozish amali ----------------
test('signal /test: read-only AUDITOR bildirishnoma yarata olmaydi; notifications EDIT bor rol — oladi', async () => {
  const aud = H.link('auditor@utax.uz'); H.started('signal', 'auditor@utax.uz');
  const n0 = db.get('SELECT COUNT(*) n FROM notifications').n;
  const r = await H.send('signal', aud, '/test');
  assert.equal(db.get('SELECT COUNT(*) n FROM notifications').n, n0, 'AUDITOR uchun yozuv yaratilmadi');
  assert.doesNotMatch(r.text, /Yuborildi/);
  assert.match(r.text, /⛔/);
  const emp = H.link('employee@utax.uz'); H.started('signal', 'employee@utax.uz');
  const r2 = await H.send('signal', emp, '/test');
  assert.ok(db.get('SELECT COUNT(*) n FROM notifications').n > n0);
  assert.match(r2.text, /Yuborildi/);
});
