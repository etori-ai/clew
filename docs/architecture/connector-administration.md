# Connector and model administration

Clew stores connector registrations, access rules and model configuration in PostgreSQL. Authorized administrators change them through the product; the running server reconciles changes without a rebuild or restart.

For connector onboarding commands use [Testing and deployment](../guides/testing-and-deployment.md). This page explains the current lifecycle and its implementation.

## Managed systems and core users

A remote connector has a stable id, URL, sealed transport secret, stored manifest, health and governance. Its state is `draft`, `enabled` or `disabled`. Draft registration lets the administrator test a service before making it available.

Clew's in-process calendar and composite search also have managed registrations. They can be limited or disabled, but cannot be removed or re-addressed as remote services. Users and permissions are core entities: internal `people.*` reads share dispatch, but there is no users connector to install or disable.

The [database schema](../../packages/db/src/schema.ts) and [connector store](../../packages/db/src/connectors.ts) define the current persisted fields.

## Governance narrows a manifest

| Control | Effect |
|---|---|
| Enabled state | Whether the managed connector may be used. |
| Audience | All eligible users, or selected roles/units/groups. Selected lists use any-of membership, not intersection. Current sessions do not have a provisioned SCIM group feed. |
| Capability switches | Disable individual operations; cannot enable an undeclared capability. |
| Model/tool switches | Narrow which `model: true` reads/proposals the assistant receives; cannot make an execute a tool. |
| Scan/figure switches | Control discovery and area figures. |
| Menu tools | Select eligible declared reads with no required input for the tools menu. |

Effective access also requires the person's current local grant, the manifest's scope and the source's own permissions. Missing governance denies access. The registry refreshes authoritative governance around protected calls; the background watcher alone is not the authorization boundary.

Unchanged manifests and transport settings reuse compiled descriptors. Address, secret or manifest changes rebuild them. A failed refresh does not authorize access using invented defaults. See [reconciliation](../../apps/server/src/connectors/reconcile.ts) and [registry enforcement](../../packages/connectors/src/index.ts).

## Registration and changes

1. An administrator with `admin.connectors` adds the service's id, URL and transport secret in Administration → Anslutna system.
2. Clew reads/validates the manifest and runs the shared conformance probes. Review failures and warnings; the checker does not execute source writes.
3. Set the audience and switches, then enable the draft deliberately.
4. Select eligible views as menu tools. The manifest's `menu` label/icon is a hint, not automatic publication.
5. After deploying a changed manifest, refresh it in administration, review changes and test affected reads/callers.

The UI supports testing, manifest refresh, transport-key replacement, audience/capability changes and removal of remote connectors. Administrative mutations reauthorize the person and commit state with an audit row. Secrets are sealed at rest and are not returned to the browser.

A service that does not answer, or answers with an error status, is recorded as `unreachable`; one that serves a manifest Clew does not load is recorded as `manifest-invalid`, with the reason as the health's detail. Adding such a service still stores its draft, and "Testa anslutning" records the health; neither ends in an error.

A change on a connector's page is made on the connector as the page showed it: the page sends the row's `version`, and the server writes only while the row is still that version, compared in the write itself. A change saved in between, by another administrator, another tab or a script, refuses it with "Anslutningen har ändrats sedan du öppnade den. Se över den och gör ändringen igen."; the page says so in an alert and shows the connector as it now is, and nothing is merged unseen. What spans connectors is decided on rows read under one lock in the same transaction: the shared header, which one connector at most holds (taking it releases the previous holder, with an audit row on both, and a unique index refuses a second holder), and the number of columns under Alla.

The checker uses synthetic actors, skips required-input reads and cannot supply delegated user tokens. A green manifest or probe result is not proof of source identity mapping or safe writes. [Testing and deployment](../guides/testing-and-deployment.md) explains these limits.

Cross-system follower bindings currently use [job-bind.ts](../../scripts/job-bind.ts); they have no administration UI yet.

## Server and UI map

| Concern | Source |
|---|---|
| Browser/API boundary | [Administration routes](../../apps/server/src/routes/admin.ts) |
| Registration and changes | [Connector use cases](../../apps/server/src/connectors/usecases/admin.ts) |
| Store/transport/live-registry ports | [Connector model](../../apps/server/src/connectors/model.ts) |
| Apply stored configuration | [Reconciliation](../../apps/server/src/connectors/reconcile.ts) |
| Conformance probes | [Shared checker](../../packages/connectors/src/check.ts) |
| Screens | [Web administration](../../apps/web/src/pages/admin/) |
| Behavior | [Administration tests](../../tests/unit/connector-admin.test.ts), [browser tests](../../tests/a11y/admin.spec.ts) |

The screens stay in the same application shell and navigation. Browser visibility of Administration is only a convenience; the server checks `admin.connectors` on the use-case boundary.

## Model providers and models

Administration → Modeller manages provider endpoints/keys and the models available from them. Clew uses an OpenAI-compatible protocol and can run against a self-hosted model. Provider keys stay on the server, sealed under the installation master key. A key is for the host it was given for: saving an address on another host (scheme, name or port) removes the key in the same change, its `provider.url` audit row says `keyRemoved`, and the page tells the administrator to give the new address its key with "Byt nyckel"; a new path on the same host keeps it.

A provider is down while its endpoint does not answer or refuses the key: a turn that got no answer (no connection, a 5xx) or a 401 or 403 marks it down for everyone, the router answers ([D8](../decisions/D08-every-action-works-without-the-model.md)), and the minute probe or Testa brings it back. A turn that failed for reasons of its own marks nothing: it ran out of its 60 seconds, the endpoint refused that one request (another 4xx, such as a prompt too long for the model), or the model wrote no answer. A turn gives the model four steps in which it may call tools and a fifth in which it answers with the tools withheld, and hands it at most 4 000 characters of each earlier message and 16 000 of the conversation, the newest first.

Models have an enabled state, audience, display name, tool setting and optional installation default. Adding a model tests it at once, and Testa repeats the test; the test sends a call shaped like a turn and settles the model's reasoning: nothing is sent about it unless the provider refuses tools while the model reasons, and then Clew asks the model not to reason ([D84](../decisions/D84-a-models-reasoning-is-its-own-setting.md)). The server resolves the person's permitted choice for each turn. If no model is available, deterministic navigation, reads and decisions remain available.

Implementation: [model use cases](../../apps/server/src/assistant/usecases/models.ts), [ports](../../apps/server/src/assistant/ports.ts), [provider adapter](../../apps/server/src/assistant/adapters/openai-compatible.ts) and [composition](../../apps/server/src/composition/index.ts). Model selection is stored in the database; legacy `AI_*` environment variables do not select the composer model.

A model audience controls who may select the model. It is not a classification/data-release policy. Classification-gated inference remains open in the [vision](../vision.md).

## Compatibility and operations

A manifest refresh checks validity and reports structural changes; it does not guarantee business compatibility for old cards or dependent connectors. Keep existing capability behavior while consumers migrate, use new names for breaking contracts and version deployment images separately. The manifest has no supported `deprecated` field.

Use [reliability operations](../maintainers/reliability-operations.md) for execution/timer diagnostics and recovery. [D23](../decisions/D23-connectors-are-managed-in-the-database.md) and [D24](../decisions/D24-model-endpoints-are-administered-in-the-product.md) preserve the original administration decisions.
