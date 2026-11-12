# Scheduled work

Current implementation: 2026-11-05, [D45](../decisions/D45-approved-intent-precedes-source-dispatch.md), [D46](../decisions/D46-browser-updates-use-committed-revisions.md) and [D47](../decisions/D47-occurrences-timers-and-attention-have-durable-identities.md). D15 records the historical Postgres-only scheduler rationale; D17 adopted Temporal and [D85](../decisions/D85-dbos-transact-replaces-temporal-as-the-durable-engine.md) replaced it with DBOS Transact inside the server. Node runs the server, and the engine with it. PostgreSQL owns business intent and evidence.

## Ownership and flow

| Work | Durable intent | Executor and safety boundary |
|---|---|---|
| Approved source write or compensation | Execution, encrypted input/result, audit, projection and the `approvedExecution` workflow start in one transaction | The workflow dispatches the exact approval; current authority, stable ID and read-back determine outcome |
| Reminder or snooze | Absolute due time, generation and desired state, committed with thread, audit and the `durableReminder` workflow start | Generation-specific workflow; activity rejects stale/cancelled generations and rechecks authority; a cancelled or replaced generation is cancelled after the commit, best effort |
| Calendar follow-up | Bounded policy plus obligation timer | Current invitation, actor/assignment and expiry checked before transactional cards/counters/audit |
| Job watch step ([D55](../decisions/D55-a-job-is-assembled-from-what-connectors-follow-approved-once-and-run-per-system.md)) | The step's absolute check times and window's end, committed with the job as a `watch_intent` row and its `jobWatch` workflow start | One `jobWatch` workflow per step waits for each check and calls `observe`, fenced by check index, step state and the ledger's clock; it rechecks authority and reads the step's own connector as the person, never an execute |
| Nightly scan, undo/receipt expiry, attention release | Natural-key job row and its `scheduledJob` workflow start, in one transaction | `scheduledJob` workflow; execution lease and attempt fences |
| Source refresh | Coalesced per-person/source/assignment request | Four workers, separate source deadlines, authority and projection-version fences |

A request succeeds when intent commits; it need not wait for a source. The workflow start is part of that commit (`dbos.enqueue_workflow` on the transaction's connection, D86): a rollback leaves no workflow, and a committed row waits in the application's ledger queue (`clew.ledger`) until an instance of the application dequeues it, about once a second while one runs, or when the next one launches. There is no outbox loop, no delivery lease and no queued state to show. Enqueueing is idempotent by workflow id, so a replayed approval meets the existing workflow. Workflows wait until absolute timestamps, so a late dequeue does not extend a requested duration.

Unknown writes remain unknown until evidence resolves them. A lost reply does not authorize replay. Calendar uses stable event UIDs, conditional revisions and per-item read-back; compensation requires an exact supported inverse of confirmed effects. This cannot promise arbitrary-source exactly-once behavior.

## Follow-up and old work

New calendar policies cap reminders at two per invitation, two working days apart and ending after 30 days. Policy is committed with approval; its first timer waits behind pending/uncertain execution before follow-up effects. Expiry still wins during uncertainty. Checks re-evaluate current authorization, assignment, invitation response, cancellation and members. A manual reminder consumes the same bound.

A job's watch step is the bounded conditional watch for a system Clew does not write in: at most three checks inside the follower's window, capped by the binding, and the window's end, all absolute and committed at approval. A late check is observed late, never repeated, and the window is never extended. `seen` ends the watch; a source that does not answer leaves it waiting for the next check; revoked or moved authority leaves it `blocked`; the window's end settles `expired` and, in the same commit, leaves one card for the person through the attention admission below ("Lönesystemet har inte visat det som bevakades"). A watch is approved once and never replaced, so its intent has one generation and the fence per fire is the check index; there is no cancel of a running watch.

Legacy invitations without such a policy are visibly paused. Workflow functions stay replay compatible within an application version (D85); legacy obligation callbacks cannot revive unbounded follow-up. Old running job owners become legacy-running until an operator establishes their outcome. See [upgrade and recovery](../maintainers/reliability-operations.md).

The application starts no polling runner at all: the nightly scan is scheduled at boot and every job row starts its workflow with its own insert. The job table remains the evidence record, with the retired outbox's delivery columns left in place (D86). A trigger maps legacy due inserts to the engine's ownership (the status value is still spelled `temporal`), but deployment must stop already-running old workers before changing owners.

## Discovery and attention

Reads return persisted cards and request coalesced refresh. Failures affect the source's freshness, not availability of known work. Occurrences carry source identity/revision and local disposition; failed/partial snapshots cannot complete absent work. Calendar's synthetic planner keeps its separate proposal lifecycle.

Automatic attention commits with discovery and uses a Stockholm-day budget, five-minute coalescing, review/bundle windows and quiet hours. A delivery deferred by quiet hours or the budget waits for its batch's `attention-release` job, scheduled through `scheduleJob` in the admitting transaction, so its `scheduledJob` workflow starts with the same commit (D86) and releases the batch at its time. User reminders bypass the automatic budget. The signed-in shell claims persisted batches on every page; D46 SSE invalidates TanStack Query without browser polling.

A claim prevents repeated announcements across tabs/reconnects, but the winning tab can die before rendering. The card and reminder bell remain available. A revision or claim is not evidence a human saw the work. Push/email, conditional watches outside a job and a production latency SLO are not implemented.

## Evidence

[Timer runtime tests](../../apps/server/tests/timer-runtime.test.ts) use PostgreSQL, the DBOS engine and production Node: a reminder committed before the engine launches waits in the queue and fires once it does, cancelled and replaced generations never surface, and a second instance is killed while a reminder waits, its workflow claimed, adopted and fired once. [Execution runtime tests](../../apps/server/tests/execution-runtime.test.ts) use an independent SQLite-backed fault source and replay the approval's start against the finished workflow. [Watch runtime tests](../../apps/server/tests/watch-runtime.test.ts) commit two watch steps with their `jobWatch` starts before the engine launches: one is seen on its second check, the other reads three times and leaves exactly one card at its end, and a replayed start adds no second card. The [attention runtime test](../../apps/server/tests/attention-runtime.test.ts) defers a card's delivery to the next morning: the release job's workflow commits with the admission, nothing announces the delivery before that workflow has run, and the workflow releases it once. [The Postgres store test](../../tests/db/postgres-store.test.ts) shows the workflow row committing and rolling back with the timer intent. Memory/PostgreSQL contracts cover rollback, ownership, bounded follow-up and occurrence/attention behavior. Browser fixtures cover no-click invalidation and cross-tab claims.

The [acceptance matrix](../reference/reliability-acceptance.md) records the remaining real-source, process-death and recovery gates. Scheduled work and permission decisions do not depend on a model.
