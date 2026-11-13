# Connector protocol: current reference

The integration contract now lives in the [connector protocol reference](../reference/connector-protocol.md), with [generated schemas and complete example manifests](../generated/README.md).

Start with [Create a connector](../guides/creating-a-connector.md). Protocol 2 authorization, callbacks and delegated tokens are documented in [Authorization](../guides/authorization.md); scans, writes and recovery are in [Actions and receipts](../guides/actions-and-receipts.md). Who a capability may be asked about (`person.admits`) and the `about` in the bound request body that tells a connector each key's relation ([D117](../decisions/D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md)) are in the reference under [Reads and actions about an entity](../reference/connector-protocol.md#reads-and-actions-about-an-entity).

How the server builds what it sends is in the architecture pages. Every body Clew posts to a connector carries the published actor and nothing more, while inside the process the actor keeps the person's provisioned groups for audiences ([Identity](identity.md#clew-to-a-connector), [How capabilities are called](capability-surfaces.md#what-the-registry-does)). A person's key on the wire is the user name, and Clew resolves it to the person's id for its own records ([Entities](entities.md#kinds-and-keys), [D122](../decisions/D122-clew-keys-its-own-records-about-a-person-by-the-persons-id.md)).

This path remains as a navigation entry for existing decision and code links. It does not contain a second copy of the protocol.
