# Identity and authorization

Clew separates **login identity**, **local permission**, **connector authority** and **source credentials**. Passing one boundary does not bypass the next. This page describes the current implementation; exact connector claims and verification instructions are in [Authorization](../guides/authorization.md).

## Browser to Clew

![The first login: SSO vouches for the account, Clew binds the subject to the one provisioned person with the same user name, or denies](figures/first-login.svg)

The [authentication implementation](../../apps/server/src/auth.ts) uses OIDC Authorization Code with PKCE. Development uses Keycloak. The server keeps tokens sealed in its database; the browser receives an opaque, HttpOnly session cookie and the session's CSRF token for mutations.

Login validates state/nonce and resolves the verified issuer and subject through an existing local identity binding. A subject seen for the first time binds to the one enabled, provisioned person whose `userName` equals the ID token claim named by `OIDC_BINDING_CLAIM` (default `preferred_username`), with an `identity-bound` row in the authentication log and an `identity.bound` audit row on the person (D68 item 6, `bindFirstLogin` in `packages/db/src/auth.ts`). No match, two matches, a disabled person, or a subject that differs from the person's existing binding is a denied login, audited as `identity-unmatched` or `identity-conflict`; a changed subject needs a person's review, never an automatic rebind. The person must have a local access grant. A matching display name or e-mail is never a substitute. Login does not create a user on demand.

The current session policy has eight-hour idle and absolute limits. Mutation requests check the allowed origin and CSRF token; back-channel logout validates the identity provider's signature. The authoritative behavior is in [auth.ts](../../apps/server/src/auth.ts), [auth-origin.ts](../../apps/server/src/auth-origin.ts) and [database authentication helpers](../../packages/db/src/auth.ts).

## Clew's local authority

An authenticated context carries the person, organisation, current unit/role, grant capabilities, the external ids of the person's provisioned groups, the authorization version and the session binding. Its `authorize()` rechecks the current grant/session rather than trusting an earlier UI response. The authorization version is a fingerprint of the authority alone (enabled, organisation, unit, role, capabilities, grant version); names, labels and other columns do not change it, so durable work survives directory updates. See the [operations runbook](../maintainers/reliability-operations.md#changing-the-authorization-fingerprint).

Connector governance further narrows access by enabled state, audience, capability switches and tool/scan/figure settings. An audience names roles, units and provisioned groups ([D23](../decisions/D23-connectors-are-managed-in-the-database.md), [D68](../decisions/D68-people-are-pushed-into-clew-through-standard-scim.md)); the groups are read at each request and for background work, so a membership the provisioner removes stops matching at the next check.

Users and grants are core entities ([D62](../decisions/D62-users-are-core-entities-not-connected-systems.md)). Their internal `people.*` reads share dispatch but cannot be disabled as a connected system. They describe Clew's users, not the full employee directory.

## Provisioning

![How people enter Clew: the source, the provisioner, the SCIM server, the stored tables, the derivation and the person's grant](figures/provisioning-flow.svg)

People, units and groups enter an installation through Clew's SCIM 2.0 server at `/scim/v2` and in no other way (D68; `apps/server/src/routes/scim.ts` over `modules/people/usecases.ts`). A **provisioner**, the installation's own process, reads the organisation's source and pushes; Clew never reads the source and never learns its name ([guide](../guides/writing-a-provisioner.md)). The server offers `Users` and `Groups` with `POST`, `GET`, `PUT`, `PATCH` and `DELETE`, `filter` as one equality (`userName`/`externalId` on users, `externalId`/`displayName` on groups), `startIndex`/`count` paging, `attributes`/`excludedAttributes` and the discovery resources; bulk, sorting and ETags are not offered. A provisioner authenticates with a bearer token whose digest Clew holds (`auth_provisioner`; issued, listed, rotated with a grace period and revoked with `bun scripts/provisioner-token.ts`), and Clew records when it last called; users are read and written within the token's organisation, while `userName` and `externalId` are unique across the installation (`userName` without regard to case, the standard's default, because a login carries no organisation), and a group belongs to the organisation of the provisioner that pushed it, with an `externalId` unique across the installation. Every mutation writes its `scim.*` audit row and re-derives the grants it touched in the same transaction. A derivation locks the person and a write locks the group, so requests sent in parallel give the grant they would give one after the other (`tests/db/postgres-scim-concurrency.test.ts`). `DELETE` on a user deactivates, never erases. The answers are English: a machine reads them.

Units form a tree ([D99](../decisions/D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md)). A `unit:` group is a node, also one nobody is placed on, and names the unit above it in the extension `urn:clew:params:scim:schemas:extension:unit:2.0:Group` (`parent`, the `externalId` of that unit's group; absent on a root). The server refuses a parent that does not exist, one in another organisation, one that would close a cycle and the extension on any other group, and answers 409 to the removal of a unit with units below it, so a tree is pushed from the root down and removed from the leaves up. A move is a change of `parent`, audited with the unit above before and after; it re-derives nobody. A write that changes the tree holds the organisation's tree for its transaction, so two of them run one after the other. Clew never infers the tree from the people. A unit belongs to the organisation that pushed it ([D101](../decisions/D101-a-provisioner-pushes-the-organisation-first-and-adds-before-it-removes-and-a-unit-belongs-to-one-organisation.md)): a `unit:` or `unit-manager:` key whose unit another organisation holds under either key is refused, Personal reads the reader's own organisation, and an administrator maps a capability onto a group of their own organisation only. A manager who leads a unit without being placed on it is handed the name of its `unit:` group by the derivation. A provisioner pushes the organisation first, then the people, then the memberships with additions before removals, so a person who moves is never without a unit.

![The identity tables: what the provisioner writes, what the administrator writes, what Clew derives and what a login binds](figures/identity-tables.svg)

The data model (`packages/db/src/schema.ts`): `auth_person` carries the source's `externalId`, the `userName` a login is matched on and a work e-mail (empty on rows from before provisioning); `auth_unit` the organisation's units; `auth_assignment` any number of (unit, role) pairs per person with the two roles `manager` and `employee`; `auth_group` and `auth_group_member` every pushed group as pushed, with Clew's own id, the organisation of the provisioner that pushed it (a client reads and writes its own organisation's groups only), the source's optional `externalId` (unique across the installation), its name as `label` and, on a `unit:` group, the unit id of the node above it (`parent_unit_id`, D99); `auth_group_capability` the administrator's mapping from a group to a capability of the closed list `CAPABILITIES` in `@clew/contracts` ([D85](../decisions/D85-capabilities-are-mapped-from-provisioned-groups-in-clew.md)); `auth_provisioner` the clients, by the digest of their token.

## Derivation

![What a pushed group means: keys in externalId give units, manager roles and capabilities; any other group may be mapped by an administrator](figures/group-keys.svg)

`auth_access_grant` is a projection of those tables: the one active assignment (manager before employee, then the lowest unit id) and the person's capabilities, which is what the authenticated context and the connector actor carry. Meaning comes from keys in a group's `externalId` (`unit:<id>`, `unit-manager:<id>`, `capability:<name>`; the key `protected` is refused, [D93](../decisions/D93-the-protected-key-is-refused-at-the-scim-boundary.md), and so is a key written wrong, [D96](../decisions/D96-a-key-written-wrong-is-refused-at-the-scim-boundary.md)) and from the mapping; a person with no unit membership has no grant, so a mistake fails closed. The derivation is `deriveAuthority` in `modules/people/domain.ts` (pure) and `provisioningUsecases` in `usecases.ts`: called inside the transaction that changed a membership or a mapping row, it rewrites the person's units, assignments and grant and writes one `grant.derived` audit row only when the grant changed, or `removed: true` when the person has no unit left.

**The reporting line** (D99) is read from the assignments and the tree when it is asked for, and is not part of the grant: a person reports to the managers of the nearest unit, their own or above it, that has a manager; a manager to the managers of the nearest unit above their own that has one; a unit nobody leads passes the line through. `staffUsecases.overview` answers a manager's reports, the people assigned to the units they manage and the managers of the nearest managed units below, never the people those managers lead; Personal, the talks round and the calendar's team all read it. A move in the tree therefore changes who reports to whom and nobody's grant or authorization fingerprint.

In development the provisioner is `scripts/provisioner/`: `bun run auth:setup` creates the Keycloak accounts for the three personas, their person rows with the ids the fixtures and calendars key on, and the provisioner's token, then pushes the whole directory (two hundred and fifty people in forty-eight units that form a tree of six levels, with a manager on every level, fifteen plain groups and capabilities) through the SCIM routes in-process; `bun run dev:provision` does the same over HTTP. Units, assignments, grants and capabilities in development come from that push and from nowhere else.

## Administration › Användare

The page (`apps/web/src/pages/admin/users.tsx`, behind `admin.users`) shows each provisioner with when it last called and a warning after two days of silence, the provisioned people with unit, role, capabilities and whether they have signed in, and holds D85's mapping from a group to a capability. Adding or removing a row steps up, writes `group-capability.added`/`removed` and re-derives the group's members in the same transaction. It edits no identity: who exists and where they belong is the source's.

The people are read a page at a time ([D100](../decisions/D100-the-people-list-is-read-a-page-at-a-time-and-narrowed-on-the-server.md)): `POST /api/admin/users/search` answers one page by name in Swedish order, narrowed by words (name, user name, e-mail), a unit with everything below it in the tree, a role, a status and a capability. The store narrows, orders and counts (`ProvisionTx.searchUsers`); only the rows of the page are filled in. The unit, role, status, capability, page and page size are in the page's address (`/admin/users?unit=…&role=manager`), so a narrowed list can be linked; the typed search is sent in the request body and is in no address.

## Administration › Organisation

The page (`apps/web/src/pages/admin/organisation.tsx`, behind `admin.users`, D99) shows the organisation tree as the provisioner pushed it: each unit under the unit above it, with who leads it, how many people are placed on it and in its branch, and what a push left wrong (people with no manager on the unit or above it, a unit nobody is placed on, a unit people are on that no unit group names, people placed on no unit). A row opens the unit's people over the tree. It is read only, as Användare is.

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

## What is not built

- Switching between several assignments: a person with more than one acts as the deterministically chosen one.
- Anything that follows a branch of the tree rather than the reporting line: an audience that names a unit and means everything below it, a figure summed over a branch, the path above the acting person's unit in what a connector is told (D99 item 5 and "Open").
- Holding or applying a `protected` membership: the key is refused at the boundary ([D93](../decisions/D93-the-protected-key-is-refused-at-the-scim-boundary.md)) until D68's open question, whether Clew may hold that fact at all, is answered.
- A real provisioner against a real source, and a real identity provider's claim for `OIDC_BINDING_CLAIM`; the development stack's Keycloak and synthetic directory are the only ones that have run.
- A way for a connector to map the acting person beyond Clew's id: protocol 2's `Actor` carries neither `externalId` nor `userName`.
- Local dev-login without the IdP ([D6](../decisions/D06-dev-login-local-only.md)), a public MCP OAuth surface and cross-domain ID-JAG exchange ([D5](../decisions/D05-oidc-and-oauth-only-identification-path.md)).

The early rationale is in the [identity decisions](../decisions/D05-oidc-and-oauth-only-identification-path.md) and the [SCIM review](../reviews/2026-11-06-users-groups-roles-and-scim.md); use the [status matrix](../reference/status.md) for support.
