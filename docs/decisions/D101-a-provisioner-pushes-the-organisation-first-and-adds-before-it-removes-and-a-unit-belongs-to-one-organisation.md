# D101 · A provisioner pushes the organisation first and adds before it removes, and a unit belongs to one organisation

**Status:** accepted (product owner, 2026-11-11: the source can deliver the organisation as a list of its own, the organisation goes in before the people, and every finding of the review is fixed, small and large), built 2026-11-11; items 5 and 6 are choices made in the build and stand until he says otherwise; no provisioner has run against a real source yet · **Date:** 2026-11-11 · **Area:** identity

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
and no port changed.

**Not done.** A run against a real source or a real identity provider. A second organisation in an installation
(item 5). A manual look at Personal signed in as the head of a unit nobody is placed on.

**Replaces.** Amends [D68](D68-people-are-pushed-into-clew-through-standard-scim.md) (the order of a run, which the
guide carried) and [D99](D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md)
(its first open item is answered; a move is still a change of `parent`, now sent as a `PATCH` by the example).
