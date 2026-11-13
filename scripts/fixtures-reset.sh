#!/bin/sh
# Explicit development reset: stop Clew's BFF/worker first. Only fixture source volumes are erased.
set -eu
cd "$(dirname "$0")/.."
SERVICES="hr finance incidents communication timesheet payroll servicedesk"
STATEFUL="hr finance incidents communication timesheet servicedesk"
PROJECT=${COMPOSE_PROJECT_NAME:-clew}
dev_reset() {
  if [ -f /.dockerenv ]; then bun scripts/dev-reset.ts "$@";
  else docker exec -w /workspace clew-app-1 bun scripts/dev-reset.ts "$@"; fi
}
# Refuse before stopping or deleting anything unless the development server/worker is stopped.
dev_reset --check
# Check Docker access before changing service or ledger state.
volumes=$(docker volume ls --format '{{.Name}}')
sh scripts/compose.sh stop $SERVICES
dev_reset --sources-stopped
sh scripts/compose.sh rm -f $SERVICES >/dev/null
for service in $STATEFUL; do
  volume="${PROJECT}_${service}_state"
  if printf '%s\n' "$volumes" | grep -Fxq "$volume"; then
    # A failed removal must fail the reset, not silently retain old records and deduplication results.
    docker volume rm "$volume" >/dev/null
  fi
done
sh scripts/compose.sh up -d $SERVICES
echo 'Fixture storage is fresh and old work is retired. Start Clew again; existing connector settings are preserved.'
