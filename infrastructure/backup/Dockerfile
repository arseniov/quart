FROM postgres:16-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
        gnupg rclone ca-certificates tini mc \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/backup.sh /usr/local/bin/backup.sh
COPY crontab /etc/cron.d/quart-backup
RUN chmod 0644 /etc/cron.d/quart-backup && chmod +x /usr/local/bin/backup.sh

ENV BACKUP_KEEP_DAYS=14
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["cron", "-f"]