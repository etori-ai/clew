# Working across connectors

Coordinating tasks that span several systems is a core Clew responsibility. One request may need edits in multiple connectors, a watch on another system and a later proposal once a result is confirmed. Clew carries the person's approval and progress across that work; each connector remains responsible for its own source.

The design uses connector-declared facts and followers, with administrator bindings, rather than requiring an operator to draw a process graph. The job API, execution ledger and bounded watches exist today. The complete user interface and receipt-driven continuation into later proposals remain planned. Start with the [architecture overview](overview.md) for the surrounding system.

## Example: one absence report

The [D55 plan](../decisions/D55-a-job-is-assembled-from-what-connectors-follow-approved-once-and-run-per-system.md) describes a job built from the participating connectors' offers:

1. The HR connector prepares registration of the absence if it is not already recorded.
2. The time-reporting connector prepares marking the affected shift as absence.
3. The payroll connector offers a watch to check that its own import picked up the report.
4. Clew shows one proposal, obtains one approval and tracks the writes and watch separately.
5. A confirmed result can lead to a later proposal, such as arranging cover or moving an affected calendar meeting, for the person to approve again.

Steps 1–4 have API/ledger support and a [fixture scenario](../../tests/unit/fixture-job.test.ts) proving writes in HR and time reporting plus a payroll watch. The full job presentation and step 5's generic receipt-to-proposal continuation are planned. If HR already holds the report, its follower offers no write; the other systems can still have work to do.

## Identity and refs

The verified actor carries Clew's person and unit ids. Each adapter maps them to its source's ids using trusted integration configuration. A matching name or email at query time is not an identity proof.

A ref identifies an object within its owning capability contract. Formats vary: hello uses `hello:item:1`, the phone book uses `person:<id>`. A ref does not grant access and need not encode a universal namespace. Resolve it through its owner under current authorization.

The development mappings are synthetic, in connector fixtures/configuration and [calendar accounts](../../packages/calendar/src/accounts.ts). There is no general identity-mapping service or implemented SCIM feed. Do not design a real integration around fixture ids.

## Compose reads and proposals

An in-process capability receives a `clew.call(name, input)` handle. A remote connector instead:

1. Declares each exact dependency in manifest `uses`, for example `["calendar.today"]`.
2. Verifies the incoming assertion and extracts its separate callback grant.
3. Calls `POST {CLEW_URL}/api/connectors/call` with that grant and `{ name, input }`.
4. Combines authorized results in its own read/proposal response.

Clew checks the originating connector, target, current actor and dependency declaration. Callbacks cannot execute writes. Cycles and chains beyond eight are refused. Do not persist the callback grant for later work.

[Hello's day-with-meetings read](../../connectors/hello/connector.mjs) is a working example. [Authorization](../guides/authorization.md) gives the exact credential boundary. A composite should identify missing sources and return an explicitly partial result rather than a complete-looking total.

Composite search is a platform example: [search use cases](../../apps/server/src/modules/search/usecases.ts) ask eligible `<id>.search` capabilities concurrently under a budget, validate results and report unavailable sources. Each source retains its search engine and access policy.

Declared views have a narrower rule: a row's `open` names a read of the **same connector**. Arbitrary cross-connector view enrichment is not a supported view feature.

## Jobs: facts, followers and one approval

A job prepares independent steps across several systems. The current example is an absence report involving HR, time reporting and a payroll watch.

| Term | Meaning |
|---|---|
| Fact kind | A namespaced business contract such as `hr:absence`, declared in manifest `facts` with an attributes schema. |
| Creator | A capability whose `creates` names a fact kind declared by its own connector. |
| Follower | A `propose` capability with `follows`, taking a `FactEnvelope` and returning a `FollowResponse`. |
| Binding | Administrator configuration permitting a particular follower for a fact kind and audience, with an optional watch-window cap. Default is deny. |
| Step | An execute with approved input or a bounded watch over a read. It names the follower's own connector only. |

Assembly asks bound followers concurrently as the person. Each answers with zero or more steps; Clew reports every bound system's outcome and marks partial proposals. Preparing the proposal performs no source writes.

Approval commits the job, execution rows, watch intent, audit and outbox in one transaction. Each execute then uses its own operation identity, source guarantees and receipt. Each watch has committed check times and a deadline; Temporal calls the authorized read and settles it as seen, blocked or expired. An expired watch can create a card for the person. Undo records separate compensations for supported steps.

**Within one job, steps are independent.** Every step is prepared from the same fact; its input does not depend on another step's output. Dispatch order carries no meaning, and there is no atomic transaction across systems. This supports a coordinated task with several writes while preserving the outcome of each.

## Planned continuation after a result

D55 explicitly plans dependent work as a chain of facts and approvals. A confirmed source receipt may supply another fact, such as `timesheet:unstaffed-shift`. Connectors that follow that fact can then propose their own steps: arranging cover or moving a meeting, for example. Clew presents the next proposal, and the person approves the next job.

That continuation is part of Clew's intended orchestration role. It is not automatic permission to execute another write, and the generic path from a receipt's fact to the next proposal is not implemented yet. Likewise, the planned entry points from the composer or a pushed occurrence do not all exist simply because the assembly API exists.

Propagation already owned by source systems remains there: payroll importing HR records is a source integration, while Clew watches whether the result arrived. When a person's next action depends on a confirmed result, the plan is for Clew to carry it into the next proposal.

The [task-continuation exploration](../reviews/2026-11-07-multi-connector-task-continuation.md) develops this into one visible task with reviewed stages: independent writes together, dependent writes in a later proposal, and source-owned propagation observed through watches. It describes the missing evidence/proposal records, failure handling and three recommended delivery increments; it is a recommendation, not an implemented contract.

## Current job support

Implemented:

- `POST /api/jobs/assemble`, `POST /api/jobs` and `GET /api/jobs/:id`.
- Fact/follower validation, database bindings, proposal assembly and the execution/job ledger.
- Outbox-driven Temporal watch workflows, bounded checks and expiry cards.
- CLI binding management through [job-bind.ts](../../scripts/job-bind.ts).

Planned but not implemented: a job card/step-list UI, administration screens for bindings, the full composer/pushed entry paths, and receipt-driven facts assembling the next proposal. Source event ingest is also proposed. Running watches currently have no cancellation path. `creates` metadata does not automatically start a job.

The [three reproduced approval/read gaps](../reviews/2026-11-07-multi-connector-task-continuation.md#outcome-approval-and-receipt-fixes) are fixed: retries preserve the first committed watch schedule; approval rechecks binding revisions, eligibility and step ownership; job and execution receipts require their producing unit/authorization version and current capability access. [D77](../decisions/D77-job-approvals-preserve-intent-bindings-and-receipt-authority.md) records the behavior and compatibility limits.

Each assembled step now carries `binding`; each source carries `bindingRevision`. Echo them when submitting the proposal, and treat step ids as opaque. Binding changes require a fresh proposal. Watch limits apply per binding, including when one connector has several followers. This metadata detects configuration changes; it does not make the client-supplied proposal an immutable server-side record. That record and receipt-driven continuation remain planned.

A general process-graph editor with arbitrary branches and cross-step dataflow is outside D55's design. That boundary does not exclude tasks requiring changes in multiple connectors; those are the purpose of the job and its planned continuation.

The [deployment guide](../guides/testing-and-deployment.md) gives binding commands. The [jobs module](../../apps/server/src/modules/jobs/), [execution use cases](../../apps/server/src/modules/executions/usecases.ts), [fixture scenario](../../tests/unit/fixture-job.test.ts) and [watch runtime tests](../../apps/server/tests/watch-runtime.test.ts) are the implementation and evidence. [D55](../decisions/D55-a-job-is-assembled-from-what-connectors-follow-approved-once-and-run-per-system.md) records the design.

## Data and failure boundaries

Combining results does not remove the original access rules. Every source is read as the person, and the composite must not broaden source scope. Minimize the returned data: a result used in a persisted answer or card can outlive the request, subject to Clew's snapshot authorization.

A source outage is a partial result or unresolved effect, not permission to use a broader credential. Keep source evidence distinct from the person's approval and from delivery attempts. See [actions and receipts](../guides/actions-and-receipts.md) and [the persistence map](overview.md#data-ownership-and-persistence).
