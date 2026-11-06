#!/bin/sh
# The local fake of Microsoft Graph (D69). State lives in memory, so a restart empties it and `start` seeds it again.
set -eu
cd "$(dirname "$0")/.."
compose() { sh scripts/compose.sh --profile graph "$@"; }
case "${1:-}" in
  start)
    compose up -d --wait graph
    sh "$0" seed
    ;;
  seed)
    app=$(compose ps -q app)
    test -n "$app"
    docker exec -e CALENDAR_ADAPTER=microsoft365 -w /workspace "$app" bun scripts/calendar-seed.ts
    ;;
  stop) compose stop graph ;;
  status) compose ps graph ;;
  *) echo 'Usage: sh scripts/graph.sh start|seed|stop|status' >&2; exit 2 ;;
esac
