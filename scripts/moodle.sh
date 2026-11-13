#!/bin/sh
# Container lifecycle of the development Moodle, from the host or the devcontainer. Provisioning runs in containers.
set -eu
cd "$(dirname "$0")/.."
compose() { sh scripts/compose.sh --profile moodle "$@"; }
case "${1:-}" in
  start)
    compose up -d --wait postgres
    pg=$(compose ps -q postgres)
    # The learning platform's own database, not Clew's Drizzle-managed application schema.
    docker exec -i "$pg" psql -U clew -d postgres -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'CREATE ROLE clew_moodle LOGIN PASSWORD ''moodle-local-only'''
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'clew_moodle')\gexec
SELECT 'CREATE DATABASE clew_moodle OWNER clew_moodle ENCODING ''UTF8'' TEMPLATE template0'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'clew_moodle')\gexec
SQL
    # The container installs Moodle into an empty database as it starts, which takes a minute or two, and upgrades an
    # installed one. It is recreated on every start, so a database that was made again under a running container (a
    # new PostgreSQL volume) is installed into and not left empty.
    compose up -d --build --wait --force-recreate moodle
    sh "$0" seed
    ;;
  seed)
    moodle=$(compose ps -q moodle)
    if [ -z "$moodle" ]; then
      echo 'Moodle is not running. Run: sh scripts/moodle.sh start' >&2
      exit 1
    fi
    pg=$(compose ps -q postgres)
    if [ "$(docker exec "$pg" psql -U clew -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = 'clew_moodle'")" != 1 ]; then
      echo 'The database clew_moodle is not there (a new PostgreSQL volume?). Run: sh scripts/moodle.sh start' >&2
      exit 1
    fi
    # Everyone on Hillevi's unit gets an account, and who that is comes from the development directory: the app
    # container prints the list (the same one the calendar seed uses), the seed creates the rest.
    app=$(compose ps -q app)
    unit_people=''
    if [ -n "$app" ]; then unit_people=$(docker exec -w /workspace "$app" bun scripts/calendar-seed.ts --unit-people); fi
    docker exec -u www-data -e CLEW_MOODLE_PEOPLE="$unit_people" "$moodle" php /opt/clew-moodle/seed.php
    ;;
  reset)
    # Synthetic data only: the database and the files go, and the next start installs from nothing.
    compose rm -sf moodle
    pg=$(compose ps -q postgres)
    docker exec "$pg" psql -U clew -d postgres -v ON_ERROR_STOP=1 -c 'DROP DATABASE IF EXISTS clew_moodle WITH (FORCE)'
    docker volume rm -f "$(compose config --format json | sed -n 's/.*"name": "\([a-z0-9_-]*_moodle_data\)".*/\1/p' | head -1)"
    ;;
  stop) compose stop moodle ;;
  status) compose ps moodle ;;
  *) echo 'Usage: sh scripts/moodle.sh start|seed|reset|stop|status' >&2; exit 2 ;;
esac
