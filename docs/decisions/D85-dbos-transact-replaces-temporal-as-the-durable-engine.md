# D85 · DBOS Transact replaces Temporal as the durable engine

**Status:** accepted, implemented; the in-transaction start it names as the next step is D86 (2026-11-09); item 2 amended 2026-11-13 in the fixes of the review of users and the organisation: a server's start takes over the last and the next night of the scan and of the sign-in clean-up when a deployment left them waiting under the replaced version, and an operator moves the rest with `scripts/workflows-move.ts` from where each workflow's records end, instead of forking it · **Date:** 2026-11-09 · **Area:** platform

**Amended 2026-11-13.** A review of the fixes of the
[review of users and the organisation](../reviews/2026-11-12-users-the-organisation-and-the-guides-in-two-rounds.md)
found that a deployment stopped the nightly jobs for good. A deployment that changes the application version, which is
every release once `CLEW_RELEASE` is set and otherwise one that changes the workflow code or the engine, leaves the
`scheduledJob` workflow of the next night's scan and sign-in clean-up
([D123](D123-clew-empties-expired-sign-in-data-itself-and-a-leavers-retention-is-the-organisations-decision.md)) waiting
under the replaced version, where no process of the new one recovers it, and the last night's too when the deployment's
downtime spans its time. Only a night's run schedules the night after it, and a start found that night already
scheduled, so neither job ran again until a server started on a later day or an operator moved the workflow, and nothing
logged it. Item 2 now has one exception. A server's start, once its engine has launched, schedules the next night of
both jobs and takes over the last and the next night of each whose workflow is `PENDING` or `ENQUEUED` under another
version, the later pages of the last night's scan that have not completed included: the workflow is cancelled and
rewound to its first step under its own id and the running version, on the ledger's queue (`DBOS.rewindWorkflow` in dbos-sdk 5.5.0; `moveToRunningVersion` in `dbos/start.ts`, `startNightly` and
`seedNightly` in `scheduler/usecases.ts`, `startJobs` in `composition/jobs.ts`). A last night taken over runs at once,
late, and one that ran is left as it is. A night that is `CANCELLED` under another version is such a take-over that was
stopped between its two calls, since nothing in Clew cancels a job's workflow otherwise, and the next start rewinds it
the same way. Starts and operator moves take a transaction-scoped advisory lock per application queue and workflow
before reading its status. A later start sees the earlier move's current state and leaves a waiting or finished
night alone. If it finds a nightly workflow `CANCELLED` under the running version, it resumes it on the ledger's
queue with every recorded step intact (`DBOS.resumeWorkflow`), rather than rewinding it. This recovers a cancellation
left by an interrupted overlapping start from before this repair. Only the scheduler's selected nightly jobs get
this recovery; an intentionally cancelled reminder or follow-up does not. After cancelling a waiting workflow, a
move reads its status again and rewinds only a confirmed cancellation, so a workflow that finished before the
cancel arrived is left finished. The lock holds one app-pool connection while the engine controls use their separate
pool; it is released on commit, rollback or process death. No engine call inside it uses a second app-pool connection.
The start logs
`nightly work taken over from the replaced release` with the job ids. Cancelling changes only the engine's records and
stops no process. A process of the older version that still sleeps on a night wakes at its time, finds the workflow
queued again rather than cancelled, and may claim the night and run it with its own code; only its record of the step
fails, since dbos-sdk 5.5.0 checks a step's owner when it records it. Starting a night again from its first step is safe
because a `scheduledJob` records nothing before its step but the clock and its wait, and its step runs the job by id
under the claim of the job's row, whose attempt fences a second run, the older process's included. Only these two jobs
are taken over at start because they alone form a chain, which one stranded night ends, and nobody would notice a
clean-up missing.

Every other workflow left under an older version is one piece of work, which an operator moves after the deployment,
once the processes of the older version have stopped, with `scripts/workflows-move.ts`
([operations runbook](../maintainers/reliability-operations.md#after-every-deployment)). The script lists what waits
under another version than the latest and, with `--confirm`, moves each the same way, cancelled and rewound under its
own id, which the ledger's row names (D86), but from its first step without a record rather than its first step: what
the workflow recorded stands, and the step it was in the middle of runs again, as when the engine recovers a workflow
after a crash. D47's rule that existing workflow functions remain replay compatible is what makes that safe, and the
engine refuses a replay whose recorded steps the code no longer calls in that order, which ends the workflow in `ERROR`
instead of running it wrong. From its first step a workflow would do again what it had recorded, such as a follow-up's
reminder or a watch's read, which nobody has shown safe for each. Named with `--workflow`, the script also starts a
workflow that ended in `ERROR` again from the step that failed, which `resumeWorkflow` does not do. A start does
neither, because it cannot know whether the processes of the older version have stopped: a workflow moved while one of
them still runs it runs in both, and only a night's job has a claim that fences that. A fork (`forkWorkflow`), as item 2
first said, is not used: its copy gets a new id, which the ledger's row does not name. The operations guide names
`CLEW_RELEASE` and `CLEW_EXECUTOR_ID` for the hosting team. Tests: in `apps/server/tests/job-runtime.test.ts` an
instance of one release takes both nights from the queue and is killed, and the same instance starts as the next release
after the clean-up's night has passed, its engine recovering nothing of the older version's. Its start takes both nights
over: the clean-up's, which an earlier start cancelled and was stopped before rewinding, and the scan's while another
start is moving it under the shared lock. The clean-up's night runs
at once and the scan's at its time, each once, each schedules the next night under the new release, and a further start
takes nothing over. Database-free `apps/server/tests/workflow-moves.test.ts` controls overlapping starts, interrupted
moves, current-version cancelled recovery and completion before cancellation. `apps/server/tests/move-runtime.test.ts`
runs the script on two workflows that a killed instance of
the older release left: it lists them and moves them, and each runs once under the next release from its first step
without a record; it refuses a finished one, and starts an approved execution that ended in `ERROR` again from the step
that failed.

**Decision.** [DBOS Transact](https://github.com/dbos-inc/dbos-transact-ts) (MIT, `@dbos-inc/dbos-sdk` 5.4.0) is Clew's engine for durable workflows and timers, in place of Temporal (D17). It runs inside the BFF process and checkpoints to Clew's own PostgreSQL database, in the schema `dbos`; there is no separate service, no second database and no UI container. The seven workflows live in `apps/server/src/dbos/workflows.ts`: `scheduledJob`, `mcpWatch`, `durableReminder`, `approvedExecution`, `jobWatch` and `obligation` as before, and no legacy `reminder` function, because no Temporal history exists to replay. Their steps call use cases from the composition root through named activities bound in `dbos/activities.ts`; the runtime tests bind their own. `dbos/runtime.ts` launches the engine, `dbos/start.ts` starts a workflow under a stable id or meets the one already there, and `dbos/timers.ts`, `dbos/executions.ts` and `dbos/obligations.ts` are the delivery adapters behind the outboxes and the `ObligationTimers` port. Routes, use cases and modules never import the engine; the dependency rules name `apps/server/src/dbos/` where they named `temporal/`.

Three duties that Temporal carried become Clew's, each with its implementation:

1. **Executor identity and takeover.** DBOS recovers a crashed executor's running workflows only when an executor with the same id starts again. Every instance has a stable executor id (`CLEW_EXECUTOR_ID`, default the host name) and writes a heartbeat to `clew_durable.executor` every ten seconds. Every thirty seconds each instance claims the heartbeats older than ninety seconds, one claimant per row, and adopts those executors' workflows through the engine's recovery routine (`dbos/heartbeat.ts`), which re-enqueues them to run here or on a peer. The routine is not exported by the package; it is reached beside the package's entry point and covered by the timer runtime test, so a change in the SDK surfaces there.
2. **Version discipline.** A workflow is tagged with the application version that started it and is recovered only by executors of that version. The version is `CLEW_RELEASE` when a deployment sets it, otherwise DBOS's hash of the workflow source. Only the latest registered version dequeues and recovers, and "latest" is by registration time, so the version that launches promotes itself. A workflow left under an older version is moved by an operator, since 2026-11-13 with `scripts/workflows-move.ts`, which cancels it and rewinds it under its own id from its first step without a record (amended 2026-11-13, above; first written as `DBOS.forkWorkflow(id, 0, { applicationVersion })`, whose copy has a new id that the ledger's row does not name); `resumeWorkflow` does not change its version, and changes nothing for a workflow that has ended. D47's rule that workflow functions stay replay compatible stands.
3. **Waiting cheaply.** Waits are `DBOS.sleep` to an absolute time, which is an in-process timer with no database traffic until it fires; cancellation is `DBOS.cancelWorkflow`, which ends the wait. `DBOS.recv` is not used for waiting because it polls. Workflows are started directly, never on a queue with a concurrency limit, because a sleeping workflow holds its slot.

What does not change: PostgreSQL owns intent, evidence and audit (D45, D47); the outboxes still deliver committed ids to the engine and retry with backoff (until [D86](D86-the-ledger-starts-its-workflow-inside-its-own-transaction.md), the same day); generations still fence every old workflow; a workflow id is still the intent's id and generation. The `job.status` value `temporal` keeps its name until the next schema change; it means "owned by the durable engine".

**Why.** The product owner asked whether DBOS could replace Temporal and chose a spike over a write-up ([review](../reviews/2026-11-09-dbos-spike-durable-reminders.md)). The spike carried the D47 contract through SIGKILL, restart, replacement and code changes: fire once, cancel, replace, stale generation, and 1.8 ms median to commit an intent row together with its workflow start. Two things Temporal cannot give Clew are real: one component fewer for every municipality that self-hosts (D14, the open-source line in `CLAUDE.md`), and a workflow start that can run inside the ledger's own transaction through `dbos.enqueue_workflow`. The project is pre-release with seven workflows and no production history, so the switch costs a day; after a release it would cost a migration.

**Consequences.**

- The devcontainer loses the `temporal` and `temporal-ui` services and the port 3023 UI. Inspection is SQL over `dbos.workflow_status` and `dbos.operation_outputs`, `DBOS.listWorkflows`, and the reliability endpoint; the [operations runbook](../maintainers/reliability-operations.md) has the queries.
- The durability lane (`bun run test:durability`) runs the engine under a test application name in the same database, including a second process that is SIGKILLed while a reminder waits, whose workflow the test claims and adopts and which fires exactly once. The Temporal history replay fixture is gone; the equivalent proof is recovery of a pending workflow after process death.
- Backup and restore cover one database: the `dbos` and `clew_durable` schemas travel with the ledger. Restoring an older database also restores older workflow state; the runbook's reconciliation rules apply unchanged.
- The system database must allow `LISTEN/NOTIFY`: no connection pooler in transaction mode in front of it.
- Not done here, and the next step on this path: starting the workflow inside the ledger transaction (`dbos.enqueue_workflow` in the store adapters), which would retire the three outbox loops. Done in [D86](D86-the-ledger-starts-its-workflow-inside-its-own-transaction.md).

**Amends.** D15 (the scheduler's engine is DBOS, not Temporal), D17 (superseded: the engine, the worker and the legacy `reminder` function), D45 and D47 (every "Temporal" in their text reads "the durable engine", with recovery and versioning as above). The remaining decisions that mention Temporal are historical records and stay as written.
