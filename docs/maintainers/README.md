# Maintain Clew

Connector authors should start at the [integrator home](../README.md). These pages are for people changing or operating Clew itself.

| Task | Documentation |
|---|---|
| Start the application and development services | [Local development](local-development.md) |
| Configure installation colors and logo | [Branding](branding.md) |
| Change backend structure | [Backend architecture](../architecture/backend-structure.md) and [repository instructions](../../CLAUDE.md) |
| Place and run tests | [Testing](../architecture/testing.md) |
| Upgrade, inspect reliability or rehearse recovery | [Reliability operations](reliability-operations.md), [acceptance evidence](../reference/reliability-acceptance.md) |
| Understand designs and unfinished work | [Architecture map](../architecture/README.md), [status](../reference/status.md) and [reliability plan](../architecture/reliability-and-authorization-plan.md) |
| Understand product intent | [Vision](../vision.md), [personas](../personas.md) |
| Recover rationale or session context | [Decision index](../decisions/README.md), [reviews](../reviews/README.md), [handover](../../HANDOVER.md) |

## Documentation is an interface

Keep the default reading path useful to an integrator who has not followed the build sessions. Explain the platform, show working source, name limits and give a way to verify the result. Short guides are preferable to multiple copies of the same contract.

**Code owns shapes and behavior.** Edit TypeBox contracts and implementation first. The generated JSON Schema, field reference and complete fixture manifests follow from those sources. Test examples against actual handlers; do not publish pseudo-manifests with ellipses as copyable examples.

**Prose owns explanation and workflow.** Guides state prerequisites, expected outcomes, trust boundaries and implementation limits. Link to the owning source and a behavioral test. When a feature is proposed or only fixture-tested, say so in [status](../reference/status.md). Do not infer implementation from an ADR's acceptance.

**History retains its identity.** Preserve decision filenames and review bodies. The generated index copies the recorded metadata and exposes the existing numbering collisions. A new decision uses an unused number. A review is evidence, not an automatic change in policy. Update the handover session log when documentation changes.

## Generate and verify

```sh
docker exec -w /workspace clew-app-1 bun run docs:generate
docker exec -w /workspace clew-app-1 bun run docs:check
```

[scripts/docs.ts](../../scripts/docs.ts) deterministically generates the protocol bundle, example manifests, field reference, complete decision/review indexes and `docs/context.json`. The context map gives a coding agent entry points, unique decision keys, canonical source paths and a document inventory. [llms.txt](../../llms.txt) is the small human-readable entry point. Neither includes secrets, live user data or ephemeral assertions.

`docs:check` is read-only: it rejects stale generated files and broken repository-relative Markdown links or heading fragments, then runs [docs-smoke.ts](../../scripts/docs-smoke.ts). Remote URLs are not fetched; plain code-formatted paths are not link-checked. The smoke creates an ephemeral issuer and exercises the real fixture handler without external services. Existing tests remain responsible for broader protocol and application behavior.

The [documentation CI workflow](../../.github/workflows/docs.yml) runs on documentation, contract, connector, generator, dependency and workflow changes, including documentation-only pull requests. `bun run check` also includes `docs:check`. For a new connector reference, extend the generator's imported manifest list and add its behavioral fixture evidence. For a new guide, link it from the integrator map; the inventory is discovered automatically.
