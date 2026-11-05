# Integration architecture

> **Reading status:** Early integration design. The in-process/MCP hosting and connector-rendered app examples below predate D21/D22 and declared views. New integrations are independent connector services; source writes go through human decision paths. See [implementation status](../reference/status.md) and the [current protocol](../reference/connector-protocol.md).


How Clew connects to systems outside its own database: the calendar today, Heroma, Raindance and other
municipal systems later. Decided 2026-11-03. The decision log is in `docs/decisions/`. This file holds the
principles; the catalogue of concrete paths, their auth modes and their status is `integration-paths.md`, and
`capability-surfaces.md` explains how one capability is reached over REST, as a model tool and over MCP.

## Principle

**Clew owns every contract the model or the UI sees.** External systems never define Clew's tool surface
or its view shapes. An adapter translates between a Clew-owned contract and the external protocol
(CalDAV, REST, SOAP, a remote MCP server). The transport between Clew and an adapter is a deployment
choice, not an architectural one.

This rules out generating tools from an external OpenAPI document (the Open WebUI `mcpo` /
`openapi-servers` pattern). Automatic conversion in either direction makes the external system the author
of the tool surface: REST granularity (forty narrow endpoints, generic descriptions, pagination and ID
conventions) leaks into the model, and there is no place to express the guardrails ("this endpoint is
never a tool", "scope this call to the manager's unit"). An OpenAPI-to-tool converter may be used as a
dev-time scaffold when writing a new adapter. It is never part of the running system.

OpenAPI does belong in Clew as **output**: the deterministic REST surface of the BFF is described by a
document generated from the TypeBox schemas in `packages/contracts`.

**Who meets the contract (D10).** When a system is connected, the integration is first asked to implement
Clew's API for that domain: the capability descriptors and the connector's provider interface. A vendor, a
dept44 service or another municipality's team that does so needs no adapter. Only when that is not
possible does Clew write the adapter, in this repository, from the system's protocol to Clew's contract.
The contract never bends to the adapter. In Sundsvall today that means adapters for Heroma (RPA, no API),
Raindance and aggregates (dept44 services behind the WSO2 gateway, `service` mode with a `scope` rule) and
Microsoft 365 (Microsoft Graph, `user-delegated`). The calendar is the pattern: one `CalendarProvider`
contract, a `caldav` and a `microsoft365` adapter selected per account (D11,
`packages/calendar/src/adapters.ts`).

## One capability layer, two faces

```
  browser ──REST (Hono BFF)──┐
                             ├─► capability registry ──► providers / adapters ──► external systems
  model   ──tools────────────┘     (Clew contract)        (CalDAV, REST, SOAP, remote MCP)
```

Every domain is a set of **capabilities**. The REST views the browser reads and the tools the model calls
are both thin projections of the same capability. The browser never speaks MCP; the model never speaks
REST.

A capability is a descriptor in `packages/contracts`:

| Field | Meaning |
|---|---|
| `name` | Stable identifier, e.g. `calendar.freeBusy` |
| `input`, `output` | TypeBox schemas |
| `description` | Swedish text the model reads |
| `kind` | `read`, `propose` or `execute` |
| `scope` | Which identity may call it and how the call is narrowed (unit, person, period) |
| `model` | Whether the capability is exposed as a tool. `execute` defaults to `false` |

From one descriptor the registry derives the AI SDK tool definition, the MCP tool (when the provider runs
out of process), the Hono route and the OpenAPI entry. The guardrail "assistant proposals are executed only
through a human decision endpoint that is not a tool" is therefore structural: the confirm endpoint is an
`execute` capability with `model: false`.

The existing `CalendarProvider` interface in `packages/calendar/src/model.ts` is the first such contract.
It stays as is; the registry wraps it.

## Three kinds of connector

Sorted by who owns the data.

| Kind | Data lives | Examples | Runs |
|---|---|---|---|
| **Core** | Clew's Postgres | users, groups, permissions, threads, audit, jobs | in-process only; no provider interface, they are the system |
| **Pass-through** | the external system; Clew stores refs, revisions and audit rows only | calendar, Heroma, Raindance | behind a Clew provider interface, in-process first, lifted to an MCP server when needed |
| **Derived** | a snapshot in Clew's Postgres | "Läget" figures, attention counter | in-process, reads pass-through connectors on a schedule |

Users and permissions are core. SCIM 2.0 provisioning is an **inbound** interface on them: Clew is the SCIM
server, the IdP (Keycloak or Entra) is the client. SCIM users and groups land in Clew's own tables, Clew
roles are derived from group membership plus OIDC claims, and authorization is decided in Clew. SCIM does
not touch the capability layer. See `docs/architecture/identity.md`.

## When a pass-through connector becomes an MCP server

Lift an adapter out of the BFF process when at least one holds:

- it needs its own release cadence or its own network zone (for example a server that must sit next to
  Heroma inside a restricted segment);
- another team owns it;
- a second consumer besides Clew wants the same tools.

The capability descriptor and the provider interface do not change. The MCP server hosts the same provider
package (`apps/mcp-<name>` wrapping `packages/<name>`), and the BFF switches from an in-process provider to an
MCP client for that connector.

## Consuming someone else's MCP server

When a vendor or another municipality ships an MCP server, its tools are **their** contract. Default is to
wrap: a Clew adapter implements the Clew capability by calling their tools. Passing a foreign tool straight
through to the model is an explicit per-tool allowlist entry with a `scope` rule. It is never automatic and
never "all tools from server X".

## Identity through adapters

Pass-through systems must see the user, not a service account, or scoping breaks. Every adapter declares
one auth mode:

| Mode | Used when | Mechanism |
|---|---|---|
| `user-delegated` | the external system accepts tokens from the shared IdP | OAuth 2.1 token exchange at Keycloak (RFC 8693), audience = the external system. For Microsoft 365 the token must be issued by Entra, so Keycloak acts as broker with stored external tokens, or production runs OIDC directly against Entra; open, see HANDOVER item 10 |
| `bound-credential` | the external system has its own accounts | per-user credential sealed in Clew's DB; what the calendar does today |
| `service` | the external system only has one integration account | Clew narrows every call with the `scope` rule before it leaves the process |

An out-of-process MCP server owned by Clew receives the user context as a short-lived JWT bound to that
server's audience. It never acts as "Clew" without a user. Details in `docs/architecture/identity.md`.

## Thread action contract

A connector never draws its own card. It contributes **actions** through capability descriptors, and the
thread card has fixed slots for them, so the page looks the same whether the thread comes from the
calendar, Heroma or Raindance:

| Slot | Who fills it | Count | Rule |
|---|---|---|---|
| Primary | connector, `kind: execute` or `propose` | exactly 1 | The verb in the headline. Filled button. |
| Secondary | connector, `kind: read` (a link into the source system or a view) | 0 to 2 | Tonal buttons. The first is usually "open in the source". |
| Standard | Clew | always the same | `Lägg till i samtalet` (adds the card as a chip, D12), `Inte nu` (snooze to the next bundle), `Påminn mig` (a menu of durations; a Temporal reminder that brings this card back to the top of the stream, D17), `Avfärda` (closes the thread with a reason, undoable), `Varför ser jag detta?` (trigger, source, time). |
| Overflow | connector, anything beyond the slots above | any | Behind the `⋯` menu together with the standard actions, connector items first. |

A connector action carries `label`, `capability`, `kind`, and an optional `confirm` text. Clew decides
placement from `kind` and order; the connector cannot ask for a second primary. `Avfärda` and `Inte nu` are
Clew's because they act on the thread, not on the source system; a connector that wants a source-side
"decline" exposes it as its primary or secondary action ("Avslå med kommentar").

Dismissing writes a thread state `dismissed` with the reason and an undo window, and the connector's
trigger will not re-create the same thread for the same occurrence. Snoozing keeps `open` and moves the
thread to the next bundle time.

## Answers and views

A question typed in the composer gets one of three shapes, chosen by the server from what came back:

| Shape | When | Where it lands |
|---|---|---|
| **Svar** | one or two sentences with source and time | a framed card directly above the composer; the composer gets a target chip so the follow-up stays in the thread; after the day it is listed in Redan hanterat under Frågor |
| **Vy** | the result is a list or table (per person, whole week, Redan hanterat) | the main column, with "‹ Allt", its own filters and a URL; the sidebar marks it; the composer chip says "I vyn: …" and questions search only what is shown |
| **Förslag** | the answer implies an action | an ordinary decision card under Behöver dig with the same slots, buttons and undo |

**Where the conversation lives.** Cards hold state and actions. The conversation is an overlay that
unfolds upward from the composer row over the dimmed stream, in the main column, newest message nearest
the row; it is never a modal and never a side panel. The row keeps focus for the whole conversation and
sending never moves it. Esc or a click on the dimmed stream closes the overlay and the conversation is kept
under Redan hanterat › Frågor. Follow-up suggestions sit in the overlay's footer. Focusing the row first
shows common questions, questions about what is on screen, actions, and earlier conversations, which
reopen in the overlay where they ended. That grouped list shows only while the row is empty and has no chips; with a chip it
shrinks to one row of verbs about that object, derived from the object's actions, so the object stays
visible. Context is attached as chips (D12): click an object and "Lägg till i
samtalet", drag it to the row, or type `@`. The dim covers the stream only, the side panel stays live for
picking, and the chipped objects are highlighted. Without chips the assistant may resolve a reference like
"mötesförslaget" against the page state and must lift the object it picked.
Several actions in one sentence become a numbered list to confirm; Clew-side actions (dismiss, reminder)
are confirmed in the overlay, source-system actions always through the card's own button. What the conversation
produces goes out to the page: Förslag becomes a card in the stream, Vy opens in the side panel or the
main column, Svar stays in the overlay. The side panel is for views and apps only (D9).

A view is deterministic and addressable, reachable without the model (D8), and rendered by Clew from the
output schema of a `read` capability. Connectors return rows, never markup. Redan hanterat is the user's
own log: decisions, dismissals, undos and questions grouped by day, filterable by area and kind, with
undo while the window is open and Återöppna on dismissed threads. Older than 30 days lives in the audit log.

## Without the model (D8)

The capability layer is why the model is optional. Each descriptor derives a REST route and a UI
affordance as well as a tool, so the browser can call `calendar.freeBusy` or `leave.approve` directly.
The model only chooses and phrases; it never holds the sole path to anything.

| Function | With the model | Without it |
|---|---|---|
| Free-text question | model picks a capability and arguments | intent router plus typeahead over capability titles |
| Pushed thread | scheduled job runs deterministic code, model writes the lead sentence | same job, templated sentence from the trigger record |
| Proposal | deterministic planner, model may suggest alternatives in a reply | deterministic planner only |
| Reply in a thread | model interprets "flytta Annas till torsdag" | buttons: adjust in the calendar, next week instead, not now |
| Confirm, execute, undo | never the model | unchanged |
| Area figures and schedules | unchanged | unchanged |

The provider's health is a first-class status: checked on a timer, shown on the page, written to audit on
every thread created while it is down.

## Implemented (2026-11-03)

`packages/connectors` holds the descriptor types and the `Registry`; the four mock integrations under
`mock/` implement the pass-through kind against synthetic records with state in `module_state`; the core
kind is `people` in `apps/server/src/modules/people/connector.ts` (Clew's own users and permissions, no adapter, no
scan) and the calendar is wrapped in `apps/server/src/modules/calendar/connector.ts`. The BFF derives
`/api/areas`, `/api/cap/:name` and the card actions from the registry; `/api/connectors` shows the registry as
data. Tool derivation exists (`registry.tools`) but is not wired to a model yet.

## Packages

Existing packages stay where they are. The architecture adds, when the second connector lands:

- `packages/capabilities`: the `Capability` descriptor type, the registry and the derivations (AI SDK tool,
  MCP tool, Hono route, OpenAPI).
- `packages/scim`: the inbound SCIM 2.0 server on the core user and group tables.
- `apps/mcp-<name>`: a host that exposes an existing provider package over MCP.

## First step

HANDOVER item 1 (wire `generateText` with a calendar read tool) goes through the registry from the start:
register the calendar reads as `read` capabilities with `model: true`, and the confirm endpoint as `execute`
with `model: false`. That proves the pattern on one real connector before the second use case arrives.
