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
# The development Keycloak's administrator password is the workstation's own, never a default anyone can read: generated
# on the first run into .devcontainer/.env, which compose reads beside compose.yaml and git ignores, and kept there.
ENV_FILE=.devcontainer/.env
has_password() { grep -q '^CLEW_DEV_KEYCLOAK_ADMIN_PASSWORD=.' "$ENV_FILE" 2>/dev/null; }
if [ -z "${CLEW_DEV_KEYCLOAK_ADMIN_PASSWORD:-}" ] && ! has_password; then
  # The editor and a terminal can start the same checkout together. Only one writes its first password.
  (
    umask 077
    lock="$ENV_FILE.init-lock"
    waited=0
    until mkdir "$lock" 2>/dev/null; do
      if has_password; then exit 0; fi
      if [ "$waited" -ge 10 ]; then
        echo "Could not prepare $ENV_FILE. Check whether another setup is running or $lock was left behind." >&2
        exit 1
      fi
      waited=$((waited + 1))
      sleep 1
    done
    trap 'rmdir "$lock"' EXIT
    trap 'exit 1' HUP INT TERM
    if has_password; then exit 0; fi
    if [ -s "$ENV_FILE" ] && [ -n "$(tail -c 1 "$ENV_FILE")" ]; then echo >>"$ENV_FILE"; fi
    password=$(od -An -tx1 -N24 /dev/urandom | tr -d ' \n')
    [ "${#password}" -eq 48 ]
    : >>"$ENV_FILE"
    chmod 600 "$ENV_FILE"
    printf 'CLEW_DEV_KEYCLOAK_ADMIN_PASSWORD=%s\n' "$password" >>"$ENV_FILE"
    echo "Generated this workstation's Keycloak administrator password in $ENV_FILE." >&2
  )
fi
exec docker compose -f .devcontainer/compose.yaml "$@"
