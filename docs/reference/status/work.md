# Implementation status: work, decisions and durable execution

One page of [implementation status](../status.md). Each entry says what works in this checkout, what limits it or is still to do, and where the code and tests that show it are.

## Approved writes

**Works in this checkout.** Generic card decisions and calendar create/move/cancel/confirm/undo use encrypted intent, transactional audit/card projection and workflow start (D86), read-back and linked compensation. Calendar API writes require a stable `decisionId` and return a pending card.

**Limits and pending work.** Real-system pilot choice, live CalDAV regression of the new path and the full process-death matrix remain open. Unknown effects are not blindly replayed.

**Evidence.** [Card decisions](../../../apps/server/src/threads/usecases/decisions.ts), [calendar decisions](../../../apps/server/src/modules/calendar/usecases/decisions.ts), [D45](../../decisions/D45-approved-intent-precedes-source-dispatch.md), [database proof](../../../tests/db/postgres-calendar-decisions.test.ts)

## Jobs across systems

**Works in this checkout.** A connector declares the facts it creates (`facts`, `creates`) and the proposals that follow a fact kind (`follows`, taking a `FactEnvelope`, returning a `FollowResponse` whose steps name the follower's own connector); an administrator binds followers to a kind in the database (default deny); Clew assembles one job proposal by fan-out, names every bound system's outcome, and approves it once: one execution row per execute step, a bounded watch per watch step with its timer intent (`watch_intent`), undo-all as one linked compensation per step, all in one transaction with audit and the workflow starts (D86). One `jobWatch` workflow per watch step starts with that commit; it waits for each committed check, calls the fenced `observe` activity (read as the person, `seen` ends the watch, a revoked authority leaves it `blocked`), and at the window's end settles `expired`, which leaves one card for the person through the stream's attention admission.

**Limits and pending work.** Thin routes only (`POST /api/jobs/assemble`, `POST /api/jobs`, `GET /api/jobs/:id`): no card UI, panel step list or administration page for bindings; the job and its watches exist as ledger rows, audit, the API's view and the expired watch's generic pushed card. Bindings are made with `bun scripts/job-bind.ts` (or `--fixtures` for the development fixture offer) until the admin page has them. The independent fixture connectors declare the offer (`hr:absence`; `hr.proposeAbsence`, `timesheet.followAbsence`, `payroll.followAbsence`): payroll reads HR's authenticated HTTP feed and exposes reports dated before today, so a report made today is watched until the window ends. A watch is approved once and never replaced (generation 1); there is no cancel of a running watch. Fact-kind drift is judged at assembly (degraded bindings named in the proposal), not yet on the administration page. The full composer/pushed entry paths and receipt-driven facts assembling the next proposal remain planned; `creates` does not automatically start another job. See [planned continuation](../../architecture/working-across-connectors.md#planned-continuation-after-a-result). [D77](../../decisions/D77-job-approvals-preserve-intent-bindings-and-receipt-authority.md) closes the reproduced approval/read gaps: retries retain the original watch schedule, approval rechecks current binding revisions and per-binding limits, and receipt paths require the original unit/authorization version plus current capability access. Clients echo step `binding` and source `bindingRevision` from assembly; old unapproved proposals need reassembly. Immutable server-side reviewed proposals and creator-schema validation of facts remain unimplemented.

**Evidence.** [Jobs module](../../../apps/server/src/modules/jobs), [ledger](../../../apps/server/src/modules/executions/usecases.ts), [workflow](../../../apps/server/src/dbos/workflows.ts), [scenario test](../../../tests/unit/job-executions.test.ts), [fixture scenario](../../../tests/unit/fixture-job.test.ts), [end-to-end check](../../../scripts/jobs-check.ts), [store contract](../../../tests/execution-store-contract.ts), [runtime proof](../../../apps/server/tests/watch-runtime.test.ts), [D55](../../decisions/D55-a-job-is-assembled-from-what-connectors-follow-approved-once-and-run-per-system.md)

## Scan occurrence lifecycle

**Works in this checkout.** Persisted source key/assignment/period/revision, local dismissal, source-isolated coalesced refresh, stale-result fencing and authoritative completion. Partial/unavailable scans cannot infer completion by absence. Source cards retain their original person/grant version; transfers and renewed grants cannot read old snapshots. Fresh scans create separate authorized projections.

**Limits and pending work.** Legacy source cards without provenance are hidden after migration 0034; source-only ACL changes need a revocation path into Clew before persisted scans are enabled ([D75](../../decisions/D75-source-snapshots-retain-the-authority-that-produced-them.md)). Legacy topic-only scans stay conservative. Calendar's demonstration planner keeps its own proposal lifecycle.

**Evidence.** [Refresh](../../../apps/server/src/threads/usecases/refresh.ts), [tests](../../../tests/unit/refresh.test.ts), [D47](../../decisions/D47-occurrences-timers-and-attention-have-durable-identities.md)

## Timers

**Works in this checkout.** Transactional absolute timer intents, generations, cancellation and current-authority checks; every intent starts its workflow inside the transaction that commits it (D86: `dbos.enqueue_workflow` on the ledger's own connection, no outbox loop). The durable engine (DBOS Transact in the server process, D85) owns new and queued legacy jobs. A job's watch step is a bounded conditional watch: committed absolute checks and an end, read as the person, settled in the ledger (see Jobs across systems).

**Limits and pending work.** Legacy running jobs require operator drain evidence. The watch is the one conditional timer: no general "tell me when X" outside a job, no cancel of a running watch; a live delivery deadline is not established. The retired outbox tables and columns remain as evidence until a later schema change drops them.

**Evidence.** [Workflows](../../../apps/server/src/dbos/workflows.ts), [D85](../../decisions/D85-dbos-transact-replaces-temporal-as-the-durable-engine.md), [D86](../../decisions/D86-the-ledger-starts-its-workflow-inside-its-own-transaction.md), [runtime proof](../../../apps/server/tests/timer-runtime.test.ts), [watch runtime proof](../../../apps/server/tests/watch-runtime.test.ts), [rollback proof](../../../tests/db/postgres-store.test.ts), [operations](../../maintainers/reliability-operations.md)

## Review recovery and completion

**Works in this checkout.** Submitted reviews remain openable from the card and Klart after undo expires. Optional connector-declared text corrections use the human execution ledger and reload the reviewed version only after confirmed success; a source link is the fallback. A deterministic new card retries rejected rows only, preserving the original receipt and confirmed writes. Unknown outcomes require reconciliation. Shared completion feedback covers reviews, receipts and successful saves; undo errors remain visible and status checking retains its controls.

**Limits and pending work.** Corrections currently support up to 12 bounded text fields, not arbitrary forms. The finance fixture demonstrates missing-order rejection, correction and retry; its source URL is a placeholder. Current documents are shown beside the original receipt, not an archived copy of the submitted bytes.

**Evidence.** [D80](../../decisions/D80-recover-rejected-rows-without-replaying-confirmed-writes.md), [recovery guide](../../guides/document-and-semantic-views.md#reopen-correct-and-retry), [browser scenarios](../../../tests/a11y/documents.spec.ts), [retry scenarios](../../../tests/unit/threads.test.ts)

## Becoming done

**Works in this checkout.** When a receipt arrives the row keeps its place for 2,5 s in its receipt state (the check, the headline, Ångra), then goes to Klart, and a toast with Visa and Ångra says so; a connector may mark an execute `review: 'each'` with a `preview` read, and the card's next step `Granska N` then leads to `/cards/:threadId/review?step=`, the review as a drawer over Hem with the card beside the column (on a phone a tall sheet stacked over the card's sheet), one item at a time beside its document, writing once at the end and leading back to the card on Hem with the receipt, or with the decisions as the card's selection on ✕, Esc or the scrim; a done card stays in the panel while it can be undone, with Nästa som behöver dig. The finance fixture now provides original PDF invoices, DOCX agreements and XLSX specifications through the versioned document reader; the legacy SVG preview remains available.

**Limits and pending work.** The review's decisions live in the drawer until it leads back: a reload of the review starts its decisions over (the step is kept). The drawer's ✕ is named "Stäng" (Astryx's own name), not "Stäng, Esc". On a phone each step focuses its document heading; required documents must render before approval is enabled. The rail's count changes at once, not after the pause. Not verified with a screen reader.

**Evidence.** [D70](../../decisions/D70-one-press-confirms-on-the-row-and-rows-with-a-document-are-reviewed-one-at-a-time.md), [D73](../../decisions/D73-the-review-is-a-page-in-the-shell-with-an-address.md), [unit evidence](../../../tests/unit/web-linger.test.ts), [browser evidence](../../../tests/a11y/review.spec.ts)

## Card actions in the browser

**Works in this checkout.** Avfärda, Inte nu, Ta upp nu and Ångra draw their outcome before the server answers and roll back with an error toast if it refuses; an execute action keeps its button loading until the decision has come to rest or four seconds have passed; a change notice waits for the person's own request.

**Limits and pending work.** The proposal card and Påminn mig keep the earlier presentation. Not verified with a screen reader.

**Evidence.** [D64](../../decisions/D64-a-card-shows-the-persons-own-action-at-once.md), [unit evidence](../../../tests/unit/web-optimistic.test.ts), [browser evidence](../../../tests/a11y/optimistic.spec.ts)

## Browser updates

**Works in this checkout.** Authenticated SSE invalidates the query cache using committed revisions; authorization changes clear retained state. Persisted attention budget/bundles and batch claims prevent repeated announcements across tabs.

**Limits and pending work.** At-most-once announcement can be lost after claim; the card remains. No push/email or live delivery SLO.

**Evidence.** [D46](../../decisions/D46-browser-updates-use-committed-revisions.md), [revision contract](../../../tests/db/postgres-changes.test.ts), [browser evidence](../../../tests/a11y/reliability.spec.ts)
