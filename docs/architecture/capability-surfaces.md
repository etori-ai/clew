# How capabilities are called

A capability has one name, kind, input/output contract and access policy. Clew's registry applies that contract to several callers. The caller's route determines whether a read, proposal or approved execution is allowed.

The [architecture overview](overview.md) explains the whole request flow. The [connector protocol](../reference/connector-protocol.md) defines the HTTP boundary a connector author implements.

## Current surfaces

| Surface | Caller and authority | Allowed operations |
|---|---|---|
| `GET /api/cap/:name?input=<json>` | Signed-in browser/person | `read` only; result includes the declared view when present. |
| `POST /api/cap/:name` | Signed-in person, with mutation origin/CSRF checks | `read` or `propose`; body is the capability input itself. Executes are refused. |
| Model tools | Assistant inside the person's request | In-scope `read`/`propose` with `model: true`, narrowed by operator tool switches. |
| `POST /api/connectors/call` | Connector with a separate signed callback grant | Declared `uses` targets of kind `read`/`propose`, under the same person's current access. |
| Human decision routes | Person reviewing an action | Record approved intent; the execution worker later calls `execute` under current authority. |
| Connector HTTP routes | Clew, with signed actor assertion and transport key | The connector's declared reads/proposals, scans/figures, and approved executes. |

The generic capability API is not an execution shortcut. Human decision routes include card actions, calendar decisions and `POST /api/executions`; cross-system jobs use `POST /api/jobs`. Their contracts are owned by the [business routes](../../apps/server/src/routes/api.ts) and use cases, not by the connector OpenAPI document.

## A connector author implements two required routes

- `GET /clew/manifest`: the connector's identity, capability schemas and optional presentation/features.
- `POST /clew/capabilities/{name}`: verified requests for the full capability name, with `{ actor, input }` and a response containing `output` or `error`.

Add scan/figure routes only for declared features. Clew derives browser invocation and model tools from the manifest. You implement the HTTP handlers and source mapping, not a frontend plugin or a second set of model tools.

For comparison, the browser's POST body is the raw capability input. The server-to-connector body wraps it in `{ actor, input }`. A browser session cookie and a connector assertion are different authentication mechanisms and are not interchangeable.

## What the registry does

[Registry.run](../../packages/connectors/src/index.ts) enforces capability scope, current connector governance and input/output validation. The [server wrapper](../../apps/server/src/connectors/registry.ts) also checks the person's current authorization around the call.

For a remote connector, [remote.ts](../../packages/connectors/src/remote.ts) makes the HTTP exchange. The connector independently verifies identity and source access. For core functionality, the descriptor runs the local use case. UI visibility and model tool selection do not replace these checks.

## Models and declared views

The model has no independent identity. It can select only the reads/proposals offered under the asking person's scope; an `execute` with `model: true` is invalid.

A declared view lets the browser show read results without model involvement. With `modelReads: "summary"`, that view's rows are replaced by a summary/count in the model response. Other capability results, search hits and user text need their own data-release assessment.

A `propose` result is preparation, not permission to perform its suggested write. Clew's human decision flow records the exact approval before source dispatch. See [actions and receipts](../guides/actions-and-receipts.md).

## Clew's own reads and the model

[D122](../decisions/D122-the-assistant-may-read-and-propose-whatever-the-person-who-asks-may-and-adding-a-model-is-answering-for-it.md) opens Clew's own domains to the assistant on the same terms as a connector's: a read is offered when it declares `model: true`, the person may call it, and neither the connector-wide assistant switch nor the read's own switch on Administration › Anslutna system is off. The built-in connectors (`calendar`, `clew`, `talks`, `competence`) are rows on that page like any other, so an administrator closes one of Clew's own reads from the model the same way; only `people` (D62) has no row.

| Read | To the model | Why |
|---|---|---|
| `competence.holdings` | Offered | The reader's own holdings, or a report's with the report's user name as `person`. |
| `competence.attention` | Offered (managers) | What has run out, is missing or soon runs out among the reader's reports; each row carries the report's user name for a follow-up read. |
| `competence.coverage` | Offered (managers) | Counts over the reader's reports on a unit they manage; names nobody. |
| `competence.person`, `competence.unit` | Closed | Reads about an entity, for Personal and a unit's page; the loader holds every such read from the model (D97 item 7). |
| `competence.approval` | Closed | Exists only for the page an approval's card opens. |
| `calendar.today`, `.week`, `.day`, `.rooms`, `.freeTimes` | Offered | The reader's own calendar; `freeTimes` is also what a draft's meeting answer is planned from. |
| `talks.*`, `clew.talks`, `clew.commitments` | Closed | The talks profile never reaches a model until its own step of D122 (D96 item 6). |

What the model reads of one of Clew's own reads can differ from the output the page gets: `Capability.forModel` (in-process only; a manifest carries no code) gives the words a person reads instead of status codes, no internal ids, and at most a bounded number of rows with a count of the rest. The calendar's free times come in Stockholm time with their offset and in words, never as UTC instants. A person the question names is given to the model with their user name (D115's lines and `clew.findPerson`), which is the key a read about one person takes; the registry resolves it like any other key.

Every read the assistant makes goes through the registry as the asking person and says so: the assistant's runner passes `caller: 'assistant'` (`RunContext.caller`), which travels into nested in-process calls and reaches a capability as `clew.caller`, and is never sent to a remote connector. It is never `direct`, and the registry resolves a relation held by grant only for a `direct` call without a caller, so `registrar` (D121) is never resolved for the assistant: a registrar asking through the assistant is a colleague to everyone but herself. Where a read of a person is logged (the competence read log), the row records `caller`; the table refuses an assistant's row that is not one person's holdings read as `managed`. A turn's audit row lists each read the turn made through the registry with its row count, or that it failed (`details.reads`), beside the tool names; never a row. See [observability](observability.md).

Adding a model on Administration › Modeller is the administrator's statement that the organisation may process its data with it, personal data included: the page and its add dialogs say so, the dialog requires the confirmation, `AddModelInput.mayProcessPersonalData` is required and only `true`, and the `model.added` audit row records it. A provider's address and a model's id can still be changed after the model is added without asking again (D122 "Open").

## MCP is a separate design

A public Clew MCP server for external agents is not implemented. Earlier designs describe projecting the registry into read/propose tools with user-bound authority and a release policy. Those designs do not establish a usable endpoint today.

A connector can separately wrap a source that speaks MCP, translating it into Clew's HTTP contract. This does not expose foreign tools directly to the model and does not change how the connector is registered.

## Trace the behavior

- [Business routes](../../apps/server/src/routes/api.ts): generic read/propose calls and separate decision routes.
- [Connector callbacks](../../apps/server/src/routes/connectors.ts): callback authority and dependency enforcement.
- [Registry](../../packages/connectors/src/index.ts): scope, governance, validation and tool derivation.
- [The assistant's runner](../../apps/server/src/assistant/index.ts) and [its reads of Clew's own domains](../../tests/unit/assistant-reads.test.ts): the caller, the refusals and what a turn records.
- [Card decisions](../../apps/server/src/threads/usecases/decisions.ts) and [execution ledger](../../apps/server/src/modules/executions/usecases.ts): approval through receipt.
- [Authorization boundary tests](../../tests/unit/authorization-boundaries.test.ts): regression evidence.
