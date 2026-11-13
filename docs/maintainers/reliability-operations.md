# Reliability operations and recovery

Current mechanism: [D47](../decisions/D47-occurrences-timers-and-attention-have-durable-identities.md), the engine of [D85](../decisions/D85-dbos-transact-replaces-temporal-as-the-durable-engine.md) and the in-transaction start of [D86](../decisions/D86-the-ledger-starts-its-workflow-inside-its-own-transaction.md). Evidence and remaining gates: [acceptance matrix](../reference/reliability-acceptance.md). These procedures describe the development/reference stack; an operator must establish production recovery objectives and source-specific procedures before a pilot.

## Inspect without exposing source data

`GET /api/admin/reliability` requires current authorization and `admin.connectors`. The local operator CLI reports the same aggregate counts:

```sh
docker exec -w /workspace clew-app-1 bun scripts/reliability-status.ts
```

Inspect pending/running execution count and oldest age, unknown executions, approval workflows still waiting in the engine's queue (`undeliveredExecutions`, `oldestOutboxSeconds`: rows `ENQUEUED` for more than thirty seconds, which means no instance of the application is dequeuing), reminder workflows waiting the same way (`queuedTimers`), overdue/blocked timers, stale refresh requests, blocked follow-up policies, legacy jobs awaiting drain, scheduled jobs whose run stopped without completing (`stalledJobs`: executing, with a lease that ended more than five minutes ago; a run renews its lease while it lasts, so such a job's process died or stood still and no workflow has claimed it again) and scheduled jobs whose run has held them for more than ten minutes (`longRunningJobs`: executing and still renewed; every job takes seconds, so such a run is waiting on something that does not answer). These aggregates contain no person names, source titles, credentials or payloads. The current diagnostic cutoffs are 30 seconds overdue for timers and five minutes without source refresh; they are not agreed service levels. A source that is intentionally idle can count as stale. Use the detailed records under operator access to interpret the count.

When an outcome is unknown, inspect the execution's original operation ID and source evidence. Use the existing status/reconciliation path; do not create another approval or change the ID to clear the warning. Read-back can preserve known successful items while leaving the remainder uncertain. Access removal can block further reconciliation: preserve evidence and escalate to the accountable operator instead of impersonating the former actor.

An approved action started from a person's menu with an `execute` is sent only while the person still has the user name it was approved with ([D122](../decisions/D122-clew-keys-its-own-records-about-a-person-by-the-persons-id.md) item 5). When that name is no longer theirs, nothing is sent: an execution never dispatched settles `failed` with the reason `subject-changed` and is decided again from its card, as a new decision; one already dispatched whose read-back found nothing settles `unknown` with the same reason and is never replayed, since a replay would reach whoever holds the name now. Settle it from the source's evidence like any other unknown outcome.

An approved invitation to a development talk holds the person it invites while it may still be sent: while its execution is `running`, `pending` or `unknown`, and only for the approval's 24 hours ([D45](../decisions/D45-approved-intent-precedes-source-dispatch.md)), another manager of that person who still has them in their team and confirms a talk with them in the same round is refused with the person's name and "bjuds redan in till ett utvecklingssamtal av en annan chef." ([D96](../decisions/D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md), amended 2026-11-12). An invitation that Clew's own check refused right before sending, because the time or the room was no longer free or could not be read, was never sent: its row says "Inget skickades: …", the execution settles `failed`, and it holds nobody. A `pending` execution keeps its reservation even with a reason, since reconciliation can queue it again: `authority-revoked` also covers a temporary team-read failure. A source reset cannot retry and holds nobody. Only a terminal result, source reset or expiry releases the live approval. Team or grant loss alone does not: a former manager can regain the employee and retry the same approval before expiry. The new manager may therefore wait until the original approval expires, at most 24 hours after it was given. An `unknown` one holds the person until its approval's 24 hours are over, reconciled or not, so reconcile it within that time: when the check finds the invitation, the person is booked and stays so for every manager; after the 24 hours another manager can invite the person, and a talk the unknown one did send counts as booked only once a check reads it back.

## After every deployment

A deployment sets `CLEW_RELEASE` and a stable `CLEW_EXECUTOR_ID` per instance ([D85](../decisions/D85-dbos-transact-replaces-temporal-as-the-durable-engine.md)). The engine tags each workflow with the application version that started it, `CLEW_RELEASE` or, unset, a hash of the workflow code and the engine's own version, and resumes it only in a process of that version. A deployment that changes the version therefore leaves every workflow that a process of the older version had taken from the queue waiting under it: reminders and snoozes, approved executions, a job's watches, follow-ups and scheduled jobs. Nothing logs it, and nothing runs them.

The nightly scan and the sign-in clean-up need no step. A server that starts schedules the next night of both once its engine has launched, and takes over the last and the next night of each when it waits under another version, with the later pages of the last night's scan that have not completed, so a deployment during the scan does not end that night at the page it had reached. The last night is there when the deployment's downtime spanned its time, since the older release held it and stopped first: taken over, it runs at once, late, and a last night that ran is left as it is. To take a night over, the start cancels its workflow and rewinds it to its first step under its own id and the running version, on the ledger's queue. Cancelling changes only the engine's records and stops no process: a process of the older version that still sleeps on the night wakes at its time, may claim the night and run it with its own code, and only its record of the step then fails, so the job's claim is what keeps the night to one run. A night it finds `CANCELLED` under another version, where a start was stopped between the two calls, it rewinds as well. Starts and the operator script serialize moves with a transaction-scoped advisory lock per application queue and workflow, then reread status before acting. A night already waiting or finished under the running version is left alone; one left `CANCELLED` under that version is resumed with all recorded steps intact. This recovery is restricted to the nightly jobs the scheduler selects, since nothing intentionally cancels them. After a cancellation, the move rereads status and leaves a workflow that finished before the cancel alone. The lock uses one app-pool connection and the engine controls use their separate pool; commit, rollback or process death releases the lock. It logs `nightly work taken over from the replaced release`, scope `scheduler`, with the job ids (D85 item 2, as amended 2026-11-13). Without it the nights would stop for good: only a night's run schedules the night after it, and a start finds that night already scheduled. A night older than the last one, left by a downtime of more than a day, is moved with the rest.

Move the rest once the processes of the older version have stopped: a workflow moved while one of them still runs it would run in both. Inside the app container, `bun scripts/workflows-move.ts` lists every workflow that waits, `PENDING` or `ENQUEUED`, under another version than the one the application last launched with (the `version` of the engine's `durable engine (DBOS) launched` line), and the step each would continue from. It moves nothing, and after a deployment that kept the version it finds nothing. `bun scripts/workflows-move.ts --confirm` moves each the way a start moves a night: it cancels the workflow, which changes only the engine's records, and rewinds it under its own id, which the ledger's row names (D86), to the latest version on the ledger's queue. A moved workflow continues from its first step without a record, as the engine continues one it recovers after a crash: what it recorded stands and is not done again, and the step it was in the middle of runs again. The script launches no engine of its own, and the running server's engine runs what it moves. Never fork a workflow instead (`DBOS.forkWorkflow`): the copy gets a new id, which the ledger's row does not name, and a fork of a night of the scan or the clean-up would run beside the original, which the next start takes over. `--workflow <id>` names one workflow, also one the list leaves out: one that ended in `ERROR`, which starts again from the step that failed once its cause is fixed (`DBOS.resumeWorkflow` changes nothing for a workflow that has ended), and one that a move cut short between its two calls, which printed `Could not move` and left it `CANCELLED` under the older version. Name a cancelled workflow only then: Clew cancels a replaced reminder or an undone follow-up on purpose. The script refuses a workflow that has finished, one that already waits under the latest version and one cancelled under it, says why and exits 1, as it does when it could not move one.

A release that adds a job kind leans on the same discipline: an older process that owns a job of the new kind throws `Unsupported scheduled job kind` each time it claims it, about every two minutes. The step's retry finds the job still claimed and waits, so the workflow stays `PENDING` under the older version and never reaches `ERROR`: there is nothing to resume. Once the older processes are stopped, move it as above; the new version runs the job when the last claim's lease of two minutes has run out. An executor whose heartbeat lapsed is adopted by a live instance within about two minutes; `clew_durable.executor` lists the live ones.

## Upgrade from the previous scheduler

1. Back up PostgreSQL, encrypted-data master keys and signing-key material. Record the application revision; the engine's state (the `dbos` and `clew_durable` schemas) is in the same backup. Preserve source operation records for their documented retention period.
2. Stop old application/worker owners before migrating. Do not run the old polling job loop beside the engine; the current code has none, since every job row starts its own `scheduledJob` workflow in the transaction that writes it. Run `bun run db:init` inside the app container, which applies Clew's migrations and creates or migrates the engine's `dbos` schema (D86: the store adapters call `dbos.enqueue_workflow` inside their transactions, so the schema must exist before the first write), then deploy the application; the engine runs inside it.
3. Migrations 0020–0026 add timer generations, follow-up policies, refresh/occurrence records, attention delivery and job ownership. Queued/failed legacy jobs become `temporal` (the value names the durable engine's ownership and predates D85); legacy `running` jobs become `legacy-running`. Old `due` inserts are redirected to the new owner by a database trigger. Neither that trigger nor a lease can stop an old process which already began an external effect.
4. Inspect each `legacy-running` record and its original process/workflow/source evidence. After proving the old owner is stopped, decide whether it completed, remains uncertain or can safely be adopted. Record that decision in the same transaction as any ownership change. There is deliberately no blanket automatic requeue command.
5. Existing invitations without a bounded approval become visible with `legacy-unverified` follow-up policies. They keep their counters and source invitations; automatic follow-up stays paused. Old topic-only work retains an unverified occurrence marker, never inferred source completion.
6. Confirm current ownership, engine launch, queue progress and authorized reads, and take the steps [after every deployment](#after-every-deployment). With `OTEL_EXPORTER_OTLP_ENDPOINT` set (D91, [observability](../architecture/observability.md)) the engine's workflow and step spans, the request that started them and the model's steps are one trace: a turn's audit row carries `details.modelCall.traceId` and every log line carries `trace_id`, so the trace behind a failure is found in the backend from the row or the line.

## Migrations that write rows

The released sequence keeps `0054_dialogue` and `0055_dialogue_note` from `main`. The SCIM and identity changes follow in 0056–0060.
A database on `main`, including one still at 0053, follows the usual upgrade. An isolated preview that already
applied an earlier PR sequence with `0054_person_keys_and_participants` or `0055_person_keys_and_participants` has a different migration history.
Preserve a backup of that preview. Start a disposable preview on a fresh database, or restore a tested pre-branch
backup into a separate database and apply the released migrations there. If changes made in the preview must survive,
verify a data reconciliation on a copy before switching. Keep the existing Drizzle ledger intact.

Migration `0059_session_refresh_claim` adds nullable ownership fields to sessions; existing sessions need no rewrite.
Stop every old BFF before applying it and starting the new release. Older binaries ignore those fields, so a mixed
rollout can still submit the same rotating refresh token twice. Short statements claim and fence a token generation
without keeping a database connection across the provider call. After an owner dies, or cannot commit its answer, a
request finding the claim past its 30-second deadline ends that session and asks the person to sign in again; it never
replays a possibly consumed token. Keep BFF clocks synchronized. A rollback must likewise stop all new BFFs first;
the added nullable columns can stay while the former binary runs, with its former cross-process refresh limitation.

`bun run db:init` runs Clew's migrations through Drizzle and then `DBOS.migrate`. A failure in Clew's migrations changes
nothing in Clew's schema, because Drizzle runs every pending migration in one transaction; only Drizzle's own
bookkeeping, the `drizzle` schema and its `__drizzle_migrations` table, is created outside it where it is missing.
`DBOS.migrate` runs only after that transaction has committed, and DBOS (dbos-sdk 5.5.0) records each of its own
migrations in `dbos.dbos_migrations` as it completes it. So if `DBOS.migrate` fails, Clew's migrations stay applied and
the `dbos` schema stops after the last DBOS migration that completed. Rerunning `bun run db:init` is safe in either
case: Drizzle runs only what it has not recorded, and `DBOS.migrate` resumes after the last version it recorded.

Migration 0053 ([D114](../decisions/D114-person-profiles-show-employments-and-categorised-phone-numbers.md)) moves each
person's `work_phone` and `mobile_phone` into `phone_numbers`, the work number first, and drops the two columns. Before
its fix it could not upgrade a database at 0052 in which anyone held a number: `bun run db:init` failed with
`cannot ALTER TABLE "auth_person" because it has pending trigger events` (SQLSTATE 55006). The failed run left Clew's
schema at 0052 with its numbers and stopped before `DBOS.migrate`. Run `bun run db:init` again with the fixed file;
nothing else is needed. A database already at 0053 or later is unaffected: Drizzle runs only the migrations newer than
the newest one recorded in `drizzle.__drizzle_migrations` and never compares a file's hash, so such a database keeps
the hash it recorded for 0053 (the row with `created_at` 1794478229566 holds `c19791e68d5c…`; the fixed file hashes to
`4df0588b8e09…`) and nothing runs again. `tests/db/person-directory-upgrade.test.ts` checks both: the upgrade from 0052
with numbers, and that a database which applied the old file runs nothing again.

For maintainers writing a migration: these 14 tables carry change-signal constraint triggers that are `DEFERRABLE
INITIALLY DEFERRED`:

- `thread`, `execution`, `auth_person`, `auth_access_grant` and `connector` (0019);
- `timer_intent` (0021);
- `refresh_request`, `attention_delivery` and `followup_policy` (0025);
- `talk` and `talk_commitment` (0043);
- `dialogue_activity` and `dialogue_assessment` (0054), and `dialogue_note` (0055).

A migration that writes any of them, directly or through `ON DELETE CASCADE` or `SET NULL`, runs
`SET CONSTRAINTS ALL IMMEDIATE` as its first statement, which also fires anything an earlier migration of the same run
left pending, and `SET CONSTRAINTS ALL DEFERRED` after its last write. Without that, an `ALTER TABLE`, `CREATE INDEX`,
`DROP TABLE` or `TRUNCATE` of that table, or dropping a foreign key that references it, fails with 55006 later in the
same run, in that migration or a later one. `CREATE TRIGGER`, `DROP INDEX` and adding a foreign key that references
such a table are not affected. A write that matches no row queues nothing, so only an upgrade with rows shows the
failure: give the migration an upgrade test in `tests/db` ([testing](../architecture/testing.md)). 0032, 0053 and 0056
follow this rule. 0030 guards only its `ALTER` of `thread`: its writes come after its own `SET CONSTRAINTS ALL
DEFERRED`, and 0031's `DELETE` from `connector` has no guard; the events of both stay pending until 0032's
`SET CONSTRAINTS ALL IMMEDIATE` fires them, before its `ALTER` of `connector`. 0040's guard wraps only `ALTER`s of
`auth_person` and is a precaution, since no migration before it leaves events pending there. The closing
`SET CONSTRAINTS ALL DEFERRED` returns the rest of the run to each constraint's own mode only because every deferrable
constraint is `INITIALLY DEFERRED`: `pg_constraint` lists exactly these 14 triggers as deferrable, in every schema
including `dbos`. A migration that adds a `DEFERRABLE INITIALLY IMMEDIATE` constraint names the constraints it sets
instead of using `ALL`.

### Upgrading SCIM user names

Migration 0060 composes existing `user_name` values into Unicode NFC. Each changed person keeps their Clew id,
source id and sign-in binding, receives a new SCIM modification time and has one `person.user_name_normalized`
audit row. The migration holds writes to `auth_person` while it checks names across the installation and updates them.

Run this preflight before upgrading from a release that stored user names as sent. It also finds the case-only
collisions that can stop the ICU unique index in migration 0056 on an older database created with locale C.

```sql
SELECT array_agg(id ORDER BY id) AS person_ids
FROM auth_person
WHERE user_name IS NOT NULL
GROUP BY lower(normalize(user_name, NFC) COLLATE "und-x-icu")
HAVING count(*) > 1;
```

For each result, ask the directory owner which distinct account name belongs to each person, including leavers.
Correct the source and apply the approved name to the existing SCIM resource by its Clew id. Repeat the preflight,
then run `bun run db:init`. Migration 0060 checks again under its lock. A collision raises SQLSTATE 23505 and rolls
back the pending migrations. The same repair and retry apply after that refusal.

## The ledger queue

Since D86 a workflow is started by the transaction that commits its intent: `select dbos.enqueue_workflow(...)` on the same connection, into the application's ledger queue (`clew.ledger` for the application the server launches as; queue names are unique across the applications sharing a system database, so a test engine has its own). There is no outbox to retry and no loop to restart. What to check instead:

- Rows waiting for an executor: `select workflow_uuid, name, created_at from dbos.workflow_status where application_name = 'clew' and status = 'ENQUEUED' order by created_at`. A row older than a few seconds while an instance runs means the queue runner is not dequeuing: confirm the instance's version is the latest registered one (D85), since only the latest version dequeues, and that the queue exists (`select * from dbos.queues where name = 'clew.ledger'`). A row committed while no instance ran is dequeued by the next launch.
- A workflow that does not exist for a committed intent (a `timer_intent`, `execution`, `watch_intent` or `job` row without its `workflow_status` row under the id in D86) cannot happen through the stores: both are one transaction. If restored data shows it, the ledger is older than the engine's state or the reverse; follow the restore rules below rather than enqueueing by hand.
- The retired outbox tables (`dispatch_outbox`, the delivery columns of `timer_intent`, `watch_intent` and `job`) are evidence only; nothing reads or writes them for new rows. `watch_intent.delivered_at` is the approval's commit.
- A scheduled job counted in `stalledJobs`: `select id, kind, attempts, lease_until from job where status = 'executing' and lease_until < now() - interval '5 minutes'`, and its workflow under `job:<id>` in `dbos.workflow_status`. A run renews its lease every 30 seconds while it lasts, so its process died or stood still, and the workflow has not claimed the job again: one `PENDING` under an older application version is moved with `DBOS.forkWorkflow` (step 6 of the upgrade above), and one in `ERROR` is resumed once its cause is fixed. The error lines `scheduled job lost its claim while it ran` and `scheduled job finished after another attempt took it; its completion is not recorded` (scope `scheduler`, with the job id and the attempt) mean that a run's process stood still past the lease while the job's workflow claimed it again elsewhere: the job ran twice, and completes under the attempt that holds it. Every job kind can be run twice without harm; find out why the process stood still.
- A scheduled job counted in `longRunningJobs`, or named by the error line `scheduled job still running after ten minutes; it holds its claim until the run settles or its process stops` (scope `scheduler`, with the job id and the attempt): its run has held the job for more than ten minutes and still renews its claim, so it is waiting on something that does not answer, such as a lock or a source. The job's step has no timeout, so the job stays held until the run settles or its process stops; cancelling or forking its workflow does not free it, and a fork finds the job `busy` for as long as the run lasts. Find the instance that runs it: `select j.id, j.kind, j.attempts, j.started_at, w.executor_id from job j join dbos.workflow_status w on w.workflow_uuid = 'job:' || j.id where j.status = 'executing' and j.started_at < now() - interval '10 minutes' and j.lease_until >= now()`. The executor id is that instance's `CLEW_EXECUTOR_ID`, or its host name when none is set. Note what the run waits on first if it shows, such as a statement in `pg_stat_activity` that waits on a lock, then restart that instance: the renewal stops with it, the lease passes within two minutes, and the recovered workflow (D85) claims the job again under the next attempt and runs it, which every job kind can do without harm.

Roll forward to repair operational problems. A rollback must preserve executions, stable IDs, uncertainty, timer generations, audit and authorization fixes; an old application binary is not automatically safe against this schema.

## Restore safely

Restore into an isolated database first, with every application instance stopped: the engine runs inside it. Restore the matching encryption keys; ciphertext alone is not recoverable evidence. Reconcile PostgreSQL (the engine's schemas included) and the source against the same recovery point before enabling dispatch. An older database can forget an effect which the source already committed. Starting dispatch against that database can duplicate it after a source's operation-retention window expires.

Verify execution IDs/results, timer generations and cancellations, job ownership, follow-up counters, occurrence dispositions, audit and authority. Resolve uncertain effects by source read-back or a documented manual process. Keep unresolved cards visible. Only enable workers after the operator has approved reconciliation and confirmed old owners cannot act. Restoring engine state older than the ledger re-runs workflows the ledger already settled; the generation and ledger fences make them no-ops, which the rehearsal should show. An actual source's retention/recovery procedure remains pilot acceptance work.

A backup taken before a person was erased still holds what the erasure removed. After restoring from it, repeat each erasure made since the backup, following [Erasing one person](#erasing-one-person), before the installation is opened again. Take them from the organisation's own list of erasures: the restored audit trail does not have their rows. A person the backup still holds as active is erased once the provisioner has deactivated them again, as step 3 there asks, since `person-erase` refuses an active person.

## Provisioning

People, units and groups enter an installation only through `/scim/v2` (D68). An administrator with `admin.users` adds a provisioner, replaces its key and takes it back on Administration › Användare, under "Inläsning från katalogen" ([D107](../decisions/D107-an-administrator-issues-replaces-and-takes-back-a-provisioners-key-on-the-users-page.md)): the key is shown once, a replaced key answers for a day, a week or not at all, and each of the three writes its audit row with the administrator as the actor. The first key of an installation still comes from the script, since nobody holds `admin.users` before a provisioner has pushed the group that gives it. An operator issues a provisioner its bearer token and revokes it with `bun scripts/provisioner-token.ts add <id> --organisation <organisationId> --label "<text>"` and `revoke <id>`, inside the app container; the token is printed once and Clew keeps only its digest (`auth_provisioner`). `list` shows every provisioner with its state, when its token was issued and when it last called. To rotate a token, run `rotate <id>`: it prints a new token and lets the old one answer for 24 hours (`--grace-hours <n>`, from 0, which ends it at once, to 720), so the new one is handed to the provisioner's team and put in place within the grace period without a push failing; the old digest stops matching when the period ends, and `provisioner.rotated` in the audit says when. One old token is kept: a second rotation inside the grace period ends the first one's old token at once, and the script prints a note when it does. `rotate` and `revoke` run through the use cases the users page runs, in one transaction with the same audit rows, and the script's rows name the actor `bootstrap:cli` (D107 item 6). Tokens do not expire by themselves; rotate on the installation's own schedule and whenever a token may have been seen by someone it was not for. The provisioner sends a change when it happens and reconciles the whole source at least daily ([D109](../decisions/D109-a-provisioner-sends-a-change-when-it-happens-and-reconciles-the-whole-source-daily.md)): validity lives in the source, so a person's access ends when the change that drops their unit membership arrives, and a leaver's account must also be disabled at the identity provider, and kept disabled, not deleted, for as long as the person may come back ([D68](../decisions/D68-people-are-pushed-into-clew-through-standard-scim.md) item 4, amended 2026-11-12). A deleted user is deactivated: nothing is erased through SCIM. A deactivated person's record stays as the last push left it until an operator erases it under the organisation's own retention decision ([D123](../decisions/D123-clew-empties-expired-sign-in-data-itself-and-a-leavers-retention-is-the-organisations-decision.md)), and the erasure then empties the row rather than deleting it, because audit rows and threads reference the person ([Erasing one person](#erasing-one-person)).

Whether pushes still arrive. Clew records when each provisioner last authenticated (`auth_provisioner.last_seen_at`, written at most once a minute) and Administration › Användare shows it under "Inläsning från katalogen", with a warning when a provisioner has been silent for two days or has never called. A run that begins after half an hour of silence writes one `provisioner.seen` audit row with the previous time, so a push that changed nothing still leaves a trace and the audit lists the runs. A silent provisioner is the installation's to alarm on: access a person lost in the source ends in Clew only when the push arrives. `CLEW_PROVISIONER_TOKEN=<token> bun scripts/provisioner-check.ts <url>/scim/v2` reads what the installation holds and warns about the active users without a unit, the managed units without a name, the manager groups and the units with none below them that have no active members, the units whose people report to nobody, the deactivated users still in `unit-manager:`, `capability:` or plain groups (making them active again gives back at once what those groups give), the employments on a unit no longer held, and the group keys written wrong or naming a capability the check does not know; `--roots <n>` also warns when the tree has another number of roots. It changes nothing. It authenticates as a provisioner, so it counts as that provisioner's call and moves its last-seen time: issue the check a key of its own right before it runs ("Lägg till katalog", or `provisioner-token.ts add check --organisation <organisationId>`) and take it back as soon as it has run ("Återkalla nyckeln", or `revoke check`). There is one kind of key, so the check's key can create, change and deactivate as much as any provisioner's, and until it is taken back its row shows "Tyst i över två dygn" from two days after the check last ran.

What to read when something is wrong. An unexpected failure of a SCIM request is a 500 to the client and one `error` line with scope `scim` in the server log, with the trace id when tracing is on. A 400 `invalidValue` that names a key is [D96](../decisions/D96-a-key-written-wrong-is-refused-at-the-scim-boundary.md) or D93: the provisioner's mapping wrote a key wrong. The audit table carries `scim.user.*` and `scim.group.*` (actor `provisioner:<id>`); `grant.derived` on the person with the unit, role and capabilities that resulted and the number of placements, or `removed: true` when the person has no unit left; `assignments.derived` on the person with their placements when those change and the grant does not, such as a second unit or a manager's role on one ([D99](../decisions/D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md)); `positions.derived` on the person with the codes of the positions they now hold (D108 item 5); `group-capability.added`/`removed` on the group (actor the administrator), with the capability and `groupLabel`, the name of the organisation's group that held the key once the change held the row of the group it found and then the organisation's capability rows, or `null` when none did, as when a removal raced a change of the group's key; and `provisioner.added`, `provisioner.rotated` (the grace period, until when the old key answers, and `endedEarlier` when a second rotation ended an older key early) and `provisioner.revoked` on `provisioner:<id>`, with the administrator or `bootstrap:cli` as the actor. The sign-in rows are under [Sign-in](#sign-in). A person with no `unit:` or `unit-manager:` membership has no grant and cannot sign in at all: every sign-in is refused with "Kontot saknar behörighet till Startsidan." and a `login-denied` row that names them, the first one right after `identity-bound`, and a person who loses their last unit while signed in is shut out at their next request with `access-revoked`. The provisioner's mapping, not Clew, decides those memberships. A mapping row whose group the source removed stays and shows as such on Administration › Användare, where it can be removed.

## Sign-in

A sign-in follows the identity provider's session, and a sign-out there ends Clew's ([D121](../decisions/D121-a-sign-in-follows-the-identity-providers-session.md)). The authentication log (`auth_audit`) has one row per event, an action and an actor, with no details; the audit table holds the details of the sign-in decisions.

- `login`, and `login-dev` for the development sign-in, open a session. `logout` is "Logga ut". `replaced` ends the session that a new sign-in in the same browser replaces.
- `expired` ends a session past its idle or absolute expiry, written when its cookie comes back or by the nightly clean-up below. `access-revoked` ends one whose account no longer gives access: the person was deactivated, lost their last unit or was moved to another account. `refresh-failed` ends one whose renewal the identity provider answered with `invalid_grant`, `interaction_required`, `login_required` or `consent_required`, whose renewed ID token names another subject, or whose sealed tokens can no longer be opened ([D121](../decisions/D121-a-sign-in-follows-the-identity-providers-session.md) item 3). `backchannel-logout` and `frontchannel-logout` end the sessions a sign-out at the identity provider names. Each of these names `person:<id>`.
- `login-denied` is a refused sign-in, naming the person when one is known. `identity-bound` is a first sign-in that bound an account to its person (`identity.bound` in the audit table, with the issuer and the claim's name). `identity-unmatched` is a first sign-in whose claim names nobody or a person who has left, with `claim:<value>` as the actor: the account that tried. `identity-conflict` is a sign-in refused on the person its claim names, in one of two cases: that person is already bound to another subject, so the account is new to Clew (for example, it was deleted and made again, or Clew has a new app registration), or the subject is bound to someone else, its `holder`. The `identity.conflict` row on that person holds the issuer, the claim, its value, the refused `subject` and, in the second case, the `holder`.

The operations guide reads these case by case in [When a sign-in is refused](../guides/scim-sign-in-and-hosting.md#when-a-sign-in-is-refused).

The claim. `OIDC_BINDING_CLAIM` names the claim that is compared with the people's user names, NFC-normalised and without regard to case. A subject not seen before binds to the one active person it names. At every later sign-in, not on each request, the claim is compared again: when it names another person than the one the subject is bound to, a person who has left included, the sign-in is refused with `identity-conflict` and nothing is rebound; a claim that names nobody, or names the person, signs them in, since the identity provider may rename an account before the provisioner renames the person ([D68](../decisions/D68-people-are-pushed-into-clew-through-standard-scim.md) item 6, amended 2026-11-12). Changing `OIDC_BINDING_CLAIM` after people have signed in keeps their bindings, but the new claim is the one compared at every sign-in: a person whose value under it is another person's user name is refused, and a value that names nobody, or names the person, signs them in as before. For a subject not seen before, the claim still decides the person.

Moving a binding. Only an operator moves a sign-in to another account, with a script inside the app container; never on a page and never by itself (D68 item 6, amended 2026-11-12). It is needed when the source changed the id of a person who had signed in and could not re-key the row first, when an account was deleted and made again, when Clew got a new app registration (one run for each person who is refused; there is no run for everybody at once), and when an account name moved between two people and one of them signed in before Clew had moved it. The refused sign-in's `identity.conflict` row holds what the script needs: the person it is about, the refused `subject` and, when someone holds that subject, the `holder`.

```sh
docker exec -w /workspace clew-app-1 bun scripts/identity-rebind.ts --person <person id> --subject <new subject> --operator "<your name>"
docker exec -w /workspace clew-app-1 bun scripts/identity-rebind.ts --person <person id> --release --operator "<your name>"
```

`--subject` moves the person's binding under the issuer to the new subject; `--release` removes it, and the next sign-in whose claim names the person binds them again as a first sign-in does. The issuer is `OIDC_ISSUER` as the server has it, or `--issuer <issuer>`. In one transaction the script writes the binding and one `identity.rebound` row in the audit table: actor `operator:cli`, about `person:<id>`, with the issuer, `oldSubject`, `newSubject` (`null` for a release) and the operator's name. A run that would change nothing says so and writes nothing. It refuses a person id the people table does not hold and a subject another person holds, writing nothing and exiting 1; for a held subject it prints the command that releases the holder, to be run once the account names agree in the identity provider and in Clew. An option given twice, both or neither of `--subject` and `--release`, a subject that is not printable ASCII without spaces of at most 255 characters, an operator's name over 200 characters or with a control character, or no issuer exits 2 before the database is asked. The person's sessions under the old subject end at their next request, which is answered 403 with "Du saknar behörighet för åtgärden." and writes an `access-revoked` row; the request after it is answered 401 with "Din inloggning har gått ut. Logga in igen." To undo a run, run it again with the `oldSubject` its row keeps. Never change account names to make a refusal go away: while a subject is bound to the wrong person, a claim that names nobody, or names that person, signs the account in as them, with their access. The cases step by step are in [Moving a sign-in to another account](../guides/scim-sign-in-and-hosting.md#moving-a-sign-in-to-another-account).

When a sign-in fails. Every sign-in that fails at its start or at the callback, a refusal of the person included (`AuthError`, `denied`, 403, beside its rows in `auth_audit`), and every refused back-channel or front-channel logout is one line with the scope `auth` in the server log: `sign-in could not start` at the level `error`, or `sign-in failed at the callback`, `back-channel logout refused` or `front-channel logout refused` at the level `warn`. A refused "Logga ut", answered "Utloggningen kunde inte bekräftas. Försök igen.", writes no line. The line's field `failure` holds `name` and, where they exist, `code`, `oauthError`, `status`, `message` and `cause`. For a database error (`DrizzleQueryError` or `PostgresError`), `code` is PostgreSQL's SQLSTATE or the connection's code, and only a failed connection adds its message. The line never holds a claim, the provider's `error_description`, a token or a value a statement was given; the operations guide's table under [When a sign-in is refused](../guides/scim-sign-in-and-hosting.md#when-a-sign-in-is-refused) reads the codes. A renewal that fails in any way other than those that end the session with `refresh-failed`, such as `invalid_client` after a rotated client secret, 429, a 5xx, a time-out or no answer at all, keeps the session and the person's work in Clew, and only connectors that act as the person wait: each server process then logs `token refresh failed; sessions are kept and delegation waits` at the level `warn`, scope `auth`, with the error's code and, when the provider answered, the HTTP status, at most once a minute (D121 item 3).

The nightly clean-up. Clew removes expired sign-in data itself ([D123](../decisions/D123-clew-empties-expired-sign-in-data-itself-and-a-leavers-retention-is-the-organisations-decision.md) item 1). A job of the kind `sign-in-cleanup`, with the id `sign-in-cleanup:<date>`, runs at 03:00 Europe/Stockholm through the job table and its `scheduledJob` workflow, with `job.scheduled` and `job.completed` rows (actor `system:scheduler`). Every server process schedules it at start, once its durable engine has launched, and each night schedules the next one before it cleans; the id is fixed for each date, so it runs once a night however many processes schedule it. A start also takes over the last and the next night when a deployment left them waiting under the replaced release ([after every deployment](#after-every-deployment)), so a deployment does not stop the nights, and a night whose time fell during the deployment runs late, once the start has taken it over. While the database cannot be reached, the engine does not launch: it logs `durable engine unavailable, retrying in 30 s`, scope `dbos`, and nothing is scheduled until it has launched. A start whose scheduling or take-over fails after the launch logs `nightly work could not be scheduled, retrying`, scope `scheduler`, and tries again every two seconds. In one transaction the clean-up removes every session past its absolute or idle expiry, sealed tokens included, and the login transactions and logout receipts past theirs; a session that was still open gets an `expired` row, timed at the clean-up, and one that had already ended gets no second row. Every request refuses a session once either expiry has passed, but its row stays until that night, up to about a day. `bun run auth:setup` runs the same clean-up once. A night whose clean-up fails logs one `error` line, scope `scheduler`, `sign-in clean-up failed`, and still completes; nothing retries it within the night, and the next night removes what was left, so alarm on that line. A night that did not run at all writes no such line: by 04:00 its job row in `job` is not `done` and `audit` has no `job.completed` row for `job:sign-in-cleanup:<date>`; its workflow, under the same id in `dbos.workflow_status`, says why. `ERROR` is a night whose step failed ten times, which can also have left the job without a next night until a server starts: once the cause is fixed, `bun scripts/workflows-move.ts --workflow job:sign-in-cleanup:<date> --confirm` starts it again from that step, and it runs late and schedules the next night. `PENDING` under an older `application_version` is a night no start has taken over: one whose take-over failed, which the start logs as `nightly work could not be scheduled, retrying` while it tries again, or one older than the last night, after a downtime of more than a day, which the script moves ([after every deployment](#after-every-deployment)). `CANCELLED` under an older one is a take-over that a start was stopped in the middle of, which the next start finishes. The clean-up never removes rows of `auth_audit` or `audit`, sign-in bindings or people. How long the history of sign-ins and the audit trail are kept is the organisation's decision (D123 item 2), and nothing in Clew carries out a period it sets; the development-only prune that dropped `auth_audit` rows after 30 days is gone.

## Entities: lenses, columns and erasure

What sources say about a person or a unit ([D97](../decisions/D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md), [Entities](../architecture/entities.md)) is read live and never stored, so there is nothing of it to back up or restore. Four things are an operator's.

Migration 0046 adds `thread.subjects` and the table `thread_subject`, the index from entity to cards; `bun run db:init` applies it with the others. It fills nothing in: a card stored before it names nobody, and is indexed when its rows are next written.

Migration 0056 comes with [D122](../decisions/D122-clew-keys-its-own-records-about-a-person-by-the-persons-id.md), under which Clew keys its own records about a person by the person's id. It rewrites no card: a card whose rows named a person by user name before it names nobody until its rows are next written, when each name is resolved to the id of whoever holds it then. It removes every calendar proposal stored before it, since none says which person its address meant, and with them the development-talk planning cards (topic `utvecklingssamtal`) and what hangs on them. A decision still on its way for such a card is first retired as `scripts/fixture-maintenance.ts` retires one: it is settled `failed`, or `unknown` when it was dispatched, with the reason `source-reset`; its approval expires, its lease ends and its attempt moves on, so a worker still holding it cannot finish it; its workflow in the durable engine finds the reason `source-reset` the next time it runs and ends without sending; an undelivered row of the retired `dispatch_outbox` ([D86](../decisions/D86-the-ledger-starts-its-workflow-inside-its-own-transaction.md)), which nothing writes any more, is marked delivered with the error `source-reset`; and one `execution.source_reset` audit row says so, with the state before and after and whether it was dispatched. A decision already reset is left as it is. Each card removed gets a `thread.removed` row with the reason `migration`. Both rows are written by `system:migration`. The next nightly scan draws the cards again. It also recreates the unique index on user names under ICU's root collation (`und-x-icu`), so the database must be a PostgreSQL built with ICU, as the development stack's official image is. The unique index on a person's source key becomes partial, counting only the rows that have one: a plain unique index makes the column a key of PostgreSQL's row locks, so a user write that changed the key would need a stronger lock than the one it takes and could deadlock with a group write that had just added the person. Before its own writes, 0056 fires the change-signal triggers that earlier migrations in the same run deferred, and it keeps them immediate through its writes (`SET CONSTRAINTS ALL IMMEDIATE`, then `DEFERRED` again), as [migrations that write rows](#migrations-that-write-rows) do, so neither its index on `auth_person` nor a later migration that alters a table it wrote fails with "pending trigger events".

Migration 0058 adds the index `auth_person_user_name_nfc`, on a user name in the composed form (NFC) without regard to case under `und-x-icu`: the expression with which Clew finds who holds a user name a source sent ([D122](../decisions/D122-clew-keys-its-own-records-about-a-person-by-the-persons-id.md) item 2), as a refresh whose rows name a person, a read of a declared view, a search and a started propose each do. Without it, every such lookup read every person in the installation. It writes no rows. Unicode normalisation needs a database in UTF-8, as the development stack's PostgreSQL image creates it.

Lenses and columns are chosen on Administration › Anslutna system, on the connector's page under "På Personal och andra listor", by a person with `admin.connectors`. They are stored in the connector's capability overrides, audited as `connector.lens` and `connector.column`, and take effect from the next read, without a restart. At most three columns per entity kind are accepted across every connector; the count is taken outside the saving transaction, so two administrators saving at once can pass it, and the list then shows the first three. Enabling or registering a connector places nothing. `bun run dev:connectors` makes the development stack's choice only while no lens or column is chosen anywhere.

To erase a unit from every card in every stream, or a person as step 4 of [Erasing one person](#erasing-one-person), run inside the app container ([script](../../scripts/subject-erase.ts)):

```sh
docker exec -w /workspace clew-app-1 bun scripts/subject-erase.ts person <person id> --confirm
docker exec -w /workspace clew-app-1 bun scripts/subject-erase.ts unit <unit id> --confirm
```

It removes the `subject` of every row that names the entity, the card's own `subjects` and the index rows in one transaction, and writes one `thread.subject_erased` audit row with the actor `operator:cli`, about `person:<person id>` or `unit:<id>`, holding counts only and never a user name. A person is named by their id, never by a user name ([D122](../decisions/D122-clew-keys-its-own-records-about-a-person-by-the-persons-id.md) item 7): one erasure reaches every card about them, whatever user names they have held, and never the cards of someone who holds one of those names now. An id the people table does not hold is refused, and so is a person who is still active, since a person is erased only once the source has deactivated them ([D123](../decisions/D123-clew-empties-expired-sign-in-data-itself-and-a-leavers-retention-is-the-organisations-decision.md) item 3): the script writes nothing, audits nothing and exits 1. A unit is erased by any id, since a removed unit may still be named on cards. When no card names the entity, the script says so and still writes its row, with zero counts. It cannot be undone, hence `--confirm`. The rows' text stays as the source wrote it, and a source that still names the entity names it again on its next scan, so erase in the source too. The talks, competence and follow-up dialogue domains and the person's own record are erased by the other steps of [Erasing one person](#erasing-one-person).

## Erasing one person

How long a deactivated person's record is kept is the organisation's decision under its own archive and data-protection rules, not Clew's ([D123](../decisions/D123-clew-empties-expired-sign-in-data-itself-and-a-leavers-retention-is-the-organisations-decision.md)). A deactivation clears nothing: the record, the cards, talks, competences and follow-up dialogue records that name the person, the audit trail and the authentication log stay as they are until an operator erases them, one person at a time, when the organisation's rules say that the record's time has come. A person pushed by mistake is deactivated by the source and erased the same way. The steps run in this order, each command inside the app container.

1. **The person's id.** Every script takes Clew's id for the person and never a user name ([D122](../decisions/D122-clew-keys-its-own-records-about-a-person-by-the-persons-id.md) item 7). An active person's name on Administration › Användare links to their page, whose address is `/people/<id>`. A deactivated person has no page (`/people/<id>` answers 404, and every list shows the name as plain text), and Användare shows their user name, not their id. For a leaver, take the id from the organisation's provisioner, which addresses the person as `/Users/<id>` in every write, or have it ask `GET /scim/v2/Users?filter=externalId eq "<source id>"` or `GET /scim/v2/Users?filter=userName eq "<user name>"` with its key: both answer a deactivated person too, with the `id` and `active: false`. Or read it in the database, read only: `select id, user_name, external_id, enabled from auth_person where external_id = '<source id>' or lower(user_name collate "und-x-icu") = lower('<user name>' collate "und-x-icu");`, and check that `enabled` is `f`. If the name may have been given to someone else since, go by the source id, or list everyone who has held the name: `select distinct subject from audit where action like 'scim.user.%' and lower(details->>'userName' collate "und-x-icu") = lower('<user name>' collate "und-x-icu");`. Each subject is `person:<id>`; the rows of a person already erased hold `[erased]` in place of the name, so that person is not listed.
2. **An export, when the person has asked for their data.** Optional. Each export holds one organisation's whole domain, is written with mode 0600 and never over an existing file, and is audited (`talks.exported`, `competence.exported`, `dialogue.exported`; counts only, actor `operator:cli`):

   ```sh
   docker exec -w /workspace clew-app-1 bun scripts/talks-export.ts --organisation <organisation id> --out <file>
   docker exec -w /workspace clew-app-1 bun scripts/competence-export.ts --organisation <organisation id> --out <file>
   docker exec -w /workspace clew-app-1 bun scripts/dialogue-export.ts --organisation <organisation id> --out <file>
   ```

   Keep the records that hold the person's id: in the talks file, `talks[]` by `employeeId` or `heldBy` and `commitments[]` by `employeeId`, `ownerId`, `createdBy` or `doneBy`; in the competence file, `holdings[]` by `personId`, `registeredBy` or `revokedBy`. In the dialogue file, select `assessments[]` and `notes[]` by `authorId`, and `activities[]` by `ownerId`, `createdBy` or `doneBy`. The exports include free text, including the contents of private notes. Review the selected records before disclosure and delete the export files once the request is answered. What the directory sent about the person is what `GET /scim/v2/Users/<id>` returns.
3. **The source first.** Erase only after the source has stopped sending the person and the provisioner has deactivated them. A source that still sends them creates the record again at its next run, as a new person with a new id, since the erased row holds neither the source key nor the user name. A client that still writes to the old id fills the erased row again: a `PUT /Users/<id>` gives it a user name and fields, and a `PATCH` with `active: true` makes it active without a user name.
4. **Cards, talks, competences and the follow-up dialogue**

   ```sh
   docker exec -w /workspace clew-app-1 bun scripts/subject-erase.ts person <person id> --confirm
   docker exec -w /workspace clew-app-1 bun scripts/talks-erase.ts --person <person id> --confirm
   docker exec -w /workspace clew-app-1 bun scripts/competence-erase.ts --person <person id> --confirm
   docker exec -w /workspace clew-app-1 bun scripts/dialogue-erase.ts --person <person id> --confirm
   ```

   `subject-erase` takes the person off every card in every stream ([above](#entities-lenses-columns-and-erasure)) and writes `thread.subject_erased`. `talks-erase` removes the person's talks, every action point about them and the cards of those and of the points they owned, and clears their id from other people's talks and points, with `talks.person_erased`. `competence-erase` removes their holdings and the competence cards in their own stream, each card with a `thread.removed` row, and clears their id from the holdings they registered or revoked for others, with `competence.person_erased`. `dialogue-erase` clears their id as an assessment author or activity owner, creator or completer, removes the cards of activities they owned and deletes their private notes. The unit assessments and activities keep their text. It records `dialogue.person_erased`. Each writes its row in the transaction that erases, about `person:<id>`, actor `operator:cli`, with counts only. Each refuses an id the people table does not hold and a person who is still active (step 3), and writes nothing and no audit row for either. When nothing matched, each says so and still writes its row, with zero counts. None of them cancels the durable workflow of a timer on a card it removes, an action point's due date or a reminder the person asked for, since a script never starts the durable engine: the timer goes with its card, and the workflow wakes at its time, finds no timer and ends without a write ([D86](../decisions/D86-the-ledger-starts-its-workflow-inside-its-own-transaction.md)).

   What each answers, with its exit code:

   - 2, on standard error, for a malformed call: the script's usage line, such as `Usage: bun scripts/talks-erase.ts --person <person id> --confirm`. For `talks-erase`, `competence-erase` and `dialogue-erase` that is no `--person`, `--person` without a value or with an option as its value, an empty id, an option given twice, or any other argument, as for `person-erase` in step 5; for `subject-erase`, a kind other than `person` or `unit`, no id or more than one, or an option other than `--confirm`.
   - 2, on standard error, without `--confirm`: what an erasure removes, and that it cannot be undone, then, from `talks-erase`, `competence-erase` and `dialogue-erase`, the usage line. These argument checks run before any database call.
   - 1, on standard error, for an id the people table does not hold: `No person has the id "<id>": nothing was erased and nothing was audited. A person is named by their id, never by a user name.`
   - 1, on standard error, for a person who is still active: `Person "<id>" is still active: only a person the source has deactivated is erased (D68 item 1). Nothing was erased and nothing was audited.`
   - 1, on standard error, when the database fails: `Could not erase: <the database's message>. Nothing was written.`, as from `person-erase` in step 5; for a database that cannot be reached, for example, `Could not erase: connect ECONNREFUSED <address>:<port>. Nothing was written.` The transaction wrote nothing, so run it again.
   - 0, on standard output: the counts, such as `Erased person "<id>" from the talks domain: <n> talks and <n> action points removed, <n> other records cleared, <n> cards removed. Audited as person:<id>.`, or, when nothing matched, that nothing was changed, with the same `Audited as person:<id>.`
5. **The record, last:**

   ```sh
   docker exec -w /workspace clew-app-1 bun scripts/person-erase.ts --person <person id> --confirm
   ```

   `person-erase` ([script](../../scripts/person-erase.ts)) refuses an id the people table does not hold and a person who is still active, and writes nothing and no audit row for either. In one transaction it takes the person out of their groups, moving each group's time of change, and removes their placements, grant, sign-in bindings under every issuer and sessions with their sealed tokens; clears every personal attribute (the name, the e-mail address, the phone numbers, the employments and the title); and stores no user name and no source key. The row keeps its id, which other records point at, its organisation, its deactivation and its time of creation. In the audit table and the authentication log it replaces the user names, the source keys, the sign-in subjects and the claim values that name the person with `[erased]` and keeps every event (D123 item 3 lists where); a `null` or empty value held nothing and stays as it is. It writes one `person.erased` row, actor `operator:cli`, about `person:<id>`, with counts only: `fields`, `memberships`, `assignments`, `grants`, `bindings`, `sessions`, `auditRows` and `signInRows`. It runs last because afterwards the directory no longer says whose the id was: SCIM and Administration › Användare show the id where the user name stood, and no name. The preceding erasures run while the id can still be checked against the person's name there, and they still find the person by the id afterwards.

   Afterwards the record reads as its id, as any record without a user name does: `GET /scim/v2/Users/<id>` answers the id as `userName`, an empty name, no address, no groups and `active: false`, and Administration › Användare shows the id where the user name stood. A filter on `userName` or `externalId` no longer finds it. No key resolves to the person any more, neither the id nor any name they held ([D122](../decisions/D122-clew-keys-its-own-records-about-a-person-by-the-persons-id.md)): a card started from their menu with an `execute` can no longer be decided, and says "Personen finns inte längre i katalogen. Inget har skickats.", and an execution approved from such a card before the erasure sends nothing, settled at dispatch with the reason `subject-changed`. Every other open card about the person keeps the actions its source wrote, which can still be decided and are sent as written (step 6). The user name and the source key are free, so the source can push them again as a new person.

   What it answers, with its exit code:

   - 2, on standard error, for a malformed call (no `--person`, `--person` without a value or with an option as its value, an empty id, an option given twice, or any other argument): `Usage: bun scripts/person-erase.ts --person <person id> --confirm`.
   - 2, on standard error, without `--confirm`: `Erasing person "<id>" clears their name, e-mail address, phone numbers, employments, title, user name and source key, removes their groups, placements, grant, sign-in bindings and sessions, and replaces their identifiers in the audit trail, and cannot be undone. Run again with --confirm to erase.`, then the usage line. Neither of these asks the database anything.
   - 1, on standard error, for an id the people table does not hold: `No person has the id "<id>": nothing was erased and nothing was audited. A person is named by their id, never by a user name.`
   - 1, on standard error, for a person who is still active: `Person "<id>" is still active: only a person the source has deactivated is erased (D68 item 1). Nothing was erased and nothing was audited.`
   - 1, on standard error, when the database fails: `Could not erase: <the database's message>. Nothing was written.` The transaction wrote nothing, so run it again. Such a failure is a database error, for example a deadlock with a write to one of the person's groups at that moment. The unique index on user names cannot refuse an erasure, since the erased row holds no user name.
   - 0, on standard output: `Erased person "<id>": <n> personal fields cleared; <n> memberships, <n> placements, <n> grants, <n> sign-in bindings and <n> sessions removed; <n> audit rows and <n> sign-in log rows cleared of their identifiers. Audited as person:<id>.`
   - 0, on standard output, when nothing is left to erase: `Person "<id>" holds nothing more to erase: nothing was changed. Audited as person:<id>.` Its row holds zero counts.

   Run it again when a group push that the source sent before it stopped sending the person has put them back in a group: the second run removes that membership, counts it and moves the record's time of change, so a client that reads by `meta.lastModified` sees it.
6. **What stays.** The erasure keeps these on purpose:
   - The person's row, with its id, organisation, deactivation and time of creation, so every record that points at the id stays valid. An id is never given to anyone else.
   - The id wherever Clew keeps it: `person:<id>` as an actor or a subject, `holder` in `identity.conflict` rows, `addedPeople` and `removedPeople` in `scim.group.*` rows, the `grant.derived` and `assignments.derived` rows, the `identity.bound` rows and the authentication log's rows with the actor `person:<id>`. So the events of the audit trail and the authentication log stay, under `person:<id>`.
   - The groups and their other members, the units and the capability mappings.

   No script reaches these, so an operator removes them by hand where the organisation's rules ask for it:

   - The text of card rows and messages as the source wrote it, and a source's own card topics. A source that still names the person names them again on its next scan: erase in each source system too, under its own procedure.
   - The person's own stream: no script removes the cards, conversations and decisions in it, apart from the talks, competence and dialogue activity cards removed above.
   - Other people's approved decisions about the person, which keep the payload they were approved with ([D45](../decisions/D45-approved-intent-precedes-source-dispatch.md)). In a started action, `payload[subject.param]` holds the user name the person had when it was decided; `subject.param` is the name of the input property, such as `person`, and `subject.personId` is the id.
   - The actions of open cards about the person in other people's streams. A card a source pushed, or one started from the person's menu with a `propose`, keeps the source's own actions and the input the source wrote, which can name the person by the source's own key or by the user name the source was sent. They can still be decided after the erasure and are sent as written, and a decision approved from one is dispatched as approved: only a card started with an `execute` keeps its person, and only it is refused (step 5).
   - The answers typed for an action's asks (`asked`) in `thread.started` and `execution.approved` audit rows, which can name the person ([open questions](open-questions.md#waiting-for-the-product-owner)), and the operator's name typed into `identity.rebound` rows when the erased person ran rebinds for others.
   - Free text on unit assessments and activities in the follow-up dialogue.
   - A calendar proposal's `participant_name` and `participant_email`, for as long as the proposal is kept.
   - The person's account at the identity provider and their records in the source systems.
   - Export files, backups, server logs and traces made before the erasure. A restore from such a backup brings the person back until the erasure is repeated from the organisation's own list of erasures ([Restore safely](#restore-safely)).

## Changing the authorization fingerprint

`authorizationVersion` in `apps/server/src/auth-crypto.ts` is an HMAC over the authority in a person's access record and nothing else: enabled, organisation, unit, role, the sorted capabilities and the grant version (narrowed 2026-11-09 for [D68](../decisions/D68-people-are-pushed-into-clew-through-standard-scim.md); `tests/unit/authorization-version.test.ts` holds the list). A corrected name, a renamed unit label or a new column on the person or the grant leaves it unchanged, so directory updates do not stop work in flight.

Durable work stores the value and compares it exactly. When it differs, a queued execution or watch settles `blocked` with `authority-revoked`, a timer or follow-up policy pauses, and an answer retained in a thread is hidden until a fresh scan creates a new projection (D75). A change to the formula, to the field list or to `MASTER_KEY` therefore changes every stored value at once and reads as lost authority for everyone. Treat it as a release of its own: note the reliability counts before, deploy in a quiet window, expect blocked executions with that reason, let the nightly scan rebuild cards, and let the people concerned approve again. Do not roll back to a binary with the other formula; it would read the new values the same way. The narrowing of 2026-11-09 is itself such a change on the first deployment that carries it. This is reasoned from the code paths named; it has not been rehearsed against a populated installation.

The nightly scan runs for enabled people with a grant and an identity binding (`granted()` in `apps/server/src/scheduler/adapters/postgres.ts`, `tests/db/scheduler-people.test.ts`). A person pushed in through provisioning who has never signed in is not scanned, nor one whose binding an operator has released ([Sign-in](#sign-in)), until a sign-in binds them again.

## The competence copy

The daily copy of what sources hold (D108 item 9) is a `competenceCopy` workflow per day, `competence-copy:<day>` at
04:00 Swedish time. The server asks for the next one at boot and every hour after, and each daily run asks for the
next before it reads, so a run that ends in `ERROR`, or a day on which no instance ran, is followed by the next day's
within the hour without an operator. A source's own failure is recorded on its row of `competence_source` (outcome
`failed`, the kind in the run's audit row `competence.source_read`) and never stops the other sources. A lease left by
a run that died lapses after fifteen minutes, and a failure on Clew's side (the database, the directory behind the
audiences) is recorded `failed` with the kind `storage` and lets go of the source at once. `bun scripts/competence-read.ts`
asks for a run now and prints each source's counts; `scripts/competence-erase.ts` erases only a person the directory has
deactivated.

Copied rows are a cache (D108 items 9 and 14): the next read deletes those of a person the directory has deactivated or
who has left the source's or the module's audience, whatever the source says. A provisioner fault that deactivates many
people before 04:00 therefore deletes their copied rows at the daily read. Once the directory is put right, the next
read copies back what the source still holds, as new rows (new ids and creation dates; the source's row ids, days and
labels, so the statuses are as before); what the source no longer holds does not come back. Holdings registered in Clew
are not affected. If such a fault is found before 04:00, switching Kompetens off under Anslutna system until the
directory is right stops the read.

### Erasure after a person leaves

Under [D123](../decisions/D123-clew-empties-expired-sign-in-data-itself-and-a-leavers-retention-is-the-organisations-decision.md)
a leaver's competence is erased by hand, as one step of [Erasing one person](#erasing-one-person), when the
organisation's rules say so, and no timer erases it. The competence module also has a period an operator may set per
organisation, built before D123 and kept when the two were merged (D108's amendment of 2026-11-12): **while no period
is set nothing is erased by it**, and whether one may be set is for the product owner. What follows is how it works
once set.

A person the directory deactivates keeps their competence until a period the operator sets has passed; then it is
erased (D108 item 14). The period is per organisation and has no default: **while it is unset nothing is erased**.
Set, read and clear it inside the app container ([script](../../scripts/competence-retention.ts)):

```sh
docker exec -w /workspace clew-app-1 bun scripts/competence-retention.ts --organisation <id>             # the period and who waits
docker exec -w /workspace clew-app-1 bun scripts/competence-retention.ts --organisation <id> --days 90   # 1 to 3650 days (--days=90 too)
docker exec -w /workspace clew-app-1 bun scripts/competence-retention.ts --organisation <id> --off       # clear it
```

The script refuses an organisation that has no provisioned person and no provisioner, and any argument it does not
know; it changes nothing then.

What happens:

- **A deactivation** (SCIM `PATCH` or `PUT` with `active: false`, `DELETE`, or a user created inactive) writes the
  person's row in `competence_erasure` (`inactive`, from that moment, the next generation) in the same transaction as
  the change, through the people module's leavers port, and nothing else: no period is read and nothing is scheduled.
  The SCIM audit row of the change records it. The port runs in a savepoint with a lock timeout of two seconds: if it
  fails or has to wait longer, it is rolled back to the savepoint, a `warn` line with scope `scim` says so ("could not
  record a change of active"), and the deactivation commits all the same (D113). Nothing in the competence module can
  make a deactivation fail; the most it can do is hold it up for those two seconds.
- **A reactivation** (`active: true`, or a full `PUT` without `active`) marks the row `cancelled` in the same way.
  Nothing registered in Clew was touched, so the person comes back as they left. Rows copied from a source are the
  exception: the daily read deletes them while the person is deactivated and copies back, as new rows, what the source
  still holds at the first read after they are active again.
- **When it is due** follows from the row and the period as it stands: the period's days after the deactivation, and
  never sooner than a day after the period was last set or changed. Setting or changing the period therefore moves no
  row and applies at once to everyone deactivated; one set too short by mistake brings nobody due within a day, so it
  can be set again first. Clearing it holds everyone until a period is set again. One audit row per change,
  `competence.retention_set` or `competence.retention_cleared`, with the period before and after and how many people
  are deactivated.
- **The sweep.** The server runs a sweep at boot and every hour after (the same guard that asks for the daily copy).
  Each round, one person at a time, each in a transaction of its own: it records the deactivations no row records (one
  from before this table, or one whose port failed), counted from when it finds them and only for an organisation with
  a period (`competence.leaver_recorded`); it cancels the row of anyone active again whose reactivation no row records
  (`competence.erasure_cancelled`, reason `active`); and it erases everyone due, the earliest first. An erasure re-reads
  the row under its lock and erases only if it is still that spell's and `inactive`, a period is set, it is due and the
  person is still deactivated. It erases what `scripts/competence-erase.ts` erases (holdings, copied rows included,
  requirements set on the person, their id on what they registered or decided for others, the approval cards of their
  registrations, and every card of Kompetens in their own stream with the occurrences the scan keeps for them), writes
  `competence.person_erased` with the actor `system:competence-retention`, the cause `retention`, the generation and
  counts only, and marks the row `erased`, in one transaction. So what is due is erased within the hour, two
  instances sweeping at once erase each person once, and a process that dies half way erases nothing; the next round
  does it. At most 2000 people per step and round; the rest wait for the next round. One case the sweep cannot see:
  a person erased, reactivated and deactivated again with both changes' ports failing and no round in between (the
  row still says `erased`); nothing of the new spell is erased then, until `scripts/competence-erase.ts` is run or the
  person is reactivated and deactivated again.
- **Logs.** A round that did anything writes an `info` line with scope `competence` and its counts ("the erasure sweep
  ran"). One erasure that fails writes a `warn` line with the database's error code and is asked for again at the next
  round. A round that leaves erasures due, by a failure or by the bound, or finds any due for more than a day, writes a
  `warn` line with the counts (`left`, `overdue`): an erasure more than a day overdue means the sweep is failing or no
  instance runs.
- **By hand**, `scripts/competence-erase.ts --person <id> --confirm` erases at once (cause `operator`) and marks the
  row `erased`.
- **Across a deployment** nothing needs doing. The erasures are rows and the sweep is code, not a sleeping workflow, so
  no erasure is stamped with an engine version and none is left pending under an old one: no `forkWorkflow` is needed
  for erasures. Whether Kompetens is switched on does not matter either: an erasure set by the period is made either
  way.

What stays after an erasure: the person's row in `auth_person` (D68), their memberships, positions and assignments as
the provisioner left them, the read log rows that hold their id (D121), the `competence_erasure` row (ids and times),
the subject of cards in other people's streams that name them (`scripts/subject-erase.ts` removes it), and the talks
domain (`scripts/talks-erase.ts`). **Audit rows written before the erasure keep what they recorded**: an audit row is
never changed, so `competence.holding_registered`, `competence.holding_submitted`, `competence.skill_rated`,
`competence.skill_validated` and the like still carry the person's id, the type's id, the days and the levels they
were written with.

To check: `select state, count(*) from competence_erasure where organisation_id = '<id>' group by state`, and the
script, which says how many wait, how many are overdue and when the next falls due.

## Reproduce the synthetic upgrade and restore rehearsal

Use only the disposable development/CI stack with `CLEW_POC=true`. The script refuses existing database names and requires a fixture marker before cleanup. It never restores over the application database.

```sh
docker exec -w /workspace clew-app-1 bun scripts/recovery-rehearsal.ts prepare
docker exec clew-postgres-1 sh -lc 'pg_dump -U clew -Fc clew_reliability_rehearsal -f /tmp/clew-rehearsal.dump && pg_restore -U clew -d clew_reliability_restored --exit-on-error /tmp/clew-rehearsal.dump'
docker exec -w /workspace clew-app-1 bun scripts/recovery-rehearsal.ts verify
docker exec -w /workspace clew-app-1 bun scripts/recovery-rehearsal.ts cleanup
docker exec clew-postgres-1 rm /tmp/clew-rehearsal.dump
```

The rehearsal starts at migration 0019 with synthetic legacy jobs and an invitation, upgrades through 0026, checks conservative ownership/follow-up, reruns migrations, dumps/restores into a second database and compares recorded evidence. It seeds at 0019 (`scripts/recovery-rehearsal.ts` keeps the journal entries up to index 19), so it never holds phone numbers or planning cards; the upgrade tests in `tests/db` cover those migrations (0053 and 0056, see [Migrations that write rows](#migrations-that-write-rows)). It passed locally on 2026-11-05. It proves this fixture's PostgreSQL upgrade/restore, not a coordinated production recovery or every data-loss boundary. [Reliability CI](../../.github/workflows/reliability.yml) runs the same lane in an isolated stack; a local pass is not a GitHub run.
