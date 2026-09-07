#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=pgbouncer}"
: "${PGPORT:=6432}"
: "${PGUSER:=quart}"
: "${PGDATABASE:=quart}"
: "${BACKUP_DIR:=/tmp/backup}"
: "${BACKUP_KEEP_DAYS:=14}"
: "${BACKUP_GPG_PUBLIC_KEY_FILE:=/run/secrets/backup_gpg_public_key}"

mkdir -p "$BACKUP_DIR"
TS=$(date -u +%Y%m%dT%H%M%SZ)
DUMP="$BACKUP_DIR/quart-${TS}.sql.gz"
ENC="$BACKUP_DIR/quart-${TS}.sql.gz.gpg"

# 1. Dump
pg_dump --no-owner --no-privileges --format=custom -d "$PGDATABASE" | gzip > "$DUMP"

# 2. Encrypt with GPG (public key imported from secret mount; private key never on VPS)
gpg --batch --import "$BACKUP_GPG_PUBLIC_KEY_FILE"
gpg --batch --yes --trust-model always \
    --recipient quart-backup@quart.app \
    --encrypt "$DUMP" 2>/dev/null
mv "${DUMP}.gpg" "$ENC"
rm -f "$DUMP"

# 3. Push to local MinIO + offsite (Hetzner Storage Box via rclone)
mc alias set quart http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
mc cp "$ENC" quart/quart-backups/
rclone copy "$ENC" "${RCLONE_REMOTE}:${RCLONE_DEST}/" --progress

# 4. Retention
find "$BACKUP_DIR" -type f -mtime +"$BACKUP_KEEP_DAYS" -delete
mc rm --force --recursive --older-than "${BACKUP_KEEP_DAYS}d" quart/quart-backups/

# 5. Healthcheck stamp
echo "$(date -u +%FT%TZ) backup ok: $ENC" | tee -a /var/log/quart-backup.log