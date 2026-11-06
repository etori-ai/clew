# D62 · The development Keycloak runs in the app container's network, as a compose profile

**Status:** accepted · **Date:** 2026-11-06 · **Area:** platform

**Decision.** The development stack can run its own Keycloak, on every platform, so that `keycloak.localhost` is the
loopback address for every program that uses it and Keycloak is actually there.

1. `.devcontainer/compose.yaml` has a service `keycloak` under the profile `keycloak`: the pinned image
   `quay.io/keycloak/keycloak:26.2.5` (Apache-2.0), `start-dev` on port 3024, data in the volume `keycloak_data`, a
   readiness health check, and a local-only admin account like the stack's Postgres and Nextcloud. It sets
   `network_mode: "service:app"`, so it shares the app container's network namespace. The app service publishes
   `127.0.0.1:3024`, the next port in the stack's loopback range (3020 web, 3021 Nextcloud, 3022 Mailpit, 3023 Temporal
   UI); without the profile nothing answers there. `extra_hosts` maps `keycloak.localhost` to `127.0.0.1`.
2. The issuer is `http://keycloak.localhost:3024/realms/clew`. The browser on the host reaches it through the published
   port; inside the container Node (through `extra_hosts`), Bun and curl (which resolve every `*.localhost` name to
   loopback themselves) reach the same Keycloak on loopback.
3. `scripts/auth-setup.ts` treats a Keycloak on an HTTP loopback name as one in the app container's network: it calls
   the admin API on that address and gives Keycloak the BFF's own address, `http://127.0.0.1:3000`, for back-channel
   logout. The shared Keycloak on macOS (`keycloak.orb.local`) and one on HTTPS keep the host addresses
   (`host.docker.internal:8090` and `:3020`); `KEYCLOAK_ADMIN_URL` still overrides the admin address.
4. Keycloak joins the app container's network when it starts. When the app container restarts on its own (a
   `docker restart`, or a recreation by `compose up` without the profile), Keycloak keeps the old namespace and nothing
   reaches it, while its health check still passes; `sh scripts/compose.sh --profile keycloak restart keycloak` brings
   it back. Starting both with `sh scripts/compose.sh --profile keycloak up -d --wait` avoids it.
5. The shared Keycloak on macOS remains supported unchanged; the profile is opt in.

**Why.** D60 made the address a setting and mapped `keycloak.localhost` to the host's port 8090. That worked for the
browser and for the BFF on Node, but Bun and curl resolve `*.localhost` to loopback whatever `/etc/hosts` says, so in
the container they reached nothing: `scripts/auth-exchange-check.ts` failed with `ECONNREFUSED`. It also relied on
`host-gateway` reaching a port published on the host's loopback, which Docker Desktop does and Docker Engine on Linux
does not. Making every program follow a different rule was not possible; putting Keycloak where the name already
points was. Measured on Windows 11 with Docker Desktop, 2026-11-06: a throwaway Keycloak in the app container's network
answered Bun and curl on `keycloak.localhost`; with the profile, a sign-in through the BFF (Node), the token exchange
check on Bun (`OK`), the Keycloak form in the browser, and a back-channel logout from Keycloak to `127.0.0.1:3000` that
ended the Clew session all worked. A Keycloak user with three sessions logged out through the admin API produced one
back-channel call, for the oldest session; that is recorded as an open question, not explained here.

Weighed and rejected: running the check on Node instead of Bun, which fixes one script and none of the rest;
`localhost:3024` as the issuer, which would put Keycloak's and Clew's cookies in one host's cookie jar (cookies are
not separated by port); a public wildcard name that resolves to `127.0.0.1` (such as `*.localtest.me`), which makes the
stack depend on someone else's DNS; and port 8090, which would collide with the shared Keycloak on a Mac that publishes
it.

**Replaces.** D60 item 3: `keycloak.localhost` no longer maps to the host, and a Keycloak started by hand on the host's
port 8090 is not reached by that name. The shared Keycloak on macOS keeps D60's address.
