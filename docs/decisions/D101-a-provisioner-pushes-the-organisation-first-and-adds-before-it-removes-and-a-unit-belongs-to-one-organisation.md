# D101 · A provisioner pushes the organisation first and adds before it removes, and a unit belongs to one organisation

**Status:** provisional (product owner, 2026-11-11: the source can deliver the organisation as a list of its own, the organisation goes in before the people, and every finding of the review is fixed, small and large), built 2026-11-11; items 5 and 6 are choices made in the build and stand until the product owner says otherwise; no provisioner has run against a real source yet; recorded as accepted until 2026-11-12, when the fixes of the review of users and the organisation made it provisional (Q10): accepted once a provisioner outside the team has pushed a run in this order from a real source; items 2 and 3 amended 2026-11-11 after the [review of the operations guide and the source's lifecycle](../reviews/2026-11-11-provisioning-operations-guide-and-source-lifecycle.md) and the [full review of the SCIM server](../reviews/2026-11-11-scim-full-review.md), and 2026-11-12 after the [outside review of the merged SCIM server](../reviews/2026-11-12-outside-review-of-the-merged-scim-server.md) and the [review of users and the organisation](../reviews/2026-11-12-users-the-organisation-and-the-guides-in-two-rounds.md): leavers are deactivated straight after the people rows are checked, returners are activated last, a fault in one row is that row's alone, and the guard covers people, units, role groups and directory groups; item 4 amended 2026-11-12 (G6): the exact key another organisation holds answers 409 `uniqueness`, and the other key of that unit 400 `invalidValue`; and (K4): a mapping change holds the row of the group it found and then the organisation's mappings, and is decided on the organisation's group that holds its key once both are held, and a row is removed whatever holds its key; item 8 amended 2026-11-12 (Q4): unit ids are compared by UTF-16 code unit, with no locale; item 9 amended by [D119](D119-clew-keys-its-own-records-about-a-person-by-the-persons-id.md) (2026-11-12, provisional): a reused name reaches only what arrives after the reuse, and by [D120](D120-clew-empties-expired-sign-in-data-itself-and-a-leavers-retention-is-the-organisations-decision.md) (2026-11-12, provisional): an operator erases a deactivated person's record when the organisation decides · **Date:** 2026-11-11 · **Area:** identity

**Amended 2026-11-12.** In the fixes of the
[review of users and the organisation](../reviews/2026-11-12-users-the-organisation-and-the-guides-in-two-rounds.md),
which the product owner asked for on 2026-11-12, with every open decision taken in the work (O2, O6, G6, K4, N2,
Q4, Q10). The items below stay as written; where they differ from this paragraph, this paragraph holds.

- **Provisional (Q10).**
  [D102](D102-a-decision-is-provisional-until-something-outside-the-repository-has-tested-it.md) makes `provisional`
  the standing of a choice that nothing outside the repository has tested. This record was chosen after D102 and
  recorded as accepted, though it says itself that no provisioner has run against a real source. Its reasons stand.
  It becomes accepted once a provisioner outside the team has pushed a run in this order from a real source.
- **Items 2 and 3, the order of a run and the guard (O2).** Changed on 2026-11-11 (leavers before the people, a
  refused person that person's alone, returners after the memberships, and a guard over four populations) and on
  2026-11-12 (leavers straight after the people rows are checked, returners sent with their full profile, and a fault
  in one unit or group that row's alone). `scripts/provisioner/push.ts` now runs in this order, and both guides
  describe it:
  1. The people rows are checked whole, before anything is written: a complete export, every row inside the writer's
     prefix with a boolean `active`, each person id once and each active account name once. The people guard runs
     here.
  2. Who has left, and who the source now marks inactive, is deactivated.
  3. The organisation is checked whole: each unit id and group id once, no reserved key on a plain group, every unit
     and plain group the export lists inside the writer's keys, and the guard over the groups. A fault here stops the
     rest of the run after the deactivations, and the message says that the leavers have gone already.
  4. The units from the root down, as nodes without people.
  5. The people. An account name given to someone new is first moved off the row that holds it.
  6. The memberships in two rounds, every addition before any removal.
  7. The groups that no longer follow from the source.
  8. Those who return, last. Once their memberships are reconciled, each is sent with the full active profile. One
     whom no unit that was written takes stays inactive and is reported.

  A fault in one row is that row's alone: a unit whose parent the export does not list, units that are each other's
  parents, a unit or group that an active person names and the export does not list, and anything Clew refuses for a
  unit or a group are reported (`groupsRefused` in the run's summary) and skipped with what depends on them, and the
  run carries on. Only a person whose units were not written keeps the units Clew holds them on until one is. The
  guard covers four populations: the people, the units, the role groups (managers' groups and capabilities) and the
  directory groups. A run that would withdraw all of a population, or more than one row and more than a fifth of it,
  is refused unless `force` is given. Item 3's "and more than ten" is gone.
- **Item 4, two answers (G6).** The check for a taken key runs before the check for another organisation's unit. So
  the exact key another organisation holds, `unit:<id>` or `unit-manager:<id>`, answers 409 `uniqueness` ("A group
  with this externalId already exists."), and the other key of that unit answers 400 `invalidValue` ("The unit '<id>'
  is not a unit of this organisation (D101). The group was not stored."). Either way nothing is stored.
- **Item 4, a capability mapping (K4).** An administrator still maps a capability onto a group of their own
  organisation only. The change holds the row of the group it found and then the organisation's capability rows, and
  is decided on the organisation's group that holds the key once both are held
  ([D85](D85-capabilities-are-mapped-from-provisioned-groups-in-clew.md), as amended). Adding a row is refused with
  400 "Gruppen finns inte bland de provisionerade grupperna.", and nothing is written, when no group of the
  organisation holds the key by then, as when the group was given another key or removed meanwhile. A row is removed
  whatever holds its key, another organisation's group included, as a row whose group is gone. The audit row's
  `groupLabel` is the name of the group that holds the key at that moment, or `null` when no group of the
  organisation holds it.
- **Item 8, the order of unit ids (Q4).** The order that picks the active assignment compares unit ids by UTF-16 code
  unit, with no locale (`byUnitId` in `modules/people/domain.ts`), in place of the ICU locale `en`. A managed unit
  still comes first. `Skola` comes before `förskola`, `Z-skola` before `a-skola`, `skola-2` before `skola_2`, and `10`
  before `9`. It is JavaScript's default sort and, for ids without characters outside the Basic Multilingual Plane,
  Python's `sorted()` and PostgreSQL's C collation. Both adapters reach it through the one derivation.
- **Item 9, a reused name (N2).** A rename or a reuse no longer moves Clew's own records: Clew keys its records
  about a person by the person's id
  ([D119](D119-clew-keys-its-own-records-about-a-person-by-the-persons-id.md)). A provisioner still frees a reused
  name by renaming the leaver's row first, since a user name is unique in the installation; the example gives the old
  row its own `externalId` as its name. Rows and actions that name a person by the user name are resolved to a person
  when they arrive, so a reused name reaches only what arrives after the reuse. A connected system that keeps records
  under the name answers for the name's current holder and moves its records off a leaver as the provisioner moves
  the name. No leaver needs to be erased before their name is reused. "That nothing is ever erased stays an open item
  of D68" is answered by
  [D120](D120-clew-empties-expired-sign-in-data-itself-and-a-leavers-retention-is-the-organisations-decision.md): how
  long a deactivated person's record is kept is the organisation's decision, and an operator erases it with
  `scripts/person-erase.ts --person <id> --confirm` once the source has stopped sending the person.

**Why these choices.** Leavers go first because a fault anywhere else in the export must never keep a person who has
left active, and in an export of thousands of rows a wrong row is to be expected. Returners go last, with their full
profile, because a returner made active before their memberships are reconciled would act on old units, and one
activated by `active` alone keeps old attributes (D113). One wrong row is that row's alone because a reorganisation
touches hundreds of rows, and one wrong unit must not hold back every other change; the run reports it so that a person
can correct the source. The guard covers every population because an empty or cut export of units or groups takes access
from as many people as one of people does. Q4 was taken in the work, as the product owner asked. Code-unit order was
chosen over keeping `en` and documenting it: a unit id is an opaque key, code-unit order is what the tools a directory
team already has give, and no upgrade of ICU or Node can change it, so no upgrade moves anyone's active unit. An English
collation can change between ICU versions and cannot be reproduced without ICU. Q10 follows D102 as written.

**Decision.** The [review of the SCIM flow](../reviews/2026-11-11-scim-flow-people-and-organisation.md) followed a
push from the source to what a person sees and found seven things. This settles them.

1. **The organisation is a list of its own.** The source delivers its units as rows of their own, each with a stable
   id, a name and the id of the unit above it. This answers the first open item of
   [D99](D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md): Metakatalogen can
   deliver such a list, and the provisioner does not read the tree out of a path on each person.

2. **The order of a run.** The organisation first, then the people, then who is placed where:
   - read what Clew holds of people, and stop if the run would deactivate too many (item 3);
   - the units from the root down, each as a node with its name and its parent and nobody on it: `POST` a new one,
     `PATCH` the name or the parent of one that changed. Never a `PUT` here, since a `PUT` without members empties
     the unit;
   - the people: `POST` or `PUT`, and `active: false` for those who left;
   - the memberships in two rounds over every group: first a `PATCH` `add` of the members each group gains, then a
     `PATCH` `remove` of the members each group loses. A person who moves between two units is in both for a moment
     and never in neither, so their grant is not removed and written again and they are not signed out by a request
     in between;
   - the groups that no longer follow from the source, a unit only once nothing that is also going stands below it.

   The placements cannot go before the people, because a member has to exist before a group can list it; that is
   SCIM's order, not Clew's. `scripts/provisioner/push.ts` is built this way and
   [the guide](../guides/writing-a-provisioner.md) says it.

3. **The guard is in the example.** `push()` refuses, before anything is written, a run in which the source lists
   nobody or that would deactivate more than a fifth of the people Clew holds from this provisioner (and more than
   ten). `force` says a person has decided that the source is right. The guard lives in the provisioner: only it
   knows what the last run looked like.

4. **A unit belongs to the organisation that pushed it.** `unit:<id>` and `unit-manager:<id>` are two keys for one
   unit. A key whose unit another organisation holds under either key is refused with 400 `invalidValue`, on `POST`,
   `PUT` and `PATCH` (`unitOfOwnOrganisation` in `modules/people/usecases.ts`, asked while the unit is held).
   Personal reads the people of the reader's own organisation, as the organisation page does. An administrator maps
   a capability onto a group of their own organisation only, removes only such a row or one whose group is gone, and
   is not shown another organisation's rows.

5. **Installation-wide capabilities stay with the token (a choice made in the build).** Any provisioner may still
   push `capability:admin.connectors` and `capability:admin.appearance`, which act on the whole installation. A token
   is issued by the installation's operator, who trusts the provisioner with what it pushes. One organisation per
   installation is what is supported until a decision says which organisation may hold such a capability.

6. **A request without a grant still ends the session (a choice made in the build).** With item 2 a move no longer
   passes through no grant, so nothing reaches this path that should not. A leaver is stopped by `enabled` and by the
   identity provider as before.

7. **A unit's name for the one who leads it.** A manager who is in `unit-manager:<id>` and not in `unit:<id>` is
   handed the name of the unit's `unit:` group by the derivation (`deriveWithin`), before the unit table and before
   the id. The head of a unit nobody else is placed on is therefore shown the unit's name in the grant and on
   Personal, and a renamed unit reaches them.

8. **Smaller points.** The order of unit ids that picks the active assignment names its locale (`en`), so it does not
   follow the process. A membership write stores who came and who went, a few thousand rows a statement, instead of
   every member. The request body limit is counted in bytes. `scripts/provisioner-check.ts --roots <n>` warns when
   the tree has more roots than the source has, which is what a `PUT` without the unit extension leaves behind.

9. **A user name is freed by the provisioner.** `DELETE` deactivates (D68), so a leaver keeps their `userName`. A
   source that reuses user names renames the leaver first; the guide says so. That nothing is ever erased stays an
   open item of D68.

**Why.** The product owner, 2026-11-11, on the review: fix what is found, small and large; and the organisation as a
list of its own is the better standard and should go in before the people. The order in item 2 is also what closes
the review's finding 3: with a group's removals sent along with its additions, about half of all moves left the
person with no unit between two writes, and `authenticate` revokes a session that finds no grant.

The alternative to item 4 was to make a unit id unique per organisation instead of across the installation. D68's
keys are shared vocabulary and a login carries no organisation, so the id stays unique and belongs to whoever named it
first. The alternative to item 3 was a limit on the server; Clew cannot tell an empty export from a real change, and a
limit there would stop a real reorganisation with no person at hand to say so.

**Left as it is.** `auth_unit` keeps a row for a unit nobody is assigned to any longer: removing it safely needs the
unit held by every derivation, and the row costs nothing. `filter` still knows no attribute of the unit extension;
nothing asks for the units below a unit. The development directory has no unit led by somebody who is not placed on
it; the case is in `tests/unit/organisation-tree.test.ts`.

**As built.** `modules/people/usecases.ts` (`deriveWithin`, `unitOfOwnOrganisation`, `staffUsecases.overview`,
`usersAdminUsecases`), `domain.ts` (`byUnitId`), `adapters/postgres.ts` (`setGroupMembers`), `routes/scim.ts` (the
body limit), `scripts/provisioner/push.ts`, `check.ts`, `index.ts` and `scripts/provisioner-check.ts`. Tests:
`tests/unit/organisation-tree.test.ts` (the unit's name with its audit row; the organisation boundary with nothing
stored and no audit row), `tests/unit/users-admin.test.ts` (the mapping), `tests/unit/provisioner.test.ts` (a move
that never loses the grant, the guard, the roots warning) and `tests/unit/scim-routes.test.ts` (bytes). No migration
and no port changed. The same day the orders nobody had thought of were added: a run lost at any request and
finished by the next, units created, moved and removed in a seeded random order beside a model of the tree, what the
server does when a client removes before it adds (`tests/unit/scim.test.ts`), and two races in
`tests/db/postgres-scim-concurrency.test.ts`. Each fix was switched off in turn and its test seen to fail; the
[review](../reviews/2026-11-11-scim-flow-people-and-organisation.md) says how.

**Not done.** A run against a real source or a real identity provider. A second organisation in an installation
(item 5). A manual look at Personal signed in as the head of a unit nobody is placed on.

**Replaces.** Amends [D68](D68-people-are-pushed-into-clew-through-standard-scim.md) (the order of a run, which the
guide carried) and [D99](D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md)
(its first open item is answered; a move is still a change of `parent`, now sent as a `PATCH` by the example).
