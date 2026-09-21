#!/usr/bin/env bash
# Kunlik (daily) va haftalik (weekly, yakshanba) zaxira. Retention: daily 30 kun, weekly 90 kun.
# Cron: 20 3 * * * /opt/utax-finance-crm/deploy/backup.sh >> /var/log/utax-finance-backup.log 2>&1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${DB_PATH:-$ROOT/data/finance.db}"
DEST="${BACKUP_DIR:-$ROOT/data/backups}"
mkdir -p "$DEST/daily" "$DEST/weekly"
TS=$(date +%Y%m%d-%H%M%S)
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB" ".backup '$DEST/daily/finance-$TS.db'"
else
  node -e "import('node:sqlite').then(async ({DatabaseSync, backup})=>{const d=new DatabaseSync('$DB');await backup(d,'$DEST/daily/finance-$TS.db');d.close();})"
fi
gzip -f "$DEST/daily/finance-$TS.db"
if [ "$(date +%u)" = "7" ]; then cp "$DEST/daily/finance-$TS.db.gz" "$DEST/weekly/"; fi
find "$DEST/daily" -name '*.gz' -mtime +30 -delete
find "$DEST/weekly" -name '*.gz' -mtime +90 -delete
echo "[$TS] backup ok → $DEST/daily/finance-$TS.db.gz ($(du -h "$DEST/daily/finance-$TS.db.gz" | cut -f1))"
