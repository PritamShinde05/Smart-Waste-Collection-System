#!/usr/bin/env bash
set -euo pipefail

# Automated MySQL backup script for VerdantRoute (smart_waste_db)
# Usage: DB_PASSWORD="..." ./backend/scripts/backup_mysql.sh

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_NAME="${DB_NAME:-smart_waste_db}"
DB_USERNAME="${DB_USERNAME:-root}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [[ -z "${DB_PASSWORD:-}" ]]; then
  echo "Error: DB_PASSWORD environment variable must be set." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%d_%H%M%SZ)"
OUT_FILE="${BACKUP_DIR}/${DB_NAME}_${STAMP}.sql.gz"

MYSQL_PWD="$DB_PASSWORD" mysqldump \
  -h "$DB_HOST" \
  -P "$DB_PORT" \
  -u "$DB_USERNAME" \
  --single-transaction \
  --routines \
  --triggers \
  --databases "$DB_NAME" | gzip > "$OUT_FILE"

echo "Backup written: $OUT_FILE"

# Prune backups older than RETENTION_DAYS
find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -type f -mtime +"$RETENTION_DAYS" -delete
