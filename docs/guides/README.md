# Connector guides

First read [What Clew is](../overview.md) and the [architecture overview](../architecture/overview.md). A connector extends that system through an independently deployed HTTP service.

## Your first integration

1. [Create a custom connector](creating-a-connector.md): run a fixture, define one read and view, implement the verified request boundary and register it.
2. [How authentication works end to end](authentication-overview.md): sign-in, Clew's signed assertion, the connector's own source credential and the human decision that releases a write.
3. [Authorize every request](authorization.md): transport secret, signed actor, source permissions and credential choices.
4. [Test and deploy](testing-and-deployment.md): handler tests, conformance, draft registration, audience and operations.

The first useful result is one authorized read shown in Clew. No scan, write, model, callback or cross-system job is required.

## Extend it when needed

| Need | Guide |
|---|---|
| Map a directory API, add a searchable table and contact details | [Search and views](example-custom-directory.md) |
| Know where Clew shows what your manifest declares, and what opens a new tab | [Where things open](where-things-open.md) |
| Discover outstanding work and perform approved changes | [Actions and receipts](actions-and-receipts.md) |
| Call another connector or participate in a cross-system job | [Working across connectors](../architecture/working-across-connectors.md) |
| Show what your system knows about a person or a unit, or offer an action on one | [Say what your rows are about](creating-a-connector.md#8-say-what-your-rows-are-about) |
| Look up exact fields, routes or compatibility rules | [Protocol reference](../reference/connector-protocol.md), [manifest reference](../generated/manifest-reference.md) |
| Push the organisation's people, units and groups into Clew (not a connector) | [Writing a provisioner](writing-a-provisioner.md) |
| Tell the teams that run the directory, the identity provider and the hosting what Clew expects of them | [Provisioning: what operations deliver](provisioning-for-operations.md) |

Use the [support matrix](../reference/status.md) to distinguish available behavior from designs. Full application setup is in [local development](../maintainers/local-development.md).
