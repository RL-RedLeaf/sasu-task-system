#!/bin/sh
# 每日全量备份（PRD §11.3/§18.3）：保留 30 天；每月 1 日追加月度归档，保留 36 个月。
# 由 docker-compose 的 backup 服务每日调用。

set -eu

: "${MYSQL_HOST:=mysql}"
: "${MYSQL_DATABASE:=sasu}"
: "${BACKUP_ROOT:=/backup}"
: "${DAILY_KEEP_DAYS:=30}"
: "${MONTHLY_KEEP_DAYS:=1095}" # ≈ 36 个月

STAMP="$(date +%F)"
DAILY_DIR="$BACKUP_ROOT/daily"
MONTHLY_DIR="$BACKUP_ROOT/monthly/$(date +%Y-%m)"
mkdir -p "$DAILY_DIR"

dump() {
  mysqldump \
    --host="$MYSQL_HOST" \
    --user=root \
    --password="$MYSQL_ROOT_PASSWORD" \
    --single-transaction \
    --routines \
    --triggers \
    --set-gtid-purged=OFF \
    "$MYSQL_DATABASE"
}

dump | gzip > "$DAILY_DIR/$MYSQL_DATABASE-$STAMP.sql.gz.tmp"
mv "$DAILY_DIR/$MYSQL_DATABASE-$STAMP.sql.gz.tmp" "$DAILY_DIR/$MYSQL_DATABASE-$STAMP.sql.gz"
find "$DAILY_DIR" -name '*.sql.gz' -mtime +"$DAILY_KEEP_DAYS" -delete

# 月度归档（每月 1 日）
if [ "$(date +%d)" = "01" ]; then
  mkdir -p "$MONTHLY_DIR"
  cp "$DAILY_DIR/$MYSQL_DATABASE-$STAMP.sql.gz" "$MONTHLY_DIR/"
  find "$BACKUP_ROOT/monthly" -name '*.sql.gz' -mtime +"$MONTHLY_KEEP_DAYS" -delete
fi

echo "backup done: $DAILY_DIR/$MYSQL_DATABASE-$STAMP.sql.gz"
