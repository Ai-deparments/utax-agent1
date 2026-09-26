# Xavfsizlik siyosati

## Zaiflik topsangiz
Ochiq issue **yozmang**. Repo egasiga shaxsiy xabar yuboring (GitHub: @SARDORALOYEV yoki @zone24uzz) yoki
GitHub → Security → **Report a vulnerability** (private advisory). 48 soat ichida javob beriladi.

## Qoidalar (jamoa uchun)
- **Sir git'ga tushmaydi:** `.env`, token, parol, API kalit, `DATA_VAULT_KEY`, `SECRETS_KEY`. Ular `.env` (lokal) va Vercel env'da turadi.
  CI va pre-push'da `npm run secrets` (`scripts/secret-scan.mjs`) buni tekshiradi.
- **Ma'lumot git'ga tushmaydi:** baza (`data/*.db`), Excel/bank fayllari, `data/bank-registry.json`, `ERP/`.
  Jamoa bilan faqat shifrlangan seyf orqali (`data/vault/`, AES-256-GCM; kalit — shaxsiy kanal orqali).
- **Vercel'ga ma'lumot** GitHub orqali emas, `npm run turso:push` bilan boradi. `.vercelignore` token va moliyaviy fayllarni yuklamaydi.
- **Token chatga yoki repoga tushsa** — darhol revoke qiling (Telegram: BotFather → /revoke; ERP: yangi token), keyin `.env`/Vercel'ni yangilang.
- `main` ga to'g'ridan-to'g'ri push yo'q: feature branch → PR → CI yashil → merge.

## Himoya qatlamlari
| Qatlam | Qayerda |
|---|---|
| Parollar | scrypt hash (`src/core/auth.mjs`), 2FA (TOTP) |
| Integratsiya sirlari | AES-256-GCM, `SECRETS_KEY` bilan bazada shifrlangan |
| ERP token (jamoa uchun) | `data/vault/erp-token.enc`, `DATA_VAULT_KEY` bilan |
| Ruxsatlar | RBAC: 11 rol × 23 resurs × 7 harakat (`src/core/rbac.mjs`), audit jurnali o'chirilmaydi |
| CI | sirlar skani + sintaksis + testlar (`.github/workflows/ci.yml`), Dependabot |
