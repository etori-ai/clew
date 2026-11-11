#!/bin/sh
# Carry the development databases (Clew's and the calendar's) from the PostgreSQL 17 volume into the PostgreSQL 18
# one. Run once, on the host, after the stack has been recreated on PostgreSQL 18 and before anything writes to it:
# stop Clew's BFF and the calendar first. The old volume is read and never changed, so the way back is the old image.
set -eu
cd "$(dirname "$0")/.."
PROJECT=${COMPOSE_PROJECT_NAME:-clew}
OLD_VOLUME=${CLEW_POSTGRES_OLD_VOLUME:-${PROJECT}_postgres_data}
OLD_IMAGE=${CLEW_POSTGRES_OLD_IMAGE:-postgres:17.11-bookworm}
TARGET=${CLEW_POSTGRES_CONTAINER:-${PROJECT}-postgres-1}
if ! docker volume inspect "$OLD_VOLUME" >/dev/null 2>&1; then
  echo "No volume $OLD_VOLUME: nothing to carry over. Run bun run db:init for an empty database."
  exit 0
fi
major=$(docker exec "$TARGET" psql -U clew -d clew -Atc 'show server_version_num' | cut -c1-2)
if [ "$major" != 18 ]; then
  echo "$TARGET runs PostgreSQL $major, not 18. Recreate it first: sh scripts/compose.sh up -d postgres" >&2
  exit 1
fi
# Refuse a target that already holds Clew's tables: restoring over it would drop what is there.
if [ "$(docker exec "$TARGET" psql -U clew -d clew -Atc "select to_regclass('public.audit') is not null")" = t ]; then
  echo "$TARGET already has Clew's schema. Nothing was changed." >&2
  exit 1
fi
SOURCE="${PROJECT}-postgres-upgrade-source"
docker rm -f "$SOURCE" >/dev/null 2>&1 || true
trap 'docker rm -f "$SOURCE" >/dev/null 2>&1 || true' EXIT
# No network and no published port: the old server is reached only through its own socket.
docker run -d --name "$SOURCE" --network none -v "$OLD_VOLUME:/var/lib/postgresql/data" "$OLD_IMAGE" >/dev/null
tries=0
until docker exec "$SOURCE" pg_isready -U clew -d clew -h 127.0.0.1 >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -gt 60 ]; then
    echo "The PostgreSQL 17 server did not start on $OLD_VOLUME." >&2
    exit 1
  fi
  sleep 1
done
# Every database and role in one stream. The role the dump runs as cannot be dropped or created again; those two
# statements are skipped, and any other error stops the restore.
docker exec "$SOURCE" pg_dumpall -U clew --clean --if-exists |
  grep -v -e '^DROP ROLE IF EXISTS clew;$' -e '^CREATE ROLE clew;$' |
  docker exec -i -e PGOPTIONS='-c client_min_messages=warning' "$TARGET" psql -U clew -d postgres -q -v ON_ERROR_STOP=1 >/dev/null
docker stop "$SOURCE" >/dev/null
echo "Carried over from $OLD_VOLUME. Run bun run db:init, then start Clew. The old volume is unchanged; remove it with"
echo "docker volume rm $OLD_VOLUME once the new database has been checked."
