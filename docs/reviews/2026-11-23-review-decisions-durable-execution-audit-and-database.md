# Review: decisions, durable execution, audit and the database · 2026-11-23

Date: 2026-11-23

Reviewed revision: `9fd4c962` on `main` (`origin/main`)
Status: review; nothing was changed, and the fixes are grouped afterwards across the reviews of the same commit

Area 4 of the review of the whole repository, first wave.

One of five reviews of the same commit. This one covers the execution ledger and the human decisions that enter it,
the durable engine (DBOS), timers, scans and follow-up, the calendar's writes and adapters, the store adapters and
their contracts, the schema and migrations, and the purity rules. It also holds the one sweep that crosses every
area: whether each mutating use case in `apps/server/src` writes its audit row in the transaction of the change, and
whether a test asserts that row.

Nothing was changed. No suite was run against the shared database; `bun run test:db` and `bun run test:durability`
are the baseline review's to run. Single unit files and four throwaway probes ran on the memory adapters, and the
probes were deleted afterwards.

## Summary

The ledger's core holds. One decision is one row whatever races for it, an approval is committed with its audit row
and its workflow before anything is sent, a sent write is investigated and not sent again, and a result is fenced by
attempt. Timers, scans and the follow-up are fenced and bounded as D45 and D47 say. Across the whole server no
business change commits without an audit row in its transaction, with two exceptions below. The schema file and the
84 migrations agree exactly.

What does not hold, 27 findings: none critical, 2 high, 9 medium, 16 low.

- **H1.** A connector's manifest is replaced and goes live at every boot, at "Testa anslutning" and when a draft is
  enabled, with no audit row and no administrator's decision; a manifest decides which capabilities exist, which of
  Clew's the connector may call back, and whether it gets the person's token.
- **H2.** A meeting booked or moved from the calendar page is written to the calendar and never confirmed, on either
  adapter: the dialog's instants and the adapters' are compared as text, `…08:00:00Z` against `…08:00:00.000Z`.
- **M1, M2.** A decision that failed, or whose outcome is unknown, has no way out. A failed work item can never be
  decided again, and a calendar write whose read-back finds nothing stays unknown and freezes the manager's planning
  card for the round. H2 lands every booking there.
- **M3.** When Clew itself fails to record a source's answer, the execution is stored as the source not answering
  and nothing is logged.
- **M4, M7.** The rules that decide whether an approval may land on a card, and the fences of three domains' timers,
  are SQL in the composition root with no memory twin; the unit suite tests a hand-written copy. Ten ports or
  groups of ports have behaviour no contract holds both adapters to.
- **M5, M6, M8, M9.** Connector administration writes from a stale read; no erasure clears an invitee's name and
  address from `proposal`; the CalDAV adapter works only where a person's address is `<login>@clew.test`; and a
  decision on a work item is not bound to the version of it the person was shown.

The audit sweep lists every mutating use case: seven changes without a row of their own (H1, L4 and one low branch),
twelve that are bookkeeping or documented, and 22 use cases or branches whose row no test asserts.

Nine things could not be settled by reading and unit runs; each names the test that would settle it.

## How each finding was established

Every finding names the file and line, a scenario, and one of three kinds of evidence: **read** (the call followed
from the route or the workflow step to the store, with what upstream could prevent it checked), **test** (a test in
the repository that shows the behaviour, or says it is intended), or **probe** (a minimal test written for this
review, run on the memory adapters, quoted here and not committed). A finding that rests on reading the Postgres
adapter and was not run against PostgreSQL says so.

Severity is weighed for a system that is not launched and holds mock data, but will be shared with other
municipalities: authorization, leakage, audit and accessibility weigh most; compatibility of existing rows weighs
nothing.

## Findings

Each finding has an id that stays with it (H for high, M for medium, L for low), so the later grouping of fixes can
name it. None is critical.

### High

#### H1 · A connector's manifest is replaced, and goes live, with no administrator's act and no audit row

**Where.** `apps/server/src/connectors/remote.ts:98-117` (boot), `apps/server/src/connectors/usecases/admin.ts:557-571`
("Testa anslutning") and `:368-376` (enabling a draft), `apps/server/src/connectors/adapters/postgres.ts:112-117`,
`packages/db/src/connectors.ts:84-90`, `apps/server/src/connectors/reconcile.ts:104-124`.

**What happens.** Three paths store a manifest fetched from the connector's own service through `recordHealth`, which
the port describes as "not administration: no version bump, no audit" (`connectors/model.ts:96`). Every boot refetches
each enabled connector's manifest and registers it when it differs. "Testa anslutning" stores the manifest its check
fetched, behind `requireAdmin` alone. Enabling a draft stores one before, and outside, the transaction that writes
`connector.enabled`. The watcher compares the stored manifest itself and registers a changed one within five seconds.
A capability the manifest adds is on unless an administrator switched it off (`admin.ts:244`), and a manifest also
says which of Clew's capabilities the connector may call back (`uses`, `packages/connectors/src/index.ts:988`) and
whether it is handed the person's own token (`delegation`, `packages/connectors/src/protocol.ts:480`).

The audited path exists beside these: `refreshManifest` with `apply` shows the administrator what was added, removed
and changed, asks for a fresh authorization and writes `connector.manifest` (`admin.ts:608-618`).

**Scenario.** A connector's service is deployed with a manifest that adds a read with `model: true` and widens `uses`.
At Clew's next restart, or when an administrator presses "Testa anslutning", the read exists for everyone in the
connector's audience and is a model tool, and the connector may call more of Clew as the person. The connector's
history on its administration page (the `audit` rows of `connector:<id>`) shows nothing.

**Established by.** Read, from `main.ts:84` and the route to the registry. How far a widened `uses` or `delegation`
then reaches is the connector-boundary review's to weigh (its findings 1 and 3 report the same from that side, for
"Testa anslutning"); the audit rule (`CLAUDE.md`) and D23 (a connector is governed by an administrator) are broken
either way, and the boot path makes it happen without anyone pressing anything.

#### H2 · A booking or a move made from the calendar page is carried out and never confirmed

**Where.** `apps/server/src/modules/calendar/usecases/decisions.ts:480-487` with `:173` and `:183-193`;
`apps/web/src/components/calendar/booking-dialog.tsx:82-86`, `event-dialog.tsx:94-98`, `:118-121`;
`packages/calendar/src/dates.ts:30-36`; `packages/calendar/src/nextcloud.ts:178-179`, `microsoft365.ts:64-69`.

**What happens.** The read-back that turns a calendar write into a receipt compares the event's start and end with
the approved strings by `===`. The dialogs send what `localInstant` gives, a `Temporal.Instant` as text, which has no
milliseconds when they are zero: `2026-11-30T08:00:00Z`. `createEvent` and `rescheduleEvent` approve the request's
strings as sent, and the route does not normalise them. Both adapters answer `Date#toISOString()`:
`2026-11-30T08:00:00.000Z`. The two never compare equal, so the row is `unknown` after the write and after every
later check, and by M2 the card can then neither be confirmed, undone nor dismissed. For a move, the talk whose
meeting it is does not follow it (`composition/execution-projection.ts:265` needs a `done` row; D133).

A drawn proposal escapes: its times come back from PostgreSQL in the adapters' spelling. Cancel escapes: it is
confirmed by absence.

**Scenario.** A person books a meeting with "Ny bokning", on Nextcloud or on Microsoft 365. The meeting is in the
calendar and the invitations are sent. The work item says "Kalendern har inte bekräftat resultatet. Kontrollera status
innan du försöker igen." and stays so.

**Established by.** Probe: the use case's own `calendarExecutionSource`, an instant from `localInstant`, and a
provider that answers as both adapters do. The adapters' answers were read, not run against a server.

```ts
const start = localInstant('2026-11-30T09:00'), end = localInstant('2026-11-30T10:00'); // what the dialog sends
// provider.create stores, provider.lookup answers new Date(start).toISOString(), as nextcloud.ts:178 and microsoft365.ts:68 do
const first = await source.execute(persona, execution);
const again = await source.lookup(persona, { ...execution, result: first });
// {"sent":"2026-11-30T08:00:00Z","held":"2026-11-30T08:00:00.000Z","first":"unknown","again":"unknown"}
```

No test meets it: every test and the provider contract write `.000Z` (`tests/calendar-provider-contract.ts:22-28`,
`tests/unit/calendar-executions.test.ts:34`), the memory calendar echoes its input (`packages/calendar/src/memory.ts:93-98`),
and the browser scenarios answer the route themselves (`tests/a11y/support.ts:1030`). The contract's `date-time` also
allows an offset (`packages/contracts/src/index.ts:156-162`), which `decisions.ts:343` then compares as text with the
person's own events: a start written `09:00:00+01:00` is not seen to overlap a meeting at 08:00Z.

### Medium

#### M1 · A work item whose decision failed can never be decided again

**Where.** `apps/server/src/threads/usecases/decisions.ts:135-152`, `apps/server/src/modules/executions/usecases.ts:150-172`
and `:711`, `apps/server/src/routes/api.ts:375`, `apps/web/src/status-of.ts:236-243`.

**What happens.** `act` takes the decision id of the item's execution whenever the item has one that is not an undo
(`previous`, line 136), except for the one reason `subject-changed`. The ledger answers a known decision id with the
row it has: `commit` writes no audit row and starts no workflow when the insert finds the decision, and a different
payload is refused with "Beslutet gäller redan ett annat innehåll". So once an item's execution has settled `failed`
(the source refused every row, or the approval expired unsent after 24 hours), or `partial` on an action without a
row-by-row review, pressing the action again sends nothing and answers 200 with the same failed item; answering the
action's questions differently is refused; and another action of the item is refused with "Ett tidigare beslut väntar
redan på besked", though nothing waits. "Kontrollera status" does nothing either: `reconcile` returns for any state
but `pending` and `unknown`. The item says "Beslutet gick inte igenom. … Kontrollera beskedet innan du fattar ett nytt
beslut", and no new decision can be made on it. Dismissing it is the only move left, and a dismissed occurrence stays
away while the source leaves it unchanged (D47), so the work leaves Clew.

**Scenario.** A manager answers an action's question (D112), the source refuses the row because of the answer, and
the manager corrects the answer and presses the button again: refused. The same after an approval on a connector that
acts as the person expires unsent.

**Established by.** Read, and the repository's own test, which states it as intended for every failure but one:
`tests/unit/entities-actions.test.ts:535-539` ("Any other failure is the same decision asked again, which the ledger
answers with the execution it already has"). D80's retry (`retryRejected`, `threads/usecases/cards.ts:275`) covers
only an action with `review: 'each'` and rows the source marked failed.

#### M2 · A calendar write whose read-back finds nothing stays unknown for good, and freezes the planning card

**Where.** `apps/server/src/modules/calendar/usecases/decisions.ts:464-491` and `:384`,
`apps/server/src/modules/executions/usecases.ts:643-661`; the refusals at
`apps/server/src/modules/calendar/usecases/decisions.ts:209`, `samtal.ts:329`, `:516`, `:758`, `events.ts:193`,
`invitations.ts:127` and `apps/server/src/threads/usecases/cards.ts:376`.

**What happens.** The calendar's execute swallows every error of the write and then reads the event back by the id it
was to have (`clew-exec-<execution>-<item>`). A create whose event is not there is recorded `unknown`, and so is a
move whose event still has the revision it was approved on. Recovery calls the same read-back without writing, which
answers `unknown` again, every time: the calendar's safety is `conditional`, and a conditional write is never sent
again. While a planning thread's execution is `pending`, `running` or `unknown`, `confirm` returns the thread
unchanged and `replan`, `dismiss`, `moveProposal`, `settleCard` and `invitations.settle` refuse; `roundThread` keeps
returning this open thread, so no other is drawn for the round.

**Scenario.** The calendar answers the check right before sending, then refuses or drops the write (a 5xx, a timeout,
or the process stops between the `execution.dispatched` commit and the request). Every later "Kontrollera status"
reads the calendar, finds no event with that id and leaves "Kalendern har inte bekräftat resultatet. Kontrollera
status innan du försöker igen." The manager cannot confirm other times, redraw the week or dismiss the card for the
rest of the round, and the invitee is held against other managers for the approval's 24 hours.

**Established by.** Read, and `tests/unit/calendar-executions.test.ts:423-433`, which fixes the first half as intended
("recovered with reads only, even if some approved items never reached the source" ends `unknown`). The same holds for
any card on a `manual` source, or a `conditional` one whose lookup answers "not found": `progress` settles `unknown`
with `manual-reconciliation` or `replay-not-safe`, `dismissThread` refuses an item whose execution is `unknown`, and
no use case lets a person record what they found in the source. D99, proposed and not built, describes that step for
a job's steps (its item 6); nothing describes it for a single decision.

#### M3 · A failure of Clew's own while a result is recorded is stored as the source not answering, and logged nowhere

**Where.** `apps/server/src/modules/executions/usecases.ts:690-697` and `:648-657`.

**What happens.** `progress` calls `settle` inside the `try` that surrounds the source call. `settle` writes the row,
and on PostgreSQL the card projection with it (`modules/executions/adapters/postgres.ts:117-120`). When that write
throws (a constraint, a port of another module, a lost connection), the `catch` meant for the source settles the
execution `unknown` with `source-outcome-unknown`; the next attempt reads the source back, tries to record the
answer, fails the same way and settles `unknown` with `source-unavailable`. The error is caught without a binding and
the use case has no `log` port (D91), so nothing is logged. The person reads "Källans besked saknas" about a source
that answered, and the defect that caused it leaves no trace.

**Scenario, read and not run on PostgreSQL.** A person approves a card; the source confirms and still lists the work
with a new revision; the next refresh sets the card with the receipt aside and inserts a new open card on the same
topic (`threads/usecases/refresh.ts:209-243`). The person presses Ångra on the first card inside its window. The
source undoes; the projection sets the first card `open` again (`composition/execution-projection.ts:219-221`), which
the index `thread_open_topic` refuses (`packages/db/src/schema.ts:354-356`); the undo is recorded as `unknown`, and
every check repeats it.

**Established by.** Probe, on the memory adapters, with a store that fails where the Postgres adapter runs the
projection:

```ts
const store: ExecutionStore = { ...memory, transaction: fn => memory.transaction(tx => fn({ ...tx,
  update: async e => {
    if (e.state === 'succeeded') throw new Error('duplicate key value violates unique constraint "thread_open_topic"');
    await tx.update(e);
  } })) };
// source.execute and source.lookup both answer a confirmed result
await uc.progress(e.id); // 'reconcile': state unknown, reason source-outcome-unknown
await uc.progress(e.id); // 'done': state unknown, reason source-unavailable; one write was sent
```

#### M4 · Rules that decide outcomes run only in the composition root's Postgres code, outside every port and contract

**Where.** `apps/server/src/composition/execution-projection.ts:30-247` and `:322-361`,
`apps/server/src/composition/boarding-work-items.ts:204-215`, `talk-work-items.ts:178-189`,
`dialogue-work-items.ts:187-198`, `apps/server/src/composition/followup-store.ts:70-125`;
`tests/unit/approval-loop.test.ts:127-185`.

**What happens.** D25 gives the composition root one job, pairing ports with live adapters. Three sets of rules live
there instead, as SQL, with no memory twin:

- The card projection: whether an approval may land on a card at all (the version check that keeps a changed card
  from being executed under an old approval, "a previous decision is still waiting", "already handled"), the check of
  each confirmed proposal against what was approved, the fixed follow-up policy, the lock that keeps two managers from
  inviting one person, what a result does to the card, and five audit actions.
- The fence of the due timers of talks, boarding and dialogue cards (generation, state, due time). Their memory card
  ports answer `true` to any `fire` (`modules/boarding/adapters/memory.ts:122-130` and its two siblings), so a stale
  generation fires in the unit suite and is refused in production.
- What the follow-up's return and delivery write to the manager's and the invitee's cards
  (`modules/calendar/adapters/followup-memory.ts:48-54` sets neither `handledAt` nor the summary).

The unit suite cannot run any of it. `approval-loop.test.ts` carries a hand-written copy of the projection and asserts
its own copy's message (`:139`, `:512`); the thread port cannot express the fields the projection writes, as the
copy's own comment says. On PostgreSQL the version check is asserted once
(`tests/db/postgres-execution-store.test.ts:156`); the other two refusals, the policy check and the audit rows
`thread.decision_approved`, `thread.execution_<state>` and `obligation.policy_approved` are asserted by no test.

**Scenario.** A change to `project` that drops the version comparison passes the whole unit suite and
`bun run check`, which does not run `tests/db`.

**Established by.** Read; the test files named.

#### M5 · Connector administration writes from a row read before its transaction

**Where.** `apps/server/src/connectors/usecases/admin.ts:331`, `:403`, `:426-464`, `:519-533`;
`apps/server/src/connectors/adapters/postgres.ts:64-81`; `packages/db/src/schema.ts:526`, `:544`.

**What happens.** `update` reads the connector on the pool, merges the patch into the whole `capabilities` and
`areas` objects as it read them, and writes them back. The adapter's `update` reads `version` without a lock and
writes `version + 1` without comparing it; the patch carries no expected version. The previous holder of the shared
header is found with `store.list()` outside the transaction, and nothing in the schema keeps `header_holder` to one
row (the default model has a partial unique index for the same rule, `schema.ts:609-611`).

**Scenario.** Two administrators save one connector at once: one switches a capability off, the other changes a menu
row. Both `connector.*` audit rows are written, and the second write puts the capability back on. Or two set the
header on two connectors at once and both rows hold it.

**Established by.** Read; not run. Whether the page sends one request per switch decides how easily one person does
this alone.

#### M6 · No erasure reaches the invitations a person was sent: their name and work address stay in `proposal`

**Where.** `packages/db/src/schema.ts:433-435`, `apps/server/src/modules/calendar/adapters/postgres.ts:18`, `:120-122`,
`scripts/person-erase.ts:16-24`; `docs/reference/status/identity.md` ("A leaver's record and its erasure").

**What happens.** A proposal stores whom it invites as `participant_id`, `participant_email` and `participant_name`,
with no foreign key. The five erasure scripts (person, cards, talks, competence, dialogue) write none of them, and
nothing else does: the columns are only ever inserted and read. The status page says what erasure leaves (the audit
events, and the rows' text on cards as the source wrote it); these are Clew's own columns and are not named there.

**Scenario.** A manager invites an employee to a talk. The employee leaves, is deactivated and erased by every
script. Their name and e-mail address are still in the manager's planning thread, drawn from `proposal`.

**Established by.** Read; a search of `apps/server/src` and `scripts` for the two columns finds only the insert and
the reads. Whether these rows should be cleared or kept is the organisation's kind of decision (D123); today no
script can do it.

#### M7 · Ports whose behaviour no contract holds the two adapters to

**Where.** The contract files under `tests/`, against the ports in each module's `model.ts` or `ports.ts`. The
repository's rule (`CLAUDE.md`): "a port change comes with a contract case".

| Port | What no contract case calls | Why it matters |
|---|---|---|
| `UserReads` (`modules/people/ports.ts`) | The contract's memory side is a fake written inside the test (`tests/unit/user-reads.test.ts:37-73`); the helper the unit suites use, `memoryPersonKeys` (`tests/person-keys.ts`), is not bound to it | `holders` keeps a user name inside the reader's organisation (`modules/people/adapters/postgres.ts:52`); the rule that stops a name from another organisation resolving is held on one adapter only |
| The card ports of talks, boarding, dialogue and competence | `fire`, `close`, `reopen`, `remove`, `retime`; competence's `workItems` is not called at all | see M4 |
| `ThreadTx` (`threads/model.ts`) | `admitDelivery`, `lockThreadById`, `updateTimer`, `readTimer` inside a transaction | attention admission has no memory reads at all (`composition/index.ts:104`, `:163-178`) |
| `RefreshTx` (`threads/refresh-model.ts`) | `baseline`, `occurrences`, `openOccurrences`, `saveOccurrence`, `findTopic` | run in two separate suites, never the same cases on both adapters |
| `ExecutionTx` (`modules/executions/model.ts`) | `pushCard`; anything with a `presentation` | the card a watch leaves, and M4 |
| `ProposalStore` (`modules/calendar/model.ts`) | `latestThread`, `lockThread`; a thread that is not the planner's (L6) | L6 |
| `FollowupTx` | what `returnThread` and `stop` leave is never asserted | M4 |
| `FollowBindingStore` (`modules/jobs/model.ts`) | two adapters, no contract file | bindings gate what a job may contain (D77) |
| `ProvisionTx.setGroupRelation`, and a `snapshot` transaction | never called; both harnesses write the relation's rows directly | grants the registrar's relation (D121) |
| `ProposalTx.invitations`, `ProvisionTx.leavers` | the case exists, but the memory harness binds no port that writes | on memory the bound domain's write survives a rollback of the change (`modules/calendar/adapters/memory.ts:145-161`, `modules/people/adapters/memory.ts:139-146`); on PostgreSQL it is one transaction |

The scheduler has only a Postgres adapter and a fake local to its test (`tests/unit/scheduler.test.ts:44-104`).

**Established by.** A search of each contract file for each port method, and reading both adapters of every store.

#### M8 · The CalDAV adapter knows a person only as `<login>@clew.test`, and reads an appointment without an organiser as someone else's

**Where.** `packages/calendar/src/nextcloud.ts:68`, `:166-168`, `:184`;
`apps/server/src/modules/calendar/usecases/reads.ts:23`; `packages/calendar/src/adapters.ts:13`;
`docs/reference/status/calendar.md` ("CalDAV adapter and core calendar paths").

**What happens.** The adapter's account address is built from the login and a fixed domain. "Mine" and "may move or
cancel" are decided by comparing an event's ORGANIZER with that address, and a create writes it as the organiser. An
event with no ORGANIZER at all, which is how a calendar client stores an appointment without guests, compares as not
the person's own.

**Scenario.** On any CalDAV server whose people do not have `<login>@clew.test`, every meeting reads as someone
else's and none can be moved or cancelled from Clew, while new bookings name an organiser the server does not know.
On the development server itself, an appointment a person made in the calendar's own page is drawn "Du är inbjuden"
with no buttons. On Microsoft 365 the same appointment is the person's own.

**Established by.** Read. The development seed creates every event through the adapter, which always writes an
organiser, so neither shows there. The status page says the Microsoft 365 adapter runs only in development; it does
not say the same of CalDAV, and `adapters.ts` says "any CalDAV server in production".

#### M9 · A decision on a work item is not bound to the version of it the person was shown

**Where.** `packages/contracts/src/index.ts:4716-4722`; `apps/server/src/threads/usecases/decisions.ts:77-105`, `:152-155`;
`apps/server/src/composition/execution-projection.ts:56-61`.

**What happens.** `POST /api/threads/:id/act` carries the action, the chosen rows by ref and the answers, and nothing
that says which version of the item the person saw. `act` reads the item again, builds the payload from the action
and rows as they are now, and hands the ledger that read's `updatedAt` as the version. The projection's version check
therefore guards only the moment between the server's own read and its commit. For an action with a row-by-row
review each row's revision is compared; for every other action nothing is.

**Scenario.** A scan rewrites an open item (a row's detail, the action's input) while its page is open. The person
presses the button on what they read; the rewritten input is approved, audited and sent. With no rows sent, the rows
selected on the server's copy are the ones approved.

**Established by.** Read. The review of the assistant and the model boundary reports the same as its finding 4; it
belongs to the decisions' fix.

### Low

#### L1 · A workflow that ends in ERROR leaves its execution or its follow-up with no way forward for the person

**Where.** `apps/server/src/dbos/workflows.ts:62-70`, `:101-110`; `apps/server/src/modules/executions/usecases.ts:711`;
`apps/server/src/routes/api.ts:375`; `apps/server/src/modules/calendar/usecases/samtal.ts:587`, `:601-605`.

**What happens.** A step is tried five times with waits of 1, 2, 4 and 8 seconds (ten times, about eight and a half
minutes, for a timer). When `progressExecution` still throws, the workflow ends in ERROR and only an operator's
`scripts/workflows-move.ts --workflow` starts it again. The execution stays as it was: `pending` with no reason, where
the work item's "Kontrollera status" does nothing (the route asks for a reconciliation only for `unknown` or a
reason), or `running` past its lease, where `reconcile` returns without starting anything. For a follow-up, a check
whose reading of the replies throws (the team or the manager's calendar cannot be read; the per-invitation lookups
are caught, these are not) ends the obligation timer's workflow the same way: nothing schedules the next check, so
the thread is not returned to the manager at the Friday deadline or at the policy's expiry. Operators see both in the
reliability counts (`pendingExecutions`, `overdueTimers`), not as failed workflows.

**Scenario.** PostgreSQL restarts for 20 seconds while an approved execution is in its step.

**Established by.** Read, the retry arithmetic in the pinned SDK (`@dbos-inc/dbos-sdk` 5.5.0, `dbos-executor.js:701-747`),
and a probe: `reconcile` on an execution left `running` an hour past its lease returns it `running` and starts no
workflow. The outage itself was not run. In the same code, any error of the authority check that is not marked
unavailable is recorded as `authority-revoked` (`usecases.ts:609-617`), so a failing statement there reads
"Behörigheten har ändrats".

#### L2 · An executor's heartbeat is deleted before its workflows are adopted

**Where.** `apps/server/src/dbos/heartbeat.ts:36-43`, `:77-84`; `apps/server/src/dbos/start.ts:139`.

**What happens.** The sweep claims a dead executor by deleting its row, commits, and then asks the engine to adopt
its workflows. When the adoption throws, the row is gone and no later sweep finds the executor. Its `PENDING`
workflows wait under the running version, where `workflows-move.ts` refuses them ("it already waits under the latest
version") and only an instance started with the dead executor's id recovers them. The default id is the host name,
which a container platform changes at every restart.

**Scenario.** One instance is killed; ninety seconds later the survivor's sweep claims it and the adoption fails on a
dropped connection. Every reminder, snooze and watch the dead instance held sleeps on.

**Established by.** Read, with the engine's `recoverPendingWorkflows` (`dbos-executor.js:874-890`).

#### L3 · The first scan implementation is unreachable in the server, and its tests still stand as evidence

**Where.** `apps/server/src/threads/usecases/cards.ts:110-203`; `apps/server/src/composition/index.ts:107`.

**What happens.** The composition replaces `ensureThreads` with `refresh.request`, so `scanInto`, with its own
supersede, refresh and wake branches, runs only in unit tests (27 calls in `tests/unit`). It compares stored cards
with `JSON.stringify`, which on PostgreSQL would call every unchanged card changed
(`threads/usecases/refresh.ts:15-18` explains this of the same comparison).

**Established by.** Read; a search for callers.

#### L4 · Three writes the ledger and the administration make leave no row of their own

**Where.** `apps/server/src/composition/execution-projection.ts:227-236` and `:148-154`;
`apps/server/src/connectors/usecases/admin.ts:624-641` with `packages/db/src/schema.ts:1426-1430`, `:1447-1449`, `:1469-1471`.

**What happens.** The projection inserts the `receipt-final` and `undo-expiry` jobs itself and skips the
`job.scheduled` row every other job has, so their trail starts at `job.completed`. An approved undo of a talk
invitation cancels the follow-up policy and its timer, and no `obligation.*` row says the approved plan ended.
Removing a connector deletes, by cascade, every competence holding copied from it, its mappings and its source row;
the audit says `connector.removed` with the number of closed cards, where the operator's own path writes
`competence.source_forgotten` with counts (`modules/competence/usecases.ts:3291-3297`).

**Established by.** Read.

#### L5 · One confirmed effect can be undone twice through the approval endpoint

**Where.** `apps/server/src/routes/api.ts:82-92`, `:220-225`; `apps/server/src/modules/executions/usecases.ts:88-98`;
`packages/db/src/schema.ts:638-683` (no constraint on `compensates`).

**What happens.** `POST /api/executions` takes `compensates` with any decision id. The ledger's rule for an undo
checks the original, its window and the payload, never whether the original is already compensated. Without a
`presentation` the card is not projected, so it keeps its receipt while the source has undone the effect.

**Scenario.** The person who approved posts the undo twice under two decision ids: two executions, two calls to the
connector under two operation ids. The card's own Ångra uses the one id `undo:<original>` and is not affected.

**Established by.** Probe, on the memory adapters:

```ts
const u1 = await uc.approve(persona, { decisionId: 'u1', operation: 'test.undo', payload: undoInput, compensates: original.id });
await uc.progress(u1.id);
const u2 = await uc.approve(persona, { decisionId: 'u2', operation: 'test.undo', payload: undoInput, compensates: original.id });
await uc.progress(u2.id);
// sent: e1 test.do, e2 test.undo, e3 test.undo; e2 and e3 both succeeded with compensates e1
```

#### L6 · On PostgreSQL the planner's `replan` accepts any open card of the manager and rewrites it

**Where.** `apps/server/src/modules/calendar/usecases/samtal.ts:502-547`; `apps/server/src/routes/api.ts:443`;
`apps/server/src/modules/calendar/adapters/postgres.ts:40-65` with `packages/db/src/threads.ts:139-146`;
`apps/server/src/modules/calendar/adapters/memory.ts:48-64`.

**What happens.** The proposal store's reads answer any thread of the person on PostgreSQL and only threads the
store created on memory. `replan` checks that the thread is open and that a round is open, never that it is the
planner's. The assistant's path and the reopen path check for proposals first; the route does not.

**Scenario.** A manager with an open round posts `/api/threads/<their invoice card>/replan` with a week. The card
gets the planner's title, rows, week and trigger, drawn times are inserted on it, and `proposals.replanned` is
audited. The unit suite answers "Ärendet är redan hanterat."

**Established by.** Read, both adapters; not run. The harm stays with the manager's own card.

#### L7 · A connector's observation time is compared as a string with the stored one

**Where.** `apps/server/src/threads/usecases/refresh.ts:117`; `packages/connectors/src/protocol.ts:609`.

**What happens.** The rule that a stale observation never overwrites a newer one compares the connector's
`observedAt` with the stored one by `<`. The protocol's `date-time` allows an offset; PostgreSQL answers UTC with
milliseconds.

**Scenario.** A connector that stamps its observations in Swedish time (`…T09:10:00+01:00`) has one that is up to its
offset older than the stored one (`…T08:30:00.000Z`) accepted as newer. The attempt and lease fences still hold, so
this is the second line of defence, not the first.

**Established by.** Read. The memory adapters keep every instant as written, so the unit suite compares differently
from production here and in H2 (`threads/adapters/memory.ts:70-85` against `timer-postgres.ts:7-15`), and no contract
case writes an instant in another spelling.

#### L8 · The competence module folds a user name's case with the database's collation

**Where.** `apps/server/src/modules/competence/adapters/postgres.ts:710-726`; compare
`apps/server/src/modules/people/adapters/postgres.ts:116-122`.

**What happens.** The people adapter folds with ICU's root locale on both sides, because a plain `lower` folds only
A to Z on a database created with the locale C. `activeByUserName` uses a plain `lower`, lowers the asked names in
JavaScript, and cannot use the index on user names.

**Scenario.** On a C-locale database a registrar opens `Åsa.Öberg`: refused as not theirs. The copy of what a source
holds drops her rows as unmatched.

**Established by.** Read; the identity review saw the same from its side. The contract's names are ASCII and it
runs on the default database only (`tests/competence-store-contract.ts:1118-1128`). The unique names of competence types and boarding layers have the
same shape (`packages/db/src/schema.ts:1318-1320`, `:1149`).

#### L9 · One open card per topic is enforced on insert only by the memory adapter; a reopen can violate it on PostgreSQL

**Where.** `apps/server/src/threads/adapters/memory.ts:111-118`, `:134-138`; `packages/db/src/schema.ts:354-356`;
the reopens at `apps/server/src/threads/usecases/cards.ts:474-480` and `reminders.ts:152-158`.

**Scenario.** A person makes a card from an answer, dismisses it, makes it again, and presses Ångra on the first
within ten minutes; or a reminder fires on a card dismissed and made again. Memory holds two open cards on the
topic. PostgreSQL refuses the update: a 500 for the reopen, and for the reminder a step that fails ten times and
ends its workflow (L1). M3's scenario is the same collision inside the ledger.

**Established by.** Read; not run on PostgreSQL. `tests/store-contract.ts:274-289` covers the insert only.

#### L10 · The change signals miss columns and tables the browser shows

**Where.** `packages/db/migrations/0018_black_zarek.sql:46-57`, `0043_talks.sql:59-83`; D46.

**What happens.** `clew_connector_policy_changed` compares the columns that existed when it was written. `areas`
(0033) and `header_holder` (0038) came later and the function was never replaced, so switching a figure on Hem or
moving the shared header changes no revision and no open page is told; `clew_talk_changed` likewise predates
`booked_by` (0080). `proposal`, the competence and boarding tables, `talk_round`, the model tables, `execution_job`
and the organisation's group, unit and placement tables have no trigger: an open page learns of them only when a
thread of the same person is written in the same transaction. The seven functions and sixteen triggers are
hand-written SQL that `schema.ts` does not name, so a generated migration that recreates a table would drop its
trigger silently.

**Established by.** Read; the migrations were searched for a later definition of each function.

#### L11 · A reminder or snooze whose timer is blocked leaves its card where the timer would have moved it from

**Where.** `apps/server/src/threads/usecases/reminders.ts:218-232`, `cards.ts:225`;
`apps/server/src/composition/index.ts:166`, `:173`.

**What happens.** A timer fires only under the authority it was set with. When the person's authority has changed,
it is set `blocked` with its audit row and nothing else is written: a card parked by "Påminn mig" keeps
`waitingOn: 'påminnelsen 14:00'` and stays among what waits, and a snoozed card keeps a past `snoozedUntil`. `wakeDue`
skips any card that has a snooze timer row in any state, so it never clears it, and the attention reads leave out
every card with a `snoozedUntil`, so that card's deliveries are never shown.

**Scenario.** A reorganisation changes a manager's authority overnight. Cards from sources are made again under the
new authority by the next scan; a card of Clew's own with a reminder stays parked.

**Established by.** Read.

#### L12 · Queries the server runs per page load without an index

**Where.** `apps/server/src/threads/adapters/refresh-postgres.ts:111-113` with `packages/db/src/schema.ts:848`
(`GET /api/threads` reads `refresh_request` by person; the only index is on `next_at`, and no row is ever removed);
`threads/adapters/attention-postgres.ts:71-77`, `:124-130` with `schema.ts:898` (deliveries by batch, and a person's
whole delivery history on every read); `packages/db/src/threads.ts:116-138` (the `execution` JSON evaluated over every
thread the person ever had); the unit tree by `organisation_id` and a prefix `like`
(`modules/people/adapters/postgres.ts:824-845`).

**Established by.** Read of each query against the indexes of `schema.ts`; no plan was run. Session lookup, grants,
threads, messages, executions, audit by subject and the owned domains' lists have usable indexes.

#### L13 · `bun run db:init` cannot notice a skipped migration

**Where.** `scripts/db-init.ts:10-13`; drizzle-orm 0.45.4, `pg-core/dialect.js:56-71`.

**What happens.** The migrator applies the migrations whose journal time is later than the newest one recorded in
the database and compares no hash. A migration that lands with an earlier time than one already applied (two
branches against one database, as the shared development database is used) is skipped, and the script prints
"Migrations applied."

**Established by.** Read of the pinned migrator. On a database that only ever takes `main` in order this cannot
happen: the 84 journal entries are in file order with rising times.

#### L14 · The CalDAV adapter's handling of time zones outside what Clew itself writes

**Where.** `packages/calendar/src/nextcloud.ts:148-151`, `:178-179`, `:387-388`.

**What happens.** Three things, each for an event another client wrote; an event Clew wrote is in UTC and is not
affected.

- Every VTIMEZONE of every file any person's calendar returns is registered in ical.js's process-wide zone service
  under its TZID. A file's own definition wins for that file; a file that names a TZID without defining it is read
  with whatever was registered last, by anyone.
- `lookup` turns a start into an instant with `toJSDate()`. A floating time, or a TZID with no definition in the file
  or the service, is read in the server process's own zone, so the same event answers an hour or two apart between
  `list` (expanded by the server to UTC) and `lookup`.
- `reschedule` replaces the value of DTSTART and DTEND with a UTC time and keeps the property's parameters, so an
  event that had `TZID=Europe/Stockholm` is written `DTSTART;TZID=Europe/Stockholm:…Z`, which iCalendar does not allow.
  The adapter's own read-back accepts it.

**Reach.** `lookup` feeds the times an undo of a move goes back to (`modules/calendar/usecases/decisions.ts:192`) and
what a talk is recorded as when a manager adopts a moved meeting (`invitations.ts:187-196`).

**Established by.** Read of the adapter and of ical.js 2.2.1. Not run against a server; how other calendar clients
read the third is not known.

#### L15 · A meeting made all-day and then adopted books the talk at one in the morning

**Where.** `apps/server/src/modules/calendar/usecases/invitations.ts:53-54`, `:187-196`;
`apps/server/src/modules/calendar/adapters/postgres.ts:36-37`.

**What happens.** An all-day event's start and end are dates. `follow` and `settle` check neither `allDay` nor
`recurring`; `adopt` writes the dates as the proposal's and the talk's times, which PostgreSQL stores as midnight
UTC.

**Scenario.** The manager makes the talk's meeting all-day in the calendar and chooses "adopt" on the difference: the
talk is booked from 01:00 Swedish time that day to 01:00 the next.

**Established by.** Read.

#### L16 · Two inputs the calendar's reads answer with an error of their own

**Where.** `apps/server/src/modules/calendar/usecases/events.ts:81-84`, `:101-105`, `:130-136`; `samtal.ts:172`, `:505`;
`packages/calendar/src/nextcloud.ts:244`, `microsoft365.ts:296`.

**What happens.** A date such as `2026-02-30` passes the pattern the reads check and then fails in `Temporal`, which
is not an input error the route knows: a 500. And a check of availability for eight participants and a room asks for
nine calendars, which both adapters refuse at eight: "Ogiltig tillgänglighetsperiod."

**Established by.** Read; `dayStart('2026-02-30')` was run and throws `RangeError`.

## The audit sweep: every mutating use case in `apps/server/src`

The rule is `CLAUDE.md`'s: "Every mutation writes its audit row in the same transaction", and "A use case change
comes with a scenario test that asserts the audit row". Every exported use case that writes Clew's own database was
followed from the use case into both of its store's adapters. Paths below are under `apps/server/src/` unless they
start with `packages/`, `tests/` or `apps/server/tests/`. "Asserted" means a test calls the use case and compares the
audit row's action; a test that only runs the use case, or that writes the row itself as a fixture, does not count.

How many there are: people 24 (provisioning 4, SCIM 10, provisioner keys 2, users administration 7, erasure 1),
appearance 4 (and the same four for the operator), entity actions 2, talks 11 and the 4 of its invitations port,
connector administration 6 and the boot reconciliation 1, the assistant 4, models 11, competence 47, boarding 12,
dialogue 13, and in this review's own area 51 rows of use cases and composition hooks (threads, reminders, refresh,
the ledger, jobs, the scheduler, the calendar). `modules/errands`, `requests`, `news`, `search`, `work`, `entities/usecases.ts`,
`talk-seam`, `operations`, `connectors/usecases/documents.ts` and `header.ts` write nothing.

No adapter hides an audit write, and in every module the Postgres `transaction` is one SQL transaction with the audit
insert on the same handle. The owned domains write their work items through the thread store inside the domain's
own transaction (`composition/competence.ts:40-57`, `boarding.ts:28-35`, `dialogue.ts:24-31`, `talks.ts:29-36`, all
over `withThreadTx`), so a card and the record it belongs to commit together, each with its row.

### A. A change with no audit row in its transaction

The first six are gaps, and so is the removal of a connector, which deletes the competence holdings copied from it
by cascade under `connector.removed` alone (L4). The rest are bookkeeping or a documented choice, listed because the
rule as written does not exempt them and the list is meant to be complete.

| Use case | What changes | Audit row | Verdict | Asserted by |
|---|---|---|---|---|
| `connectorUsecases.test`, `connectors/usecases/admin.ts:557` | the connector's health, and its stored manifest when the check fetched one (`:571` → `adapters/postgres.ts:112`) | none | **gap** (H1): the manifest goes live | nothing; `tests/unit/connector-admin.test.ts:302` asserts health |
| `connectorUsecases.update`, `admin.ts:325` | enabling a draft stores a fetched manifest at `:372`, before and outside the transaction at `:519` | `connector.enabled` only | **gap** (H1) | enabled `connector-admin.test.ts:255`; `connector.scan`, `.tools`, `.capability`, `.url` by no test |
| `syncBundledRows`, `connectors/reconcile.ts:58`, and `loadConnectors`, `connectors/remote.ts:98` | a row for a bundled connector, enabled for everyone; a refetched manifest replaces the stored one at every boot | none | **gap** (H1), documented at `reconcile.ts:53-57` and `connectors/model.ts:96` | nothing |
| `projectExecution`, `composition/execution-projection.ts:227-236` | the `receipt-final` and `undo-expiry` job rows and their workflows | none for the job (`scheduleJob` writes `job.scheduled`, `packages/db/src/jobs.ts:26`) | **gap**, low (L4) | nothing |
| `projectExecution`, `execution-projection.ts:148-154` | an approved undo cancels the follow-up policy and the obligation timer | `execution.approved` and `thread.decision_approved`; no `obligation.*` row says the plan ended | **gap**, low (L4) | nothing |
| `scimUsecases.replaceGroup` / `patchGroup`, `modules/people/usecases.ts:659-663` | a write that changes nothing of a `position:` group whose position row is missing inserts that row | none when the group has no member | **gap**, low: reachable only for a group stored before the key was read | nothing |
| `modelUsecases.testProvider` `assistant/usecases/models.ts:279`, `probe` `:559`, `check` `:469` (in `testModel` and `addModel`) | the provider's `health` | none | bookkeeping, documented at `assistant/ports.ts:108` | not applicable |
| `scimUsecases.authenticate`, `modules/people/usecases.ts:704` | the provisioner's `last_seen_at`, at most once a minute | `provisioner.seen` only when a run begins | bookkeeping, documented at `:700-703` | `tests/unit/scim.test.ts:63` |
| `competence.copySource`, `modules/competence/usecases.ts:1224-1247` | the source's lease: claim and renewals | none; the copied holdings and `competence.source_read` commit together later | bookkeeping | final row: `tests/unit/competence-copy.test.ts:312` |
| `competence.scheduleCopy`, `:3281` | one workflow start a day | none | documented at `:3277-3279` | the start: `competence-copy.test.ts:918` |
| `competence.holdings` `:2544`, `search` `:2656` | one row in `competence_read_log` | none in `audit`; the read log is the record (D121) | by design | `tests/unit/competence-search.test.ts:213`, `:494` |
| `competenceLeavers.deactivated` / `.reactivated`, `:457-476` | the erasure intent | none of its own; the SCIM row of the same transaction (`composition/people.ts:46`) | covered, unlike `boardingLeavers`, which writes its own | intent only: `tests/unit/competence-retention.test.ts:245` |
| `refreshUsecases.tick` → `store.claim`, `threads/usecases/refresh.ts:387` | the request's lease and attempt | none; `finish` writes `refresh.completed` or `refresh.failed` | bookkeeping | not applicable |
| `runScheduledJob`, `scheduler/usecases.ts:228` → `adapters/durable-postgres.ts:15-39` | the job's claim and its renewals | none; completion writes `job.completed` | bookkeeping | `tests/db/job-lease.test.ts:72` |
| `removeExpiredSignIns`, `packages/db/src/auth.ts:484` | expired sessions, login transactions and logout receipts deleted | `expired` in the authentication log for open sessions; none for the other two | expired machinery | `tests/db/sign-in-cleanup.test.ts:116` |
| `startNightly` → `moveToRunningVersion`, `dbos/start.ts:84`; `moveWorkflow` `:153` | the engine's workflow records only | none; a log line | engine state | not applicable |
| `dbos/heartbeat.ts:30-48` | `clew_durable.executor` rows | none | bookkeeping | not applicable |
| sign-in (`auth.ts:129`, `:151`; `routes/auth.ts:93`; the token refresher `auth.ts:277-299`) | login transactions, idle expiry, refresh claims | none; sessions and bindings have rows in the authentication log | the identity review's | not checked here |

Two lesser things in the same family. `connectorUsecases.update` builds what it writes and what it audits from a row
read before its transaction (`admin.ts:331`), and the adapter's `update` raises the version without comparing it
(`connectors/adapters/postgres.ts:64-81`), so of two administrators saving at once the second writes back the whole
`capabilities` object as it read it: the first one's switch is undone with no row that says so (read, not run). And
`connectors/signing.ts:18-31` and `:61-83` write `connector.signing_key_created` and `_rotated` in their transaction,
asserted by no test.

### B. Audited in its transaction, but no test asserts the row

| Use case | Audit action | What exists instead |
|---|---|---|
| `projectExecution`, `composition/execution-projection.ts:140`, `:239` | `obligation.policy_approved`, `thread.decision_approved`, `thread.execution_<state>` | hand-made rows in `tests/unit/item-events.test.ts:86-140`; the unit suite runs a copy of the projection (M4) |
| `calendarDecisions.createEvent`, `rescheduleEvent`, `cancelEvent`, `undo`, `modules/calendar/usecases/decisions.ts:153-304` | `execution.approved`, `thread.decision_approved` | called in `tests/db/postgres-calendar-decisions.test.ts:169-549` without the approval rows asserted |
| `cardDecisions.undoReceipt`, `threads/usecases/decisions.ts:201` | `execution.approved` | a refusal only, `tests/unit/card-decisions.test.ts:131` |
| `closeReceiptWindow`, `threads/usecases/cards.ts:347` | `thread.receipt_final` | stubbed in `tests/unit/scheduler.test.ts:154` |
| `closeUndoWindow`, `modules/calendar/usecases/samtal.ts:724` | `proposals.final` | the contract writes the row itself, `tests/proposal-store-contract.ts:307` |
| `listThreadsFor` → `wakeDue`, `cards.ts:217` | `thread.woken` (reason `time`, no timer row) | the asserted `thread.woken` rows are the reminder's |
| `reminders.surface`, `threads/usecases/reminders.ts:135` | `timer.fired` | `thread.reminded` and `timer.blocked` are asserted |
| `followups.fire`, `modules/calendar/usecases/followups.ts:94-133` | `obligation.blocked`, `obligation.returned`, `obligation.waiting_for_evidence` | `obligation.checked` is asserted, `tests/followup-contract.ts:109` |
| `postgresFollowupStore.deliver`, `composition/followup-store.ts:99` | `thread.pushed` for the invitee's card | the test reads the manager's thread only |
| `executions.observe`, `modules/executions/usecases.ts:443` | `job.watch_blocked` | `_observed` and `_expired` are asserted |
| `jobs.bind`, `modules/jobs/usecases.ts:209` | `job.binding_changed` | `job.binding_added` is asserted |
| `ensureProposalThread`, `samtal.ts:453` | `proposals.presentation_repaired` | none |
| `attention.claim`, `threads/adapters/attention-postgres.ts:116` | `attention.claimed` | called in `tests/db/postgres-refresh-attention.test.ts:221` |
| `talkWorkItems.fire`, `composition/talk-work-items.ts:220` | `timer.fired`, `thread.reminded` | state only, `tests/db/postgres-talk-work-items.test.ts:272` |
| `ensureThreads` (`scanInto`), `cards.ts:146` | `thread.superseded` | the refresh path's is asserted; this scan is not reachable in the server (L3) |
| `connectorUsecases.refreshManifest` with `apply`, `connectors/usecases/admin.ts:608` | `connector.manifest` | called, never asserted |
| `connectorUsecases.update`, `admin.ts:325` | `connector.scan`, `.tools`, `.capability`, `.url` | the other switches are asserted |
| `modelUsecases.removeModel`, `assistant/usecases/models.ts:490` | `model.removed` | called at `tests/unit/model-admin.test.ts:329` |
| `modelUsecases.updateProvider` `:229`, `updateModel` `:353` | `provider.url`, `model.title`, `.description`, `.model`, `.audience`, `.tools` | `provider.title`, `model.enabled`, `.default`, `.disabled` are asserted |
| `competence.seedType` `modules/competence/usecases.ts:1754`, `seedHolding` `:2043`, `seedSkill` `:2060`, `seedMapping` `:3220` | the actions of `addType`, `registerHolding`, `registerSkill`, `mapSourceType` | their twins are asserted; the seeds share the insert |
| `competence.requestRun`, `:3251` | `competence.read_requested` | no test calls it; `readNow` asserts the action |
| `boarding.seedLayers`, `modules/boarding/usecases.ts:477` | `boarding.layers_imported` | by count, `tests/unit/boarding.test.ts:985` |

### C. Audited in its transaction, and asserted

| Module | Use cases (audit action) | Asserted in |
|---|---|---|
| Ledger, `modules/executions/usecases.ts` | `approve` (`execution.approved`), `approveJob` (`job.approved`), `undoJob` (`job.undo_approved`), `progress` (`execution.claimed`, `.dispatched`, `.<state>`), `reconcile` (`execution.reconciliation_requested`), `observe` (`job.watch_observed`, `_expired`) | `tests/unit/executions.test.ts:102`, `:340`; `job-executions.test.ts:517`, `:626`, `:694`, `:748`; `delegated-executions.test.ts:408`; `approval-loop.test.ts:382` |
| Cards, `threads/usecases/cards.ts` | `pushDraft` (`thread.pushed`), `retryRejected` (`thread.retry_created`), `dismissThread` (`thread.dismissed`), `snoozeThread` (`thread.snoozed`), `reopenThread` (`thread.reopened`), `cardFromAnswer` (`thread.fromAnswer`) | `tests/unit/threads.test.ts:137-675` |
| Decisions and started cards | `cardDecisions.act` (`execution.approved`), `startCard` (`thread.started`), `entityActions.start` and `decide` | `tests/unit/action-path.test.ts:433`, `entities-actions.test.ts:434`, `:800` |
| Reminders, `threads/usecases/reminders.ts` | `remind` (`reminder.set`), `cancelReminder` (`reminder.cancelled`), `fire` (`thread.reminded`, `thread.woken`, `timer.blocked`) | `threads.test.ts:354-534`, `durable-timers.test.ts:116` |
| Refresh, `threads/usecases/refresh.ts` | `request` (`refresh.requested`, in the adapter), `finish` (`refresh.completed`, `.failed`, `thread.pushed`, `.refreshed`, `.superseded`, `.source_resolved`, `work.resolved`) | `tests/unit/refresh.test.ts:83-421`, `tests/refresh-store-contract.ts:67` |
| Other thread use cases | `legacyCards.reset` (`thread.source_resolved`), `eraseSubject` (`thread.subject_erased`) | `tests/db/postgres-legacy-cards.test.ts:111`, `tests/unit/entities-cards.test.ts:461` |
| Scheduler | `scheduleNightly`, `scheduleCleanup`, a page of the scan (`job.scheduled`), the run's completion (`job.completed`) | `apps/server/tests/job-runtime.test.ts:98`, `tests/db/sign-in-cleanup.test.ts:198`; none in the unit suite |
| Jobs across systems | `approve` (`job.approved`), `bind` (`job.binding_added`), `unbind` (`job.binding_removed`) | `tests/unit/job-executions.test.ts:483-517` |
| Calendar planner, `samtal.ts` | `ensureProposalThread` (`thread.pushed`, `proposals.settled_elsewhere`), `replan` (`proposals.replanned`), `dismiss` (`thread.dismissed`), `readReplies` (`proposals.replies`) | `tests/unit/samtal.test.ts:200-729` |
| Calendar, other | `moveProposal` (`proposal.moved`), `confirm` (`execution.approved`), `followups.fire` (`obligation.checked`), `remindNow` (`obligation.reminded`), `invitations.follow` and `settle` (`proposals.missed`, `.cancelled`, `.moved`, `talks.calendar_*`), the projection's `proposals.moved` and `.cancelled` | `tests/unit/events.test.ts:111`, `tests/db/postgres-calendar-decisions.test.ts:411`, `:590`, `:692`, `tests/followup-contract.ts:109`, `:157`, `tests/unit/invitations.test.ts:218-380` |
| Composition hooks | `watchCardSink` (`thread.pushed`), `removeCards` (`thread.removed`), `talkWorkItems.open`, `close`, `reopen` (`thread.pushed`, `.handled`, `.reopened`), `attention.release` (`attention.released`) | `tests/db/postgres-execution-store.test.ts:256`, `postgres-talk-work-items.test.ts:193-465`, `postgres-refresh-attention.test.ts:241` |
| People, `modules/people/usecases.ts` | the four derivations (`grant.derived`, `positions.derived`); SCIM `createUser`, `replaceUser`, `patchUser`, `deleteUser`, `createGroup`, `replaceGroup`, `patchGroup`, `deleteGroup` (`scim.user.*`, `scim.group.*`); `rotate`, `revoke` and the users page's `issueProvisioner`, `rotateProvisioner`, `revokeProvisioner` (`provisioner.*`); `add`/`removeGroupCapability`, `add`/`remove`/`seedGroupRelation` (`group-capability.*`, `group-relation.*`); `erasePerson` (`person.erased`) | `tests/provisioning-store-contract.ts:85-373`, `tests/unit/scim.test.ts:121-872`, `users-admin.test.ts:380-652`, `person-erase.test.ts:241` |
| Appearance | `setTheme`, `clearTheme`, `setLogo`, `clearLogo`, and the operator's four (`appearance.theme.*`, `appearance.logo.*`) | `tests/unit/appearance-admin.test.ts:84-234` |
| Talks, `modules/talks/usecases.ts` | `openRound` (`talks.round_opened`, `_closed`), `markHeld`, `unmarkHeld`, `book`, `unbook`, `addCommitment`, `completeCommitment`, `reopenCommitment`, `commitmentDue`, `erasePerson`, `exportDomain`, and the invitations port's `established`, `observed`, `moved`, `ended` (`talks.*`) | `tests/unit/talks.test.ts:179-1538` |
| Connector administration | `add` (`connector.added`), `update` (`connector.enabled`, `.disabled`, `.audience`, `.header`, `.menu`, `.lens`, `.column`, `.figure`), `rotateSecret` (`connector.secret`), `remove` (`connector.removed`) | `tests/unit/connector-admin.test.ts:198-661`, `menu.test.ts:425`, `entities-admin.test.ts:165` |
| Assistant and models | `converse` and `ask` (`conversation.asked`, `.replied`), the chip path (`thread.drafted`), `reply` (`thread.replied`), the handover (`conversation.handed`); `addProvider`, `updateProvider`, `rotateKey`, `removeProvider`, `addModel`, `updateModel`, `testModel`, `choose` (`provider.*`, `model.*`) | `tests/unit/conversation.test.ts:241-457`, `handover.test.ts:241`, `model-admin.test.ts:194-499` |
| Competence, `modules/competence/usecases.ts` | the catalogue (`addType`, `updateType`, `archiveType`, `restoreType`, `mergeTypes`, `importTypes`), holdings and skills (`registerHolding`, `registerSkill`, `rateOwnSkill`, `changeOwnSkill`, `removeOwnSkill`, `validateSkill`, `revokeHolding`, `registerOwn`, `decideHolding`, `withdrawOwn`, `removeRejected`), `reconcileApprovals`, `reconcileApproval`, `exportSearch`, `exportMatrix`, requirements and share targets (add, seed, remove), `mapSourceType`, `readNow`, `forgetSource`, `copySource`'s final write, `erasePerson`, `eraseDue`, `sweepErasures`, `setRetention`, `exportDomain` (`competence.*`) | `tests/unit/competence.test.ts`, `competence-catalogue.test.ts`, `competence-copy.test.ts`, `competence-search.test.ts`, `competence-retention.test.ts`, `tests/db/postgres-competence-*.test.ts` |
| Boarding, `modules/boarding/usecases.ts` | `importLayers`, `startPlan`, `addItem`, `setDone`, `setNotDone`, `closePlan`, `itemDue`, `erasePerson`, `exportDomain`, and the leavers port's `deactivated`, `reactivated` (`boarding.*`) | `tests/unit/boarding.test.ts:472-1060` |
| Dialogue, `modules/dialogue/usecases.ts` | `assess`, `addActivity`, `editActivity`, `completeActivity`, `reopenActivity`, `removeActivity`, `addNote`, `editNote`, `removeNote`, `activityDue`, `replaceConfig`, `erasePerson`, `exportDomain` (`dialogue.*`) | `tests/unit/dialogue.test.ts:128-647` |

## The questions, one by one

**1. Audit in the same transaction.** The table above. No business change was found that commits without an audit
row in its transaction, with the exceptions of H1 and L4; the larger gap is in the second half of the rule, where
22 use cases or branches write a row no test asserts.

**2. Decisions and the ledger.** The identity of a decision holds: one row per person and decision id
(`execution_decision`, a unique index), an insert that does nothing on conflict and then locks the row it met, a
digest compared before a repeat is answered, and the producing authority compared before anything is returned. Two
approvals racing on one card meet the card's row lock and the version check in the projection. A changed card moves
`updatedAt` in every path that rewrites it, so an approval the server read from the old card is refused; what the
person was shown is not part of that check (M9). Dispatch is recorded
before the source is called; a result is fenced by attempt and state; a dispatched write is investigated and never
sent again unless the source declared deduplication, its lookup answered "not found" and the retention window is
open; a session that only asked to check never stands behind a second send. The connector receives a key it can
use: the execution's id as `x-clew-operation-id` on the execute (`packages/connectors/src/remote.ts:224`), the same on
a replay, and as `operationId` in the lookup. The calendar's five operations are not registered capabilities, so the
generic approval endpoint cannot reach them. Someone else cannot approve what was shown to a person: the card is read
as the person, the projection filters on the owner, and reads and reconciliations compare the producing authority.
What does not hold: H2, M1, M2, M3, M9, L5.

**3. The durable engine.** The workflows read the clock through `DBOS.now`, wait with `DBOS.sleep` to absolute times
and do everything else in steps; workflow ids are the intent's own; the ledger's queue is registered without a
concurrency limit; the version is the release or the hash of the workflow code. What a deployment leaves waiting
under the replaced version is documented on the status page and moved by an operator, and a server's start takes the
nightly chain over. A connector call times out at 10 seconds, a step at 60 and a lease at 120, so one call cannot
outlive its lease. Takeover after a process death works through the heartbeat; L2 is the hole in it. L1 is what a
workflow that ends in ERROR leaves behind.

**4. Timers, occurrences, follow-up, attention.** A timer row is replaced by raising its generation in the same
statement; a fire is refused unless generation, state and due time agree, and its delivery's id carries the
generation, so a second fire delivers nothing. A scan's result is fenced by the request's attempt and by each card's
projection version read before the scan; absence resolves work only for a complete, exhausted observation or a
tombstone. The follow-up is bounded three ways (two reminders, checked in the schema too; the Friday return; the
30-day expiry) and its counter is a compare-and-set. D134 has no timers: the two cards are derived by the scan from
the booking and the clock (`modules/talks/domain.ts:176-186`), which reads correctly. What does not hold: L1 (a chain
that ends), L11 (a blocked timer's card).

**5. Calendar.** Source writes are approved commands in `decisions.ts`, through the ledger, with a stable event id
per approved item, conditional writes and a read-back; local edits of a draft stay in `events.ts` with their audit
row; no calendar write is a capability or a model tool. Day and week windows are built from Stockholm dates with
`Temporal` and are right across the clock changes and whatever zone the process runs in. Recurring series and all-day
events are refused for a move in both adapters and in `ownEvent`; an occurrence has its own id. What does not hold:
H2, M2, M8, L14, L15, L16.

**6. The two adapters of every store.** Beyond M4 and M7: L6 (the proposal store reads any thread on PostgreSQL), L7
(instants kept as written on memory), L8 and L9. Lesser differences, none with a caller that observes it today:
threads of one scan share a `createdAt` and PostgreSQL orders them by that alone, where memory keeps insertion order;
a thread's proposals are ordered by start with no tiebreak; `insertThread` with an existing id replaces the thread on
memory and is a no-op on PostgreSQL, which the owned domains' card ports rely on; a memory thread's history holds
only the rows written through the thread store, so the projection's rows are invisible to the unit suite; the people
and connector memory stores restore a whole snapshot on a failed transaction, which would also undo a sibling that
committed in between; and the competence memory store removes an erased manager's approval cards without counting
them, where PostgreSQL counts and audits each (`modules/competence/adapters/memory.ts:921-940` against
`composition/competence.ts:26-31`).

**7. Schema and migrations.** Replaying migrations 0000 to 0083 gives exactly the 63 tables of `schema.ts` and of
the last snapshot: every column, default, check, key and index. The journal has 84 entries in order. The twelve
migration files that count as zero lines are one statement without a final newline, not empty. Every `on conflict`
target is a real unique constraint; no statement inside a transaction uses the outer client; no SQL is built from a
request's or a connector's value, and the `like` searches escape their input. What does not hold: M5, M6, L10,
L12, L13, and closed sets kept as free text with no check (`followup_policy.state`, `attention_delivery.kind` and
`.state`, `refresh_request.state`, `work_occurrence.source_state` and `.disposition`, `timer_intent.kind`), which only
code writes today.

**8. Purity.** `scripts/purity-check.ts` covers the right folders, and nothing in them reads the clock, draws an id
or reads the environment; the timeouts in seven use cases are budgets around a port call. What the check and the
cruiser cannot see is M4: rules written in the one folder that is allowed to hold adapters. Two use cases also keep
state of their own in the process, which no port carries: when each manager's invitations were last read back
(`modules/calendar/usecases/invitations.ts:39`) and which scans are running (`threads/usecases/cards.ts:86`); with
two instances each has its own.

## Not established

- **A reopen that collides with a newer card on PostgreSQL** (M3's scenario, L9). Read on both sides, not run. A
  `tests/db` case would settle it: approve, let a refresh insert the newer card, then undo; and reopen a dismissed
  card whose topic was taken.
- **A deadlock between a dismissal and a scan.** The trigger `thread_occurrence_disposition`
  (`packages/db/migrations/0026_conservative_reliability_backfill.sql:19-27`) updates a thread's occurrences when its
  state changes, so a dismissal locks the thread and then its occurrences; a scan's `finish` locks the occurrences
  and then the thread. PostgreSQL would abort one side. Two connections in a `tests/db` case would settle it.
- **How short a database interruption ends an approved execution's workflow** (L1). The 15 seconds are the step's
  arithmetic; the engine's own retries around its system database were not run. The durability lane, with PostgreSQL
  stopped for 20 seconds during `progressExecution`, would settle it.
- **A live executor taken over.** An instance whose heartbeat fails for 90 seconds while it still runs has its
  workflows adopted by a peer, and both run them. Every step read here is fenced in the ledger (attempt, generation,
  claim, check index, lease); whether each remaining activity is safe twice was not shown. A two-executor run with
  one paused would settle it.
- **All-day events on the previous day.** The CalDAV day query sends UTC bounds and no time zone, so an all-day event
  may be returned for the day after it, and `dayView` and `readToday` do not filter (`modules/calendar/usecases/events.ts:84`,
  `samtal.ts:158-160`). It depends on how the server evaluates a date in a time range. One case in
  `tests/calendar/nextcloud-provider.test.ts` would settle it.
- **Microsoft Graph on a tenant.** Whether `calendarView` and `getSchedule` return items that only touch a window's
  edge, which would refuse back-to-back meetings (`decisions.ts:344`), and whether the organiser's address equals the
  account's under an alias. Only a tenant settles it; D69 already lists the adapter as unproven.
- **Whether an invitee's old answer survives the organiser's move** on CalDAV, in which case an "accepted" is read as
  accepting the new time (`samtal.ts:575-577`). One assertion against the development server would settle it.
- **A commit-time deadlock in the change counters.** The deferred triggers raise two people's counters in id order
  within one event only. Two transactions that touch the same two people in opposite order might deadlock at commit.
- **Whether the weekday decides how many reminders an invitation gets.** By the arithmetic of
  `modules/calendar/usecases/obligation.ts:20-38` an invitation sent on a Wednesday is returned to the manager on
  Friday before its first reminder, one sent on a Monday gets one, and one sent on a Thursday gets two. Whether that
  is the intended policy of D30 is the product owner's to say.

## Looked at and found sound

- The ledger's identity, fences, dispatch-before-send and replay rule, as under question 2, in
  `modules/executions/usecases.ts` and both adapters; the contract (`tests/execution-store-contract.ts`) holds
  concurrency and rollback on both.
- Job approval (D77): bindings and their revisions checked before and again right before the transaction, one
  execution per execute step, one watch intent and workflow per watch step, all in one commit; `observe` is
  idempotent per check and settles the window's end once.
- The scheduler: a job is claimed, renewed and completed under its attempt; a night's id is its date, so every
  instance may schedule it; 03:00 and 06:00 exist on both days the clocks change.
- The thread store's transaction wrapper: timers ended in a transaction are cancelled after the commit, and the
  generation fence covers a cancel that fails.
- Attention admission: the per-person day is locked, the delivery's id is checked again after the lock, and a
  deferred delivery commits with its release job.
- The owned domains' cards commit in their domain's transaction on PostgreSQL.
- The operator scripts in this area: the fixture reset refuses to run without `CLEW_POC=true` or in production and
  audits each execution it retires; `workflows-move.ts` refuses a finished workflow and one that already waits under
  the latest version, and decides under the same advisory lock as a server's start.
- Sealing: an execution's payload and result, a job's steps and the two session bindings are sealed per row and
  purpose; the reliability counts read no identity, title or payload.

## Seen outside this area

- **Connector boundary.** `refreshManifest` reads the row, opens the sealed secret and fetches the remote manifest
  before it checks for an administrator (`connectors/usecases/admin.ts:580-582` against `:605`), so any signed-in
  person can make Clew fetch, and can tell an existing id from a missing one by the answer. `add` ignores a `false`
  from the insert (`:298`): of two adds of one id the second writes `connector.added` for a row that holds the
  first's address and secret.
- **Identity.** `erasePerson` removes memberships, placements and the grant and leaves the person's
  `auth_person_position` rows (`modules/people/usecases.ts:1689-1737`). The people memory adapter runs the leavers
  port outside the change's transaction, where PostgreSQL uses a savepoint (M7's last row).
- **Dialogue.** A card removed by an erasure is audited `thread.removed` with the reason `activity-removed`
  (`composition/dialogue-work-items.ts:272`); competence and boarding write `erasure`.
- **Boarding.** `erasePerson` refuses neither an unknown id nor an active person (`modules/boarding/usecases.ts:952-969`),
  unlike competence and dialogue.
- **Talks.** The team list and the action-points list take a write lock on the organisation's one open round
  (`modules/talks/adapters/postgres.ts:79-86`, used from `usecases.ts:161-162` and `:492-493`), so every reader in an
  organisation queues on one row.
- **Web.** `agendaItems` recognises a talk's meeting by its title (`packages/ui/src/agenda-items.ts:26`, `:62-84`);
  D133 says an invitation is followed by its event's id, never by a title. A renamed meeting is drawn twice, and
  another meeting titled "Utvecklingssamtal …" is drawn as a booked talk.
- **Baseline.** On SIGTERM the server flushes telemetry and exits (`apps/server/src/main.ts:157`): requests and steps
  in flight are cut, and the engine is not shut down. `bun run check` runs neither `tests/db` nor the durability
  lane, so M4's rules are outside the check a change must pass.
