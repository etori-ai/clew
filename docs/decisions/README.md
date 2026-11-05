# Decision log

One file per decision, numbered in the order they were taken. A decision says what was decided, why, and
what it replaces. `HANDOVER.md` section 2 carries the short table of what is in force; the files here carry
the reasoning. Longer designs live in `docs/architecture/`, and the reviews that led to decisions live in
`docs/reviews/`.

| # | Decision | Date | Area | Status |
|---|---|---|---|---|
| [D1](D01-clew-owns-every-integration-contract.md) | Clew owns every integration contract | 2026-11-03 | integrations | accepted |
| [D2](D02-no-openapi-to-mcp-conversion.md) | No OpenAPI-to-MCP conversion in the running system | 2026-11-03 | integrations | accepted |
| [D3](D03-three-module-kinds.md) | Three module kinds: core, pass-through, derived | 2026-11-03 | integrations | accepted, out-of-process shape replaced by D21 |
| [D4](D04-foreign-mcp-servers-are-wrapped.md) | Foreign MCP servers are wrapped, not passed through | 2026-11-03 | integrations | accepted |
| [D5](D05-oidc-and-oauth-only-identification-path.md) | OIDC and OAuth 2.1 with JWT access tokens are the only identification path | 2026-11-03 | identity | accepted |
| [D6](D06-dev-login-local-only.md) | Dev login with username and password, local only | 2026-11-03 | identity | accepted, not built yet |
| [D7](D07-bun-is-the-server-runtime.md) | Bun is the server runtime | 2026-11-03 | platform | superseded by D16 |
| [D8](D08-every-action-works-without-the-model.md) | Every action works without the model | 2026-11-03 | product | accepted |
| [D9](D09-side-panel-holds-views-and-apps.md) | The side panel holds conversation, Clew views and MCP App views | 2026-11-03 | ui | accepted, the MCP App views replaced by D38 |
| [D10](D10-integrations-fulfil-clews-api-first.md) | Integrations fulfil Clew's API; adapters are the fallback | 2026-11-03 | integrations | accepted |
| [D11](D11-one-calendar-contract-two-adapters.md) | One calendar contract, CalDAV and Microsoft 365 as adapters | 2026-11-03 | integrations | accepted, `microsoft365` adapter not built yet |
| [D12](D12-objects-chips-proposals.md) | Objects, chips, proposals: the general interaction pattern | 2026-11-03 | ui | accepted |
| [D13](D13-conversation-in-the-composer-drawer.md) | The conversation lives in the composer's drawer; the dim is an Astryx Overlay | 2026-11-03 | ui | superseded by D31 |
| [D14](D14-clew-stands-alone-eneo-enhances.md) | Clew stands alone; Eneo enhances it through an optional module | 2026-11-04 | product | accepted |
| [D15](D15-postgres-scheduler-now-temporal-later.md) | Postgres-backed scheduler in v1, Temporal later | 2026-11-03 | platform | accepted, narrowed by D17 |
| [D16](D16-node-is-the-server-runtime.md) | Node is the server runtime; Bun stays the toolchain | 2026-11-04 | platform | accepted |
| [D17](D17-temporal-runs-the-durable-timers.md) | Temporal runs the durable timers, starting with a person's own reminders | 2026-11-04 | platform | accepted |
| [D18](D18-errands-are-a-clew-owned-passthrough-domain.md) | Errands are a Clew-owned pass-through domain; SupportManagement is the first adapter | 2026-11-04 | integrations | proposed, hosting shape replaced by D35 |
| [D19](D19-change-notification-is-a-clew-owned-contract.md) | Change notification is a Clew-owned contract: payload-free CloudEvents over HTTP | 2026-11-04 | integrations | proposed |
| [D20](D20-modular-monolith-ports-and-adapters.md) | Backend structure: a modular monolith with ports and adapters, not tactical DDD | 2026-11-04 | platform | accepted |
| [D21](D21-integrations-are-module-services.md) | Every integration is a module service behind the Clew module protocol | 2026-11-04 | integrations | accepted, vocabulary replaced by D22 (connector) |
| [D22](D22-connectors-not-modules.md) | Connectors, not modules: the word for an integration that a person, an operator or a vendor meets | 2026-11-04 | integrations | accepted |
| [D23](D23-connectors-are-managed-in-the-database.md) | Connectors are registered and governed in the database by an administrator, not by environment variables | 2026-11-04 | integrations | accepted, admin API and screens not built yet |
| [D24](D24-model-endpoints-are-administered-in-the-product.md) | Model providers and models are administered in the product, and the chat can choose between them | 2026-11-04 | product | accepted, built |
| [D25](D25-use-cases-over-ports-fast-tests.md) | Use cases take their ports from a composition root; the unit suite runs on memory adapters held to a store contract | 2026-11-04 | platform | accepted |
| [D26](D26-questions-over-documents-are-search-not-knowledge.md) | Questions answered from documents are a search fan-out with citations, not a knowledge module | 2026-11-04 | product | proposed |
| [D27](D27-event-calendar-is-fullcalendar-themed-with-astryx-tokens.md) | The event calendar is FullCalendar 7 Standard, themed with Astryx tokens, behind Astryx components | 2026-11-04 | ui | accepted, built; narrowed by D32 |
| [D28](D28-the-stream-has-two-groups-and-three-piles.md) | The stream has two groups (Nu, Senare) and three piles above the composer; snooze is its own column; the day is drawn as one track | 2026-11-04 | ui | accepted |
| [D29](D29-inte-nu-is-a-timed-snooze-that-breaks-on-activity.md) | "Inte nu" is a timed snooze with a visible landing time that breaks on activity; conditions wait | 2026-11-04 | product | accepted |
| [D30](D30-a-proposal-thread-is-an-obligation-with-four-steps.md) | A proposal thread is an obligation with four steps, replies read back, follow-ups as cards under a fixed policy | 2026-11-04 | product | accepted, live run unverified |
| [D31](D31-the-conversation-swaps-the-stream-inside-one-chatlayout.md) | The conversation swaps the stream inside one ChatLayout; chips live in the composer drawer; the shell is AppShell | 2026-11-04 | ui | accepted |
| [D32](D32-one-calendar-family-and-the-persons-own-bookings.md) | One calendar family (page grid, embedded day and list, month picker, one item mapping); a person's own bookings and proposal moves are use cases with audit rows, never tools | 2026-11-04 | ui | accepted |
| [D33](D33-browser-reads-go-through-one-query-cache.md) | Browser reads go through one query cache (TanStack Query) per session; a mutation's thread is written into it; no page-level reloads | 2026-11-04 | ui | accepted, live pass against Keycloak pending |
| [D34](D34-the-box-is-the-page-and-the-push-is-its-brief.md) | The box is the page; the push is its brief; one rail orders everything by time and carries the product and the person (no TopNav); four kinds (requirement, proposal, event, figure); plain Neutral as drawn | 2026-11-04, amended 2026-11-05 | ui | accepted, implemented |
| [D35](D35-errands-are-a-connector-profile-and-a-card-is-one-systems.md) | Errands from several case systems: one connector per system, a shared profile for the reads, and a card's buttons reach only its own connector | 2026-11-05 | integrations | accepted, card-action rule built; errand profile not built |
| [D36](D36-an-answer-is-drawn-as-it-is-written.md) | An answer is drawn as it is written (server-sent steps and text, the question at once, Stoppa, skeletons on first read); the landing's box never moves under the cursor; the model menu always shows; "Lägg till i samtalet" is an icon | 2026-11-05 | ui | accepted, built |
| [D37](D37-header-logo-is-installation-branding.md) | One configurable header logo per installation, rendered by the shared shell through Astryx's navigation heading icon slot | 2026-11-05 | ui | accepted, extended by D38 |
| [D38](D38-municipal-branding-uses-astryx-themes.md) | Municipal logo and colour profiles share one contract; Sundsvall, Neutral and custom colours extend Astryx themes | 2026-11-05 | ui | accepted, extended by D39 |
| [D39](D39-compact-header-profile-and-reminders.md) | Compact shared header with profile, persisted appearance and existing reminder links | 2026-11-05 | ui | accepted |
| [D37](D37-connectors-declare-what-they-use-and-a-capability-name-is-its-contract.md) | Connectors declare the capabilities they use; a capability's name is its contract (a breaking change is a new name, the old one deprecated); Clew classifies every manifest change against its users, audits it, and checks B's output on cross-connector calls; no version per connector | 2026-11-05 | integrations | proposed |
| [D38](D38-views-are-declared-by-connectors-and-drawn-by-clew.md) | A view is declared by the connector as data (table, list, detail, text; fields with a Swedish label and a format; a search field and a choice bound to the capability's input; a row opens a read of the same connector) and drawn by Clew with Astryx, in the panel and under an answer, with or without a model; a view may keep its content from the model | 2026-11-05 | ui | accepted, built; figures, series and sections not built; a view in the menu is D40 and opens as a page (D42) |
| [D39](D39-the-landings-box-rests-on-the-columns-centre-line.md) | The landing's box rests on the column's centre line when what is above it fits in the upper half, and still never moves while the person types; the day line is the Layout's footer | 2026-11-05 | ui | accepted, built |
| [D40](D40-views-can-be-tools-in-the-menu-and-an-administrator-chooses-which.md) | A connector's views can be tools in the menu: any read with a declared view that opens without input; the menu has a section Verktyg with Kalender and the chosen views; an administrator chooses view by view on the connector's page, with an audit row per view; a capability may name its row (`menu: { label, icon }`, an icon from Clew's list); four show and the rest sit under Fler verktyg | 2026-11-05 | ui | accepted, built; where a row opens replaced by D42; a row pinned by a person or a manager is not built |
| [D41](D41-the-landing-is-the-ai-chat-landing-template-with-the-persons-areas-under-the-box.md) | The landing is Astryx's `ai-chat-landing` template: "Hej, <first name>" and the question over a taller box, the person's areas as a row of toggles under it and the chosen area's standing actions as cards; an area may name an icon from Clew's list; the brief stays above and the box stays still (D34, D36, D39) | 2026-11-05 | ui | accepted, built |

## Adding a decision

1. Copy `TEMPLATE.md` to `D<nn>-<short-slug>.md` with the next free number, two digits, zero-padded. Numbers
   are never reused.
2. Fill in the status line and the three sections. Keep "Decision" to what a reader needs to act on it; put the
   reasoning under "Why". If it replaces or narrows an earlier decision, say which one under "Replaces" and
   change that decision's status to `superseded by D<nn>`. Never edit the old decision's text; history is
   the point of the log.
3. Add the row to the table above, add or update the row in `HANDOVER.md` section 2, and mention the
   decision in the session log.
4. Refer to a decision by its number everywhere (`D7`), in docs, commit messages and code comments. Link to
   the file where a link is useful.

Areas in use: `integrations`, `identity`, `platform`, `product`, `ui`. Add a new one only when none fits.

Statuses: `proposed` (written down, not yet agreed), `accepted`, `accepted, <qualifier>` for an accepted
decision whose implementation is pending, `superseded by D<nn>`, `withdrawn`.
| [D42](D42-a-tool-opens-as-a-page.md) | Everything under Verktyg opens as a page of its own: a view chosen as a tool is drawn at `/tools/:capability` after Astryx's `table-page` template, as Kalender is a page; a row's own view opens in the side panel over the page, and the address names both; a view opened from a chip, an answer or a card stays in the panel | 2026-11-05 | ui | accepted, built; a link from the panel to the tool's page, sorting and a canvas artboard are not built |
| [D43](D43-addresses-are-english.md) | Addresses are English: every path, query parameter, parameter value and anchor in the browser (`/overview`, `/conversations/:id`, `/areas/:area`, `/waiting`, `/snoozed`, `/handled`, `/views/…`, `/calendar?date=&view=`, `/tools/…`, `/admin/connectors`, `/admin/models`); Swedish stays in what a person reads; no redirects from the old ones | 2026-11-05 | ui | accepted, built; an area's id in `/areas/:area` is data and still Swedish |
