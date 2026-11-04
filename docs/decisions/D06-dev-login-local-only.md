# D6 · Dev login with username and password, local only

**Status:** accepted, not built yet · **Date:** 2026-11-03 · **Area:** identity

**Decision.** A BFF-side username and password form, enabled only by `AUTH_DEV_LOGIN=true` outside
production, that mints a normal session for a seeded synthetic persona and marks it `auth: 'dev'`. The
server refuses to start if the flag is set in production. Not built yet.

**Why.** Running the stack without the shared Keycloak container, and switching between `hillevi` and
`hassan` in seconds. Minting a real session rather than a special one keeps every downstream code path
honest.
