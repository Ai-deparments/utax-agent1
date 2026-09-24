import { nowIso } from './util.mjs';

/** Fon vazifalari: daily/hourly/every N min. Oxirgi ishga tushish `settings` da saqlanadi. */
export function createScheduler({ db, log = console }) {
  const jobs = [];
  let timer = null;
  const key = (name) => `scheduler.last_run.${name}`;
  function lastRun(name) {
    const r = db.get('SELECT value FROM settings WHERE key=?', key(name));
    return r ? JSON.parse(r.value) : null;
  }
  function setLastRun(name, ts) {
    db.run('INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at', key(name), JSON.stringify(ts), ts);
  }
  async function runJob(j, force = false) {
    const now = new Date();
    const last = lastRun(j.name);
    let due = force;
    if (!due) {
      if (j.everyMs) due = !last || now - new Date(last) >= j.everyMs;
      else if (j.dailyAt !== undefined) {
        const [hh, mm] = String(j.dailyAt).split(':').map(Number);
        const todayRun = new Date(now); todayRun.setHours(hh, mm || 0, 0, 0);
        due = now >= todayRun && (!last || new Date(last) < todayRun);
      }
    }
    if (!due) return null;
    const started = Date.now();
    try {
      const r = await j.fn();
      setLastRun(j.name, nowIso());
      log.info?.(`[scheduler] ${j.name} ok (${Date.now() - started}ms)`);
      return r;
    } catch (e) {
      log.error?.(`[scheduler] ${j.name} failed: ${e.message}`);
      return { error: e.message };
    }
  }
  return {
    add(job) { jobs.push(job); },
    list() { return jobs.map((j) => ({ name: j.name, schedule: j.dailyAt ? `daily ${j.dailyAt}` : `every ${Math.round(j.everyMs / 60000)}m`, last_run: lastRun(j.name), description: j.description })); },
    async run(name, force = true) {
      const j = jobs.find((x) => x.name === name);
      if (!j) throw new Error('Job topilmadi: ' + name);
      return runJob(j, force);
    },
    /**
     * Vaqti kelgan vazifalarni bajaradi. `budgetMs` berilsa (serverless: Vercel funksiyasining
     * chegarasi 60 s), budjet tugagach to'xtaydi — qolgan vazifalar keyingi chaqiruvda bajariladi,
     * chunki har bir vazifaning last_run'i alohida saqlanadi. Aks holda butun so'rov timeout bilan
     * uzilib, hech bir vazifa yozib qo'yilmasdi va baza qulflanib qolardi.
     */
    async tick({ budgetMs = 0 } = {}) {
      const t0 = Date.now();
      const done = []; const skipped = [];
      for (const j of jobs) {
        if (budgetMs && Date.now() - t0 > budgetMs) { skipped.push(j.name); continue; }
        await runJob(j);
        done.push(j.name);
      }
      if (skipped.length) log.info?.(`[scheduler] budjet tugadi (${Date.now() - t0}ms) — keyingi chaqiruvga qoldi: ${skipped.join(', ')}`);
      return { done, skipped };
    },
    start(intervalMs = 60000) {
      timer = setInterval(() => this.tick().catch(() => {}), intervalMs);
      timer.unref();
      setTimeout(() => this.tick().catch(() => {}), 2000).unref();
    },
    stop() { if (timer) clearInterval(timer); },
  };
}
