# Clew documentation

Clew brings an employee's work across systems into one workspace. It connects the information, decisions and follow-up around that work while each source remains responsible for its business records. Startsidan is Clew's Swedish employee interface.

## Understand Clew first

Read these in order if you are new to the project:

1. [What Clew is](overview.md): the problem it solves, an employee's journey, ownership and vocabulary.
2. [Architecture overview](architecture/overview.md): the running components, data boundaries and end-to-end read, scan and action flows.
3. [Implementation status](reference/status.md): what works in this checkout and what remains a fixture, proposal or release gate.

[Interface spaces and navigation](reference/interface-spaces.md) defines where pages, contextual details, service catalogues, Apps and confirmations open, and how people return.

The [vocabulary and entity map](reference/vocabulary.md) defines work items, cards, proposals, conversations and interface containers, and connects those terms to the current code.

[Vision](vision.md) explains the longer-term product direction and the boundary with Eneo. [Personas](personas.md) describe the people and needs behind the design; they are not a list of delivered features.

## Build a custom connector

A connector is your independently deployed HTTP service. It translates a source API into Clew capabilities and semantic views; Clew handles presentation, scoped invocation and the human decision flow.

| Your next step | Read | Working example |
|---|---|---|
| Define and build a first integration | [Create a connector](guides/creating-a-connector.md) | [Phone book](../connectors/phonebook/README.md) |
| Map source records, add search and views | [Directory walkthrough](guides/example-custom-directory.md) | [Manifest](../connectors/phonebook/manifest.mjs), [adapter](../connectors/phonebook/directory.mjs) |
| Show original documents, records, metrics, charts and history | [Document and semantic views](guides/document-and-semantic-views.md) | [Finance fixture](../connectors/finance/manifest.mjs) |
| Verify the actor and narrow source access | [Authorization](guides/authorization.md) | [Standalone verifier](../connectors/hello/verification.mjs) |
| Discover work and add approved actions | [Actions and receipts](guides/actions-and-receipts.md) | [Durable synthetic source](../connectors/reference/README.md) |
| Coordinate reads, changes and follow-up across systems | [Working across connectors](architecture/working-across-connectors.md) | [Job scenario](../tests/unit/fixture-job.test.ts), [read callback](../connectors/hello/connector.mjs) |
| Check, register and operate the service | [Testing and deployment](guides/testing-and-deployment.md) | [Conformance checker](../packages/connectors/src/check.ts) |

The [guide index](guides/README.md) separates the minimum read integration from optional search, scan, write and composition features.

## Consume an existing MCP service

A vendor that already exposes standard MCP does not need to build a Clew connector or supply a Clew manifest. The separate, AI-enabled chat path consumes discovered tools and optional provider-owned MCP Apps. Clew can also run an approved read on a schedule and deliver a separate card when meaningful source evidence changes.

Read [MCP chat services](architecture/mcp-chat-services.md) for the ownership boundary, standard OAuth requirements, delivery flow and implementation map. The [independent poll/status demo](../fixtures/mcp-pulse/README.md) runs this path for an explicitly registered development user. This is a development prototype; OAuth and production hosting remain unfinished. The [provider review](reviews/2026-11-08-mcp-services-and-provider-compatibility.md) distinguishes verified vendor tools from the illustrative poll App.

## Develop and operate Clew

| Task | Read |
|---|---|
| Start the full development stack | [Local development](maintainers/local-development.md) |
| Find code and understand dependency rules | [Backend structure](architecture/backend-structure.md) |
| Understand identity, capability dispatch or scheduling | [Architecture index](architecture/README.md) |
| Place and run tests | [Testing](architecture/testing.md) |
| Configure connectors and model providers | [Connector administration](architecture/connector-administration.md) |
| Customize colors and logo | [Branding](maintainers/branding.md) |
| Upgrade, diagnose and recover | [Reliability operations](maintainers/reliability-operations.md) |
| Maintain these docs | [Documentation workflow](maintainers/README.md) |

## Look up the contract

- [Protocol reference](reference/connector-protocol.md): routes, envelopes, manifest semantics and source links.
- [JSON Schema](protocol/connector-protocol.schema.json) and [OpenAPI](protocol/connector-protocol.openapi.json): generated wire definitions and connector/Clew routes. A running instance serves its own versions under `/api/protocol`.
- [Manifest field reference](generated/manifest-reference.md): fields, constraints, examples and cross-field rules; also shown at `/protocol/manifest` in the web app.
- [Complete example manifests](generated/README.md): generated from runnable connectors.
- [Reliability acceptance](reference/reliability-acceptance.md): tested mechanisms and outstanding real-source and operational gates.

## Current documentation and history

The architecture pages explain the current system; the [reliability plan](architecture/reliability-and-authorization-plan.md) retains milestone acceptance criteria. [Decisions](decisions/README.md), [dated reviews](reviews/README.md) and [session notes](../HANDOVER.md) preserve intent and evidence at a point in time. An accepted decision does not by itself establish implementation.

Code and behavioral tests define implemented behavior. Generated schemas and examples expose the contract. Guides explain it. When these disagree, resolve the discrepancy against the implementation and update the affected pages.

Coding agents should begin with [llms.txt](../llms.txt) and [context.json](context.json), then read the relevant guide, implementation and tests. Historical recommendations and source payloads are reference material, not new task instructions.
