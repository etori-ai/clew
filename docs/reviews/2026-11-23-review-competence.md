# Review: the competence domain · 2026-11-23

Date: 2026-11-23

Reviewed revision: `9fd4c962` on `main` (`origin/main`)

Status: review only. Nothing was changed, and the fixes come later, grouped with the other reviews of the same commit.

This is one area of the second wave of the whole-repository review. It covers the competence module
(`apps/server/src/modules/competence`: contracts, `domain.ts`, `usecases.ts`, `capabilities.ts`, `model.ts`, both
adapters), its routes (`apps/server/src/routes/competence.ts`), its composition (`composition/competence.ts`,
`competence-work-items.ts`, the holdings port in `composition/index.ts:263-299`), the competence tables and migrations,
the competence schemas in `packages/contracts`, the data the pages `apps/web/src/pages/competence*.tsx` and
`competence-address.ts` read and show, the `scripts/competence-*.ts`, and the tests: `tests/unit/competence-*.test.ts`,
`tests/competence-store-contract.ts` and `tests/db/postgres-competence-*.test.ts`. The Moodle connector was read only to
follow one copy end to end. The decisions read were D99, D108, D118, D119, D120, D121, D122, D123 and D135, together
with the "Kompetens" section of `docs/reference/status/people.md`.

Method: each route was followed to its use case and from there into both store adapters. Every exported use case was
read in full. A finding is reported only when the path was read end to end or a probe shows it. The probes were
single temporary test files on the memory adapter. They were run inside the devcontainer and deleted before the
commit. Some read-only statements (`SELECT`, `EXPLAIN`) were run on the shared PostgreSQL server; nothing there was
written, migrated or seeded. Nothing that `open-questions.md` lists as undecided is reported. Findings of wave 1 are
referred to by file and number, not repeated.

## Summary

This review adds two findings: one medium, one low, and nothing critical or high. The person-level rules hold:

- Who may read whose holdings is decided on every call.
- A registrar is checked twice and kept to their own organisation.
- Each of these reads is logged in its own transaction: every read across the organisation, every manager's read of
  one report's holdings, and both CSV exports.
- Writes stay with the manager the person reports to now, with the person themselves and with the administrator.
- Every mutation writes its audit row in its transaction. A test asserts each row, apart from the five competence use
  cases that wave 1 already listed.

The two findings:

- **M1.** A manager who leads both a unit and a unit below it can find out whether one particular person holds a
  competence, even though that person is not one of the manager's reports. The method is to compare the share-target
  figures of the two units for the same type. The guard against this kind of comparison only compares targets on one
  unit, so it never sees the two figures side by side.
- **L1.** The validity preview gives an administrator exact counts. Deactivated people are included, and the
  administrator can choose any rule. For a type that only one person holds, the preview reveals the month their
  certificate was issued. The merge preview shows the same kind of count as "few" (fewer than five).

The follow-up of durable L8 found that the competence module matches a person by user name in four places. The two
that go to the database are the copy and a registrar's open. Both miss a decomposed key on any database and miss
non-ASCII capitals on a C-locale database, and neither can use an index. L8 stays low; nothing new is numbered.

| Question | Verdict |
|---|---|
| 1. Who may read whose holdings | Sound for holdings; M1 for figures, L1 for the administrator's preview |
| 2. The read log | Sound: complete for reads across the organisation, partial for a manager's reads by design (D121) |
| 3. Writes | Sound |
| 4. The copy from sources | Sound; the user-name match is durable L8, followed up below |
| 5. Retention, erasure and export | Sound; what each path reaches is tabled below |
| 6. The work items | Sound; M4 (wave 1) stands |
| 7. Domain correctness | Sound for dates, DST, levels, types and duplicates; reads that grow with the organisation are listed |
| 8. Backend rules | Sound; the audit sweep's section B for competence is complete, with nothing added |

## Findings

### M1 · Share targets on two nested units that the reader manages can be compared to single out one person (medium)

**Where.**

- `apps/server/src/modules/competence/usecases.ts:803`: `coverageIn` passes `coverageOf` only the targets set on the
  unit asked for.
- `apps/server/src/modules/competence/domain.ts:558-571`: the overlap guard runs over those targets alone.
- `usecases.ts:3043-3052` (`coverage`) and `:3059-3077` (`aboutUnits`): each managed unit is computed by itself.
- These are reached through the reads `competence.coverage` (offered to the model) and `competence.unit` (a unit's
  page), in `capabilities.ts:456-489`.

**What happens.** `coverageOf` documents the rule at `domain.ts:497-503`. Two targets of one type whose denominators
overlap could be compared with each other. When the part of one that is outside the other holds one to four people
the reader does not know, both targets are withheld. Here, "known" means the reader and their own reports.

The guard only sees the targets of the unit being computed. A reader who manages a unit and a unit below it can ask
for both. Their units are every unit they manage: `staff.reach` covers every assignment (D135), and
`composition/competence.ts:65` uses it. So a target on the upper unit and a target of the same type on the lower unit
are each judged on their own, and are never compared with each other.

**Scenario.**

1. Karin heads förvaltning X and is also acting head of avdelning Z, which is under X.
2. Under Z is enhet W, with its own manager and five undersköterskor.
3. Under X is also enhet Y, with its own manager and one undersköterska, Yan.
4. The administrator sets the target "80 % of undersköterskor hold HLR" on X and on Z.
5. Karin's figure for X counts eight people. Six of them are people she does not know, which is five or more, so it
   is shown. Her figure for Z counts six people, five she does not know, so it is shown too.
6. The difference between X and Z is Karin's own report on X and Yan. Karin sees her own report's HLR in the matrix.
   So the two "meeting" numbers tell her whether Yan holds HLR.

When Yan's manager registers her HLR, the meeting number on X goes up by one and the one on Z does not move. The
assistant reads the same two figures through `competence.coverage`. Karin can find who the one undersköterska on Y is
from that person's page, where a colleague sees employments (D114).

**Severity: medium.** It leaks personal data that the module's own guard exists to keep back, to a manager who does
not manage the person (D99 item 4). The preconditions are narrow:

- two nested units managed by the same person;
- targets of one type set on both units;
- five or more unknown people below the inner unit;
- one to four unknown people in a sibling unit.

**Established by.** The path was read end to end, and a probe ran on the memory adapter through `competenceUsecases`.
The probe's units: X ⊃ Z ⊃ W and X ⊃ Y. R manages X and Z, with one report on each. W holds five undersköterskor and Y
holds one, each unit with its own manager. There is a target on X and a target on Z for the same type and position.
The essential lines:

```ts
const [onX] = (await competence.coverage(r, 'x')).targets;
const [onZ] = (await competence.coverage(r, 'z')).targets;
// … Y's manager registers HLR for Yan, then the same two reads again
```

The output, as [holders, meeting, withheld], before and after:

```
{"before":{"x":[8,0,false],"z":[6,0,false]},"after":{"x":[8,1,false],"z":[6,0,false]}}
```

The existing tests cover two related cases, but neither has one reader managing both units:

- a target above that is not read below (`tests/unit/competence.test.ts:1694-1718`);
- the guard within one unit (`:1849-1865`).

### L1 · The validity preview gives an administrator exact counts, deactivated people included, for any rule they type (low)

**Where.**

- `apps/server/src/modules/competence/usecases.ts:1761-1781` (`validityImpact`);
- `apps/server/src/routes/competence.ts:235` (`?months=` from 1 to 600, or `none`);
- `packages/contracts/src/index.ts:2693-2698`;
- for comparison: `domain.ts:967` (`shownCount`) and `:975-1013` (`mergeFigures`).

**What happens.** `validityImpact` counts every valid holding of the type that has no issuer's end date, across every
person, deactivated people included. It returns `holdings`, `expiredBefore` and `expiredAfter` exactly, for any
number of months the caller asks about, without saving anything.

D108's "as built" paragraph says a small group "is never counted on its own in coverage (fewer than five is not
shown), and the same rule holds for the numbers an administrator sees before a merge". `mergeFigures` keeps that rule:
it counts only active people and passes every count through `shownCount`. The validity preview does neither.

**Scenario.**

1. Ada holds `admin.competence`.
2. A rare authorisation is held by one person, registered by their manager with the issue day 14 March 2025. The
   person has since been deactivated.
3. On the catalogue page, Ada asks for the preview with 1, 2, … months and never saves.
4. Every answer says `holdings: 1`.
5. `expiredAfter` drops to 0 at 20 months.

So she learns that exactly one person holds the type, and that it was issued between 11 March and 10 April 2025. That
is one person's holding, and D118 item 3 says `admin.competence` does not reach a holding. If Ada knows who holds the
type, the date is that person's. On Källor the count per source type is exact too (`usecases.ts:3136-3157`), but there
it covers active people only and has no free parameter.

**Severity: low.** It names nobody. It gives the administrator a figure below the floor that the module keeps
everywhere else for the same reader.

**Established by.** Read, and a probe on the memory adapter. With the holder deactivated, 1 month answered
`{"holdings":1,"expiredBefore":0,"expiredAfter":1}`, and 20 months was the first answer with `expiredAfter: 0`.

### Follow-up of wave 1: `activeByUserName` (durable L8; the identity review, "Seen outside this area")

Durable L8 and the identity note already report the cause: a plain `lower(user_name)` with JavaScript's
`toLowerCase()`, no ICU, no NFC, no usable index. They also report the C-locale scenario. What follows establishes
what breaks and where else the module matches a person by user name.

**Where the module matches a person by user name: four places.**

1. **The copy** (`usecases.ts:1288-1296`). The source's key is lowered in JavaScript, matched by `activeByUserName`
   (`adapters/postgres.ts:710-726`, `memory.ts:713-717`), and then looked up in a JavaScript map keyed by
   `userName.toLowerCase()`.
2. **A registrar's open** (`usecases.ts:2563`). The key, which the registry has already rewritten to the directory's
   spelling, goes to `activeByUserName`.
3. **A manager's open** (`usecases.ts:2556-2558`). An exact comparison of `personKey` with that same rewritten key,
   against the reader's reports in memory.
4. **`competence.person`** (`usecases.ts:2723-2728`). A JavaScript `toLowerCase` over the reports in memory.

Places 3 and 4 compare against the directory's own spelling, which the registry produced with `foldSourceKey` (NFC,
then lower case) and the people store's ICU lookup. Nothing was found that breaks in them. Places 1 and 2 go to the
database.

**What breaks, established.**

- **On a C-locale database.** `select lower('Åsa' collate "C")` returns `Åsa`; under `"und-x-icu"` it returns `åsa`.
  So the registry finds the person, through the people adapter's ICU and NFC lookup (`people/adapters/postgres.ts:50-51`),
  and the use case then refuses her as "not yours". The registrar's search lists her, because the search matches by
  id and not by user name, but her holdings cannot be opened. The copy counts her rows as unmatched, as L8 says.
- **On any database.** A source key written decomposed (NFD) matches nobody in the copy:
  `lower(U&'a\030Asa') = lower('åsa')` is false, and with `normalize(…, NFC)` it is true. The registry matches the
  same key for a read. So one person is a report the manager can read about, and also a key the copy counts as
  unmatched, and their holdings are never copied. The Moodle connector sends its keys lowered and nothing more
  (`connectors/moodle/connector.mjs:76`).
- **No index serves the read.** `auth_person`'s two user-name indexes are on the ICU expressions (migrations 0056 and
  0058). `EXPLAIN` of the competence predicate on the shared database, with `enable_seqscan` off, answers
  `Seq Scan on auth_person … Disabled: true`. So every copy page that brings new keys, and every registrar open, reads
  the people table of the whole installation. A copy run is bounded by `PAGES_MAX`. Nothing was measured.

L8's severity (low) stands.

## Not established

- **Cost at size.** `coverageIn` reads every active person and every holding of the branch for each unit it is asked
  about (`usecases.ts:799-804`). `aboutUnits` repeats that per managed unit, so nested units are read twice. A manager
  near the top of a municipality reads most of it on every view of a unit's page. Nothing was measured; the search's
  read of every holding of a type is already a documented limit.
- **The memory adapter and PostgreSQL.** M1's probe ran on the memory adapter. `placedOn` and `placesOf` do the same
  on PostgreSQL (`adapters/postgres.ts:751-795`, and the contract cases at `tests/competence-store-contract.ts:1279`),
  so nothing points to a difference, but the probe was not run on PostgreSQL.
- **C-locale installations.** Whether any installation runs on a C-locale database is not known. The shared stack's
  databases are `en_US.utf8`.
- **The copy against a running server.** No copy was run against the running server or against Moodle. The Moodle
  connector was read: its row ids (`course:<id>:user:<id>`, `badge:<id>:user:<id>`), its leaving out of the guest
  account and of duplicated keys, and `withdrawalsReported: false`, which means the copy never revokes an absent row
  from Moodle.
- **What the pages draw.** Only what the pages read was checked. That belongs to session 9.

## Looked at and found sound

### 1. Who may read whose holdings

- **Own holdings.** `holdings` with no person, or with the reader's own key, reads the reader's own holdings and is not
  logged (D121, "As built").
- **A report's holdings.** `reports()` (`usecases.ts:501-508`) takes the direct reports of every unit the reader
  manages, over `staff.reach` and `reportsByUnit` (`composition/competence.ts:65`; D99 item 4, D135). The reader and
  deactivated people are left out. It is worked out on every call, so a former manager reads nothing on the day the
  line changes.
- **A registrar.** The registry calls the relation `registrar` only on the person's own direct call to a core read
  (`packages/connectors/src/index.ts:1046`). The use case checks the grant again and keeps the read inside the
  organisation (`usecases.ts:2560-2566`). It shows only `countingRows` (`domain.ts:704-722`): no waiting or rejected
  registration, no unmapped copy, no interest mark.
- **The assistant.** Its calls are never direct, so it gets a colleague's answer and only its own and the reports'
  holdings. Its reads are logged as `assistant`.
- **The administrator.** The administrator stands in no relation to anyone (D118). The requirements list leaves out
  requirements set on one person (`usecases.ts:2879-2885`), and the merge preview rounds its counts. L1 is the
  exception.
- **Figures and cards.** Requirement coverage counts only the reader's own reports. A unit's target is shown only when
  the people the reader does not know are none or five or more (`showable`); M1 is the exception. `competence.person`
  answers one status word per report. The figure on Hem and the manager's card name nobody: the card's period is a
  one-way digest.
- **Routes.** Every route sits behind `protectedRoute` and the module's switch. The administrator's routes refuse
  before a body is read (`routes/competence.ts:179-182`), and their use cases check again, with the step-up.

### 2. The read log

- **What is logged.** One row in the read's own transaction for:
  - a read of someone else's holdings (`usecases.ts:2603`);
  - a search (`:2663`) and the search's file (`:2692`);
  - the matrix's file (`:3120`).
- **What a row holds.** Ids, codes and counts only. A read whose row cannot be written fails.
- **The browser.** A logged read is never fetched again on its own (`apps/web/src/logged-reads.ts:12-18`).
- **A link counts as a request.** The matrix's file (`GET /api/competence/matrix.csv`) and
  `GET /api/cap/competence.holdings` with a person answer a top-level navigation from another site, since the cookie
  is `SameSite=Lax`; the search and its file are POSTs and need the CSRF token. D121 says "A reload or an opened link
  is therefore a search, and is logged", so a row written because a person followed a link is, by design, a read that
  person made.
- **Not logged, as built.** The matrix, the attention list, the approval and confirmation reads, and the status word
  of `competence.person`. That last one is missing from the status page's list of reads that name people and are not
  logged.
- **Contradictions on the status page.** It says once that the filters a search narrowed by are not recorded, and
  later, correctly, that they are (migration 0076). It also still says the export is version `clew.competence/2`; it
  is version 8.

### 3. Writes

A manager registers a holding or a skill only for a current report (`reportOf`). A person's own registration waits,
and its cards go to whoever can decide it now (`decidersOf`). Only a current decider decides, never the person
themselves. These people may revoke:

- the manager, for a holding registered in Clew, and for a skill only when a manager registered it (`revocable`);
- the person themselves, who withdraws their own pending registration and removes a rejected one.

Requirements:

- one on a person is added and removed by that person's manager;
- one on a position or a unit needs `admin.competence` and the step-up (`usecases.ts:2906-2946`).

The catalogue, merges, imports, share targets and mappings belong to the administrator and need the step-up. The
registrar writes nothing. A mapping re-types copied rows of the administrator's own organisation only
(`adapters/postgres.ts:431-446`).

### 4. The copy from sources

- **The lease.** A lease of 15 minutes, renewed between pages. The final write is fenced: a run whose `run` no longer
  matches the source's row answers `busy` (`usecases.ts:1407`, `:1498`), so `forgetSource` during a run makes the run
  write nothing.
- **A failed read.** It leaves the copy as it was.
- **Absent rows.** They are revoked only after a complete read from a source that reports withdrawals (`planCopy`,
  `domain.ts:1663-1735`).
- **Who rows are kept for.** Only active people inside both audiences (`composition/index.ts:286-297`). Two rows for
  one key leave that person's rows alone.
- **Bounds.** `PAGES_MAX`, `COPY_HOLDINGS_MAX` and a repeated cursor stop a run. A string PostgreSQL would refuse costs
  one holding, not the run.
- **Moodle.** Its keys are lowered, its guest account and any key that appears twice are left out, and every row id
  names the account.

### 5. Retention, erasure and export

Erasure is `eraseWithin` (`usecases.ts:388-422`): the hourly sweep (cause `retention`) and `competence-erase.ts`
(cause `operator`) run the same code. The intent is re-read under its lock, an active person is refused, and one
`competence.person_erased` row records the counts.

| Table | Columns about a person | Erasure | Other scripts | Export (`competence-export.ts`, `clew.competence/8`) |
|---|---|---|---|---|
| `competence_holding` | `person_id`, dates, `level`, `interest`, `rated_at`, `source_id` (Moodle's holds the account id); `registered_by`, `revoked_by`, `decided_by`, `validated_by` | the person's rows deleted; their id set to null on other people's rows | `forget-source` deletes a connector's rows; `map` re-types; `read` copies | every holding of the organisation's people, deactivated people's until they are erased |
| `competence_requirement` | `person_id`, `created_by` | rows on the person deleted; `created_by` set to null | none | yes |
| `competence_share_target` | `created_by` | set to null | none | yes |
| `competence_type` | `created_by` (actor string, not null) | kept | `seed` | yes |
| `competence_source_mapping` | `mapped_by` (actor string, not null) | kept | `map`, `forget-source` | yes |
| `competence_source` | none (`counts` per organisation) | not touched | `forget-source` deletes | no |
| `competence_read_log` | `reader_id`, `person_id` | kept (open question: retention of the read log) | `read-log` prints | no |
| `competence_retention` | `set_by` (actor string) | kept | `retention` sets and clears | no |
| `competence_erasure` | `person_id`, `inactive_since` | kept as `erased`, so the sweep does not erase twice | `retention` counts | no |

Outside these tables, the erasure removes:

- the approval cards in every manager's stream;
- every card the module put in the person's own stream;
- the module's work occurrences for the person (`composition/competence-work-items.ts:211-257`).

Each removed card gets a `thread.removed` row. The audit rows and the people module's record stay; the people
module's own erasure keeps the row and clears its fields (`people/usecases.ts:1655-1670`).

Both scripts that cannot be undone ask for `--confirm`. `competence-erase.ts` names a person by id only. Running it a
second time erases nothing more and writes a row with zero counts.

### 6. The work items

- **What an approval card shows.** Its title is "Intyg att granska" and its summary names nobody. It carries the
  person's id as its subject. Its one action is the approval read, which re-checks that the reader is a current
  decider.
- **Reconciliation.** `reconcileOne` (`usecases.ts:677-709`) keeps the cards matching the current deciders. A former
  manager's card is set aside (`reassigned`); a deactivated holder's cards are paused; each change is audited.
- **Closing.** Deciding closes every card of the approval in the same transaction, and so does withdrawing.
- **Cards from the scan.** They go to the person and name a type and a day. The manager's single card names nobody.
- M4 of the durable review (no contract case for `workItems`) stands.

### 7. Domain correctness

- **Days.** A day is Stockholm's (`swedishDay`). Months are added on the calendar, and a day the later month lacks is
  that month's last day (`addMonths`). The last day is still valid; 90 days ahead counts as expiring.
- **The daily run.** It starts at 04:00 Stockholm time through `stockholmInstant`, so DST is handled.
- **Erasure timing.** An erasure falls due a whole number of 24-hour days after deactivation, and never sooner than
  one day after the period was set.
- **Levels.** A skill's level counts only once a manager has confirmed it, for both requirements and targets.
- **Types.** An archived or unknown type counts towards nothing. A merge keeps every holding's history and folds
  requirements and targets into the stricter one.
- **Duplicates.** The holding that ends last decides (`deciding`).
- **Paging.** The search's pages are taken from a sorted whole. The attention list stops at 500 and reports how
  many were left out; one person's rows stop at 500.
- **Reads that grow with the organisation.** The search (documented), coverage (see "Not established"), and the
  copy's lookup by user name (the follow-up above).
- **CSV files.** A value that would start a formula is prefixed with a quote, and file names are made on the server.

### 8. Backend rules and the audit sweep, section B for competence

The module keeps D20's four kinds of file. `domain.ts` imports only `./model`, `@clew/connectors` and
`@clew/contracts`. The use cases take the actor first, own their checks, open the transaction and write the audit row
in it. Like every module's, they import their error classes from `context.ts`, and `capabilities.ts` imports
`system-context` as talks, boarding and dialogue do (see "Seen outside this area").

Section B of the durable review's sweep for competence, completed:

- **Competence actions.** The use cases write 35 `competence.*` actions, counting both branches of each conditional
  action. Each was followed to a test that calls the use case and compares the row, for example:
  - `type_added` at `tests/unit/competence.test.ts:261`;
  - `holding_registered` at `:410`;
  - `holding_removed` at `:3018`;
  - `share_target_removed` at `:1340`;
  - `exported` at `:772`;
  - `source_mapped` and `source_unmapped` at `tests/unit/competence-copy.test.ts:807` and `:820`;
  - `source_forgotten` at `:959`;
  - `types_imported` at `tests/unit/competence-catalogue.test.ts:191`;
  - `type_restored` at `:662`;
  - `leaver_recorded`, `retention_cleared` and `erasure_cancelled` at `tests/unit/competence-retention.test.ts:306`,
    `:495` and `:609`.
- **Work-item actions.** The four `thread.*` actions of `competence-work-items.ts` are asserted on PostgreSQL
  (`tests/db/postgres-competence-approval.test.ts:226-254`, `:389-417`).
- **What remains unasserted.** Only the five competence use cases section B already names: `seedType`, `seedHolding`,
  `seedSkill`, `seedMapping` and `requestRun`. Nothing is added.

## Seen outside this area

- Every module's use cases import `ForbiddenError` and `InputError` from `apps/server/src/context.ts`, which imports
  `auth.ts` and so `openid-client`, `jose` and `@clew/db`. D20 puts errors in contracts. This concerns the backend
  structure across modules.
- `connectors/moodle/connector.mjs:76` folds a key with `toLowerCase()` only, so a username Moodle stores decomposed is
  sent decomposed. This concerns the connector boundary.
