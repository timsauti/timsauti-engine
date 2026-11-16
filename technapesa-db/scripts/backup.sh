#!/usr/bin/env bash
# Copies the whole TECH na PESA staging database into the private vault repository.
# Needs: a linked project (supabase link), SUPABASE_DB_PASSWORD, and the vault cloned at $VAULT_DIR.
# Nothing is printed except file sizes, so the public run log never shows data.
set -euo pipefail
: "${VAULT_DIR:?}"; : "${SUPABASE_DB_PASSWORD:?}"
LABEL="${1:-nightly}"
STAMP="$(date -u +%Y-%m-%dT%H%MZ)"
OUT="$VAULT_DIR/technapesa/backups/$STAMP-$LABEL"
mkdir -p "$OUT"
CLI="npx -y supabase@2.122.0"
$CLI db dump --linked -p "$SUPABASE_DB_PASSWORD" --role-only -f "$OUT/roles.sql" >/dev/null 2>&1
$CLI db dump --linked -p "$SUPABASE_DB_PASSWORD" -f "$OUT/schema.sql" >/dev/null 2>&1
$CLI db dump --linked -p "$SUPABASE_DB_PASSWORD" --data-only --use-copy --schema public,auth,storage -f "$OUT/data.sql" >/dev/null 2>&1
for f in roles schema data; do
  test -s "$OUT/$f.sql" || { echo "backup failed: $f is empty"; exit 1; }
  gzip -9 "$OUT/$f.sql"
done
grep -c . <(zcat "$OUT/schema.sql.gz") >/dev/null
cat > "$OUT/README.txt" <<TXT
TECH na PESA database backup, $STAMP ($LABEL)
Restore into an empty Supabase project (see technapesa-db/README.md in timsauti-engine):
  psql "\$DB_URL" -f <(zcat roles.sql.gz)
  psql "\$DB_URL" -f <(zcat schema.sql.gz)
  psql "\$DB_URL" -c "set session_replication_role = replica" -f <(zcat data.sql.gz)
TXT
ls -l "$OUT" | awk 'NR>1 {print $5, $9}'
# Keep the newest 30 nightly copies in the working tree; older ones stay in git history.
ls -d "$VAULT_DIR"/technapesa/backups/*-nightly 2>/dev/null | sort | head -n -30 | xargs -r rm -rf
echo "backup saved: technapesa/backups/$STAMP-$LABEL"
