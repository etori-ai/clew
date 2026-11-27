# D147 · An employment is a row of its own and names the person it reports to

**Status:** provisional (Max Eriksson, 2026-11-25: build the storage first, then the line that reads it; accepted once a provisioner has pushed managers from a real directory and the people it names have used Personal); items 1 to 8 are built; item 9 was decided on 2026-11-27 and is built as [D149](D149-a-manager-is-who-leads-a-unit-or-is-reported-to.md) · **Date:** 2026-11-25 · **Area:** identity

**Decision.** Who a person reports to is a fact of the employment, sent by the directory. Clew stores it where the
directory holds it and reads the reporting line from it, and from nothing else.

The storage:

1. **An employment is a row.** `auth_employment` holds one row per current employment, in the order the directory sent
   them (`position`). The list column on `auth_person` is gone; migration `0001_employments_as_rows` moves what it held.
   The list is still sent and replaced whole
   ([D114](D114-person-profiles-show-employments-and-categorised-phone-numbers.md)), so an employment still has no id
   of its own and a record reads exactly as it was written.
2. **An employment may name its manager.** `managerId` in the employment extension
   (`urn:clew:params:scim:schemas:extension:employment:2.0:User`) is the `id` of the manager's User resource. It is
   assigned by Clew. The provisioner uses the manager's source key (`externalId`) to find that User and sends its
   `id` in `managerId`. The field is optional. Null and the empty string mean no manager. Two entries that differ
   only in their manager are two entries.
3. **What is refused where it is written.** A `managerId` that names nobody of the provisioner's organisation, one that
   names the user themselves, and one that is no string answer 400 `invalidValue` and store nothing, as an employment on
   a unit the organisation does not hold does. A manager with no `unitId` is refused as a title with none is. Beside a
   deactivation the list is left as it was
   ([D113](D113-a-deactivation-is-never-refused-for-what-stands-beside-it.md)). So a manager is sent before an
   employment names them: the people first, and the employments of those whose manager was created after them once
   more.
4. **What is not refused.** A manager who has been deactivated is still a user of the organisation and is stored, since
   the directory says so. A chain of managers that comes back to the person is not looked for when it is written: two
   writes can close one between them, so whatever reads the line stops at a person it has passed (item 7).
5. **Who can read the manager.** A SCIM User read or list returns the manager to any provisioner of the person's
   organisation. A person's profile does not show it (`PersonProfile`), and an employment still gives no access to a
   unit or a capability.

The line:

6. **Three relations are kept apart.** That a person belongs to a unit (an employment on it, or membership of the
   `unit:` group; before [D149](D149-a-manager-is-who-leads-a-unit-or-is-reported-to.md) the group alone), that a person
   leads a unit (membership of the `unit-manager:` group) and that a person reports to another (the employment's
   manager) are three facts from three places in the directory. None is worked out from another. A unit a person leads
   is theirs to read about and to follow up; a unit that only holds one of their reports is not. Where two of the facts
   say different things, each answers its own question.
7. **The reporting line is read from the employments.** A person reports to the active people their current employments
   name as manager (`reach.above`), and their reports are the people whose employments name them (`reportsTo` in the
   people store). An employment without a manager gives none: Clew does not fall back on the tree, since the relation
   decides what a manager may read about a person and a guessed manager is the wrong person with access. A deactivated
   manager is nobody's manager. Where two people's employments name each other, the chain comes round: neither is the
   other's manager or report, neither is on the other's list in Personal, and what either leads is not below the
   other.
8. **Two managers see the same.** Someone with two employments under two managers has two managers. Clew cannot divide
   a person by employment, since a talk or a competence is the person's, so both stand in the same relation to them. A
   source still decides for itself what each of them may read there.

What reads the line: Personal and everything that lists a manager's reports (the talks round, the calendar's team, the
assistant's people) through `staffUsecases.overview` and `reach`; who may be asked about as `managed`
([D117](D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md)); the units a
manager follows up, which are the units they lead and the units led by people who report to them, wherever those stand
in the tree ([D117](D117-a-manager-follows-up-the-units-below-and-a-source-is-told-them.md)); competence and
introduction and leaving, which take a manager's reports and a leaver's managers from the same place; and
Administration › Organisation, which shows who leads each unit, whom each person on it reports to, and who reports to
nobody and why (no employment of theirs names a manager, the manager named is deactivated, or the two name each
other), per unit and for the organisation. Personal lists a
report under the unit of the employment that names the reader, so a manager of four workplaces has four cards, and a
unit the reader leads has its card whether or not anybody on it reports to them. A report who leads units carries them
(`below`). The refusal is "Sidan Personal är för den som är chef.", for someone who leads no unit and whom nobody reports
to.

Decided on 2026-11-27 and recorded on its own:

9. **Belonging and leading become two tables.** `auth_assignment` held both in one row with a role, so a row that said
   manager did not say whether the person works on the unit or only leads it. They are split, the unit a person acts
   as is the one they are employed on, and being a manager follows from leading a unit or from having someone report
   to you. [D149](D149-a-manager-is-who-leads-a-unit-or-is-reported-to.md) is the decision and says what was built.

**Known limits.**

- A gap in the directory is shown and mended nowhere in Clew. When a manager is deactivated before the directory names
  another on the employments of the people who reported to them, those people are on nobody's list, a self-registered
  competence finds nobody to approve it, and a plan held for one of them who leaves is held by nobody, until the
  directory is corrected. The organisation's own head reports to nobody and is counted with them.
- A unit a person only has a report on is called by its `unit:` group's name, else by the unit table's, else by its id.
- A unit's page lists a unit below it, and the unit below leads back, only where the manager of the unit below is
  employed on the reader's own unit. Any other unit below is in the list of units and under no unit of the reader's.
- `unitId` is no foreign key. It is checked against the organisation's `unit:` groups when the list is written and
  kept when the unit is removed afterwards (D114), and a unit nobody is placed on has no row in `auth_unit`.
- An employment that names a manager who is erased afterwards keeps the id, as other people's records that name an
  erased person do ([D123](D123-clew-empties-expired-sign-in-data-itself-and-a-leavers-retention-is-the-organisations-decision.md)).
  The erased person's own employments are removed with the rest of their profile.
- The table had no change signal of its own until migration `0003`: an employment is written with the person's row,
  whose signal leaves out the time of change, so a new title or another manager named signalled nothing. It signals
  for the organisation now.

**Why.** On 2026-11-25 the organisation tree, the employments and the manager responsibilities of Sundsvall's test
environment were read and compared, counts and unit names only. Every current employment lay on the lowest level of
the tree and none on a level above it. No node above the lowest level had a responsible manager. A manager was an
ordinary employee of some unit: seen from the employee, the manager was employed on the same unit for a third of the
employments, on a unit beside it for a third, and nowhere above in the tree for any. The names of the units showed four
habits for where a manager is placed, one per department, and none of them held throughout. The manager stood on the
employment for nearly every employment.

D99 read the line from the tree and from who leads a unit: from a person's unit upwards to the nearest unit somebody
leads. In that tree nobody leads anything above the lowest level, so a first-line manager would have no manager and a
unit with several managers would give every one of them every person on it. The tree says where a person is employed.
Who they report to is said once, on the employment, and that is where Clew keeps it and reads it.

The manager is on the employment and not on the person because that is where the directory has it, and because a
person with two employments can have two managers. SCIM's enterprise extension has a `manager` on the user, one per
person. It was weighed and left: a provisioner for Clew is written for Clew in any case, since units and the tree are
already sent in Clew's own way, and two ways in for one fact would have to be reconciled when they disagreed.

Rows and not the list column, so that who reports to a person can be asked by the manager's id and so that a manager
is a reference the database holds to a person, not text.

No fallback on the tree for a person whose employments name nobody. Two rules for one fact cannot be told apart from
outside, and in the directory that was read a quarter of the employments named a manager who could not be found among
the people with a current employment: a fallback would have given each of those people a manager nobody had named.

**Refines.** D114 item 2 ("an employment only describes work"): an employment now also names a manager, which decides
who the person reports to. It still gives no access to a unit or a capability.

**Replaces.** [D99](D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md) item 4
(the reporting line) everywhere it was read, and with it the walk up the tree in introduction
and leaving; [D94](D94-a-manager-has-a-personal-section-listing-the-people-on-their-units.md) item 2 as D99 amended it
(Personal lists the people whose employments name the reader, not the people on their units); the definitions of
`managed` and of the units below in both records numbered D117, which now rest on the employments. D99's tree, its
moves and its rule that a manager works with their direct reports stand.

Item 9 replaces D101 items 7 and 8 and D135 item 1 where they choose the unit a person acts as by the manager's role
first; [D149](D149-a-manager-is-who-leads-a-unit-or-is-reported-to.md) says how.

**Evidence.** The storage: `tests/unit/scim-as-clients-send-it.test.ts` (the manager told back, audited, refused and
left beside a deactivation), `tests/scim-store-contract.ts` on both adapters, `tests/db/person-erase.test.ts`,
`tests/db/postgres-scim-concurrency.test.ts` (two overlapping additions both survive), and
`tests/db/employments-migration.test.ts` (the upgrade from existing lists). The line: `tests/unit/staff.test.ts`,
`tests/unit/asked-about.test.ts` (who is `managed`, a chain that comes round, the units below),
`tests/boarding-directory-contract.ts` on both adapters (a leaver's managers), `tests/unit/organisation-tree.test.ts`
(who reports to nobody, and why), `tests/a11y/organisation.spec.ts`, and `tests/unit/provisioner.test.ts`
(the development directory and the published school walkthrough send managers, and a second push is silent).
`tests/named-managers.ts` gives a hand-built directory the managers its tree used to imply.
