# Integration architecture

How Clew connects to systems outside its own database: the calendar today, Heroma, Raindance and other
municipal systems later. Decided 2026-11-03. The decision log is in `docs/decisions.md`.

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

## Three kinds of module

Sorted by who owns the data.

| Kind | Data lives | Examples | Runs |
|---|---|---|---|
| **Core** | Clew's Postgres | users, groups, permissions, threads, audit, jobs | in-process only; no provider interface, they are the system |
| **Pass-through** | the external system; Clew stores refs, revisions and audit rows only | calendar, Heroma, Raindance | behind a Clew provider interface, in-process first, lifted to an MCP server when needed |
| **Derived** | a snapshot in Clew's Postgres | "Läget" figures, attention counter | in-process, reads pass-through modules on a schedule |

Users and permissions are core. SCIM 2.0 provisioning is an **inbound** interface on them: Clew is the SCIM
server, the IdP (Keycloak or Entra) is the client. SCIM users and groups land in Clew's own tables, Clew
roles are derived from group membership plus OIDC claims, and authorization is decided in Clew. SCIM does
not touch the capability layer. See `docs/architecture/identity.md`.

## When a pass-through module becomes an MCP server

Lift an adapter out of the BFF process when at least one holds:

- it needs its own release cadence or its own network zone (for example a server that must sit next to
  Heroma inside a restricted segment);
- another team owns it;
- a second consumer besides Clew wants the same tools.

The capability descriptor and the provider interface do not change. The MCP server hosts the same provider
package (`apps/mcp-<name>` wrapping `packages/<name>`), and the BFF switches from an in-process provider to an
MCP client for that module.

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
| `user-delegated` | the external system accepts tokens from the shared IdP | OAuth 2.1 token exchange at Keycloak (RFC 8693), audience = the external system |
| `bound-credential` | the external system has its own accounts | per-user credential sealed in Clew's DB; what the calendar does today |
| `service` | the external system only has one integration account | Clew narrows every call with the `scope` rule before it leaves the process |

An out-of-process MCP server owned by Clew receives the user context as a short-lived JWT bound to that
server's audience. It never acts as "Clew" without a user. Details in `docs/architecture/identity.md`.

## Packages

Existing packages stay where they are. The architecture adds, when the second module lands:

- `packages/capabilities`: the `Capability` descriptor type, the registry and the derivations (AI SDK tool,
  MCP tool, Hono route, OpenAPI).
- `packages/scim`: the inbound SCIM 2.0 server on the core user and group tables.
- `apps/mcp-<name>`: a host that exposes an existing provider package over MCP.

## First step

HANDOVER item 1 (wire `generateText` with a calendar read tool) goes through the registry from the start:
register the calendar reads as `read` capabilities with `model: true`, and the confirm endpoint as `execute`
with `model: false`. That proves the pattern on one real module before the second use case arrives.
