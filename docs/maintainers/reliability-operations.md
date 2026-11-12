# Reliability operations and recovery

Current mechanism: [D47](../decisions/D47-occurrences-timers-and-attention-have-durable-identities.md), the engine of [D85](../decisions/D85-dbos-transact-replaces-temporal-as-the-durable-engine.md) and the in-transaction start of [D86](../decisions/D86-the-ledger-starts-its-workflow-inside-its-own-transaction.md). Evidence and remaining gates: [acceptance matrix](../reference/reliability-acceptance.md). These procedures describe the development/reference stack; an operator must establish production recovery objectives and source-specific procedures before a pilot.

## Inspect without exposing source data

`GET /api/admin/reliability` requires current authorization and `admin.connectors`. The local operator CLI reports the same aggregate counts:

```sh
docker exec -w /workspace clew-app-1 bun scripts/reliability-status.ts
```

Inspect pending/running execution count and oldest age, unknown executions, approval workflows still waiting in the engine's queue (`undeliveredExecutions`, `oldestOutboxSeconds`: rows `ENQUEUED` for more than thirty seconds, which means no instance of the application is dequeuing), reminder workflows waiting the same way (`queuedTimers`), overdue/blocked timers, stale refresh requests, blocked follow-up policies and legacy jobs awaiting drain. These aggregates contain no person names, source titles, credentials or payloads. The current diagnostic cutoffs are 30 seconds overdue for timers and five minutes without source refresh; they are not agreed service levels. A source that is intentionally idle can count as stale. Use the detailed records under operator access to interpret the count.

When an outcome is unknown, inspect the execution's original operation ID and source evidence. Use the existing status/reconciliation path; do not create another approval or change the ID to clear the warning. Read-back can preserve known successful items while leaving the remainder uncertain. Access removal can block further reconciliation: preserve evidence and escalate to the accountable operator instead of impersonating the former actor.

## Upgrade from the previous scheduler

1. Back up PostgreSQL, encrypted-data master keys and signing-key material. Record the application revision; the engine's state (the `dbos` and `clew_durable` schemas) is in the same backup. Preserve source operation records for their documented retention period.
2. Stop old application/worker owners before migrating. Do not run the old polling job loop beside the engine. Run `bun run db:init` inside the app container, which applies Clew's migrations and creates or migrates the engine's `dbos` schema (D86: the store adapters call `dbos.enqueue_workflow` inside their transactions, so the schema must exist before the first write), then deploy the application; the engine runs inside it.
3. Migrations 0020–0026 add timer generations, follow-up policies, refresh/occurrence records, attention delivery and job ownership. Queued/failed legacy jobs become `temporal` (the value names the durable engine's ownership and predates D85); legacy `running` jobs become `legacy-running`. Old `due` inserts are redirected to the new owner by a database trigger. Neither that trigger nor a lease can stop an old process which already began an external effect.
4. Inspect each `legacy-running` record and its original process/workflow/source evidence. After proving the old owner is stopped, decide whether it completed, remains uncertain or can safely be adopted. Record that decision in the same transaction as any ownership change. There is deliberately no blanket automatic requeue command.
5. Existing invitations without a bounded approval become visible with `legacy-unverified` follow-up policies. They keep their counters and source invitations; automatic follow-up stays paused. Old topic-only work retains an unverified occurrence marker, never inferred source completion.
6. Confirm current ownership, engine launch, queue progress and authorized reads. A deployment sets `CLEW_RELEASE` and a stable `CLEW_EXECUTOR_ID` per instance (D85). After a deployment, list workflows still pending under an older version (`select workflow_uuid, application_version from dbos.workflow_status where status = 'PENDING' and application_version <> '<current>'`) and move them with `DBOS.forkWorkflow(id, 0, { applicationVersion })`; a workflow in `ERROR` is resumed with `DBOS.resumeWorkflow` once its cause is fixed. An executor whose heartbeat lapsed is adopted by a live instance within about two minutes; `clew_durable.executor` lists the live ones. With `OTEL_EXPORTER_OTLP_ENDPOINT` set (D91, [observability](../architecture/observability.md)) the engine's workflow and step spans, the request that started them and the model's steps are one trace: a turn's audit row carries `details.modelCall.traceId` and every log line carries `trace_id`, so the trace behind a failure is found in the backend from the row or the line.

## The ledger queue

Since D86 a workflow is started by the transaction that commits its intent: `select dbos.enqueue_workflow(...)` on the same connection, into the application's ledger queue (`clew.ledger` for the application the server launches as; queue names are unique across the applications sharing a system database, so a test engine has its own). There is no outbox to retry and no loop to restart. What to check instead:

- Rows waiting for an executor: `select workflow_uuid, name, created_at from dbos.workflow_status where application_name = 'clew' and status = 'ENQUEUED' order by created_at`. A row older than a few seconds while an instance runs means the queue runner is not dequeuing: confirm the instance's version is the latest registered one (D85), since only the latest version dequeues, and that the queue exists (`select * from dbos.queues where name = 'clew.ledger'`). A row committed while no instance ran is dequeued by the next launch.
- A workflow that does not exist for a committed intent (a `timer_intent`, `execution`, `watch_intent` or `job` row without its `workflow_status` row under the id in D86) cannot happen through the stores: both are one transaction. If restored data shows it, the ledger is older than the engine's state or the reverse; follow the restore rules below rather than enqueueing by hand.
- The retired outbox tables (`dispatch_outbox`, the delivery columns of `timer_intent`, `watch_intent` and `job`) are evidence only; nothing reads or writes them for new rows. `watch_intent.delivered_at` is the approval's commit.

Roll forward to repair operational problems. A rollback must preserve executions, stable IDs, uncertainty, timer generations, audit and authorization fixes; an old application binary is not automatically safe against this schema.

## Restore safely

Restore into an isolated database first, with every application instance stopped: the engine runs inside it. Restore the matching encryption keys; ciphertext alone is not recoverable evidence. Reconcile PostgreSQL (the engine's schemas included) and the source against the same recovery point before enabling dispatch. An older database can forget an effect which the source already committed. Starting dispatch against that database can duplicate it after a source's operation-retention window expires.

Verify execution IDs/results, timer generations and cancellations, job ownership, follow-up counters, occurrence dispositions, audit and authority. Resolve uncertain effects by source read-back or a documented manual process. Keep unresolved cards visible. Only enable workers after the operator has approved reconciliation and confirmed old owners cannot act. Restoring engine state older than the ledger re-runs workflows the ledger already settled; the generation and ledger fences make them no-ops, which the rehearsal should show. An actual source's retention/recovery procedure remains pilot acceptance work.

## Provisioning

People, units and groups enter an installation only through `/scim/v2` (D68). An administrator with `admin.users` adds a provisioner, replaces its key and takes it back on Administration › Användare, under "Inläsning från katalogen" ([D107](../decisions/D107-an-administrator-issues-replaces-and-takes-back-a-provisioners-key-on-the-users-page.md)): the key is shown once, a replaced key answers for a day, a week or not at all, and each of the three writes its audit row with the administrator as the actor. The first key of an installation still comes from the script, since nobody holds `admin.users` before a provisioner has pushed the group that gives it. An operator issues a provisioner its bearer token and revokes it with `bun scripts/provisioner-token.ts add <id> --organisation <organisationId> --label "<text>"` and `revoke <id>`, inside the app container; the token is printed once and Clew keeps only its digest (`auth_provisioner`). `list` shows every provisioner with its state, when its token was issued and when it last called. To rotate a token, run `rotate <id>`: it prints a new token and lets the old one answer for 24 hours (`--grace-hours <n>`, 0 to end it at once), so the new one is handed to the provisioner's team and put in place within the grace period without a push failing; the old digest stops matching when the period ends, and `provisioner.rotated` in the audit says when. One old token is kept: a second rotation inside the grace period ends the first one's old token at once, and the script prints a note when it does. Tokens do not expire by themselves; rotate on the installation's own schedule and whenever a token may have been seen by someone it was not for. The provisioner sends a change when it happens and reconciles the whole source at least daily ([D109](../decisions/D109-a-provisioner-sends-a-change-when-it-happens-and-reconciles-the-whole-source-daily.md)): validity lives in the source, so a person's access ends when the change that drops their unit membership arrives, and a leaver's account must also be closed at the identity provider. A deleted user is deactivated, never erased, because audit rows and threads reference the person.

Whether pushes still arrive. Clew records when each provisioner last authenticated (`auth_provisioner.last_seen_at`, written at most once a minute) and Administration › Användare shows it under "Inläsning från katalogen", with a warning when a provisioner has been silent for two days or has never called. A run that begins after half an hour of silence writes one `provisioner.seen` audit row with the previous time, so a push that changed nothing still leaves a trace and the audit lists the runs. A silent provisioner is the installation's to alarm on: access a person lost in the source ends in Clew only when the push arrives. `CLEW_PROVISIONER_TOKEN=<token> bun scripts/provisioner-check.ts <url>/scim/v2` reads what the installation holds and names the active users without a unit, the managed units without a name, the empty unit groups and the keys written wrong; it changes nothing, and it counts as a call from the token it uses.

What to read when something is wrong. An unexpected failure of a SCIM request is a 500 to the client and one `error` line with scope `scim` in the server log, with the trace id when tracing is on. A 400 `invalidValue` that names a key is [D96](../decisions/D96-a-key-written-wrong-is-refused-at-the-scim-boundary.md) or D93: the provisioner's mapping wrote a key wrong. The audit table carries `scim.user.*` and `scim.group.*` (actor `provisioner:<id>`), `grant.derived` on the person with the unit, role and capabilities that resulted or `removed: true` when the person has no unit left, `positions.derived` on the person with the codes of the positions they now hold (D108 item 5), `group-capability.added`/`removed` on the group (actor the administrator), and `identity.bound`/`identity.conflict` on the person. The authentication log (`auth_audit`) carries `identity-bound`, `identity-unmatched` with the claim value as actor (which account tried and found no provisioned person) and `identity-conflict` (a provisioned person's subject changed; a person must review it, Clew never rebinds). A person who can sign in but reaches nothing has no `unit:` or `unit-manager:` membership: the provisioner's mapping, not Clew, decides that. A mapping row whose group the source removed stays and shows as such on Administration › Användare, where it can be removed.

Changing `OIDC_BINDING_CLAIM` after people have signed in changes nothing for them: bindings stand. It decides only how a subject not seen before finds its person.

## Entities: lenses, columns and erasure

What sources say about a person or a unit ([D97](../decisions/D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md), [Entities](../architecture/entities.md)) is read live and never stored, so there is nothing of it to back up or restore. Three things are an operator's.

Migration 0045 adds `thread.subjects` and the table `thread_subject`, the index from entity to cards; `bun run db:init` applies it with the others. It fills nothing in: a card stored before it names nobody, and is indexed when its rows are next written.

Lenses and columns are chosen on Administration › Anslutna system, on the connector's page under "På Personal och andra listor", by a person with `admin.connectors`. They are stored in the connector's capability overrides, audited as `connector.lens` and `connector.column`, and take effect from the next read, without a restart. At most three columns per entity kind are accepted across every connector; the count is taken outside the saving transaction, so two administrators saving at once can pass it, and the list then shows the first three. Enabling or registering a connector places nothing. `bun run dev:connectors` makes the development stack's choice only while no lens or column is chosen anywhere.

To erase a person or a unit from every card in every stream, run inside the app container ([script](../../scripts/subject-erase.ts)):

```sh
docker exec -w /workspace clew-app-1 bun scripts/subject-erase.ts person <user name> --confirm
docker exec -w /workspace clew-app-1 bun scripts/subject-erase.ts person <user name> --person <person id> --confirm   # a user name the directory no longer has
docker exec -w /workspace clew-app-1 bun scripts/subject-erase.ts unit <unit id> --confirm
```

It removes the `subject` of every row that names the entity, the card's own `subjects` and the index rows in one transaction, and writes one `thread.subject_erased` audit row with the actor `operator:cli`, about `person:<person id>` or `unit:<id>`, holding counts only: the user name is never written to the audit trail. It cannot be undone, hence `--confirm`. The rows' text stays as the source wrote it, and a source that still names the person names them again on its next scan, so erase in the source too. Run `bun scripts/talks-erase.ts` as well to erase the person from the talks domain.

## Changing the authorization fingerprint

`authorizationVersion` in `apps/server/src/auth-crypto.ts` is an HMAC over the authority in a person's access record and nothing else: enabled, organisation, unit, role, the sorted capabilities and the grant version (narrowed 2026-11-09 for [D68](../decisions/D68-people-are-pushed-into-clew-through-standard-scim.md); `tests/unit/authorization-version.test.ts` holds the list). A corrected name, a renamed unit label or a new column on the person or the grant leaves it unchanged, so directory updates do not stop work in flight.

Durable work stores the value and compares it exactly. When it differs, a queued execution or watch settles `blocked` with `authority-revoked`, a timer or follow-up policy pauses, and an answer retained in a thread is hidden until a fresh scan creates a new projection (D75). A change to the formula, to the field list or to `MASTER_KEY` therefore changes every stored value at once and reads as lost authority for everyone. Treat it as a release of its own: note the reliability counts before, deploy in a quiet window, expect blocked executions with that reason, let the nightly scan rebuild cards, and let the people concerned approve again. Do not roll back to a binary with the other formula; it would read the new values the same way. The narrowing of 2026-11-09 is itself such a change on the first deployment that carries it. This is reasoned from the code paths named; it has not been rehearsed against a populated installation.

The nightly scan runs for enabled people with a grant and an identity binding (`granted()` in `apps/server/src/scheduler/adapters/postgres.ts`, `tests/db/scheduler-people.test.ts`). A person pushed in through provisioning who has never signed in is not scanned.

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

## Reproduce the synthetic upgrade and restore rehearsal

Use only the disposable development/CI stack with `CLEW_POC=true`. The script refuses existing database names and requires a fixture marker before cleanup. It never restores over the application database.

```sh
docker exec -w /workspace clew-app-1 bun scripts/recovery-rehearsal.ts prepare
docker exec clew-postgres-1 sh -lc 'pg_dump -U clew -Fc clew_reliability_rehearsal -f /tmp/clew-rehearsal.dump && pg_restore -U clew -d clew_reliability_restored --exit-on-error /tmp/clew-rehearsal.dump'
docker exec -w /workspace clew-app-1 bun scripts/recovery-rehearsal.ts verify
docker exec -w /workspace clew-app-1 bun scripts/recovery-rehearsal.ts cleanup
docker exec clew-postgres-1 rm /tmp/clew-rehearsal.dump
```

The rehearsal starts at migration 0019 with synthetic legacy jobs and an invitation, upgrades through 0026, checks conservative ownership/follow-up, reruns migrations, dumps/restores into a second database and compares recorded evidence. It passed locally on 2026-11-05. It proves this fixture's PostgreSQL upgrade/restore, not a coordinated production recovery or every data-loss boundary. [Reliability CI](../../.github/workflows/reliability.yml) runs the same lane in an isolated stack; a local pass is not a GitHub run.
