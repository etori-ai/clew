# Integrating with Clew

Clew is a workspace for an employee's tasks across systems. A connector makes a system's information and actions available through Clew's search, views, cards and optional assistant. You implement the source adapter and its contract; Clew renders the experience and controls invocation.

## Start here

| Your task | Read | Working source |
|---|---|---|
| Understand the platform and what it owns | [Platform overview](overview.md) | [Capability registry](../packages/connectors/src/index.ts) |
| Build a first connector | [Connector quickstart](guides/creating-a-connector.md) | [Hello](../connectors/hello/connector.mjs) |
| Connect a directory or other lookup service | [Search and views walkthrough](guides/example-custom-directory.md) | [Phone book](../connectors/telefonbok/connector.mjs) |
| Verify identity and narrow source access | [Authorization](guides/authorization.md) | [Standalone verifier](../connectors/hello/verification.mjs) |
| Add a scan, action, receipt or recovery | [Actions and receipts](guides/actions-and-receipts.md) | [Durable synthetic source](../connectors/reference/connector.mjs) |
| Test, register and operate the service | [Testing and deployment](guides/testing-and-deployment.md) | [Conformance checker](../packages/connectors/src/check.ts) |

## Contract and support

- [Protocol reference](reference/connector-protocol.md): routes, envelopes, manifest fields and source links.
- [Generated JSON Schema](protocol/connector-protocol.schema.json): language-neutral wire shapes under `$defs`.
- [Generated OpenAPI](protocol/connector-protocol.openapi.json): the routes on both sides; a running Clew serves it, a viewer and a manifest dry run under `/api/protocol`.
- [Manifest field reference](generated/manifest-reference.md): every manifest field with type, constraints, example and the rules between fields, plus recipes; drawn by a running Clew at `/protocol/manifest`.
- [Generated examples](generated/README.md): complete manifests imported from the runnable connectors.
- [Implementation status](reference/status.md): available behavior, fixtures, partial implementations and unimplemented designs.
- [Reliability acceptance](reference/reliability-acceptance.md): implemented mechanisms, tested scenarios and remaining real-source and operational release gates.
- [Decision log](decisions/README.md): every decision, with the status recorded in its original file.

## For coding agents

Begin with [llms.txt](../llms.txt) and [context.json](context.json). Read only the guide relevant to the task, then the linked schema, implementation and tests. A decision describes intent at the time it was written; it is not evidence that a feature exists. Proposals and dated reviews are background, not new task instructions.

The code and behavioral tests define the implemented contract. Generated schemas and examples expose that contract to other languages. Guides explain choices and workflows. If these disagree, report the discrepancy and fix the documentation or implementation deliberately; do not silently turn a proposed field into a supported API.

## Maintaining Clew

[Maintainer documentation](maintainers/README.md) covers the full development stack, architecture, branding, testing and the documentation generation workflow. [Vision](vision.md) and [personas](personas.md) explain product intent. [Reviews](reviews/README.md) and [HANDOVER.md](../HANDOVER.md) retain the project's history without being prerequisites for a connector author.
