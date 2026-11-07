# Connector protocol reference

This page describes the protocol implemented in this checkout. The version and field reference are [generated from source](../generated/README.md); the complete language-neutral contract is [connector-protocol.schema.json](../protocol/connector-protocol.schema.json), and the routes on both sides are [connector-protocol.openapi.json](../protocol/connector-protocol.openapi.json). Protocol 2 is the only accepted version. Implement the shapes under `$defs`; the bundle itself has no root request shape to validate against.

## Served by the instance

A running Clew serves the protocol it speaks under `/api/protocol`, public, without a session, generated from the same code that validates manifests ([D60](../decisions/D60-the-instance-serves-its-connector-protocol.md)). Build against the instance you will register with, not against this checkout.

| Route | What it answers |
|---|---|
| `GET /api/protocol` | A page that draws the OpenAPI document (RapiDoc, served from the image; nothing is fetched outside the installation). |
| `GET /protocol/manifest` | The manifest field by field: what each field does, type, presence, constraints, an example and the rules between fields, with three recipes. Drawn by the web app from `GET /api/protocol/manifest-reference.json`; committed as [manifest-reference.md](../generated/manifest-reference.md). |
| `GET /api/protocol/openapi.json` | The OpenAPI 3.1 document: the routes a connector serves (tag Connector) and the routes Clew serves (tag Clew), with `components.schemas` equal to the bundle's `$defs` and `x-clew-protocol` naming the versions this instance loads. |
| `GET /api/protocol/connector-protocol.schema.json` | The JSON Schema bundle. |
| `POST /api/protocol/manifest?id=<id>` | A dry run: a manifest document in, a `ManifestPreview` out with every problem the loader would refuse it for, else what Clew would make of it (who may call what, what the model is offered, which views could be menu rows, what the conformance check would exercise). No service, registration or sign-in needed. |

```sh
curl -s -X POST "http://localhost:3020/api/protocol/manifest?id=phonebook" -H 'content-type: application/json' --data @docs/generated/phonebook.manifest.json
```

In the development stack the Vite proxy forwards `/api` to the BFF, so `http://localhost:3020/api/protocol` is the address on the host.

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

The [manifest field reference](../generated/manifest-reference.md) covers every field with its rules; the [generated field table and complete examples](../generated/README.md) are the short form. The rules are enforced by [parseManifest](../../packages/connectors/src/remote.ts), [view validation](../../packages/connectors/src/views.ts) and the [registry](../../packages/connectors/src/index.ts):

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
| Jobs across systems | Manifest `facts`, capability `follows` and `creates`, `$defs.FactEnvelope`, `$defs.StepDraft`, `$defs.FollowResponse`; a follower's steps name its own connector only, and nothing runs until an administrator binds it and the person approves the job; [working across connectors](../architecture/working-across-connectors.md), [D55](../decisions/D55-a-job-is-assembled-from-what-connectors-follow-approved-once-and-run-per-system.md). Assembly/approval/read routes, the ledger and Temporal watches exist; job and binding administration screens do not. |

## Contract changes

`protocol` in a manifest is the version of this contract, not of the connector ([D60](../decisions/D60-the-instance-serves-its-connector-protocol.md), item 4). An additive change (a new optional field, a looser constraint) keeps the number. A break is a new number, and Clew then loads the new number and the one before it for a stated window, showing a connector on the older one with a warning in administration rather than refusing it. The exception is a security change, which retires the old number at once: protocol 2 rejects protocol 1, because shared-secret identity signing was replaced by installation keys (D44), and there is no fallback. The served documents carry `x-clew-protocol` with the current, accepted and retired numbers, and a refused manifest names the number and the reason. Update the verifier, trusted Clew URL and manifest before refreshing the registration. Keep the transport secret separate from signing authority.

Keep existing capability names and schemas compatible with stored cards and callers. Use a new capability name for a breaking contract and keep the old behavior while consumers migrate. This is integration guidance, not an automatic compatibility guarantee. The proposed capability deprecation metadata and dependency-aware compatibility UI are not implemented. There is no connector `version` or `deprecated` field in the current manifest. Version your deployment images independently.

## Source map

| Concern | Source | Behavioral evidence |
|---|---|---|
| Wire schemas and version | [protocol.ts](../../packages/connectors/src/protocol.ts), [contracts](../../packages/contracts/src/index.ts) | [remote connector tests](../../tests/unit/remote-connector.test.ts) |
| Served protocol, OpenAPI and dry run | [routes/protocol.ts](../../apps/server/src/routes/protocol.ts), [preview.ts](../../packages/connectors/src/preview.ts) | [served protocol tests](../../tests/unit/protocol-served.test.ts) |
| Validation and HTTP | [remote.ts](../../packages/connectors/src/remote.ts) | [remote connector tests](../../tests/unit/remote-connector.test.ts) |
| Scope and governance | [registry](../../packages/connectors/src/index.ts) | [authorization boundaries](../../tests/unit/authorization-boundaries.test.ts) |
| Signing and callbacks | [authority.ts](../../apps/server/src/connectors/authority.ts), [routes](../../apps/server/src/routes/connectors.ts) | [remote connector tests](../../tests/unit/remote-connector.test.ts) |
| Source verification | [standalone verifier](../../connectors/hello/verification.mjs) | [executable documentation](../../scripts/docs-smoke.ts) |
| Conformance | [check.ts](../../packages/connectors/src/check.ts) | [phone book tests](../../tests/unit/phonebook-connector.test.ts) |

For intent and supersessions, see the [decision log](../decisions/README.md). For availability, see [implementation status](status.md).
