#!/usr/bin/env bash
set -euo pipefail

# Restore and verify a VerdantRoute MySQL backup into a target/scratch database
# Usage: DB_PASSWORD="..." ./backend/scripts/restore_mysql.sh backups/smart_waste_db_YYYYMMDD_HHMMSSZ.sql.gz [target_db]

if [[ $# -lt 1 ]]; then
  echo "Usage: DB_PASSWORD=\"...\" $0 <backup_file.sql|.sql.gz> [target_db]" >&2
  exit 1
fi

BACKUP_FILE="$1"
TARGET_DB="${2:-smart_waste_db_restore_verify}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_USERNAME="${DB_USERNAME:-root}"

if [[ -z "${DB_PASSWORD:-}" ]]; then
  echo "Error: DB_PASSWORD environment variable must be set." >&2
  exit 1
fi
if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Error: Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

MYSQL_PWD="$DB_PASSWORD" mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USERNAME" \
  -e "CREATE DATABASE IF NOT EXISTS \`$TARGET_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

if [[ "$BACKUP_FILE" == *.gz ]]; then
  gunzip -c "$BACKUP_FILE" | sed "s/\`smart_waste_db\`/\`$TARGET_DB\`/g; s/USE \`smart_waste_db\`/USE \`$TARGET_DB\`/g" | \
    MYSQL_PWD="$DB_PASSWORD" mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USERNAME" "$TARGET_DB"
else
  sed "s/\`smart_waste_db\`/\`$TARGET_DB\`/g; s/USE \`smart_waste_db\`/USE \`$TARGET_DB\`/g" "$BACKUP_FILE" | \
    MYSQL_PWD="$DB_PASSWORD" mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USERNAME" "$TARGET_DB"
fi

MYSQL_PWD="$DB_PASSWORD" mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USERNAME" "$TARGET_DB" \
  -e "SHOW TABLES; SELECT COUNT(*) AS areas_count FROM areas;"

echo "Restore verification succeeded into database: $TARGET_DB"
