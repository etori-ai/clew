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
6. Confirm current ownership, engine launch, queue progress and authorized reads. A deployment sets `CLEW_RELEASE` and a stable `CLEW_EXECUTOR_ID` per instance (D85). After a deployment, list workflows still pending under an older version (`select workflow_uuid, application_version from dbos.workflow_status where status = 'PENDING' and application_version <> '<current>'`) and move them with `DBOS.forkWorkflow(id, 0, { applicationVersion })`; a workflow in `ERROR` is resumed with `DBOS.resumeWorkflow` once its cause is fixed. An executor whose heartbeat lapsed is adopted by a live instance within about two minutes; `clew_durable.executor` lists the live ones.

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

People, units and groups enter an installation only through `/scim/v2` (D68). An operator issues a provisioner its bearer token and revokes it with `bun scripts/provisioner-token.ts add <id> --organisation <organisationId> --label "<text>"` and `revoke <id>`, inside the app container; the token is printed once and Clew keeps only its digest (`auth_provisioner`). Run the provisioner at least daily: validity lives in the source, so a person's access ends when the push that drops their unit membership arrives, and a leaver's account must also be closed at the identity provider. A deleted user is deactivated, never erased, because audit rows and threads reference the person.

What to read when something is wrong. The audit table carries `scim.user.*` and `scim.group.*` (actor `provisioner:<id>`), `grant.derived` on the person with the unit, role and capabilities that resulted or `removed: true` when the person has no unit left, `capability-map.added`/`removed` on the group (actor the administrator), and `identity.bound`/`identity.conflict` on the person. The authentication log (`auth_audit`) carries `identity-bound`, `identity-unmatched` with the claim value as actor (which account tried and found no provisioned person) and `identity-conflict` (a provisioned person's subject changed; a person must review it, Clew never rebinds). A person who can sign in but reaches nothing has no `unit:` or `unit-manager:` membership: the provisioner's mapping, not Clew, decides that. A mapping row whose group the source removed stays and shows as such on Administration › Användare, where it can be removed.

Changing `OIDC_BINDING_CLAIM` after people have signed in changes nothing for them: bindings stand. It decides only how a subject not seen before finds its person.

## Changing the authorization fingerprint

`authorizationVersion` in `apps/server/src/auth-crypto.ts` is an HMAC over the authority in a person's access record and nothing else: enabled, organisation, unit, role, the sorted capabilities and the grant version (narrowed 2026-11-09 for [D68](../decisions/D68-people-are-pushed-into-clew-through-standard-scim.md); `tests/unit/authorization-version.test.ts` holds the list). A corrected name, a renamed unit label or a new column on the person or the grant leaves it unchanged, so directory updates do not stop work in flight.

Durable work stores the value and compares it exactly. When it differs, a queued execution or watch settles `blocked` with `authority-revoked`, a timer or follow-up policy pauses, and an answer retained in a thread is hidden until a fresh scan creates a new projection (D75). A change to the formula, to the field list or to `MASTER_KEY` therefore changes every stored value at once and reads as lost authority for everyone. Treat it as a release of its own: note the reliability counts before, deploy in a quiet window, expect blocked executions with that reason, let the nightly scan rebuild cards, and let the people concerned approve again. Do not roll back to a binary with the other formula; it would read the new values the same way. The narrowing of 2026-11-09 is itself such a change on the first deployment that carries it. This is reasoned from the code paths named; it has not been rehearsed against a populated installation.

The nightly scan runs for enabled people with a grant and an identity binding (`granted()` in `apps/server/src/scheduler/adapters/postgres.ts`, `tests/db/scheduler-people.test.ts`). A person pushed in through provisioning who has never signed in is not scanned.

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
