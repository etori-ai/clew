# D68 · People are pushed into Clew through standard SCIM, and mapping happens outside Clew

**Status:** accepted, built 2026-11-09 (the SCIM server, the derivation, the synthetic provisioner, binding at first login, Administration › Användare); the group keys are proposed until a real provisioner has used them; item 2 amended by D85 (2026-11-09): capabilities are mapped from groups in Clew, units and manager roles keep these keys · **Date:** 2026-11-06 · **Area:** identity

**Decision.** Clew is a standard SCIM 2.0 server (RFC 7643, 7644) and the only way people, units and groups enter a
production installation. Clew never reads an organisation's directory to learn who exists. Each installation runs a
**provisioner**: its own process that reads its source and pushes to Clew. In Sundsvall the source is Metakatalogen.
All knowledge of a source's fields, groups and roles lives in the provisioner, which maps them to the contract below.
Nothing in Clew names Metakatalogen or any other source. Clew's own vocabulary stays `manager` and `employee`.

1. **Users.** `externalId` is required: the source's stable id, never reused. `userName` is required and unique: what a
   login is matched on. Both are unique across the installation, and `userName` is matched without regard to case, the
   standard's default for it, because a login carries no organisation (settled 2026-11-09 after the
   [SCIM review](../reviews/2026-11-09-scim-server-and-provisioning-boundary.md), findings 2 and 3). `displayName` and a work address in `emails` are required; Clew needs the address to invite a
   person to a meeting. `active: false` deactivates the person. `DELETE` also deactivates, because audit rows and
   threads reference the person; nothing is erased through SCIM.

2. **Groups.** Meaning is carried by a key in the group's `externalId`:

   | `externalId` | A member gets | `displayName` |
   |---|---|---|
   | `unit:<unitId>` | An assignment to that unit as `employee` | The unit's name, shown in the product |
   | `unit-manager:<unitId>` | An assignment to that unit as `manager`, which wins over `unit:` for the same unit | Free |
   | `capability:<name>` | That capability, such as `capability:admin.connectors` | Free |
   | `protected` | Refused with 400 `invalidValue` by [D92](D92-the-protected-key-is-refused-at-the-scim-boundary.md) until Clew decides whether it may hold the fact; was to mean exclusion from every list another person can see | Free |
   | Anything else | Nothing in authorization; a plain group for connector audiences (D23) | Free |

   A person with no `unit:` or `unit-manager:` membership is provisioned but has no access, so a mapping error fails
   closed. Membership is the only authority: Clew derives every role and capability from it, and an administrator
   cannot hand one out separately.

3. **Several assignments, one active.** A person may hold several assignments. `AuthenticatedContext`, `Actor` and
   protocol 2 keep their one unit and one role, which is the active assignment. Until a person can switch, the active
   one is chosen deterministically: manager before employee, then the lowest unit id.

4. **Time lives in the source.** Clew holds no validity dates. A ställföreträdare is a membership the provisioner adds
   when the period starts and removes when it ends. Access therefore ends when the push arrives, so a provisioner must
   run at least daily, and a leaver's account must also be closed at the identity provider.

5. **Transport.** `/scim/v2` serves `Users`, `Groups`, `ServiceProviderConfig`, `ResourceTypes` and `Schemas`, with
   `PATCH` and with `filter` on `userName` and `externalId`. Bulk is not required. A bearer token issued for that one
   purpose authenticates the provisioner. Every change writes its audit row in the same transaction. Routes follow
   D20: parse, validate, call one use case.

6. **Binding.** A first login binds the OIDC subject to the provisioned person whose `userName` equals a configured
   claim, only when exactly one person matches, with an audit row. An e-mail address is never the match. A later change
   of subject needs an explicit review, as `scripts/auth-setup.ts` already refuses it.

7. **A provisioner is not a connector.** D22's rule that every integration is a connector covers what Clew calls and
   a person meets. A provisioner calls Clew, offers no capabilities and is reached by nobody. Clew ships this contract
   and a synthetic example, not any municipality's provisioner.

**Why.** The product owner chose this on 2026-11-06: Sundsvall has its own Metakatalogen, Clew should hold a strong
standard, and users are pushed in. It keeps Clew shareable, since another municipality writes one small adapter
against a published standard and changes nothing in Clew. It also needs no vendor account to build or test, and
it settles the doubt in the [SCIM review](../reviews/2026-11-06-users-groups-roles-and-scim.md) about whether Keycloak
can act as a SCIM client: the provisioner is the client.

The alternatives were an administrator's mapping table inside Clew, which that review suggested, and reading the
directory directly. A mapping table does not scale to every unit in a municipality and puts source knowledge in
Clew. Reading the directory makes Clew depend on one source's API. Keys in `externalId` were chosen over a SCIM schema
extension because every client can set them; a client that cannot set a group's `externalId` needs a thin adapter.

**Must land first.** `authorizationVersion` has to stop hashing the whole person row, or the first name correction
or the new e-mail column stops durable work
([finding 1](../reviews/2026-11-06-users-groups-roles-and-scim.md)). `granted()` in
`apps/server/src/scheduler/adapters/postgres.ts` runs the nightly scan for everyone with a grant, so it has to narrow
to people who have logged in before a whole municipality is pushed. Both landed 2026-11-09: the fingerprint covers
enabled, organisation, unit, role, capabilities and grant version only, and `granted()` takes enabled people with a
binding; see the [operations runbook](../maintainers/reliability-operations.md#changing-the-authorization-fingerprint).

**Open.** The production identity provider, Keycloak as a broker or Entra directly, which decides the claim in point 6.
How Sundsvall records protected people, and whether Clew may hold that fact at all; if it does, membership of
`protected` must stay out of logs, audit details and administration views; until it is answered,
[D92](D92-the-protected-key-is-refused-at-the-scim-boundary.md) refuses the key at the boundary. The source must have a stable, never reused
id; Metakatalogen's is not yet confirmed.

**Replaces.** Changes `docs/architecture/identity.md`, where Keycloak or Entra was the SCIM client and roles were also
derived from OIDC claims. Extends the vision's list of what Clew holds (subject, name, unit, role) with an e-mail
address and group memberships. D5 stands: SCIM is provisioning, not identification.

**Relation to D62** (users are core entities, not connected systems; written the same day in another session and
landing separately), recorded 2026-11-06 when this decision was merged as D68 (it was pushed as D60, a number this
repository had already used). The two agree: users, login and grants are Clew's core, a provisioner is not a connector
(item 7 here, the last paragraph there), and the directory stays outside Clew (the vision). They differ on where a
capability comes from. D62 keeps the locally written grants that `scripts/auth-setup.ts` writes today; item 2 here
makes group membership the only authority once a provisioner runs. Until this decision is built, D62 governs and the
local grants stand; when it is built, the `capability:<name>` groups replace them for every provisioned installation,
and the development stack's synthetic grants become the synthetic provisioner's groups. `docs/architecture/identity.md`
no longer calls users a core connector.

**Built.** 2026-11-09, in order: the authorization fingerprint narrowed to authority and the nightly scan to people who can sign in (the must-land-first items); migration `0039_identity_provisioning` with units, assignments, groups (with Clew's own id), members, the mapping table, the provisioner table, the provisioning columns on the person and SCIM timestamps (built as two migrations and renumbered after `main`'s `0038_connector_header_holder` when the branch merged); the derivation (`modules/people/domain.ts`, `usecases.ts`); the server at `/scim/v2` (`routes/scim.ts`, tokens through `scripts/provisioner-token.ts`); the synthetic provisioner (`scripts/provisioner/`, [guide](../guides/writing-a-provisioner.md)), which the development seed runs in-process so it writes no grant itself; binding at first login by `OIDC_BINDING_CLAIM`; connector audiences on groups; the users page. The current description is [identity.md](../architecture/identity.md); the session notes are in `HANDOVER.md`.
