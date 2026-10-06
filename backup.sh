#!/usr/bin/env bash
# Laver en sikkerhedskopi af databasen: bash scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
mkdir -p backups
FILE="backups/nova-events-$(date +%Y-%m-%d_%H-%M).sql"
pg_dump "$DATABASE_URL" --no-owner --no-privileges > "$FILE"
echo "✅ Sikkerhedskopi gemt: $FILE"
