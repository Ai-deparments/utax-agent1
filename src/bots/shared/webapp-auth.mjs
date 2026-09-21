import crypto from 'node:crypto';

/**
 * Telegram Mini App initData tekshiruvi (core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
 * secret = HMAC_SHA256(key="WebAppData", msg=bot_token); hash = HMAC_SHA256(key=secret, msg=data_check_string).
 * data_check_string — hash'dan tashqari barcha maydonlar, alifbo tartibida, "k=v" + "\n".
 * Yangi mijozlar `signature` maydonini ham yuboradi: u ba'zi versiyalarda satrga kiradi, ba'zilarida yo'q — ikkalasi tekshiriladi.
 * @returns {{user, auth_date, start_param, query_id} | null}
 */
export function verifyInitData(initData, botToken, { maxAgeSec = 24 * 3600, now = Date.now() } = {}) {
  if (!initData || !botToken) return null;
  let params;
  try { params = new URLSearchParams(String(initData)); } catch { return null; }
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;
  const entries = [...params.entries()].filter(([k]) => k !== 'hash').sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const check = (list) => {
    const calc = crypto.createHmac('sha256', secret).update(list.map(([k, v]) => `${k}=${v}`).join('\n')).digest();
    const got = Buffer.from(hash, 'hex');
    return got.length === calc.length && crypto.timingSafeEqual(got, calc);
  };
  if (!check(entries) && !check(entries.filter(([k]) => k !== 'signature'))) return null;
  const authDate = Number(params.get('auth_date'));
  if (!authDate || now / 1000 - authDate > maxAgeSec || authDate - now / 1000 > 300) return null;
  let user = null;
  try { user = JSON.parse(params.get('user') || 'null'); } catch { return null; }
  if (!user?.id) return null;
  return { user, auth_date: authDate, start_param: params.get('start_param') || null, query_id: params.get('query_id') || null };
}

/** Testlar va lokal sinov uchun: token bilan imzolangan initData yasash */
export function signInitData(fields, botToken) {
  const entries = Object.entries(fields).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]).sort(([a], [b]) => (a < b ? -1 : 1));
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secret).update(entries.map(([k, v]) => `${k}=${v}`).join('\n')).digest('hex');
  const p = new URLSearchParams(entries);
  p.set('hash', hash);
  return p.toString();
}
