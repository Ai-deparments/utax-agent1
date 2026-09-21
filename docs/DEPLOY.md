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
cp .env.example .env   # JWT_SECRET, SECRETS_KEY majburiy; AI uchun GEMINI_API_KEY / GROQ_API_KEY
docker compose up -d --build
```

Image ichida `.env` yo‘q — `docker-compose.yml` uni `env_file: .env` orqali konteynerga beradi (Docker Compose ≥ 2.24,
`required: false`; eski versiyada oddiy `env_file: .env` qiling). `PORT`, `HOST`, `DB_PATH` compose'da konteyner uchun
qayta belgilanadi (`.env` dagi qiymatdan ustun). Tekshirish: `docker compose exec finance npm run llm:check`.

Ma’lumotlar `finance-data` volume da (`/app/data`). Kubernetes: shu image + PVC + Secret (env) + Ingress; scheduler bitta replica da ishlashi kerak (yoki `SCHEDULER=off` bilan alohida job podi — keyingi bosqich).

## .env

| O‘zgaruvchi | Ma’nosi |
|---|---|
| `PORT`, `HOST` | 8100, 127.0.0.1 (nginx orqasida) |
| `DB_PATH` | SQLite fayl |
| `JWT_SECRET`, `SECRETS_KEY` | **majburiy, tasodifiy 32+ belgi** |
| `APP_TZ` | fon vazifalari (01:00 revenue, 03:00 backup, 08:30 digest) va «bugun» sanasi zonasi; default `Asia/Tashkent` (`TZ` berilsa — `TZ` ustun) |
| `GEMINI_API_KEY` | AI asosiy provayder (ixtiyoriy). Zanjir: **Gemini → Groq → qoidalar dvigateli** (kalit yo‘q / xato / limit — foydalanuvchi xatoni ko‘rmaydi) |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS` | default `gemini-3.6-flash`; model topilmasa navbatdagilari (vergul bilan), default `gemini-3.5-flash,gemini-flash-latest` |
| `GEMINI_RPM` | Gemini’ga daqiqalik so‘rov chegarasi (default 12); tugasa Groq |
| `GROQ_API_KEY` | AI zaxira provayder (ixtiyoriy) |
| `GROQ_MODEL`, `GROQ_FALLBACK_MODEL` | default `openai/gpt-oss-120b`; TPM limitiga yetsa `openai/gpt-oss-20b` |
| `AI_MASK_NAMES` | mijoz/xodim nomlari LLM’ga niqoblangan holda (default `true`) |
| `AI_MEMORY_TURNS`, `AI_MEMORY_HOURS` | suhbat xotirasi: oxirgi N savol-javob (6), necha soat ichida (12) |
| `AI_MAX_TOOLS`, `AI_TIMEOUT_MS` | bitta so‘rovga eng ko‘p tool (8), javob kutish chegarasi (25000 ms) |
| `BOT_RAHBAR_TOKEN`, `BOT_BUXGALTER_TOKEN`, `BOT_SOROV_TOKEN`, `BOT_SIGNAL_TOKEN` | 4 ta Telegram bot tokeni (bo‘sh bot o‘chiq qoladi) — [BOTS.md](BOTS.md) |
| `BOT_OWNER_IDS` | egalar: Telegram user id'lar (vergul bilan) — FOUNDER roli, barcha botlar, kodsiz bog‘lanadi |
| `BOT_MODE` | `polling` (default) · `webhook` (prod: `PUBLIC_URL` https + `WEBHOOK_SECRET`, nginx `/telegram/` → ilova) · `off` |
| `WEBAPP_URL` | botlardagi «Web’da ochish» manzili; `https://` bo‘lsa Telegram Mini App (ichida avtomatik kirish) |
| `TELEGRAM_ALERT_CHAT_ID` | CRITICAL ogohlantirishlar guruhi (signal bot); bir xil ogohlantirish (`dedupe_key`) guruhga bir marta |
| `EMAIL_WEBHOOK_URL` | email yuborish webhook (POST {to, subject, body}) |
| `SEED_ON_EMPTY` | bo‘sh bazaga pilot yuklash (prod da `false`) |

## Backup / Restore

- Ilova ichida: har kuni 03:00 (`APP_TZ`) `data/backups/finance-YYYY-MM-DD.db` (sana — `APP_TZ` bo‘yicha) (retention `backup.retention_days`, default 60) + Sozlamalar → «Hozir zaxiralash».
- Server: `deploy/backup.sh` — daily (30 kun) + weekly (90 kun), gzip. Cron: `20 3 * * *`.
- Restore: `deploy/restore.sh data/backups/daily/finance-....db.gz` — servisni to‘xtatadi, joriy bazani `.before-restore` nusxalaydi, tiklaydi, `/api/health` tekshiradi. **Restore jarayonini oyiga bir marta test-serverda sinang.**

## Pilot → real ma’lumot

1. `SEED_ON_EMPTY=false`, `npm run seed:reset` **qilmang**; bo‘sh bazada admin foydalanuvchini `POST /api/users` (yoki seed dan faqat sozlamalarni olib) yarating.
2. Sozlamalar → xizmat turlari, kategoriyalar, approval qoidalari, bo‘limlar, xodimlar.
3. Iyul shartnomalari → Shartnomalar (yoki API `POST /api/contracts`), bank ko‘chirmasi → Tushumlar → Import (CSV/XLSX), kassa → Pul boshqaruvi, xarajatlar → «To‘g‘ridan-to‘g‘ri kiritish», oylik → KPI & Oylik → Hisoblash.
4. Reconciliation → SUGGESTED larni tasdiqlang; Data Quality hisobotini nolga keltiring; eski hisob bilan solishtiring (TZ §44).
