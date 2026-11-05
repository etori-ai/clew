# Reliability operations and recovery

Current mechanism: [D47](../decisions/D47-occurrences-timers-and-attention-have-durable-identities.md). Evidence and remaining gates: [acceptance matrix](../reference/reliability-acceptance.md). These procedures describe the development/reference stack; an operator must establish production recovery objectives and source-specific procedures before a pilot.

## Inspect without exposing source data

`GET /api/admin/reliability` requires current authorization and `admin.connectors`. The local operator CLI reports the same aggregate counts:

```sh
docker exec -w /workspace clew-app-1 bun scripts/reliability-status.ts
```

Inspect pending/running execution count and oldest age, unknown executions, undelivered execution outbox count/age, queued/overdue/blocked timers, stale refresh requests, blocked follow-up policies and legacy jobs awaiting drain. These aggregates contain no person names, source titles, credentials or payloads. The current diagnostic cutoffs are 30 seconds overdue for timers and five minutes without source refresh; they are not agreed service levels. A source that is intentionally idle can count as stale. Use the detailed records under operator access to interpret the count.

When an outcome is unknown, inspect the execution's original operation ID and source evidence. Use the existing status/reconciliation path; do not create another approval or change the ID to clear the warning. Read-back can preserve known successful items while leaving the remainder uncertain. Access removal can block further reconciliation: preserve evidence and escalate to the accountable operator instead of impersonating the former actor.

## Upgrade from the previous scheduler

1. Back up PostgreSQL, encrypted-data master keys and signing-key material. Record the application revision and compatible Temporal histories. Preserve source operation records for their documented retention period.
2. Stop old application/worker owners before migrating. Do not run the old polling job loop beside the new Temporal dispatcher. Run `bun run db:init` inside the app container, then deploy the compatible Node worker/application together.
3. Migrations 0020–0026 add timer generations, follow-up policies, refresh/occurrence records, attention delivery and job ownership. Queued/failed legacy jobs become `temporal`; legacy `running` jobs become `legacy-running`. Old `due` inserts are redirected to the new owner by a database trigger. Neither that trigger nor a lease can stop an old process which already began an external effect.
4. Inspect each `legacy-running` record and its original process/workflow/source evidence. After proving the old owner is stopped, decide whether it completed, remains uncertain or can safely be adopted. Record that decision in the same transaction as any ownership change. There is deliberately no blanket automatic requeue command.
5. Existing invitations without a bounded approval become visible with `legacy-unverified` follow-up policies. They keep their counters and source invitations; automatic follow-up stays paused. Old topic-only work retains an unverified occurrence marker, never inferred source completion.
6. Confirm current ownership, worker connectivity, outbox progress and authorized reads. Retain compatible `reminder` and `obligation` workflow functions while their histories exist. A PostgreSQL migration does not migrate Temporal history.

Roll forward to repair operational problems. A rollback must preserve executions, stable IDs, uncertainty, timer generations, audit and authorization fixes; an old application binary is not automatically safe against this schema.

## Restore safely

Restore into an isolated database first, with dispatchers and workers stopped. Restore the matching encryption keys; ciphertext alone is not recoverable evidence. Reconcile PostgreSQL, Temporal and the source against the same recovery point before enabling dispatch. An older database can forget an effect which the source already committed. Starting dispatch against that database can duplicate it after a source's operation-retention window expires.

Verify execution IDs/results, timer generations and cancellations, job ownership, follow-up counters, occurrence dispositions, audit and authority. Resolve uncertain effects by source read-back or a documented manual process. Keep unresolved cards visible. Only enable workers after the operator has approved reconciliation and confirmed old owners cannot act. Temporal backup/restore and an actual source's retention/recovery procedure remain pilot acceptance work.

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
