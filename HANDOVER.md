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
- Web (`apps/web`, Vite + React 19 + Astryx 0.7.6 Neutral): login page, start page (question box with typeahead, Läget, I dag, threads with a compact week view, confirm / justera / vecka N i stället / inte nu / ångra, reply field), calendar page (08–17 week, navigation, side panel with checkboxes), mobile layout (bottom sheet for asking, chip row for today, checklist). Astryx renders on the plain CSS path; **no StyleX plugin is needed** as long as nobody writes `stylex.create()` in app code. The week grid is the inherited custom composition and uses plain CSS in `packages/ui/src/styles.css`.
- Acceptance verified end to end on 2026-11-03 with `bun scripts/auth-dev-check.ts hillevi` (run on the host): login as Hillevi, four proposals in week 46 that collide with nothing in her or the four employees' calendars, confirm creates four CalDAV events and one audit row, undo within ten minutes removes them and writes a second audit row, the thread survives reload. Unit tests cover the planner and free-gap logic (`bun test tests/unit`).

Known gaps and next steps, in order:

1. The question box answers through a deterministic intent router (`apps/server/src/assistant.ts`), not a model. `ai` 7.0.162 and `@ai-sdk/openai-compatible` 3.0.84 are installed and pinned but not wired; `AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL` are listed in `apps/server/.env.example`. Wire `generateText` with a calendar read tool next, keep the router as the fallback, and keep the human decision endpoint outside the tool set.
2. The thread accumulates messages across repeated confirm/undo cycles. Decide whether an undo collapses the memory or keeps it (it keeps it today, by design: memory is the point).
3. Employee names appear only on the calendar page and in the thread's hidden checklist labels; the start-page stream shows "Utvecklingssamtal" chips without names, per the guardrail. Review this with the design canvas.
4. `scripts/auth-dev-check.ts` is a host-side script; turn it into a Playwright test when the second use case lands.
5. Nothing is committed yet: the repository has `git init` on `main` and all files are untracked. Commit with a Swedish subject.
6. Switch `apps/server` to the Bun runtime (D7): dev and start scripts, replace `@hono/node-server` in `main.ts`, verify `postgres`, `openid-client` and the scheduler under Bun.
7. Build the dev login (D6): `AUTH_DEV_LOGIN` flag with the production refusal, seed file for `hillevi` and `hassan`, form in `apps/web` shown only when the BFF reports the flag.
8. Introduce `packages/capabilities` with the descriptor type and registry, and register the calendar reads and the confirm endpoint through it as part of item 1 (D1).
9. Before the first `apps/mcp-<name>` host: keep the ID token from login sealed with the other tokens, publish Clew's Client ID Metadata Document, and upgrade the shared dev Keycloak to 26.7+ with the `identity-assertion-jwt` feature flag so ID-JAG acceptance can be tried (D5).

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
| Database | Postgres 17 + Drizzle 0.45.4 + drizzle-kit 0.31.11 | `bun run db:generate`, review SQL, `bun run db:init` applies. Migrations are checked in. |
| Identity | Keycloak OIDC for people, OAuth 2.1 JWT access tokens for every call on their behalf, per the MCP authorization spec 2026-07-28 plus the Enterprise-Managed Authorization extension (ID-JAG). **Only identification path.** | Ported login, not rewritten. Realm `clew`, client `clew-web`. Session cookie `clew-session`, 8 h idle and absolute. No per-server consent popup: token exchange inside our Keycloak, ID-JAG across trust domains, `authorization_code` only as logged fallback. The model has no identity. SCIM 2.0 provisions users and groups. Keycloak accepts ID-JAGs from 26.7 (experimental); dev runs 26.2. Design: `docs/architecture/identity.md`, D5. |
| Dev login | Username and password form, local only (`AUTH_DEV_LOGIN=true`, never in production) | Mints a normal session for a seeded persona, marked `auth: 'dev'`. Decided 2026-11-03, not built. D6. |
| Integration contracts | **Clew owns every contract.** Capability descriptors (`kind`, `scope`, `model`) in `packages/contracts`; REST views and model tools are projections of the same capability. | No OpenAPI-to-MCP conversion in the running system; Clew publishes OpenAPI for its own BFF instead. Foreign MCP servers are wrapped, not passed through. Design: `docs/architecture/integrations.md`, D1–D4. |
| Module kinds | Core (Clew DB), pass-through (external system, refs + audit only), derived (snapshot) | Core has no provider interface. Pass-through is in-process first, lifted to `apps/mcp-<name>` when cadence, network zone or ownership demands. D3. |
| Scheduled work | **Postgres-backed scheduler in v1, Temporal later** | Decided 2026-11-03. One `job` table, row-locked claims, nightly `scan-utvecklingssamtal` at 06:00 Stockholm plus one `undo-expiry` timer per confirmation. Temporal comes with the push engine / second use case. |
| Calendar access | **In-process behind the `CalendarProvider` interface, MCP later** | Decided 2026-11-03. The interface in `packages/calendar/src/model.ts` is the tool surface an MCP server would expose. `@modelcontextprotocol/sdk` is not installed yet. |
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

Technical questions settled in session 1: Hono (yes), Temporal (not in v1), Astryx under Vite (works without plugins), calendar as MCP (in-process first). Settled 2026-11-03 after session 1: integration architecture and identity (`docs/architecture/`, `docs/decisions.md` D1–D7), Bun as server runtime. Still open: when to lift the calendar out into an MCP server, and which model endpoint the question box should use.

## 5. First use case: a manager plans the week (built)

Persona: Hillevi, rektor. Four utvecklingssamtal remain before 28 November. The assistant finds slots next week that suit her and each employee, draws the proposals in her week, she confirms, invitations go out, and she can undo for ten minutes.

In scope:

- Question box at the top. Typeahead with completions. An answer becomes a thread under the box.
- "Läget" row: four figures, always the same shape: korttidsfrånvaro, budgetavvikelse, HME, utvecklingssamtal. Synthetic data behind a read interface in v1.
- "I dag" strip: today's meetings on a timeline with free gaps marked.
- One pushed thread: proposals rendered in a small week view, legend, confirm, "visa i kalendern", "vecka 47 i stället", a "varför nu?" line with source and time.
- Calendar page: full week view 08 to 17, week navigation, the same thread as a side panel with checkboxes. No drag-to-move (removed 2026-11-03 after the first build: the page should be dynamic enough that the assistant redraws instead of the user dragging).
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
- Mobile: bottom sheet for asking, thread on the page afterwards. Desktop: no overlay, the answer unfolds under the box.
- Names of individual employees are shown inside the source system, never in the stream.
- Status is shown with lightness as well as hue. Touch targets 44 px. Real buttons, inputs and labels.

## 7. Guardrails carried over from startsidan

- **Open source only.** No closed-source dependency of any kind; check the licence before pinning. The system is meant to be shared with other municipalities and governments. Full rule in `CLAUDE.md`.
- Server-side enforcement of identity, scope and module state. Visibility never grants access.
- No credentials, tokens, database clients or trusted identity context in the browser bundle.
- OIDC is the only way a person is identified. Every downstream call carries an audience-bound OAuth 2.1 token for that person; the model never holds a token. The dev login is local-only and refuses to start in production.
- Every mutation writes its audit row in the same transaction. External commands have explicit status and an `unknown` outcome when a reply is lost.
- Assistant proposals are validated by the server and executed only through a human decision endpoint that is not a tool.
- Scope every source before joining. No raw SQL tools for the model.
- Astryx components and documented composition patterns. A custom component needs explicit authorization first. The only inherited exception is the calendar week view and its event chips.

## 8. Repository layout (as built)

```
clew/
  .devcontainer/          compose.yaml, Dockerfile, devcontainer.json, calendar/ (Nextcloud image + seed)
  apps/web/               React 19 + Vite + Astryx Neutral: pages/start, pages/calendar, pages/login, components/
  apps/server/            Hono BFF: auth, routes/, planner, assistant (router), scheduler, figures, calendar
  packages/contracts/     TypeBox schemas and types: thread, proposal, calendar event, figure, inputs
  packages/db/            Drizzle schema, migrations, auth/thread/job queries
  packages/calendar/      model (provider interface), dates, nextcloud provider, accounts, proposals (planner)
  packages/ui/            Providers (theme + sv-SE), re-exports, session boundary, week view, styles.css
  scripts/                compose.sh, calendar.sh, db-init, auth-setup, calendar-seed, auth-dev-check
  tests/unit/             bun test
  docs/                   decisions.md (decision log D1–D7), architecture/integrations.md, architecture/identity.md
  HANDOVER.md             this file · README.md run instructions
```

No `apps/worker`: Temporal is not in v1.

## 9. Session log

Session 1, 2026-11-03: checklist items 1–6 done (devcontainer, Hono decided, Astryx under Vite verified, schema and migration, Keycloak login for real, calendar page, start page with one pushed thread, mobile). See section 0 for the state and the ordered next steps.

Keep this file updated. It is the only context the next session has.
