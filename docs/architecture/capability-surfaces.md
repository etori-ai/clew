# How capabilities are called

A capability has one name, kind, input/output contract and access policy. Clew's registry applies that contract to several callers. The caller's route determines whether a read, proposal or approved execution is allowed.

The [architecture overview](overview.md) explains the whole request flow. The [connector protocol](../reference/connector-protocol.md) defines the HTTP boundary a connector author implements.

## Current surfaces

| Surface | Caller and authority | Allowed operations |
|---|---|---|
| `GET /api/cap/:name?input=<json>` | Signed-in browser/person | `read` only. The answer is `{ output, source, view? }`: the declared view when present, with `view.people` mapping the user name each record names a person by to that person's id in the reader's organisation, so the record links to `/people/<id>`; a name nobody there holds is left out ([D116](../decisions/D116-clew-keys-its-own-records-about-a-person-by-the-persons-id.md)). |
| `POST /api/cap/:name` | Signed-in person, with mutation origin/CSRF checks | `read` or `propose`; body is the capability input itself. Executes are refused. |
| Model tools | Assistant inside the person's request | In-scope `read`/`propose` with `model: true`, narrowed by operator tool switches. |
| `POST /api/connectors/call` | Connector with a separate signed callback grant | Declared `uses` targets of kind `read`/`propose`, under the same person's current access. |
| Human decision routes | Person reviewing an action | Record approved intent; the execution worker later calls `execute` under current authority. |
| Connector HTTP routes | Clew, with signed actor assertion and transport key | The connector's declared reads/proposals, scans/figures, and approved executes. |

The two `/api/cap` routes are [capabilityRoutes](../../apps/server/src/routes/capabilities.ts), mounted inside the API with `api.route('/cap', …)` behind its session guard and its refresh of the connectors. Before it reads the input, each route asks the registry whether the capability exists for the person (`Registry.findFor`). `GET` answers 404 "Okänd förmåga." for a name that is unknown or not a read, and `POST` for one that is unknown or an execute. A capability hidden from the person gets the same 404, with the same body and headers, whatever the input: its connector switched off or leaving the person out of its audience, or the capability switched off ([D23](../decisions/D23-connectors-are-managed-in-the-database.md)). So does one hidden while it runs, its connector switched off between the check and the call. Input that is not JSON answers 400 "Ogiltig förfrågan.", and a `POST` body over 8,000 characters 400 "För stor förfrågan.". Input that its schema refuses answers 400 "Ogiltig förfrågan till <name>.".

A capability of a connector the person can see, whose scope leaves the person out, answers 400 "Du saknar behörighet för åtgärden.". D23 hides a connector by its audience and leaves finer rules to the manifest's scope, and `GET /api/connectors` lists every capability of a connector the person can see, with `inScope`, so the person may learn that such a capability exists. The other surfaces agree. A model tool call, a card action and a nested `clew.call` go through `Registry.run`, which refuses a hidden capability with "Okänd förmåga." and the scope with "Du saknar behörighet för åtgärden.". The model's tool list holds only what the person may call, so it leaves out both. `POST /api/connectors/call` is meant to answer a hidden or unknown target with 404 `not-found` and the scope with 400 `denied`. Today it answers every refusal of the registry with 503 `unavailable` and writes an error line, because it tests for the server's `InputError` while the registry throws `CapabilityError`; a hidden target and an unknown one still get the same answer there.

The generic capability API is not an execution shortcut. Human decision routes include card actions, calendar decisions and `POST /api/executions`; cross-system jobs use `POST /api/jobs`. Their contracts are owned by the [business routes](../../apps/server/src/routes/api.ts) and use cases, not by the connector OpenAPI document.

## A connector author implements two required routes

- `GET /clew/manifest`: the connector's identity, capability schemas and optional presentation/features.
- `POST /clew/capabilities/{name}`: verified requests for the full capability name, with `{ actor, input }` and a response containing `output` or `error`.

Add scan/figure routes only for declared features. Clew derives browser invocation and model tools from the manifest. You implement the HTTP handlers and source mapping, not a frontend plugin or a second set of model tools.

For comparison, the browser's POST body is the raw capability input. The server-to-connector body wraps it in `{ actor, input }`. A browser session cookie and a connector assertion are different authentication mechanisms and are not interchangeable.

## What the registry does

[Registry.run](../../packages/connectors/src/index.ts) enforces capability scope, current connector governance and input/output validation. The [server wrapper](../../apps/server/src/connectors/registry.ts) also checks the person's current authorization around the call.

Inside the process the actor carries the person's provisioned groups, which an audience's `groups` match. A request and the execution ledger hand the registry `audiencedActorOf(persona)`, the published actor with the groups; the refresh and a connector's callback hand it the whole authenticated context, which carries them too. A nested `clew.call` keeps the actor it was given, so Clew's own composites ask with the groups too. The groups never leave the process.

For a remote connector, [remote.ts](../../packages/connectors/src/remote.ts) makes the HTTP exchange, and every body it posts (a capability, a document, a figure, a scan) carries `actorOf(actor)`, the published actor and nothing more. The connector independently verifies identity and source access. For core functionality, the descriptor runs the local use case. UI visibility and model tool selection do not replace these checks.

The conformance check (`scripts/connector-check.ts` and "Testa anslutning" on the administration page, both [check.ts](../../packages/connectors/src/check.ts)) hands the registry its two people as the refresh does, with the whole authenticated context and a group (`asInProduction`). The check's requests therefore go through the same cut in `remote.ts` as production's, and its result holds for a connector that refuses anything beyond the published actor.

## Models and declared views

The model has no independent identity. It can select only the reads/proposals offered under the asking person's scope; an `execute` with `model: true` is invalid.

A declared view lets the browser show read results without model involvement. With `modelReads: "summary"`, that view's rows are replaced by a summary/count in the model response. Other capability results, search hits and user text need their own data-release assessment.

A `propose` result is preparation, not permission to perform its suggested write. Clew's human decision flow records the exact approval before source dispatch. See [actions and receipts](../guides/actions-and-receipts.md).

## MCP is a separate design

A public Clew MCP server for external agents is not implemented. Earlier designs describe projecting the registry into read/propose tools with user-bound authority and a release policy. Those designs do not establish a usable endpoint today.

A connector can separately wrap a source that speaks MCP, translating it into Clew's HTTP contract. This does not expose foreign tools directly to the model and does not change how the connector is registered.

## Trace the behavior

- [Capability routes](../../apps/server/src/routes/capabilities.ts): generic read/propose calls.
- [Business routes](../../apps/server/src/routes/api.ts): where the capability routes are mounted, and the separate decision routes.
- [Connector callbacks](../../apps/server/src/routes/connectors.ts): callback authority and dependency enforcement.
- [Registry](../../packages/connectors/src/index.ts): scope, governance, validation and tool derivation.
- [Card decisions](../../apps/server/src/threads/usecases/decisions.ts) and [execution ledger](../../apps/server/src/modules/executions/usecases.ts): approval through receipt.
- [Authorization boundary tests](../../tests/unit/authorization-boundaries.test.ts): regression evidence.
