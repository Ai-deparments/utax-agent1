/**
 * /xodimlar — web: Sozlamalar → Foydalanuvchilar. Ko'rish: users VIEW; bloklash/ochish (Kill switch): users EDIT.
 * Bloklash users.setActive orqali: web sessiyalari yopiladi, hech bir bot javob bermaydi, ochiq dialoglar o'chadi, audit.
 */
import { esc } from '../../shared/html.mjs';
import { lines, title, muted, clip, roleLabel } from '../../shared/format.mjs';
import { chunk, paginate } from '../../shared/keyboards.mjs';
import { T } from '../../shared/texts.mjs';
import { P } from './common.mjs';

const PER_PAGE = 8;

function listCard(ctx, page = 0, notice = null) {
  const all = ctx.S.users.list();
  const canEdit = ctx.can(...P.usersEdit);
  const { slice, page: p, nav } = paginate(all, page, PER_PAGE, (x) => `r.usr:pg:${x}`);
  const active = all.filter((u) => u.is_active).length;
  const linked = all.filter((u) => u.telegram_user_id).length;
  const html = lines(
    `${title('👤', 'Xodimlar')} — ${all.length} ta`,
    muted(`faol ${active} · bloklangan ${all.length - active} · Telegram ulangan ${linked}`),
    notice,
    '',
    ...slice.map((u, n) => `${p * PER_PAGE + n + 1}. ${u.is_active ? '🟢' : '🔒'} <b>${esc(u.name)}</b> — ${esc(roleLabel(u.role_code))}${u.department ? ` · ${esc(u.department)}` : ''} · ${u.telegram_user_id ? '📱 ulangan' : '📵 ulanmagan'}${u.is_active ? '' : ' · <i>bloklangan</i>'}`),
    canEdit ? `\n${muted('🔒 — bloklash (Kill switch): web kirish yopiladi, UTAX botlari javob bermaydi. 🔓 — blokdan chiqarish.')}` : null,
  );
  const buttons = [];
  if (canEdit) {
    const acts = slice
      .filter((u) => u.role_code !== 'FOUNDER' && u.id !== ctx.user.id)
      .map((u) => ({ text: `${u.is_active ? '🔒' : '🔓'} ${clip(u.name, 22)}`, cb: `r.usr:ask:${u.id}:${p}` }));
    buttons.push(...chunk(acts, 2));
  }
  if (nav.length) buttons.push(nav);
  buttons.push([{ text: '🌐 Foydalanuvchilar', web: 'settings/users' }]);
  return { html, buttons };
}

function confirmCard(u, page) {
  const block = !!u.is_active;
  const html = block
    ? lines(
      `🔒 <b>${esc(u.name)}</b> (${esc(roleLabel(u.role_code))}) ni bloklaysizmi?`,
      '',
      '• web panelga kira olmaydi — ochiq sessiyalari yopiladi',
      '• UTAX botlari javob bermaydi, ochiq amallari bekor bo‘ladi',
      '',
      muted('Blokdan chiqarish — shu yerda yoki web panelda.'),
    )
    : lines(`🔓 <b>${esc(u.name)}</b> (${esc(roleLabel(u.role_code))}) ni blokdan chiqarasizmi?`, '', 'Web panel va UTAX botlariga kirish qayta ochiladi.');
  return {
    html,
    buttons: [
      [{ text: block ? '✅ Ha, bloklash' : '✅ Ha, blokdan chiqarish', cb: `r.usr:do:${u.id}:${block ? 0 : 1}:${page}` }],
      [{ text: '⬅️ Orqaga', cb: `r.usr:pg:${page}` }],
    ],
  };
}

async function xodimlar(ctx) {
  const c = listCard(ctx, 0);
  return ctx.reply(c.html, { buttons: c.buttons });
}

/** r.usr:pg:<sahifa> | r.usr:ask:<id>:<sahifa> | r.usr:do:<id>:<0|1>:<sahifa> */
async function usersCb(ctx) {
  const [op, a, b, c] = ctx.cbArgs;
  if (op === 'pg') { const card = listCard(ctx, Number(a) || 0); return ctx.edit(card.html, { buttons: card.buttons }); }
  if (op !== 'ask' && op !== 'do') return ctx.answer(T.expired, true);
  ctx.need(...P.usersEdit);
  const id = Number(a);
  const u = Number.isInteger(id) ? ctx.S.users.get(id) : null;
  if (!u) return ctx.answer('Foydalanuvchi topilmadi', true);
  if (op === 'ask') {
    const page = Number(b) || 0;
    const card = confirmCard(u, page);
    return ctx.edit(card.html, { buttons: card.buttons });
  }
  const activate = b === '1';
  const page = Number(c) || 0;
  if (!!u.is_active === activate) {
    const card = listCard(ctx, page);
    await ctx.edit(card.html, { buttons: card.buttons });
    return ctx.answer(activate ? 'Allaqachon faol' : 'Allaqachon bloklangan', true);
  }
  ctx.S.users.setActive(u.id, activate, ctx.actor);
  const card = listCard(ctx, page, activate ? `✅ <b>${esc(u.name)}</b> blokdan chiqarildi.` : `🔒 <b>${esc(u.name)}</b> bloklandi.`);
  await ctx.edit(card.html, { buttons: card.buttons });
  return ctx.answer(activate ? '🔓 Blokdan chiqarildi' : '🔒 Bloklandi');
}

export const commands = [
  { name: 'xodimlar', desc: 'Xodimlar, rollar, bloklash (Kill switch)', button: '👤 Xodimlar', perm: P.users, run: xodimlar },
];

export const callbacks = {
  'r.usr': { perm: P.users, run: usersCb },
};
