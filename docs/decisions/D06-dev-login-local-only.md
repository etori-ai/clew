# D6 · Dev login with username and password, local only

**Status:** proposed, amended 2026-11-11 by Oliver Borgström and built: the sign-in page lists the development personas and signs one in with a click, through the local Keycloak, instead of a form that bypasses Keycloak · **Date:** 2026-11-03 · **Area:** identity

**Decision (2026-11-03).** A BFF-side username and password form, enabled only by `AUTH_DEV_LOGIN=true` outside
production, that mints a normal session for a seeded synthetic persona and marks it `auth: 'dev'`. The
server refuses to start if the flag is set in production.

**Why.** Running the stack without the shared Keycloak container, and switching between `hillevi` and
`hassan` in seconds. Minting a real session rather than a special one keeps every downstream code path
honest.

## Amendment, 2026-11-11

Oliver Borgström asked for the personas as a list on the sign-in page, so a developer picks one instead of typing a
username and a password. Built as:

1. **A list, not a form.** With `AUTH_DEV_LOGIN=true` the sign-in page shows "Logga in som" under the ordinary "Logga
   in", one link per persona (`GET /api/auth/dev` names them; `GET /api/auth/dev/login?as=<userName>&returnTo=…` signs
   in). With the flag off both answer 404 and the page is as before.
2. **Through Keycloak, not around it.** The BFF asks the local Keycloak for the persona's tokens with the persona's
   test password (OAuth's password grant, enabled on `clew-web` by `scripts/auth-setup.ts`, which only ever configures
   the development realm). The passwords are the ones `auth:setup` already generates; it writes them to the ignored
   `apps/server/.env.local` as `AUTH_DEV_ACCOUNTS`, with `AUTH_DEV_LOGIN=true` unless a developer has set it otherwise.
   The original's session without the identity provider would hold no IdP token, and the delegated token exchange
   (D26) that Nextcloud's Approval app (D101), SupportManagement (D89) and Eneo need would fail in it. With real
   tokens, binding (D68 item 6), refresh, delegation and logout are those of any session.
3. **Marked in the audit, not the session.** The session row is an ordinary one; its `auth_audit` row says
   `login-dev` instead of `login`. No `auth: 'dev'` column was added.
4. **Local only, enforced at start.** The server refuses to start with `AUTH_DEV_LOGIN=true` unless the
   configuration is the local stack's (`AUTH_LOCAL_HTTP=true`, a localhost `PUBLIC_URL` and the issuer at
   `keycloak.orb.local`), the same test that allows plain HTTP. The sign-in link refuses a cross-site request, as
   `/api/auth/login` does.

**What it gives up.** The stack still needs Keycloak running; signing in without it, the original's first reason, is
not covered.

**Status.** Proposed: the amendment departs from the record as it was accepted and has not been confirmed by its
author or the product owner.
