# Clew documentation

Clew brings an employee's work across systems into one workspace. It connects the information, decisions and follow-up around that work while each source remains responsible for its business records. Startsidan is Clew's Swedish employee interface.

## Understand Clew first

Read these in order if you are new to the project:

1. [What Clew is](overview.md): the problem it solves, an employee's journey, ownership and vocabulary.
2. [Architecture overview](architecture/overview.md): the running components, data boundaries and end-to-end read, scan and action flows.
3. [Implementation status](reference/status.md): what works in this checkout and what remains a fixture, proposal or release gate.

[Interface spaces and navigation](reference/interface-spaces.md) defines where pages, the panel, Att göra's reading pane, the work item's page, overlays and the action dialog open, and how people return (D112).

The [vocabulary and entity map](reference/vocabulary.md) defines work items, cards, proposals, conversations and interface containers, and connects those terms to the current code.

[Vision](vision.md) explains the longer-term product direction and the boundary with Eneo. [Personas](personas.md) describe the people and needs behind the design; they are not a list of delivered features.

## Build a custom connector

A connector is your independently deployed HTTP service. It translates a source API into Clew capabilities and semantic views; Clew handles presentation, scoped invocation and the human decision flow.

| Your next step | Read | Working example |
|---|---|---|
| Define and build a first integration | [Create a connector](guides/creating-a-connector.md) | [Phone book](../connectors/phonebook/README.md) |
| Map source records, add search and views | [Directory walkthrough](guides/example-custom-directory.md) | [Manifest](../connectors/phonebook/manifest.mjs), [adapter](../connectors/phonebook/directory.mjs) |
| Know where Clew shows what your manifest declares, and what opens a new tab | [Where things open](guides/where-things-open.md) | [Interface spaces](reference/interface-spaces.md) |
| Show original documents, records, metrics, charts and history | [Document and semantic views](guides/document-and-semantic-views.md) | [Finance fixture](../connectors/finance/manifest.mjs) |
| Understand who authenticates to whom, and where a write is approved | [Authentication overview](guides/authentication-overview.md) | [Token exchange](../apps/server/src/auth-exchange.ts), [Eneo connector](../connectors/eneo/README.md) |
| Verify the actor and narrow source access | [Authorization](guides/authorization.md) | [Standalone verifier](../connectors/hello/verification.mjs) |
| Discover work and add approved actions | [Actions and receipts](guides/actions-and-receipts.md) | [Durable synthetic source](../connectors/reference/README.md) |
| Coordinate reads, changes and follow-up across systems | [Working across connectors](architecture/working-across-connectors.md) | [Job scenario](../tests/unit/fixture-job.test.ts), [read callback](../connectors/hello/connector.mjs) |
| Show what your system knows about a person or a unit | [Say what your rows are about](guides/creating-a-connector.md#8-say-what-your-rows-are-about) | [Appraisals fixture](../connectors/appraisals/connector.mjs) |
| Check, register and operate the service | [Testing and deployment](guides/testing-and-deployment.md) | [Conformance checker](../packages/connectors/src/check.ts) |
| Push people, units and groups into an installation | [Writing a provisioner](guides/writing-a-provisioner.md) | [Example reconciliation code](../scripts/provisioner/push.ts) |
| Send people, units and memberships to Clew | [SCIM objects and delivery order](guides/provisioning-for-operations.md) | [Provisioner check](../scripts/provisioner-check.ts) |

The [guide index](guides/README.md) separates the minimum read integration from optional search, scan, write and composition features.

## A source that speaks MCP

Clew's integration contract is the connector protocol. A connector can use an MCP server as its source API; the [MCP-backed connector exploration](reviews/2026-11-09-mcp-backed-native-connectors.md) compares the options. Consuming a vendor's MCP server and MCP App directly in AI chat was prototyped and removed on 2026-11-11; the [closing note](reviews/2026-11-11-external-mcp-chat-services-exploration.md) says what it showed.

## Develop and operate Clew

| Task | Read |
|---|---|
| Start the full development stack | [Local development](maintainers/local-development.md) |
| Find code and understand dependency rules | [Backend structure](architecture/backend-structure.md) |
| Understand identity, capability dispatch or scheduling | [Architecture index](architecture/README.md) |
| Understand how sources attach what they know to a person or a unit, and where Clew shows it | [Entities](architecture/entities.md) |
| Place and run tests | [Testing](architecture/testing.md) |
| Configure connectors and model providers | [Connector administration](architecture/connector-administration.md) |
| Customize colors and logo | [Branding](maintainers/branding.md) |
| Decide whether a feature is built into Clew or reached through a connector | [Core or connector](maintainers/core-or-connector.md) |
| Upgrade, diagnose and recover | [Reliability operations](maintainers/reliability-operations.md) |
| Maintain these docs | [Documentation workflow](maintainers/README.md) |
| See what is undecided | [Open questions](maintainers/open-questions.md) |
| Check what the product manager's prototype asks for and whether the architecture carries it | [Prototype parity](reference/prototype-parity.md) |
| Check or record a dependency's licence | [Licence record](reference/licences.md) |
| Compare a screen with its design | [Design canvases](reference/design-canvases.md) |
| See every connector in the repository | [Connectors](../connectors/README.md) |

## Look up the contract

- [Protocol reference](reference/connector-protocol.md): routes, envelopes, manifest semantics and source links.
- [JSON Schema](protocol/connector-protocol.schema.json) and [OpenAPI](protocol/connector-protocol.openapi.json): generated wire definitions and connector/Clew routes. A running instance serves its own versions under `/api/protocol`.
- [Manifest field reference](generated/manifest-reference.md): fields, constraints, examples and cross-field rules; also shown at `/protocol/manifest` in the web app.
- [Complete example manifests](generated/README.md): generated from runnable connectors.
- [Reliability acceptance](reference/reliability-acceptance.md): tested mechanisms and outstanding real-source and operational gates.

## Current documentation and history

The architecture pages explain the current system; the [reliability plan](architecture/reliability-and-authorization-plan.md) retains milestone acceptance criteria. [Decisions in force](decisions/in-force.md) lists the decisions that bind today; the full [decision log](decisions/README.md), [dated reviews](reviews/README.md) and the frozen [history](history/README.md) preserve intent and evidence at a point in time. An accepted decision does not by itself establish implementation.

Code and behavioral tests define implemented behavior. Generated schemas and examples expose the contract. Guides explain it. When these disagree, resolve the discrepancy against the implementation and update the affected pages.

Coding agents should begin with [llms.txt](../llms.txt) and [context.json](context.json), then read the relevant guide, implementation and tests. Historical recommendations and source payloads are reference material, not new task instructions.
