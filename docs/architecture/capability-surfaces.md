# How capabilities are called

A capability has one name, kind, input/output contract and access policy. Clew's registry applies that contract to several callers. The caller's route determines whether a read, proposal or approved execution is allowed.

The [architecture overview](overview.md) explains the whole request flow. The [connector protocol](../reference/connector-protocol.md) defines the HTTP boundary a connector author implements.

## Current surfaces

| Surface | Caller and authority | Allowed operations |
|---|---|---|
| `GET /api/cap/:name?input=<json>` | Signed-in browser/person | `read` only. The answer is `{ output, source, view? }`: the declared view when present, with `view.people` mapping the user name each record names a person by to that person's id in the reader's organisation, so the record links to `/people/<id>`; a name nobody there holds is left out ([D122](../decisions/D122-clew-keys-its-own-records-about-a-person-by-the-persons-id.md)). |
| `POST /api/cap/:name` | Signed-in person, with mutation origin/CSRF checks | `read` or `propose`; body is the capability input itself. Executes are refused. |
| Model tools | Assistant inside the person's request | In-scope `read`/`propose` with `model: true`, narrowed by operator tool switches. |
| `POST /api/connectors/call` | Connector with a separate signed callback grant | Declared `uses` targets of kind `read`/`propose`, under the same person's current access. |
| Human decision routes | Person reviewing an action | Record approved intent; the execution worker later calls `execute` under current authority. |
| Connector HTTP routes | Clew, with signed actor assertion and transport key | The connector's declared reads/proposals, scans/figures, and approved executes. |

The two `/api/cap` routes are [capabilityRoutes](../../apps/server/src/routes/capabilities.ts), mounted inside the API with `api.route('/cap', …)` behind its session guard and its refresh of the connectors. Before it reads the input, each route asks the registry whether the capability exists for the person (`Registry.findFor`). `GET` answers 404 "Okänd förmåga." for a name that is unknown or not a read, and `POST` for one that is unknown or an execute. A capability hidden from the person gets the same 404, with the same body and headers, whatever the input: its connector switched off or leaving the person out of its audience, or the capability switched off ([D23](../decisions/D23-connectors-are-managed-in-the-database.md)). So does any "Okänd förmåga." raised while the capability runs: its connector switched off between the check and the call, a nested call to a capability hidden from the person, or a source's own refusal in those words. Input that is not JSON answers 400 "Ogiltig förfrågan.", and a `POST` body over 8,000 characters 400 "För stor förfrågan.". Input that its schema refuses answers 400 "Ogiltig förfrågan till <name>.".

A capability of a connector the person can see, whose scope leaves the person out, answers 400 "Du saknar behörighet för åtgärden.". D23 hides a connector by its audience and leaves finer rules to the manifest's scope, and `GET /api/connectors` lists the capabilities that exist for the person, each with `inScope` (`Registry.catalogueFor`), so the person may learn that such a capability exists. A capability switched off is left out of that listing, as it is left out of the model's tools, the menu and `/api/cap`.

The other surfaces answer the same cases in their own way:

- A model tool call (through `runCapability`) and a nested `clew.call` reach `Registry.run`, which refuses a hidden or unknown capability with "Okänd förmåga." and the scope with "Du saknar behörighet för åtgärden.". `clew.call` runs as a nested call, which refuses an execute with "En anslutning kan inte utföra åtgärder i en annan anslutning." on the capability it would run, looked up after its own read of the governance: one that exists for the person then is refused, one hidden from them is unknown, and one switched on, let in or registered between the call's read and the run's is refused too, so nothing runs. `Registry.run` itself never refuses an execute, since the execution ledger runs an approved one through it.
- The model's tool list holds only what the person may call, so it leaves out a hidden capability and one outside the scope alike.
- A card action (the decision, "Det här händer" and the review's preview) and `POST /api/executions` ask `Registry.allowed` first, which holds the scope, and answer a hidden capability, an unknown one and one outside the scope alike: 400 "Okänd förmåga.". A card names its own capabilities; an execution names the one the person approves.
- `POST /api/connectors/call` ([connector-callback.ts](../../apps/server/src/routes/connector-callback.ts)) answers as the published contract gives it (`/api/connectors/call` in the connector OpenAPI document): 404 `not-found` for a target that is hidden or unknown, the same answer for both; 403 `denied` for the scope, an execute, the target's own refusal of the person (its 403) and a grant for one of Clew's own connectors, whose `uses` is the unbounded `'*'` and which calls in process, never back through this route; 400 `invalid` for input, a circular call and a refusal of one of Clew's modules that carries no code; 503 `unavailable` for a target that is down, rejects Clew's key or assertion (its 401) or answers what Clew cannot verify. The registry's refusals and what a remote connector answers carry the protocol's code (`CapabilityError.code`), which is how the route tells a refusal from a failure; a remote connector's `denied` counts as a refusal only with its 403 (`remote.ts`). Anything else, Clew failing to read its own keys or the person among it, is logged through the route's `failed` and answered 503 `unavailable`. While Clew starts, the callback and the key set at `GET /api/connectors/jwks` answer 503 `unavailable` in the same shape and read nothing: [main.ts](../../apps/server/src/main.ts) mounts them ahead of the startup gate, which answers the rest of `/api` with a bare line for Clew's own pages.

The generic capability API is not an execution shortcut. Human decision routes include card actions, calendar decisions and `POST /api/executions`; cross-system jobs use `POST /api/jobs`. Their contracts are owned by the [business routes](../../apps/server/src/routes/api.ts) and use cases, not by the connector OpenAPI document.

## A connector author implements two required routes

- `GET /clew/manifest`: the connector's identity, capability schemas and optional presentation/features.
- `POST /clew/capabilities/{name}`: verified requests for the full capability name, with `{ actor, input }` and a response containing `output` or `error`.

Add scan/figure routes only for declared features. Clew derives browser invocation and model tools from the manifest. You implement the HTTP handlers and source mapping, not a frontend plugin or a second set of model tools.

For comparison, the browser's POST body is the raw capability input. The server-to-connector body wraps it in `{ actor, input }`. A browser session cookie and a connector assertion are different authentication mechanisms and are not interchangeable.

## What the registry does

[Registry.run](../../packages/connectors/src/index.ts) enforces capability scope, current connector governance and input/output validation. The [server wrapper](../../apps/server/src/connectors/registry.ts) and the [connector callback](../../apps/server/src/routes/connector-callback.ts) pass the person's reauthorization check into the registry. After refreshing governance, the registry checks current authority before dispatch and again before releasing the result, including for nested calls. Removing an audience group during a read therefore withholds its result even when the person's grant version stays the same.

Inside the process the actor carries the person's provisioned groups, which an audience's `groups` match. A request and the execution ledger hand the registry `audiencedActorOf(persona)`, the published actor with the groups; the refresh and a connector's callback hand it the whole authenticated context, which carries them too. A nested `clew.call` keeps the actor it was given, so Clew's own composites ask with the groups too. The groups never leave the process.

For a remote connector, [remote.ts](../../packages/connectors/src/remote.ts) makes the HTTP exchange, and every body it posts (a capability, a document, a figure, a scan) carries `actorOf(actor)`, the published actor and nothing more. The connector independently verifies identity and source access. For core functionality, the descriptor runs the local use case. UI visibility and model tool selection do not replace these checks.

The conformance check (`scripts/connector-check.ts` and "Testa anslutning" on the administration page, both [check.ts](../../packages/connectors/src/check.ts)) hands the registry its two people as the refresh does, with the whole authenticated context and a group (`asInProduction`). The check's requests therefore go through the same cut in `remote.ts` as production's, and its result holds for a connector that refuses anything beyond the published actor.

## Models and declared views

The model has no independent identity. It can select only the reads/proposals offered under the asking person's scope; an `execute` with `model: true` is invalid.

A declared view lets the browser show read results without model involvement. With `modelReads: "summary"`, that view's rows are replaced by a summary/count in the model response. Other capability results, search hits and user text need their own data-release assessment.

A `propose` result is preparation, not permission to perform its suggested write. Clew's human decision flow records the exact approval before source dispatch. See [actions and receipts](../guides/actions-and-receipts.md).

## Clew's own reads and the model

[D122](../decisions/D122-the-assistant-may-read-and-propose-whatever-the-person-who-asks-may-and-adding-a-model-is-answering-for-it.md) opens Clew's own domains to the assistant on the same terms as a connector's: a read is offered when it declares `model: true`, the person may call it, and neither the connector-wide assistant switch nor the read's own switch on Administration › Anslutna system is off. The built-in connectors (`calendar`, `clew`, `talks`, `competence`) are rows on that page like any other, so an administrator closes one of Clew's own reads from the model the same way; only `people` (D62) has no row.

| Read | To the model | Why |
|---|---|---|
| `competence.holdings` | Offered | The reader's own holdings, or a report's with the report's user name as `person`. |
| `competence.attention` | Offered (managers) | The requirements not met among the reader's reports (the product owner's definition of 2026-11-13, `competenceRequirementUnmet`): a type required of a report that is missing, has run out or soon runs out. A certificate nothing requires is not in it; its description tells the model to read the report's holdings (`competence.holdings`) for that. At most 500 rows, with `omitted` saying how many more there are. Each row carries the report's user name for a follow-up read. |
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

Which systems an answer read and when are facts the server knows: the message's `source` is the registry's names for the systems whose reads the turn made and that answered (`Assistenten` when it read nothing, or only what it was refused), `reads` lists each read with its row count or that it failed, and the message's time is the turn's. The transcript draws them under the answer ("Assistenten · läste Krav som inte uppfylls"). The model is not asked to write a source or a time; the prompt tells it not to, and a system's name and a time it writes as the answer's last sentence anyway are cut. The router's sentences carry none either.

Between turns the model is given the last twenty messages' text and, in the system prompt, one line per earlier answer saying when it was written and which reads it made, with their row counts ("Svaret kl. 13:59: Mina kompetenser (9 rader)."). It is never given what an earlier read answered: no tool result of an earlier turn reaches it. The prompt asks it to read again in this turn for any question about facts from a system, even one answered before, and to answer a question that is not about facts ("förklara det enklare") without a read. A follow-up about facts costs a read; it reads the source as it is now instead of trusting an answer from a moment that has passed.

## MCP is a separate design

A public Clew MCP server for external agents is not implemented. Earlier designs describe projecting the registry into read/propose tools with user-bound authority and a release policy. Those designs do not establish a usable endpoint today.

A connector can separately wrap a source that speaks MCP, translating it into Clew's HTTP contract. This does not expose foreign tools directly to the model and does not change how the connector is registered.

## Trace the behavior

- [Capability routes](../../apps/server/src/routes/capabilities.ts): generic read/propose calls.
- [Business routes](../../apps/server/src/routes/api.ts): where the capability routes are mounted, and the separate decision routes.
- [Connector callbacks](../../apps/server/src/routes/connector-callback.ts), served by [the connector routes](../../apps/server/src/routes/connectors.ts): callback authority, dependency enforcement and the contract's answers.
- [Registry](../../packages/connectors/src/index.ts): scope, governance, validation and tool derivation.
- [The assistant's runner](../../apps/server/src/assistant/index.ts) and [its reads](../../tests/unit/assistant-reads.test.ts), of Clew's own domains and two fixture connectors: the caller, the refusals, what a turn records, what the model reads, the card's rows and what is kept between turns.
- [The model's reading](../../packages/connectors/src/reading.ts), [the card's rows](../../apps/server/src/assistant/card.ts) and [the transcript's cards](../../apps/web/src/answer-card.ts).
- [Card decisions](../../apps/server/src/threads/usecases/decisions.ts) and [execution ledger](../../apps/server/src/modules/executions/usecases.ts): approval through receipt.
- [Authorization boundary tests](../../tests/unit/authorization-boundaries.test.ts), [capability route tests](../../tests/unit/capability-routes.test.ts) and [callback tests](../../tests/unit/connector-callback.test.ts): regression evidence.
