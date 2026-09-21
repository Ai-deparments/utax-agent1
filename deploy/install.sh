#!/usr/bin/env bash
# Ubuntu 22.04/24.04 ga o'rnatish: Node 24 + systemd + nginx (ixtiyoriy). root sifatida ishga tushiring.
set -euo pipefail
APP_DIR=/opt/utax-finance-crm
SRC="$(cd "$(dirname "$0")/.." && pwd)"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs
fi
id -u finance >/dev/null 2>&1 || useradd -r -m -d /var/lib/finance -s /usr/sbin/nologin finance
mkdir -p "$APP_DIR"
rsync -a --delete --exclude data --exclude .env --exclude node_modules "$SRC/" "$APP_DIR/"
mkdir -p "$APP_DIR/data" "$APP_DIR/uploads"
[ -f "$APP_DIR/.env" ] || { cp "$APP_DIR/.env.example" "$APP_DIR/.env"; sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/; s/^SECRETS_KEY=.*/SECRETS_KEY=$(openssl rand -hex 32)/; s/^HOST=.*/HOST=127.0.0.1/" "$APP_DIR/.env"; echo "→ $APP_DIR/.env yaratildi (JWT_SECRET/SECRETS_KEY tasodifiy)"; }
cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund || true
chown -R finance:finance "$APP_DIR"
cp "$APP_DIR/deploy/utax-finance.service" /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now utax-finance
( crontab -u root -l 2>/dev/null | grep -v backup.sh; echo "20 3 * * * $APP_DIR/deploy/backup.sh >> /var/log/utax-finance-backup.log 2>&1" ) | crontab -u root -
sleep 2; curl -fsS http://127.0.0.1:8100/api/health && echo " ✅ ishga tushdi. nginx: deploy/nginx.conf, TLS: certbot --nginx -d finance.utax.uz"
