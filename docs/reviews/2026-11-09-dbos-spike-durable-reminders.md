# Spike: durable reminders on DBOS Transact instead of Temporal · 2026-11-09

The product owner asked whether [DBOS](https://www.dbos.dev/) could replace Temporal (D17) and, since Clew is pre-release and the switch is cheap now, for a spike that settles it early. This review records what the spike proved, what it did not, and a recommendation. The code is `spikes/dbos-reminders/` (outside the workspace, not product code); the summary lines of the runs quoted below are in its `results/` folder.

## What was compared

Clew's Temporal use is small in code and deep in design: about 300 lines in `apps/server/src/temporal/` with seven workflow functions (`reminder`, `durableReminder`, `obligation`, `scheduledJob`, `approvedExecution`, `jobWatch`, `mcpWatch`), a worker in the BFF process on one task queue, and the D45/D47 pattern around it: the ledger write commits in Postgres with an outbox row, the outbox starts the workflow, and generations fence delayed starts, cancellation and replacement.

DBOS Transact for TypeScript (`@dbos-inc/dbos-sdk` 5.4.0, MIT; dependencies `pg`, `yaml`, `commander`, `superjson`, `serialize-error`, all MIT or ISC) is a library with no server. Workflow state lives in tables in a `dbos` schema of a Postgres database the application names. Observability beyond SQL and the list/retrieve API is Conductor, a hosted control plane behind an enterprise package. Node 20 or later; the spike ran on Node 26.13 and PostgreSQL 17.11 in the devcontainer.

The spike ported `durableReminder` with the D47 contract (absolute due time, generation, cancel until it fires, never two deliveries) in two variants, both ending in the same fenced step that marks the intent fired once and logs every attempt:

- **recv variant**: waits in `DBOS.recv('cancel', { deadlineEpochMS })`. Cancel is a message. The application sends it with the PL/pgSQL function `dbos.send_message` inside the transaction that marks the intent cancelled or replaced.
- **sleep variant**: waits in `DBOS.sleep` and is cancelled from outside with `DBOS.cancelWorkflow` after the commit.

Both are started with `dbos.enqueue_workflow(...)` inside the transaction that writes the intent row. DBOS's system schema and the spike's tables share one database; that is what makes the two functions callable from the ledger's transaction.

## Results

Five scenarios, each run several times; the quoted run is `results/2026-11-09-run-4.txt` unless noted. "PASS" is an assertion; "observed" is a behaviour the scenario was built to expose.

**Contract (basic).** All six checks pass: a reminder fires exactly once; the sleep variant fires exactly once; a reminder already past due fires at once; a cancelled reminder never fires, in either variant; a replaced reminder fires only for generation 2, with no attempt for generation 1. Cancel ended the waiting workflow within 0.5 s in both variants, so `recv` returns on the message and `cancelWorkflow` does interrupt a durable sleep, although the documentation only promises preemption "at the beginning of its next step".

**Same-transaction start (atomic).** A rollback after `enqueue_workflow` leaves neither an intent row nor a workflow row. Twenty reminders committed and fired exactly once each.

| Measure (20 reminders, one instance) | Quiet host (run 4) | Host at load average 400 to 700 on 8 cores (run 3) |
|---|---|---|
| Commit latency, intent row plus enqueue, median / p95 | 1.8 ms / 2.6 ms | 80 ms / 794 ms |
| Fire skew after the due time, min / median / max | 0.02 / 0.04 / 0.05 s | 2.0 / 3.3 / 5.1 s |
| DBOS launch in the process | about 0.7 s | 4 to 16 s |

Dequeue is a poll, so a reminder that is already due when it is written fires about one to two seconds after the commit.

**Queue concurrency (concurrency).** On a queue registered with `workerConcurrency: 2`, four reminders due in four seconds ran two at a time: a sleeping reminder holds a concurrency slot for as long as it sleeps, and the second pair fired 1.7 s after the first (run 3, on the loaded host). A reminder queue must have no concurrency limit.

**Recovery with two instances (recovery).** Executors `a` and `b` on the same database, six reminders written through both, dequeued by whichever polled first.

1. SIGKILL of the owner of five reminders: the survivor's own reminder fired; the five stayed PENDING past their due time. Observed: an executor's running workflows are not taken over by a live peer.
2. Restart under the **same executor id**: on launch DBOS re-enqueued that executor's five PENDING workflows and they fired exactly once, about 20 s late. PASS.
3. Fresh pair, SIGKILL of the owner of three reminders, replacement under a **new executor id** `z`: the three stayed stranded past their due time. Observed: a replaced pod with a generated id never recovers its predecessor's work. The documented remedy is Conductor.
4. Takeover: `z` called the executor's internal `recoverPendingWorkflows(['a'])`, which re-enqueued the three and they fired exactly once. PASS. The method is on `DBOSExecutor`, which the package does not export; the spike reaches it through the file path. It is the open-source alternative to Conductor, and Clew would have to own the heartbeat that decides an executor is dead.

**Code change between runs (version).** DBOS tags every workflow with the application version, by default an MD5 of the registered workflows' source, and only recovers workflows of its own version.

1. A reminder PENDING under the hash version, process killed, restarted with one more workflow registered (a new hash): not recovered, not fired. `DBOS.resumeWorkflow` from the new version reported success but the workflow still did not run: it was re-enqueued under the old version, which no executor serves. `DBOS.forkWorkflow(id, 0, { applicationVersion: current })` ran it to completion and the fenced step fired exactly once. PASS.
2. Pinned version `DBOS__APPVERSION=1` on both sides of the same code change: recovered and fired exactly once. PASS.

A second rule surfaced on the way: only executors on the application's **latest registered version** dequeue, and "latest" is by registration time. In run 2 of the spike no reminder fired at all because a pinned version `1` had been registered after the hash versions; the log said `Current version '…' is not the latest version. Latest version is '1'.` The spike now promotes its own version on launch. In production this is the blue-green rule: a rollback to an older build stops dequeuing until that version is promoted with `setLatestApplicationVersion`.

**Internals that matter for a few thousand sleeping reminders** (read in the SDK, not measured): `DBOS.sleep` is an in-process timer in chunks, with no database traffic while it waits; `DBOS.recv` registers for a LISTEN/NOTIFY wakeup but also polls the notifications table every 10 s by default (`pollingIntervalMs`). Ten thousand reminders waiting in `recv` would be a thousand queries a second; the same reminders in `sleep` cost nothing until they fire. DBOS requires LISTEN/NOTIFY, so a connection pooler in transaction mode is out.

## What the spike did not cover

- The other six workflows. `obligation`, `jobWatch`, `approvedExecution` and `mcpWatch` are loops of activity, sleep and signal; nothing in the spike suggests a difference, but `continueAsNew` (used by `mcpWatch`) has no DBOS equivalent and a long-running loop stays one workflow with a growing step history.
- Load: thousands of sleeping workflows per process, memory, and dequeue behaviour with several instances polling one queue.
- Operations: backup and restore of the `dbos` schema together with the ledger (one database makes this simpler than today's two Temporal databases, but the runbook has not been rewritten), the reliability endpoint, and the loss of the Temporal UI on port 3023 in favour of SQL and `listWorkflows`.
- A real deployment: stable executor ids per instance, a heartbeat, and a tested takeover path.

## Comparison after the spike

| | Temporal (D17, today) | DBOS (spiked) |
|---|---|---|
| Components a municipality operates | Postgres, Temporal server, Temporal UI, two extra databases | Postgres |
| Starting and cancelling a timer | Outbox row, then client call; signal for cancel | One SQL function call each, inside the ledger's transaction |
| Exactly-once under SIGKILL | Holds (D47 generations) | Holds (same fence); proven in four kill scenarios |
| Recovery of a dead instance's workflows | Any worker on the task queue, automatically | Same executor id on restart, or a takeover the application triggers through an unexported method; Conductor otherwise |
| Code versioning | Replay compatibility, patching | Pin the version per build; only the latest version dequeues; old-version workflows are moved with `forkWorkflow` |
| UI | Temporal UI, open source | None in open source: SQL, `listWorkflows`, Clew's own operations endpoint |
| Latency of the commit that arms a timer | Outbox hop plus gRPC start | 1.8 ms median |
| Maturity | Years in production, large community | Five major versions in two years; internal API needed for takeover |

## Recommendation

The spike removes the technical doubt: DBOS carries Clew's timer contract, and the two things Temporal does not give us, a single component and a transactional start, are real and measured. The cost is that three operational concerns Temporal handles for us become Clew's to own, each with a clear answer:

1. **Executor identity and takeover.** Give every instance a stable executor id (its hostname or ordinal), keep a heartbeat row per executor in Clew's database, and let a live instance call the recovery method for an executor whose heartbeat has lapsed. Wrap the unexported method in one adapter file with a contract test, so an SDK change surfaces there.
2. **Version discipline.** Pin the application version to the build identifier, promote it on launch, and move any workflow left on an older version with `forkWorkflow` from the operations endpoint. Clew's workflows must stay replay compatible anyway (D47).
3. **Waiting cheaply.** Use `DBOS.sleep` with `cancelWorkflow` for timers, or `recv` with a long polling interval since cancels arrive by NOTIFY; never put a concurrency limit on a queue of sleeping workflows.

If the product owner accepts those three as Clew's responsibilities, the recommendation is to switch now, while there are seven workflows and no production state: port the seven workflows (`continueAsNew` loops become bounded loops), fold the outbox's "start the workflow" step into the ledger transaction through `enqueue_workflow`, remove the Temporal services from the devcontainer, and rewrite the reliability runbook for one database. That is a decision record of its own, amending D15, D17, D45 and D47, and a review of the result against D47's process-death matrix before it lands. If the owner would rather keep the operational maturity and the UI, Temporal stays and this review closes the question until the first self-hosting municipality asks for it.

## Outcome

The switch was made the same day: [D85](../decisions/D85-dbos-transact-replaces-temporal-as-the-durable-engine.md). The spike package `spikes/dbos-reminders` was removed from the repository on 2026-11-11; it is in the history up to commit `923968f`, with its two recorded runs under `results/`.
