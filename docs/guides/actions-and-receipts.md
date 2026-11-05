# Add actions and trustworthy receipts

Start with a source read that works under the person's access. A write adds three responsibilities: identifying what the person approved, establishing what the source actually did, and resolving an uncertain response without blindly repeating the effect.

The relevant code is the [card decision use case](../../apps/server/src/threads/usecases/decisions.ts), [execution use cases](../../apps/server/src/modules/executions/usecases.ts), [wire schemas](../../packages/connectors/src/protocol.ts) and [durable synthetic source](../../connectors/reference/connector.mjs). The durability work is evolving; see [implementation status](../reference/status.md) before assuming every existing write uses this lifecycle.

## Scan an occurrence into a card

Set `scan: true` and implement `/clew/scan` as a deterministic source read for the verified actor. Return `ThreadDraft` objects with an area, a stable topic, a title/summary, a reason, optional items/deadline and actions. The reason explains why the person sees this work. Keep pushed text free of unnecessary sensitive detail; a read view can show the details live.

Return the same topic for the same occurrence across repeated scans. Clew currently deduplicates open cards per person/topic; this is not a general guarantee that a closed occurrence can never recur. A persistent occurrence lifecycle is part of the reliability plan. Model it explicitly in your source and test completion followed by a new scan.

Each draft's actions must name capabilities of its own connector and match their declared kinds. The usual card has one primary execute/propose and up to two secondary reads. Clew owns the standard card actions. One connector's card cannot execute another connector's capability. [Hello](../../connectors/hello/connector.mjs) demonstrates a scan; [reference](../../connectors/reference/connector.mjs) includes an approved ref and source revision in its action input.

## Keep approval separate from execution

A `propose` may prepare a draft but must not perform the proposed source write. An `execute` is always `model: false`. Clew's generic capability route and connector callbacks refuse executes; the person reaches them through a card's human decision flow. The source must still validate the current actor, records and expected revision when executing.

The [reference manifest](../../connectors/reference/connector.mjs) illustrates capability `execution` metadata:

| Strategy | Meaning for recovery |
|---|---|
| `manual` or no guarantee | Do not assume replay is safe. An ambiguous outcome needs evidence or manual reconciliation. |
| `deduplicated` | The source guarantees operation-key deduplication for `retentionSeconds` and provides the named `lookup` read. |
| `conditional` | The source supports a conditional write and the named `lookup` read. This requires actual source-side revision/evidence semantics. |

These declarations are claims about your implementation, not guarantees Clew can create for your source. Do not advertise deduplication based on an in-memory map or a successful HTTP request.

## Bind an operation to its approved input

Where Clew's durable execution path is used, it sends `X-Clew-Operation-Id`. The synthetic source binds that id to the person/assignment, operation, ref and approved revision, commits the effect and its result atomically, rejects a changed payload under the same key, and returns the original result for a repeated identical request. Its lookup accepts `{ operationId }` and returns `{ found, result? }` under the same actor.

Study [reference/connector.mjs](../../connectors/reference/connector.mjs) and [execution runtime tests](../../apps/server/tests/execution-runtime.test.ts) together. They cover the critical case: the source committed, but the response was lost. The fixture retains operation records in SQLite and advertises a 24-hour replay window. It is synthetic evidence, not a production adapter or a chosen pilot.

## Return what the source confirmed

An execute returns `ExecuteResult` inside `{ output }`:

- `headline`: a concise Swedish result.
- `rows`: one result per relevant ref, with `label`, `detail` and `outcome` (`done`, `unknown`, `failed` or `skipped`).
- Optional `undoCapability` and `undoMinutes`: a compensating execute of this same connector and the allowed window.
- Optional `undoInput`: source-supplied input for that compensation, when the current contract requires more than the original refs (for example, the resulting revision). Validate it as part of the approved undo path; it does not grant authority.

`done` needs source evidence. A timeout after sending a write is an unknown effect, not a known failure and not permission to retry. Lookup/reconciliation must establish the original result before a safe replay decision. Avoid putting entire source payloads or credentials in receipts. Undo is another authorized, auditable source effect; only offer it when the source supports it.

## Test the failure cases

Exercise success, denied access, stale revision, unknown ref, duplicate operation, changed input under the same key, lost response after commit, lookup after restart and undo. Also test revocation between proposal and execution. The [reference README](../../connectors/reference/README.md) describes its fault modes; [execution tests](../../tests/unit/executions.test.ts) describe Clew's recovery decisions.

The generic connector checker deliberately does not execute capabilities. Passing it does not prove safe writes. Keep source-effect tests in a disposable fixture and run the runtime/durability suites described in [testing and deployment](testing-and-deployment.md).
