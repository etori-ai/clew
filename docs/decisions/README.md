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
| [D9](D09-side-panel-holds-views-and-apps.md) | The side panel holds conversation, Clew views and MCP App views | 2026-11-03 | ui | accepted |
| [D10](D10-integrations-fulfil-clews-api-first.md) | Integrations fulfil Clew's API; adapters are the fallback | 2026-11-03 | integrations | accepted |
| [D11](D11-one-calendar-contract-two-adapters.md) | One calendar contract, CalDAV and Microsoft 365 as adapters | 2026-11-03 | integrations | accepted, `microsoft365` adapter not built yet |
| [D12](D12-objects-chips-proposals.md) | Objects, chips, proposals: the general interaction pattern | 2026-11-03 | ui | accepted |
| [D13](D13-conversation-in-the-composer-drawer.md) | The conversation lives in the composer's drawer; the dim is an Astryx Overlay | 2026-11-03 | ui | superseded by D31 |
| [D14](D14-clew-stands-alone-eneo-enhances.md) | Clew stands alone; Eneo enhances it through an optional module | 2026-11-04 | product | accepted |
| [D15](D15-postgres-scheduler-now-temporal-later.md) | Postgres-backed scheduler in v1, Temporal later | 2026-11-03 | platform | accepted, narrowed by D17 |
| [D16](D16-node-is-the-server-runtime.md) | Node is the server runtime; Bun stays the toolchain | 2026-11-04 | platform | accepted |
| [D17](D17-temporal-runs-the-durable-timers.md) | Temporal runs the durable timers, starting with a person's own reminders | 2026-11-04 | platform | accepted |
| [D18](D18-errands-are-a-clew-owned-passthrough-domain.md) | Errands are a Clew-owned pass-through domain; SupportManagement is the first adapter | 2026-11-04 | integrations | proposed |
| [D19](D19-change-notification-is-a-clew-owned-contract.md) | Change notification is a Clew-owned contract: payload-free CloudEvents over HTTP | 2026-11-04 | integrations | proposed |
| [D20](D20-modular-monolith-ports-and-adapters.md) | Backend structure: a modular monolith with ports and adapters, not tactical DDD | 2026-11-04 | platform | accepted |
| [D21](D21-integrations-are-module-services.md) | Every integration is a module service behind the Clew module protocol | 2026-11-04 | integrations | accepted, vocabulary replaced by D22 (connector) |
| [D22](D22-connectors-not-modules.md) | Connectors, not modules: the word for an integration that a person, an operator or a vendor meets | 2026-11-04 | integrations | accepted |
| [D23](D23-connectors-are-managed-in-the-database.md) | Connectors are registered and governed in the database by an administrator, not by environment variables | 2026-11-04 | integrations | accepted, admin API and screens not built yet |
| [D24](D24-model-endpoints-are-administered-in-the-product.md) | Model providers and models are administered in the product, and the chat can choose between them | 2026-11-04 | product | proposed |
| [D25](D25-use-cases-over-ports-fast-tests.md) | Use cases take their ports from a composition root; the unit suite runs on memory adapters held to a store contract | 2026-11-04 | platform | accepted |
| [D26](D26-questions-over-documents-are-search-not-knowledge.md) | Questions answered from documents are a search fan-out with citations, not a knowledge module | 2026-11-04 | product | proposed |
| [D27](D27-event-calendar-is-fullcalendar-themed-with-astryx-tokens.md) | The event calendar is FullCalendar 7 Standard, themed with Astryx tokens, behind Astryx components | 2026-11-04 | ui | accepted, theme in progress |
| [D28](D28-the-stream-has-two-groups-and-three-piles.md) | The stream has two groups (Nu, Senare) and three piles above the composer; snooze is its own column; the day is drawn as one track | 2026-11-04 | ui | accepted |
| [D29](D29-inte-nu-is-a-timed-snooze-that-breaks-on-activity.md) | "Inte nu" is a timed snooze with a visible landing time that breaks on activity; conditions wait | 2026-11-04 | product | accepted |
| [D30](D30-a-proposal-thread-is-an-obligation-with-four-steps.md) | A proposal thread is an obligation with four steps, replies read back, follow-ups as cards under a fixed policy | 2026-11-04 | product | accepted, live run unverified |
| [D31](D31-the-conversation-swaps-the-stream-inside-one-chatlayout.md) | The conversation swaps the stream inside one ChatLayout; chips live in the composer drawer; the shell is AppShell | 2026-11-04 | ui | proposed |

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
