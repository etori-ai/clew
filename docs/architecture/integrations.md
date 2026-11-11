# Integration architecture

Clew owns the contract between an integration and the employee experience. A source can expose that contract directly, or a connector can translate its REST, SOAP, native or vendor MCP interface. In either case, Clew sees the same JSON/HTTP protocol.

Read the [architecture overview](overview.md) for the whole system, [integration paths](integration-paths.md) to choose a mechanism, and [Create a connector](../guides/creating-a-connector.md) to implement one.

## Why independent connectors

Each source has its own owner, access rules, network and deployment cycle. An independently deployed service keeps those differences at the integration boundary. A vendor can implement the contract in its own language; an administrator can register it without rebuilding Clew.

The connector owns source-specific translation and access enforcement. Clew owns invocation, presentation, approval and follow-up. A source outage should affect that source's freshness and actions, not make all known work unavailable.

Clew's core remains a modular application. Its calendar and composite search use in-process capabilities; local users are core entities. New external integrations do not become server modules or frontend plugins.

## Capabilities describe useful work

A capability is a useful operation such as `phonebook.directory`, with a precise input/output schema and one of three kinds:

- `read` retrieves information without changing the source.
- `propose` prepares work for review without performing the proposed write.
- `execute` performs an approved source action and is never a model tool.

Choose operations in the employee's vocabulary, not a mechanical copy of every vendor API endpoint. The registry uses the same capability contract for deterministic calls and permitted model tools. This keeps validation and scope at a shared boundary.

Clew does not turn an external OpenAPI document into unrestricted model tools. Its own generated OpenAPI describes the **connector protocol**, including the routes the connector serves and the Clew routes it calls. It is not a generated specification of every browser/business API. See [protocol reference](../reference/connector-protocol.md).

## Ownership is distinct from transport

| Kind | Meaning | Deployment |
|---|---|---|
| `passthrough` | The source is the system of record; the connector translates its reads and approved actions. | Independent connector service. |
| `derived` | The connector supplies computed results or snapshots with an explicit purpose and provenance. | Independent connector service. |
| `core` | Clew owns the domain and its persistence, retention and evidence. | Internal to Clew; not accepted in a remote manifest. |

Whether a domain is built as `core` or reached through a connector is decided with the [core-or-connector checklist](../maintainers/core-or-connector.md) ([D95](../decisions/D95-clew-may-own-a-domain-by-choice-decided-with-the-core-or-connector-checklist.md)). No domain that holds business records is built as `core` yet.

A pass-through integration can still produce persisted card summaries, answers and execution evidence in Clew. It does not copy ownership of the source record, and it does not promise zero storage. Use [the persistence map](overview.md#data-ownership-and-persistence) when deciding what data to return.

## Presentation belongs to Clew

Connectors declare semantic views: `table`, `list`, `detail` and `text`, with fields, labels and supported controls. Clew renders them consistently on tool pages, in the panel and alongside answers. Menu placement is an administrator choice.

Connectors do not deliver HTML apps, component trees, CSS or iframes. When the supported catalogue cannot express a source interaction, link to the source. The model is optional for these views and for human approval.

## Keep the trust boundaries explicit

A Clew assertion establishes the acting person to the connector. It does not automatically authorize a source read or become a source credential. The connector verifies Clew's signature and transport key, maps the actor to source identity and enforces record-level access.

A service credential must be narrowed for that person. Delegated source tokens are available only on supported session-backed paths; they do not establish a durable background credential. [Authorization](../guides/authorization.md) covers the distinction.

Approved writes cross two independently failing systems. Clew commits the decision first; the connector supplies source evidence and any replay/lookup guarantees. The contract cannot invent exactly-once behavior for a source that lacks those semantics.

## Relationship to MCP and Eneo

Consuming a vendor's standard MCP service and provider-owned App directly in AI chat (D81, 2026-11-08) was prototyped and withdrawn on 2026-11-11; the [closing note](../reviews/2026-11-11-external-mcp-chat-services-exploration.md) records what it showed. The native connector path is the integration path.

A connector may speak MCP behind its source adapter, but the boundary with Clew is the Clew connector protocol. A public Clew MCP server for external agents is designed, not implemented. No `apps/mcp-*` host or generic MCP passthrough is part of the current authoring path.

Eneo is optional: its [connector](../../connectors/eneo/README.md) supplies delegated document retrieval. The [vision](../vision.md) separates Clew's coordination from Eneo's AI products. Neither Eneo nor a hosted model is required to run Clew.

The rationale originates in [contract ownership](../decisions/D01-clew-owns-every-integration-contract.md), [independent services](../decisions/D21-integrations-are-module-services.md), [connector terminology](../decisions/D22-connectors-not-modules.md) and [declared views](../decisions/D38-views-are-declared-by-connectors-and-drawn-by-clew.md). Earlier hosting designs remain in those historical records.
