#!/usr/bin/env bash
# Applies all Supabase migrations to a throwaway local PostgreSQL cluster and
# runs the SQL policy/integrity tests in supabase/tests/*.test.sql.
# Requires PostgreSQL 15+ server binaries (initdb, pg_ctl) on PATH or in
# /usr/lib/postgresql/<version>/bin.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PATH="$PGBIN:$PATH"
WORK="$(mktemp -d)"
PORT="${TEST_DB_PORT:-54329}"
cleanup() { pg_ctl -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

if [ "$(id -u)" = "0" ]; then
  echo "Run as a non-root user (PostgreSQL refuses to run as root)." >&2
  exit 1
fi
initdb -D "$WORK/data" -U postgres -A trust >/dev/null
pg_ctl -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" start >/dev/null
PSQL=(psql -h "$WORK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -c "create database trustos_test" >/dev/null
PSQL+=(-d trustos_test)

"${PSQL[@]}" -f "$ROOT/supabase/tests/_supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migrate: $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
"${PSQL[@]}" -f "$ROOT/supabase/tests/_grants.sql"

status=0
for t in "$ROOT"/supabase/tests/*.test.sql; do
  echo "test: $(basename "$t")"
  if ! "${PSQL[@]}" -f "$t"; then status=1; fi
done
[ $status -eq 0 ] && echo "All database tests passed." || echo "Database tests FAILED." >&2
exit $status
