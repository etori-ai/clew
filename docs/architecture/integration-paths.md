# Integration paths

The catalogue of ways a system can be connected to Clew, what each path is for, and what is built. The
principles are in `integrations.md` (Clew owns the contract, D1; integrations fulfil it first, D10; three
module kinds, D3). This file is the menu you pick from when a new system arrives. Much of it is carried
over from the startsidan repository (docs 08, 13, 14, 16, 18, 19, 33 and ADR-094), reduced to what Clew
needs; the startsidan concepts that do not survive are listed at the end.

Status words: **built** runs in this repository today; **decided** has a decision number and a place in the
code but is not implemented; **designed** is written down in `docs/architecture/` without a decision on
when; **open** is not decided.

## How to choose

Ask three questions about the system, in this order.

1. **Who owns the data?** If the records live in the other system and Clew only needs refs and audit, it
   is a pass-through module. If Clew computes a figure from them on a schedule, it is derived. If nobody
   else owns the domain, Clew owns it: a core module (see `docs/vision.md`, "Owning the model").
2. **Can the system meet Clew's contract itself?** Ask first (D10). A vendor, a dept44 service or another
   municipality that implements the module's provider interface needs none of the adapter paths below.
3. **Which direction and which verb?** Read, propose, execute, notify, provision. Each is a row in the
   tables that follow. A system usually needs two or three rows, never all.

Then pick the transport and the auth mode. Those are deployment choices, not architecture (D1).

## Paths into Clew: reading and being told

| Path | What it is | Clew contract | Auth | What Clew stores | Status |
|---|---|---|---|---|---|
| **Native fulfilment** | The system implements Clew's provider interface for the domain directly. No adapter. | The module's provider interface and its `read` capabilities | Whatever the contract specifies, normally `user-delegated` | Refs and audit only | decided (D10), no system does it yet |
| **Pass-through read** | An adapter reads live rows from the source on each request, as the user. Request-only: nothing is cached or logged beyond refs. | `read` capabilities of a pass-through module; `CalendarProvider` is the model | `user-delegated`, `bound-credential` or `service` with a `scope` rule | Refs, revisions, audit rows | built for CalDAV (`packages/calendar`); mock modules for Heroma, Raindance, Treserva, Kommunikation; Graph adapter decided (D11) |
| **Derived snapshot** | A scheduled job reads a pass-through module or a reviewed aggregate feed and stores a figure or a count. Aggregates over personal data are produced inside the source trust boundary (startsidan's edge aggregates), never by Clew reading rows with a service account. | A derived module's `read` capabilities; the job in the Postgres scheduler | `service` with a `scope` rule, or a reviewed aggregate endpoint | The snapshot, with period and source | built with synthetic figures (`apps/server/src/figures.ts`); real source open |
| **Search fan-out** | One query from the composer goes to every module in the person's scope that declares a `search` read capability; results come back as objects with refs and link-outs, merged and ranked by Clew. People come from the organisation's directory as a pass-through module (Metakatalogen in Sundsvall); Clew's own `people` core module holds only the essentials from SCIM. Document and case content is searched in the source as the user, and through Eneo's retrieval when the `eneo` module is installed. Request-only; Clew indexes nothing of other systems' content. | A `read` capability named `<module>.search` with a common output shape (ref, type, label, snippet, link) | As the pass-through read behind it | Nothing beyond audit | open; the composer's typeahead over capabilities and earlier questions is built, no cross-module search yet |
| **Scan trigger** | A module's `scan` function looks at the source for this person and returns thread drafts: what needs them now. Deterministic, no model. Runs nightly and on demand. | `Module.scan` in `packages/modules`; `topic` is the idempotency key per person | As the pass-through read behind it | The thread, its state and audit | built (`scan-utvecklingssamtal`, mock modules) |
| **Change notification** | The source tells Clew that something changed so the page re-reads. Payload-free event (`key`, `revision`, `outcome`, `actor`, `observedAt`), consumers re-read under their own authorization. | CloudEvents 1.0 envelope on a Postgres event log, as in startsidan doc 33 | Source credential for the ingest route; consumers use the user's | The event row, digests only | open; v1 relies on scan and on receipts read back after execute |
| **Identity provisioning** | The IdP pushes users and groups into Clew's core tables. Clew is the SCIM server. Only the essentials land here (subject, name, unit, role, groups); the full employee record stays in the directory and is read as pass-through. | SCIM 2.0 inbound on the `people` core module | Long-lived bearer issued by Clew for the IdP | Users, groups, derived roles | designed (`identity.md`), not built |
| **Login** | A person is identified through OIDC. The only identification path. | OIDC Authorization Code + PKCE, opaque server session | Keycloak in dev; the municipality's IdP in production (D5, rewording pending) | Session, subject binding | built |

## Paths out of Clew: acting on systems

| Path | What it is | Clew contract | Auth | What Clew stores | Status |
|---|---|---|---|---|---|
| **Execute through a human decision** | A card's primary button runs an `execute` capability. The server re-validates against the live source, dispatches, reads the result back row by row (sent, moved, unknown, not sent) and renders a receipt with an undo countdown. Never a tool for the model (D8). | `execute` capability with `model: false`; `ExecuteResult` with `rows`, `undoCapability`, `undoMinutes` | As the adapter's mode | Execution record, receipt, audit row in the same transaction; never the source payload | built (calendar invitations over CalDAV; mock modules) |
| **Propose** | The model or a deterministic planner drafts a change as a card. Nothing reaches the source until the human decision above. | `propose` capability; proposals carry the refs they depend on | None against the source | The proposal and its revision | built (week planner; conversation drafts, D12) |
| **Undo** | A compensating `execute` capability within a window. The receipt names it. Irreversible effects have no undo and the card says so. | `undoCapability` on the result | As the adapter's mode | Second audit row | built (ten minutes, calendar) |
| **Link-out** | A deep link into the source system, rendered as a secondary action ("Se i Heroma") or inside a view. The universal fallback: any system with a URL template per entity type gets this for free, even with zero adapters. | A thread action with `target: 'link'` on a `read` capability (`ThreadAction` in `packages/contracts`), or a link template on the module | None; the user logs into the source with their own SSO | Nothing | built as module secondary actions; link templates per system open |
| **RPA-backed execute** | For a system with no API (Heroma today), an adapter dispatches through the municipality's RPA layer. The outcome is `unknown` until read back, so the receipt stays grey and a reconciliation job checks later. | Same `execute` contract; the adapter would declare that outcomes are unknown until read back (field not designed yet) | `service` with `scope` | Execution record with `unknown` status until reconciled | open; v1 says Heroma is read plus link-out |
| **Notify a person** | Clew delivers thread state over a channel: the page, push for same-day deadlines, an e-mail digest at bundle times. Not an integration with the source. | Thread state plus the attention budget | Mail relay or push service credentials | Delivery record | page built; push and digest open (canvas rows) |

## Transports and hosting shapes

The contract never changes with the transport. Pick the first shape that works and move down only when a
condition in the last column holds.

| Shape | Where the adapter runs | How Clew reaches it | Identity across the hop | Move to the next shape when | Status |
|---|---|---|---|---|---|
| **In-process** | Inside the BFF (`apps/server`), as a package | Function call | The `Actor` object | Never by default | built |
| **Clew-owned MCP server** | `apps/mcp-<name>` wrapping the same package | MCP client over Streamable HTTP | Short-lived JWT bound to the server's audience, obtained by token exchange (D5) | The adapter needs its own release cadence or network zone, another team owns it, or a second consumer wants the same tools | decided (D3), not built; `@modelcontextprotocol/sdk` not installed |
| **REST or SOAP behind a gateway** | The source's own API, in Sundsvall usually a dept44 service behind WSO2 | HTTP from the adapter with an API key | `service` mode; Clew narrows every call with `scope` before it leaves the process | Only when the source has nothing better | decided (D10); no real adapter yet |
| **Foreign MCP server** | A vendor's or another municipality's server | MCP client | Their authorization server; cross-domain ID-JAG when it exists, `authorization_code` as logged fallback | Wrapped by a Clew adapter by default; a per-tool allowlist with a `scope` rule is the exception (D4) | designed |
| **Native protocol** | CalDAV, IMAP, Graph | Protocol client in the adapter | `bound-credential` or `user-delegated` | When the source speaks a standard | built (CalDAV) |

What is deliberately not offered: a message broker as the integration transport (NATS was removed from the
devcontainer; the scheduler and the future event log are Postgres), a connector host image that loads
plugins at start-up, and a Java connector SDK. Startsidan designed those for a federated query engine
over many sources; Clew's module kinds do not need them. If a source must run next to a restricted
network, that is the Clew-owned MCP server shape.

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
| **Eneo knowledge as a tool** | `eneo.knowledge.search` as a `read` capability of an optional `eneo` module, scoped to the user's spaces, so an answer can cite the leave policy. | A pass-through module like any other | `user-delegated` if Eneo accepts the IdP's tokens, else `bound-credential` | open (D14) |
| **Clew as MCP server for external agents** | Clew's `read` and `propose` capabilities exposed to a registered client (an Eneo assistant, a desktop agent). Every call runs as the user, with a release policy per client (trust boundary, classification ceiling, allowlist). `execute` is never exposed; confirmation is a human UI operation. | The same registry, projected as MCP tools; user-bound OAuth 2.1 bearer per the MCP authorization spec | Per-user tokens. Eneo could only hold a static bearer for one person as of 2026-10-07 (startsidan ADR-094), so an Eneo registration acts for that one person until Eneo gains per-user credentials | designed; the registry already derives tool definitions |
| **MCP App views** | A module renders its own view in the side panel through the MCP Apps extension, sandboxed, with only the refs the card already has. Buttons inside call the module's own server with the user's token. | D9 | D5 | decided, not built |

## What Clew stores, by module kind

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
| Heroma (HR, schedules, absences) | Heroma, no API | Pass-through read through dept44 services where they exist; link-out for every write | RPA-backed execute only if a use case demands it and the vendor still has no API |
| Raindance (finance) | Raindance, behind dept44 services and WSO2 | Pass-through read in `service` mode with `scope`; execute for attest when the dept44 command exists | Unchanged |
| Data warehouse reader (aggregates) | dept44 service | Derived snapshot for the Läget figures | Unchanged |
| Treserva, Kommunikation | mocked | Mock pass-through modules | Real adapters through the same contract |
| Metakatalogen (employee directory) | Metakatalogen, the established system for all employee data | Pass-through read for contact details, title, location and manager; the `directory.search` capability in the search fan-out. Clew's `people` module keeps only subject, name, unit and role from SCIM | Unchanged; SCIM feed may originate here |
| Keycloak or Entra | The IdP | Login; SCIM designed | ID-JAG issuing for foreign MCP servers when the IdP supports it |
| Eneo | Eneo | Nothing yet | Inference provider, knowledge tool, external agent of Clew (D14) |

## Startsidan concepts that do not carry over

Kept for the record so the next session does not reinvent or rediscover them.

- **Dataset manifests, semantic types, the view DSL and the query engine.** Startsidan let operators compose
  pages from datasets joined on semantic types. Clew has no page builder and no cross-source join; a
  module's `read` capability returns rows in its own output schema and Clew renders them. How work that
  spans modules is composed instead is in `working-across-modules.md`. If a second consumer ever needs a
  shared vocabulary across modules, start from startsidan doc 26, not from scratch.
- **The three bindings (in-process, NATS, HTTP) and the connector host.** Replaced by in-process plus the
  Clew-owned MCP server shape.
- **Operator-defined datasets and the Register module.** Owning a new domain in Clew is a core module in
  code (`docs/vision.md`), not operator configuration.
- **Commands as a separate contract.** Folded into `execute` capabilities with receipts. What survives is
  the discipline: idempotency key, `unknown` as an outcome, no retry without a proven outcome, compensation
  as its own capability, source success and local state never in one transaction.
- **Classification-gated inference endpoints.** Not decided for Clew. The open-source rule says the model
  is whatever the operator points at; a classification gate (personal data never to an external endpoint)
  is the obvious next decision once a real source is connected and is noted as open in `docs/vision.md`.
