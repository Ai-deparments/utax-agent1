/** /start matni — xodimning qisqa holati (o'z so'rovlari, navbatidagi tasdiqlar, undiruv vazifalari) */
import { esc } from '../../shared/html.mjs';
import { money, line, lines, roleLabel } from '../../shared/format.mjs';
import { btn } from '../../shared/keyboards.mjs';
import { pendingApprovals } from '../../shared/approvals-ui.mjs';
import { meningSorovlarim } from './sorovlarim.mjs';

export function startText(ctx) {
  const bolim = ctx.S.users.get(ctx.user.id)?.department || null;
  const kutilmoqda = ctx.can('expenses', 'VIEW') ? meningSorovlarim(ctx, { status: 'PENDING' }) : [];
  const navbat = ctx.can('approvals', 'APPROVE') ? pendingApprovals(ctx, { entityType: 'EXPENSE' }).filter((a) => a.can_act) : [];
  const vazifalar = ctx.can('collections', 'VIEW') ? ctx.S.receivables.listCollections({ status: 'OPEN', assigned_to: ctx.user.id }) : [];
  return lines(
    `👋 Assalomu alaykum, <b>${esc(ctx.user.name)}</b>!`,
    `<b>UTAX So‘rov</b> · ${esc(roleLabel(ctx.user.role_code))}${bolim ? ` (${esc(bolim)})` : ''}`,
    '',
    ctx.can('expenses', 'VIEW') ? line('📝 Ko‘rib chiqilayotgan so‘rovlaringiz', `${kutilmoqda.length} ta${kutilmoqda.length ? ` · ${money(kutilmoqda.reduce((s, e) => s + (Number(e.amount) || 0), 0))}` : ''}`) : null,
    ctx.can('approvals', 'APPROVE') ? line('✅ Sizning tasdig‘ingizni kutmoqda', `${navbat.length} ta`) : null,
    ctx.can('collections', 'VIEW') ? line('📞 Ochiq undiruv vazifalari', `${vazifalar.length} ta`) : null,
    '',
    ctx.can('expenses', 'CREATE') ? '💸 Xarajat so‘rovi — «➕ Yangi so‘rov» yoki /yangi' : null,
    'Bo‘limni tanlang yoki savolingizni oddiy matn bilan yozing:',
  );
}

export const helpExtra = () => lines(
  '',
  '<b>Xarajat so‘rovi</b> (/yangi): summa → maqsad → kategoriya → kerakli sana → to‘lov usuli → kontragent → hujjat → yuborish.',
  'Qaror chiqqach @utax_signal_bot xabar beradi; holatini /sorovlarim da ko‘rasiz.',
);

/** Dialogdan tashqari yuborilgan fayl — so'rov bilan birga yuborishni taklif qilish */
export async function faylKutilmagan(ctx) {
  if (!ctx.can('expenses', 'CREATE')) return ctx.reply('📎 Fayl hozir kutilmayapti. /yordam — mavjud buyruqlar.');
  return ctx.reply('📎 Hujjatni xarajat so‘rovi bilan birga yuboring: /yangi → oxirgi bosqich «Hujjat».', { buttons: [[btn.cmd('➕ Yangi so‘rov', 'yangi')]] });
}
