# Reliability and authorization implementation plan

Date: 2026-11-05

Status: shared mechanisms implemented; reference-stack verification recorded, release evidence and selected-source pilot still open. Accepted mechanisms are recorded separately in D44–D47.

Baseline: revision `4696f6d` and the [architecture review](../reviews/2026-11-05-architecture-against-vision.md)

Pilot source: deliberately undecided, at the product owner's request

## Implementation checkpoint — 2026-11-05

- Phase 1: default-deny governance, shared authorized reads, protocol 2 signing/callback grants, key rotation, shared schema validation and generic execute rejection are implemented (D44). Startup initialization retries, while login remains available independently.
- Phases 2–3: encrypted execution intent, transactional approval/audit/outbox/card projection, Temporal dispatch, stable keys, read-back, explicit uncertainty and linked compensation cover generic card decisions and calendar create/move/cancel/confirm/undo. Bounded follow-up policies replace legacy unbounded callbacks. Known source evidence survives partial or uncertain compensation. Real PostgreSQL calendar tests exercise source success followed by a failed receipt commit; the independent reference source adds lost replies, restart and outbox redelivery.
- Phase 4: durable occurrence identity separates source completion from dismissal and recurrence. Coalesced refresh leases and per-source deadlines isolate failures; version fences protect intervening actions. Complete/exhausted observations and delta tombstones establish completion, while partial/unavailable/legacy scans cannot infer it. Unresolved cards remain independent of the history cap.
- Phase 5: absolute timer intents, generations, transactional cancellation, delivery retry, current-authority checks and blocked status are implemented. Temporal owns new/queued legacy jobs; old running owners require operator drain evidence. Persisted attention admission/bundles and delivery claims extend D46's SSE invalidation. Browser fixtures cover an untouched tab, two tabs, reconnect and navigation to the canonical card. Real workflow tests cover delayed start, cancellation, replacement, duplicate firing and replay of an old workflow history.
- Phase 6A: aggregate diagnostics, an isolated real-stack CI lane, conservative upgrade fixtures and a PostgreSQL backup/restore rehearsal are implemented. The rehearsal passed locally. Full process-death/DB-outage coverage across every write family, a live CalDAV regression of the converged path, coordinated Temporal/source recovery and a live due-to-browser latency measurement remain unproven. CI configuration is present; this checkpoint does not claim a GitHub run.
- Accessibility: affected new states have browser coverage; remaining baseline reflow issues and the manual screen-reader gate are tracked in the acceptance matrix. They are not waived by this checkpoint.

The [vision-to-acceptance matrix](../reference/reliability-acceptance.md) is the current evidence ledger; the phase descriptions below retain the approved exit criteria. Implementation of a mechanism does not close an unrun acceptance test. The pilot source remains open, and this is not production-ready.

## Objective and scope

Make Clew's central promises demonstrable: only authorized work is disclosed; a human-approved action survives retries and crashes without blindly repeating a source effect; unresolved work remains discoverable; source failures stay isolated; and committed reminders reach the person.

Keep the modular monolith, functional use cases and ports, PostgreSQL, independent connector services, Temporal, TanStack Query and Astryx. The model remains optional. This milestone adds missing state and enforcement within that architecture.

Start with a controlled reference connector and synthetic records. Migrate the existing calendar writes because leaving an alternate write path would preserve the reliability gap; that does **not** select calendar as the real-system pilot. Select the pilot later, after the shared mechanisms work.

The six phases below address F1–F6 first and incorporate the portions of F7–F11 needed to make those fixes hold. Defer additional connector families, a generic workflow designer, a broad identity-platform build, search indexing, a second messaging infrastructure, and unrelated interface redesigns.

## Sequence and reviewable increments

Each increment includes its contracts, persistence where needed, server behavior, affected UI and meaningful tests. Do not merge a new schema or worker as if it alone completed a phase.

| Phase | Reviewable increments | Depends on | Exit result |
|---|---|---|---|
| 1. Close authorization and invocation gaps | 1A startup and authorized reads; 1B connector identity and callback grants; 1C shared validation and bypass closure | None | Hidden work stays hidden; connectors cannot mint user authority |
| 2. Prove one durable action | 2A approved decision through source read-back; 2B crash recovery, uncertain outcome and compensation | 1 | One reference action is safe under concurrency and interruption |
| 3. Converge all existing writes | 3A card and standing actions; 3B calendar create/change/cancel and confirmation; 3C undo and follow-up writes | 2 | Every source write uses the same execution lifecycle |
| 4. Separate work from its presentation and refresh | 4A reference occurrence and isolated refresh; 4B migrate current scans, lists and counts | 1 and 2 | Dismissal, source completion and outages produce correct work state |
| 5. Make follow-up durable and visible | 5A timer intent, cancellation and job migration; 5B browser delivery and attention admission | 2 and 4; calendar integration also needs 3 | A committed reminder survives restart and reaches an active tab |
| 6. Prove readiness and run the selected pilot | 6A automated failure suite and operations rehearsal; 6B selected-source acceptance | 1–5 | Evidence supports a bounded real-source pilot |

Recommended delivery order is 1 → 2 → 3 → 4 → 5 → 6. Phases 3 and 4 can proceed independently after phase 2's contracts stabilize. Start the real-stack test harness in phase 2 and extend it throughout; phase 6 is the final gate, not the first integration test.

## Architecture to establish

Use a small set of explicit records rather than expanding the meaning of `Thread`.

| Concept | Owns | Essential constraint |
|---|---|---|
| Work occurrence | Source identity/revision, responsible assignment, observed status and local disposition | Stable identity across scans and thread dismissal; recurring periods are distinct |
| Approved decision and execution | Exact approved operation, input digest, source preconditions, actor/assignment, dispatch and per-item outcomes | One execution per approved intent; changed input cannot reuse that intent |
| Outbox intent | Delivery of a committed execution or timer instruction to Temporal | Written with state and audit in one physical PostgreSQL transaction |
| Timer intent | Absolute due time, generation, desired state and workflow acknowledgement | A cancelled or replaced generation can never surface work later |
| Delivery record | Why and when attention was admitted, bundled and presented | Work discovery does not itself consume attention; repeated delivery has a stable identity |

Threads continue to provide the familiar card and conversation UI. One card may group several occurrences; a topic label is not their identity. An execution can exist without a pushed thread, for example a booking started from a standing action.

PostgreSQL owns approved intent and user-visible business state. Temporal orchestrates dispatch, reconciliation and waits; it does not decide what the person approved. The outbox dispatcher only bridges committed intent into Temporal, with bounded leases, retry and observable failure. Do not build a second workflow engine in the outbox.

An execution's outcome is separate from delivery attempts. Model `pending`, `running`, `succeeded`, `partial`, `failed` and `unknown`, with blocked reasons such as revoked authority or a required session. Preserve per-item evidence. `Failed` means the outcome is known; a lost reply, malformed result after dispatch, or worker crash may mean `unknown`.

“Act once” means stable intent identity, safe replay where the source supports it, and reconciliation where it does not. It cannot mean exactly-once effects for an arbitrary remote system. A lease fences local state changes; it does not prevent a remote effect from an older worker.

## Phase 1 — Close authorization and invocation gaps

**Findings:** F1, F2, F7; containment for F3.

**User result:** disabling a connector or removing access prevents new disclosure and new actions across the whole product.

**1A — Governance before readiness; one authorized read boundary.**

- Default absent or unreadable governance to deny. Load local connector configuration and restrictions before business readiness or background scans. Remote manifest availability must not hold local governance initialization hostage.
- Centralize access-controlled thread/object reads. Route the stream, individual thread, chips, suggestions, search-derived objects, named-card matching, history, declared views and model context through it.
- Filter retained source-derived snapshots on current access, including conversation history. Define separately the minimum historical receipt a person may still see; retain audit evidence without exposing it through ordinary content endpoints.
- Make grant and connector-configuration changes invalidate cached visibility. Sensitive invocations recheck authoritative current state; a five-second configuration watcher is not the permission boundary. Remove revoked content from browser caches on the next authorization update. Content already delivered cannot be recalled.

**1B — Clew alone issues authority.**

- Replace shared-secret identity assertions with protocol v2 assertions signed only by Clew. Recommend RS256 with a fixed algorithm allowlist, key IDs and pinned Clew verification-key discovery; use the existing cryptographic libraries. Connectors receive public keys, never the signing key.
- Separate connector-request assertions from short-lived callback grants. Bind a callback grant to the origin connector, person and assignment, allowed target capabilities, invocation, expiry and callback audience. A request assertion must not be accepted as a callback grant.
- Recheck origin enablement/audience, the person's current grant and target permission on every callback. Enforce declared dependencies and a bounded call chain. Callbacks and model tools cannot execute source writes.
- Update the independent reference connector, checker, generated schema and authoring guide together. Disable legacy identity-bearing callbacks immediately in the release; expose a clear upgrade-required state. Permit a bounded v1 read-only transition only if callbacks and execute are disabled for it. No fallback to shared-secret user authority.

**1C — One invocation contract.**

- Validate inputs and outputs at the shared invocation boundary, including nested calls. Key validators by immutable schema/manifest revision and replace registration plus governance coherently.
- Reject execute on the generic capability endpoint. Keep existing human decision routes as the explicit transition boundary until phase 3.
- Quarantine incompatible manifest updates and show the operator why. Implement required dependency and schema checks now; defer a general semantic compatibility engine.

**Primary seams:** `main.ts`, `connectors/remote.ts`, `connectors/reconcile.ts`, `connectors/registry.ts`, `routes/connectors.ts`, `routes/api.ts`, `assistant/*`, `threads/*`, `packages/connectors/src/*`, `connectors/hello/*`.

**Exit evidence:** connector-forged subjects and wrong-audience tokens fail; expired grants, undeclared dependencies and disabled origins fail; valid permitted callbacks still work. A boot with an unreachable connector exposes no ungoverned capability. Revoke a person or connector and test every listed read surface and captured model prompt, including another server instance. Nested invalid input, invalid output and changed schemas are caught. Generic execute returns no source effect.

**Release rule:** access fixes can ship independently. Rollback means disabling an affected connector or operation, never restoring the unsafe callback or execute bypass.

## Phase 2 — Prove one durable action end to end

**Finding:** F3; foundation for F6.

**User result:** confirming twice or losing a connection leads back to the same pending action and eventual evidence.

**2A — One approved intent through PostgreSQL, Temporal, source and UI.**

- Add an execution use-case boundary with ports, memory/PostgreSQL adapters and composition wiring. Keep modules independent; do not have the calendar import another module's implementation.
- Issue a stable decision identity bound to the person, action and immutable approved inputs/preconditions. Enforce uniqueness in PostgreSQL. Same identity and input returns the existing execution; same identity with different input is rejected. Refreshing a tab must not manufacture another intent for an unresolved action.
- In one physical transaction, persist execution, approval audit and outbox intent. Extend the transaction port to cover these writes; calling two existing transaction methods sequentially is insufficient. Do not hold a database lock across source I/O.
- Dispatch to one Temporal execution workflow with a stable workflow ID. Activities load the execution by ID, reconstruct current authority and apply the approved source revision before writing. Workflows and outbox rows must not carry session tokens or arbitrary source snapshots.
- Define the approved input lifetime and minimum retained fields before storing them. Keep necessary sensitive payload separate, access-controlled and encrypted at rest; an input hash alone cannot reconstruct an approved action after restart.
- Show pending, blocked, uncertain and confirmed outcomes in existing Astryx surfaces with Swedish status text and accessible announcements. A received request is never presented as a completed receipt.

**2B — Recovery and compensation.**

- Give each approved source item a stable idempotency key. Require the connector to declare its write safety: native deduplication, a conditional write plus reliable lookup, or manual reconciliation only.
- On ambiguity, read back first. Replay a write only when its source contract proves replay safe, including its key retention period. Otherwise keep it unresolved and offer reconciliation; do not expose a blind “try again” that creates a fresh operation.
- Disable unconditional activity retries for unsafe writes. Check persisted dispatch state even on worker recovery. Expired leases allow investigation/reconciliation, not automatic duplicate dispatch.
- Write outcome evidence, receipt projection, audit and any resulting follow-up intent atomically. Compensating undo is another linked execution. Keep the original receipt until compensation is confirmed; a failed or unknown undo cannot reopen the original action as if it never happened.
- Reauthorize before dispatch, including delayed approvals. Source permission failure or session-only delegation blocks execution visibly. Already-dispatched read-back needs an explicit, narrowly scoped reconciliation policy; it must not grant continuing general access to a revoked person.

Use a test-only reference source with durable storage, conditional revisions, stable deduplication and fault controls. The current hello connector's in-memory completion map cannot prove crash recovery. Keep the connector independently runnable without imports from Clew's workspace packages.

**Primary seams:** proposed `modules/executions/`, `composition/`, `temporal/`, `packages/db/src/schema.ts` and migrations, transaction ports, connector protocol, thread contracts, web mutations/cache and a standalone test fixture.

**Exit evidence:** concurrent confirmations through two servers create one execution and one source effect; retries return its identity. Kill the process before dispatch, after source commit, and before local receipt commit; recovery preserves a visible outcome. Lose a response after the source commits and verify read-back instead of a second write. Test changed-input reuse, stale revisions, authority removal, malformed post-write output, expired source deduplication and uncertain undo. Run these against real PostgreSQL and Temporal.

**Temporal detail:** acknowledge repeated starts only when they refer to the same immutable execution. Use explicit running-workflow conflict and closed-workflow reuse policies; never terminate an existing action merely to retry delivery. The database ledger remains authoritative beyond Temporal history retention. See the official [workflow identity and reuse documentation](https://github.com/temporalio/documentation/blob/main/docs/encyclopedia/workflow/workflow-execution/workflowid-runid.mdx) and [activity idempotency guidance](https://github.com/temporalio/documentation/blob/main/docs/best-practices/error-handling.mdx).

## Phase 3 — Put every existing source write through that lifecycle

**Finding:** remaining F3 paths.

**User result:** cards, calendar dialogs, standing actions and undo offer the same reliable behavior.

- **3A:** adapt card execute and standing actions to the shared boundary. Preserve deterministic buttons and the human decision endpoint. Models can propose; they cannot approve.
- **3B:** migrate calendar create, reschedule, cancel and proposal confirmation. Preserve stable UIDs and conditional revisions already supported by CalDAV. Read back the resulting revision or absence before claiming success. A source conflict requires a refreshed proposal and a new human decision.
- **3C:** migrate compensation and follow-up writes, including invitee reminders. Persist the bounded follow-up policy the person authorized; a workflow may carry out that policy, never invent a new discretionary action. Local-only proposal editing still needs a local atomic audit, not a remote execution.
- Inventory every route, capability and activity that can reach a source write. Add a regression test that direct generic execute and nested execute remain unavailable. Remove superseded dispatch logic once each path is covered.
- Preserve partial outcomes for multi-item confirmations; retry/reconcile individual items under their original keys. One failed item must not repeat successful bookings.
- Convert legacy receipts conservatively. Preserve known evidence; mark ambiguous historical state for reconciliation rather than inventing an execution history or replaying it.

**Primary seams:** `threads/usecases/cards.ts`, `modules/calendar/usecases/events.ts`, `modules/calendar/usecases/samtal.ts`, calendar adapters and ports, thin routes, calendar dialogs and shared mutation helpers.

**Exit evidence:** the two-server duplicate and source/local-commit-gap cases pass for every write family. Partial confirmation, stale move/cancel, repeated invitee reminder and uncertain undo remain truthful in all views. Test existing CalDAV behavior with the controlled test environment; this is regression coverage, not pilot selection.

**Release rule:** move one action family at a time behind a server-controlled switch; only one dispatcher may own a given family. On rollback, stop accepting new writes for that family while retaining ledger-based reconciliation. Do not route pending executions back through old code.

## Phase 4 — Persist occurrences and decouple source refresh

**Findings:** F4, F5 and the list/count part of F8.

**User result:** unchanged dismissed work stays dismissed, source-completed work resolves, and a slow source does not prevent the page loading.

**4A — Prove the full lifecycle on the reference connector.**

- Add occurrence identity from connector registration, source occurrence key, responsibility/assignment and recurrence period. Record source revision and observed state separately from local dismissal/snooze and thread presentation.
- Extend scan results with scope, observation/version information and completeness: authoritative complete snapshot, delta with explicit tombstones, partial, unavailable or authorization-required. Exhaust pagination before treating a snapshot as complete.
- Resolve missing work only after a complete authoritative snapshot for the same scope, or an explicit resolution/read-back. Failure, revoked scope or a different assignment is not source-side completion.
- Fence refresh results with generation/revision checks so an old scan cannot overwrite a newer action or source observation.
- Return the authorized local projection immediately. Enqueue coalesced refresh requests durably by connector/person/scope. Refresh each source independently with bounded deadlines/concurrency, shared coordination and last-success/error status.
- Show “not yet checked,” stale and unavailable distinctly from “nothing needs action.” If source identity needs an interactive session, expose that state instead of fabricating a delegated user.

**4B — Migrate current sources and work queries.**

- Give current scan implementations explicit completeness and occurrence semantics. A grouped topic may contain multiple source occurrences; do not infer identity from its title or reuse a topic across unrelated recurrences.
- Backfill stable links for unambiguous open work. Preserve ambiguous legacy threads with an explicit migration marker; do not replay historical actions or silently merge them.
- Keep the existing snooze/wake product behavior, but define a material source change that may break suppression and show its reason. An unchanged observation cannot create another card; a new recurring period can.
- Query and count unresolved work separately from conversations and handled history. Use priority-aware pagination so a run of new conversations cannot hide older work.

**Primary seams:** connector scan protocol and registry, `threads/model.ts`, `threads/usecases/cards.ts`, thread stores and database schema, refresh orchestration, stream queries and count contracts.

**Exit evidence:** repeated scans after dismissal yield one occurrence and no duplicate card; source completion resolves it; a new period creates a new occurrence. Partial/outage scans never resolve missing items. An older scan cannot undo a confirmed action. With a deliberately hung source, the local stream returns without waiting for it and healthy sources refresh independently. More than 50 conversations do not remove unresolved work from lists/counts. Concurrent refresh requests across two servers coalesce.

## Phase 5 — Make follow-up durable, cancellable and visible

**Findings:** F6 and delivery/attention portions of F8.

**User result:** a reminder accepted by Clew survives a restart, cancellation works during an outage, and the person sees it without interacting with the page.

**5A — Timer lifecycle and scheduler migration.**

- Commit desired timer state, audit and outbox intent together. Store absolute `dueAt`, local-time interpretation and generation; a delayed workflow start must not add the original delay again.
- Use stable workflow IDs per timer generation. Persist cancellation/replacement even when Temporal is down. Reconcile desired state until acknowledged; an eventual start cannot resurrect a cancelled generation.
- Check current generation, desired state and authority in the firing activity before applying effects. Coalesce duplicate fires transactionally. Calendar follow-up intent is committed with the confirmed execution outcome.
- Move scan scheduling, receipt finalization and undo expiry from the legacy job runner to Temporal. Preserve natural identifiers, fence/drain old claimers, import outstanding jobs idempotently and prove there is only one active owner for each job.
- Keep compatible workflow implementations for existing Temporal histories until they finish; test replay before deploying changed workflow code. Do not assume a database backfill migrates running Temporal executions.
- Make stuck outbox delivery, blocked reconciliation, stale refresh and overdue timers operationally visible. A Temporal outage means queued work with visible status; it must not look like successful scheduling or completion.

**5B — Browser updates and attention.**

- Recommend an authenticated SSE channel carrying only a per-person change revision. Persist the revision with relevant state changes; every connection/reconnection reconciles against current state, so missed events are harmless. Support multiple server instances without making an in-memory event bus the authority.
- Keep reads in TanStack Query: events invalidate the relevant keys. Recheck session and current authorization, clear revoked data, and stop subscriptions on logout. The channel conveys no source titles or payloads.
- Preserve D33's current no-browser-polling policy for the first implementation. Reconnect and refetch on visibility/network recovery. If a bounded polling fallback is later needed, record it as an explicit change to D33.
- Persist attention admission and delivery identity separately from work discovery. Apply the configured automatic-interruption budget and bundle schedule transactionally across tabs/workers. Recommend user-requested reminders keep their chosen time; they are distinct from automatic interruptions.
- Keep all unresolved work available even when attention is deferred. Browser reconnection must not produce duplicate toasts for an already presented delivery. Use only the existing page channel; push and email remain outside scope.

**Primary seams:** `threads/usecases/reminders.ts`, calendar obligation ports, `temporal/*`, `scheduler/*`, `packages/db/src/jobs.ts`, new timer/outbox/delivery persistence, authenticated routes, browser queries and reminder observer.

**Exit evidence:** stop Temporal during request/cancel/replace, restart it, and observe exactly the current desired timer. Cancel before delayed start; no stale reminder appears. Crash after firing but before acknowledgement; no duplicate delivery record appears. With a healthy stack, a focused untouched tab displays an admitted reminder within 30 seconds of its due time. Across a reconnect and two tabs, attention is admitted once and announcements do not multiply. Budget exhaustion bundles automatic attention without hiding work.

The 30-second threshold and the user-requested-reminder budget treatment are proposed acceptance decisions, not existing guarantees.

## Phase 6 — Demonstrate readiness, then choose and validate a pilot

**Findings:** F9–F11 and evidence for F1–F8.

**6A — Complete the operational proof.**

Maintain a small real-stack CI lane using PostgreSQL, Temporal, the production Node runtime and the independent fault-controlled connector. Run it alongside the existing fast suite, not instead of it. Record source effects and local evidence independently so a test cannot pass just because the UI says “done.”

Exercise duplicate requests, response loss, source commit followed by database outage, process death around workflow acknowledgement, source unavailability, concurrent cancellation, permission removal and browser reconnection. Repeat the suite through an upgrade and a documented recovery exercise. Establish readiness checks and operator views/metrics for pending age, unknown executions, outbox age, stale sources and overdue timers; keep personal payloads out of metrics and logs.

For each UI increment, follow Astryx and run the affected accessibility cases, keyboard/focus/reflow checks and manual screen-reader pass. The handover already records unrelated failing accessibility cases; establish and attribute the baseline rather than claiming an entirely green suite.

**6B — Real-source gate, deliberately deferred.**

Choose a source by its ability to prove the architecture: authorized test access, a reversible write, lookup/revision support, explicit background identity, and two relevant personas. Document unsupported failure behavior instead of promising generic safety.

Before real records or actions, settle and verify:

- Installation boundary and accountable operator. One municipality per deployment is the recommended initial scope, subject to an explicit decision; shared multi-tenant hosting requires additional isolation work.
- Real issuer/subject-to-source mapping, provisioning, responsibility/role changes and revocation. The current persona model does not prove multi-assignment or acting-role support; implement what the selected pilot requires or exclude it explicitly.
- Field-level storage, display, model-release and retention policy, including approved inputs, source-derived conversation history, receipts, audit and Temporal history. Restrict model destinations by data policy as well as user audience. A disabled model must not block the deterministic workflow.
- Source idempotency and lookup limits, approval validity, undo semantics, credential rotation and reconciliation after a person's access is removed.
- Backup/restore and recovery ownership, operational thresholds and a support procedure for unresolved executions.

Run the same acceptance scenarios on the selected source in its authorized test environment. A source that cannot safely retry or reconcile must retain an explicit manual outcome path. Do not graduate to broader rollout just because the reference connector passed.

## Decisions and documentation to carry with implementation

This plan recommends mechanisms; it does not accept or renumber ADRs. Before the relevant implementation merges, record:

| Decision | Needed by | Recommended position |
|---|---|---|
| Protocol v2 identity, callback grants and v1 retirement | Phase 1 | Clew-exclusive signing; bounded grants; unsafe paths disabled |
| Execution authority and durable dispatch | Phase 2 | Human approval in PostgreSQL; Temporal may dispatch only that committed intent |
| Occurrence identity, suppression and authoritative completion | Phase 4 | Source identity plus assignment/period; presentation is separate |
| Timer generations, delivery channel and attention treatment | Phase 5 | Transactional intent, absolute due times, SSE; no browser polling initially |
| Installation, actual source identity and data policy | Before real-data pilot | Decide with selected source and operator; no implied production readiness |

The [scheduled-work implementation](scheduled-work.md) now records D45/D47's distinction: a worker executes an already approved, bounded intent and never creates approval. Model/tool execution remains prohibited.

The proposed [connector dependency decision](../decisions/D37-connectors-declare-what-they-use-and-a-capability-name-is-its-contract.md) remains proposed. Its allowlist is needed here; its entire compatibility roadmap is not a prerequisite. Preserve [D33's cache architecture](../decisions/D33-browser-reads-go-through-one-query-cache.md).

Publish a concise current-state and vision-to-acceptance matrix as phases land. Use full filenames where D37–D39 are ambiguous. The handover explicitly leaves renumbering to the product owner: do not renumber those decisions as incidental cleanup. Update the current architecture documents and supported-persona status without rewriting historical decisions.

## Completion and safe rollout

Use additive migrations, conservative backfill, then switch readers/writers. Keep old data until reconciliation and recovery are verified. Flags select one execution owner; they are not permission to run both paths. Any rollback must preserve execution IDs, pending outcomes, timer generations and authorization fixes.

The milestone is complete when the phase exit evidence holds, all source-write paths are covered, no actionable work depends on a successful synchronous scan, durable follow-up reaches the browser, and the selected pilot's identity/data/operating gates are met.

Until a pilot source is selected, phases 1–5 and the reference-stack proof can complete independently. Report that state as “shared reliability mechanisms verified; real-source pilot pending,” not as production-ready.
