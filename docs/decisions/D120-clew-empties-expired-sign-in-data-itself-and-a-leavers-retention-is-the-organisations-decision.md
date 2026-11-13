# D120 · Clew empties expired sign-in data itself, and a leaver's retention is the organisation's decision

**Status:** provisional (taken in the fixes of [the review of users and the organisation](../reviews/2026-11-12-users-the-organisation-and-the-guides-in-two-rounds.md), Q7, L3, P4 and R3, on the product owner's word of 2026-11-12 to fix every finding and take every open decision), the nightly clean-up built 2026-11-12 and `scripts/person-erase.ts` 2026-11-13; accepted once the clean-up has run in an installation outside the development stack and an organisation has erased a leaver's record with the scripts under its own retention rules · **Date:** 2026-11-12 · **Area:** identity, platform

**Decision.**

1. **Clew empties expired sign-in data every night.**
   - A job of the kind `sign-in-cleanup` runs at 03:00 Europe/Stockholm, under the id `sign-in-cleanup:<date>`, through
     the job table and its `scheduledJob` workflow
     ([D86](D86-the-ledger-starts-its-workflow-inside-its-own-transaction.md)), with a `job.scheduled` and a
     `job.completed` row (actor `system:scheduler`). Every server process schedules it at start, and each night
     schedules the next one before it cleans. The id is fixed for each date, so the clean-up runs once a night however
     many processes schedule it. It needs no cron job and no configuration. Since 2026-11-13 a start schedules it once
     the server's durable engine has launched, and takes over the last and the next night when a deployment left them
     waiting under the replaced release, which no process of the new release would otherwise run, so a deployment
     needs no step for it, and a night whose time fell during the deployment runs late, once the start has taken it
     over ([D85](D85-dbos-transact-replaces-temporal-as-the-durable-engine.md) item 2, as amended that day).
   - In one transaction it removes every session past its absolute or idle expiry, with its sealed tokens, and writes an
     `expired` row in the authentication log (actor `person:<id>`) for each one that was still open. A session that had
     already ended goes without a second row. It also removes the login transactions and the logout receipts past their
     expiry.
   - It never removes rows of the authentication log or of the audit trail, sign-in bindings or people. How long the
     authentication log and the audit trail are kept is the organisation's decision, as a leaver's record is (item 2),
     and Clew has no tool that removes their rows by age (see Limits).
   - A session cannot be used once either expiry has passed, since every request checks it, but its row stays until the
     next night, up to about a day. A browser that comes back with the cookie after the expiry ends the session at once
     with an `expired` row, and the night then removes the row without writing another.
   - A night whose clean-up fails logs one error line, scope `scheduler`, "sign-in clean-up failed", and completes; the
     next night tries again. `bun run auth:setup` runs the same clean-up once.
2. **How long a leaver's record is kept is the organisation's decision**, under its own archive and data-protection
   rules, not Clew's. A deactivation clears nothing ([D68](D68-people-are-pushed-into-clew-through-standard-scim.md)
   item 1). The person's record, with every phone number and employment, their memberships and placements as the last
   push left them, their sign-in binding, and the cards, talks and competences about them and the dialogue rows that name them stay until an operator
   erases them. The audit trail and the authentication log keep their rows: an erasure takes the person's identifiers
   out of them and keeps every event (item 3). At the identity provider, a leaver's account is disabled, not deleted,
   for as long as the person may come back, and is deleted only under the same decision.
3. **An operator erases a deactivated person's record with `scripts/person-erase.ts`.** It runs in the app container
   and has no route and no page: a page for it would be new surface, which
   [D101](D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md) item 4 freezes.
   - Only after the source has stopped sending the person and SCIM has deactivated them. A push that looks the person
     up by user name or source key afterwards finds nobody and creates a new person with a new id, and a client that
     still writes to the old id fills the row again: a `PUT /Users/<id>` gives it a user name and fields, and a `PATCH`
     with `active: true` makes it active without a user name.
   - The procedure for one person runs `scripts/subject-erase.ts`, `scripts/talks-erase.ts`,
     `scripts/competence-erase.ts` and `scripts/dialogue-erase.ts` first, each with the person's id
     ([D122](D122-clew-keys-its-own-records-about-a-person-by-the-persons-id.md) item 7), and
     `bun scripts/person-erase.ts --person <id> --confirm` last. The domain erasures still find the person by the id once the
     record is erased. Each of them refuses an id the people table does not hold and a person who is still active, as
     this script does (2026-11-13: until then the three erased an active person's cards, talks and competence). They
     cancel no durable workflow, since a script never starts the engine: a removed card's timer goes with the card, and
     its workflow wakes at its time, finds no timer and ends
     ([D86](D86-the-ledger-starts-its-workflow-inside-its-own-transaction.md)).
   - A person is named by their id, never by a user name. It refuses an id the people table does not hold and a person
     who is still active, and writes nothing and no audit row for either.
   - In one transaction it takes the person out of their groups, moving each group's time of change, and removes their
     placements, grant, sign-in bindings under every issuer and sessions with their sealed tokens. It clears every
     personal attribute: the name, the e-mail address, the phone numbers, the employments and the title. It stores no
     user name and no source key (`externalId`). The row keeps its id, which other records point at, its organisation,
     its deactivation and its time of creation, and nothing personal.
     Audit redaction merges only the selected identifier fields into each current row, in row-id order. Erasing two
     people named in the same conflict event cannot restore an identifier the other erasure already masked.
   - The record then reads as its id. Clew answers a record without a user name with its id in the user name's place,
     so `GET /scim/v2/Users/<id>` answers the id as `userName`, an empty name, no address, no groups and
     `active: false`, and Administration › Användare shows the id where the user name stood. A filter on `userName` or
     `externalId` no longer finds it, and the source can push the same name and key again as a new person.
   - No key resolves to the erased person: neither the id nor any name they held (`userName` and `holders`, D122). A
     card started from their menu with an `execute` keeps them by id, and its one action, the decision, can no longer
     be taken: the decision and its preview answer "Personen finns inte längre i katalogen. Inget har skickats." and
     nothing reaches the ledger. An execution approved from such a card before the erasure keeps its person
     (`execution.subject`), and dispatch settles it with the reason `subject-changed` and sends nothing (D122 item 5).
   - Every other card about the person keeps the actions its source wrote: a card a source pushed, and one started
     from their menu with a `propose`, whose actions are the source's own (D122 item 4). Neither `subject-erase` nor
     this script closes a card. Such an action can still be decided afterwards and is sent with the input the source
     wrote, and an execution approved from one, before the erasure or after, keeps no person and is dispatched as
     approved (see Limits).
   - It replaces the person's identifiers in the audit trail and the authentication log with `[erased]` and keeps every
     event: `userName` and `externalId` in the details of `scim.user.created`, `scim.user.replaced`,
     `scim.user.patched`, `scim.user.deactivated` and `scim.user.reactivated`; `value` and `subject` in the
     `identity.conflict` rows about the person, and `subject` in those whose `holder` is the person; `oldSubject` and
     `newSubject` in the person's `identity.rebound` rows; and the claim value in the authentication log's
     `identity-unmatched` rows whose actor `claim:<value>` names one of the user names the person has held or their
     e-mail address, compared as a sign-in compares a claim with a user name. A claim holds the e-mail address when the
     identity provider is set to send it. A value that is `null` or empty held nothing and stays as it is: a first
     binding still reads `oldSubject: null`, and a release `newSubject: null`.
   - It writes one `person.erased` audit row, actor `operator:cli`, about `person:<id>`, with counts only: the
     personal fields cleared, the memberships, placements, grants, sign-in bindings and sessions removed, and the audit
     rows and authentication-log rows whose identifiers it replaced.
   - It can be run again. A group push that the source sent before it stopped sending the person, and that put them
     back in a group, is undone by a second run, which removes the membership and moves the record's time of change.
     With nothing left, a run changes nothing and still writes its row, with zero counts.
   - A person pushed by mistake is deactivated by the source and then erased the same way. Until then, the source can
     clear the title, the phone numbers and the employments with one `PUT` with `active: false`, as the operations guide
     describes.

**Why.** The server never ran the clean-up the code defined (L3). `pruneAuthentication` ran only in the development
setup, so almost every session that ended by expiry kept its sealed access, refresh and ID tokens for good. With the
master key a refresh token still opens from the row, and on Microsoft Entra ID with `offline_access` it stays usable for
up to 90 days by Microsoft's default. Login transactions, one for every anonymous visit to the sign-in address, and
logout receipts grew without bound. Expired sign-in data has no use and is personal data, so nobody gains from keeping
it, and removing it needs no decision on retention.

Nobody had decided how long a leaver's record is kept (R3).
[D101](D101-a-provisioner-pushes-the-organisation-first-and-adds-before-it-removes-and-a-unit-belongs-to-one-organisation.md)
item 9 left it to an open item of D68 that D68 never held, and the guides keep a deactivated person's record current on
purpose. A municipality's records can be official documents that only the organisation's own decisions under its archive
rules may cull, and the organisation's data-protection officer answers for what is kept. Clew cannot know those rules,
so the decision stays with the organisation, and the erase gives it a way to carry the decision out: a decision on
retention means nothing without one.

**Weighed and left.**

- A cron job or a timer outside the server, for the clean-up: one more thing every hosting team would have to set up and
  keep running.
- A timer for each session: one more durable workflow for each sign-in, for data that one statement a night removes.
- The old prune's removal of authentication-log rows after 30 days: a retention period for evidence the organisation may
  need, and so not Clew's to choose.
- A fixed retention period in Clew: it would erase returners, such as substitutes, seasonal staff and people rehired
  after a break, with everything Clew knew about them.
- A period an administrator sets, run automatically: no person would check a legal hold, an open case or a pending
  request for access before the deletion, and it cannot be undone.
- Erasure at deactivation: an export cut short by a fault would become a loss of data. The example provisioner's guard
  ([D101](D101-a-provisioner-pushes-the-organisation-first-and-adds-before-it-removes-and-a-unit-belongs-to-one-organisation.md)
  items 2 and 3) refuses a run that would withdraw all of a population, or more than one row and more than a fifth of
  it, unless it is forced. A smaller cut, a run forced past the guard or a provisioner without one would erase people
  for good.
- Deleting the person's row: cards, audit rows, talks and executions point at the id, so the row is minimised in place
  and every reference stays valid.
- The person's id as the erased record's user name. A stored id would be a user name like any other. It would resolve
  to the erased person, so a card started from their menu with an `execute` could still be decided, and sent with
  Clew's id where the source expects a user name. A person whose id is their user name, as the development stack's
  sign-in personas written by `scripts/auth-setup.ts` are, would keep the name, and the source's next push of it would
  be refused with 409. And the id could equal another person's user name in another case, which the unique index
  refuses, so the erasure would fail.
- Reading a user name that equals the person's id as none: it would take the user name from active people whose id is
  their user name, such as those personas.
- Closing the cards about an erased person whose actions a source wrote, or refusing the erasure while one is open
  (decided 2026-11-13, when the documents were found to promise more than the code did). A card a source pushed is the
  source's work: its next scan draws it again or settles it, so a card Clew closed would come back. One started from
  the person's menu with a `propose` holds the source's own action and the input the source wrote, under the source's
  own key, which the source still holds: the erasure is of Clew's record, and what the source holds stays the
  source's (item 2). Either card is also the record of what the person who holds it did, and its text stays like any
  other text (Limits). Refusing the erasure would make it wait on work in other people's streams, which the operator
  cannot see. By the time an organisation's retention says that a record goes, such a card has normally long been
  decided.

The clean-up runs at 03:00 Stockholm time because that hour exists on both days the clocks change. A failed night
completes rather than throws: a job that throws is claimed again by its workflow every few minutes for as long as the
failure lasts, one more such workflow each night, while the next night repeats the clean-up anyway.

The erase takes one person at a time, and the organisation runs it from its own list when its rules say that a record's
time has come. Refusing an active person, in this script and in the erasures that come before it, avoids cutting off
someone who still works there from their record, their cards, their talks and their competence, and erasing what the
next push and the next scan would create again. The audit trail keeps every event, and names the person there only by
an id that no longer leads to a name. For an organisation of several thousand employees, leavers come every week and
many of them come back. Keeping the record until the organisation decides lets a returner be reactivated with their
history, and the erase lets the organisation keep its own rules for each person who does not come back.

The erased record stores no user name, so no key leads to the person any more: an action started from their menu with
an `execute`, which Clew resolves to a user name when it is decided and checks again before it is sent, cannot reach a
source under a name once they are erased, and the name is free for the source to give again. Where a user name is
shown, Clew reads the record as its id, as it reads any record without one. The identifiers in the audit trail become
`[erased]` rather than `null`: the trail still shows that a value was there, a `null` keeps its own meaning (no binding
before a first one, none after a release), and in the authentication log a row without an actor already means one that
names nobody.

**Limits.**

- Clew has no tool that removes rows of the authentication log or of the audit trail by age, so both grow for as long
  as the installation runs. An organisation whose rules say that older rows must go can remove them only in the
  database itself, outside Clew. The erase of item 3 takes one person's identifiers out of these rows and keeps every
  row.
- No script reaches what other records hold about an erased person as text, or what other systems hold: a calendar
  proposal's `participant_name` and `participant_email`; an approved execution's payload, where a started action's
  `payload[subject.param]` holds the user name the person had when it was decided (`subject.param` names the input
  property, such as `person`, and `subject.personId` is the id); the text of card messages and rows and a source's own
  card topics; the answers typed for an action's asks (`asked`) in `thread.started` and `execution.approved` rows,
  which can name the person; the operator's name typed into `identity.rebound` rows when the erased person ran
  rebinds; the source systems and the identity provider's account; and backups, server logs and traces. An operator
  removes these by hand, or the organisation's retention does.
- No script closes a card whose actions a source wrote about an erased person: a card the source pushed, or one
  started from their menu with a `propose`. It keeps the source's own actions with the input the source wrote, which
  can name the person by the source's own key or by the user name the source was sent. Those actions can still be
  decided after the erasure and are sent as written, and an execution approved from one is dispatched as approved.
  Only a card started with an `execute`, and what was approved from it, is refused (item 3).

**As built.** `removeExpiredSignIns` in `packages/db/src/auth.ts`, bound for the scheduler as `signInData` in
`apps/server/src/composition/sign-ins.ts`; the job kind `sign-in-cleanup`, `scheduleCleanup` and `startNightly`, which
schedules the next nightly scan and the next clean-up when a process starts, in `apps/server/src/scheduler/usecases.ts`;
`startJobs` in `apps/server/src/composition/jobs.ts` and the binding in `apps/server/src/composition/index.ts`; the
take-over of the last and the next night, `seedNightly` in the scheduler and `moveToRunningVersion` in
`apps/server/src/dbos/start.ts` (2026-11-13), and the operator's move of an older night, `scripts/workflows-move.ts`;
`scripts/auth-setup.ts`. Tests: `tests/db/sign-in-cleanup.test.ts` (on PostgreSQL, through `signInData`, what goes and
what stays, and one job, one workflow and one `job.scheduled` row for each of the two nights a start schedules, however
often a process starts), `tests/unit/scheduler.test.ts` (the next 03:00 Stockholm, once for each date; both nights from
one start and nothing more from a second; a failing clean-up that still schedules the next night and completes; a start
that takes over the last and the next night left under a replaced release and runs the last one late; and a start that
waits for the engine and tries again after a failure), and `apps/server/tests/job-runtime.test.ts` in
`bun run test:durability` (nights on the real durable engine, a failing one included, and the nights a killed instance
of one release took from the queue, taken over by the start of the next release on the same instance after the
clean-up's night had passed, one of them left cancelled by a start stopped before its rewind and one moved meanwhile by
another start, which leaves it, and run once under it). `scripts/person-erase.ts` runs `personErasureUsecases` in
`apps/server/src/modules/people/usecases.ts`, bound as `personErasure` in `apps/server/src/composition/people.ts`; what
it replaces in the audit trail and the authentication log is named by `IDENTIFIERS_ABOUT`, `IDENTIFIERS_AS_HOLDER` and
`namesHeld` in `apps/server/src/modules/people/domain.ts`, and its store ports are held to
`tests/scim-store-contract.ts` on both adapters. Tests: `tests/unit/person-erase.test.ts` (the two refusals; what is
cleared and what is kept, the SCIM resource that reads the id as `userName`, no key that resolves to the person, `null`
and empty values kept, a second run with zero counts, and the freed name and key; a second erasure after a stale group
push; someone else holding the id as a user name in another case; a person whose id is their user name; all or nothing;
that every SCIM row about a person holds its identifiers where the erase looks; and the script's answers before it asks
the database), `tests/db/person-erase.test.ts` (on PostgreSQL, a person pushed through SCIM and signed in, found by the
SCIM filters on the source key and the user name once deactivated, then erased, with every table and the audit trail
searched for each value that named them; the stale group push undone by a second erasure; the freed name and key pushed
again as a new person; the other three erasures still finding the person by id; and the script's exit codes and answers,
with someone else holding the person's id as a user name in another case), `tests/unit/entities-actions.test.ts` (an
execute about a person erased since cannot be decided, and nothing is approved), and, for the card, talks and competence erasures, `tests/unit/erase-scripts.test.ts` (the arguments refused before the database is asked, and the answer of all
four to a database they cannot reach) and `tests/db/erase-scripts.test.ts` (as scripts on PostgreSQL: an unknown id and
an active person refused; a failed query answered by all four with the database's own message and that nothing was
written; and a deactivated person erased with the script's own answer alone, a card with a waiting timer included).

**Replaces.** `pruneAuthentication`, which only the development setup ran. Its revocation and removal of expired
sessions is now done every night in the server, from the first night after either expiry rather than a day after the
absolute one; its removal of authentication-log rows after 30 days is done nowhere.
[D101](D101-a-provisioner-pushes-the-organisation-first-and-adds-before-it-removes-and-a-unit-belongs-to-one-organisation.md)
item 9 left erasure to an open item of [D68](D68-people-are-pushed-into-clew-through-standard-scim.md): nothing is
erased through SCIM (D68 item 1), and an operator erases outside it with the script of item 3. Amends
[D108](D108-competence-is-an-owned-domain-one-holding-typed-against-a-catalogue.md) item 14, which is proposed: no
timer erases a leaver's holdings after a period; they are kept, as the rest of the record is, until an operator
erases them under the organisation's decision. The review recommended an open question on retention (Q7); none is
opened, since this record answers it.
