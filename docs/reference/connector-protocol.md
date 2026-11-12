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
| `POST /api/protocol/manifest?id=<id>` | A dry run: a manifest document in, a `ManifestPreview` out with every problem the loader would refuse it for, each placed in `issues` (its path in the document, its manifest reference entry, the rule it breaks), else what Clew would make of it (who may call what, what the model is offered, which views could be menu rows, what the conformance check would exercise and, for a capability about an entity, its `places`, `audience`, `openedFrom` and sample rows). No service, registration or sign-in needed. |
| `GET /protocol/preview` | The manifest preview ([D97](../decisions/D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md)): paste a manifest or choose its file, and the web app posts it to the dry run and draws the answer, with the row mark, the section and the menu drawn by Clew's own components from sample rows. The samples come from the declaration; no connector is called. |

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
| `POST /clew/capabilities/<header capability>` | `CallRequest` | `CallResponse` whose `output` is a `SiteHeaderOutput` (`site`, `items` with their `children`, optional `logo`; a place or page may say `purpose: "toolbox"`, the intranet's page of tools, which Hem links to under Verktygslådan) | When the manifest declares `header: { capability }` ([D88](../decisions/D88-the-web-app-draws-the-shared-header-and-an-administrator-owns-its-content.md)): the read that gives Clew its shared header for the acting person. A read without input; the first enabled declaring connector in registration order answers. |

Every POST requires both `Authorization: Bearer <Clew assertion>` and `X-Clew-Connector-Key: <transport key>`. Trust the actor from the verified assertion, not the body. The actor is `id`, `name`, `unitId`, `unitLabel`, `role` and, when the person was provisioned with one, `userName`: the directory user name your system knows them by, and the key a read about a person is asked with. See [authorization](../guides/authorization.md) for exact claims, callbacks and optional delegated tokens.

Clew validates capability input and output against the declaration. Your connector also validates inputs and enforces source access. The [remote transport](../../packages/connectors/src/remote.ts) defaults to a five-second manifest fetch and a ten-second POST timeout. A timeout, malformed response or server failure is unavailable to a caller; for a source write it does not establish whether the effect happened. Follow [actions and receipts](../guides/actions-and-receipts.md).

## Manifest semantics

The [manifest field reference](../generated/manifest-reference.md) covers every field with its rules; the [generated field table and complete examples](../generated/README.md) are the short form. The rules are enforced by [parseManifest](../../packages/connectors/src/remote.ts), [view validation](../../packages/connectors/src/views.ts) and the [registry](../../packages/connectors/src/index.ts):

- The id matches the registration. Every capability is prefixed by that id.
- Remote kinds are `passthrough` or `derived`; `core` is internal to Clew.
- An `execute` cannot be offered to the model. It is not invokable through generic capability REST routes or connector callbacks.
- An area's standing capabilities must exist. A view belongs to a read and opens a read of its own connector.
- Operator governance and the capability scope both have to allow the call. Missing governance denies access.
- Scan actions belong to the scanning connector and declare the actual capability kind. An undo belongs to the same connector and is an execute.
- A capability that declares `about` follows the rules in the next section.
- `asks` and `effect` follow the rules in [What a write asks, and what it says it will do](#what-a-write-asks-and-what-it-says-it-will-do).

JSON Schema validation alone does not prove these relationships or source authorization. Use the conformance checker and targeted behavioral tests.

## Reads and actions about an entity

A capability may say what its rows are **about** ([D97](../decisions/D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md)): `about: { entity }` on a read, `about: { entity, param }` on a propose or execute. The entity kinds are `person`, keyed on the provisioned SCIM `userName` and compared without regard to case, and `unit`, keyed on the unit id. The source says what, never where. Clew places it from the declaration:

| Declaration | Where Clew shows it |
|---|---|
| A propose or execute about the kind | The entity's menu, run after a human decision |
| A read about the kind | A section on the opened entity |
| The same read | A lens under "Visa" on the entity's list, when an administrator offers it; one field of it as a column on "Alla", when an administrator chooses it |
| A field of that read's view with a `warn` or `alert` tone | A mark on the entity's row, for a lens an administrator offers |

The loader refuses, with the field named ([validation.ts](../../packages/connectors/src/validation.ts)):

- A read about an entity that does not take `{ keys }`: an object input whose required `keys` is an array of strings with `maxItems` at most 200. A read declares no `param`.
- A read about an entity without a `table` or `list` view, or whose rows (`rows`, or the view's `rows`) are not an array whose items require a string `key`.
- A read about an entity with `model: true`. It is never a model tool.
- An action whose `param` is not a string property of its input, or whose input requires anything besides `param` that it does not ask for (`asks`). The menu starts it with the key and the person's answers.
- `about` together with `follows`, on a profile read (`<id>.search`, `<id>.fetch`, `<id>.errands`, `<id>.talks`, `<id>.commitments`, `<id>.news`), on a capability with `kinds`, or on the header's read.
- `about.page` in a remote manifest. A page inside Clew where the person writes about the entity is named only by Clew's own core connectors.

A read about an entity is called with a batch of keys and answers one row per key it knows:

```json
{ "actor": { "id": "…", "name": "…", "unitId": "…", "unitLabel": "…", "role": "manager", "userName": "hillevi" },
  "input": { "keys": ["johan", "maria", "okand"] } }
```

```json
{ "output": { "rows": [{ "key": "johan", "state": "Bokat", "at": "2026-11-12T08:00:00+01:00", "overdue": 0 }] } }
```

Each row carries `key` as it was asked. A key you do not know, and a key outside the acting person's scope in your system, is answered as no row, never as an error: a missing row stands for both "none" and "not allowed". Beside `rows` the output may hold `heading` and `note`, two strings your output schema declares, which Clew draws over a lens. Clew sends only keys of entities the person may already be asked about, at most 200 in one call, and keeps nothing; it drops a row for a key it did not ask and a second row for a key. What Clew does around the call is in [Entities](../architecture/entities.md#how-a-source-is-asked).

An action about an entity is started from the entity's menu with `{ "<param>": "<key>" }` and, for a propose that asks, the person's answers. A propose answers a `ThreadDraft`, which becomes the person's card; an execute is not called until the person decides on its card, where its asks are answered. Refuse a key outside the person's scope as any call is refused, with a Swedish message.

Rows may also name an entity without being about one, so the name links to the person or unit in Clew: `subject: { entity, key }` on a scan's card row (`ThreadItem`) or a draft's row, `subject` on a `SearchHit` (hits from several sources with the same subject become one), and `view.subject: { entity, key }` on a `table`, `list` or `detail` view, where `key` names the record property that holds the entity's key. Clew does not check that a key exists.

Three view additions serve these places, and any view may use them: the `tones` key `*` gives the tone of any other present value, so "2 försenade" can warn while an absent value stays neutral; `beside: true` draws a field in the same cell or line as the field before it, never on the first field; `compact: true` marks the one field that is the row in one value, drawn in a column or a one-line summary and left out where the whole row is drawn. At most one field of a view is `compact`.

The [conformance check](../../packages/connectors/src/check.ts) asks every read about an entity with an unknown key and with the same keys asked by the check's own people on a unit no installation has, and expects no row and no error. With `--keys` and `--as` it also asks a batch of real keys signed as a person who may see them, and checks one row per key, each carrying a key it was asked with. See [Create a connector](../guides/creating-a-connector.md#8-say-what-your-rows-are-about) for a worked example.

## What a write asks, and what it says it will do

A write passes one path from every place it starts ([D111](../decisions/D111-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md) item 10). Two optional capability fields decide which steps it draws; Clew draws them, the connector never sends a form.

`asks`, on a `propose` or an `execute`, lists what the person fills in, each naming one property of the capability's own input:

| `kind` | Takes | Clew draws and checks |
|---|---|---|
| `meeting` | a `string` property (format `date-time` when it declares one), with `durationMinutes` | Three free times of that length from the person's own calendar, "Annan tid" and the chosen day; the start as an ISO 8601 instant, not yet passed |
| `text`, `long-text` | a `string` property without `enum` or `format` | A field or a text area; trimmed |
| `date` | a `string` property (format `date` when it declares one) | A day as `YYYY-MM-DD` that exists |
| `choice` | a property with an `enum`, every value named once in `options` with a Swedish label | One of the values |

Each ask has a Swedish `label` and says whether it is `required`; a property the input requires is a required ask, and an optional ask left empty is not sent. The person meets only the asks the action does not already fill: the action's own `input` on a work item, the selected rows (`refs`), the review's evidence (`reviews`) and the entity's key (`about.param`) are never asked. A work item's propose or execute must leave nothing its input requires to nobody, or the scan's draft is refused.

`effect`, on an `execute`, names a `read` of the same connector whose input schema is the execute's own and which declares `model: false`. Before anything is written, Clew posts it as the person with exactly the input the execute would get, and expects an `EffectOutput`:

```json
{ "output": { "rows": [{ "label": "Omtankesamtalet registreras", "detail": "På medarbetaren, torsdag 19 november kl. 13:15, rum 12" }],
              "undoMinutes": 10 } }
```

Each row says one thing the write will do; a row's `source` names another system it is written in, when there is one. `undoMinutes` lets the dialog say how long the person can undo. Answer as the write would check (refuse an employee outside the person's scope), but write nothing. Without an `effect`, the dialog names your `source` and shows the capability's `description`.

When the person presses the last button, Clew merges the answers into the input, validates it against your input schema and approves it as every decision is approved: the answers are in the approved intent and the audit row, and your execute receives them in `input` with the operation id, as any approved write. An answer to anything the action does not ask is refused before anything is sent. A write without asks whose result can be undone stays one press.

The loader refuses, with the field named ([validation.ts](../../packages/connectors/src/validation.ts)): `asks` on a read or on a follower; an ask asked twice, naming no property of the input or the entity's key; an ask whose kind does not fit its property; an optional ask for a property the input requires; and an `effect` on anything but an execute, naming anything but a `model: false` read of the same connector with the same input. The [manifest preview](#served-by-the-instance) lists, for every propose and execute, where a person can start it, which steps of the path it draws and who fills each property of its input.

## Document and semantic views

Protocol 2 also supports `document`, `record`, `metrics`, `series` and `activity`. Document originals use the optional authenticated `POST /clew/documents` binary route, separate from metadata capabilities. An execute's optional `review` names its document read and requires version-bound evidence at human approval. See [document and semantic views](../guides/document-and-semantic-views.md) for payloads, preview limits, source-side version checks and compatibility.

## Scan observations

Scan drafts can include `occurrences: [{ key, revision, period }]`. The optional observation declares scope, observation time/version, completeness and pagination exhaustion; a delta can include tombstones. Only authoritative evidence may resolve missing work. Legacy topic-only drafts remain conservative. See [occurrence semantics](../guides/actions-and-receipts.md#scan-an-occurrence-into-a-card) and the generated `ScanResponse` definition; an empty response without a complete exhausted observation does not mean that the source has no outstanding work.

## Errors

Return `{ "error": { "code": "denied", "message": "Du saknar behörighet." } }` for a denied operation, with an appropriate non-success HTTP status. Supported codes are `invalid`, `denied`, `not-found`, `unavailable` and `unknown`. Messages are safe Swedish text for the person, without upstream stack traces or credentials. Invalid credentials must return HTTP 401; the checker probes this boundary. Use HTTP 503 for an unavailable source.

A successful execute's `output` has the `ExecuteResult` shape: a headline, per-ref outcomes and optional undo information. An uncertain source effect is not success; see the write guide.

## Related profiles

| Profile | Contract and guide |
|---|---|
| Search | `<id>.search` and `<id>.fetch`, `$defs.SearchOutput` and `$defs.SearchHit`; [walkthrough](../guides/example-custom-directory.md). |
| Errands | `<id>.errands`, `$defs.ErrandsOutput` and `$defs.ErrandRow`; every case system in the person's scope is shown as one list, `clew.errands` ([D89](../decisions/D89-an-errand-connector-acts-as-the-person-and-the-case-system-decides-access.md)). |
| News | `<id>.news`, taking `{}`, `$defs.NewsOutput` and `$defs.NewsRow`: a headline, its sender, when it was published and an optional `link`, nothing else. Every news source in the person's scope is shown as one list, `clew.news`, newest first: the three newest under "Nyheter" on Hem and all of them on "Alla nyheter". A source that fails or answers out of shape contributes nothing. A row with `link` leaves Clew; without one it opens the read the view's `open` names, by convention `<id>.newsItem`. One model tool, `clew.news`, reading a summary ([D111, amended 2026-11-11](../decisions/D111-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md)); example [connectors/communication](../../connectors/communication/README.md). |
| Read receipts | On a `ThreadDraft` action of kind `execute`, `acknowledgement: { publishedAt }` says the action is the person's read receipt for something published; at most one per draft. Hem lifts the most urgent open item with one above its blocks until it is pressed ([D111, amended 2026-11-11](../decisions/D111-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md)). A draft that marks a read, or two actions, is refused and reported. |
| Talks | `<id>.talks` (the round and one row per person a manager is due a talk with) and `<id>.commitments` (action points), `$defs.TalksOutput`, `$defs.TalkRow`, `$defs.CommitmentsOutput`, `$defs.CommitmentRow`. Rows are keyed on the SCIM user name. One system answers per installation: Clew's own module while it is enabled, otherwise the single connector that declares either read; Clew then shows that system read-only and a row opens its `link`. Neither read is ever a model tool. `<id>.talks` may be limited to managers; `<id>.commitments` must be callable by everyone. [D96](../decisions/D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md); example [connectors/appraisals](../../connectors/appraisals/README.md). |
| Views and menu tools | `$defs.View` and `$defs.Menu`; [walkthrough](../guides/example-custom-directory.md). Menu placement is an administrator choice. |
| Callbacks | `uses: string[]`, `$defs.CallbackRequest`, a separate callback grant; [authorization](../guides/authorization.md). |
| User delegation | `$defs.Delegation`, `X-Clew-Delegated-Token`; [authorization](../guides/authorization.md). |
| Writes and recovery | Capability `execution`, `$defs.ExecuteResult`, `X-Clew-Operation-Id`; [actions](../guides/actions-and-receipts.md). |
| Jobs across systems | Manifest `facts`, capability `follows` and `creates`, `$defs.FactEnvelope`, `$defs.StepDraft`, `$defs.FollowResponse`; a follower's steps name its own connector only, and nothing runs until an administrator binds it and the person approves the job; [working across connectors](../architecture/working-across-connectors.md), [D55](../decisions/D55-a-job-is-assembled-from-what-connectors-follow-approved-once-and-run-per-system.md). Assembly/approval/read routes, the ledger and durable watches exist; job and binding administration screens do not. The job approval envelope must echo each assembled step's `binding` and source's `bindingRevision`; step ids are opaque. Current binding checks, stable watch retries and receipt authority are specified in [D77](../decisions/D77-job-approvals-preserve-intent-bindings-and-receipt-authority.md). These fields belong to Clew's job API, not the connector's `StepDraft`. |

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
| Reads and actions about an entity | [validation.ts](../../packages/connectors/src/validation.ts), [entities module](../../apps/server/src/modules/entities/) | [manifest rules](../../tests/unit/manifest-reference.test.ts), [remote connector tests](../../tests/unit/remote-connector.test.ts), [entities tests](../../tests/unit/entities.test.ts) |
| What a write asks and its effect | [asks.ts](../../packages/connectors/src/asks.ts), [validation.ts](../../packages/connectors/src/validation.ts), [card decisions](../../apps/server/src/threads/usecases/decisions.ts) | [action path tests](../../tests/unit/action-path.test.ts) |

For intent and supersessions, see the [decision log](../decisions/README.md). For availability, see [implementation status](status.md).
