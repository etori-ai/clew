# Test, register and operate a connector

## From your own project, against a test installation

A connector is its own repository. Nothing from this one needs to be installed there; the Clew you will register with serves what you build against ([D60](../decisions/D60-the-instance-serves-its-connector-protocol.md)), and a test installation of Clew is the natural target.

1. **Generate from the instance, not from this checkout.** Point `openapi-typescript`, `openapi-generator` or your language's equivalent at `https://<test-clew>/api/protocol/openapi.json` for the four routes you serve and the two you call; feed `/api/protocol/connector-protocol.schema.json` to a JSON Schema tool for the shapes alone. Regenerate when the test installation is upgraded; its `x-clew-protocol` block says which protocol numbers it loads.
2. **Make the dry run a test in your repository.** Post your manifest to the instance and assert what you intend:

   ```sh
   curl -s -X POST "https://<test-clew>/api/protocol/manifest?id=<your id>" -H 'content-type: application/json' --data @manifest.json
   ```

   The answer lists every reason the loader would refuse the document, or, for a good one, which capabilities become model tools, which views can be rows in the menu, which reads the conformance check will skip because they need input, and who may call what. Run it in CI so a drift on either side shows on the next push. It checks the manifest only, and knows nothing of your registration, audience or governance.
3. **Register a draft on the test installation for the behavioural check.** An administrator with `admin.connectors` adds your connector's URL, id and transport secret under Administration › Anslutna system and presses "Testa anslutning". A draft is visible to no one until it is enabled, so do this early and often. Your service must be reachable from that Clew (a tunnel or a deployment into its network), your verifier must pin that installation's `https://<test-clew>/api/connectors/jwks`, and its base URL is your `CLEW_URL` for callbacks; see [authorization](authorization.md). The CLI below needs the installation's database and master key and is for whoever operates that Clew.
4. **Without any Clew**, copy the pattern of [the signed walkthrough](../../scripts/docs-smoke.ts): your handler in-process behind an ephemeral signing authority and the shared checker. That is the one step that needs this repository checked out.

## Checks without external services

Before anything runs, post the manifest to the instance's dry run ([D60](../decisions/D60-the-instance-serves-its-connector-protocol.md)); it lists every problem the loader would refuse it for, and for a good document says what Clew would offer to whom and which capabilities the conformance check below will and will not call:

```sh
curl -s -X POST "http://localhost:3020/api/protocol/manifest?id=phonebook" -H 'content-type: application/json' --data @docs/generated/phonebook.manifest.json
```

Run from the repository root on the host, with the devcontainer and dependencies available:

```sh
docker exec -w /workspace clew-app-1 bun run docs:check
docker exec -w /workspace clew-app-1 bun test tests/unit/remote-connector.test.ts tests/unit/phonebook-connector.test.ts tests/unit/views.test.ts tests/unit/authorization-boundaries.test.ts
```

The documentation check compares generated artifacts to source, checks local documentation links, and runs [the signed fixture walkthrough](../../scripts/docs-smoke.ts). The test suite exercises the transport and contract behavior. Neither needs a database, identity provider or network source.

For your connector, use its real request handler against a deterministic fixture. Test both roles, record access inside an allowed role, forged/expired/wrong-audience assertions, missing or incorrect transport credentials, invalid input, schema-valid output, inaccessible refs and source outages. Test required-input reads and writes explicitly: the generic checker cannot infer useful input for them.

## Live conformance

After starting the connector and a configured Clew installation, run:

```sh
docker exec -w /workspace clew-app-1 bun scripts/connector-check.ts http://127.0.0.1:4020 --id phonebook --secret local-docs-only-transport-key
```

This concrete example uses the [phone book fixture service](example-custom-directory.md). Replace the address, id and development-only secret for your service. The CLI loads the installation's local server configuration and needs its database and master key to obtain the signing authority. The connector must be able to fetch that installation's trusted public keys.

The [shared checker](../../packages/connectors/src/check.ts), also used by Administration → Anslutna system → Testa anslutning, validates the manifest and probes with synthetic `check-manager` and `check-employee` actors. It checks callable empty-input reads/proposals, registry role filtering, rejection of a foreign signature, scans and declared views. It does not execute writes, prove source-level row access, test every JWT claim, or fully exercise reads that require input. Callback success requires real local grants for those synthetic actors. Delegation requires a user session, which this checker has no way to supply; a denied delegated call is expected. Read warnings as well as failures.

The CLI prints English diagnostic `findings`, including truncated source answers; use synthetic data and handle its output accordingly. Administration receives Swedish structured `items` grouped by connection, capabilities and surfaces, without successful source-answer payloads. Both use the same probes and verdict. See [the check-result decision](../decisions/D44-the-connector-check-reads-as-a-result-not-a-log.md).

## Register a draft, then enable it

An administrator with `admin.connectors` can add the URL, id and transport secret in Administration → Anslutna system, review the check, set an audience and enable the connector. The API and screens exist. Eligible views can be chosen as menu tools there.

The CLI is an operator/bootstrap alternative. It creates or updates a draft by default:

```sh
docker exec -w /workspace clew-app-1 bun scripts/connector-add.ts phonebook http://127.0.0.1:4020 --secret local-docs-only-transport-key
docker exec -w /workspace clew-app-1 bun scripts/connector-add.ts --list
```

Use the administration UI to narrow the audience before enabling a real integration. `connector-add.ts <id> --enable` enables an existing registration; the CLI does not run the entire conformance suite. Registration lives in PostgreSQL, with a sealed transport secret and audit; the running server reconciles it without a rebuild or restart. A connector missing governance is not callable.

A connector that follows a fact kind (D55, `follows` on a `propose`) runs nothing until an administrator binds it. Until the administration page has bindings, the CLI is the way: one row per fact kind and follower with its audit row, default deny. The `--fixtures` form binds the development fixture connectors' followers of `hr:absence` with a short payroll window so a watch can be seen expiring in development; `scripts/jobs-check.ts` on the host then runs the scenario end to end as the manager.

```sh
docker exec -w /workspace clew-app-1 bun scripts/job-bind.ts hr:absence payroll.followAbsence --within PT4H
docker exec -w /workspace clew-app-1 bun scripts/job-bind.ts --fixtures
docker exec -w /workspace clew-app-1 bun scripts/job-bind.ts --list
bun scripts/jobs-check.ts
```

## Deploy the service

Ship an independently runnable image with documented configuration and a health/operations procedure appropriate to the source. Keep the source credential in that service; Clew needs its registration transport secret, not the source's service-account password. Configure `CLEW_URL` as the trusted, reachable Clew base URL, and use HTTPS for nonlocal traffic. A container's loopback address is not another container's address. The server defaults to loopback outside compose. The development compose sets `HOST=0.0.0.0` so source services can reach `http://app:3000`; its published web port is still host-loopback only. Use a reachable listener and network route for a separately deployed connector.

Pin the deployed image version, keep secrets outside the image and test source connectivity and identity mappings before enabling access. The examples' Dockerfiles are starting points. The repository's current development compose stack is not a published production installation recipe.

On manifest changes, restart/deploy the connector and use Hämta manifest igen in administration. Review added, removed and changed capabilities and test dependent calls. There is no automatic semantic compatibility guarantee or supported manifest `deprecated` field. Preserve old capability behavior while stored cards and callers still depend on it.

## Troubleshoot the boundary that failed

| Symptom | Check |
|---|---|
| Manifest rejected | Post the document to `/api/protocol/manifest?id=<id>`: it lists every problem. Protocol is 2; configured id matches; no unsupported fields; schemas, views and standing names agree. |
| HTTP 401 on every POST | Transport key, pinned Clew URL, public-key reachability, `kid`, audience and clocks. Never fix this by trusting the body actor. |
| Connector absent for a person | Enabled state, audience, capability toggles, scope and current local grants. |
| Callback denied | Separate callback grant, exact `uses` target, actor's current assignment and target scope; no executes or cycles. |
| Delegated call denied | Manifest audience, IdP exchange configuration, session token and source-side resource-server configuration. |
| A view is not in the menu | It must be an eligible read with a view and no required input, selected by an administrator, within the person's access. |
| Unknown write outcome | Recover source evidence by operation lookup; do not retry with a new operation id to make the warning disappear. |

## Additional write verification

The ordinary Node suite checks runtime compatibility. The separate durability suite exercises the synthetic durable source with PostgreSQL and the DBOS engine in production Node, including a killed second instance; it requires the database. Read the scripts and fixture scope before running it:

```sh
docker exec -w /workspace clew-app-1 bun run test:node
docker exec -w /workspace clew-app-1 bun run test:db
docker exec -w /workspace clew-app-1 bun run test:durability
```

See [server package scripts](../../apps/server/package.json), [maintainer testing](../architecture/testing.md) and the [reliability plan](../architecture/reliability-and-authorization-plan.md). Report fixture, runtime and live-source evidence separately; a green fixture is not proof of a live pilot.

The durability lane includes timer generation/cancellation and replay of previous workflow histories. Database contracts cover calendar projection, bounded follow-up, refresh and attention ownership. For upgrade, legacy-owner drain, aggregate diagnostics and the isolated backup/restore rehearsal, use the [operations runbook](../maintainers/reliability-operations.md). Never point restored state at live dispatchers before reconciling source effects.
