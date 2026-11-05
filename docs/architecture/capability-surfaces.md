# How a capability is exposed: REST, model tools and MCP

> **Reading status:** Design background. Generic capability REST calls cannot execute writes. External-agent MCP is designed, not implemented; new source integrations use the connector HTTP protocol, not an apps/mcp host. See [implementation status](../reference/status.md) and the [current protocol](../reference/connector-protocol.md).


For colleagues who need to know what "a connector is exposed via MCP and also callable deterministically"
means in Clew, and where the line between those runs. Written 2026-11-04 against the code as it is; each
surface says whether it is built.

## One descriptor, three surfaces

A connector does not write endpoints and does not write tools. It declares **capabilities**
(`packages/connectors`, the `Capability` type): a name, a kind (`read`, `propose`, `execute`), Swedish
title and description, TypeBox input and output schemas, a `scope` function, a `model` flag and a `run`
function. The registry projects every descriptor onto the surfaces below. Nothing in `apps/server/src/routes`
knows a connector by name.

```
                       ┌──────────────────────────────────────────────┐
  browser, scripts ───►│ 1. deterministic REST   GET/POST /api/cap/…  │
                       │                          POST /api/threads/… │
                       │                                              │
  the model (in BFF) ─►│ 2. model tools          registry.tools(actor)│──► registry.run(actor, name, input)
                       │                                              │     scope check · input validation
  external agents ────►│ 3. MCP server (Clew)    read + propose only  │     audit · the adapter
                       └──────────────────────────────────────────────┘
                                                                            │
                                            provider in-process ◄───────────┤
                                            connector (D21) ◄──────────┤   3b. the connector protocol
                                            foreign MCP server, wrapped ◄───┘       behind the contract
```

Everything goes through `registry.run` (`packages/connectors/src/index.ts`), which checks `scope` for the
actor and calls the capability. In the BFF that is wrapped by `runCapability` in `apps/server/src/connectors/registry.ts`,
which validates the input against the schema first and, for `execute`, re-checks the session's
authorization. So the three surfaces differ only in who is calling and how the call arrives; what is
allowed, validated and audited is the same code path.

| Surface | Who calls | Which kinds | Identity | Status |
|---|---|---|---|---|
| 1. Deterministic REST | The browser (buttons, panel views, standing actions), scripts, tests | `read`, `propose`, `execute` | The person's session cookie | built |
| 2. Model tools | The model inside the BFF, during a question or a thread reply | `read` and `propose` with `model: true`, in scope | The asking person; the model has no identity | built |
| 3. Clew as MCP server | A registered external agent (an Eneo assistant, a desktop agent) | `read` and `propose` with `model: true`, in scope, under a release policy | A user-bound OAuth 2.1 token | designed, not built |
| 3b. The connector protocol behind a remote connector | Clew's own BFF, as an HTTP client of a connector | All kinds; the service is the connector, not a public surface | A Clew-signed assertion per call naming the person; an audience-bound user token when token exchange exists (D5) | built (D21): `packages/connectors/src/remote.ts`, `connectors/hello` |

## 1. Deterministic REST: always there, never needs the model

This is the surface D8 guarantees: every capability is reachable without a model.

- `GET /api/cap/<name>?input=<json>` runs a `read` capability and returns `{ output }`, and `{ output, view }` when
  the capability declares how it is drawn (D38). Panel views and the "Gör själv" standing actions use it; a declared
  view's search field and choice rewrite `input` and read again.
- `POST /api/cap/<name>` with a JSON body runs any capability. `execute` re-authorizes the session first.
- `POST /api/threads/<id>/act` runs one of the card's actions: Clew resolves the action, merges its fixed
  input with the selected refs, runs the capability, and for `execute` writes the receipt, the audit row and
  the undo timer in one transaction.
- `POST /api/threads/<id>/confirm` is the human decision endpoint for calendar proposals: it re-validates
  every proposal against the live calendars before sending. It is an `execute` capability with
  `model: false`, which is the structural form of the guardrail "assistant proposals are executed only
  through a human decision endpoint that is not a tool".
- `GET /api/connectors` lists every connector and capability with its kind, whether it is a tool, and whether it
  is in scope for the caller. It is the quickest way to see what a given person can reach.

Input is validated against the capability's TypeBox schema before `run` is called. Errors shown to the
person are Swedish; everything else is English. OpenAPI for this surface is decided as Clew's output (D2)
and not generated yet.

## 2. Model tools: the same capabilities, filtered

When a person types in the composer or replies in a thread, the BFF may call the model (`ai` +
`@ai-sdk/openai-compatible`). The tools it offers come from `registry.tools(actor)`:

- only capabilities with `model: true`;
- only `read` and `propose`; the registry refuses to register an `execute` with `model: true` (D8);
- only those whose `scope` passes for the asking person.

A tool call runs `runCapability` as that person, with the same validation and scope as a REST call. The
model therefore cannot reach anything the person could not click, and cannot execute at all. What it can
do is choose and phrase: pick a `read` to answer with, or a `propose` to draft a card. The card's button is
REST. If the model is down, the intent router and typeahead take over, built on the same tool list.

A capability whose view says `modelReads: 'summary'` (D38) is run like any other, but the model is handed only that
the result is shown to the person and how many rows it has; the answer carries the view, and the person reads the
rows from the source. The model chooses the capability and its input and nothing else.

Tool names are derived from capability names; the model reads the Swedish `description`, so a connector
author writes that sentence for the model and the `title` for the button, and nothing else.

## 3. MCP: two different things with one name

MCP shows up in two places, and keeping them apart is the point of this page.

**3a. Clew as an MCP server, for external agents.** The registry projected once more, this time for a
client outside the BFF: an Eneo assistant that wants to ask "vad behöver jag göra i dag?" with Clew's
data, or a desktop agent. The rules are those of surface 2 plus a release policy per registered client
(trust boundary, classification ceiling, allowlist): `read` and `propose` only, every call as the user
with a user-bound OAuth 2.1 token per the MCP authorization spec, `execute` never exposed, confirmation a
human UI operation. Designed in `identity.md` and `integration-paths.md`; `@modelcontextprotocol/sdk` is
not installed. The directory exists in the code to make this cheap: `registry.tools` already returns
JSON Schema tool definitions.

**3b. MCP as a transport behind an adapter.** This is not a surface for anyone outside Clew. When a
pass-through connector's adapter must run out of process (its own network zone, release cadence or owner,
D3), the same provider package is hosted in `apps/mcp-<name>` and the BFF talks to it as an MCP client
with an audience-bound JWT for the user. The capability descriptors do not change; the connector does not
change; only the `run` function now crosses a process boundary. The same holds for a vendor's MCP server:
Clew wraps its tools in a Clew adapter behind Clew's contract (D4). A foreign tool passed straight to the
model is a per-tool allowlist entry with a `scope` rule, never the default.

So "the connector is exposed via MCP" can mean either that Clew offers the connector's reads to an external
agent (3a) or that the connector's adapter happens to speak MCP to its source (3b). The first is about who may
ask Clew; the second is about how Clew reaches a system. Neither changes what a connector author writes.

## What each surface may do, by kind

| Kind | REST (1) | Model tool (2) | Clew as MCP server (3a) | Who decides it happens |
|---|---|---|---|---|
| `read` | yes | yes, if `model: true` and in scope | yes, same filter plus release policy | the caller |
| `propose` | yes | yes, if `model: true` and in scope | yes, same filter plus release policy | the caller; the result is a card, not a change |
| `execute` | yes: a button, a card action, the confirm endpoint | never (registry refuses `model: true`) | never | the person, through the UI, with a receipt and undo |

Scope, input validation and audit are identical across the row. Names of individuals follow the product
rule, not the surface: they appear in a panel view or the source system, never in a card, whichever
surface produced the data.

## A worked example

`treserva.deviations` is a `read` with `model: true`, scoped to the unit's manager and to each employee's
own reports. `treserva.report` is an `execute` with `model: false`, and `treserva.withdraw` is its undo.

| Surface | What happens |
|---|---|
| REST | `GET /api/cap/treserva.deviations` returns the rows for the panel. Clicking "Rapportera avvikelse" posts `treserva.report` through the card action; the receipt shows the Treserva reference and a ten-minute undo. |
| Model tool | "Vilka avvikelser väntar på mig?" lets the model call `treserva.deviations` and answer with a Svar or a Vy. "Rapportera att en lyft gick fel" lets the model draft a card; the report is sent only when the person presses the button. |
| Clew as MCP server | An Eneo assistant registered with a release policy could call `treserva.deviations` as the user and get the same rows; it could not call `treserva.report`. Not built. |
| Connector | If Treserva's adapter had to live inside the care network, a `treserva` connector would serve the same three capabilities behind the connector protocol (D21); this table would not change. |

## Questions colleagues ask

- **Does an integration work without the model?** Always. Surface 1 is the primary one; surfaces 2 and 3
  are projections of it.
- **Does a connector author write MCP tools or REST routes?** Neither. They write capability descriptors;
  the registry derives the rest. See `docs/guides/creating-a-connector.md`.
- **Is MCP Clew's integration protocol?** No. The contract is Clew's and lives in TypeScript and TypeBox.
  A connector that runs out of process speaks the connector protocol (3b, D21); MCP is one surface Clew may offer to agents (3a).
- **Can an external agent make Clew change something?** No. It can read and propose; a person executes
  through the UI, and the receipt is read back from the source.
- **Where do I see what a person can reach?** `GET /api/connectors` while logged in as them, and the unit
  tests in `tests/unit/connectors.test.ts` that assert scope and tool derivation.
