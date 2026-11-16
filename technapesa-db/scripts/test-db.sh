#!/usr/bin/env bash
# Runs every migration and the database tests against a throwaway local PostgreSQL with PostGIS.
# Usage: scripts/test-db.sh   (needs PostgreSQL 16 + PostGIS installed locally)
set -euo pipefail
cd "$(dirname "$0")/.."
BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
DIR=$(mktemp -d); PORT=${PG_PORT:-54329}
cleanup() { "$BIN/pg_ctl" -D "$DIR" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
RUNAS=""; if [ "$(id -u)" = "0" ]; then chown -R postgres "$DIR"; RUNAS="sudo -u postgres"; fi
$RUNAS "$BIN/initdb" -D "$DIR" -U postgres -A trust >/dev/null
$RUNAS "$BIN/pg_ctl" -D "$DIR" -o "-p $PORT -k /tmp -c listen_addresses=''" -l "$DIR/log" start >/dev/null
export PGHOST=/tmp PGPORT=$PORT PGUSER=postgres
createdb tnp
run() { psql -q -v ON_ERROR_STOP=1 -d tnp -f "$1" >/dev/null; }
run supabase/tests/supabase_stub.sql
for f in supabase/migrations/*.sql; do echo "migration $(basename "$f")"; run "$f"; done
for f in supabase/tests/*.test.sql; do echo "test $(basename "$f")"; psql -q -v ON_ERROR_STOP=1 -d tnp -o /dev/null -f "$f" 2>&1 | sed "s/^psql:[^ ]* NOTICE:  /  /"; [ "${PIPESTATUS[0]}" = 0 ] || exit 1; done
echo "all database tests passed"
