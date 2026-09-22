/**
 * Paketsiz SMTP klienti — email bildirishnomalari uchun (Gmail, Yandex, mail.uz, korporativ server).
 *  - security: 'ssl' (odatda 465, darhol TLS) | 'starttls' (odatda 587, oddiy ulanish → STARTTLS) | 'none' (faqat ichki tarmoq)
 *  - AUTH PLAIN / LOGIN; UTF-8 mavzu (RFC 2047) va matn (base64)
 */
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
const wrap = (s) => s.replace(/.{1,76}/g, '$&\r\n');
const encHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const addrOnly = (a) => (/<([^>]+)>/.exec(a)?.[1] || a).trim();

/** Bitta ulanish ustida buyruq/javob almashinuvi (ko'p qatorli javoblar: "250-..." → "250 ...") */
function session(socket, timeoutMs) {
  let buf = '';
  let waiter = null;
  const lines = [];
  const onData = (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 2); }
    flush();
  };
  const flush = () => {
    if (!waiter) return;
    const end = lines.findIndex((l) => /^\d{3} /.test(l) || /^\d{3}$/.test(l));
    if (end < 0) return;
    const block = lines.splice(0, end + 1);
    const w = waiter; waiter = null; clearTimeout(w.t);
    w.resolve({ code: Number(block[block.length - 1].slice(0, 3)), text: block.map((l) => l.slice(4)).join('\n') });
  };
  const fail = (e) => { if (waiter) { const w = waiter; waiter = null; clearTimeout(w.t); w.reject(e); } };
  const attach = (s) => { s.on('data', onData); s.on('error', fail); s.on('close', () => fail(new Error('SMTP ulanishi yopildi'))); };
  attach(socket);
  const read = () => new Promise((resolve, reject) => {
    waiter = { resolve, reject, t: setTimeout(() => fail(new Error('SMTP javob bermadi (timeout)')), timeoutMs) };
    flush();
  });
  return {
    read,
    async cmd(line, expect) {
      socket.write(line + '\r\n');
      const r = await read();
      if (expect && !expect.includes(r.code)) throw Object.assign(new Error(`SMTP ${r.code}: ${r.text.split('\n')[0]}`), { code: r.code });
      return r;
    },
    swap(next) { socket.removeAllListeners('data'); socket.removeAllListeners('error'); socket.removeAllListeners('close'); socket = next; attach(next); },
    get socket() { return socket; },
  };
}

function connect({ host, port, security, timeoutMs, rejectUnauthorized }) {
  return new Promise((resolve, reject) => {
    const opts = { host, port, servername: host, rejectUnauthorized };
    const s = security === 'ssl' ? tls.connect(opts, () => resolve(s)) : net.connect({ host, port }, () => resolve(s));
    s.setTimeout(timeoutMs, () => s.destroy(new Error('SMTP serverga ulanib bo‘lmadi (timeout)')));
    s.once('error', reject);
  });
}

/**
 * sendMail({ host, port, security, user, pass, from, to, subject, text }) → { accepted, response }
 * to — satr ("a@x.uz, b@y.uz") yoki massiv.
 */
export async function sendMail({ host, port, security = 'ssl', user, pass, from, to, subject, text, timeoutMs = 20000, rejectUnauthorized = true }) {
  if (!host) throw new Error('SMTP server manzili kiritilmagan');
  const rcpts = (Array.isArray(to) ? to : String(to || '').split(/[,;\s]+/)).map((x) => x.trim()).filter(Boolean);
  if (!rcpts.length) throw new Error('Qabul qiluvchi email yo‘q');
  from = from || user;
  if (!from) throw new Error('Jo‘natuvchi (From) email kiritilmagan');
  port = Number(port) || (security === 'ssl' ? 465 : 587);
  const sock = await connect({ host, port, security, timeoutMs, rejectUnauthorized });
  const s = session(sock, timeoutMs);
  try {
    const hello = await s.read();
    if (hello.code !== 220) throw new Error(`SMTP salomlashuv: ${hello.code} ${hello.text}`);
    const name = 'utax-finance.local';
    let ehlo = await s.cmd(`EHLO ${name}`, [250]);
    if (security === 'starttls') {
      if (!/STARTTLS/i.test(ehlo.text)) throw new Error('Server STARTTLS ni qo‘llamaydi — "SSL" rejimini tanlang');
      await s.cmd('STARTTLS', [220]);
      const secure = await new Promise((resolve, reject) => { const t = tls.connect({ socket: s.socket, servername: host, rejectUnauthorized }, () => resolve(t)); t.once('error', reject); });
      s.swap(secure);
      ehlo = await s.cmd(`EHLO ${name}`, [250]);
    }
    if (user) {
      if (/AUTH[^\n]*PLAIN/i.test(ehlo.text)) await s.cmd(`AUTH PLAIN ${b64(`\0${user}\0${pass || ''}`)}`, [235]);
      else { await s.cmd('AUTH LOGIN', [334]); await s.cmd(b64(user), [334]); await s.cmd(b64(pass || ''), [235]); }
    }
    await s.cmd(`MAIL FROM:<${addrOnly(from)}>`, [250]);
    for (const r of rcpts) await s.cmd(`RCPT TO:<${addrOnly(r)}>`, [250, 251]);
    await s.cmd('DATA', [354]);
    const domain = addrOnly(from).split('@')[1] || 'utax.local';
    const msg = [
      `From: ${encHeader('UTAX Finance')} <${addrOnly(from)}>`,
      `To: ${rcpts.join(', ')}`,
      `Subject: ${encHeader(subject || 'UTAX Finance')}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@${domain}>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrap(b64(text || '')),
    ].join('\r\n');
    const done = await s.cmd(msg + '\r\n.', [250]);
    try { await s.cmd('QUIT'); } catch {}
    return { accepted: rcpts, response: done.text };
  } finally {
    s.socket.destroy();
  }
}
