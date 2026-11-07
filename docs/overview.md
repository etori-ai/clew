# What Clew is

Clew is an open-source workspace that brings an employee's work across systems into one place. It answers four practical questions: **What needs me? What do I need to know? What can I do? What happened after I did it?**

An employee's day crosses calendars, HR, finance, case systems and directories. Clew connects that work through a consistent interface, while the systems that own the records continue to own them. It is built for public-sector employees, including people on a phone, managers responsible for a unit and operators connecting systems. The Swedish employee interface is called **Startsidan**; identifiers, contracts and documentation are English.

This page explains the product and its concepts. Continue with the [architecture overview](architecture/overview.md) for how the components implement them. The [status matrix](reference/status.md) distinguishes delivered behavior from product direction.

## A journey through Clew

Consider a manager with invoices awaiting approval.

1. A connector reads outstanding work under the manager's access and reports it to Clew.
2. Clew presents a card with a reason, relevant items and a next step. The manager can open current detail from the source, or ask the optional assistant to explain it.
3. The manager reviews the items and approves an action. Clew records exactly what was approved before contacting the source.
4. The connector performs the approved operation under current source permissions and returns evidence of its outcome.
5. Clew shows a receipt for each item. If the outcome is uncertain, it preserves that uncertainty and supports reconciliation. If the source supports compensation, the receipt can offer undo.

The [finance fixture](../connectors/finance/README.md) demonstrates this journey with synthetic invoices. It is not an integration with a deployed finance product.

Not every interaction needs a card or a write. Looking up a phone number is a live read. A directory can offer a searchable table and contact details without implementing scans, actions or timers.

## What the employee sees

| Surface | Purpose |
|---|---|
| Home and work cards | Discover work, see why it matters, take the next step and return to unfinished work. |
| Areas and tools | Reach a connected system's standing reads and views without typing a question. |
| Calendar | See the person's bookings and review calendar proposals. |
| Search and conversation | Find objects across eligible sources; optionally ask a model to explain results or prepare a proposal. |
| Views | Inspect source data as a table, list, detail or text, on a tool page or beside the current conversation/page. |
| Receipts and reminders | Understand confirmed outcomes, revisit unresolved work and bring work back at the agreed time. |

Clew owns these surfaces. A connector declares the meaning of its data and the supported view to use; it does not send frontend code or choose the application's layout. The experimental [portal](reference/status.md) is a second frontend over the same backend, with a narrower and less-verified feature set.

## Who owns what

| Owner | Responsibility |
|---|---|
| Source system | Business records, source permissions and evidence of source effects. |
| Connector | Mapping source APIs, identities and records to Clew's contract; enforcing source access for the verified person. |
| Clew | Local users and grants, connector configuration, work cards, conversations, approvals, audit, execution evidence and follow-up. |
| Identity provider | Signing the identity used at login. Clew resolves it to a local person and current grant. |
| Optional model | Choosing allowed reads, explaining results and preparing proposals within the person's scope. |

Clew persists coordination data, including selected source-derived text and results. Card summaries, conversation answers, receipts and encrypted execution inputs/results can contain source-derived information. Keep those payloads minimal, enforce current access and decide retention deliberately. Sensitive detail is usually better read live through a view. See [data ownership](architecture/overview.md#data-ownership-and-persistence).

Users and grants are core Clew entities. An employee directory with phone numbers, titles and locations remains an external source. The internal `people.*` capabilities are scoped reads of Clew's user records, not a connector an administrator can uninstall. Current identity supports one unit/role grant per person; SCIM provisioning and multiple simultaneous assignments are not implemented.

## The concepts, in order

| Concept | Meaning |
|---|---|
| Connector | An independently deployed HTTP integration with a stable id and manifest. The manifest's `source` is the displayed system name. |
| Capability | A named operation such as `phonebook.directory`, with input/output schemas, scope and a kind: `read`, `propose` or `execute`. |
| Read | Returns source information without changing the source. It may have a declared view and be available to the model. |
| Proposal | Prepares work for review. A `propose` capability must not perform the proposed source write. |
| Execute | Performs an approved source action. Always `model: false`, reached through a human decision path. |
| Area and standing capability | An area groups capabilities offered to eligible people; a standing capability is available without a pushed card. |
| View | A semantic declaration for displaying a read: `table`, `list`, `detail` or `text`. |
| Ref | A stable source-object identifier returned to its owner for later reads/actions. It is not authorization. |
| Scan and occurrence | A scan discovers work. An occurrence identifies a particular source item and recurring period; its revision describes material change. |
| Thread/card | Clew's persisted presentation of work and its conversation. One card may group several occurrences. |
| Decision, execution and receipt | The approval, the tracked attempt to perform it, and the source evidence of the result. They are separate so a lost response is not mistaken for success. |

A connector author can start with reads and a view. [Create a connector](guides/creating-a-connector.md) walks through that minimum before introducing optional features.

## The assistant is optional

Buttons, declared views, deterministic reads and approval flows work without a model. The assistant uses Clew's capability registry under the person's access. It cannot approve a source action or bypass source permissions.

Operators can configure an OpenAI-compatible model endpoint, including a self-hosted model. Eneo can add document retrieval through an optional connector. Clew runs independently of Eneo; it does not ingest documents or manage knowledge bases.

A view's `modelReads: "summary"` keeps that view's rows out of the model response and supplies a summary/count instead. It does not redact search hits, other capabilities, stored answers or the person's own text. Model release policy must account for every path that supplies context.

## Product boundaries

Clew coordinates a person's work. Source systems continue to define their own business processes and records. Clew's cross-system jobs contain independently executed steps; they do not provide a general workflow designer, ordered dependencies or an atomic transaction across systems.

Clew searches through connectors rather than building a cross-source content index. It is not an intranet authoring system, document store, data warehouse, query engine or page builder. New integrations implement Clew's HTTP contract; they do not require a vendor-specific change to the browser.

The [vision](vision.md) explains why these boundaries matter. For the implementation, continue to [How Clew works](architecture/overview.md), then choose the relevant [connector guide](guides/README.md).
