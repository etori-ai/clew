# Documentation review: explain Clew before its connectors

Date: 2026-11-07. Scope: repository README, documentation navigation, current product/architecture pages, connector guides and references, maintainer guides, connector READMEs and machine-readable entry points. Decision records, dated reviews and session notes were treated as historical material, not implementation instructions.

The documentation already had useful protocol and authorization detail, but it led with integration work before establishing the product and system architecture. Several architecture pages mixed early designs with later implementation notes.

## Findings and changes

| Finding | Change |
|---|---|
| The root and documentation home led directly into connector onboarding. | Reordered both around product → architecture → implementation status → connector development, with a separate maintainer path. |
| No single current page explained the running system and how work crosses it. | Added [How Clew works](../architecture/overview.md): component diagram, read/scan/approval flows, sequence diagram, persistence and trust boundaries, timers and browser updates. |
| Backend and architecture maps described removed mocks, old files and superseded integration shapes. | Reconciled backend structure, integration principles/paths, capability surfaces, identity, composition and administration with current source. |
| Historical prose contradicted current execution, provisioning and storage behavior. | Explicitly separated generic read/propose routes from human approval, described persisted source-derived snapshots, marked SCIM/MCP/event ingest as unimplemented, and documented sessionless delegation limits. |
| Job support differed between pages. | Aligned the protocol, architecture and support guide: routes/ledger/Temporal watches exist; job/binding screens and receipt-driven continuation remain planned, and steps within one job are independent. |
| A new author had to absorb optional features before a first read. | Reworked [Create a custom connector](../guides/creating-a-connector.md) around a runnable fixture, complete minimal read/view manifest, verified handler boundary, source-adapter changes and registration. Kept search, scans, writes and jobs optional. |
| Copyable prose examples could drift outside generated reference checks. | Extended the existing documentation smoke to parse the marked quickstart manifest with the production validator and validate its example response against the declared output schema. |
| Agent navigation still called the architecture design background. | Updated llms.txt, repository entry instructions and generated context entrypoints/categories to match the human reading path. |

The current guides link implementation and behavioral evidence. Historical decisions/reviews retain their original meaning; no new architecture policy, capability or protocol version was introduced. Product vision remains direction rather than a delivery checklist.

## Verification

- Documentation generation and `docs:check`: generated artifacts, repository-relative links/heading fragments, minimal manifest/response and the signed phonebook fixture exchange.
- TypeScript check for the documentation scripts.
- Formatting check for the two edited TypeScript scripts and whitespace/diff review.

These are documentation and example checks. No source integration was deployed, and no live-source, production recovery or accessibility claim was added.

## Follow-up: orchestration scope and diagram rendering

The product owner pointed out that the wording about a general workflow designer obscured Clew's central role in tasks that require changes in multiple systems. The product overview, architecture, cross-connector guide, README and connector onboarding now explain that role positively, using the HR/time-reporting/payroll job as a concrete example. D55's planned continuation from a confirmed receipt to another fact and another human-approved proposal is explicit. Independent steps within one job and the absence of an arbitrary process-graph editor do not exclude that orchestration. The implementation status separates the existing API, execution ledger and watches from the planned screens, entry paths and receipt-driven continuation.

The approval sequence diagram failed Mermaid parsing because its final message contained a raw semicolon. Reproduced the error with Mermaid 11.12.0, replaced the message with plain text, and parsed all four repository diagrams successfully. The maintainer guide now identifies Mermaid validation as separate from the existing documentation checks. The fixture job scenario also passed: five tests, covering assembly, one approval for two writes and a watch, expiry and per-step undo. No runtime behavior or dependencies changed.
