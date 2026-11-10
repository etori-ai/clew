# D95 · Clew may own a domain by choice, decided per domain with the core-or-connector checklist

**Status:** accepted, nothing built · **Date:** 2026-11-10 · **Area:** product, integrations

**Decision.** Part of Clew's purpose is to remove third-party systems an organisation would otherwise buy and
integrate. Clew may therefore be the system of record for a domain by choice, not only where no system exists.

1. **Ownership by choice.** A domain that is the same in every organisation and is mostly a workflow between people
   may be built into Clew and own its data, whether the alternative is a procured product or mail and spreadsheets.
   The earlier rule in `docs/vision.md`, "own the model where nobody else does", is replaced by this one.
2. **The checklist decides.** [Core or connector](../maintainers/core-or-connector.md) is the instrument: Part 1
   (is it Clew at all), Part 2 (six hard stops that always mean connector), Part 3 (twelve questions that must all
   be yes). This decision binds that page; its hard stops and questions change only together with a numbered
   decision.
3. **One decision per owned domain.** A domain becomes core through its own numbered decision, which records the
   answers to Part 3. The answers to question 6 (retention, what happens when a person leaves or changes manager,
   erasure, export to the archive, secrecy, who sees content) are written before real data is entered.
4. **The shape.** An owned domain is a D20 module under `apps/server/src/modules/<name>/` with its own tables in
   Clew's database, registered in the registry in process. Its reads and effects are capabilities, so areas, scans,
   figures, search and the assistant's reads work as for any connector. It has first-party Astryx pages only where
   a person writes; where a declared view is enough, the view is used.
5. **The seam is a requirement.** The same capabilities can be answered by a connector to a third-party system. An
   installation chooses the built-in module or its own system, per domain, with the governance connectors already
   have. A domain may start as a connector and get its owned module later; the connector is the migration path.
6. **An owned domain feeds what depended on the system it replaces** through the fact-and-follower mechanism of
   [D55](D55-a-job-is-assembled-from-what-connectors-follow-approved-once-and-run-per-system.md): the module
   declares the facts it creates and a connector follows them.
7. **Existing rules, restated for an owned domain.**
   - Principle 7 ("names of individuals stay in the source system"): Clew is the source system here. Names and free
     text live in the owning module's tables, are read under current scope, and never enter an audit row, a log
     line or a trace.
   - [D45](D45-approved-intent-precedes-source-dispatch.md): a write that stays in Clew is a use case, one
     transaction and its audit row, not an execution in the ledger. Whatever leaves Clew still goes through the
     human decision and the ledger.
   - The assistant: a text the person types is a direct act; a text the model drafts is a proposal the person
     accepts. No free text from an owned domain reaches a model endpoint until the installation's rule for
     classification-gated inference is settled, and every owned domain works with the model off (D8).
   - Erasure of one person's records and export of the domain are use cases with scenario tests from the first
     slice.
8. **What `core` means.** `ConnectorKind`'s `core` keeps meaning "Clew's own, in process, never a remote manifest".
   An owned domain is registered as `core`. The obligations in item 7 follow from holding a business record, not
   from the kind: `search` and `clew.errands` are `core` and hold none. Whether the kind is split is left to the
   decision for the first owned domain. No code changes with this decision.
9. **Starting candidates** (agreed with the product owner, each still needing its own decision): medarbetarsamtal
   and 1:1 first, onboarding and offboarding, the annual plan, deviation reporting. Unsure: absence request and
   approval, internal errands and service desk, internal news and messages, the phone book. Connectors: payroll,
   finance and invoices, statistics, calendar, mail, identity.

What does not change: every system an organisation keeps is reached through a connector (D21, D22); Clew holds no
employee file, runs no regulated calculation and keeps no ledger (the hard stops); and Clew never keeps a second
copy of a record whose owner is another system. Where Clew owns a domain, the other system is replaced or switched
off for that installation, not mirrored.

**Why.** The product owner, 2026-11-10: "some of the connector systems should be part of clew. Part of clew project
is to get rid of some third party dependencies." The review
[the layer where Clew owns the feature and its data](../reviews/2026-11-10-owned-domains-against-evity.md) compared
Clew with Evity, an HR system whose medarbetarsamtal, onboarding and annual plan are small, generic features
surrounded by plumbing Clew already has (booking, reminders, follow-up, work items, audit). It also found that the
narrower rule had left the ladder's top rung unbuilt: no module owns a business record, and utvecklingssamtal, the
fullest flow in the product, lives in the calendar module and ends when the invitation is answered. For
municipalities that share an open-source system, each owned domain is one procurement and one integration fewer.

The cost is that the Clew project becomes the vendor of a system of record, with migration, support and legal
answers to maintain. That is why the test is strict (all twelve, with hard stops first), why the seam is required
(an organisation is never forced onto the built-in module) and why each domain needs its own decision. Three shapes
were weighed in the review: a first-party remote connector with its own database (no editing surface, a second
database to erase and back up, no shared transaction with threads and audit), a module with declared views only
(would grow the protocol into a form language), and a module with its own pages (chosen).

**Not established.** Nothing is built. The legal answers for a municipality (public documents, secrecy, archive
rules) are named as questions in the review, not answered. What Sundsvall uses today for the candidate domains is
unconfirmed.

The manager relation the first candidate needs now exists in part: people, units and assignments are provisioned
through SCIM ([D68](D68-people-are-pushed-into-clew-through-standard-scim.md), built 2026-11-09) and a manager's
Personal section lists the people on their units
([D94](D94-a-manager-has-a-personal-section-listing-the-people-on-their-units.md)), which is where the first
candidate's pages will sit. Still missing for a record that outlives a change of manager: an assignment is current
state only (no period, no history, no acting manager), the active grant is one assignment without switching, and the
utvecklingssamtal planner still reads its team from the calendar's persona fixture
(`packages/calendar/src/accounts.ts`), not from the assignments, so the two lists can disagree.

**Replaces.** The paragraph "Own the model where nobody else does" in `docs/vision.md` and its open question about
which core domains come first, both rewritten with this decision. Refines
[D3](D03-three-module-kinds.md): core now includes owned domains, which do have a capability seam. The review's
own line ("work between people, never a fact about a person") and its advice against a swap seam, as its Outcome
section records.
