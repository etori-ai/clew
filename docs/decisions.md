# Decision log

One entry per decision, newest last. Each entry says what was decided, why, and what it replaces.
HANDOVER.md section 2 carries the short table; this file carries the reasoning. Longer designs live in
`docs/architecture/`.

## D1 · Clew owns every integration contract (2026-11-03)

**Decision.** The model's tool surface and the UI's view shapes are defined by Clew-owned capability
descriptors in `packages/contracts`. Adapters translate to the external protocol. External systems never
define the contract. Design: `docs/architecture/integrations.md`.

**Why.** The guardrails (human decision endpoint is not a tool, every source scoped before joining, no raw
access for the model) need a place to live. A Clew-owned descriptor with `kind`, `scope` and `model`
fields gives them one. It also keeps the model's tools at domain granularity instead of REST granularity.

**Replaces.** Nothing; generalises the `CalendarProvider` interface decision from session 1.

## D2 · No OpenAPI-to-MCP conversion in the running system (2026-11-03)

**Decision.** Clew does not generate tools from external OpenAPI documents (the Open WebUI `mcpo` /
`openapi-servers` pattern) and does not expose a generated MCP surface from a foreign spec. A converter may
scaffold an adapter at dev time. Clew **publishes** OpenAPI for its own BFF, generated from TypeBox.

**Why.** Conversion makes the external system the author of the tool surface, which contradicts D1. Forty
narrow endpoints with generic descriptions also work badly for a model, and there is nowhere in a generated
surface to say "not a tool" or "scope to this unit".

**Replaces.** An option under consideration; nothing built.

## D3 · Three module kinds: core, pass-through, derived (2026-11-03)

**Decision.** Modules are sorted by who owns the data. Core (users, permissions, threads, audit, jobs) lives
in Clew's Postgres and has no provider interface. Pass-through (calendar, Heroma, Raindance) lives in the
external system; Clew stores refs, revisions and audit rows only, behind a provider interface, in-process
first and lifted to an MCP server when release cadence, network zone or ownership demands it. Derived
(figures, attention counter) is a snapshot computed from pass-through modules.

**Why.** The question "MCP or REST?" has different answers per kind. Naming the kinds settles it per module
instead of per conversation.

## D4 · Foreign MCP servers are wrapped, not passed through (2026-11-03)

**Decision.** A vendor's MCP tools are their contract. Default is a Clew adapter implementing the Clew
capability by calling them. Passing a foreign tool straight to the model is a per-tool allowlist entry with
a `scope` rule, never automatic.

**Why.** Same reasoning as D1 and D2, applied to MCP instead of OpenAPI.

## D5 · OIDC and OAuth 2.1 with JWT access tokens are the only identification path (2026-11-03)

**Decision.** People log in through OIDC (Authorization Code + PKCE, Keycloak, opaque server session).
Every call on their behalf (BFF to MCP server, Clew to an external system, a model tool call) uses an OAuth
2.1 JWT access token bound to the user and the target audience, per the MCP authorization specification
revision 2026-07-28: Protected Resource Metadata (RFC 9728), Authorization Server Metadata (RFC 8414),
PKCE, resource indicators (RFC 8707), Client ID Metadata Documents for Clew's own client identity with
DCR as fallback, no token passthrough. The model has no identity of its own. SCIM 2.0 provisions users and
groups into Clew's core tables; it is provisioning, not identification. Design:
`docs/architecture/identity.md`.

**No per-server consent popup.** Inside our trust domain (Clew's own MCP servers behind Keycloak) the BFF
uses token exchange (RFC 8693) to get an audience-bound token silently. Across trust domains (vendor or
other-municipality MCP servers) Clew implements the MCP **Enterprise-Managed Authorization** extension
(`io.modelcontextprotocol/enterprise-managed-authorization`, stable 2026-07-28): the BFF exchanges the
user's ID token for an ID-JAG at the IdP, which evaluates policy, and trades the ID-JAG for an access token
at the server's authorization server with the JWT bearer grant. Fallback to `authorization_code` only when
the server does not support the extension, logged as such. Policy for "who may use Clew against which
server" lives in the IdP, not in Clew.

**Why.** One IdP, one token format and one validation routine (`jose` against the realm JWKS) across every
hop. Audience binding means a stolen token for one MCP server is useless against another. Keeping the model
without identity makes "tool calls run as the asking user" a property of the system rather than a rule.
The extension puts access policy where IT already manages it, with revocation in one place.

**Known constraint.** Keycloak accepts ID-JAGs from 26.7.0 (experimental, feature flag
`identity-assertion-jwt`); issuing them is not documented for Keycloak yet. The dev realm runs 26.2. The
cross-domain path is therefore designed, not buildable today, and depends on the production IdP or an
open-source issuer (Janssen, ThunderID, Athenz, AuthPlane document both roles).

**Replaces.** Extends the session-1 identity decision (OIDC + opaque session) to MCP and external calls.

## D6 · Dev login with username and password, local only (2026-11-03)

**Decision.** A BFF-side username and password form, enabled only by `AUTH_DEV_LOGIN=true` outside
production, that mints a normal session for a seeded synthetic persona and marks it `auth: 'dev'`. The
server refuses to start if the flag is set in production. Not built yet.

**Why.** Running the stack without the shared Keycloak container, and switching between `hillevi` and
`hassan` in seconds. Minting a real session rather than a special one keeps every downstream code path
honest.

## D7 · Bun is the server runtime (2026-11-03)

**Decision.** `apps/server` runs on Bun (`bun --watch` in dev, `bun run` in the container), not on Node with
`tsx`. Hono serves through Bun's native server instead of `@hono/node-server`. Bun stays the package manager
and script runner as before. Node 24 remains in the image only as a toolchain dependency for tools that need
it (Vite, drizzle-kit, the Astryx CLI) until each is verified under Bun.

**Why.** One runtime for scripts, tests and the server. Bun runs TypeScript directly, which removes the
reason `tsx` was chosen (Node's type stripping needed `.ts` import extensions and no parameter properties).
Hono was picked in part because the same code runs on Bun without adapters.

**Replaces.** The session-1 decision "Node 24 LTS, run with tsx". Switching is a next step in HANDOVER:
change the dev and start scripts, replace `@hono/node-server` in `apps/server/src/main.ts`, and verify
`postgres`, `openid-client` and the scheduler under Bun.

## D8 · Every action works without the model (2026-11-03)

**Decision.** The model is an accelerator, never a dependency. Every capability in the registry (D1) is
reachable through a deterministic path: a REST route the UI calls directly, a button in a thread, or a
standing action in an area ("Gör själv"). If the configured AI provider is down, slow or returns garbage,
the page still shows what needs you, every button still works, the scheduled scans still push threads, and
the composer degrades to a deterministic command box. Nothing that reads, proposes or executes may have the
model in its only path.

**What the model is used for.** Understanding free text in the composer and in replies, choosing which
capability to call and with what arguments, and writing the explanatory sentences in a thread. Each of
these has a fallback: the intent router in `apps/server/src/assistant.ts` plus typeahead over capability
names, the standing actions and thread buttons, and templated text ("Varför nu?" is built from the trigger
record, not generated).

**Where the line is.** Proposals are computed by deterministic code (the planner in `apps/server/src/planner.ts`
plans the week without a model). The human decision endpoint is deterministic and re-validates against
live sources. The model may call `read` and `propose` capabilities to draft a thread; it never calls
`execute`. So a provider outage removes convenience, never correctness.

**Degraded state is explicit.** The page shows a banner when the provider is unreachable, the composer
changes its placeholder and offers only deterministic completions, and buttons that need the model
("Svara" with free text) say so instead of failing silently. Audit rows record `assistant: 'unavailable'`
on threads created in that state. Design: canvas artboard "Mission control 4 · Utan modell".

**Why.** A municipality cannot have its start page stop because a vendor's API is down, and the open-source
constraint means the model is whatever an operator points at. Keeping every path deterministic also keeps
every path testable without a model, which the first use case already proved.

**Replaces.** Nothing. Makes explicit what HANDOVER item 1 ("keep the router as the fallback") implied.

## D9 · The side panel holds conversation, Clew views and MCP App views (2026-11-03)

**Decision.** The surface to the right of the stream on desktop (bottom sheet on the phone) is a side
panel with two kinds of content, as in Eneo's sidebar: a
**view** rendered by Clew from a `read` capability's output schema, and an **app** rendered by the module
itself through the MCP Apps extension, sandboxed. In phase one the panel shows one thing at a time: a view or an app, carrying its own
interaction (day navigation, tapping a free slot), Stacking
a "Du tittar på" scope block and suggested questions under a view comes later. A
full-page button lifts a view into the main column.

**What opens it.** Clicking a row in a card opens a view about that row (the day around a proposed time). A secondary action with `kind: read` and `target: panel` opens an app or a view.
"Svara" sets the composer's scope to the thread and opens the conversation overlay with its memory (the conversation is never in the panel; see integrations.md, "Where the conversation lives").

**Rules for apps.** Sandboxed, no access to the page, given only what the card already knows (refs, period).
Buttons inside the app call the module's own MCP server with the user's token (D5), never the assistant and
never Clew's capabilities. Nothing from the app is stored in Clew except an audit row that it was opened.
Views and apps work unchanged without the model (D8).

**Why.** Two open questions close. A free slot in the calendar is not the same as a usable slot; the planner
sees gaps, not context, so the person previews the day around the proposal and decides. No travel-time
estimates or similar reasoning at this stage: the preview is enough. And the names guardrail holds: an app surface is
the source system, inside Startsidan, so a name may appear there and never in the card. Modules still never
draw cards (D1); they draw their own panel content, which is a different thing.

## D10 · Integrations fulfil Clew's API; adapters are the fallback (2026-11-03)

**Decision.** When a system is connected to Clew, the order is fixed. First, the integration is asked to
implement the API Clew has defined for that domain (the capability descriptors in `packages/contracts` and
the provider interface of the module, for example `CalendarProvider`). That applies to vendors, to other
municipalities' teams and to Sundsvall's own dept44 services. Only when the system cannot or will not do so
does Clew write an adapter that translates from the system's protocol to Clew's contract. The adapter is
Clew's code, in Clew's repository, under Clew's licence; the contract does not move to accommodate it.

**Why.** D1 says Clew owns the contract. D10 says who does the work of meeting it. Asking the integration
first keeps adapter count low and makes a vendor's "we support Clew" a checkable claim. Writing our own
adapter when that fails keeps every system reachable regardless of vendor interest. The two together mean
no system is ever a blocker for the platform, at worst a cost.

**What it means in practice.** Sundsvall's landscape checked 2026-11-03: Heroma is reached by RPA today
(no API; `RPA-Heroma` on github.com/Sundsvallskommun), Raindance through the municipality's own dept44
services behind the WSO2 gateway, aggregates through `api-service-datawarehousereader`. These will be
adapters in `service` auth mode with a `scope` rule. Microsoft 365 is reached through Microsoft Graph, an
adapter in `user-delegated` mode. A dept44 service that exposes Clew's contract directly needs no adapter.

**Replaces.** Nothing; makes the adapter policy in `docs/architecture/integrations.md` explicit.

## D11 · One calendar contract, CalDAV and Microsoft 365 as adapters (2026-11-03)

**Decision.** `CalendarProvider` in `packages/calendar/src/model.ts` is Clew's calendar contract. Every
calendar system is an adapter behind it, selected per account by `CalendarCredential.kind` in
`packages/calendar/src/adapters.ts`. Two kinds are decided: `caldav` (the existing Nextcloud provider;
any CalDAV server with iCalendar scheduling) and `microsoft365` (Microsoft Graph, since Exchange Online
has no CalDAV endpoint and Exchange Web Services is disabled from October 2026 and removed April 2027).
Nothing above the factory knows which protocol a person's calendar speaks, so a mixed estate is supported.

**Why.** The dev stack runs Nextcloud; the municipality runs Microsoft 365. A single contract with two
adapters keeps the planner, the decision endpoint, the audit rows and the UI identical across both, and
makes the Graph adapter a package-local piece of work. Per-account selection rather than a global flag
because other municipalities and non-municipal users (persona Petra) may run either.

**Status.** The `caldav` adapter is the ported provider and is verified end to end. The `microsoft365`
adapter is a typed, unimplemented branch that throws a configuration error. Building it needs an Entra
tenant and settles how a delegated Graph token reaches the BFF (Keycloak as broker with stored external
tokens, or OIDC directly against Entra in production); that question is item 10 in HANDOVER.

**Replaces.** The session-1 note "calendar as MCP, in-process first" is unchanged; D11 adds the adapter
axis under the same interface.

## D12 · Objects, chips, proposals: the general interaction pattern (2026-11-03)

**Decision.** Everything rendered on the page is an **object** with a stable ref, a label and a type: a card,
a row in a card, a calendar event in the side panel, a row in a view, an item in an MCP App view. Any
object can be added to the conversation as a **chip** in one of three equivalent ways: click it and choose
"Lägg till i samtalet", drag it to the composer row, or type `@` in the row and pick from what is visible
first, then everything else. Chips sit above the input, are removable, and the chipped object is
highlighted where it is. The row prefix reads "Om 2 saker".

Chips are the explicit context; the page is the implicit one. With chips the assistant does not guess.
Without chips it may resolve a reference such as "mötesförslaget" against the page state, and must then
show which object it picked by lifting it above the dim. That is the fallback, not the main path.

The side panel stays live during a conversation: the dim covers the stream only. The panel is where the
person browses and points, the overlay is where they talk, chips are what travels between them.

The conversation edits **cards**, never systems. "Flytta det så Annas samtal får 15:00" updates the
proposal card (Anna at 15:00, a new row "Rektorsmötet flyttas till 16:00"), marked as a draft in the card
and in the panel's day view. The card's own button executes everything. Clew-side actions (dismiss,
remind) are confirmed in the overlay. "Svara" on a card is the same as "Lägg till i samtalet" and is
named so.

**Why.** The strongest analogues converge on this: Cursor and Claude Code (select, Add to Chat, `@`
mentions, context pills), Microsoft 365 Copilot's Context IQ (`/` for people, files, meetings, emails),
Gemini in Gmail (`@Calendar`, `@Drive`). The thing you talk about is an attachment, visible as a chip,
added by selecting or typing a trigger. None rely on the model guessing from the screen as the primary
path. It also dissolves the conflict between panel and overlay: they stop competing once chips connect
them.

**Replaces.** The "Svara" button on cards (D9 wording and the thread action contract), and the lift-by-
guessing board as the main path. Canvas row "Det generella mönstret".

## D13 · The conversation lives in the composer's drawer; the dim is an Astryx Overlay (2026-11-03)

**Decision.** The conversation overlay described in D12 and `integrations.md` ("unfolds upward from the composer
row over the dimmed stream") is built with two Astryx components and no custom CSS: the grouped focus list and the
conversation render in `ChatComposer`'s `drawer` slot (`ChatComposerDrawer` with a `ScrollableArea` budget), so
they unfold from the row inside the same rounded surface and the row keeps focus; the stream is wrapped in
`Overlay` with a light scrim while the row is open, and a click on the scrim or Esc closes it. The side panel
(`Drawer`) and the row are outside the overlay and stay live. Chips are tokens in the field
(`ChatComposerInput` triggers), never a separate row.

**Why.** The Astryx-only rule (CLAUDE.md) leaves no room for a hand-made floating surface, and Astryx has no
"popover over a region" primitive; the drawer slot is the component's own place for context above the input. A
programmatic token insert does not emit `onChange`, so the composer reads the serialized draft back after inserting
and re-inserts chips after a turn (an external value clears the field). Known limit: `ScrollableArea` has no
max-height, so the drawer has a fixed height budget.

**Replaces.** Nothing; implements D9's "the conversation is never in the panel" and D12.
