#!/bin/bash
# =============================================================================
# PostgreSQL Backup to Cloud Storage
# =============================================================================
# Usage: ./backup-postgres.sh [database_name]
# Cron example (daily at 2:30 AM):
#   30 2 * * * /path/to/backup-postgres.sh >> /var/log/pg-backup.log 2>&1
# =============================================================================

set -euo pipefail

# --- Configuration ---
PROJECT_ID="wudong-agent-master"
INSTANCE_NAME="wd-agents-pg"
BUCKET="gs://wd-agents-storage-bucket/backups/postgres"
DB_NAME="${1:-app-db}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DATE_DIR="$(date +%Y/%m/%d)"
BACKUP_FILE="${DB_NAME}-${TIMESTAMP}.sql.gz"
BACKUP_PATH="${BUCKET}/${DATE_DIR}/${BACKUP_FILE}"
RETENTION_DAYS=30

echo "=== PostgreSQL Backup Started at $(date) ==="
echo "Database: ${DB_NAME}"
echo "Backup:   ${BACKUP_PATH}"

# --- Export from Cloud SQL to Cloud Storage ---
# Uses gcloud sql export which exports directly to GCS (no local disk needed)
gcloud sql export sql "${INSTANCE_NAME}" "${BACKUP_PATH}" \
  --project="${PROJECT_ID}" \
  --database="${DB_NAME}" \
  --offload

EXPORT_STATUS=$?
if [ $EXPORT_STATUS -eq 0 ]; then
  echo "✅ Export succeeded: ${BACKUP_PATH}"
else
  echo "❌ Export failed with status ${EXPORT_STATUS}"
  exit 1
fi

# --- Cleanup old backups (keep last N days) ---
echo "--- Cleaning up backups older than ${RETENTION_DAYS} days ---"
gsutil ls "${BUCKET}/**/*.sql.gz" 2>/dev/null | while read -r file; do
  if gsutil stat "${file}" 2>/dev/null | grep -q "Creation time:"; then
    created=$(gsutil stat "${file}" 2>/dev/null | grep "Creation time:" | sed 's/Creation time://')
    created_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$(echo $created | cut -d'.' -f1)" "+%s" 2>/dev/null || echo 0)
    cutoff=$(( $(date +%s) - (RETENTION_DAYS * 86400) ))
    if [ "$created_epoch" -lt "$cutoff" ] && [ "$created_epoch" -gt 0 ]; then
      echo "  🗑  Deleting old backup: ${file}"
      gsutil rm "${file}"
    fi
  fi
done

echo "=== Backup Completed at $(date) ==="
