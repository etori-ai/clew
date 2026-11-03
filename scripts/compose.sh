#!/bin/sh
# Use the host daemon from either the host or the devcontainer terminal.
set -eu
cd "$(dirname "$0")/.."
if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker is not available. Run Dev Containers: Rebuild Container and try again.' >&2
  exit 1
fi
if [ -f /.dockerenv ] && [ -z "${CLEW_HOST_WORKSPACE:-}" ]; then
  # docker exec does not inherit VS Code remoteEnv. Discover the real bind source.
  CLEW_HOST_WORKSPACE=$(docker inspect "$(hostname)" --format '{{range .Mounts}}{{if eq .Destination "/workspace"}}{{.Source}}{{end}}{{end}}')
  if [ -z "$CLEW_HOST_WORKSPACE" ]; then
    echo 'Could not find the host workspace folder. Set CLEW_HOST_WORKSPACE.' >&2
    exit 1
  fi
  export CLEW_HOST_WORKSPACE
fi
exec docker compose -f .devcontainer/compose.yaml "$@"
