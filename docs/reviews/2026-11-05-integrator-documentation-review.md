# Documentation review: an integrator and coding-agent entry point

Date: 2026-11-05

Scope: repository documentation, connector READMEs, the full decision-file inventory, architecture designs, reviews, vision/personas and session history, checked against the current connector contracts, verifier, registry, administration and tests. This review includes the authorization and execution work already present in the working tree. It does not establish release or live-pilot readiness.

## Findings

| Finding | Consequence for an integrator | Result |
|---|---|---|
| README and docs led with HANDOVER and build sessions. | A new author had to reconstruct the product and current contract from history. | Platform overview, quickstart and task-specific guides now form the default reading path. Setup and branding moved to maintainer pages. |
| Live guides and code comments mixed HS256 identity signing with protocol 2. | An author could implement the wrong trust boundary. | Current authorization guide and source comments describe RS256, pinned public keys, the transport key and separate callback grants. Connector README commands include CLEW_URL. |
| Several documents described administration as unbuilt or used environment registration/model settings. | Setup steps disagreed with the available UI and database governance. | Current guides use administration and draft registration. Older architecture pages are explicitly identified as design background. |
| Handwritten protocol examples contained omitted fields and placeholder schemas. | Copying a plausible-looking example did not prove it conformed. | Complete example manifests and field tables are generated from real exports and TypeBox schemas. |
| The decision index omitted D44 and split later rows from the main table. D37–D39 had collisions. | A reader or agent could miss authority changes or resolve a number to the wrong decision. | The index is generated from every decision file, preserving original status. Full filenames are unique keys; collisions remain explicit and no historical files are renumbered. |
| Accepted/proposed statuses did not track implementation consistently. | Search could look absent while errand profiles, dependency deprecation or MCP could look available. | A separate evidence-linked implementation matrix distinguishes working code, fixtures, partial work and designs. ADR status is not rewritten to guess delivery. |
| Documentation-only changes were excluded from the ordinary check workflow. | Drift and broken links could survive a documentation PR. | Dedicated documentation CI plus docs:check in the main check; generated artifacts, local links and a real signed fixture exchange are verified. |

## Organization and preservation

Integrator material lives in docs/overview.md, guides/, reference/ and generated/. The small llms.txt entry and generated docs/context.json give coding agents a scoped reading path, source map and complete document/decision inventory. The original decision files and dated review bodies retain their paths and recorded intent. The old protocol path redirects readers to the current reference. Architecture designs retain their content with explicit status notes; they are not part of the default connector recipe.

The [vision](../vision.md) remains product direction, [personas](../personas.md) remains source-derived use cases, and [HANDOVER.md](../history/README.md) remains session history. A broken imported-persona link is now identified as a reference to the source repository rather than a missing Clew page.

## Maintenance contract

[scripts/docs.ts](../../scripts/docs.ts) derives schemas, complete example manifests, field tables, decision/review indexes and machine context. [scripts/docs-smoke.ts](../../scripts/docs-smoke.ts) uses the real phone book handler with an ephemeral issuer to verify signed reads, required-input lookup, actor binding and credential rejection. No generated example holds a private key, live token or real source data. [Documentation upkeep](../maintainers/README.md) describes the workflow and its limits.

Remaining product risks stay in the [reliability plan](../architecture/reliability-and-authorization-plan.md). This restructuring does not choose a pilot, accept pending architecture decisions, migrate source writes or verify a real directory/Eneo deployment.

## Validation

Full `bun run check` passed in the devcontainer: type checking, dependency boundaries, purity, 332 unit/web tests, four Node runtime tests and the new documentation check. Generation covered all 47 decision files and 100 documentation entries. The signed fixture walkthrough passed. Deliberately introduced generated-file drift, a missing local file and a missing same-document heading were each rejected, with the original file restored after each probe. `git diff --check` passed. No UI, source-system deployment or service-backed durability behavior was changed or validated by this work.
