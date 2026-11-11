# Implementation status: identity and access

One page of [implementation status](../status.md). Each entry says what works in this checkout, what limits it or is still to do, and where the code and tests that show it are.

## Users and identity

**Works in this checkout.** Users, login and grants are core (D62). People, units and groups enter through the SCIM 2.0 server at `/scim/v2` (D68) behind a provisioner's token; the grant is derived from D68's group keys and D85's group-to-capability mapping, audited and rewritten in the same transaction as the change; a first login binds the OIDC subject by `OIDC_BINDING_CLAIM` to exactly one provisioned person; connector and model audiences match provisioned groups; Administration › Användare (`admin.users`) lists the people, holds the mapping and shows when each provisioner last called, with a warning after two days of silence. A key written wrong is refused (D96); requests sent in parallel are serialised per person and per group; a token is listed and rotated with a grace period by `scripts/provisioner-token.ts`, and `scripts/provisioner-check.ts` reads what a push left. The authorization fingerprint covers authority fields only, and the nightly scan runs for people who can sign in. Capabilities are the closed list `admin.connectors`, `admin.users`.

**Limits and pending work.** The active grant is the one assignment the person acts as (no switching); the `protected` key is refused at the boundary (D93), so nothing about it is stored, derived or shown; a silent provisioner is shown on the page but raises no alarm of its own, and there is no metric for it; tokens are managed by a script in the app container, with no administration page; only the synthetic provisioner (`scripts/provisioner/`, run by `auth:setup` and `dev:provision`) has pushed to the server, so Entra's and Metakatalogen's behaviour is covered by tests, not a tenant; the seed still creates the three person rows with the ids the fixtures and calendars key on; the Administration entry shows for either admin capability.

**Evidence.** [Identity](../../architecture/identity.md), [D68](../../decisions/D68-people-are-pushed-into-clew-through-standard-scim.md), [D85](../../decisions/D85-capabilities-are-mapped-from-provisioned-groups-in-clew.md), [provisioner guide](../../guides/writing-a-provisioner.md), [SCIM use cases](../../../apps/server/src/modules/people/usecases.ts), [tests](../../../tests/unit/scim.test.ts)

## User delegation

**Works in this checkout.** Manifest audience and session-backed token exchange; Eneo wrapper. On a connector declaring delegation, an approved write is dispatched and read back with the token of the person's session that approved it, while that session is active and theirs; the token is exchanged before the dispatch is recorded. A later session in which the person asks to check a sent write may stand behind its read-back only, never a dispatch or replay. A scan runs with the token of the session that last asked for the refresh (`X-Clew-Delegated-Token` on `POST /clew/scan`), only while the person has been active in that session within 15 minutes (`PRESENCE_MS`: sign-in or the page's last `POST /api/auth/activity`); a write has no activity bound. A person who comes back is scanned for on their next ask, which requeues a blocked request at once and clears its block. Session bindings are sealed in the execution and the refresh request (migration `0046_session_bindings`); audit rows name the session's role, never the binding or a token.

**Limits and pending work.** Figures, callbacks, the nightly scan and job watch steps get no delegated token. Without a live session (for a scan: one active within the window) a write stays pending with `needs-session` and a scan answers `authorization-required` (blocked, cards kept). A pending `needs-session` write is not resumed by a later sign-in; checked after 24 hours it fails as `approval-expired`. Not yet run against a real source or the development IdP (D101).

**Evidence.** [Exchange](../../../apps/server/src/auth-exchange.ts), [standing session](../../../apps/server/src/auth.ts), [ledger](../../../apps/server/src/modules/executions/usecases.ts), [refresh](../../../apps/server/src/threads/usecases/refresh.ts), [write tests](../../../tests/unit/delegated-executions.test.ts), [scan tests](../../../tests/unit/delegated-scans.test.ts), [Eneo](../../../connectors/eneo/README.md)

## Protocol 2 authority

**Works in this checkout.** RS256 installation assertions, pinned public keys, separate callback grants, transport key, current governance checks. Protocol 1 rejected.

**Limits and pending work.** Installations and connectors must upgrade together; this tree contains ongoing reliability work.

**Evidence.** [Authority](../../../apps/server/src/connectors/authority.ts), [authorization tests](../../../tests/unit/authorization-boundaries.test.ts), [D44](../../decisions/D44-authorized-reads-and-clew-signed-connector-authority.md)
