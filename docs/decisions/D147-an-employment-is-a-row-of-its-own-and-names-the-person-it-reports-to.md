# D147 · An employment is a row of its own and names the person it reports to

**Status:** provisional (Max Eriksson, 2026-11-25: build the storage first; accepted once a provisioner has pushed managers from a real directory and the reporting line is read from them); items 1 to 5 are built, items 6 to 9 are the direction they were built for and are built by nothing yet · **Date:** 2026-11-25 · **Area:** identity

**Decision.** Who a person reports to is a fact of the employment, sent by the directory, and Clew stores it where the
directory holds it. This record builds the storage and says what the storage is for.

Built:

1. **An employment is a row.** `auth_employment` holds one row per current employment, in the order the directory sent
   them (`position`). The list column on `auth_person` is gone; migration `0001_employments_as_rows` moves what it held.
   The list is still sent and replaced whole
   ([D114](D114-person-profiles-show-employments-and-categorised-phone-numbers.md)), so an employment still has no id
   of its own and a record reads exactly as it was written.
2. **An employment may name its manager.** `managerId` in the employment extension
   (`urn:clew:params:scim:schemas:extension:employment:2.0:User`) is the `id` of the manager's User resource. It is
   optional; null and the empty string are no manager. Two entries that differ only in their manager are two entries.
3. **What is refused where it is written.** A `managerId` that names nobody of the provisioner's organisation, one that
   names the user themselves, and one that is no string answer 400 `invalidValue` and store nothing, as an employment on
   a unit the organisation does not hold does. A manager with no `unitId` is refused as a title with none is. Beside a
   deactivation the list is left as it was
   ([D113](D113-a-deactivation-is-never-refused-for-what-stands-beside-it.md)). So a manager is sent before an
   employment names them: the people first, their managers in a pass of its own.
4. **What is not refused.** A manager who has been deactivated is still a user of the organisation and is stored, since
   the directory says so. A chain of managers that comes back to the person is not looked for when it is written: two
   writes can close one between them, so whatever reads the line stops at a person it has passed (item 7).
5. **Nothing reads it yet.** The manager is told back to the provisioner that wrote it and to nobody else. A person's
   profile leaves it out (`PersonProfile`), the reporting line is still
   [D99's](D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md), and an employment
   still gives no access.

The direction, built by nothing yet:

6. **Three relations are kept apart.** That a person belongs to a unit (the employment's unit, sent as membership of the
   `unit:` group), that a person leads a unit (membership of the `unit-manager:` group) and that a person reports to
   another (the employment's manager) are three facts from three places in the directory. None is worked out from
   another. Where two of them say different things, each answers its own question.
7. **The reporting line is read from the employments.** A person reports to the manager of each current employment. An
   employment without a manager gives none: Clew does not fall back on the tree, since the relation decides what a
   manager may read about a person and a guessed manager is the wrong person with access. The gap is shown on
   Administration › Organisation, to be mended in the directory. A reader stops at a person it has passed, and a
   deactivated manager is nobody's manager.
8. **Two managers see the same.** Someone with two employments under two managers has two managers. Clew cannot divide
   a person by employment, since a talk or a competence is the person's, so both stand in the same relation to them. A
   source still decides for itself what each of them may read there.
9. **Belonging and leading become two tables.** `auth_assignment` holds both in one row with a role, so a row that says
   manager does not say whether the person works on the unit or only leads it. They are split, the unit a person acts
   as is one they belong to, and being a manager follows from leading a unit or from having someone report to you.

**Known limits.**

- `unitId` is no foreign key. It is checked against the organisation's `unit:` groups when the list is written and
  kept when the unit is removed afterwards (D114), and a unit nobody is placed on has no row in `auth_unit`.
- An employment that names a manager who is erased afterwards keeps the id, as other people's records that name an
  erased person do ([D123](D123-clew-empties-expired-sign-in-data-itself-and-a-leavers-retention-is-the-organisations-decision.md)).
  The erased person's own employments are removed with the rest of their profile.
- The development provisioner sends no managers yet.
- The table has no change signal of its own: an employment is written with the person's row, whose time of change
  moves.

**Why.** On 2026-11-25 the organisation tree, the employments and the manager responsibilities of Sundsvall's test
environment were read and compared, counts and unit names only. Every current employment lay on the lowest level of
the tree and none on a level above it. No node above the lowest level had a responsible manager. A manager was an
ordinary employee of some unit: seen from the employee, the manager was employed on the same unit for a third of the
employments, on a unit beside it for a third, and nowhere above in the tree for any. The names of the units showed four
habits for where a manager is placed, one per department, and none of them held throughout. The manager stood on the
employment for nearly every employment.

D99 reads the line from the tree and from who leads a unit: from a person's unit upwards to the nearest unit somebody
leads. In that tree nobody leads anything above the lowest level, so a first-line manager would have no manager and a
unit with several managers would give every one of them every person on it. The tree says where a person is employed.
Who they report to is said once, on the employment, and that is where Clew now keeps it.

The manager is on the employment and not on the person because that is where the directory has it, and because a
person with two employments can have two managers. SCIM's enterprise extension has a `manager` on the user, one per
person. It was weighed and left: a provisioner for Clew is written for Clew in any case, since units and the tree are
already sent in Clew's own way, and two ways in for one fact would have to be reconciled when they disagreed.

Rows and not the list column, so that who reports to a person can be asked by the manager's id and so that a manager
is a reference the database holds to a person, not text.

**Refines.** D114 item 2 ("an employment only describes work"): an employment now also names a manager. It still gives
no access, and until item 7 is built nothing reads the manager.

**Will replace, when items 7 and 9 are built.** D99 item 4 (the reporting line) and the walk up the tree in
introduction and leaving; D101 items 7 and 8 and D135 item 1 where they choose the unit a person acts as by the
manager's role first.

**Evidence.** `tests/unit/scim-as-clients-send-it.test.ts` (the manager told back, audited, refused and left beside a
deactivation), `tests/scim-store-contract.ts` on both adapters (every detail of an employment read as written),
`tests/db/person-erase.test.ts` (the rows gone with the profile), and the migration run against a database that held a
list.
