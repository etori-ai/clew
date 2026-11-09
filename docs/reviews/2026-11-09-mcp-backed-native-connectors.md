# Building a Clew connector over an MCP server

**Date:** 2026-11-09  
**Status:** Exploration and recommendation; no new connector or product decision is implemented here.

Yes. An MCP server can be the source API behind an ordinary Clew connector. The connector translates selected MCP operations into Clew's capabilities, views, work items and approved actions. The MCP provider can remain unchanged.

For Medarbetarpuls, this is enough to build a native read and discover pending work. It is **not yet enough to reproduce the complete poll interaction as a native Clew screen**: the current view catalogue has no general answer form, and the provider lacks durable submission lookup and historical poll reads.

The practical recommendation is to preserve direct MCP integration, prove a small native adapter against the same independent poll server, and then choose whether answering should remain in its MCP App or use a new, bounded native form. A generic “convert MCP to connector” feature should generate a draft mapping for review, not silently promote every discovered tool into Clew work.

## The available choices

| Choice | What the employee gets | Who builds the integration | Current position |
|---|---|---|---|
| Direct MCP service | An attributed delivery card opening the provider's poll App; provider controls the inner experience | Clew operator registers access and a read watch; vendor supplies standard MCP | Working development prototype |
| Native connector backed by MCP | Clew views, areas and native work items; approved source writes where input and recovery are supported | Municipality, integrator or vendor writes a standalone adapter | Existing connector protocol supports the adapter pattern; no poll connector exists |
| Native work item opening an MCP App | Clew manages the work lifecycle while the provider supplies the answering UI | Adapter plus a generic Clew handoff between work items and MCP interactions | Proposed; no first-class handoff or completion binding today |
| Provider implements both protocols | Native Clew integration and portable MCP tools over the same source records | Provider implements a Clew endpoint alongside MCP | Architecturally compatible; requires provider development |

The second choice follows [D4](../decisions/D04-foreign-mcp-servers-are-wrapped.md). The first follows [D81](../decisions/D81-mcp-apps-extend-ai-chat-with-provider-owned-interactions.md). A provider can support both, but the operator should choose one delivery owner for each kind of work so a poll does not appear twice.

MCP itself does not require a language model to invoke a tool. Deterministic application code can call it. Clew's restriction of the direct MCP lane to AI-enabled users is a **product policy**, not a transport limitation. A native connector using MCP internally can work without an AI model under the existing native-connector policy. See the [MCP interaction model](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) and [Clew's two integration lanes](../architecture/mcp-chat-services.md#two-integration-lanes).

## What the fake poll actually provides

The independent [provider implementation](../../fixtures/mcp-pulse/service.mjs) exposes:

| Surface | Actual data or behavior | Integration consequence |
|---|---|---|
| `get_pending_poll({})` | `structuredContent: { pollId, week, answered }`; a short text summary | Enough for a tested identity and unanswered rule |
| Result `_meta.poll` | Current id, week, title, question and answered state | Human-facing data; keep it outside model context |
| `pulse://me/pending` | JSON resource containing the current poll | Another read path for an adapter; does not provide history |
| `ui://employee-pulse/poll.html` | Standard MCP App HTML, linked from the read tool | Existing answering interface can be retained in the MCP lane |
| `submit_poll({ pollId, score })` | Integer score 1–5; requires the current poll; returns receipt id, poll id and acceptance | Can underlie an approved action; score does not appear in its receipt |
| Repeat submission | Same score returns the same receipt; a different score fails | Synthetic in-memory behavior, not durable operation-key deduplication |

There is one synthetic provider identity, one current poll and an in-memory answer map. Registering the endpoint for two Clew people would not give them independent source accounts. The fixture does not implement OAuth, multiple pending invitations, expiry, question revisions, historical reads, operation-id lookup or withdrawal.

The read tool has no declared `outputSchema`. A wrapper must validate the particular result shape it depends on, and fail visibly if it changes. The score schema describes a valid argument; it does not describe the complete question presentation, choice labels, respondent permissions or retention policy.

The source defines an internal resource notification hook, but its [HTTP transport](../../fixtures/mcp-http.mjs) is POST-only and does not deliver a server stream. The current host does not subscribe. Background delivery today comes from scheduled reads, not provider push.

### The direct MCP path already works in development

[Registration](../../scripts/dev-mcp.ts) allowlists the read and submit tools. Its watch uses `/pollId` as identity and `/answered == false` as eligibility. Temporal performs the read, and Clew persists a deduplicated delivery. Opening it fetches the current tool result and App resource. A changed poll identity prevents an old card from opening the new week's poll.

The [human decision endpoint](../../apps/server/src/mcp/usecases.ts) validates the selected tool and arguments, records approval before dispatch, and replays a saved receipt for the same decision. An ambiguous response remains unknown and is not automatically retried.

These are separate MCP delivery and decision records. They do not acquire native work-item dismissal, snooze, completion, job participation or undo merely because their cards look similar. Production OAuth, general model tool routing, a complete Apps host, unread/expiry and attention handling remain unfinished. See [implemented behavior and gaps](../architecture/mcp-chat-services.md#scope-of-the-runnable-mock).

## What a native adapter would look like

The request path would be **Clew → independent poll connector → MCP client → poll MCP server**. The browser still talks to Clew; the provider still receives ordinary MCP requests. The adapter owns the translation and source authorization.

It would expose the existing `GET /clew/manifest`, selected `POST /clew/capabilities/<name>` routes and, when declared, `POST /clew/scan`. It verifies Clew's signed actor assertion and transport key, resolves that actor's provider identity, invokes approved MCP operations and validates their outputs.

This needs no new connector protocol merely because the upstream API is MCP. Follow the [connector guide](../guides/creating-a-connector.md) and [authorization guide](../guides/authorization.md).

### A concrete poll mapping

The following are proposed capability names and responsibilities, not an implemented manifest.

| Clew surface | MCP source | Adapter responsibility |
|---|---|---|
| `pulse.current`, read | `get_pending_poll`, optionally the JSON resource | Return a native detail/record view of current invitation and status; keep personal details model-ineligible or summary-only |
| `/clew/scan` | Current pending-poll read | Create one native occurrence for the unanswered invitation; supply source, reason and stable identity |
| `pulse.poll`, read with a poll reference | Current read plus identity comparison | Refuse to substitute a new poll for an old reference; historical detail is unavailable today |
| `pulse.submit`, execute, `model: false` | `submit_poll` | Validate actor, poll and approved score; map source confirmation into an `ExecuteResult` |
| Optional area figure | Authorized pending-work read | Show only what can be established, such as one current invitation; do not invent team analytics |
| Future `pulse.receipt`, read | A future source receipt/operation lookup | Establish the outcome of the original submission; unavailable from the present fixture |

For scans, a stable grouping topic could identify employee-pulse work, with the source poll id as occurrence key and a full period such as `2026-W46`. A material revision should describe changed question/eligibility evidence, not the time of each check. A connector must validate any fixture-specific period mapping; the current week counter is not a production recurrence model.

The source exposes only the current poll. Advancing a week does not prove that the previous unanswered poll was completed or expired. Until the provider supplies authoritative absence/closure evidence, return a partial observation and preserve unresolved old work. Only a complete authorized result or an explicit source-backed tombstone can justify removal. Native scan completeness is specified in [actions and receipts](../guides/actions-and-receipts.md#scan-an-occurrence-into-a-card).

For writes, start with the native `manual` execution strategy. Pass the approved poll id and score, require positive source evidence for success, and retain an unknown outcome after a lost response. Do not copy `idempotentHint: true` into Clew's stronger `deduplicated` declaration. A persisted adapter receipt can replay a known result, but cannot close the crash gap between an upstream commit and saving that receipt.

Likewise, `answered: true` can establish that the poll is answered; it cannot prove which uncertain operation submitted which answer. That distinction matters for reconciliation. The provider has no undo operation, so the connector must not offer undo.

### The missing native answer surface

The current [view contract](../../packages/contracts/src/index.ts) supports lists, details, text, records, documents, metrics, series and activity. Its read filters are not arbitrary write forms. Card actions carry fixed input plus selected item references; they do not collect a score. The [document correction form](../../packages/contracts/src/presentation.ts) is a bounded recovery mechanism for reviewed records, not a general survey form.

There are three sensible routes:

1. **Keep the MCP App.** This preserves the provider's questions and controls. It works in the direct MCP lane now; opening it as a first-class native work-item action would need the handoff described below.
2. **Add a bounded native form capability.** Useful if several connectors need short, structured user input. Define supported field types, validation, source revision binding, confirmation, cancellation and sensitive-value handling. Clew renders it with Astryx. This is a product/protocol extension, not something discovery provides automatically.
3. **Link to a provider's respondent page.** Native read actions already support source links. The source must supply a real authorized respondent URL; the fake poll does not have one. A `ui://` resource is not a browser page URL.

Five prefilled execute buttons would be a poor substitute for a supported answer form. Asking the model to collect the score would also place an employee's answer in conversation history.

## Combining native work with the provider App

This is the most useful longer-term option when Clew should track a task but the provider already has a good interaction.

Hillevi would see a native “Svara på veckans enkät” work item. She could postpone or dismiss it using Clew's normal controls. Opening it would load the provider App for that exact invitation. After she submits and the provider confirms acceptance, Clew would re-read source evidence and update the native work item. Dismissing the work would never count as answering the poll.

That requires a small explicit host contract, including:

- A binding from connector + occurrence + source reference to the registered MCP connection, tool, arguments and App resource.
- A fresh authorization check for both integration lanes, including the same provider account; matching titles or URLs are insufficient.
- One execution owner for the submission, with approval bound to immutable arguments. Do not dispatch once through the connector and again through the App.
- Completion based on verified source evidence. Closing the iframe or receiving an untrusted browser “done” message is not proof.
- A single delivery owner, so the direct MCP watch and native scan cannot produce duplicate invitations.
- Defined reopen, source-change, revocation and unavailable-App behavior, with no automatic mounting of a later poll in an earlier work item.

A normal link to the existing service route could provide navigation during an experiment, but would not establish these lifecycle guarantees. Current native read actions do not carry a standard MCP App launch descriptor.

[D81](../decisions/D81-mcp-apps-extend-ai-chat-with-provider-owned-interactions.md) limits provider Apps to the AI-enabled lane. Extending them into native work surfaces, particularly when AI is disabled, needs an explicit product decision. The native adapter's model-independent reads and scans do not require changing that decision.

## What Clew should support

### Keep standard MCP usable on its own

A provider should not need a Clew manifest to use the direct MCP lane. Continue standard discovery, selected tools and optional Apps, with ordinary results usable when there is no App. Add production account binding/OAuth, source access checks, complete Apps isolation and lifecycle support, and tested watch behavior before opening this prototype to real providers.

Use Streamable HTTP as the remote baseline. A local `stdio` server can sit behind an operator-managed adapter or gateway; a shared Clew web UI should not launch arbitrary server commands. The current poll test establishes compatibility with the fixture's negotiated `2025-11-25` core protocol and `2026-01-26` Apps subset, not every feature of the newer [2026-07-28 protocol](https://modelcontextprotocol.io/specification/2026-07-28/server/tools).

### Make native adapters easier to write

Provide an optional example or reusable library for transport, discovery, source authentication, schema validation and error mapping. Keep business mapping explicit and versioned. A standalone connector must not import Clew server internals; the existing [host client](../../apps/server/src/mcp/adapters/http.ts) illustrates the transport but its current resource port only returns App HTML.

An authoring tool could inspect an MCP catalogue and generate **disabled draft capabilities**. An integrator would then supply the missing scope, actor mapping, output transformation, view and lifecycle rules. Generating files is useful; automatic activation and unrestricted runtime conversion are not.

| MCP gives the adapter | Clew still needs an explicit contract |
|---|---|
| Tool name, description and input schema | Stable capability name, permitted audience, input limits and operation kind |
| Structured output, optionally an output schema | Validated native shape and fields suitable for display/model use |
| Tool annotations | Reviewed authorization, background-read and recovery policy |
| Resource URI or App metadata | Resource interpretation and permitted presentation |
| A pending-work result | Stable occurrences, recurrence, completeness, closure and attention behavior |
| A successful tool result | Source evidence for a receipt and a defined unknown-outcome policy |
| A change notification | Re-read/reconciliation logic, durable deduplication and delivery eligibility |

MCP tool schemas and annotations help with discovery. They do not establish Clew's domain semantics, and annotation hints from untrusted servers cannot be treated as authorization or replay guarantees. See [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools). Resource subscriptions are optional and report changes; a host still determines what those changes mean for its users. See [MCP resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources).

If repeated integrations need the same mapping rules, introduce an **integrator-owned mapping profile** as authoring configuration. It should remain optional for vendors and produce the existing native contract. Start with explicit code for the poll before committing to a mapping language.

### Preserve identity and answer privacy

The Clew assertion authenticates a request to the connector; it is not automatically a valid token for the MCP provider. Bind verified Clew identities to provider accounts and use credentials accepted for that provider. Scheduled work also needs source authorization that survives the interactive session; Clew's native scans do not receive delegated session tokens. Do not substitute an administrator's broad account. MCP's [authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) requires audience-bound access tokens and does not guarantee refresh-token issuance.

An App-only submission tool should stay out of model tools. Standard Apps metadata separates model-facing results from UI interaction and supports App-only tool visibility; it does not itself grant permission to write. See the [MCP Apps specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx).

The present MCP decision path stores a keyed argument fingerprint and an encrypted receipt, without persisting the raw score as a decision payload. Native durable execution, by contrast, [seals and retains its approved input](../../apps/server/src/modules/executions/adapters/postgres.ts). Moving the score into that path changes retention even though the data is encrypted. A native implementation needs an explicit retention choice, or a source-supported opaque submission reference; `model: false` alone does not solve storage.

Keep answers out of pushed cards, audit details, analytics facts and cross-connector jobs. A completion fact should be opt-in and disclose only the minimum necessary status. The fixture is not an anonymous-survey implementation, and withholding the score from a receipt does not establish anonymity.

## Recommended next steps for Medarbetarpuls

1. **Prove native reads and work discovery.** Build one independent `pulse` connector calling the unchanged MCP server. Add a detail view, a scan, explicit current-reference validation and honest partial observations. Test without a model and use an isolated provider instance so the fixture's single account is not shared with the running demo. Give the test audience one delivery owner. The current MCP registration couples service availability to a watch; independently disabling delivery while keeping the App available would need a host change. This slice proves the adapter pattern without a new form or hybrid contract.
2. **Make the provider representative of real work.** Add persistent per-person invitations, a stable read by invitation id, explicit revision/expiry/closed state, validated output schemas, and durable submission identity/lookup. Keep these as ordinary MCP tools/resources with no Clew-specific requirement. Never rely on fixture-control endpoints for application behavior.
3. **Choose the answering experience.** Prefer the App handoff if provider-owned interactions are the intended product direction. Prefer a bounded native form if consistent, model-independent data entry is needed across several integrations. Approve the relevant contract and retention behavior before implementing either.
4. **Exercise completion and recovery.** Verify identity separation, unauthorized refs, source changes after opening, answer elsewhere, duplicate approval, response lost after commit, provider restart, revoked background authorization, and no duplicate delivery. Test that an old poll never opens a new one and that answer values do not reach model context or audit metadata.

Search, multi-system jobs, manager figures and undo should be added only when the source exposes useful and authorized semantics for them. A poll adapter need not implement every Clew feature to be a useful connector.

## Evidence and verification

This exploration follows the working checkout, including its in-progress MCP implementation. Implementation references above are more precise evidence than earlier decision intent.

On 2026-11-09, the existing poll/host unit suites passed **9 tests** and the isolated official-client HTTP interoperability case passed **1 test**, using the development container. The runtime case starts its own synthetic provider and exercises discovery, App retrieval, submission and the next poll; it does not submit an answer to the running demonstration account.

The native wrapper, hybrid handoff and native form remain proposals. The tests establish the current synthetic MCP behavior, not production OAuth, a completed connector, or real-provider compatibility.
