# Review: introduction and leaving, the follow-up dialogue and talks · 2026-11-23

Date: 2026-11-23

Reviewed revision: `9fd4c962` on `main` (`origin/main`)
Status: review; nothing was changed, and the fixes are grouped afterwards across the reviews of the same commit

Second wave of the review of the whole repository: the three owned domains about a person's working life.

**Scope.** The modules `apps/server/src/modules/boarding`, `dialogue`, `talks` and `talk-seam`; the routes
`routes/boarding.ts`, `dialogue.ts` and `talks.ts`; the composition files `boarding.ts`, `boarding-work-items.ts`,
`dialogue.ts`, `dialogue-work-items.ts`, `talks.ts` and `talk-work-items.ts`; the tables in `packages/db/src/schema.ts`,
their migrations and their contracts; the web's data for these pages (`apps/web/src/pages/boarding*.tsx`, `boarding.ts`,
`boarding-address.ts`, `dialogue-address.ts`, `talks.ts`, `talk-address.ts`); the scripts `boarding-*`, `dialogue-*`,
`talks-*`, `talk-round`, `person-erase`, `subject-erase` and `person-erasure-args`; their tests and store contracts;
and the decisions D96, D99, D117, D118, D120, D122, D123, D124 and D132–D135.

**Method.** Every use case was read through both of its store adapters, every route through to its use case, and
each composition hook through to its SQL. Single unit files were run on the memory adapters
(`bun test tests/unit/<file>`). Two throwaway probes ran and were deleted: a unit file on the memory adapters, and a
call to the durable engine's `getWorkflowStatus` without `launch()`. `tests/db` and the durability lane were not run.
The shared database was not touched, and the dev server was not taken as evidence. The wave-1 reviews of the same
commit are cited by file and number, and their findings are not repeated:

- `docs/reviews/2026-11-23-review-decisions-durable-execution-audit-and-database.md`, called "area 4" below.
- `docs/reviews/2026-11-23-review-identity-sessions-and-authorization.md`, called "area 1" below.
- `docs/reviews/2026-11-23-review-baseline-build-and-supply-chain.md`, called "the baseline" below.

## Summary

There are no critical and no high findings. There are two medium findings and six low ones.

The three domains are built to the backend rules, with two exceptions. Every write checks reach on the server, and
every write audits in its own transaction. Free text is sealed and never reaches a card, an audit row or a log. A
person is keyed by id. The ten fixes of the talk booking stack's review are in the code.

The gravest gap is erasure. Introduction and leaving has an erasure script, but the documented procedure for erasing
one person never runs it. The script also does not behave like its three siblings: it erases an active person, it
writes an audit row for an id nobody holds, and it reaches for the durable engine from a process that never started
it.

The low findings are these:

- An item owned by a deactivated manager waits for nobody.
- A dialogue activity's former owner can rewrite it and remove it, though they may only mark it done.
- The user name in the action input of two scan cards outlives every erasure.
- One row lock queues every read of an organisation's talks.
- Dialogue erasure audits its card removals under the wrong reason.
- A handful of audit rows and one contract method have no test.

| Severity | Count | Ids |
|---|---|---|
| Critical | 0 | |
| High | 0 | |
| Medium | 2 | M1, M2 |
| Low | 6 | L1–L6 |

## Findings

### Medium

#### M1 · The documented procedure for erasing one person never reaches introduction and leaving

**Where.**

- `docs/maintainers/reliability-operations.md:199`, `:202-207` and `:213-221`: "Erasing one person", whose steps 2
  and 4 run no boarding script.
- `docs/decisions/D123-clew-empties-expired-sign-in-data-itself-and-a-leavers-retention-is-the-organisations-decision.md:44-49`.
- `docs/reference/status/identity.md:27`.
- The headers of `scripts/person-erase.ts:3-4` and `scripts/subject-erase.ts:18-19`.
- Against these: `docs/decisions/D124-introduction-and-leaving-are-an-owned-domain-a-plan-the-manager-starts-assembled-from-flat-layers.md:113-116`,
  which builds `scripts/boarding-erase.ts` and `scripts/boarding-export.ts`.

**What happens.** Step 2 of the runbook lists three exports: talks, competence and dialogue. Step 4 runs four
erasures: `subject-erase`, `talks-erase`, `competence-erase` and `dialogue-erase`. The procedure's introduction (`:199`)
lists the records a deactivation leaves in place, and boarding is not among them. D123 item 3 and the identity status
page name the same four scripts. The header of `person-erase.ts` says it runs "after `subject-erase.ts`,
`talks-erase.ts` and `competence-erase.ts`", which leaves out dialogue as well. The header of `subject-erase.ts`
points only to talks and competence.

`boarding-erase` and `boarding-export` are named nowhere in the documentation except D124 item 11. `grep -rn
boarding-erase docs` finds that line alone.

**Scenario.** A leaver asks to be erased, and the operator follows the runbook to the letter, ending with
`person-erase`. The following then remain:

- The plans about the person, with every item, including titles a manager typed about them (sealed under
  `boarding:item:<id>`, and readable to anyone who can open them).
- The cards of those items in the streams of their owners.
- The person's id as buddy, starter, holder, owner and completer on other people's plans.

`person-erase` then clears the person's name in the directory, so the plans can no longer be checked against who
they were about. The person still exists as a row with an id, which is what the remaining records point at. A
request for the person's data, answered by step 2, leaves out their introduction and leaving plans.

**Established by.** Read and grep of the files named; the runbook, D123 and the status page were read in full at the
lines given.

#### M2 · Boarding's erasure refuses neither an unknown id nor an active person, and its script differs from its siblings

Area 4 noted the use case's missing check in one line under "Seen outside this area". It is established and widened
here.

**Where.**

- `apps/server/src/modules/boarding/usecases.ts:952-969`.
- `scripts/boarding-erase.ts:12`, `:20-24` and `:37`.
- `apps/server/src/composition/boarding.ts:36`.
- `tests/unit/boarding.test.ts:237` and `:1025`.
- `tests/unit/erase-scripts.test.ts:43-72` and `tests/db/erase-scripts.test.ts:250`.
- For comparison: `modules/dialogue/usecases.ts:503-520` (`lockPersonForErasure` at `:506`),
  `modules/talks/usecases.ts:802-819`, `scripts/person-erasure-args.ts`, `composition/talks.ts:72` and
  `composition/dialogue.ts:40`.

**What happens.** D123 item 3 and the runbook (`reliability-operations.md:221`, `:225-228`) say each erasure refuses
an id the people table does not hold and a person who is still active, writing nothing and no audit row. Talks and
dialogue do this in the use case. `boarding.erasePerson` locks nothing about the person and checks neither. It differs
from its siblings in four ways:

1. **It erases anyone.** An unknown id writes a `boarding.person_erased` row about `person:<that id>` with zero
   counts. An active person's plans and cards are deleted.
2. **The script's argument parser is its own.** `scripts/boarding-erase.ts:20-24` does not use
   `parsePersonErasureArgs`. A second `--person` is ignored, the first one wins, and any other argument is accepted.
   The runbook's exit 2 for "an option given twice, or any other argument" (`:225`) does not hold for it.
3. **It reaches for the durable engine.** The script imports `boarding` from `composition/boarding.ts`, the server's
   instance, built over `cancel: cancelDurable` (`:36`). Talks and dialogue give their scripts an instance with no
   `cancel` (`talksForScripts`, `dialogueForScripts`). The runbook says no erasure cancels a durable workflow "since a
   script never starts the durable engine" (`:221`). For boarding, after the commit, each removed card's timer calls
   `DBOS.getWorkflowStatus`, which throws at once because `DBOS.launch()` was never called. The thread store logs that
   as "durable cancel failed" and does not raise it. The erasure has committed, and the operator sees one error per
   timer.
4. **No test calls the script.** Neither `erase-scripts` test calls `boarding-erase.ts`. The use case's own test,
   `boarding.test.ts:1025`, erases `anna`, whose row is created `enabled: true` at `:237`. It asserts that an active
   person is erased.

**Scenario.** An operator erases introduction and leaving for a colleague who is still employed, by a typo in the id
or by giving the user name. The colleague's plans and their cards are gone with no refusal. A typo that matches
nobody writes an audit row that says a person was erased.

**Established by.** The probe on the memory adapters:

- `erasePerson('operator:cli', 'no-such-person')` returned `{"plans":0,"items":0,"cleared":0,"cards":0}` and wrote
  `{"actor":"operator:cli","action":"boarding.person_erased","subject":"person:no-such-person",…}`.
- `erasePerson` of the active `anna` returned `{"plans":1,"items":2,"cleared":0,"cards":2}`, and the plan was gone.
- Calling `DBOS.getWorkflowStatus` without `launch()` threw "`DBOS.launch()` must be called before running
  getWorkflowStatus."
- The parser and the composition were read.

### Low

#### L1 · An item owned by a manager who has been deactivated waits for nobody

**Where.**

- `apps/server/src/modules/boarding/domain.ts:328-329` (`waitsFor`) and `:353`.
- `modules/boarding/usecases.ts:119-156` (`boardingLeavers`) and `:674-709` (`plans`).
- D124 item 7, `D124-introduction-and-leaving-…md:91-92`.

**What happens.** A plan's item belongs to the person who owned it when it was assembled. When the owner was the
person's manager, that is the manager's id. D124 item 7 hands an item back to the plan's manager role only when its
owner is gone, meaning erased or deleted. An owner who is merely deactivated keeps the item:

- `waitsFor` counts it only for that owner.
- The current manager may tick it, but it is not shown as theirs and is not counted among what waits for them.
- Its card stays in the stream of someone who can no longer sign in, until an operator erases them.

**Scenario.** Karin starts Anna's introduction, and "Beställ dator" is hers. Karin leaves and is deactivated, and
Olle becomes Anna's manager. Olle's list of plans shows Anna's plan as `{"waiting":0,"done":0,"total":2}`. The rows
show "Beställ dator" with owner `karin`, `mine: false`, `canTick: true`. Nothing waits for Olle, and Anna's computer
is never ordered unless he opens the plan and notices.

**Established by.** The probe on the memory adapters, with the output quoted.

#### L2 · A dialogue activity's former owner, outside the unit's reach, can rewrite it and remove it

**Where.**

- `apps/server/src/modules/dialogue/usecases.ts:102-112` (`activityFor`), used by `setDone` (`:129`),
  `editActivity` (`:323`) and `removeActivity` (`:344`).
- D118 item 5, `D118-the-follow-up-dialogue-is-an-owned-domain.md:28-30`.

**What happens.** D118 item 5 lets an activity's owner "mark it done even after the unit is no longer one they follow
up". `activityFor` admits the owner to every activity write. The same check guards changing the text and the due
date, reopening, and removing once done. A manager who has moved to another part of the organisation keeps write
access to the old unit's activity, and so can rewrite what the unit's current managers read. The audit row records
`by: "owner"`, so the write can be traced.

**Scenario.** Hillevi owned an activity on u-skola and no longer follows the unit up. She changed its text, marked it
done and removed it. The audit trail holds `dialogue.activity_edited {text: true, by: "owner"}`,
`dialogue.activity_done {by: "owner"}` and `dialogue.activity_removed {by: "owner"}`.

**Established by.** The probe on the memory adapters, with the output quoted.

#### L3 · Two scan cards keep the person's user name in their action, and no erasure reaches it

**Where.**

- `apps/server/src/modules/boarding/capabilities.ts:197`, `:214` and `:226`: the card "Förbered introduktionen".
- `modules/talks/capabilities.ts:227`: the talk's notice card.
- `apps/server/src/threads/usecases/keys.ts:5-19`.
- `scripts/subject-erase.ts:1-11`.

**What happens.** Both scans give the row a subject `{entity: 'person', key: <user name>}` and the primary action an
input `{ keys: [<user name>] }`. Clew keys the row's subject by the person's id (`keyedDrafts`, D122). It leaves the
action's input as the source wrote it, and for these two cards Clew's own module is the source.

The erasures do not reach that input:

- `subject-erase` rewrites `items[].subject` and the card's `subjects`.
- `person-erase` replaces names in the audit trail and the authentication log, not in cards.
- `talks-erase` and `boarding-erase` remove the cards of talks, action points and plan items, not these scan cards
  in the manager's stream.

A card resolved by the source is kept as history.

**Scenario.** A new hire is suggested to their manager, and the card is resolved once the plan is started. The person
leaves and is erased by every script. The manager's stream still holds a card whose action names the person by user
name. Once the directory gives that user name to someone else, the button on the old card ("Visa introduktionen",
"Visa samtalet") opens the new holder. The status page's limit (`status/identity.md:29`) covers actions "its source
wrote" in a connected system. Here the source is Clew, which could put the id in the input.

**Established by.** Read: both scans, `keys.ts` and the three erasure paths. It was not run end to end.

#### L4 · Every read of the talks round takes a write lock on the organisation's one open round

Area 4 noted this under "Seen outside this area". It is confirmed here, with the paths that share the lock.

**Where.**

- `apps/server/src/modules/talks/adapters/postgres.ts:79-86` (`talkRecordsTx.currentRound`, `.for('update')`),
  spread into `talkTx` at `:174`.
- `composition/talk-invitations.ts:13`.

**What happens.** `currentRound` locks the row on every call, and every talks read finds the round through it: the
team list, the action points, the progress figure and each manager's scan. The calendar's invitation port uses the
same `talkRecordsTx`, so a booking or a settlement in the calendar's transaction also holds the round row until it
commits. In an organisation with many managers, every page load and every nightly scan of the talks domain queues on
one row behind whichever transaction holds it.

**Scenario.** The nightly scan runs for every manager of a large organisation, and each scan's transaction takes the
round row in turn. A manager who opens the talks page meanwhile waits behind them. So does the calendar's reading back
of invitations, which takes the same row in its own transaction.

**Established by.** Read. Not measured.

#### L5 · Dialogue erasure audits each card it removes as an activity removed by hand

Area 4 noted the reason under "Seen outside this area". The cause is that the domain has a copy of its own of a
shared helper.

**Where.**

- `apps/server/src/composition/dialogue-work-items.ts:26` and `:243-272`.
- `composition/boarding-work-items.ts:256-289`.
- Against these: `composition/card-removal.ts:5-42`, used by `talk-work-items.ts` and `competence-work-items.ts`.

**What happens.** Talks and competence remove cards through `removeCards`, which writes `thread.removed` with
`reason: 'erasure'`. Boarding and dialogue each have a copy of that function. Dialogue's copy serves both removing a
done activity and erasure, and it always writes `reason: 'activity-removed'` with the actor `dialogue:activity`. In
the audit trail, the cards an erasure removed read as activities a manager removed. The boarding copy writes
`erasure` like the helper, but it is a third place where the same deletion and its cascade are written out.

**Established by.** Read.

#### L6 · Test gaps against the repository's own rules

| What | Rule | What exists |
|---|---|---|
| `boardingWorkItems.close` (`thread.handled`), `.fire` (`timer.fired`, `thread.reminded`), `.remove` (`thread.removed`), `composition/boarding-work-items.ts:153-289` | "a scenario test that asserts the audit row" | `tests/db/postgres-boarding-work-items.test.ts` asserts `thread.pushed` (`:213`, `:277`) and `thread.reopened` (`:291`); close, fire and remove are checked by state (`:242-314`) |
| `dialogueWorkItems.close` (`thread.handled`), `.reopen` (`thread.reopened`), `.fire` (`timer.fired`, `thread.reminded`), `.remove` (`thread.removed`), `composition/dialogue-work-items.ts:121-272` | the same | `tests/db/postgres-dialogue-work-items.test.ts` asserts `thread.pushed` (`:129`) and `thread.retimed` (`:160`); the rest are checked by state (`:167-199`) |
| `DialogueTx.lockPersonForErasure` | "a port change comes with a contract case" | no case in `tests/dialogue-store-contract.ts`; the refusal is tested through the use case only |
| `boarding.erasePerson` refusing an unknown or active person; `boarding-erase.ts`'s argument checks | D123 item 3; the runbook's exit codes | the opposite is asserted (M2) |

Already reported, so not repeated here: in area 4, table B lists `talkWorkItems.fire` and `boarding.seedLayers`; M7
lists the card ports' `fire`, `close`, `reopen`, `remove` and `retime` with no contract case; and M4 notes that the
memory card ports answer `true` to any `fire`.

**Established by.** A search of each test and contract file for each action and port method.

## The seven questions

### 1. Who reads and writes what

| Domain | Reads | Writes |
|---|---|---|
| Boarding: layers | an administrator with `admin.boarding` (`routes/boarding.ts:131-133`, `:182-185`) | the same, by import; the operator by `boarding-seed.ts` |
| Boarding: a plan | the person it is about; its manager, meaning whoever they report to now, or the holders recorded at deactivation (`accessOf`, `usecases.ts:196-209`); an owner of some items, who reads those items and the counts over them alone; anyone else is told it does not exist | start, add, close: the manager; tick: the item's owner or the manager; a closed plan is read-only |
| Dialogue: assessments and activities | a manager following the unit (`followed`, from D117's reach; `composition/dialogue.ts`); an activity's owner also outside reach (L2) | the same; `replaceConfig` by the operator only (`scripts/dialogue-areas.ts`) |
| Dialogue: notes | the author alone (`noteFor`, `usecases.ts:117-122`); `unit()` returns only the reader's own notes | the author |
| Talks: round, talks, action points | the person's manager through `clew.talks` and `clew.commitments` (`talk-seam`), D99's reports; a point's owner reads the points they own (`commitments`, `usecases.ts:482-514`) | held, booked, points: the manager (`mayChange`, `usecases.ts:251-262`); a point's owner may tick it; the round is opened by the operator (`talk-round.ts`) |

The capabilities `boarding.plan`, `boarding.person`, `dialogue.unit` and `dialogue.activities` are `model: false`. The
model never reads plans, activities or notes. `dialogue.unit` gives area titles and counts only.

### 2. Change over time

- **A reorganisation.** A plan's manager is computed at every read, so a plan follows the person's line. Items keep
  the owner they were assembled with, and a former manager keeps those items as an item owner (D124 item 7).
- **A deactivation.** The leavers port records the holders in the deactivating transaction. When the line has no
  active leader the holder set is empty: nobody manages the plan or can close it, and its owners can still tick
  their own items. This is intended and asserted (`tests/unit/boarding.test.ts:791-802`). L1 is the edge it leaves.
- **Several assignments (D135).** Dialogue's role check takes the manager assignment first, which is correct. The
  scans' observation scope is `unitId:role` on both the source's and the refresh's side
  (`apps/server/src/threads/usecases/refresh.ts:13`, `:61`, `:114`). A card made under another assignment is superseded
  when the same work is made again (`refresh.ts:192-194`).
- **A new round.** It closes the old one without confirmation, carries future unheld bookings, and leaves held marks
  in the closed round. This is documented, and `talk-round.ts --if-none` checks and opens in two transactions.

### 3. Erasure and export, table by table

`subject-erase` handles card subjects, and `person-erase` handles the directory row and audit names. Neither touches
these tables.

| Table | Column | Boarding erasure | Talks erasure | Dialogue erasure | Left behind |
|---|---|---|---|---|---|
| `boarding_plans` | the plan about the person | deleted, with items and holders by cascade | | | |
| | `buddy_id`, `started_by` | set null | | | |
| `boarding_plan_holders` | `person_id` | rows deleted | | | |
| `boarding_items` | `owner_id`, `thread_id` | set null; the cards are removed | | | the item goes to the manager role (D124 item 7) |
| | `done_by` | set null | | | |
| | `title`, `text_sealed` | go with the person's plans | | | |
| `boarding_layers` | `created_by` | | | | the importing administrator's principal id |
| `talks` | the talks about the person | | deleted | | |
| | `held_by`, `booked_by` | | set null | | |
| `talk_commitments` | the points about the person | | deleted, with their cards | | |
| | `owner_id`, `thread_id` | | set null; the cards are removed | | |
| | `created_by`, `done_by` | | set null | | |
| `talk_rounds` | `created_by` | | | | the operator's actor, not a person |
| `proposal` (the invitations) | name, address | | | | area 4 M6 |
| `dialogue_activities` | `owner_id`, `thread_id` | | | set null; the cards are removed | `text_sealed`, `done_note_sealed` stay |
| | `created_by`, `done_by` | | | set null | |
| `dialogue_assessments` | `author_id` | | | set null | `comment_sealed` stays |
| `dialogue_notes` | the person's own notes | | | deleted | |
| `threads` | the scan cards about the person | | | | the user name in the action input (L3) |
| `audit` | rows written under the domains | | | | ids, booleans and counts only, by design |

**Exports.** Each export is one organisation's whole domain:

- talks, `clew.talks/1`;
- dialogue, `clew.dialogue/1`, including the private notes' text;
- boarding, `clew.boarding/1`, with typed titles opened.

Each is written with mode 0600, never over an existing file, and audited with counts. The runbook says to select the
person's records by hand (`reliability-operations.md:210`), and it leaves out boarding (M1).

### 4. Matching on names or titles (D132)

None in the domains' own records:

- A talk follows its invitation by the event's id (D133).
- A plan and an item name people by id.
- Layers are matched by `(event, name)` inside Clew's own catalogue, as the import's key.

Two places sit at the edges:

- The scan cards carry the user name in their action (L3).
- `scripts/boarding-seed.ts:37` compares user names with JavaScript's case folding (area 1, "Seen outside this
  area").

`agendaItems` in `packages/ui` recognising a talk by its title is area 4's, under "Seen outside this area".

### 5. Files and free text

There is no file storage: D120 item 8's document system is not built, and the dialogue routes take JSON bodies of up
to 12 000 characters (`routes/dialogue.ts:59-61`). The free text is the following, each sealed at rest under a
purpose bound to its row:

- in boarding, typed titles;
- in dialogue, the activity, its done note, the assessment's comment and notes;
- in talks, an action point's text.

No card title, audit row or log line carries free text or another person's name. The PostgreSQL tests of the talks
and boarding cards assert it (`postgres-talk-work-items.test.ts:208`, `postgres-boarding-work-items.test.ts:478-480`);
the dialogue's card test does not.

### 6. Plans and rounds

A plan is assembled from flat layers in a deterministic order (`applyingLayers`, `assemble`). There is one open plan
per person and event (`PlanTaken`). A plan is locked before its items, the erasure included. Round behaviour is in
question 2. The booking stack's carry-over is in the next section.

### 7. Backend rules and audit tests

Every module has the four kinds of file. No module imports another. Talks imports no calendar code, and the
invitation port is bound in composition, with `routes/talks.ts` calling `invitations.settle`. There is no
`new Date()`, `Date.now()`, `randomUUID()` or `process.env` in a use case or domain file. Every domain audit action,
the leavers port's included, is asserted somewhere. The remaining gaps are in L6 and in area 4's B and M7.

## The talk booking stack's ten findings

Each finding of `docs/reviews/2026-11-20-the-talk-booking-stack.md` was checked in the code.

| # | Fixed | Where |
|---|---|---|
| 1 | yes | `openRound` carries booked, unheld, future talks and audits `carried` (`modules/talks/usecases.ts:346-373`); `bookedTalks` is in `tests/talk-store-contract.ts:205-208` |
| 2 | yes | the planner runs first and the reading back is not awaited; `FOLLOW_AT_ONCE = 4` (`modules/calendar/usecases/invitations.ts:25`) |
| 3 | yes | `missed` ends the latest invitation and is refused before its time (`invitations.ts:109-156`) |
| 4 | partly | the contract case exists (`tests/proposal-store-contract.ts:327-336`); the memory harness binds no writing port, area 4 M7's last row |
| 5 | yes | the two tests in `tests/db/postgres-calendar-decisions.test.ts` |
| 6 | yes | a card with no user name opens the round (`modules/talks/capabilities.ts:221-235`) |
| 7 | yes | no throttle or phases remain in `settleCard` |
| 8 | yes | the projection uses `BOOKED` (`composition/execution-projection.ts:9`, `:274`) |
| 9 | yes | one function reads the booking before a write (`bookingBefore`, `modules/talks/usecases.ts:204`) |
| 10 | yes | "Samtalet blev inte av" is offered for an invitation only (`apps/web/src/components/people/talk-overlay.tsx:157`, `:306`) |

## Area 4's audit table B, completed for these three domains

These rows are audited in their transaction, but no test asserts the row. They add to area 4's table B. Area 4's
table C stands for the use cases themselves, every one of which is asserted in `tests/unit/talks.test.ts`,
`boarding.test.ts` or `dialogue.test.ts`.

| Use case | Audit action | What exists instead |
|---|---|---|
| `boardingWorkItems.close`, `composition/boarding-work-items.ts:153` | `thread.handled` | state, `tests/db/postgres-boarding-work-items.test.ts:242-263` |
| `boardingWorkItems.fire`, `:204` | `timer.fired`, `thread.reminded` | the return value, `:253-255` |
| `boardingWorkItems.remove`, `:256` | `thread.removed` | state, `:314` |
| `dialogueWorkItems.close`, `composition/dialogue-work-items.ts:121` | `thread.handled` | state, `tests/db/postgres-dialogue-work-items.test.ts:167` |
| `dialogueWorkItems.reopen`, `:143` | `thread.reopened` | state, `:173` |
| `dialogueWorkItems.fire`, `:187` | `timer.fired`, `thread.reminded` | the return value, `:172-179` |
| `dialogueWorkItems.remove`, `:243` | `thread.removed` | state, `:199` |
| `talkWorkItems.fire` and `boarding.seedLayers` | | already in area 4's table B |

Nothing in these domains belongs in table A: no write lacks its audit row.

## Not established

- **A lock-order conflict.** The calendar's transaction may lock proposals and then the round row (L4), while a talks
  path locks the round and then a talk. Whether any path takes the two in the other order was not examined in full,
  and nothing was run.
- **A mixed snapshot in the layer import.** `importInto` reads the catalogue and writes under READ COMMITTED. A plan
  started at that moment may be assembled from a mix of old and new layers. Reasoned, not run.
- **What the PostgreSQL adapters do in L1–L3.** The probes ran on the memory adapters. The PostgreSQL adapters were
  read and do the same, but they were not run.
- **The web pages.** They were read for the data they request. No screen-reader pass or a11y spec was run. The
  baseline's table lists `admin-boarding.spec.ts:184` failing (axe, product) and `boarding.spec.ts:436` failing
  (test).

## Looked at and found sound

- **Routes.** Every route of the three mounts the session guard and the module's writable check. Ids are limited to
  80 characters, and units to the entity-key limit. Bodies are size-limited and validated by schema. Layer routes
  are `admin.boarding` only.
- **Reach.** `accessOf`, `followed` and `mayChange` are checked inside the use case's transaction. In boarding and
  dialogue a record of another organisation answers as missing.
- **Erasure.**
  - Talks and dialogue refuse an unknown or active person through `parsePersonErasureArgs` and the use case's lock.
  - Each erasure is safe to run twice, writing zero counts and an audit row.
  - A card's timer goes with the card.
- **Card contents.** The work-item cards carry the template title or a fixed sentence, never a typed title, and never
  a name.
- **Sealing.** Every sealed column is opened only where a read returns it, under a purpose bound to the row.
- **Booking.** A booking is the talks module's own record (D132), and the calendar holds a copy. Only the manager
  changes it (D133).
- **Exports.** They are whole-organisation documents, file mode 0600, never overwriting a file, and audited.
- **Scan scope.** The observation scope of the two scans matches the refresh job's assignment. A reorganisation
  supersedes the old assignment's open cards.

## Seen outside this area

- `subject-erase` and `person-erase` never read `threads.actions`. Any source that writes a user name into an action
  input leaves it after erasure. L3 is one instance of this, and the rule is the threads domain's.
