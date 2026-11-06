# D60 · The dev identity provider's address is configured, and "local" means a loopback name

**Status:** accepted, item 3 replaced by [D62](D62-the-dev-keycloak-runs-in-the-app-containers-network.md) the same day · **Date:** 2026-11-06 · **Area:** identity

**Decision.** The address of the development Keycloak is a setting, not a constant, and the rule that lets sign-in run
over plain HTTP accepts a set of local host names instead of one.

1. `isLocalIssuerHost` in `apps/server/src/auth-local.ts` is the one rule for which issuer host may be reached over
   HTTP: `localhost`, `127.0.0.1`, `[::1]`, any name under `.localhost` (RFC 6761), and `keycloak.orb.local`, kept for
   the existing OrbStack setups. `authSettings` in `apps/server/src/auth.ts` uses it. The other two conditions stay as
   they were: `AUTH_LOCAL_HTTP=true` and a public URL on `localhost` or `127.0.0.1`. Anything else needs HTTPS for both
   Clew and the identity provider.
2. `scripts/auth-setup.ts` takes the Keycloak address people's browsers use from `KEYCLOAK_PUBLIC_URL`, then from the
   issuer already in `apps/server/.env.local`, then falls back to `http://keycloak.orb.local:8090`. It refuses an HTTP
   address that the rule in item 1 would reject, so a setup that cannot sign in fails at setup, not at the first login.
3. The dev compose stack maps `keycloak.localhost` to the host in the app container (`extra_hosts` in
   `.devcontainer/compose.yaml`), beside `keycloak.orb.local`. Browsers resolve every `*.localhost` name to the loopback
   address themselves, so `KEYCLOAK_PUBLIC_URL=http://keycloak.localhost:8090` works with a Keycloak published on the
   host's port 8090 and no change to the system's hosts file. Verified on Windows with Docker Desktop; the steps are in
   `docs/maintainers/local-development.md`. Inside the container only Node honours that mapping, which is enough for
   the BFF (D16). Bun and curl resolve every `*.localhost` name to loopback themselves, so
   `scripts/auth-exchange-check.ts`, which exchanges a token in its own Bun process, still needs `keycloak.orb.local` or
   an HTTPS issuer.
4. The login smoke scripts (`scripts/auth-dev-check.ts`, `scripts/auth-exchange-check.ts`) recognise the Keycloak
   form by the configured issuer's origin, not by a host name.

**Why.** The issuer must be the same string for the browser, which is sent to it to sign in, and for the BFF in the
app container, which discovers it and checks `iss` in every token. `localhost` cannot serve both, since inside the
container it is the container. The stack was written on macOS with OrbStack, where a container named `keycloak` is
reachable from the Mac as `keycloak.orb.local`, and that name was written into the setup script, the check scripts and
the HTTP rule in `authSettings`. On Windows with Docker Desktop (session 2026-11-06) the name resolves nowhere on the
host, the only fix was an administrator's edit of the system hosts file, and changing `OIDC_ISSUER` did not help
because the HTTP rule then refused every login.

The HTTP rule exists so that a production configuration never signs people in without TLS by mistake; it was kept and
widened only to names that cannot be a production host. `.localhost` is reserved for loopback and never delegated in
public DNS. A free setting such as an allow-list in an environment variable was weighed and rejected: the variable
would sit beside `AUTH_LOCAL_HTTP` in the same file, and one wrong value would turn the guard off. `host.docker.internal`
was weighed as the shared name and rejected: on Windows it points at the machine's network address, so Keycloak would
have to listen on the network, and macOS does not resolve it outside containers.

**Replaces.** The hard-coded `keycloak.orb.local` in `scripts/auth-setup.ts`, in the HTTP rule in
`apps/server/src/auth.ts` and in the two check scripts, carried over from startsidan in the first commit. D5 is
unchanged: Keycloak is still the identity provider; only how the development stack finds it changes.
