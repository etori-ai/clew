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
    docker exec -u www-data -w /var/www/html "$nc" php occ app:enable calendar roomvox files_sharing user_oidc approval
    docker exec -u www-data -w /var/www/html "$nc" php occ config:app:set roomvox telemetry_enabled --value=false
    docker exec -u www-data -w /var/www/html "$nc" php occ config:app:set dav sendInvitations --value=yes
    # Everyone on Hillevi's unit gets a calendar account (the planner refuses to plan around an unreadable one), and
    # who that is comes from the development directory: the app container prints the list, the seed creates the rest.
    app=$(compose ps -q app)
    unit_people=''
    if [ -n "$app" ]; then unit_people=$(docker exec -w /workspace "$app" bun scripts/calendar-seed.ts --unit-people); fi
    docker exec -u www-data -w /var/www/html -e CLEW_CALENDAR_UNIT_PEOPLE="$unit_people" "$nc" php /opt/clew-calendar/seed.php
    # Approval (D101) is called as the person with the token Clew exchanges for the audience `nextcloud`
    # (scripts/auth-setup.ts). user_oidc checks its signature, issuer, expiry and that `aud` holds the client id, and
    # names the existing account by `preferred_username`; with auto_provision off a token naming no account is refused
    # instead of creating one. Nextcloud never runs a login with this provider, so the client secret is never used.
    docker exec -u www-data -w /var/www/html "$nc" php occ config:system:set user_oidc auto_provision --type=boolean --value=false
    docker exec -u www-data -w /var/www/html "$nc" php occ user_oidc:provider keycloak --clientid=nextcloud \
      --clientsecret=unused-bearer-validation-only \
      --discoveryuri=http://keycloak.orb.local:8090/realms/clew/.well-known/openid-configuration \
      --check-bearer=1 --bearer-provisioning=0 --unique-uid=0 --mapping-uid=preferred_username
    docker exec -u www-data -w /var/www/html "$nc" php /opt/clew-calendar/approval-seed.php
    if [ -n "$app" ]; then docker exec -w /workspace "$app" bun scripts/calendar-seed.ts; fi
    ;;
  reset)
    # Synthetic data only. Nextcloud upgrades one major version at a time, so a volume made by an image two or more
    # majors older does not start under this one: remove the volume and Nextcloud's database, then `start` again.
    compose rm -sf calendar >/dev/null
    volume="${COMPOSE_PROJECT_NAME:-clew}_calendar_data"
    if docker volume inspect "$volume" >/dev/null 2>&1; then docker volume rm "$volume" >/dev/null; fi
    compose up -d --wait postgres
    docker exec -i "$(compose ps -q postgres)" psql -U clew -d postgres -v ON_ERROR_STOP=1 -q \
      -c 'DROP DATABASE IF EXISTS clew_calendar WITH (FORCE)'
    echo 'The calendar is empty. Run sh scripts/calendar.sh start to create and seed it again.'
    ;;
  stop) compose stop calendar calendar-mail ;;
  status) compose ps calendar calendar-mail ;;
  *) echo 'Usage: sh scripts/calendar.sh start|seed|reset|stop|status' >&2; exit 2 ;;
esac
