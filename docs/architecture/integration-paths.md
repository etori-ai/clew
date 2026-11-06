# Integration paths

> **Reading status:** Historical landscape and integration options. Status labels below describe earlier reviews, not a current support commitment. Environment-based model setup, MCP hosting and future SCIM descriptions are not setup instructions. See [implementation status](../reference/status.md) and the [current protocol](../reference/connector-protocol.md).


The catalogue of ways a system can be connected to Clew, what each path is for, and what is built. The
principles are in `integrations.md` (Clew owns the contract, D1; integrations fulfil it first, D10; three
connector kinds, D3). This file is the menu you pick from when a new system arrives. Much of it is carried
over from the startsidan repository (docs 08, 13, 14, 16, 18, 19, 33 and ADR-094), reduced to what Clew
needs; the startsidan concepts that do not survive are listed at the end.

Status words: **built** runs in this repository today; **decided** has a decision number and a place in the
code but is not implemented; **designed** is written down in `docs/architecture/` without a decision on
when; **open** is not decided.

## How to choose

Ask three questions about the system, in this order.

1. **Who owns the data?** If the records live in the other system and Clew only needs refs and audit, it
   is a pass-through connector. If Clew computes a figure from them on a schedule, it is derived. If nobody
   else owns the domain, Clew owns it: a core connector (see `docs/vision.md`, "Owning the model").
2. **Can the system meet Clew's contract itself?** Ask first (D10). A vendor, a dept44 service or another
   municipality that implements the connector's provider interface needs none of the adapter paths below.
3. **Which direction and which verb?** Read, propose, execute, notify, provision. Each is a row in the
   tables that follow. A system usually needs two or three rows, never all.

Then pick the transport and the auth mode. Those are deployment choices, not architecture (D1).

## Paths into Clew: reading and being told

| Path | What it is | Clew contract | Auth | What Clew stores | Status |
|---|---|---|---|---|---|
| **Native fulfilment** | The system implements Clew's provider interface for the domain directly. No adapter. | The connector's provider interface and its `read` capabilities | Whatever the contract specifies, normally `user-delegated` | Refs and audit only | built as the connector protocol (D21): the owner runs a connector, Clew is configured with its URL; `connectors/hello` is the reference, no real system does it yet |
| **Pass-through read** | An adapter reads live rows from the source on each request, as the user. Request-only: nothing is cached or logged beyond refs. | `read` capabilities of a pass-through connector; `CalendarProvider` is the model | `user-delegated`, `bound-credential` or `service` with a `scope` rule | Refs, revisions, audit rows | built for CalDAV (`packages/calendar`); the fixture connectors `hr`, `finance`, `incidents`, `communication`, `timesheet` and `payroll` (generic systems as independent services, D52, D61); Graph adapter decided (D11) |
| **Derived snapshot** | A scheduled job reads a pass-through connector or a reviewed aggregate feed and stores a figure or a count. Aggregates over personal data are produced inside the source trust boundary (startsidan's edge aggregates), never by Clew reading rows with a service account. | A derived connector's `read` capabilities; the job in the Postgres scheduler | `service` with a `scope` rule, or a reviewed aggregate endpoint | The snapshot, with period and source | built with synthetic figures (`apps/server/src/figures.ts`); real source open |
| **Search fan-out** | One query from the composer goes to every connector in the person's scope that declares a `search` read capability; results come back as objects with refs and link-outs, merged and ranked by Clew. People come from the organisation's directory as a pass-through connector (Metakatalogen in Sundsvall); Clew's own `people` core connector holds only the essentials from SCIM. Document and case content is searched in the source as the user, and through Eneo's retrieval when the `eneo` connector is installed. Request-only; Clew indexes nothing of other systems' content. | A `read` capability named `<connector>.search` returning `SearchHit` rows (ref, kind, label, snippet, link, source, owner, dates), a `<connector>.fetch` for one ref, and the composite `clew.search` in `apps/server/src/modules/search/` that asks every source at once under a budget | As the pass-through read behind it | Nothing beyond audit and the refs an answer cites | built (D26): the composite, the router's catch-all, citations, the sources view, the document chip and the card from an answer; `connectors/eneo` is the first source |
| **Scan trigger** | A connector's `scan` function looks at the source for this person and returns thread drafts: what needs them now. Deterministic, no model. Runs nightly and on demand. | `Connector.scan` in `packages/connectors`; `topic` is the idempotency key per person | As the pass-through read behind it | The thread, its state and audit | built (`scan-utvecklingssamtal`, the fixture connectors) |
| **Change notification** | The source tells Clew that something changed so the page re-reads. Payload-free event (`key`, `revision`, `outcome`, `actor`, `observedAt`), consumers re-read under their own authorization. | CloudEvents 1.0 over HTTP to `POST /api/events/<source>`, stored on a Postgres event log, as in startsidan doc 33; an accepted event runs the connector's scan or signals a waiting workflow | Per-source shared secret, Standard Webhooks signature with replay window; consumers use the user's | The event row, digests only | proposed (D19); v1 relies on scan and on receipts read back after execute |
| **Identity provisioning** | The IdP pushes users and groups into Clew's core tables. Clew is the SCIM server. Only the essentials land here (subject, name, unit, role, groups); the full employee record stays in the directory and is read as pass-through. | SCIM 2.0 inbound on the `people` core connector | Long-lived bearer issued by Clew for the IdP | Users, groups, derived roles | designed (`identity.md`), not built |
| **Login** | A person is identified through OIDC. The only identification path. | OIDC Authorization Code + PKCE, opaque server session | Keycloak in dev; the municipality's IdP in production (D5, rewording pending) | Session, subject binding | built |

## Paths out of Clew: acting on systems

| Path | What it is | Clew contract | Auth | What Clew stores | Status |
|---|---|---|---|---|---|
| **Execute through a human decision** | A card's primary button runs an `execute` capability. The server re-validates against the live source, dispatches, reads the result back row by row (sent, moved, unknown, not sent) and renders a receipt with an undo countdown. Never a tool for the model (D8). | `execute` capability with `model: false`; `ExecuteResult` with `rows`, `undoCapability`, `undoMinutes` | As the adapter's mode | Execution record, receipt, audit row in the same transaction; never the source payload | built (calendar invitations over CalDAV; the fixture connectors) |
| **Propose** | The model or a deterministic planner drafts a change as a card. Nothing reaches the source until the human decision above. | `propose` capability; proposals carry the refs they depend on | None against the source | The proposal and its revision | built (week planner; conversation drafts, D12) |
| **Undo** | A compensating `execute` capability within a window. The receipt names it. Irreversible effects have no undo and the card says so. | `undoCapability` on the result | As the adapter's mode | Second audit row | built (ten minutes, calendar) |
| **Link-out** | A deep link into the source system, rendered as a secondary action ("Se i personalsystemet") or inside a view. The universal fallback: any system with a URL template per entity type gets this for free, even with zero adapters. | A thread action with `target: 'link'` on a `read` capability (`ThreadAction` in `packages/contracts`), or a link template on the connector | None; the user logs into the source with their own SSO | Nothing | built as connector secondary actions; link templates per system open |
| **RPA-backed execute** | For a system with no API (the HR system today), an adapter dispatches through the municipality's RPA layer. The outcome is `unknown` until read back, so the receipt stays grey and a reconciliation job checks later. | Same `execute` contract; the adapter would declare that outcomes are unknown until read back (field not designed yet) | `service` with `scope` | Execution record with `unknown` status until reconciled | open; v1 says Personalsystemet is read plus link-out |
| **Notify a person** | Clew delivers thread state over a channel: the page, push for same-day deadlines, an e-mail digest at bundle times. Not an integration with the source. | Thread state plus the attention budget | Mail relay or push service credentials | Delivery record | page built; push and digest open (canvas rows) |

## Transports and hosting shapes

The contract never changes with the transport. Pick the first shape that works and move down only when a
condition in the last column holds.

| Shape | Where the adapter runs | How Clew reaches it | Identity across the hop | Move to the next shape when | Status |
|---|---|---|---|---|---|
| **In-process** | Inside the BFF (`apps/server`), as a package | Function call | The `Actor` object | Never by default | built |
| **Connector** | Its own container, `connectors/<name>` in this repository or anywhere else, behind the connector protocol | HTTP client of the manifest and four routes (`packages/connectors/src/remote.ts`) | A Clew-signed assertion per call naming the person; an audience-bound user token when token exchange exists (D5) | The default for every new integration (D21); in-process only for Clew's core | built: loader, callback, checker, `connectors/hello` |
| **REST or SOAP behind a gateway** | The source's own API, in Sundsvall usually a dept44 service behind WSO2 | HTTP from the adapter with an API key | `service` mode; Clew narrows every call with `scope` before it leaves the process | Only when the source has nothing better | decided (D10); no real adapter yet |
| **Foreign MCP server** | A vendor's or another municipality's server | MCP client | Their authorization server; cross-domain ID-JAG when it exists, `authorization_code` as logged fallback | Wrapped by a Clew adapter by default; a per-tool allowlist with a `scope` rule is the exception (D4) | designed |
| **Native protocol** | CalDAV, IMAP, Graph | Protocol client in the adapter | `bound-credential` or `user-delegated` | When the source speaks a standard | built (CalDAV) |

What is deliberately not offered: a message broker as the integration transport (NATS was removed from the
devcontainer; the scheduler and the future event log are Postgres), a connector host image that loads
plugins at start-up, and a Java connector SDK. Startsidan designed those for a federated query engine
over many sources; Clew's connector kinds do not need them. If a source must run next to a restricted
network, that is a connector (D21).

## Auth modes, once more

Every adapter declares exactly one. Details and the token flows are in `identity.md`.

| Mode | Source accepts | Mechanism | Scope enforcement |
|---|---|---|---|
| `user-delegated` | tokens from the shared IdP, or from Entra for Microsoft 365 | OAuth 2.1 token exchange (RFC 8693), audience = the source; for Graph an Entra-issued token (HANDOVER item 10) | The source sees the user and applies its own |
| `bound-credential` | its own accounts | Per-user credential sealed in Clew's DB (the CalDAV calendar today) | The source sees the user |
| `service` | one integration account | Clew's `scope` rule narrows every call before it leaves the process; a service account never reads personal rows outside a reviewed aggregate | Clew, on every call, in the registry |

A dev session (D6) gets no downstream tokens; `user-delegated` adapters return `unknown` under it.

## Paths for the model and for other agents

| Path | What it is | Contract | Auth | Status |
|---|---|---|---|---|
| **Model endpoint** | The question box and thread replies use an OpenAI-compatible chat completion endpoint with tool calling and structured outputs. Open-weight and self-hosted is the reference path; a closed model is an operator's choice. The model is optional (D8). | `ai` + `@ai-sdk/openai-compatible`; tools from `registry.tools(actor)` (only `read` and `propose` with `model: true`, within scope) | `AI_*` in `apps/server/.env.local` | built (model path with router fallback, session 5) |
| **Eneo as inference provider** | An Eneo installation is pointed at as the model endpoint, so models, keys and security classifications are administered once, in Eneo. | Same endpoint contract; needs tool-calling passthrough on Eneo's side | Eneo API key or the user's token, to verify | open; see `docs/vision.md` and D14 |
| **Eneo knowledge as a tool** | `eneo.search` and `eneo.fetch` as `read` capabilities of an optional `eneo` connector, scoped to the user's spaces, one source behind the composite `clew.search` tool, so an answer can cite the leave policy. | A pass-through connector like any other: `connectors/eneo`, searching the person's collections through Eneo's per-collection retrieval endpoint | `user-delegated`: the manifest's `delegation` makes Clew hand it a token exchanged for the audience `eneo`, which Eneo accepts in its resource-server mode | built (D26) against recorded Eneo answers and the dev Keycloak; not yet run against a real Eneo |
| **Clew as MCP server for external agents** | Clew's `read` and `propose` capabilities exposed to a registered client (an Eneo assistant, a desktop agent). Every call runs as the user, with a release policy per client (trust boundary, classification ceiling, allowlist). `execute` is never exposed; confirmation is a human UI operation. | The same registry, projected as MCP tools; user-bound OAuth 2.1 bearer per the MCP authorization spec | Per-user tokens. Eneo could only hold a static bearer for one person as of 2026-10-07 (startsidan ADR-094), so an Eneo registration acts for that one person until Eneo gains per-user credentials | designed; the registry already derives tool definitions |
| **Declared views** | A connector says how a read's output is shown (a table, a list, one record, a text; fields with a Swedish label and a format; a search field and a choice bound to the capability's input) and Clew draws it with Astryx, in the side panel and under an answer, with or without a model. Replaces the connector-rendered MCP App views of D9: nothing a connector sends is markup, and nothing is an iframe. | D38, `ViewSchema` in `packages/contracts`, `view` on a capability in the protocol | The capability's own scope; a view never executes | built: table, list, detail, text; `connectors/phonebook` is the reference |

## What Clew stores, by connector kind

A reduction of startsidan's ownership matrix (doc 13) to the three kinds.

| Kind | Persistent rows | Cache across requests | Who reads the source | Writes |
|---|---|---|---|---|
| Core | Yes: Clew is the system of record, with purpose and retention per table | Yes | Clew itself | Clew's own `execute` capabilities, audit in the same transaction |
| Pass-through | Refs, revisions, execution records, audit, receipts. Never titles, bodies, participants or availability from the source | No | The user, through the adapter's auth mode | Only through declared `execute` capabilities, or link-out when the source permits nothing else |
| Derived | The snapshot: a figure, a count, a period, a source and a checked-at time | The snapshot is the cache | A scheduled job under a reviewed grant | None |

Names of individual employees are a product rule on top of this: they appear inside the source system or
an app view, never in a card or the stream.

## Sundsvall's landscape mapped onto the paths (2026-11-03)

| System | Owner of the records | Path today | Path later |
|---|---|---|---|
| Microsoft 365 calendar and mail | Microsoft, user-delegated | Pass-through read and execute through the `microsoft365` adapter (Graph), decided | Change notification through Graph subscriptions if push latency matters |
| Nextcloud calendar (dev, and any CalDAV estate) | The CalDAV server | Pass-through read and execute, built | Unchanged |
| HR (schedules, absences) | an HR system without an API | Pass-through read through dept44 services where they exist; link-out for every write | RPA-backed execute only if a use case demands it and the vendor still has no API |
| Finance | an economy system behind dept44 services and WSO2 | Pass-through read in `service` mode with `scope`; execute for attest when the dept44 command exists | Unchanged |
| Data warehouse reader (aggregates) | dept44 service | Derived snapshot for the Läget figures | Unchanged |
| Incidents, Kommunikation | fixture connectors (D61) | Pass-through connectors under `connectors/`, generic systems as independent services behind the protocol | Real adapters through the same contract |
| SupportManagement and CaseData (errands, Draken UI) | The case services, behind WSO2; caller asserted with `X-Sent-By: type=adAccount; <ad>` | Nothing yet. Reviewed 2026-11-04 (`docs/reviews/2026-11-04-support-management-integration-review.md`): a Clew-owned `ErrandProvider` contract, pass-through, `service` credential with asserted identity, link-out `<baseUrl>/arende/<errandNumber>` | `sm` adapter first, `casedata` second; a webhook channel in SupportManagement for change notification; exchanged user tokens at the gateway |
| Metakatalogen (employee directory) | Metakatalogen, the established system for all employee data | Pass-through read for contact details, title, location and manager; the `directory.search` capability in the search fan-out. Clew's `people` connector keeps only subject, name, unit and role from SCIM | Unchanged; SCIM feed may originate here |
| The organisation's phone book ("telefonboken") | A custom system reachable through an API | Pass-through reads only, as the connector `connectors/phonebook` (D38): a search source for people, a table with a search field and a unit filter, each person's own team list, and a contact card, all drawn by Clew. Runs on a made-up organisation until the API's shape is confirmed; `toPerson` in `directory.mjs` is the one mapping to adapt. Whether it is Metakatalogen or a second source of people is not settled | Unchanged |
| Keycloak or Entra | The IdP | Login; SCIM designed | ID-JAG issuing for foreign MCP servers when the IdP supports it |
| Eneo | Eneo | Nothing yet | Inference provider, knowledge tool, external agent of Clew (D14) |

## Startsidan concepts that do not carry over

Kept for the record so the next session does not reinvent or rediscover them.

- **Dataset manifests, semantic types, the view DSL and the query engine.** Startsidan let operators compose
  pages from datasets joined on semantic types. Clew has no page builder and no cross-source join; a
  connector's `read` capability returns rows in its own output schema and Clew renders them. How work that
  spans connectors is composed instead is in `working-across-connectors.md`. If a second consumer ever needs a
  shared vocabulary across connectors, start from startsidan doc 26, not from scratch.
- **The three bindings (in-process, NATS, HTTP) and the connector host.** Replaced by in-process plus the
  connector shape (D21).
- **Operator-defined datasets and the Register connector.** Owning a new domain in Clew is a core connector in
  code (`docs/vision.md`), not operator configuration.
- **Commands as a separate contract.** Folded into `execute` capabilities with receipts. What survives is
  the discipline: idempotency key, `unknown` as an outcome, no retry without a proven outcome, compensation
  as its own capability, source success and local state never in one transaction.
- **Classification-gated inference endpoints.** Not decided for Clew. The open-source rule says the model
  is whatever the operator points at; a classification gate (personal data never to an external endpoint)
  is the obvious next decision once a real source is connected and is noted as open in `docs/vision.md`.
