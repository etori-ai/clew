# Identity and authorization

Clew separates **login identity**, **local permission**, **connector authority** and **source credentials**. Passing one boundary does not bypass the next. This page describes the current implementation; exact connector claims and verification instructions are in [Authorization](../guides/authorization.md).

## Browser to Clew

The [authentication implementation](../../apps/server/src/auth.ts) uses OIDC Authorization Code with PKCE. Development uses Keycloak. The server keeps tokens sealed in its database; the browser receives an opaque, HttpOnly session cookie and the session's CSRF token for mutations.

Login validates state/nonce and resolves the verified issuer and subject through an existing local identity binding. The person must be enabled and have a local access grant. A matching display name or email is not a substitute for that binding. Login does not create a user on demand.

The current session policy has eight-hour idle and absolute limits. Mutation requests check the allowed origin and CSRF token; back-channel logout validates the identity provider's signature. The authoritative behavior is in [auth.ts](../../apps/server/src/auth.ts), [auth-origin.ts](../../apps/server/src/auth-origin.ts) and [database authentication helpers](../../packages/db/src/auth.ts).

## Clew's local authority

An authenticated context carries the person, organisation, current unit/role, grant capabilities, authorization version and session binding. Its `authorize()` rechecks the current grant/session rather than trusting an earlier UI response.

The current data model has one grant per person, one unit and two broad roles, `manager` and `employee`. Administrative capability `admin.connectors` is separate from the role name. Connector governance further narrows access by enabled state, audience, capability switches and tool/scan/figure settings.

Users and grants are core entities. Their internal `people.*` reads share dispatch but cannot be disabled as a connected system. They describe Clew's users, not the full employee directory.

## Clew to a connector

Protocol 2 requires both:

1. `X-Clew-Connector-Key`: the per-registration transport secret.
2. `Authorization: Bearer ...`: a short-lived RS256 assertion signed by Clew, bound to the connector's audience and the acting person.

Only Clew holds the signing private key. The connector pins its trusted Clew base URL and fetches public keys from `/api/connectors/jwks`. It takes the actor from verified claims, never from an unverified body. The transport secret cannot sign identity.

The connector still maps that actor to the source's person/unit and enforces record-level access. Clew's `manager` role is not permission to read every source unit. A ref is not an access token.

See [the verifier](../../connectors/hello/verification.mjs), [signing authority](../../apps/server/src/connectors/authority.ts) and [authorization guide](../guides/authorization.md) for key rotation and exact claims.

## Connector callbacks

A connector declares exact target capabilities in `uses`. Clew can include a separate callback grant in the verified assertion. The connector sends that grant, not the original assertion, to `POST /api/connectors/call`.

Clew reconstructs current person/assignment access, checks origin and target governance and declared dependencies, and refuses executes, cycles and chains beyond the supported bound. A callback grant is short-lived request authority, not a credential for a later background job.

## Source authentication and background work

A source can use a service credential narrowed to the actor, a bound personal credential or an audience-bound delegated token. The Clew assertion does not itself authenticate to the source.

For interactive calls, a connector declaring `delegation` can receive `X-Clew-Delegated-Token` after session-backed IdP token exchange. The source must accept that issuer/audience and enforce its own permissions.

Background work uses [systemContext](../../apps/server/src/system-context.ts), built from the person's current local grant. It carries no session tokens. Scans, figures and callbacks do not receive a delegated token. Generic durable execution records a connector declaring delegation as needing a session and can remain pending with `needs-session`; there is no complete sign-in-and-resume action path.

A valid delegated search therefore does not prove the source can support unattended scans, watches or actions. Establish and test the source's background authorization arrangement before enabling those features.

## Retained data and revocation

Clew rechecks authority before releasing protected results. Persisted source cards/messages retain the authority that produced them; a new unit assignment or renewed grant does not make the old snapshot readable. Legacy snapshots without provenance are hidden, and fresh scans create new authorized projections.

Source-only permission changes still need an explicit revocation path into Clew's grant or connector access before persisted scans are enabled. Live source reads must enforce current source permissions too. The browser clears retained state on authorization changes, but data already delivered cannot be recalled.

See [D75](../decisions/D75-source-snapshots-retain-the-authority-that-produced-them.md), [shared authorized reads](../../apps/server/src/threads/access.ts) and [authorization tests](../../tests/unit/authorization-boundaries.test.ts).

## Identity designs not yet implemented

[SCIM provisioning](../decisions/D68-people-are-pushed-into-clew-through-standard-scim.md) is the intended inbound user/group path. It is not an available endpoint, and current grants are not derived from a running SCIM group feed. Development setup seeds synthetic users, bindings and grants.

Multiple simultaneous assignments, a dedicated users administration UI, local dev-login without the IdP, a public MCP OAuth surface and cross-domain ID-JAG exchange are not implemented. Their early rationale remains in [identity decisions](../decisions/D05-oidc-and-oauth-only-identification-path.md) and [reviews](../reviews/2026-11-06-users-groups-roles-and-scim.md); use the [status matrix](../reference/status.md) for support.
