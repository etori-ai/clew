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

What the model reads of one of Clew's own reads is derived from its view as for any connector's read (below): no read of Clew's own shapes it in code. A person the question names is given to the model with their user name (D115's lines and `clew.findPerson`), which is the key a read about one person takes, and a row of `competence.attention` carries it as the person its view names (`subject`); the registry resolves it like any other key. `competence.holdings` says in its description which row of a competence decides (giltigt, går ut snart, utgånget or saknas) and that a row waiting for approval, rejected or not counted decides nothing, even under the same name: the read lists one deciding holding per type, and its status words tell the others apart, on the page as to the model.

Every read the assistant makes goes through the registry as the asking person and says so: the assistant's runner passes `caller: 'assistant'` (`RunContext.caller`), which travels into nested in-process calls and reaches a capability as `clew.caller`, and is never sent to a remote connector. It is never `direct`, and the registry resolves a relation held by grant only for a `direct` call without a caller, so `registrar` (D121) is never resolved for the assistant: a registrar asking through the assistant is a colleague to everyone but herself. Where a read of a person is logged (the competence read log), the row records `caller`; the table refuses an assistant's row that is not one person's holdings read as `managed`. A turn's audit row lists each read the turn made through the registry with its row count, or that it failed (`details.reads`), beside the tool names; never a row. See [observability](observability.md).

Adding a model on Administration › Modeller is the administrator's statement that the organisation may process its data with it, personal data included: the page and its add dialogs say so, the dialog requires the confirmation, `AddModelInput.mayProcessPersonalData` is required and only `true`, and the `model.added` audit row records it. A provider's address and a model's id can still be changed after the model is added without asking again (D122 "Open").

## What the model reads of a read

Every read offered to the model is handed to it through `modelReading` ([reading.ts](../../packages/connectors/src/reading.ts)), the same for Clew's own reads and a remote connector's, derived from what the read declares and nothing it runs (a manifest carries no code, so nothing else could hold for every connector):

- A view with `modelReads: "summary"`: how many rows are shown and that they are, never what they hold (D38).
- A `table` or a `list`: `antal` (how many rows the read answered) and `rader`, each row as the view draws it, its fields' Swedish labels as keys and its title first. A status is the word the page shows (`VALUE_WORDS` in the contracts, which the web's labels use too); a number has its unit ("11 200 kr"); a `date` is written out with its year ("27 november 2027") and an `instant` with its weekday and time in Swedish time ("måndag 16 november 2026 kl. 09:00"). The row's `ref`, every property the view does not draw and `link` fields are left out; the key of the person or unit the row names (`subject`) is kept, as "Användarnamn" or "Enhetens id", since it is what a read about one of them takes. The scalar facts the output gives about the list as a whole (a routine's owner, when it was reviewed) come with it.
- A `detail` or a `record`: its labelled facts the same way, a record's item rows and its sections too.
- No view: the output's own keys, less the handles code uses (`ref`, `id`, `link`, a row's own `view` and the like), with dates and codes in words.

It is bounded: at most `READING_ROWS` rows and about `READING_CHARS` characters, cut by whole rows, with `utelämnade` and a note saying how many were left out. The server keeps the output as the registry answered it for the turn alone, to work out the card (below) and a document answer's citations; nothing of it is stored. Each tool's description ends with the system it comes from, by the registry's name ("Källa: Kompetens."), so a model that names a system names the right one.

## The card under an answer

The card under an answer is the read the answer rests on: the last read of the turn with a declared view, drawn with the input the model gave it, so a read the model narrowed (a person, a query) is the card with that input. Of its rows the card draws what the answer is about ([card.ts](../../apps/server/src/assistant/card.ts), `cardRows`), decided when the answer is written and kept in the message as `MessageMeta.viewRows`:

- `named`: the rows the answer names. A row is named when the answer writes the values the view draws as plain text (the title and every field without a format), the rows with the most such values winning, so "Anna Lindqvist saknar brandskydd" names Anna's Brandskydd row and not her HLR row; a view whose rows name a person also counts the first name. The model is never given a handle to cite, so none can leak into its prose: the names it writes for the person are what tie the card to the rows. Every named row is drawn, however far down the read it is; an answer that names more rows than a card keeps (`CARD_MARKS_MAX`) is its button alone, never an excerpt that leaves out what it names.
- `all`: the answer names no row and is about the read as a whole: the model narrowed the read with its input, or the answer says how many rows there are ("Tre fakturor väntar") or points at "vyn"; also when the model reads only a summary of the view, or the read answered nothing. The card is the read and its first rows; the sentence names none of them, so the excerpt leaves out nothing it names.
- `none`: the answer names no row of a read nobody narrowed and is not about all of it ("Ingen saknar truckkort"). An unrelated card is worse than none: the answer keeps its "Visa allt".

A message keeps the rows as marks (`rowMark` in the contracts): the connector's `ref` for the row when the view declares one, else a digest of what the view draws of it. A mark says nothing of the row; the browser reads the view again as the person and draws the rows whose marks match, and says so when the rows the answer rested on have changed since. A connector that declares `ref` keeps its rows recognisable while their values change.

Every answer keeps its card in the history: the latest answer's is drawn open and read; an older answer's stays folded in its place (Astryx's `Collapsible`), saying the view's title, its system and the count the turn recorded, and is read only when the person unfolds it, once, so opening a long conversation reads one view. A read that is logged when it is made (one person's holdings) is made then because the person asked for it. A figure line (D54) is drawn over a card only when the figure belongs to that read by its own declaration (`opens`) and the card is the read as a whole: a connector's figure is never drawn because another of its reads answered.

## Where an answer comes from, and what the model keeps between turns

Which systems an answer read and when are facts the server knows: the message's `source` is the registry's names for the systems whose reads the turn made and that answered (`Assistenten` when it read nothing, or only what it was refused), `reads` lists each read with its row count or that it failed, and the message's time is the turn's. The transcript draws them under the answer ("Assistenten · läste Kompetenser att åtgärda"). The model is not asked to write a source or a time; the prompt tells it not to, and a system's name and a time it writes as the answer's last sentence anyway are cut. The router's sentences carry none either.

Between turns the model is given the last twenty messages' text and, in the system prompt, one line per earlier answer saying when it was written and which reads it made, with their row counts ("Svaret kl. 13:59: Mina kompetenser (9 rader)."). It is never given what an earlier read answered: no tool result of an earlier turn reaches it. The prompt asks it to read again in this turn for any question about facts from a system, even one answered before, and to answer a question that is not about facts ("förklara det enklare") without a read. A follow-up about facts costs a read; it reads the source as it is now instead of trusting an answer from a moment that has passed.

## MCP is a separate design

A public Clew MCP server for external agents is not implemented. Earlier designs describe projecting the registry into read/propose tools with user-bound authority and a release policy. Those designs do not establish a usable endpoint today.

A connector can separately wrap a source that speaks MCP, translating it into Clew's HTTP contract. This does not expose foreign tools directly to the model and does not change how the connector is registered.

## Trace the behavior

- [Business routes](../../apps/server/src/routes/api.ts): generic read/propose calls and separate decision routes.
- [Connector callbacks](../../apps/server/src/routes/connectors.ts): callback authority and dependency enforcement.
- [Registry](../../packages/connectors/src/index.ts): scope, governance, validation and tool derivation.
- [The assistant's runner](../../apps/server/src/assistant/index.ts) and [its reads](../../tests/unit/assistant-reads.test.ts), of Clew's own domains and two fixture connectors: the caller, the refusals, what a turn records, what the model reads, the card's rows and what is kept between turns.
- [The model's reading](../../packages/connectors/src/reading.ts), [the card's rows](../../apps/server/src/assistant/card.ts) and [the transcript's cards](../../apps/web/src/answer-card.ts).
- [Card decisions](../../apps/server/src/threads/usecases/decisions.ts) and [execution ledger](../../apps/server/src/modules/executions/usecases.ts): approval through receipt.
- [Authorization boundary tests](../../tests/unit/authorization-boundaries.test.ts): regression evidence.
