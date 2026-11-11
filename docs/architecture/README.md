# Architecture

Start with [How Clew works](overview.md): the components, ownership boundaries and end-to-end read, discovery and approval flows. It builds on the [product overview](../overview.md) and describes the current implementation.

The [vocabulary and entity map](../reference/vocabulary.md) separates work items, proposals and conversations from the cards, views and panels that present them, and maps the terms to code.

## Explore the system

| Page | Question it answers |
|---|---|
| [Architecture overview](overview.md) | What runs where, who owns the data, and how does work move through Clew? |
| [Interface spaces](../reference/interface-spaces.md) | Where should a page, detail, catalogue, App or confirmation open, and where does close return? |
| [Backend structure](backend-structure.md) | Where is the code, and which dependencies are allowed? |
| [Integration architecture](integrations.md) | Why does Clew use independent connectors and its own contract? |
| [Integration paths](integration-paths.md) | Which integration mechanism fits this source and which paths are available? |
| [Capability surfaces](capability-surfaces.md) | How do buttons, the model, callbacks and approved executions reach operations? |
| [Identity](identity.md) | How are login, local grants, connector authority and source credentials separated? |
| [Working across connectors](working-across-connectors.md) | How does Clew coordinate changes and follow-up across several systems? |
| [Entities](entities.md) | How do sources attach what they know to a person or a unit, who may be asked about, and where does it show? |
| [Connector administration](connector-administration.md) | How are registration, governance, model providers and changes managed? |
| [Scheduled work](scheduled-work.md) | What belongs in PostgreSQL and what does the durable engine execute? |
| [Observability](observability.md) | What does Clew log, trace and export, what does a model turn leave behind, and how does that relate to the audit trail? |
| [Testing](testing.md) | Which tests establish behavior at each boundary? |

## Implement an integration

Use the [connector guides](../guides/README.md) and the [current protocol reference](../reference/connector-protocol.md). The [protocol page at the old path](connector-protocol.md) remains a navigation alias, not a second contract.

## Plans, evidence and history

The [reliability and authorization plan](reliability-and-authorization-plan.md) retains phased acceptance criteria; its implementation checkpoint does not close unrun release gates. Use [implementation status](../reference/status.md) and [reliability acceptance](../reference/reliability-acceptance.md) to distinguish current mechanisms from real-source evidence.

[Decision records](../decisions/README.md) and [dated reviews](../reviews/README.md) preserve the earlier designs and their rationale. Historical references to in-process vendor integrations, MCP hosts or connector-rendered apps are not instructions for a new connector.
