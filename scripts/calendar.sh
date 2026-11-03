#!/bin/sh
# Container lifecycle from the host or devcontainer. Provisioning runs in containers.
set -eu
cd "$(dirname "$0")/.."
compose() { sh scripts/compose.sh --profile calendar "$@"; }
case "${1:-}" in
  start)
    compose up -d --wait postgres
    pg=$(compose ps -q postgres)
    # Provider infrastructure, not Clew's Drizzle-managed application schema.
    docker exec -i "$pg" psql -U clew -d postgres -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'CREATE ROLE clew_calendar LOGIN PASSWORD ''calendar-local-only'''
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'clew_calendar')\gexec
SELECT 'CREATE DATABASE clew_calendar OWNER clew_calendar'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'clew_calendar')\gexec
SQL
    compose up -d --build --wait calendar calendar-mail
    sh "$0" seed
    ;;
  seed)
    nc=$(compose ps -q calendar)
    test -n "$nc"
    docker exec -u www-data -w /var/www/html "$nc" php occ app:enable calendar roomvox
    docker exec -u www-data -w /var/www/html "$nc" php occ config:app:set roomvox telemetry_enabled --value=false
    docker exec -u www-data -w /var/www/html "$nc" php occ config:app:set dav sendInvitations --value=yes
    docker exec -u www-data -w /var/www/html "$nc" php /opt/clew-calendar/seed.php
    app=$(compose ps -q app)
    if [ -n "$app" ]; then docker exec -w /workspace "$app" bun scripts/calendar-seed.ts; fi
    ;;
  stop) compose stop calendar calendar-mail ;;
  status) compose ps calendar calendar-mail ;;
  *) echo 'Usage: sh scripts/calendar.sh start|seed|stop|status' >&2; exit 2 ;;
esac
