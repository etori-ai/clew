# Choose an integration path

Start with the employee's task and the source's access policy. For native, model-independent work, use an independent HTTP connector, whether the source owner implements Clew's contract directly or you write an adapter beside it. [Integration architecture](integrations.md) explains that boundary. Existing MCP services have a separate AI-enabled chat path, currently a development prototype.

## Consume a standard MCP service

Choose this lane when a vendor already supplies tools or an MCP App and Clew should host that interaction. The vendor keeps its existing MCP endpoint, tool schemas and optional App resources; no Clew manifest, callback or view type is required. Clew owns registration, access, discovery, confirmation and the surrounding cards. Provider OAuth remains necessary and is not implemented by the synthetic demo.

An administrator can configure a Clew-owned read watch over an existing tool. A durable workflow checks the source; a stable identity and eligibility/change rule determine whether to create a delivery card. The interval controls when Clew checks, not when it sends repeat reminders. The source needs no Clew-specific push support. Analytics-only tools do not imply that respondent invitations or submission are available.

See [MCP chat services](mcp-chat-services.md) for the end-to-end path and remaining production work, [the independent demo](../../fixtures/mcp-pulse/README.md) to run it, and [provider evidence](../reviews/2026-11-08-mcp-services-and-provider-compatibility.md) for actual vendor capabilities. MCP services do not automatically acquire native scan, job, undo or reconciliation semantics. The following table describes the native connector lane.

## Use MCP behind a native connector

An independent connector can call an MCP server as its source API and expose selected results through the existing Clew protocol. This supports native, model-independent work without requiring the MCP vendor to adopt Clew's contract. The adapter supplies the actor mapping, views, occurrence semantics and write guarantees that tool discovery alone cannot establish.

The [MCP-backed connector exploration](../reviews/2026-11-09-mcp-backed-native-connectors.md) maps the poll fixture to native capabilities, compares a wrapper with direct MCP and a proposed App handoff, and identifies the missing form, source-history and recovery support. The wrapper and handoff are proposals, not delivered poll features.

## Add only what the task needs

| Need | Implement | Clew supplies | Guide |
|---|---|---|---|
| Read a list or record | A `read` capability, schemas and source authorization; optionally a view and area | Scoped invocation and declared-view rendering | [Create a connector](../guides/creating-a-connector.md) |
| Find records through the shared search | `<id>.search` and `<id>.fetch` | Eligible-source fan-out, result validation and source failure reporting | [Search and views](../guides/example-custom-directory.md) |
| Bring outstanding work to the person | `scan: true`, deterministic drafts, stable occurrences and honest observation completeness | Persisted cards, refresh, dismissal and attention | [Actions and receipts](../guides/actions-and-receipts.md) |
| Show an area's current figure | An area with `figure: true` and `/clew/figure` | Bounded figure reads and supported figure rendering | [Protocol](../reference/connector-protocol.md) |
| Prepare a change | A `propose` capability with an explicit result contract | Scoped invocation; review through the appropriate decision flow | [Capabilities](capability-surfaces.md) |
| Perform an approved change | `execute`, source preconditions, receipts, lookup/replay policy and optional compensation | Approval ledger, stable operation identity, dispatch and reconciliation | [Actions and receipts](../guides/actions-and-receipts.md) |
| Use another connector's read/proposal | Exact `uses` targets and signed callbacks | Current access checks and bounded call chains | [Authorization](../guides/authorization.md) |
| Coordinate independent steps across systems | Fact kinds, `creates`/`follows` and administrator bindings | Job proposal assembly, approval ledger and bounded watches; UI is incomplete | [Working across connectors](working-across-connectors.md) |

These are combinations of existing protocol fields, not separate protocol versions or a required progression. A useful read-only connector never needs to implement scans, writes or jobs.

## Choose source authentication separately

| Source accepts | Adapter responsibility |
|---|---|
| A service credential | Hold it in the connector and narrow every operation to records the verified actor may access. |
| A bound personal account | Resolve a trusted person-to-source mapping and use that person's credential. |
| A delegated token from the IdP | Declare the source audience and require the token on supported session-backed calls. |

The assertion from Clew and the source credential are different credentials. Background scans, figures and callbacks have no delegated session token. Generic durable remote actions declaring delegation stop with `needs-session`; a working delegated read does not establish action support. Read [authorization](../guides/authorization.md) before choosing a source.

## Examples and their evidence

| Source/example | Available here | Limit |
|---|---|---|
| [Phone book](../../connectors/phonebook/README.md) | Fixture, assumed HTTP adapter, search and declared views | The real directory/Metakatalogen API and access mapping are unverified. |
| [Hello](../../connectors/hello/README.md) | Routes, callbacks, scan, figure and toy writes | In-memory demonstration, not a durability reference. |
| [Reference source](../../connectors/reference/README.md) | SQLite-backed deduplication, lookup and fault scenarios | Synthetic source, not a real-system pilot. |
| [Development sources](../maintainers/local-development.md) | Independent HR, finance, incidents, communication, timesheet and payroll services | Synthetic records and mappings; no vendor integration. |
| [Calendar](../../packages/calendar/src/adapters.ts) | Core calendar with CalDAV and Microsoft 365 provider adapters | Graph is tested against a local fake; live tenant/delegation and new-path CalDAV acceptance remain open. |
| [Eneo](../../connectors/eneo/README.md) | Delegated retrieval over document collections | Requires compatible deployed Eneo and IdP configuration; recorded fixtures are not live acceptance. |

## Designed paths that are not available

- SCIM user/group provisioning: [D68](../decisions/D68-people-are-pushed-into-clew-through-standard-scim.md). Local users/grants and OIDC login already exist.
- Source change notifications through CloudEvents: [D19](../decisions/D19-change-notification-is-a-clew-owned-contract.md). There is no supported `POST /api/events/<source>` route.
- A Clew MCP server for external agents: [capability surfaces](capability-surfaces.md). A connector is not registered as an MCP server.
- Errand cards on demand, errand search, errand writes and a CaseData connector: [D35](../decisions/D35-errands-are-a-connector-profile-and-a-card-is-one-systems.md). The list profile and the combined list `clew.errands` exist, and the SupportManagement connector reads a person's errands on a fixture with the person's own token ([D89](../decisions/D89-an-errand-connector-acts-as-the-person-and-the-case-system-decides-access.md)); SupportManagement itself cannot answer that way yet.
- General conditional watches outside a job, push/email delivery, a workflow/page designer and classification-gated model release.

The original municipal source landscape and candidate integrations remain in [dated reviews](../reviews/README.md). Use the [support matrix](../reference/status.md) for current availability rather than treating an early integration plan as a supported endpoint.
