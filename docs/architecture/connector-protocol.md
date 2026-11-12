# Connector protocol: current reference

The integration contract now lives in the [connector protocol reference](../reference/connector-protocol.md), with [generated schemas and complete example manifests](../generated/README.md).

Start with [Create a connector](../guides/creating-a-connector.md). Protocol 2 authorization, callbacks and delegated tokens are documented in [Authorization](../guides/authorization.md); scans, writes and recovery are in [Actions and receipts](../guides/actions-and-receipts.md). Who a capability may be asked about (`person.admits`) and the `about` in the bound request body that tells a connector each key's relation ([D117](../decisions/D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md)) are in the reference under [Reads and actions about an entity](../reference/connector-protocol.md#reads-and-actions-about-an-entity).

This path remains as a navigation entry for existing decision and code links. It does not contain a second copy of the protocol.
