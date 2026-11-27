# D149 · A manager is who leads a unit or is reported to

**Status:** provisional (Max Eriksson, product owner, 2026-11-27, with the four answers under "Decided"; accepted once a provisioner has pushed a real directory and the people it makes managers have used Personal and a unit's page) · **Date:** 2026-11-27 · **Area:** identity, integrations

**Decision.** Three facts about a person and the organisation are kept in two places, and none is worked out from
another. An employment says which unit the person belongs to and whom they report to. A row of its own says which unit
they lead. Being a manager follows from either: a person is a manager when they lead a unit, or when somebody reports
to them.

This is item 9 of
[D147](D147-an-employment-is-a-row-of-its-own-and-names-the-person-it-reports-to.md), which proposed it and left it
open.

**Decided** by the product owner on 2026-11-27:

- Someone who answers for a unit and has no reports of their own is a manager.
- An employment is enough to belong to a unit. Before, the person also had to be in the unit's group.
- With several employments the person acts as the unit of the main one, which is the first the directory sends.
- Who answers for a unit is who the directory says leads it. A directory that holds that as a fact of its own sends
  it, once its meaning there is confirmed.

What is stored:

1. **Belonging is `auth_assignment`.** A row is a person and a unit, and says that the person belongs to the unit. It
   is derived from two places: the units of the person's current employments, those the organisation holds, and the
   `unit:` groups they are in. The group is how a directory that sends no employments says it, and how a placement away
   from the job is said. The table no longer has a role.
2. **Leading is `auth_unit_lead`.** A row is a person and a unit, and says that the person leads the unit. It is derived
   from the `unit-manager:` groups they are in. Someone leads a unit whether or not they belong to it.
3. **Reporting is the employment's manager**, as D147 stores it.
4. **The grant says who the person is to Clew.** `role` is `manager` when the person leads a unit or an active person's
   current employment names them. Two who name each other are neither's report, as the reporting line reads it.
   `unitId` is the unit they act as: the unit of their first employment. Someone the directory sends no employment for
   acts as a unit they lead before one they are placed on, then the lowest unit id, as before
   ([D135](D135-a-person-with-several-assignments-sees-the-work-of-all-of-them.md) item 1). `assignments` holds every
   unit they belong to or lead, with `manager` where they lead it and `employee` where they belong to it without
   leading it. It is left out only when there is one unit and it says what `unitId` and `role` already say.
5. **`role` does not say that the person leads `unitId`.** A manager may be employed on a unit somebody else leads.
   Which units a person leads is asked in one place, `ledUnits` in `@clew/contracts`, and nowhere by pairing the role
   with the unit.
6. **A manager is derived in the write that makes them one.** Who reports to a person is somebody else's employment. So
   a write of a person's employments, or one that deactivates them or makes them active again, derives the managers
   named before and after it, in the same transaction, each with its `grant.derived` row. The write holds the person and
   those managers in id order before it writes, as every writer takes people. Whom to hold is read first and read again
   once they are held: when another write named somebody else in between, this one starts over, and after three such
   turns it answers 409 and has stored nothing.
7. **A deactivated person's employment places nobody.** A leaver taken out of their groups has no unit left and so no
   grant, as before employments placed anybody. Made active again, they are of their unit again.
8. **A unit's group reaches the people employed on the unit.** An employment places a person only on a unit the
   organisation holds, which is that a `unit:` group names it. So a unit group that is created, renamed, given another
   key or removed derives the people employed on the unit as it derives its members: they carry the unit's name, and
   are of the unit no more when it is removed.

What reads it:

9. **The session.** `role` is whether the person is a manager, and the rail, Personal, the talks round, the dialogue,
   the calendar's team and a manager's competence and introduction scans ask it. They are about the people who report
   to the person, and reach them through the reporting line of D147. Someone people report to who leads no unit reaches
   them all.
10. **A connected system.** The actor carries `leads`: the units the person leads, on every call for a manager and to
   every connector, empty for a manager who leads none. A capability that answers for the manager's unit answers for
   those units. `unitId` is where the person is employed and `role` that they are a manager; the protocol says that the
   two are never paired. `assignments` is still sent only to a connector that asks for it
   ([D135](D135-a-person-with-several-assignments-sees-the-work-of-all-of-them.md) item 5), now whenever the person's
   units say more than `unitId` and `role` do, which may be one entry.
11. **The pages about a unit.** Läget on Hem and on the unit's page is said of a unit the person leads: the one they
    are employed on when they lead it, otherwise the first of those they lead. Administration › Organisation counts the
    people who belong to a unit, and lists someone who leads it from another unit as its manager, marked as employed
    elsewhere. Administration › Användare shows a person's units with the role on each, and its filter on role reads
    the same: `manager` is someone who leads a unit.
12. **The assistant** is told the person's role on each of their units, `chef` only of a unit they lead, and of someone
    people report to who leads none that they have personnel responsibility.
13. **The authorization fingerprint** covers the assignments whenever the grant holds them, so a unit gained or a role
    changed on one ends the sessions that were signed under the old ones. One unit that says what `unitId` and `role`
    say is the same authority however it was stored.

The example provisioner's check says how many people are managers, how many of them lead a unit they do not belong to
and how many lead none and are reported to, and names anyone who leads a unit and belongs to none.

**Known limits.**

- Nothing in the repository reads a directory's own record of who answers for a unit. A provisioner sends it as the
  `unit-manager:` group, and a mapping that derives it from who has reports on a unit says something else than the
  directory does.
- The migration moves who leads what and leaves every grant as it was. The unit a person acts as is derived the next
  time they are written. Whether somebody is a manager because people report to them is derived then too, and by the
  next write of anybody whose employment names them, a write that changes nothing included. Development data is seeded
  again.
- Someone who leads a unit and belongs to none is listed as the manager of the unit they lead on Administration ›
  Organisation, and no unit's count of people holds them. They are not among those without a unit either, since they
  have one to act as. The check names them.
- The first employment is taken to be the main one. A directory that sends them in another order decides the unit the
  person acts as by that order.
- Administration › Användare does not say of a person that they are a manager because people report to them: it shows
  the role on each unit, where such a person is an employee.
- A person who leads more than fifty units is more than the protocol's `leads` holds, as with `assignments`. The
  largest number in the directory that was read is twelve.
- A unit removed in the same moment as an employment on it is written can leave that person as of the removed unit
  until they are next written. A provisioner sends the employments before it removes the unit.
- A change of the unit a person acts as ends the work in flight that was started as the old unit, and their sessions,
  as any change of authority does. The first push after this build does that for every manager who is employed on
  another unit than the one they lead.
- A first push is slower than before: each person is derived when they are created, since their employment places
  them, and again when they join their groups. Ten thousand people took 65 seconds on a developer's machine against
  27 before; a push that changes nothing took 28. A manager already known as one is not derived again for each new
  report.
- A connector written against the earlier meaning, which reads `role` and answers for `unitId`, answers for the wrong
  unit for a manager employed on another. Every connector in the repository that answers for a manager's unit reads
  `leads`, and the connector check sends such a manager and fails a connector that gives them the manager's cards for
  the unit they are only employed on.

**Why.** On 2026-11-27 the whole of Sundsvall's directory was read, masked, counts only: 10 666 people with a current
employment. 374 of them have somebody reporting to them and 369 lead a unit. Five have reports and lead no unit. 186
lead only units they are not employed on, and 132 lead more than one. Two of three employees have their manager on
another unit than their own.

Under the rule this replaces, a manager was whoever leads a unit, and the unit a person acted as was a unit they lead
before one they are placed on. The five were then no managers and reached no page that shows their reports. The 186
acted as a unit they are not employed on, and every source was told that unit as theirs. One row with a role could not
say whether a manager works on the unit or only leads it, so Administration › Organisation counted the manager among
the people of every unit they lead.

The three facts are three questions. Who do I report to, and who reports to me, is personnel responsibility: talks,
competence, introduction. Which unit do I answer for is the unit's economy and its figures. Which unit am I of is where
I work. A directory holds them apart, and where it holds two of them differently each answers its own question.

A manager is derived when the employment that names them is written, and not when they sign in, because the role is
read in SQL in several places: who a connector's audience reaches, which people a scan runs for, the sign-in itself. A
role worked out on read would have to be worked out the same way in each.

`leads` is told to every connector, and not only to one that asks as `assignments` is, because `role` alone no longer
says what the earlier actor said. A connector that does not ask for the assignments would otherwise have to guess
which unit a manager leads, and guess wrong for the 186.

**Alternatives.** One table with two flags: the same facts, but a row would still be read as "on the unit". A third
role for someone who is only reported to: every scope, audience and connector would have to learn it, and a scope that
asks for a manager means both. The role on each assignment only, with no role on the person: the rail and every scope
would ask the reporting line on each request. Keeping the unit a person leads as the unit they act as: it is what made
186 people act as a unit they do not work on.

**Refines.** [D147](D147-an-employment-is-a-row-of-its-own-and-names-the-person-it-reports-to.md): item 9 is decided
and built, and the first of its known limits is gone.
[D114](D114-person-profiles-show-employments-and-categorised-phone-numbers.md): an employment places a person on its
unit; it still gives no capability. [D68](D68-people-are-pushed-into-clew-through-standard-scim.md): a person is of a
unit by an employment too, and `unit-manager:` says that they lead the unit and no longer that they are placed on it.
[D129](D129-the-connector-protocol-is-1-and-changes-in-place-until-the-first-release.md): the actor gains `leads`, in
place.

**Replaces.** [D135](D135-a-person-with-several-assignments-sees-the-work-of-all-of-them.md) item 1 (the primary
assignment: manager before employee) for everyone the directory sends an employment for, and items 2 to 5 where they
say "more than one": the grant, the fingerprint, the context and the actor carry the assignments whenever they say
more than the unit and the role.
[D101](D101-a-provisioner-pushes-the-organisation-first-and-adds-before-it-removes-and-a-unit-belongs-to-one-organisation.md)
items 7 and 8 where they choose the unit a person acts as by the manager's role first.

**Evidence.** `tests/unit/who-is-a-manager.test.ts` (the derivation; a manager made and unmade by another person's
write, with the audit rows; two who name each other; a manager employed elsewhere on Administration › Organisation and
Personal; the hold on the managers, the turn started over and the 409; a deactivated person), `tests/scim-store-contract.ts`
on both adapters (leading without belonging, whether somebody reports to a person, the search by unit and role),
`tests/unit/provisioning.test.ts` and `tests/unit/authorization-version.test.ts` (the grant and the fingerprint),
`tests/unit/organisation-tree.test.ts` (who is counted on a unit), `tests/unit/provisioner.test.ts` (a directory that
stops naming a manager, a move with its employment, the development directory's project leader, the check's line),
`tests/db/postgres-scim-concurrency.test.ts` (the rule on PostgreSQL, two who come to name each other at once, the turn
started over), `tests/unit/actor-assignments.test.ts` (what a manager's actor carries, in the body and the assertion,
for a connector that takes the assignments and one that does not), the tests of the hr, timesheet, qlik, incidents,
finance and payroll fixtures (a manager employed on one unit and leading another is answered for the one they lead),
`tests/unit/hr-connector.test.ts` (the connector check's persona), and `tests/a11y/organisation.spec.ts`. The migration is
`0003_who_leads_a_unit`. The whole masked directory was pushed through this build on 2026-11-27 and what it stored was
counted: 374 managers, 5 of them by their reports alone, 186 acting as a unit they do not lead, and nobody a manager
without one of the two reasons or an employee with one (`docs/reference/status/identity.md`).
