# Implementation status: connector protocol and registration

One page of [implementation status](../status.md). Each entry says what works in this checkout, what limits it or is still to do, and where the code and tests that show it are.

## Manifest preview

**Works in this checkout.** `/protocol/preview`, public: an integrator pastes a manifest or chooses its file, the page posts it to the dry run and draws every problem placed in the document with its rule, where each capability about an entity shows, who would see it there, and the row mark, the section and the menu drawn with Clew's components from sample rows.

**Limits and pending work.** The samples are made from the declaration and nothing is called: it proves the declaration, not the source. Browser specs on a desktop and at 320 px; no screen-reader pass.

**Evidence.** [Page](../../../apps/web/src/pages/protocol-preview.tsx), [dry run](../../../packages/connectors/src/preview.ts), [served protocol tests](../../../tests/unit/protocol-served.test.ts), [model tests](../../../apps/web/tests/protocol-preview-model.test.ts), [browser scenarios](../../../tests/a11y/protocol.spec.ts)

## Remote connectors

**Works in this checkout.** Manifest, capability calls, optional scan/figure and database registration. Governance refreshes reuse unchanged descriptors; manifest, address or secret changes rebuild them. Overlapping fresh reads coalesce without reusing a snapshot taken before a final access check.

**Limits and pending work.** No published production distribution or standalone checker image is established by these docs.

**Evidence.** [Transport](../../../packages/connectors/src/remote.ts), [admin use cases](../../../apps/server/src/connectors/usecases/admin.ts)

## Served protocol

**Works in this checkout.** `/api/protocol`: OpenAPI 3.1 and JSON Schema generated from the validating code, a RapiDoc page from the image, a manifest dry run that shares descriptor rules and schema compilation with registration and lists problems or what Clew would make of the document, and the manifest field by field with examples and rules at `/protocol/manifest`, drawn by the web app from `/api/protocol/manifest-reference.json` (also [committed](../../generated/manifest-reference.md)).

**Limits and pending work.** The viewer page is outside the WCAG suite; versioning beyond 2 is a written policy (accept N and N-1, retire only for security), not yet an exercised code path, since no 3 exists.

**Evidence.** [Routes](../../../apps/server/src/routes/protocol.ts), [preview](../../../packages/connectors/src/preview.ts), [tests](../../../tests/unit/protocol-served.test.ts), [D60](../../decisions/D60-the-instance-serves-its-connector-protocol.md)

## Cross-connector dependencies

**Works in this checkout.** Exact string targets in `uses`, enforced calls and output validation.

**Limits and pending work.** No `deprecated` field, semantic compatibility classifier, dependent health UI or checker `--clew` option. The D37 dependency document is a proposal with a different example shape.

**Evidence.** [Registry](../../../packages/connectors/src/index.ts), [schema](../../protocol/connector-protocol.schema.json), [D37 dependencies](../../decisions/D37-connectors-declare-what-they-use-and-a-capability-name-is-its-contract.md)

## Change notifications

**Works in this checkout.** Scans and source reads are available.

**Limits and pending work.** D19's CloudEvents ingest route/event log is proposed, not a supported connector endpoint.

**Evidence.** [D19](../../decisions/D19-change-notification-is-a-clew-owned-contract.md)

## Search

**Works in this checkout.** Composite search, `<id>.search`/`<id>.fetch`, citations and source budgets.

**Limits and pending work.** The broader D26 proposal is not a claim that every proposed answer shape or source exists.

**Evidence.** [Search module](../../../apps/server/src/modules/search), [tests](../../../tests/unit/search.test.ts)

## External agent MCP

**Works in this checkout.** Design intent only; SCIM moved to the Users and identity row.

**Limits and pending work.** No supported Clew MCP server or enterprise ID-JAG flow is established in this checkout. The development sign-in ([D6](../../decisions/D06-dev-login-local-only.md), amended 2026-11-11) is built as a list of personas on the sign-in page, through the local Keycloak.

**Evidence.** [Identity design](../../architecture/identity.md), [D5](../../decisions/D05-oidc-and-oauth-only-identification-path.md), [D6](../../decisions/D06-dev-login-local-only.md)
