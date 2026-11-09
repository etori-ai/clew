# Review: the SCIM server and the provisioning boundary · 2026-11-09

Date: 2026-11-09

Reviewed revision: `2c247dd` on `scim-provisioning` (D68 and D85 built, merged with `main`)
Status: review and recommendation; no decision changed, no code changed

## Question

The product owner asked whether the SCIM server and the user handling look correct, whether they are built well
against the standard, and whether the line between Clew and the external system that pushes people (the provisioner)
is drawn in the right place.

## Assessment

The shape is right and most of the standard is followed. Routes are thin, every mutation runs in one transaction with
its audit row and the re-derivation of the grants it touched, the domain is pure, the two store adapters share a
contract suite, and the discovery resources tell the truth about what is not offered. The boundary to the provisioner
is the one D68 asked for: Clew names no source, a token per client scoped to one organisation, membership as the only
authority, a mistake fails closed, nothing is erased.

Two things break on Postgres that the memory adapter hides, and a fresh installation would meet the first one on its
first push. Three more are differences between what the server declares and what it does (case of `userName`,
the `protected` key, unknown addresses). The boundary has one gap worth closing before a second client exists:
groups have no owner and no organisation on the server side.

## Method

Read `apps/server/src/routes/scim.ts`, `modules/people/` (contracts, domain, use cases, ports, both adapters),
`scripts/provisioner/`, `scripts/provisioner-token.ts`, the SCIM, provisioner and provisioning tests, migration
`0039_identity_provisioning`, `packages/db/src/auth.ts`, D62, D68, D85, `docs/architecture/identity.md` and the
provisioner guide. Checked against RFC 7643 (schema) and RFC 7644 (protocol). Ran a throwaway script in the
devcontainer against the development Postgres (prefixed rows, removed afterwards, the script not kept) to test the
cases where the memory adapter and Postgres could differ. Ran the four unit suites on the memory adapter.

## What holds

- **Structure (D20, D25).** Routes parse the address and hand the body to one use case; the use case validates,
  owns the transaction, writes the audit row and calls the derivation inside it. `domain.ts` has no I/O. The ports are
  one interface with a Postgres and a memory adapter, and `tests/scim-store-contract.ts` runs on both.
- **The protocol.** `application/scim+json`, the error resource with `status` as a string and `scimType`, a 401 with a
  `WWW-Authenticate` challenge on every address, 201 with `Location`, `ListResponse` with `startIndex`, `count` capped
  at the declared `maxResults`, `PATCH` in the forms the known clients send (a path per operation, the schema-qualified
  path, Entra's path-less object, `"False"` as a string, `members[value eq "…"]`), `invalidFilter` on anything but the
  declared equality, extension schemas accepted and ignored. `ServiceProviderConfig` declares bulk, sort, ETags and
  password change as unsupported, and `/Schemas` declares Clew's profile honestly: `externalId` and `emails` required.
- **The boundary.** Nothing in `apps/` or `packages/` reads a directory or names one. A provisioner authenticates with
  a 256-bit random token of which Clew holds only the SHA-256 digest; the token is issued and revoked by a script,
  printed once, and scopes users to one organisation. A user of another organisation answers 404, not 403, so nothing
  leaks. The synthetic provisioner (`scripts/provisioner/`) uses the standard alone and the tests prove it against
  the routes; it leaves groups with keys it does not own alone.
- **Authority.** Every role and capability is derived from memberships and D85's mapping; an administrator can map a
  group to a capability but cannot give a person anything. The grant is removed when the last unit membership goes.
  `authorizationVersion` covers authority only, so a renamed unit stops no durable work.
- **Login.** The first login binds the subject to exactly one enabled person by `userName`, never by e-mail, audited;
  a changed subject is refused. A deactivated person's next request fails because `readAccess` reads enabled people
  only.

## Findings

### 1. A manager without a `unit:` row fails on Postgres (high)

`deriveWithin` writes unit rows for the units named by `unit:` groups and then replaces the person's assignments.
A `unit-manager:<id>` membership yields an assignment for `<id>` whether or not a unit row exists, and
`auth_assignment.unit_id` references `auth_unit.id`. The probe confirmed it: creating a group
`unit-manager:<new>` with one member fails with the foreign-key violation
`auth_assignment_unit_id_auth_unit_id_fk`, which the route turns into a 500. The memory adapter has no foreign key,
so `tests/unit/scim.test.ts` and `tests/unit/provisioner.test.ts` pass.

This is the order the synthetic provisioner pushes in: `plan()` sorts groups by `externalId`, and `-` sorts before
`:`, so `unit-manager:unit-skola` is pushed before `unit:unit-skola` (the test asserts that order). On a fresh
database `bun run auth:setup` would fail on its third group. The development stack survives because migration
`0039` backfilled the unit rows from the old grants. The contract case "several units" seeds unit `b` beforehand,
so Postgres never meets the path.

Fix: let the derivation produce a unit for every assignment, labelled by the `unit:` group when there is one, else
the known label, else the id, and have `writeUnits` keep an existing label rather than overwrite it with an id. Add
a contract case with a manager-only membership and no seeded unit, so Postgres asserts it.

### 2. Uniqueness is per organisation in the use case and per installation in the database (medium)

`uniqueUser` checks `userName` and `externalId` within the provisioner's organisation and the unit test "userName
and externalId are unique within the organisation" creates the same `userName` in a second organisation. Migration
`0039` creates `auth_person_user_name` and `auth_person_external_id` as unique indexes with no organisation, so on
Postgres that second create fails with a raw unique violation and a 500 (probe confirmed). `bindFirstLogin` matches
`userName` with no organisation either, so per-installation uniqueness is what the login needs.

Fix: make the use case check per installation and answer 409, align the memory adapter and the test, and translate
Postgres error `23505` into 409 `uniqueness` as a safety net for two concurrent `POST`s.

### 3. `userName` is declared `caseExact: false` and compared exactly (medium)

`/Schemas` says `userName` is not case exact, which is RFC 7643's default for it, and RFC 7644 says `eq` on such an
attribute is case insensitive. The filter, the uniqueness check and the first-login match all use exact equality
(probe: an upper-case filter finds nothing). Keycloak lowercases user names; Entra's `preferred_username` is the UPN
as the directory spells it. Two persons whose names differ only in case would be accepted as two.

Fix: one of the two. Either compare case-insensitively everywhere (a unique index on `lower(user_name)`, `lower()` in
`findUser`, `listUsers` and `bindFirstLogin`), which is the standard's default, or declare `caseExact: true` and say so
in the guide. The first is the safer one for logins.

### 4. Unknown addresses answer outside the standard once mounted (low)

`scimRoutes` sets `app.notFound`, but Hono does not carry a sub-app's not-found handler through `app.route()`. On the
running server `/scim/v2/Me` answers the parent's `{"error":"Okänd adress."}` as `application/json` (probe confirmed
with a parent mounted the way `main.ts` does); `tests/unit/scim-routes.test.ts` passes because it runs the sub-app
alone. RFC 7644 §3.7 and §3.11 expect 501 for an unsupported `/Bulk` and `/Me`. `attributes` and
`excludedAttributes` (§3.4.2.5, a SHOULD) are ignored; Entra sends `excludedAttributes=members` for large groups and
gets the full list back, which is harmless but heavy.

Fix: an `app.all('*')` fallback inside `scimRoutes` that answers the error resource; 501 for `/Bulk`, `/Me` and
`/.search` (or implement `/.search`, which is the list with the query in the body). `attributes` can wait.

### 5. `protected` is stored and shown, though the documents say it is not (medium, policy)

`docs/reference/status.md` and `identity.md` say the `protected` membership is derived but not stored or applied.
What happens: a group with `externalId` `protected` is stored as pushed like every group. It then appears in
`readGroups`, so it rides in `AuthenticatedContext.groups`; in the users overview as one of the person's groups; and
as a selectable group in the capability editor and the connector audience editor. Nothing applies it: no list is
filtered. D68 says that if Clew holds this fact at all it must stay out of logs, audit details and administration
views. Today it is kept out of the audit row only.

Fix: settle D68's open question. Until then, refuse the `protected` key at the boundary with 400 `invalidValue`, or
filter it out of every view and out of the context, and correct the status text.

### 6. Group ownership stops at the client (medium, boundary)

Users belong to the provisioner's organisation; groups belong to the installation. Any provisioner can read, replace,
patch and delete any group, including one another provisioner created; `membersExist` only keeps the members within
the caller's organisation, so a foreign provisioner's `PUT` fails on the members while its `DELETE` succeeds and strips
every member's grant. The "this is mine" rule exists only as the `OWNED` prefix list in the synthetic client. Two
clients for one installation are realistic (an HR system for units and managers, the directory for plain groups).
`auth_unit` carries `organisation_id`; `auth_group` carries nothing.

Fix, in two steps: `auth_group.organisation_id` set from the provisioner at create and checked on every read and
write (one organisation per installation today, so this costs nothing); then a `provisioner_id` owner so a client may
change only the groups it created, while D68's keys stay the shared vocabulary. `identity.md` lists the organisation
scope under "What is not built"; this review says: before a second client.

### 7. Deactivation by `PATCH` is audited as a plain patch (low)

`DELETE` writes `scim.user.deactivated`. `PATCH active: false`, which is what the synthetic provisioner and Entra
send, writes `scim.user.patched` with `changed: ['enabled']`. An operator reading the audit for deactivations misses
most of them.

Fix: write `scim.user.deactivated` or `scim.user.reactivated` whenever `enabled` flips, whatever the verb, and the
plain action for the rest.

### 8. Limits and load (low)

- The body limit (256 KB) is checked after the whole body has been read. A `PUT` of a group with about four thousand
  members exceeds it; municipal directories have groups of that size. Check `Content-Length` first and raise the limit
  to a few megabytes.
- Every `PUT` re-derives even when nothing changed: `replaceAssignments` deletes and inserts and `writeUnits` upserts.
  Fine for a daily push of eight thousand people; a compare before writing would make a no-op push write nothing.
- The users overview reads every person with four queries each. At municipal scale that is tens of thousands of
  queries per page view. Not SCIM, but the same tables; worth a join before the page meets a real directory.
- Provisioner tokens never expire. Acceptable for a server-to-server secret with revocation; the runbook should say
  how to rotate (add under a new id, switch, revoke).

### 9. Smaller points on the standard (low)

- `DELETE` deactivates and the resource stays readable with `active: false`; the standard expects 404 afterwards.
  Deliberate (D68 item 1) and in the guide. Two consequences the guide should add: a client that deletes and then posts
  the same `userName` gets 409 and must find the person by filter first, as the synthetic one does; and a deactivated
  person keeps the `userName`, so a recycled account name cannot be provisioned to a new person until the old row's
  name is changed by `PATCH`.
- A `PUT` without `active` re-enables (the field defaults to true). That is `PUT` semantics and D68's intent (the
  source is the authority), and it means a provisioner that pushes everyone present undoes an administrator's
  `DELETE` on the next run. Say so in the guide.
- The `$ref` attributes in `/Schemas` lack `referenceTypes`; `authenticationSchemes[].specUri` is absent. Cosmetic.
- Discovery needs the token. Permitted by the standard; a few clients read `ServiceProviderConfig` before the token is
  configured, which is rare.

## The boundary, assessed

What a provisioner has to know about Clew: the four keys in a group's `externalId`, the four required user attributes,
that `DELETE` deactivates, and the token. That is small, written down in one guide, and the synthetic provisioner
shows it in two hundred lines. Inside Clew the line is clean: nothing in `apps/` or `packages/` imports from
`scripts/provisioner/`, and the provisioner imports only its own files and the capability type.

The one place Clew's meaning leaks into a field the standard reserves for the client is a group's `externalId`. It is
no longer the source's identifier but Clew's key, so a client that sets `externalId` itself (Entra puts its object id
there) needs a thin adapter, as D68 says, and a unit that gets a new id in the source is a new group, not a renamed
one. D85 removed this cost for capabilities: any group can be mapped in Clew. Units and managers still need the key.
The alternative, a Clew schema extension on `Group` discoverable through `/Schemas` that carries `kind` and `unitId`
and leaves `externalId` to the source, would be more of the standard and is worth keeping in view; it is not urgent,
the keys work and they are in a decision.

The development seed still writes three person rows directly before the push (acknowledged in the status matrix); the
production path has no such side door.

## Recommended order

1. Finding 1, with the Postgres contract case: a fresh installation breaks without it.
2. Findings 2 and 3 together: one migration (a unique index on `lower(user_name)` per installation), the 409 in the
   use case, `lower()` in the binding.
3. Finding 5: a decision on `protected`, then enforce it at the boundary.
4. Finding 4: the fallback route and the 501s.
5. Finding 6: organisation and owner on groups before a second provisioner.
6. Findings 7 to 9 and the status wording as polish.

## Verification

`bun test tests/unit/scim.test.ts tests/unit/scim-routes.test.ts tests/unit/provisioner.test.ts tests/unit/provisioning.test.ts`
on the memory adapter. The Postgres probe described under Method for findings 1 to 4. No code changed.

## Outcome

Finding 1 was fixed the same day, because the product owner asked for a larger development directory (fifty people,
eleven units, managers with their teams, plain groups) and its first push would have met the foreign key on every new
unit. `deriveAuthority` now yields one unit per assignment, labelled by the `unit:` group, else as the unit table knows
it, else by its id, so the row exists before the assignment that references it; a new or renamed `unit:` group also
re-derives the unit's managers, who carry its label without being members. The case is in the provisioning contract
(so Postgres asserts it) and in the SCIM scenario tests. The enlarged directory was then pushed to the running
development server over HTTP, with `unit-manager:` groups for brand-new units arriving before their `unit:` groups, and
a second push changed nothing.

Findings 2 and 3 followed the same day, when the branch met `main`'s migration `0039_thread_message_seq` and the
identity migration had to be renumbered anyway: `userName` and `externalId` are unique across the installation, in the
use case (409) as in the indexes, and `userName` is matched without regard to case in the filter, the uniqueness check
and the first-login binding, with the unique index on `lower(user_name)`. A unique violation that fires before the
check saw the other row (two requests at once) is translated by the route into the same 409 `uniqueness`, naming the
attribute from the constraint. The memory adapter now enforces the same indexes. Findings 4 to 9 are open.
