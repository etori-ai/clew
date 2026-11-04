# Decision log

One file per decision, numbered in the order they were taken. A decision says what was decided, why, and
what it replaces. `HANDOVER.md` section 2 carries the short table of what is in force; the files here carry
the reasoning. Longer designs live in `docs/architecture/`, and the reviews that led to decisions live in
`docs/reviews/`.

| # | Decision | Date | Area | Status |
|---|---|---|---|---|
| [D1](D01-clew-owns-every-integration-contract.md) | Clew owns every integration contract | 2026-11-03 | integrations | accepted |
| [D2](D02-no-openapi-to-mcp-conversion.md) | No OpenAPI-to-MCP conversion in the running system | 2026-11-03 | integrations | accepted |
| [D3](D03-three-module-kinds.md) | Three module kinds: core, pass-through, derived | 2026-11-03 | integrations | accepted |
| [D4](D04-foreign-mcp-servers-are-wrapped.md) | Foreign MCP servers are wrapped, not passed through | 2026-11-03 | integrations | accepted |
| [D5](D05-oidc-and-oauth-only-identification-path.md) | OIDC and OAuth 2.1 with JWT access tokens are the only identification path | 2026-11-03 | identity | accepted |
| [D6](D06-dev-login-local-only.md) | Dev login with username and password, local only | 2026-11-03 | identity | accepted, not built yet |
| [D7](D07-bun-is-the-server-runtime.md) | Bun is the server runtime | 2026-11-03 | platform | accepted, switch from Node pending |
| [D8](D08-every-action-works-without-the-model.md) | Every action works without the model | 2026-11-03 | product | accepted |
| [D9](D09-side-panel-holds-views-and-apps.md) | The side panel holds conversation, Clew views and MCP App views | 2026-11-03 | ui | accepted |
| [D10](D10-integrations-fulfil-clews-api-first.md) | Integrations fulfil Clew's API; adapters are the fallback | 2026-11-03 | integrations | accepted |
| [D11](D11-one-calendar-contract-two-adapters.md) | One calendar contract, CalDAV and Microsoft 365 as adapters | 2026-11-03 | integrations | accepted, `microsoft365` adapter not built yet |
| [D12](D12-objects-chips-proposals.md) | Objects, chips, proposals: the general interaction pattern | 2026-11-03 | ui | accepted |
| [D13](D13-conversation-in-the-composer-drawer.md) | The conversation lives in the composer's drawer; the dim is an Astryx Overlay | 2026-11-03 | ui | accepted |
| [D14](D14-clew-stands-alone-eneo-enhances.md) | Clew stands alone; Eneo enhances it through an optional module | 2026-11-04 | product | accepted |

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
