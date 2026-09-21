#!/usr/bin/env bash
# Restore: ./deploy/restore.sh data/backups/daily/finance-YYYYMMDD-HHMMSS.db.gz
# Jarayon: servisni to'xtatish → joriy bazani .before-restore nusxalash → zaxirani qo'yish → servisni yoqish → /api/health tekshirish
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${DB_PATH:-$ROOT/data/finance.db}"
SRC="${1:?zaxira fayli (.db yoki .db.gz) ko'rsating}"
SVC="${SERVICE:-utax-finance}"
systemctl stop "$SVC" 2>/dev/null || true
cp -f "$DB" "$DB.before-restore-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
rm -f "$DB-wal" "$DB-shm"
if [[ "$SRC" == *.gz ]]; then gunzip -c "$SRC" > "$DB"; else cp -f "$SRC" "$DB"; fi
systemctl start "$SVC" 2>/dev/null || true
sleep 2
curl -fsS http://127.0.0.1:${PORT:-8100}/api/health && echo " restore ok" || echo "health check FAILED — loglarni tekshiring"
