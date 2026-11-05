# Clew

Clew brings an employee's work across systems into one place: find information, see what needs attention, review a proposal, and act with a receipt from the source. It is built for the public sector; the Swedish interface is called **Startsidan**.

Source systems keep their records. Clew coordinates the person's work, permissions, decisions and follow-up. A model can help find and explain things, but reads and actions also have deterministic paths. Source writes require a human decision.

## Build an integration

A **connector** is an independently deployed HTTP service, in any language, that implements Clew's JSON contract. Its manifest declares capabilities and views; Clew supplies the interface, scoped invocation and model tools. An administrator connects the service without rebuilding Clew.

1. [Understand the platform](docs/overview.md).
2. [Run and adapt a connector](docs/guides/creating-a-connector.md).
3. [Read the protocol](docs/reference/connector-protocol.md) and [authorization requirements](docs/guides/authorization.md).
4. [Add search and views](docs/guides/example-custom-directory.md), or [human-approved writes](docs/guides/actions-and-receipts.md).
5. [Validate and register it](docs/guides/testing-and-deployment.md).

The [documentation home](docs/README.md) includes the current support matrix and all references. Start a coding agent with [llms.txt](llms.txt); the [machine-readable context map](docs/context.json) links the contracts, examples and every decision record.

## Code is the reference

The [protocol source](packages/connectors/src/protocol.ts) generates the [JSON Schema](docs/protocol/connector-protocol.schema.json). Complete [example manifests](docs/generated/README.md) come from real connectors. Documentation checks reject stale generated content and broken local links, then run a signed fixture exchange:

```sh
docker exec -w /workspace clew-app-1 bun run docs:check
```

This check needs the devcontainer and installed dependencies, but no running database, identity provider, model or source system. [Local development](docs/maintainers/local-development.md) explains how to start the full stack. [Maintainer documentation](docs/maintainers/README.md) covers architecture, tests, installation branding and documentation upkeep.

This repository is a developing proof of concept. A working fixture does not establish readiness for a real-system pilot. Consult the [implementation status](docs/reference/status.md) before committing to an integration path. Design history is in the [decision log](docs/decisions/README.md); session notes remain in [HANDOVER.md](HANDOVER.md).
