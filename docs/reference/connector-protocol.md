# Connector protocol reference

This page describes the protocol implemented in this checkout. The version and field reference are [generated from source](../generated/README.md); the complete language-neutral contract is [connector-protocol.schema.json](../protocol/connector-protocol.schema.json). Protocol 2 is the only accepted version. Implement the shapes under `$defs`; the bundle itself has no root request shape to validate against.

## HTTP routes

Paths are relative to the registered connector base URL. Bodies and responses are JSON.

| Route | Request definition | Response definition | Required |
|---|---|---|---|
| `GET /clew/manifest` | No body | `ConnectorManifest` | Always; no user assertion required. Keep credentials and source data out of the manifest. |
| `POST /clew/capabilities/{name}` | `CallRequest` (`actor`, `input`) | `CallResponse` (`output` or `error`) | For declared capabilities; `{name}` is the full capability name. |
| `POST /clew/scan` | `ScanRequest` | `ScanResponse` (`drafts`, optional `observation`) | When `scan: true`. |
| `POST /clew/figure` | `FigureRequest` (`actor`, `area`) | `FigureResponse` (`figure` or null) | For an area declaring `figure: true`. |

Every POST requires both `Authorization: Bearer <Clew assertion>` and `X-Clew-Connector-Key: <transport key>`. Trust the actor from the verified assertion, not the body. See [authorization](../guides/authorization.md) for exact claims, callbacks and optional delegated tokens.

Clew validates capability input and output against the declaration. Your connector also validates inputs and enforces source access. The [remote transport](../../packages/connectors/src/remote.ts) defaults to a five-second manifest fetch and a ten-second POST timeout. A timeout, malformed response or server failure is unavailable to a caller; for a source write it does not establish whether the effect happened. Follow [actions and receipts](../guides/actions-and-receipts.md).

## Manifest semantics

The [generated field table and complete examples](../generated/README.md) cover structural fields. Additional rules are enforced by [parseManifest](../../packages/connectors/src/remote.ts), [view validation](../../packages/connectors/src/views.ts) and the [registry](../../packages/connectors/src/index.ts):

- The id matches the registration. Every capability is prefixed by that id.
- Remote kinds are `passthrough` or `derived`; `core` is internal to Clew.
- An `execute` cannot be offered to the model. It is not invokable through generic capability REST routes or connector callbacks.
- An area's standing capabilities must exist. A view belongs to a read and opens a read of its own connector.
- Operator governance and the capability scope both have to allow the call. Missing governance denies access.
- Scan actions belong to the scanning connector and declare the actual capability kind. An undo belongs to the same connector and is an execute.

JSON Schema validation alone does not prove these relationships or source authorization. Use the conformance checker and targeted behavioral tests.

## Scan observations

Scan drafts can include `occurrences: [{ key, revision, period }]`. The optional observation declares scope, observation time/version, completeness and pagination exhaustion; a delta can include tombstones. Only authoritative evidence may resolve missing work. Legacy topic-only drafts remain conservative. See [occurrence semantics](../guides/actions-and-receipts.md#scan-an-occurrence-into-a-card) and the generated `ScanResponse` definition; an empty response without a complete exhausted observation does not mean that the source has no outstanding work.

## Errors

Return `{ "error": { "code": "denied", "message": "Du saknar behörighet." } }` for a denied operation, with an appropriate non-success HTTP status. Supported codes are `invalid`, `denied`, `not-found`, `unavailable` and `unknown`. Messages are safe Swedish text for the person, without upstream stack traces or credentials. Invalid credentials must return HTTP 401; the checker probes this boundary. Use HTTP 503 for an unavailable source.

A successful execute's `output` has the `ExecuteResult` shape: a headline, per-ref outcomes and optional undo information. An uncertain source effect is not success; see the write guide.

## Related profiles

| Profile | Contract and guide |
|---|---|
| Search | `<id>.search` and `<id>.fetch`, `$defs.SearchOutput` and `$defs.SearchHit`; [walkthrough](../guides/example-custom-directory.md). |
| Views and menu tools | `$defs.View` and `$defs.Menu`; [walkthrough](../guides/example-custom-directory.md). Menu placement is an administrator choice. |
| Callbacks | `uses: string[]`, `$defs.CallbackRequest`, a separate callback grant; [authorization](../guides/authorization.md). |
| User delegation | `$defs.Delegation`, `X-Clew-Delegated-Token`; [authorization](../guides/authorization.md). |
| Writes and recovery | Capability `execution`, `$defs.ExecuteResult`, `X-Clew-Operation-Id`; [actions](../guides/actions-and-receipts.md). |
| Jobs across systems | Manifest `facts`, capability `follows` and `creates`, `$defs.FactEnvelope`, `$defs.StepDraft`, `$defs.FollowResponse`; a follower's steps name its own connector only, and nothing runs until an administrator binds it and the person approves the job; [creating a connector](../guides/creating-a-connector.md), [D55](../decisions/D55-a-job-is-assembled-from-what-connectors-follow-approved-once-and-run-per-system.md). Proposed; no route or screen yet. |

## Contract changes

Protocol 2 rejects protocol 1; there is no shared-secret identity-signing fallback. Update the verifier, trusted Clew URL and manifest before refreshing the registration. Keep the transport secret separate from signing authority.

Keep existing capability names and schemas compatible with stored cards and callers. Use a new capability name for a breaking contract and keep the old behavior while consumers migrate. This is integration guidance, not an automatic compatibility guarantee. The proposed capability deprecation metadata and dependency-aware compatibility UI are not implemented. There is no connector `version` or `deprecated` field in the current manifest. Version your deployment images independently.

## Source map

| Concern | Source | Behavioral evidence |
|---|---|---|
| Wire schemas and version | [protocol.ts](../../packages/connectors/src/protocol.ts), [contracts](../../packages/contracts/src/index.ts) | [remote connector tests](../../tests/unit/remote-connector.test.ts) |
| Validation and HTTP | [remote.ts](../../packages/connectors/src/remote.ts) | [remote connector tests](../../tests/unit/remote-connector.test.ts) |
| Scope and governance | [registry](../../packages/connectors/src/index.ts) | [authorization boundaries](../../tests/unit/authorization-boundaries.test.ts) |
| Signing and callbacks | [authority.ts](../../apps/server/src/connectors/authority.ts), [routes](../../apps/server/src/routes/connectors.ts) | [remote connector tests](../../tests/unit/remote-connector.test.ts) |
| Source verification | [standalone verifier](../../connectors/hello/verification.mjs) | [executable documentation](../../scripts/docs-smoke.ts) |
| Conformance | [check.ts](../../packages/connectors/src/check.ts) | [phone book tests](../../tests/unit/telefonbok-connector.test.ts) |

For intent and supersessions, see the [decision log](../decisions/README.md). For availability, see [implementation status](status.md).
