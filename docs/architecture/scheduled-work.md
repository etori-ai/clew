# Scheduled work

Current implementation: 2026-11-05, [D45](../decisions/D45-approved-intent-precedes-source-dispatch.md), [D46](../decisions/D46-browser-updates-use-committed-revisions.md) and [D47](../decisions/D47-occurrences-timers-and-attention-have-durable-identities.md). D15 records the historical Postgres-only scheduler rationale; D17 adopted Temporal. Node runs the server and worker. PostgreSQL owns business intent and evidence.

## Ownership and flow

| Work | Durable intent | Executor and safety boundary |
|---|---|---|
| Approved source write or compensation | Execution, encrypted input/result, audit, projection and outbox in one transaction | Temporal dispatches the exact approval; current authority, stable ID and read-back determine outcome |
| Reminder or snooze | Absolute due time, generation and desired state, committed with thread and audit | Generation-specific workflow; activity rejects stale/cancelled generations and rechecks authority |
| Calendar follow-up | Bounded policy plus obligation timer | Current invitation, actor/assignment and expiry checked before transactional cards/counters/audit |
| Job watch step ([D55](../decisions/D55-a-job-is-assembled-from-what-connectors-follow-approved-once-and-run-per-system.md)) | The step's absolute check times and window's end, committed with the job as a `watch_intent` outbox row | One `jobWatch` workflow per step waits for each check and calls `observe`, fenced by check index, step state and the ledger's clock; it rechecks authority and reads the step's own connector as the person, never an execute |
| Nightly scan, undo/receipt expiry, attention release | Natural-key job row | Temporal scheduledJob workflow; delivery/execution leases and attempt fences |
| Source refresh | Coalesced per-person/source/assignment request | Four workers, separate source deadlines, authority and projection-version fences |

A request succeeds when intent commits; it need not wait for Temporal or a source. A saved reminder can show queued status during an outage. Dispatch retries with bounded leases; acknowledgement cannot overwrite a newer generation or completed attempt. Workflows wait until absolute timestamps, so delayed delivery does not extend a requested duration.

Unknown writes remain unknown until evidence resolves them. A lost reply does not authorize replay. Calendar uses stable event UIDs, conditional revisions and per-item read-back; compensation requires an exact supported inverse of confirmed effects. This cannot promise arbitrary-source exactly-once behavior.

## Follow-up and old work

New calendar policies cap reminders at two per invitation, two working days apart and ending after 30 days. Policy is committed with approval; its first timer waits behind pending/uncertain execution before follow-up effects. Expiry still wins during uncertainty. Checks re-evaluate current authorization, assignment, invitation response, cancellation and members. A manual reminder consumes the same bound.

A job's watch step is the bounded conditional watch for a system Clew does not write in: at most three checks inside the follower's window, capped by the binding, and the window's end, all absolute and committed at approval. A late check is observed late, never repeated, and the window is never extended. `seen` ends the watch; a source that does not answer leaves it waiting for the next check; revoked or moved authority leaves it `blocked`; the window's end settles `expired` and, in the same commit, leaves one card for the person through the attention admission below ("Lönesystemet har inte visat det som bevakades"). A watch is approved once and never replaced, so its intent has one generation and the fence per fire is the check index; there is no cancel of a running watch.

Legacy invitations without such a policy are visibly paused. Old Temporal reminder/obligation functions remain compatible with recorded histories; legacy obligation callbacks cannot revive unbounded follow-up. Old running job owners become legacy-running until an operator establishes their outcome. See [upgrade and recovery](../maintainers/reliability-operations.md).

The application starts the Temporal dispatcher, not the old 15-second polling runner. The job table remains an outbox/evidence record. A trigger maps legacy due inserts to Temporal ownership, but deployment must stop already-running old workers before changing owners.

## Discovery and attention

Reads return persisted cards and request coalesced refresh. Failures affect the source's freshness, not availability of known work. Occurrences carry source identity/revision and local disposition; failed/partial snapshots cannot complete absent work. Calendar's synthetic planner keeps its separate proposal lifecycle.

Automatic attention commits with discovery and uses a Stockholm-day budget, five-minute coalescing, review/bundle windows and quiet hours. User reminders bypass the automatic budget. The signed-in shell claims persisted batches on every page; D46 SSE invalidates TanStack Query without browser polling.

A claim prevents repeated announcements across tabs/reconnects, but the winning tab can die before rendering. The card and reminder bell remain available. A revision or claim is not evidence a human saw the work. Push/email, conditional watches outside a job and a production latency SLO are not implemented.

## Evidence

[Timer runtime tests](../../apps/server/tests/timer-runtime.test.ts) use PostgreSQL, Temporal and production Node, including replay of a fixture copied from the prior workflow implementation. [Execution runtime tests](../../apps/server/tests/execution-runtime.test.ts) use an independent SQLite-backed fault source. [Watch runtime tests](../../apps/server/tests/watch-runtime.test.ts) run two watch steps through the outbox and real `jobWatch` workflows: delivery recovers an outage, one is seen on its second check, the other reads three times and leaves exactly one card at its end, and a lost acknowledgement redelivers without a second card. Memory/PostgreSQL contracts cover rollback, ownership, bounded follow-up and occurrence/attention behavior. Browser fixtures cover no-click invalidation and cross-tab claims.

The [acceptance matrix](../reference/reliability-acceptance.md) records the remaining real-source, process-death and recovery gates. Scheduled work and permission decisions do not depend on a model.
