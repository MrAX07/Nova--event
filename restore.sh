#!/usr/bin/env bash
# Gendanner en sikkerhedskopi: bash scripts/restore.sh backups/filnavn.sql
set -euo pipefail
cd "$(dirname "$0")/.."
[ $# -ge 1 ] || { echo "Brug: bash scripts/restore.sh backups/filnavn.sql"; exit 1; }
set -a; source .env; set +a
read -p "⚠️  Dette overskriver data i databasen. Skriv JA for at fortsætte: " ok
[ "$ok" = "JA" ] || { echo "Afbrudt."; exit 1; }
psql "$DATABASE_URL" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
psql "$DATABASE_URL" < "$1"
echo "✅ Databasen er gendannet. Genstart botten."
