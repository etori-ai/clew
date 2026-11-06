#!/bin/sh
# The local fake of Microsoft Graph (D69), the `graph` service of the base stack. It seeds its own meetings and rooms as
# it starts; state lives in memory, so `seed` restarts it for a fresh seed from today.
set -eu
cd "$(dirname "$0")/.."
compose() { sh scripts/compose.sh "$@"; }
case "${1:-}" in
  start) compose up -d --wait graph ;;
  seed) compose restart graph && compose up -d --wait graph ;;
  stop) compose stop graph ;;
  status) compose ps graph ;;
  *) echo 'Usage: sh scripts/graph.sh start|seed|stop|status' >&2; exit 2 ;;
esac
