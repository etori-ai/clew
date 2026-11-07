# Working across connectors

Clew combines work through explicit capabilities, shared actor identity and source-owned refs. It does not provide a cross-source query language or an operator-defined join engine. Start with the [architecture overview](overview.md); a single-source connector can ignore this page until it needs another system.

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

**Steps are independent.** There is no enforced order, branching or transaction across systems. If payroll must wait for an HR result, that dependency is not made safe by placing both writes in one job. Keep dependent processing in its owning system or design a subsequent approval based on confirmed evidence.

## Current job support

Implemented:

- `POST /api/jobs/assemble`, `POST /api/jobs` and `GET /api/jobs/:id`.
- Fact/follower validation, database bindings, proposal assembly and the execution/job ledger.
- Outbox-driven Temporal watch workflows, bounded checks and expiry cards.
- CLI binding management through [job-bind.ts](../../scripts/job-bind.ts).

Not implemented: a job card/step-list UI, administration screens for bindings, cancellation of a running watch, source event ingest that starts jobs, or a general dependency/workflow engine. `creates` metadata does not automatically start a job.

The [deployment guide](../guides/testing-and-deployment.md) gives binding commands. The [jobs module](../../apps/server/src/modules/jobs/), [execution use cases](../../apps/server/src/modules/executions/usecases.ts), [fixture scenario](../../tests/unit/fixture-job.test.ts) and [watch runtime tests](../../apps/server/tests/watch-runtime.test.ts) are the implementation and evidence. [D55](../decisions/D55-a-job-is-assembled-from-what-connectors-follow-approved-once-and-run-per-system.md) records the design.

## Data and failure boundaries

Combining results does not remove the original access rules. Every source is read as the person, and the composite must not broaden source scope. Minimize the returned data: a result used in a persisted answer or card can outlive the request, subject to Clew's snapshot authorization.

A source outage is a partial result or unresolved effect, not permission to use a broader credential. Keep source evidence distinct from the person's approval and from delivery attempts. See [actions and receipts](../guides/actions-and-receipts.md) and [the persistence map](overview.md#data-ownership-and-persistence).
