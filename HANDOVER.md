# Clew · handover for the first build session

Written 2026-11-03 at the end of the design exploration in the `startsidan` repository. Clew is the codename for a new, separate POC. The product name in the Swedish UI stays **Startsidan**.

## 0. State after session 1 (2026-11-03)

Everything in the first-session checklist is done and verified. Read `README.md` for the run commands.

What exists and works:

- Devcontainer: `node:24.21.0-bookworm` + Bun 1.4.2, Postgres 17, optional `calendar` profile with Nextcloud 33 + RoomVox + Mailpit (ported from startsidan, NATS removed, no Temporal). Only `127.0.0.1:3020` (Vite) is published; Vite proxies `/api` to the Hono BFF on container port 3000, so browser, cookies and the OIDC callback share one origin.
- Keycloak: dedicated realm `clew`, client `clew-web`, users `hillevi` (manager, rektor) and `hassan` (employee). `bun run auth:setup` is idempotent; the shared local Keycloak container is `keycloak` (start it with `docker start keycloak` if `keycloak.orb.local:8090` does not answer).
- Auth: `packages/platform/src/auth.ts` from startsidan ported to `apps/server/src/auth.ts` (openid-client 6.8.9, jose 6.2.15). Real login verified in Chrome and in `scripts/auth-dev-check.ts`.
- Drizzle: `auth_*` tables, `thread`, `thread_message`, `proposal`, `audit`, `job`. Migration `0000` checked in under `packages/db/migrations`.
- Calendar: `packages/calendar` holds the model, Stockholm date helpers, the Nextcloud CalDAV provider (ported, plus a `freeBusy()` that returns busy periods per attendee), synthetic account bindings and the deterministic planner `planWeek()`.
- Server (`apps/server`, Hono on Node via tsx): auth routes, threads API, question router, planner (push, replan, confirm, undo, undo-expiry, dismiss), figures, today view, attention counter, Postgres-backed scheduler.
- Web (`apps/web`, Vite + React 19 + Astryx 0.7.6 Neutral), rebuilt 2026-11-03 against the design canvas with Astryx components only: `ChatComposer` question box with suggestion chips, dictation and a "Menar du / Fortsätt tråd" list; `ClickableCard` + `StatusDot` + `ProgressBar` Läget tiles; `List` for I dag with gaps as rows; thread anatomy as on the canvas (badge and source, one sentence, assessment, `Grid` week agenda, actions, "Varför nu?", `ChatComposer` reply, older turns behind a `Collapsible`); `Collapsible` + `List` for "Dina trådar och redan hanterat"; calendar page as `Layout` with an end `LayoutPanel` (`CheckboxList`, confirm, "Föreslå andra tider", reply); mobile with a `BottomSheet` composer and a `CheckboxList` thread. Astryx renders on the plain CSS path; **no StyleX plugin is needed** as long as nobody writes `stylex.create()` in app code.
- Acceptance verified end to end on 2026-11-03 with `bun scripts/auth-dev-check.ts hillevi` (run on the host): login as Hillevi, four proposals in week 46 that collide with nothing in her or the four employees' calendars, confirm creates four CalDAV events and one audit row, undo within ten minutes removes them and writes a second audit row, the thread survives reload. Unit tests cover the planner and free-gap logic (`bun test tests/unit`).

Session 4 (2026-11-03, evening) built the module architecture so it can be tested with mock integrations:

- `packages/modules`: the capability layer (D1, D3). `Module` = id, kind (core, passthrough, derived), source label, areas, capabilities, optional `scan`. `Capability` = name, kind (read, propose, execute), Swedish title and description, TypeBox input/output, `model` flag, `scope(actor)`, `run`. `Registry` registers modules, runs capabilities with scope checked on every call, derives areas per role, scans for thread drafts, and lists tools (never execute, D8).
- Mock integrations in `packages/modules/src/mock`: Heroma (absences, leave, delegations, shifts), Raindance (invoices, budget), Treserva (deviations), Kommunikation (notices with read receipts). Their records live in `packages/modules/src/mock/data.ts`; mutations persist in the `module_state` table through `@clew/db/state` (in-memory store for unit tests). One invoice answers "unknown" on purpose.
- Core modules with no adapter: `apps/server/src/people-module.ts` (users and permissions from `auth_person` and `auth_access_grant`; every other module's `scope` reads role and unit from here, the mocks link records by `personId`). The calendar is wrapped as a module in `apps/server/src/calendar-module.ts`; proposals keep the planner path.
- Threads are generic cards now: `module`, `area`, `summary`, `items` (rows with refs), `actions` (thread action contract: one primary, up to two secondary, overflow), `waitingOn` (Pågår utan dig), `deadline`, `receipt` (read-back rows: done, unknown, failed, skipped, undo window). Migrations 0001 and 0002; a partial unique index keeps one open pushed thread per person and topic, and the scan is serialised per person.
- API: `GET /api/areas`, `GET /api/modules` (the registry as data), `GET|POST /api/cap/:name` (standing actions, panel views), `POST /api/threads/:id/act|undo-receipt|snooze|dismiss`. The nightly job scans every person, not only managers; `receipt-final` closes undo windows.
- Web: `pages/start.tsx` is mission control (areas sidebar from Astryx List rows, Behöver dig sorted by deadline, Pågår utan dig collapsed, composer docked in the footer, Drawer as phase-one side panel). `components/card.tsx` renders any module's card with slots, ⋯ menu (Inte nu, Avfärda, Varför ser jag detta?) and the receipt.
- Checks: `bun test tests/unit` (13 tests, registry and mocks), `bun scripts/modules-check.ts` on the host (real login as Hillevi and Hassan, areas, cards, act, receipt, undo, unknown outcome, snooze, read receipt, scope denial).

Session 5 (2026-11-03, evening) reviewed the build against the canvas rows Fokus, Fokus 3, Chips, Kort-handlingar and Svar 4, then built the conversation:

- Server: `apps/server/src/assistant/` replaces `assistant.ts`. `POST /api/conversation {text, chips?, conversationId?}` answers in one of three shapes (`svar`, `vy`, `forslag`) and says how (`model`, `router`, `unavailable`). Order: the **chip path** first (one chipped card: `parseVerb` → Avfärda/Inte nu become `clewActions` to confirm, Varför answers from the trigger, "bara Anna och Johan" writes a draft to `items[].selected` with audit `thread.drafted`, "vecka 47 i stället" calls `planner.replan`), then the **model** (`generateText` with `registry.tools(actor)` as read-only tools, names mapped `heroma.whoIsOn` ↔ `heroma__whoIsOn`, 8 s timeout, Swedish system prompt with a "Du tittar på" block), then the **router** (the old fixed questions, then `matchCapability` over titles and descriptions, then an honest "not yet"). Every turn is a `question` thread with memory; `thread_message.meta` (migration 0003) keeps chips, refs, shape, view, draft, tool calls and mode. Also `GET /api/completions` (ask/do/recent per role), `GET /api/objects?q=` (visible objects first, then capabilities), `GET /api/threads/:id/verbs`, `GET /api/assistant/status` (configured/available, 60 s probe), `POST /api/threads/:id/reopen` (Ångra after Avfärda within 10 min, or after Inte nu). Proposal threads now carry `items` (`proposal:<id>`, names in rows per the decision below).
- Web: `components/composer.tsx` is the row (Astryx `ChatComposer`): the focus list (Fråga om verksamheten · Om det som visas · Gör något · Tidigare samtal) and the conversation live in the composer's **drawer** slot, unfolding upward from the row; the stream is dimmed with Astryx `Overlay` (D13); chips are tokens in the field via `@` (`ChatComposerInput` trigger over `/api/objects`) or "Lägg till i samtalet" on a card; the prefix reads Allt / Om 1 sak / Samtalet; with one chip and no text the footer shows the verbs; Esc or a click on the dim closes and the conversation reopens from Tidigare samtal or Redan hanterat › Frågor. Cards share the action row (primary, ≤2 secondary, Lägg till i samtalet, Inte nu = snooze, ⋯ with Avfärda and Varför ser jag detta?); Avfärda and Inte nu leave a toast with Ångra (reopen); the receipt badge says "Skickat hh:mm · kontrollerat mot …" and the primary slot becomes "Ångra allt · m:ss kvar". Redan hanterat is grouped by day with filters, Återöppna and reopening of questions; the mobile area row has a Redan hanterat button.
- Checks: `bun test tests/unit` (23 tests, including a real AI SDK wiring test with a fake fetch), `bun scripts/modules-check.ts` (conversation through the router, chips, drafts, reopen, objects, completions, verbs, employee scope), and the flows above verified in Chrome as Hillevi at desktop width. Mobile width was not screenshot this session (the automation window would not shrink); the components are the same.
- Astryx CLI under Bun isolated installs: `bun run astryx` cannot find core from the repo root. Working form: `docker exec -w /workspace/node_modules/.bun/@astryxdesign+core@0.7.6+65f46399a9db101b/node_modules/@astryxdesign/core clew-app-1 node /workspace/node_modules/@astryxdesign/cli/clients/cli/bin/astryx.mjs component <Name>` (see README).
- Routes (react-router through Astryx `LinkProvider`, so every Astryx `href` navigates client-side): `/` and `/omrade/:area` filter the stream, `/hanterat` is the log, `/vy/:capability?titel=&input=` and `/vy/kort/:threadId/:actionId` open the side panel (back or Esc closes it), `/samtal/:id` opens a conversation in the row (back closes it). `?omrade=` keeps the lens behind a view or conversation. The sidebar rows, the mobile area buttons, Redan hanterat's question rows and Tidigare samtal are links.
- Decided with the product owner: names may appear in card rows (the canvas wins over HANDOVER item 3; the guardrail now covers pushed text and notifications). The D8 degraded-mode banner is deferred; the status endpoint exists for it.

Known gaps and next steps, in order:

1. Done in session 5: the model path (`apps/server/src/assistant/model.ts`) is wired with the registry's read tools and the router as fallback; the decision endpoint and every execute capability stay outside the tool set. Still open: set `AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL` in `apps/server/.env.local` against an open-weight model and verify live (only the fake-fetch unit test and the router have run so far); build the D8 banner from `GET /api/assistant/status`; a `propose` capability so "flytta Annas till 15:00" can become a draft.
2. The thread accumulates messages across repeated confirm/undo cycles. Decide whether an undo collapses the memory or keeps it (it keeps it today, by design: memory is the point).
3. Decided 2026-11-03: the canvas wins; names appear in card rows (proposal rows are `items` with the participant name). The desktop week agenda on the calendar page still shows 'Utvecklingssamtal' chips; align it when the calendar page is next touched.
4. Not built from the canvas: 'Tyst till 09:30', 'Viktigt nu · 1', 'Samlad bild för dialog', the Dag/Vecka/Månad switch and 'Ny bokning' on the calendar page, 'Kan vänta till efter lunch'. All need data or features that do not exist yet.
5. `scripts/auth-dev-check.ts` is a host-side script; turn it into a Playwright test when the second use case lands.
6. Nothing is committed yet: the repository has `git init` on `main` and all files are untracked. Commit with a Swedish subject.
6. Switch `apps/server` to the Bun runtime (D7): dev and start scripts, replace `@hono/node-server` in `main.ts`, verify `postgres`, `openid-client` and the scheduler under Bun.
7. Build the dev login (D6): `AUTH_DEV_LOGIN` flag with the production refusal, seed file for `hillevi` and `hassan`, form in `apps/web` shown only when the BFF reports the flag.
8. Introduce `packages/capabilities` with the descriptor type and registry, and register the calendar reads and the confirm endpoint through it as part of item 1 (D1).
10. Build the `microsoft365` calendar adapter (D11) against Microsoft Graph (`/me/calendarView`, `/me/events`, `getSchedule` for free/busy) and settle how a delegated Graph token reaches the BFF: Keycloak as broker in front of Entra with stored external tokens, or OIDC directly against Entra in production. Needs an Entra tenant; the adapter branch exists in `packages/calendar/src/adapters.ts` and throws until then. Reword D5 so the municipality's IdP is the production authorization server and Keycloak is dev and broker.
9. Done in session 5 (overlay in the composer drawer, chips via `@` and the card button, scope prefix, verbs, drafts). Left: drag an object to the row; `event:` and `proposal:` chips are resolved server-side but the side panel's day view that would offer them is not built; the ScrollableArea in the drawer has a fixed height (56vh desktop, 360 px mobile) because Astryx has no max-height prop, so short conversations leave space above; reminders ("påminn mig om två veckor") need a `reminder` job kind.
10. Before the first `apps/mcp-<name>` host: keep the ID token from login sealed with the other tokens, publish Clew's Client ID Metadata Document, and upgrade the shared dev Keycloak to 26.7+ with the `identity-assertion-jwt` feature flag so ID-JAG acceptance can be tried (D5).

## 1. What Clew is

A chat-first start page for Sundsvalls kommun where the assistant takes the initiative. There is no navigation, no tabs and no configurable blocks. The question box is the page. Everything else on the page is the assistant answering "what needs me now?" as **threads** the user can reply to in place. The assistant pushes threads on a schedule or on events, rations its interruptions, and executes actions through MCP tools after the user confirms.

Design canvas (Claude Design, private until shared): https://claude.ai/artifact/RhnCjPeZZHMmbvHQ5ZXobe

Rows on the canvas, top to bottom:

1. Chat-only start page, desktop (Hillevi, rektor) and mobile (Hassan, undersköterska), thread anatomy, target architecture, three sticky notes.
2. Asking a question on mobile: bottom sheet for the moment, thread on the page for the memory.
3. Asking a question on desktop: typeahead under the box, answer unfolds as a thread.
4. Hybrid: chat-first page plus a persistent "Läget" row with four key figures.
5. **Use case to build first:** a manager plans utvecklingssamtal, with proposals drawn in a week view, a full calendar page and a mobile version.

Source material: `~/Desktop/SC_Ekonomi 261103.pdf` (the steering deck, 14 slides) and the `startsidan` repository at `~/code/startsidan`.

## 2. Decisions taken

| Area | Decision | Note |
|---|---|---|
| Codename | `clew` (a ball of thread; Ariadne's clew leads out of the labyrinth) | Repo `clew`, packages `@clew/*`. UI says Startsidan. |
| Dev environment | Devcontainer, Docker Compose, same shape as startsidan | `.devcontainer/` copied from startsidan: `node:24.21.0-bookworm`, Bun 1.4.2, Postgres 17, Nextcloud calendar profile. NATS removed. `.mise.toml` matches the Dockerfile. Commands run through `docker exec clew-app-1`. |
| Package manager and scripts | Bun, exact versions, frozen lockfile | Bun 1.4 uses isolated installs: every workspace package declares what it imports (no hoisting to rely on). |
| Server runtime | **Bun** (`bun --watch`), decided 2026-11-03, switch pending | Replaces "Node 24 + tsx" from session 1. Hono serves through Bun's native server instead of `@hono/node-server`. Node stays in the image only as a toolchain for Vite, drizzle-kit and the Astryx CLI until verified under Bun. See `docs/decisions.md` D7. |
| Backend | **Hono 4.13.16 + `@hono/node-server` 2.1.6** | Decided 2026-11-03. Web-standard `Request`/`Response`; AI SDK and MCP plug in without adapters. Note: Hono routes handler errors to `app.onError`, not through middleware `try/catch`, so the error mapper lives in `onError`. |
| Frontend | React 19.3.1 + Vite 8.3.5 + `@astryxdesign/core` 0.7.6 with the default Neutral theme (`/built` + `theme.css`) | Plain CSS path, no StyleX plugin. `astryx doctor` is green. Swedish strings from `locales/sv-SE.json` plus a few overrides in `packages/ui`. React Router 8.5.1 for the three routes. |
| UI composition | **Strictly Astryx, no custom components.** Decided 2026-11-03 after the design review. The week view is an Astryx `Grid` agenda (one column per weekday, `Token`/`ListItem` entries), not a time grid. `styles.css` holds only the Astryx imports and body basics. | The startsidan week-grid exception is withdrawn. AI surfaces use Astryx's Chat family; Vercel's `ai-elements` (shadcn/Tailwind/Radix) was evaluated and rejected as a second component system. Use it only as a pattern reference. |
| Database | Postgres 17 + Drizzle 0.45.4 + drizzle-kit 0.31.11 | `bun run db:generate`, review SQL, `bun run db:init` applies. Migrations are checked in. |
| Identity | Keycloak OIDC for people, OAuth 2.1 JWT access tokens for every call on their behalf, per the MCP authorization spec 2026-07-28 plus the Enterprise-Managed Authorization extension (ID-JAG). **Only identification path.** | Ported login, not rewritten. Realm `clew`, client `clew-web`. Session cookie `clew-session`, 8 h idle and absolute. No per-server consent popup: token exchange inside our Keycloak, ID-JAG across trust domains, `authorization_code` only as logged fallback. The model has no identity. SCIM 2.0 provisions users and groups. Keycloak accepts ID-JAGs from 26.7 (experimental); dev runs 26.2. Design: `docs/architecture/identity.md`, D5. |
| Model dependency | **The model is optional.** Every read, propose and execute path is deterministic and reachable without it; the composer degrades to an intent router with typeahead. | Decided 2026-11-03, D8. The planner and the decision endpoint already work this way. |
| Side panel | Conversation, Clew-rendered views and sandboxed MCP App views in one panel beside the stream (bottom sheet on phone), with a "Du tittar på" scope block. | Decided 2026-11-03, D9. Clicking a proposal shows the day around it; "Se i Heroma" shows Heroma's own view. Names may appear in an app surface, never in a card. |
| Interaction pattern | **Objects, chips, proposals.** Every rendered thing has a ref; add it to the conversation as a chip by click, drag or `@`; the conversation edits cards as drafts; the card's button executes. | Decided 2026-11-03, D12. Modelled on Cursor/Claude Code context pills, M365 Copilot Context IQ and Gemini `@Calendar`. |
| Dev login | Username and password form, local only (`AUTH_DEV_LOGIN=true`, never in production) | Mints a normal session for a seeded persona, marked `auth: 'dev'`. Decided 2026-11-03, not built. D6. |
| Integration contracts | **Clew owns every contract.** Capability descriptors (`kind`, `scope`, `model`) in `packages/contracts`; REST views and model tools are projections of the same capability. | No OpenAPI-to-MCP conversion in the running system; Clew publishes OpenAPI for its own BFF instead. Foreign MCP servers are wrapped, not passed through. Design: `docs/architecture/integrations.md`, D1–D4. |
| Who meets the contract | **Integrations are asked to fulfil Clew's API first; if they cannot, Clew writes the adapter.** Decided 2026-11-03, D10. | Sundsvall today: Heroma has no API (RPA), Raindance and aggregates go through dept44 services behind WSO2 (`service` mode + `scope`), Microsoft 365 through Graph (`user-delegated`). |
| Module kinds | Core (Clew DB), pass-through (external system, refs + audit only), derived (snapshot) | Core has no provider interface. Pass-through is in-process first, lifted to `apps/mcp-<name>` when cadence, network zone or ownership demands. D3. |
| Scheduled work | **Postgres-backed scheduler in v1, Temporal later** | Decided 2026-11-03. One `job` table, row-locked claims, nightly `scan-utvecklingssamtal` at 06:00 Stockholm plus one `undo-expiry` timer per confirmation. Temporal comes with the push engine / second use case. |
| Calendar access | **In-process behind the `CalendarProvider` interface, MCP later. One contract, two adapters: `caldav` and `microsoft365`, selected per account.** | Decided 2026-11-03, D11. The interface in `packages/calendar/src/model.ts` is the tool surface an MCP server would expose; `packages/calendar/src/adapters.ts` picks the adapter from `CalendarCredential.kind`. `caldav` is the verified Nextcloud provider; `microsoft365` is a typed branch that throws until built. `@modelcontextprotocol/sdk` is not installed yet. |
| Agent actions | Confirm-first in version 1 | The human decision endpoint (`POST /api/threads/:id/confirm`) re-validates every proposal against live calendars and is not a tool. Undo is ten minutes. |
| Language | Swedish only in the product UI (and API errors the UI shows). English for code, comments, console and script output, infra messages, docs. Swedish commit subjects. | Tightened 2026-11-03: scripts and console output used to be Swedish. |
| Licensing | **Open source only.** Clew will be shared with other municipalities and governments. No closed-source dependencies, packages, images, fonts or required hosted services. | Decided 2026-11-03. Rule and checklist in `CLAUDE.md`. Licence audit of everything pinned is in section 3. |

## 3. Backend: decided, kept for the record

Hono on Node was chosen (see section 2). The comparison that led there, with npm weekly downloads on 2026-11-03:

| Option | Downloads | Fit for Clew |
|---|---|---|
| **Hono + `@hono/node-server`** | 101M / 95M | Web-standard `Request`/`Response`; AI SDK and MCP SDK plug in without adapters; same code runs on Bun later. Chosen. |
| Fastify 5 + TypeBox provider | 21.7M / 0.9M | Most proven Node server; needs the Node adapters for AI SDK and MCP. The conservative alternative. |
| Express 5 / NestJS / Elysia / Koa | | Not chosen: no typing story, too much structure, Bun-only, or declining. |

Licence audit 2026-11-03, all open source: Astryx (`@astryxdesign/*`, github.com/meta/astryx) MIT; `@stylexjs/stylex`, `hono`, `@hono/node-server`, `drizzle-kit`, `openid-client`, `jose`, `fast-xml-parser`, `temporal-polyfill`, `@sinclair/typebox`, `ajv`, `ajv-formats`, `tsx`, `react`, `react-dom`, `react-router`, `vite`, `@vitejs/plugin-react` MIT; `drizzle-orm`, `ai`, `@ai-sdk/openai-compatible`, `typescript` Apache-2.0; `postgres` Unlicense; `ical.js` MPL-2.0; `lucide-react` ISC; `intl-messageformat` BSD-3-Clause. Infrastructure: Keycloak Apache-2.0, Nextcloud and RoomVox AGPL-3.0 (separate containers, synthetic dev calendar only), Mailpit MIT, PostgreSQL licence, Node MIT, Bun MIT. The model endpoint for the question box is not chosen; it must be an open-weight model behind an OpenAI-compatible API (see `CLAUDE.md`).

Pinned and installed: `drizzle-orm` 0.45.4, `drizzle-kit` 0.31.11, `postgres` 3.4.9 (4.0.0 exists; not tried with Drizzle), `ai` 7.0.162, `@ai-sdk/openai-compatible` 3.0.84, `openid-client` 6.8.9, `jose` 6.2.15, `ical.js` 2.2.1, `fast-xml-parser` 5.11.2, `temporal-polyfill` 1.0.6, `@sinclair/typebox` 0.34.52, `ajv` 8.20.0, `ajv-formats` 3.0.1, `typescript` 7.0.2, `tsx` 4.23.15, `react-router` 8.5.1, `@vitejs/plugin-react` 6.2.1, `@stylexjs/stylex` 0.19.1 (peer of Astryx only).

## 4. Open questions

Product questions from the design review, still unanswered:

1. Is the 2026 KPI surface a hard commitment that must be visible at a glance, or exception-based plus on demand? The built "Läget" row assumes "at a glance".
2. Is Göra/Hitta/Veta/Förstå a UI requirement from the taktisk grupp, or internal framing? Clew hides it.
3. Is the read receipt a compliance record, and must "Viktigt nu" always be visible? Clew gives it a header counter ("1 av 3 avbrott i dag").
4. Is there appetite for standing consent on reversible actions? Clew v1 says no.
5. Who owns news and documents once the new intranet exists?
6. Explored on the canvas 2026-11-03, not decided: first login as a welcome thread (no wizard), a time-boxed "Min första vecka" area for new employees (UC-OMAR-1), and notifications as deliveries of thread state over three channels (page, push for same-day deadlines only, e-mail digest at bundle times) under the attention budget. User-created reminders and watches are the user's own triggers in the same model; watches with conditions are what brings in Temporal. Läget moved from a strip into the sidebar, one line per area. "Väntar inte på dig" demoted from a section to one collapsed line at the end of the stream. Completion drawn as a countdown to zero plus a done state that names the work (row "Att bli klar"). Hassan's shift drawn as three phone frames: before, during (voice incident report with field-by-field confirmation), after (row "En dag med Hassan"). Answers have three shapes, Svar, Vy and Förslag, and a view is an addressable deterministic page the composer can ask about (row "Svar och vyer"; `docs/architecture/integrations.md`, Answers and views). Open: whether a per-person view counts as "inside the source system" for the names guardrail.

Technical questions settled in session 1: Hono (yes), Temporal (not in v1), Astryx under Vite (works without plugins), calendar as MCP (in-process first). Settled 2026-11-03 after session 1: integration architecture and identity (`docs/architecture/`, `docs/decisions.md` D1–D7), Bun as server runtime. Still open: when to lift the calendar out into an MCP server, and which model endpoint the question box should use.

## 5. First use case: a manager plans the week (built)

Persona: Hillevi, rektor. Four utvecklingssamtal remain before 28 November. The assistant finds slots next week that suit her and each employee, draws the proposals in her week, she confirms, invitations go out, and she can undo for ten minutes.

In scope:

- Question box at the top. Typeahead with completions. An answer becomes a thread under the box.
- "Läget" row: four figures, always the same shape: korttidsfrånvaro, budgetavvikelse, HME, utvecklingssamtal. Synthetic data behind a read interface in v1.
- "I dag" strip: today's meetings on a timeline with free gaps marked.
- One pushed thread: proposals rendered in a small week view, legend, confirm, "visa i kalendern", "vecka 47 i stället", a "varför nu?" line with source and time.
- Calendar page: the week as an Astryx Grid agenda (Mon–Fri), week navigation, the same thread as a side panel with checkboxes. No drag-to-move and no time grid (decided 2026-11-03): the assistant redraws instead of the user dragging.
- Mobile: chip row for today, checklist of proposals, confirm, link to the week view.
- Undo window after sending, with the result shown under "Redan hanterat".
- Real calendar through CalDAV. Reuse `packages/calendar-nextcloud` and the proposal logic from startsidan docs 28 and 34.

Out of scope for the first build: attest and incidents (no Heroma or Raindance MCP servers exist), standing consent, voice, news, Studio or any page editor.

Acceptance, the kind that can be checked: a logged-in manager sees four proposals that do not collide with any existing event in her or the employees' calendars; confirming creates four CalDAV events and an audit row; undo within ten minutes removes them and writes a second audit row; the thread survives reload and shows the same state on desktop and mobile.

## 6. UX principles to hold on to

- The question box is the page. No navigation, no tabs, no blocks.
- Every proactive item is a thread with a reply field and memory. No separate chat log.
- Attention budget: a fixed number of interruptions per day, visible in the header. The rest is bundled to lunch or the next morning.
- Every thread answers "varför ser jag detta?" with trigger, source and time.
- Figures are plain sentences with a comparison, not KPI tiles, except in the fixed "Läget" row.
- The conversation is an overlay that unfolds from the composer row over the dimmed stream, desktop and phone alike, never a modal and never the side panel. The row keeps focus throughout; sending never moves it. The side panel is for views and apps only.
- After an execute, the card becomes a receipt: each row shows the source system's answer read back (sent, moved, unknown with retry, not sent), the badge says when it was checked, the primary button becomes undo with a countdown, and any panel view re-reads from the source. Green only on a read-back, never on a sent request.
- Objects, chips, proposals (D12): everything rendered is an object with a ref; objects become chips in the conversation by click, drag or `@`; the conversation edits cards, never systems; the card's button executes. The side panel stays live under the dim for picking. It opens with a scope block that says what it is looking at. Cards hold state and actions and never contain a text input. (Replaces the session-1 line "no overlay on desktop", which assumed the box at the top. Canvas row "Samtalet får en egen yta", 2026-11-03.)
- Names of individual employees are shown inside the source system, never in the stream.
- Status is shown with lightness as well as hue. Touch targets 44 px. Real buttons, inputs and labels.
- Every thread card has the same action slots: one module primary, up to two module secondaries, and Clew's standard `Svara`, `Inte nu`, `Avfärda`, `Varför ser jag detta?` behind `⋯`. Modules contribute actions, never layout (`docs/architecture/integrations.md`, thread action contract).
- Completion is a feeling the page earns, not a game: the "Behöver dig" counter counts down and reaches zero, the done state names what was done and how long it took, and routine obligations with a deadline get a meter (11 av 12 samtal). No points, levels, badges, leaderboards or streaks; dismissing never counts as done.
- Motion is subtle and functional: 160 to 220 ms ease-out on height and opacity when a card expands, collapses, enters from the composer or leaves after a decision; counters tick, nothing bounces or slides across the page; `prefers-reduced-motion` turns every transition off. Motion explains what moved, never decorates.

## 7. Guardrails carried over from startsidan

- **Open source only.** No closed-source dependency of any kind; check the licence before pinning. The system is meant to be shared with other municipalities and governments. Full rule in `CLAUDE.md`.
- Server-side enforcement of identity, scope and module state. Visibility never grants access.
- No credentials, tokens, database clients or trusted identity context in the browser bundle.
- OIDC is the only way a person is identified. Every downstream call carries an audience-bound OAuth 2.1 token for that person; the model never holds a token. The dev login is local-only and refuses to start in production.
- Every mutation writes its audit row in the same transaction. External commands have explicit status and an `unknown` outcome when a reply is lost.
- Assistant proposals are validated by the server and executed only through a human decision endpoint that is not a tool.
- Every capability works without the model: a REST route, a button or a standing action. A provider outage degrades the composer, never the page (D8).
- Scope every source before joining. No raw SQL tools for the model.
- Astryx components and documented composition patterns only. No custom components, no custom CSS beyond the Astryx imports and body basics (decided 2026-11-03; the former week-view exception is withdrawn). No second component system (`ai-elements`, shadcn, Tailwind).
- The design canvas follows Astryx, not the other way round: when a drawn control has no Astryx counterpart, the canvas is redrawn in the component's shape (decided 2026-11-03 for the composer: `ChatComposer`, a rounded box with context line, field, microphone and send, chips as tokens in the field).

## 8. Repository layout (as built)

```
clew/
  .devcontainer/          compose.yaml, Dockerfile, devcontainer.json, calendar/ (Nextcloud image + seed)
  apps/web/               React 19 + Vite + Astryx Neutral: pages/start, pages/calendar, pages/login, components/
  apps/server/            Hono BFF: auth, routes/, planner, assistant (router), scheduler, figures, calendar
  packages/contracts/     TypeBox schemas and types: thread, proposal, calendar event, figure, inputs
  packages/db/            Drizzle schema, migrations, auth/thread/job queries
  packages/calendar/      model (provider interface), dates, nextcloud provider, accounts, proposals (planner)
  packages/modules/       capability layer: Module, Capability, Registry; mock/ (heroma, raindance, treserva, kommunikation, data); memory-state
  packages/ui/            Providers (theme + sv-SE), Astryx re-exports, session boundary, Grid week agenda, styles.css (imports only)
  scripts/                compose.sh, calendar.sh, db-init, auth-setup, calendar-seed, auth-dev-check
  tests/unit/             bun test
  docs/                   decisions.md (decision log D1–D12), architecture/integrations.md, architecture/identity.md, personas.md (nine personas and 35 use cases from startsidan)
  HANDOVER.md             this file · README.md run instructions
```

No `apps/worker`: Temporal is not in v1.

## 9. Session log

Session 5, 2026-11-03: design review against the canvas; conversation endpoint with chips, verbs, drafts, model path and router fallback; composer drawer overlay, card standard actions with undo, Redan hanterat with filters. See section 0.

Session 4, 2026-11-03: module architecture implemented with four mock integrations, the core people module and the calendar as a module; threads generalised to cards with action slots and receipts; mission-control start page. See section 0.

Session 3, 2026-11-03: platform review against startsidan (no hard blockers; risks are Microsoft 365 calendars needing Graph plus an Entra token path, Heroma having no API, and Astryx still being beta). Decided D10 (integrations fulfil Clew's API first, adapters as fallback) and D11 (one calendar contract, `caldav` and `microsoft365` adapters selected per account); `packages/calendar/src/adapters.ts` added and the synthetic bindings routed through it. Next step 10 added.

Session 2, 2026-11-03: architecture and identity decisions documented (D1–D7); mission-control exploration added to the design canvas (row "Mission control", artboards Mission, Mission-omrade, Mission-mobil, Entiteter) with validation against the startsidan personas in `docs/personas.md`. Nothing built from it yet; the open conflict is the sidebar versus the "no navigation" principle.

Session 1, 2026-11-03: checklist items 1–6 done (devcontainer, Hono decided, Astryx under Vite verified, schema and migration, Keycloak login for real, calendar page, start page with one pushed thread, mobile). See section 0 for the state and the ordered next steps.

Keep this file updated. It is the only context the next session has.
