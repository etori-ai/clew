# Review: the SCIM flow end to end, people and the organisation tree · 2026-11-11

Date: 2026-11-11

Reviewed revision: `9935614` on `main`, with the uncommitted work for D100 in the tree
Status: review and recommendation; the findings were built the same day, see Outcome

## Question

The product owner asked for a complete review of the flow in which a provisioner (in Sundsvall, Metakatalogen) pushes
people and the organisation over SCIM, before the format is handed to the team that will write the provisioner.

This is the third review of the SCIM server. The [first](2026-11-09-scim-server-and-provisioning-boundary.md) asked
whether the server is correct and the [second](2026-11-10-scim-conformance-and-operability.md) whether it is standard
and easy to run; their findings are built and are not repeated here. This one follows a push from the source to what a
person sees, with the tree of D99 in it, and asks what goes wrong on the way.

## Assessment

**For one organisation the flow is sound.** Every write is one transaction with its audit row and the derivation of
everyone it touched; a person, a group, a unit and the tree are each written one at a time; the tree refuses what
would break it; a push that changes nothing writes nothing; a deactivated person is refused on their next request.
The suites cover this on both adapters, with process-level concurrency cases on Postgres.

**Four things should be settled before a real provisioner is written against it.** A manager of a unit nobody is
placed on is shown the unit's id instead of its name (finding 2), which is how a head of an administration is likely
to arrive. A person who moves between two units can pass through no access in the middle of a push and is signed out
(finding 3). The example provisioner, which is what operations are handed, has no guard against an empty source
(finding 4). And the questions D99 leaves open about the source decide whether the format fits at all (last section).

**With two organisations in one installation the boundary does not hold** (finding 1). It has no effect while an
installation has one organisation, which is every installation today.

## Method

Read `apps/server/src/routes/scim.ts`, `modules/people/` (contracts, domain, ports, use cases, the Postgres adapter),
`packages/db/src/schema.ts` and `auth.ts`, `apps/server/src/auth.ts`, `scripts/provisioner/` (`push.ts`, `check.ts`),
D68, D99, the provisioner guide and the two earlier reviews. Ran a throwaway probe (not kept) in the devcontainer: six
scenarios against the use cases and the routes on the memory store, the example provisioner among them. Findings 1, 2,
4, 5 and 6 are what the probe answered. Finding 3 is reasoned from the code and was not run. Nothing was written to
Postgres; the Postgres adapter was read and does the same in the places findings 1 and 2 depend on.

## Findings

### 1. A provisioner and an administrator reach into another organisation (high with two organisations, none with one)

The token scopes users and groups to one organisation, and the guide says another organisation's resources do not
exist for the client. Three paths go round it.

- **A manager of another organisation's unit.** `unit:9540` and `unit-manager:9540` are two `externalId`s, so the
  uniqueness check does not stop organisation B from creating `unit-manager:9540` for a unit that organisation A
  pushed. Its member is derived as manager of the unit, with A's name for it in the grant, and
  `staffUsecases.overview` reads the unit's people without an organisation (`usecases.ts:798`). Probe: the person from
  B opened Personal and was listed A's two employees with their addresses. The talks round reads the same overview.
- **A capability on another organisation's group.** `usersAdminUsecases.change` finds the group by `externalId` across
  the installation and checks nothing about whose it is. Probe: an administrator of B gave A's group `ad:hr` the
  capability `admin.users`, and A's member was re-derived with it. The overview also lists every organisation's
  mapping rows, with the group's `externalId`.
- **Installation-wide capabilities from any provisioner.** `capability:admin.connectors` and
  `capability:admin.appearance` act on the whole installation, and any provisioner may push them for its own people.
  Not probed; it follows from `assertAcceptedKey`, which knows no organisation.

Fix: a unit id belongs to the organisation that first names it. Refuse a `unit:` or `unit-manager:` key whose unit
another organisation holds (`auth_unit.organisation_id` and the `unit:` group say whose it is), with the same 400 that
does not say the unit exists, as a parent in another organisation is refused today. Pass the organisation to
`unitPeople` in Personal as the organisation page already does. Scope the mapping, the write and the list, to groups
of the administrator's organisation. Which provisioner may grant an installation-wide capability is a decision, not a
fix; until there is a second organisation it can wait, and the status page should say that one organisation per
installation is what is supported.

### 2. A manager of a unit nobody is placed on is shown the unit's id as its name (medium)

A unit's name reaches a person from their own membership of the `unit:` group, or from `auth_unit`, which has a row
only for a unit somebody is assigned to. A manager who is in `unit-manager:11213` and not in `unit:11213`, of a unit
with no placed people, finds neither: `deriveWithin` falls back to the id. Probe: the unit group "Vård- och
omsorgsförvaltningen" was pushed first and empty, then its manager group; the manager's grant carried
`unitLabel: "11213"`, Personal's card was headed "11213", and Administration › Organisation showed the right name,
since it reads the group. Pushing the unit again changed nothing, because an unchanged group returns before anyone is
derived, so a daily push never heals it.

This is the shape D99 expects at the top of a tree: a heading node with a head and nobody else on it. The development
directory does not have it, because every manager there is also placed on the unit they lead, and the check does not
name it, because the unit group exists.

Fix: when a derivation names a unit the person's memberships give no label for, read the label of that unit's `unit:`
group before the unit table (one read in `deriveWithin`). A case in `tests/unit/organisation-tree.test.ts` with its
audit row, a contract case if the port gains a read, and a unit in the development directory led by somebody who is
not placed on it.

### 3. A move between units passes through no access, and the session ends (medium, not run)

A placement is a membership, so a move is two writes: the person leaves one group and joins another. The example
provisioner writes the unit groups from the root down and then by key, each as a `PUT` of the whole member list. When
the unit a person leaves is written before the unit they join, the person has no unit in between, the derivation
removes their grant (`grant.derived` with `removed: true`), and it comes back when the second group is written. The
time between the two is every group written in between, which for a municipality is minutes.

A person who makes a request in that time is not only refused: `authenticate` in `apps/server/src/auth.ts` finds no
access and revokes the session (`access-revoked`), so they are signed out in the middle of their work. About half of
all moves go the wrong way round, since the order is by depth and key and not by who is moving. The audit log also
gains a removal and a grant for every such person on every reorganisation.

Fix, in the provisioner and the guide, since the server cannot know that a second write is coming: add before
removing. The example can do it in two passes over the groups, first a `PATCH` `add` of the members each group gains,
then the `PUT` that removes; the guide's step 3 should say so and why. Worth deciding separately: whether a request
from a person with no grant should end the session or only be refused, since a leaver is already stopped by
`enabled` and by the identity provider.

### 4. The example provisioner has no guard against an empty source (medium)

The guide asks for one in bold: stop before deactivating when the source returned no people, or far fewer than last
time. `scripts/provisioner/push.ts`, which the guide presents as the shape to copy, has none. Probe: after a normal
push of the development directory, a push of the same directory with no people and no units deactivated 250 people
and removed 112 groups; no grant was left. The next good push restores it, and D85's mapping rows survive, but
everyone is signed out in between and each person's audit trail gains a removal.

Fix: the guard in `push()` (refuse when the plan has no people, or deactivates more than a share of what Clew holds,
unless a flag says a person decided it), with a test. Worth considering on the server as well, as a second line: a
limit per provisioner on deactivations in one run, off by default.

### 5. A user name is never free again, and nothing can be erased (low; a decision)

`DELETE` deactivates, by D68, so a leaver keeps their `userName` for good. Probe: a new person with the same
`userName` is refused with 409. The guide says an `externalId` is never reused and says nothing about `userName`,
which sources do reuse when it is built from a name. A provisioner can free it by renaming the leaver first; the guide
should say that. That nothing is ever erased is D68's own statement and stays open as a question of retention: a
person's name, address and user name are held for as long as the installation lives.

### 6. A `PUT` that leaves the extension out makes the unit a root (by design; a risk for a careless client)

Probe: a `PUT` of a unit group with its key, name and members and no extension answered without a parent. D99
decides this and the guide says it. The consequence is that a client which writes memberships by `PUT` and does not
know the extension flattens the tree, one unit at a time, with nothing but an audit row per unit to show for it. The
check reports the number of roots; it could warn when that number is larger than the provisioner was told to expect.

### 7. Smaller points

- `auth_unit` rows are never removed, and the organisation on a row is never compared with the one that writes it
  (`writeUnits` keeps the first on a conflict).
- The active assignment is "the lowest unit id" by `localeCompare` without a locale: string order, so `11213` comes
  before `9540`, under whatever locale the process runs with. Name the locale or compare code units.
- `setGroupMembers` deletes and inserts every member when one changed, and `writeGroup` finds who came and went with
  `includes` over two arrays. Measured fine at ten thousand members; both grow with the square of a group.
- The body limit compares characters, not bytes, so a body of mostly non-ASCII text may be about twice the stated size.
- A client cannot ask for the units below a unit: `filter` knows no attribute of the extension. A provisioner that
  wants to compare trees reads every unit group, which is what the example does.

## What the source still has to answer

These are D99's open items, and they decide more than any finding above whether the format fits Metakatalogen:

- Can the units be delivered as a list of their own, each with an id and the id of the unit above? The one record
  seen so far carried the tree as a path on the person.
- Do unit ids survive a reorganisation? Everything in Clew that names a unit follows the id.
- What does the manager flag refer to, and where is a manager placed: on the unit they lead, or on the one above?
  Finding 2 is the case where they are placed on neither.
- Is the person's id stable and never reused, and is the user name ever reused (finding 5)?
- Does a second placement or an acting manager exist in the source?

## Recommended order

1. Finding 2, since it is the first thing a real tree will show, and finding 4, since the example is what is handed
   over.
2. Finding 3 in the example and the guide, and the decision about ending a session.
3. Put the questions above to the team that runs the source, with the guide.
4. Finding 5 in the guide.
5. Finding 1 before a second organisation is added to any installation; until then, say on the status page that one
   organisation is what is supported.

## Verification

The probe described under Method, run with `bun test` in the devcontainer and removed afterwards; its answers are
quoted in findings 1, 2, 4, 5 and 6. No code changed, no test added, nothing run against Postgres, a real source or a
real identity provider.

## Outcome

The product owner asked the same day for every finding to be fixed, small and large, and said that Metakatalogen can
deliver the organisation as a list of its own, which should go in before the people. The result is
[D101](../decisions/D101-a-provisioner-pushes-the-organisation-first-and-adds-before-it-removes-and-a-unit-belongs-to-one-organisation.md).

- **Finding 1.** A `unit:` or `unit-manager:` key whose unit another organisation holds under either key is refused;
  Personal reads the reader's own organisation; the mapping is written, removed and listed within the administrator's
  organisation. Which provisioner may push an installation-wide capability is not decided: one organisation per
  installation is what is supported, and the status page says so.
- **Finding 2.** The derivation names a unit the person leads without being placed on it by its `unit:` group.
- **Finding 3.** The example pushes the organisation first, then the people, then the memberships in two rounds,
  additions before removals, all by `PATCH`; the guide's run order is rewritten. A request without a grant still ends
  the session, which a move no longer reaches.
- **Finding 4.** `push()` refuses a run that lists nobody or would deactivate more than a fifth of its people, before
  anything is written, unless `force` is given. No limit was added on the server.
- **Finding 5.** The guide says how a provisioner frees a user name. Erasure stays open in D68.
- **Finding 6.** `scripts/provisioner-check.ts --roots <n>` warns when the tree has more roots than the source.
- **Finding 7.** The unit id order names its locale; a membership write stores who came and went, in batches; the body
  limit counts bytes. Left as they are, with the reason in D101: `auth_unit` rows of units nobody is assigned to, and
  a filter on the unit extension.

Verification: `bun run check` (896 unit tests, the Node runtime tests, the documentation check) and `bun run test:db`
(115, the store contracts and the concurrency cases on Postgres) in the devcontainer. The new cases were not each
seen to fail without their fix; the probe above showed the faults before the fixes. Nothing was run against a real
source, and Personal was not looked at in a browser.
