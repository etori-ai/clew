# D68 · People are pushed into Clew through standard SCIM, and mapping happens outside Clew

**Status:** accepted, built 2026-11-09 (the SCIM server, the derivation, the synthetic provisioner, binding at first login, Administration › Användare); the group keys are proposed until a real provisioner has used them; item 2 amended by [D85](D85-capabilities-are-mapped-from-provisioned-groups-in-clew.md) (2026-11-09): capabilities are mapped from groups in Clew, units and manager roles keep these keys; amended by [D99](D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md) (2026-11-10): units form a tree, a `unit:` group names the unit above it and the provisioner no longer flattens a hierarchy; item 4 amended by D109 (2026-11-11): a provisioner sends a change when it happens, and the daily run is the reconciliation under it; amended by [D110](D110-a-persons-title-is-pushed-as-scims-title-and-kept-apart-from-the-role.md) (2026-11-11, provisional): a user has a sixth attribute, the optional `title`, which is shown and searched and decides nothing; item 2 amended by [D93](D93-the-protected-key-is-refused-at-the-scim-boundary.md) (2026-11-09): the `protected` key is refused at the boundary, and narrowed by [D96](D96-a-key-written-wrong-is-refused-at-the-scim-boundary.md) (2026-11-10): a key written wrong is refused, not stored as a plain group; the order of a run amended by [D101](D101-a-provisioner-pushes-the-organisation-first-and-adds-before-it-removes-and-a-unit-belongs-to-one-organisation.md) (2026-11-11, provisional since 2026-11-12): the organisation goes in before the people, a provisioner adds before it removes, and a unit belongs to one organisation; item 5 amended by [D107](D107-an-administrator-issues-replaces-and-takes-back-a-provisioners-key-on-the-users-page.md) (2026-11-11, provisional): an administrator issues, replaces and takes back a provisioner's key on the users page; item 1 amended by [D114](D114-person-profiles-show-employments-and-categorised-phone-numbers.md) (2026-11-12, provisional): its item 3 replaced the required work address, so one readable address is required and a work address is taken first; items 4 and 6 amended 2026-11-12 in the fixes of the review of users and the organisation (Q8, L2): each sign-in is refused when its claim names another person than the one its subject is bound to, an operator rebinds or releases a binding with `scripts/identity-rebind.ts`, never automatically and never on a page, and a leaver's account is disabled at the identity provider, not deleted, while the person may return; how long a deactivated person's record is kept is the organisation's decision under [D123](D123-clew-empties-expired-sign-in-data-itself-and-a-leavers-retention-is-the-organisations-decision.md) (2026-11-12, provisional), and an operator erases it with `scripts/person-erase.ts` · **Date:** 2026-11-06 · **Area:** identity

**Amended 2026-11-12.** The product owner asked on 2026-11-12 for every finding of the
[review of users and the organisation](../reviews/2026-11-12-users-the-organisation-and-the-guides-in-two-rounds.md)
to be fixed and every open decision to be taken. These changes came of it (S12, Q7, Q8, L2). The items below stay as
written; where they differ from this paragraph, this paragraph holds.

- **Item 1, the address (S12).** [D114](D114-person-profiles-show-employments-and-categorised-phone-numbers.md)
  item 3 replaced the required work address. `displayName` and one readable address in `emails` are required. Blank
  entries are left out first. Clew then takes the primary work address, else the first work address; then an untyped
  address the same way; and, for a whole list, any other address the same way. A person whose only readable address
  is `home` is stored with it.
- **Item 4, a leaver's account (Q8).** Item 4's "closed at the identity provider" means disabled. The identity
  provider keeps a leaver's account disabled, not deleted, while the person may come back, and deletes it only under
  the organisation's decision on retention. A returner then signs in with the same account, and the binding of item 6
  still holds. How long Clew keeps a deactivated person's record is also the organisation's decision
  ([D123](D123-clew-empties-expired-sign-in-data-itself-and-a-leavers-retention-is-the-organisations-decision.md),
  Q7). Clew keeps the record unchanged until an operator erases it with
  `scripts/person-erase.ts --person <id> --confirm`, after the source has stopped sending the person. A person pushed
  by mistake is deactivated by the source and then erased the same way. Nothing is erased through SCIM, as item 1
  says.
- **Item 6, the claim is checked at each sign-in (L2).** At each sign-in, not on each request, Clew compares the
  configured claim, NFC-normalised and without regard to case, with its people's user names. When the claim names
  another person than the one the subject is bound to, a disabled person included, the sign-in is refused and
  nothing is rebound. The authentication log gets `identity-conflict` on the claimed person, the audit table gets
  `identity.conflict` with the issuer, the claim, its value, the refused subject and the person who holds that
  subject, and `login-denied` follows. A claim that names nobody, or no claim, does not refuse: the subject is the
  identity, and the identity provider may rename an account before the provisioner renames the person.
- **Item 6, an operator rebinds or releases (Q8).**
  `scripts/identity-rebind.ts --person <id> --subject <new subject> --operator "<name>" [--issuer <issuer>]` moves the
  person's binding under the issuer to a new subject. With `--release` in place of `--subject`, it removes the binding,
  and the next sign-in whose claim names the person binds them again as a first login does. It refuses, writing nothing,
  a person id Clew does not hold, a subject another person holds (release that person first) and an option given twice.
  In one transaction it writes the binding and one `identity.rebound` audit row: actor `operator:cli`, about
  `person:<id>`, with the issuer, the old subject, the new subject (`null` for a release) and the operator's name. The
  transaction locks the person before reading the binding, as erasure does: overlapping repairs observe each other's
  committed binding, so the returned and audited old subject is the one actually replaced or released. The
  person's sessions under the old subject end at their next request. Running it again with the old subject undoes it. It
  is never automatic and never on a page.
- **When a rebind is needed.** A source id that changed after the person signed in, when the source cannot map the
  old id to the new one (release the old, deactivated row); an account the identity provider deleted and created
  again; a new app registration (one run per person); and a binding made while an account name moved between two
  people (release the wrong holder). Before a name moves to another active person in Clew, the identity provider
  confirms the former account can no longer sign in with that claim. It gives the name to the new account once the
  provisioner verifies the intended person's SCIM id and user name. A swap uses a temporary name on both sides.
  [Account-name handover](../guides/provisioning-for-operations.md#handing-an-account-name-to-another-person).

**Why these choices.** They were taken in the work, as the product owner asked.

- *An operator's script with an audit row.* An automatic rebind when a new subject's claim matches a person would let
  a reused account name take over a leaver's binding, and an organisation of several thousand people reuses names. A
  page would put the power to move a person's sign-in behind an administrator's browser session, for a repair needed
  a few times a year, and the freeze on new surface
  ([D101](D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md), the first real
  integration) allows no new administration page. A hand edit of `auth_identity_binding`, the only repair before,
  leaves no trace.
- *`--release` rather than erasing the holder.* After a changed source id or a moved name, another row holds the
  subject. An erasure would tie the person's sign-in to the organisation's retention decision. A release moves the
  subject only when the operator names its holder by id, so each change is audited on the person it changes.
- *The claim checked at each sign-in.* Sign-in is the moment the identity provider vouches for the claim, and the one
  point where a binding made while a name was moving can be caught. A check on each request would need the claim kept
  with the session. A refusal is safe because the operator's rebind settles it. Refusing a claim that names nobody was
  rejected: the identity provider and the provisioner rename on their own schedules, and every renamed person would
  be locked out until the next push.
- *Disable, not delete.* A deleted and recreated account gets a new subject, so every returner would need an
  operator's rebind. A large municipality has returners all year, substitutes and seasonal staff among them, so the
  rebind would become routine work instead of a rare repair.

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
   | `protected` | Refused with 400 `invalidValue` by [D93](D93-the-protected-key-is-refused-at-the-scim-boundary.md) until Clew decides whether it may hold the fact; was to mean exclusion from every list another person can see | Free |
   | Anything else | Nothing in authorization; a plain group for connector audiences (D23). A key above written wrong (another case, no id, a capability outside the list) is refused, not stored as a plain group ([D96](D96-a-key-written-wrong-is-refused-at-the-scim-boundary.md)) | Free |

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
[D93](D93-the-protected-key-is-refused-at-the-scim-boundary.md) refuses the key at the boundary. The source must have a stable, never reused
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
