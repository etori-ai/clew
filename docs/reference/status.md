# Implementation status

Reviewed against the working tree on 2026-11-09, including the reliability roadmap implementation and the first jobs across systems. This is a checkout-level guide, not a release compatibility promise. The linked code/tests are the evidence to inspect; an ADR's recorded status is design history, not a feature flag. The [acceptance matrix](reliability-acceptance.md) distinguishes implementation from verified scenarios and outstanding release gates.

## Find an entry

The status is kept as one page per area. Every entry has the same three parts: what works in this checkout, the limits and pending work, and the evidence.

| Page | Entries |
|---|---|
| [Identity and access](status/identity.md) | [Users and identity](status/identity.md#users-and-identity) · [Organisation tree](status/identity.md#organisation-tree) · [User delegation](status/identity.md#user-delegation) · [Protocol 2 authority](status/identity.md#protocol-2-authority) |
| [People, units and talks](status/people.md) | [Personal](status/people.md#personal) · [Utvecklingssamtal (talks)](status/people.md#utvecklingssamtal-talks) · [Sources about an entity](status/people.md#sources-about-an-entity) · [The opened person and the unit page](status/people.md#the-opened-person-and-the-unit-page) · [Subjects on cards and their erasure](status/people.md#subjects-on-cards-and-their-erasure) · [Actions about a person](status/people.md#actions-about-a-person) |
| [Work, decisions and durable execution](status/work.md) | [Approved writes](status/work.md#approved-writes) · [Jobs across systems](status/work.md#jobs-across-systems) · [Scan occurrence lifecycle](status/work.md#scan-occurrence-lifecycle) · [Timers](status/work.md#timers) · [Review recovery and completion](status/work.md#review-recovery-and-completion) · [Becoming done](status/work.md#becoming-done) · [Card actions in the browser](status/work.md#card-actions-in-the-browser) · [Browser updates](status/work.md#browser-updates) |
| [Calendar](status/calendar.md) | [Calendar](status/calendar.md#calendar) · [Calendar follow-up](status/calendar.md#calendar-follow-up) |
| [Views and documents](status/views.md) | [Views and menu tools](status/views.md#views-and-menu-tools) · [Document and semantic catalogue](status/views.md#document-and-semantic-catalogue) · [Views, answers and small places](status/views.md#views-answers-and-small-places) · [Läget's figures](status/views.md#lägets-figures) |
| [Pages and appearance](status/interface.md) | [Theme and logo](status/interface.md#theme-and-logo) · [Shared header](status/interface.md#shared-header) · [Type levels and the area mark](status/interface.md#type-levels-and-the-area-mark) · [Initial page loading](status/interface.md#initial-page-loading) · [Adding to the box](status/interface.md#adding-to-the-box) · [Sedan i går beside Hem](status/interface.md#sedan-i-går-beside-hem) |
| [Connector protocol and registration](status/protocol.md) | [Manifest preview](status/protocol.md#manifest-preview) · [Remote connectors](status/protocol.md#remote-connectors) · [Served protocol](status/protocol.md#served-protocol) · [Cross-connector dependencies](status/protocol.md#cross-connector-dependencies) · [Change notifications](status/protocol.md#change-notifications) · [Search](status/protocol.md#search) · [External agent MCP](status/protocol.md#external-agent-mcp) |
| [Connectors in this repository](status/connectors.md) | [Fixture connectors](status/connectors.md#fixture-connectors) · [Phone book](status/connectors.md#phone-book) · [Sick-leave statistics](status/connectors.md#sick-leave-statistics) · [Errands](status/connectors.md#errands) · [Nextcloud Approval](status/connectors.md#nextcloud-approval) |
| [Operations and models](status/operations.md) | [Observability](status/operations.md#observability) · [Operations](status/operations.md#operations) · [Model configuration](status/operations.md#model-configuration) |

To change an entry, edit its page. A new entry goes on the page for its area and gets a link in the table above; a one-screen adjustment is recorded in the entry of its page ([D102](../decisions/D102-a-decision-is-provisional-until-something-outside-the-repository-has-tested-it.md)).

## How to read the decision history

There are two records each numbered D37–D39 and D44–D46. Use full filenames: D37 dependencies differs from D37 header logo; D38 declared views differs from D38 municipal branding; D39 landing alignment differs from D39 compact header. D44 covers both connector authority and the administration check result; D45 covers approved execution intent and administration navigation; D46 covers committed browser revisions and the default theme. The [generated index](../decisions/README.md) and [context map](../context.json) retain every record and its original status without renumbering.

The practical integration changes are D21/D22 (independent connector services and terminology), D23 (database governance), D38 declared views (Clew renders the UI), and D44 (protocol 2 authority). Earlier MCP-hosting, shared-secret identity-signing and environment-registration examples are historical. Use the [current protocol](connector-protocol.md) to implement a connector.
