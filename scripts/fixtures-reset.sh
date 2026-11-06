#!/bin/sh
# Forget every fixture connector's records and decisions and seed them again from today, then close the cards they had
# pushed into Clew. Works from the host and from inside the app container (compose.sh finds the daemon either way).
set -eu
cd "$(dirname "$0")/.."
SERVICES="hr finance incidents communication timesheet payroll"
PROJECT=${COMPOSE_PROJECT_NAME:-clew}
sh scripts/compose.sh rm -sf $SERVICES >/dev/null
for s in $SERVICES; do docker volume rm "${PROJECT}_${s}_state" >/dev/null 2>&1 || true; done
sh scripts/compose.sh up -d $SERVICES
if [ -f /.dockerenv ]; then bun scripts/dev-reset.ts; else docker exec -w /workspace clew-app-1 bun scripts/dev-reset.ts; fi
