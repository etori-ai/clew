# D135 · A person with several assignments sees the work of all of them, and a source is told every one

**Status:** provisional (Oliver Borgström, 2026-11-20; accepted once a real directory has pushed people with more than one assignment and one connector that was not written for Clew answers for each of them); amended 2026-11-24 in the fixes of the review of batch 9 of the review of 2026-11-23: the time fixture declares `assignments: true` too and answers for every unit a person manages, as the HR fixture does, so "Only the HR fixture" under the build's limits reads "Only the HR and time fixtures" · **Date:** 2026-11-20 · **Area:** identity, integrations

**Decision.** A person may hold several assignments: a `unit:` membership is one as an employee, a `unit-manager:`
membership one as a manager ([D68](D68-people-are-pushed-into-clew-through-standard-scim.md)). Clew shows the work of
all of them in the same lists. There is no switch between them.

1. **The primary assignment stays.** Manager before employee, then the lowest unit id by UTF-16 code unit
   ([D101, the provisioner's order](D101-a-provisioner-pushes-the-organisation-first-and-adds-before-it-removes-and-a-unit-belongs-to-one-organisation.md)
   item 8). It is the `unitId` and `role` of the session, of the context background work acts with, and of the actor a
   connector is told, as before.
2. **The grant carries every assignment.** `auth_access_grant.assignments` holds each one with its unit's label when the
   person holds more than one, and is empty otherwise. The derivation writes it in the same transaction as the change
   that moves it (`deriveWithin` in `apps/server/src/modules/people/usecases.ts`); `sameGrant` compares it as a set, so an
   unchanged derivation writes nothing whatever order a store gives the units back in. A changed set writes
   `grant.derived` with `placements`, the units and roles; the separate `assignments.derived` row of
   [D99, the unit tree](D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md) is no
   longer written, since no change of placements leaves the grant as it was. Migration `0083_grant_assignments` fills
   the column from the assignment and unit tables.
3. **The assignments are authority.** `authorizationVersion` covers them, by unit id and role, when there are two or
   more. A person with one assignment keeps the value they had.
4. **The context carries them.** `AuthenticatedContext.assignments`, set by `authenticate` and `systemContext` from the
   same read of the grant, present only when there are two or more.
5. **A source that asks is told every assignment.** The actor gains an optional `assignments`: each unit with its label
   and the person's role there, on every call when there are two or more, to a connector whose manifest sets
   `assignments: true`. Any other connector never sees the field, so one built to refuse a property it does not know,
   as the guide allowed, goes on working for everyone (`remoteConnector` in `packages/connectors/src/remote.ts` leaves it
   out of the body and the assertion alike). It is not D117's `units`
   ([D117, the units below](D117-a-manager-follows-up-the-units-below-and-a-source-is-told-them.md) item 5), which
   names the units a manager follows up, and it never stands in that field: a source that reads `units` as the units a
   manager may see figures for must not be handed an employee's unit. It rides in the request's assertion and body, not
   in the callback grant, which Clew answers from the person's current record anyway. A source answers for each
   assignment with the role the person has there, and one that ignores the field answers for the primary one, as before.
6. **Who reaches what follows the primary assignment.** A connector's audience and a capability's `scope` are decided
   on the primary unit and role (`inAudience`, `inScope`), unchanged. A source that does not know the new field is never
   reached by anyone it was not reached by before.
7. **A card says which unit it is about.** A scan draft may carry `subjects`, units only; Clew keeps them on the card
   as it keeps the subjects of its own cards ([D97](D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md)
   item 6). A row keeps its own `subject`, which for most sources names a person. On Hem and in Att göra the card's line
   names the unit when the card names exactly one, the unit is one of the reader's assignments, and the reader holds
   more than one; the name is the one the reader's session holds, never the source's text. This amends D97 item 6 for
   that case: a card's subject was never drawn.
8. **A decision says the unit.** `execution.approved` carries the card's unit when the card names exactly one and it
   is one of the person's assignments. The execution's own `unitId` stays the primary one.
9. **The person sees their units.** The header's person and Hem's greeting name both of two units, or the primary one and
   how many more when there are more than two; the dialog the header's person opens and the settings dialog name every
   one (`detail` on `SiteHeaderPerson`). The assistant's instructions name every assignment with
   its role.

**Known limits.** Each is a choice of this first build, not an oversight.

- A connector, a model or a job binding whose audience names a unit is not reached through an assignment that is not
  the primary one. An audience on the groups instead reaches everyone placed on the unit: `unit:<id>` its employees and
  `unit-manager:<id>` its managers, since a manager need not be in the unit's own group.
- Someone who is a manager anywhere never reaches a capability scoped to employees, so no such card comes for their
  employee unit. That was so before.
- Läget on Hem and on a unit's page shows the primary unit's figures; a figure is asked without a unit, and the rest
  follows [D119](D119-key-figures-per-unit-come-through-one-vendor-neutral-profile.md).
- The person's own page names the primary unit; their employments under "Anställning" name the others.
- The unit's name on a work item's line is on Hem and in Att göra only, not in the lists on a person's or a unit's
  page, in a conversation or in the work item's head.
- Two employments on one unit are one assignment, and the actor carries no employment number
  ([D114](D114-person-profiles-show-employments-and-categorised-phone-numbers.md) leaves that open).
- Only the HR fixture declares `assignments: true` and answers for every assignment. A real connector declares it when
  it needs it; until then its people are answered for their primary unit.
- The nightly scan runs as before ([issue 86](https://github.com/etori-ai/clew/issues/86) asks whether it is needed),
  and carries the assignments as every other call does.

**What a change of assignments does.** A unit gained or lost, or a role changed on one, changes the person's
authorization version. Their cards from sources are hidden until the next scan, their reminders and approved
decisions in flight stop as `authority-revoked`, and their retained answers are hidden (D75); the browser is told and
clears what it holds. The next scan makes the cards again under the new version and closes each open card it replaces
(`thread.superseded`), so no open card is left behind unseen; a card with a receipt or a dismissal is history and is
kept. When the change is undone, the decided cards made before it are readable again, the open ones are made afresh,
and what was made in between is not. This is what a change of the primary unit did before; an acting manager now meets it the day they take the
unit on and the day they give it back. Keeping older content readable for as long as its assignment is still held
would mean comparing "covered by" instead of "the same" wherever the version is compared, and is a step of its own.
Deploying migration 0083 does this once for every person who holds more than one assignment
([runbook](../maintainers/reliability-operations.md#changing-the-authorization-fingerprint)). Tried on the
development stack on 2026-11-20 as `sara.nystrom`, manager of the finance and the HR department: Hem listed a leave
request from each, each naming its unit, and approving the HR department's wrote `execution.approved` with
`unit: unit-hr`. A third unit added over SCIM wrote `grant.derived` with three placements; the page cleared, the line
under the greeting read "Ekonomiavdelningen och 2 enheter till", the open card came back with the next scan, and the
request she had approved was gone from Klart. With the unit removed again, it was back. A reminder and a conversation
across such a change were not tried.

**Why.** Oliver Borgström asked on 2026-11-19 how a person with several employments moves between them, and chose on
2026-11-20, of the two ways weighed, that such a person sees everything rather than switches. Clew's own domains already
read every assignment (Personal, talks, competence, introduction and the dialogue follow `staff.reach`), so only what
sources push and the assistant followed one; a switch would have hidden the other assignment's work, which the vision's
"one place that shows what needs you today" does not allow, and would have stopped reminders and approvals at every
switch exactly as a lost unit does. Of the two ways to tell a source, one call with every assignment was chosen over a
call per assignment, at his choice, to keep the structure of D117: the actor carries a list, the source answers for it.
It costs Clew almost no new plumbing and leaves each source to keep the units and roles apart; a call per assignment
would have kept them apart for the source and needed a context per assignment through refresh, decisions, timers and
the assistant. The field is not `units` because the Qlik connector reads every entry there as a unit the manager
follows up, and an employee's unit there would have shown its figures. Audience and scope stay on the primary
assignment so that no source is reached by someone it was not reached by before. The field is sent only to a
connector that declares it, because the guide had told connector authors they may refuse a property they do not know:
sent to all, it would have broken every call of a person with two units to such a connector (found in the review of
this change).

**Replaces.** D68 item 3 ("several assignments, one active"; the primary one is now one of several that a source is
told); amends D117 item 5 (the actor gains a second optional list beside `units`) and D97 item 6 (a card's unit subject
is drawn as described in item 7). The open question "May a person switch between several assignments, and how?" is
settled.
