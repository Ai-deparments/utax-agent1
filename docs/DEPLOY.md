# Deploy

## Variant A — Ubuntu VPS (systemd + nginx)

```bash
scp -r utax-finance-crm root@SERVER:/root/
ssh root@SERVER 'bash /root/utax-finance-crm/deploy/install.sh'
# nginx + TLS
cp /opt/utax-finance-crm/deploy/nginx.conf /etc/nginx/sites-available/utax-finance.conf
ln -s /etc/nginx/sites-available/utax-finance.conf /etc/nginx/sites-enabled/
certbot --nginx -d finance.utax.uz && nginx -t && systemctl reload nginx
```

`install.sh`: Node 24, `finance` foydalanuvchi, `/opt/utax-finance-crm`, `.env` (tasodifiy JWT_SECRET/SECRETS_KEY), systemd `utax-finance`, cron backup 03:20.

## Variant B — Docker

```bash
cp .env.example .env   # JWT_SECRET, SECRETS_KEY majburiy
docker compose up -d --build
```

Ma’lumotlar `finance-data` volume da (`/app/data`). Kubernetes: shu image + PVC + Secret (env) + Ingress; scheduler bitta replica da ishlashi kerak (yoki `SCHEDULER=off` bilan alohida job podi — keyingi bosqich).

## .env

| O‘zgaruvchi | Ma’nosi |
|---|---|
| `PORT`, `HOST` | 8100, 127.0.0.1 (nginx orqasida) |
| `DB_PATH` | SQLite fayl |
| `JWT_SECRET`, `SECRETS_KEY` | **majburiy, tasodifiy 32+ belgi** |
| `ANTHROPIC_API_KEY`, `AI_MODEL` | LLM (ixtiyoriy; default `claude-opus-5`) |
| `BOT_RAHBAR_TOKEN`, `BOT_BUXGALTER_TOKEN`, `BOT_SOROV_TOKEN`, `BOT_SIGNAL_TOKEN` | 4 ta Telegram bot tokeni (bo‘sh bot o‘chiq qoladi) — [BOTS.md](BOTS.md) |
| `BOT_OWNER_IDS` | egalar: Telegram user id'lar (vergul bilan) — FOUNDER roli, barcha botlar, kodsiz bog‘lanadi |
| `BOT_MODE` | `polling` (default) · `webhook` (prod: `PUBLIC_URL` https + `WEBHOOK_SECRET`, nginx `/telegram/` → ilova) · `off` |
| `WEBAPP_URL` | botlardagi «Web’da ochish» manzili; `https://` bo‘lsa Telegram Mini App (ichida avtomatik kirish) |
| `TELEGRAM_ALERT_CHAT_ID` | CRITICAL ogohlantirishlar guruhi (signal bot) |
| `EMAIL_WEBHOOK_URL` | email yuborish webhook (POST {to, subject, body}) |
| `SEED_ON_EMPTY` | bo‘sh bazaga pilot yuklash (prod da `false`) |

## Backup / Restore

- Ilova ichida: har kuni 03:00 `data/backups/finance-YYYY-MM-DD.db` (retention `backup.retention_days`, default 60) + Sozlamalar → «Hozir zaxiralash».
- Server: `deploy/backup.sh` — daily (30 kun) + weekly (90 kun), gzip. Cron: `20 3 * * *`.
- Restore: `deploy/restore.sh data/backups/daily/finance-....db.gz` — servisni to‘xtatadi, joriy bazani `.before-restore` nusxalaydi, tiklaydi, `/api/health` tekshiradi. **Restore jarayonini oyiga bir marta test-serverda sinang.**

## Pilot → real ma’lumot

1. `SEED_ON_EMPTY=false`, `npm run seed:reset` **qilmang**; bo‘sh bazada admin foydalanuvchini `POST /api/users` (yoki seed dan faqat sozlamalarni olib) yarating.
2. Sozlamalar → xizmat turlari, kategoriyalar, approval qoidalari, bo‘limlar, xodimlar.
3. Iyul shartnomalari → Shartnomalar (yoki API `POST /api/contracts`), bank ko‘chirmasi → Tushumlar → Import (CSV/XLSX), kassa → Pul boshqaruvi, xarajatlar → «To‘g‘ridan-to‘g‘ri kiritish», oylik → KPI & Oylik → Hisoblash.
4. Reconciliation → SUGGESTED larni tasdiqlang; Data Quality hisobotini nolga keltiring; eski hisob bilan solishtiring (TZ §44).
