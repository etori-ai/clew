# D117 · Clew empties expired sign-in data itself, and a leaver's retention is the organisation's decision

**Status:** provisional (taken in the fixes of [the review of users and the organisation](../reviews/2026-11-12-users-the-organisation-and-the-guides-in-two-rounds.md), Q7, L3, P4 and R3, on the product owner's word of 2026-11-12 to fix every finding and take every open decision), the nightly clean-up built 2026-11-12 and `scripts/person-erase.ts` 2026-11-13; accepted once the clean-up has run in an installation outside the development stack and an organisation has erased a leaver's record with the scripts under its own retention rules · **Date:** 2026-11-12 · **Area:** identity, platform

**Decision.**

1. **Clew empties expired sign-in data every night.**
   - A job of the kind `sign-in-cleanup` runs at 03:00 Europe/Stockholm, under the id `sign-in-cleanup:<date>`, through
     the job table and its `scheduledJob` workflow
     ([D86](D86-the-ledger-starts-its-workflow-inside-its-own-transaction.md)), with a `job.scheduled` and a
     `job.completed` row (actor `system:scheduler`). Every server process schedules it at start, and each night
     schedules the next one before it cleans. The id is fixed for each date, so the clean-up runs once a night however
     many processes schedule it. It needs no cron job and no configuration.
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
   push left them, their sign-in binding, and the cards, talks and competences about them stay until an operator
   erases them. The audit trail and the authentication log keep their rows: an erasure takes the person's identifiers
   out of them and keeps every event (item 3). At the identity provider, a leaver's account is disabled, not deleted,
   for as long as the person may come back, and is deleted only under the same decision.
3. **An operator erases a deactivated person's record with `scripts/person-erase.ts`.**
   - Only after the source has stopped sending the person; otherwise the provisioner's next run creates the person
     again, as a new record.
   - The procedure for one person runs `scripts/subject-erase.ts`, `scripts/talks-erase.ts` and
     `scripts/competence-erase.ts` first, each with the person's id
     ([D116](D116-clew-keys-its-own-records-about-a-person-by-the-persons-id.md) item 7), and
     `bun scripts/person-erase.ts --person <id> --confirm` last.
   - It refuses an id the people table does not hold, and a person who is still active, and writes no audit row for
     either.
   - In one transaction it removes the person's memberships, placements, grant, sign-in bindings and sessions. It clears
     every personal attribute: the name, the e-mail address, the phone numbers, the employments and the title. It
     replaces the user name with the person's id and drops the source key (`externalId`). The row keeps nothing
     personal: its id, which other records point at, stays with its organisation and its deactivation, and a later push
     of the same person creates a new record.
   - It replaces the person's identifiers in the audit trail and the authentication log with `[erased]` and keeps every
     event: `userName` and `externalId` in the details of `scim.user.created`, `scim.user.replaced`,
     `scim.user.patched`, `scim.user.deactivated` and `scim.user.reactivated`; `value` and `subject` in the
     `identity.conflict` rows about the person, and `subject` in those whose `holder` is the person; `oldSubject` and
     `newSubject` in the person's `identity.rebound` rows; and the claim value in the authentication log's
     `identity-unmatched` rows whose actor `claim:<value>` names one of the user names the person has held or their
     e-mail address, compared as a sign-in compares a claim with a user name. A claim holds the e-mail address when the
     identity provider is set to send it.
   - It writes one `person.erased` audit row, actor `operator:cli`, with counts only.
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

The clean-up runs at 03:00 Stockholm time because that hour exists on both days the clocks change. A failed night
completes rather than throws: a job that throws is claimed again by its workflow every few minutes for as long as the
failure lasts, one more such workflow each night, while the next night repeats the clean-up anyway.

The erase takes one person at a time, and the organisation runs it from its own list when its rules say that a record's
time has come. Refusing an active person avoids cutting off someone who still works there, and erasing a record that the
next push would create again. The audit trail keeps every event, and names the person there only by an id that no
longer leads to a name. For an organisation of several thousand employees, leavers come every week and many of them
come back. Keeping the record until the organisation decides lets a returner be reactivated with their history, and the
erase lets the organisation keep its own rules for each person who does not come back.

**Limits.**

- Clew has no tool that removes rows of the authentication log or of the audit trail by age, so both grow for as long
  as the installation runs. An organisation whose rules say that older rows must go can remove them only in the
  database itself, outside Clew. The erase of item 3 takes one person's identifiers out of these rows and keeps every
  row.

**As built.** `removeExpiredSignIns` in `packages/db/src/auth.ts`; the job kind `sign-in-cleanup` and `scheduleCleanup`
in `apps/server/src/scheduler/usecases.ts`; `startJobs` in `apps/server/src/composition/jobs.ts` and the binding in
`apps/server/src/composition/index.ts`; `scripts/auth-setup.ts`. Tests: `tests/db/sign-in-cleanup.test.ts` (on
PostgreSQL, what goes and what stays, and one job, one workflow and one `job.scheduled` row however often the night is
scheduled), `tests/unit/scheduler.test.ts` (the next 03:00 Stockholm, once for each date, and a failing clean-up that
still schedules the next night and completes), and `apps/server/tests/job-runtime.test.ts` in `bun run test:durability`
(nights on the real durable engine, a failing one included). `scripts/person-erase.ts` runs `personErasureUsecases` in
`apps/server/src/modules/people/usecases.ts`, bound as `personErasure` in `apps/server/src/composition/people.ts`; what
it replaces in the audit trail and the authentication log is named by `IDENTIFIERS_ABOUT`, `IDENTIFIERS_AS_HOLDER` and
`namesHeld` in `apps/server/src/modules/people/domain.ts`, and its store ports are held to
`tests/scim-store-contract.ts` on both adapters. Tests: `tests/unit/person-erase.test.ts` (the two refusals, what is
cleared and what is kept, all or nothing, that every SCIM row about a person holds its identifiers where the erase
looks, and the script's answers before it asks the database) and `tests/db/person-erase.test.ts` (on PostgreSQL, a
person pushed through SCIM and signed in, then erased, with every table and the audit trail searched for each value that
named them; the freed name and key pushed again as a new person, and the other three erasures still finding the person
by id).

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
