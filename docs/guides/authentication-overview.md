# How authentication works end to end

This page is the orientation before the field-level rules in [Authorize every connector request](authorization.md). Read it when deciding how a new system, such as a case system, identifies the person and accepts a write.

| Question | Connector |
|---|---|
| Who tells the connector which person is acting? | Clew, with a short-lived RS256 assertion it signs |
| How does the connector reach the source? | A policy the connector chooses: service credential, bound account or a delegated IdP token |
| Where is a write approved? | The human decision endpoint, written to the execution ledger before dispatch |
| Status (see the [support matrix](../reference/status.md)) | Built: assertions, transport key, callbacks, token exchange, ledger |

A case system is a native connector ([D35](../decisions/D35-errands-are-a-connector-profile-and-a-card-is-one-systems.md)): one container per system, registered by an administrator, with reads as `read` capabilities and a note or a status change as an `execute` capability. It is not an MCP tool. The rest of this page follows a note written to a case through a connector.

## 1. The person signs in to Clew

People log in through OIDC with Authorization Code and PKCE against the municipality's identity provider, Keycloak in development ([D5](../decisions/D05-oidc-and-oauth-only-identification-path.md)). The browser holds an opaque session cookie. No access token, refresh token or connector secret reaches the browser bundle; the server resolves the person, unit and role for every request.

## 2. Clew identifies itself and the person to the connector

Every call from Clew to a connector carries two credentials, and the connector must check both ([Protocol 2](authorization.md#inbound-requests), [D44](../decisions/D44-authorized-reads-and-clew-signed-connector-authority.md)):

- **The transport key.** `X-Clew-Connector-Key` holds the shared secret from the connector's registration. It proves the request came from this Clew installation's transport. It cannot name a person.
- **The signed assertion.** `Authorization: Bearer` holds an RS256 JWT signed by Clew's installation key, with the connector id as `aud`, the person as `sub` and `actor` (id, name, unit, role), and a lifetime of at most two minutes. The connector verifies it against the public keys at `CLEW_URL/api/connectors/jwks`, pinned in its deployment configuration. [hello's verifier](../../connectors/hello/verification.mjs) is a complete reference.

The verified actor is the only identity the connector may use. A person named in the request body is ignored. The connector still enforces the source's own rules: unit boundaries, protected records and whether this role may see this case. Clew's role filter in the manifest is coarse.

Clew rotates the installation key with audit ([connector-key-rotate.ts](../../scripts/connector-key-rotate.ts)); old public keys overlap for three minutes. Clew also rechecks the connector's current registration, audience and the person's current grants on every invocation, so a connector removed from a person's audience disappears for them at once.

## 3. The connector authenticates to the case system

The Clew assertion identifies the person to the connector. It is not a credential the case system accepts. The connector chooses one of three policies ([Authenticate to the source](authorization.md#authenticate-to-the-source)):

| The case system accepts | The connector does |
|---|---|
| A service credential | Holds it itself and narrows every query and write to records the verified actor may reach. SupportManagement's pattern of a gateway credential plus a header naming the person belongs here ([D18](../decisions/D18-errands-are-a-clew-owned-passthrough-domain.md)). |
| A personal account per person | Resolves a trusted mapping from the verified actor to that account and uses only that account's credential. Never infers it from a display name. |
| A user token from the identity provider | Declares `delegation: { audience: "<source audience>" }` in its manifest. Clew exchanges the person's session for an IdP access token bound to that audience (RFC 8693 token exchange, [auth-exchange.ts](../../apps/server/src/auth-exchange.ts)) and sends it in `X-Clew-Delegated-Token` beside the assertion. The connector forwards it to the source as a bearer token and nothing more. The [Eneo connector](../../connectors/eneo/README.md) is the worked example, including the Keycloak client and scope that `bun scripts/auth-setup.ts` creates. |

This is where "OAuth" fits the native lane: standard OIDC and token exchange against the municipality's own identity provider, not a per-vendor authorization dance. Delegation has a cost to weigh before choosing it for a case system:

- A delegated token exists only while the person has a live session. Figures, connector callbacks and the nightly scan run without one.
- On a connector that declares delegation, an approved execute is dispatched with the token of the session that approved it, and a scan with the token of the session that asked for it, while that session is active. Without one the execute stops with `needs-session` before dispatch and the scan answers `authorization-required` ([executions composition](../../apps/server/src/composition/executions.ts), [refresh composition](../../apps/server/src/composition/refresh.ts)); there is no sign-in-and-resume flow for a write left pending.
- A service credential with actor-scoped queries keeps scans and background writes possible. Prove the case system's background authorization path before promising either.

## 4. A note on a case is a human decision, never a tool

The model can read and propose; it cannot execute. A note the assistant drafts becomes a proposal on a card. The person approves it, and the approval is a human decision that goes through `POST /api/threads/:id/act`, not through any tool the model can call:

1. Clew rechecks the person's current access to the connector and capability, including the connector's audience and the grant version the card was produced under ([D75](../decisions/D75-source-snapshots-retain-the-authority-that-produced-them.md)).
2. The approved intent, its audit row and the workflow start are written to the execution ledger in one transaction ([D45](../decisions/D45-approved-intent-precedes-source-dispatch.md), [D86](../decisions/D86-the-ledger-starts-its-workflow-inside-its-own-transaction.md)).
3. The durable workflow dispatches the connector's `execute` with the same two credentials as any call, plus `X-Clew-Operation-Id` so the connector can deduplicate, and the delegated token when the manifest declares it and a session exists.
4. The connector writes to the case system under its chosen source policy and returns a receipt. An ambiguous outcome stays unknown until the connector's lookup settles it; nothing is retried blindly. [Actions and receipts](actions-and-receipts.md) has the write and recovery contract.

A connector calling another connector during a request uses the separate `callback` grant from its assertion and may read or propose, never execute ([Call another connector](authorization.md#call-another-connector)).

## A source that only offers MCP

If a case system only offers an MCP server, a connector can use MCP as its source API behind the protocol above ([Use MCP behind a native connector](../architecture/integration-paths.md#use-mcp-behind-a-native-connector)). The connector then supplies the actor mapping and write guarantees that tool discovery alone cannot. Consuming a vendor's MCP server directly in chat, with the provider's own OAuth login per person, was prototyped without that OAuth and removed on 2026-11-11 ([closing note](../reviews/2026-11-11-external-mcp-chat-services-exploration.md)).

## Where to go next

- Build the connector: [Create a custom connector](creating-a-connector.md), then [Authorize every connector request](authorization.md) for the exact claims to verify.
- Add the write: [Actions and receipts](actions-and-receipts.md).
- Check and register it: [Testing and deployment](testing-and-deployment.md); `bun scripts/connector-check.ts` exercises the verified request boundary before an administrator registers the service.
