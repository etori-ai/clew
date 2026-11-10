# Core or connector: deciding what Clew owns

For Clew maintainers who have a feature in front of them and need to decide where it belongs: built into Clew as a
domain Clew owns, reached through a connector to a system that keeps owning it, or not in Clew at all.

Decided in [D95](../decisions/D95-clew-may-own-a-domain-by-choice-decided-with-the-core-or-connector-checklist.md)
(2026-11-10): part of Clew's purpose is to remove third-party dependencies, so Clew may own a domain by choice. The
hard stops and the questions on this page change only together with a numbered decision. The reasoning is in the
exploration
[the layer where Clew owns the feature and its data](../reviews/2026-11-10-owned-domains-against-a-commercial-hr-system.md);
the product rule is in the [vision](../vision.md), "Own the domain where that removes a system". No owned domain is
built yet.

## The three outcomes

| Outcome | Meaning | Where it lives |
|---|---|---|
| **Core** | Clew ships the feature and is the system of record for its data. An installation can switch it off and use a connector to its own system for the same thing. | A module under `apps/server/src/modules/<name>/` with its own tables in Clew's database |
| **Connector** | Another system keeps the record. Clew reads it, shows the work and acts through approved writes. | An independent service under `connectors/<name>/` or in the source owner's repository |
| **Not Clew** | The feature is outside the product. | Nowhere; link to it at most |

Go through the four parts in order. Stop at the first part that gives an outcome.

## Part 1 · Is it Clew at all?

If the feature is one of these, the outcome is **Not Clew**. The list is the vision's "What Clew is not".

- [ ] Authoring or publishing editorial content (an intranet, a news site, a handbook)
- [ ] Letting an operator compose pages or forms freely (a page builder, a general form builder)
- [ ] Indexing other systems' content, or running queries across sources
- [ ] Building assistants, knowledge bases or model administration (Eneo's product)
- [ ] Designing the organisation's processes, or holding its record of a case

## Part 2 · Hard stops

If any of these is true, the outcome is **Connector**, whatever the rest of the list says.

- [ ] **A regulated calculation or ledger.** Its correctness is defined by law, a collective agreement or an auditor:
      payroll, bookkeeping, tax, leave balances, pay mapping.
- [ ] **Master data that other systems treat as the authority.** Employment, the organisation tree, identity. Clew
      receives these (SCIM, the directory connector); it does not issue them.
- [ ] **A statutory case or a record under sector law.** Social services, building permits, patient records,
      registered public documents. These live in the case system.
- [ ] **It must be independent of the organisation's line management, or of Clew itself.** Whistleblowing is the
      example.
- [ ] **Everyone already has it behind an open standard.** Calendar, mail, files, sign-in. Connect by the standard
      (CalDAV, OIDC), do not rebuild.
- [ ] **The value is a specialised engine or a body of content, not a workflow.** Analytics, an e-archive, a learning
      platform's courses, document management.

## Part 3 · The test for core

Every answer must be yes. One no means **Connector** for now; write down which question failed, since that is what
would have to change.

**The feature**

- [ ] **1. It removes something.** You can name the third-party product it replaces, or the spreadsheet, mail thread
      or paper form it ends. A feature that removes nothing is not built.
- [ ] **2. It is the same everywhere.** You can describe it without naming a municipality, a vendor or a sector, and
      what differs between organisations is data (a template, a period, a list), never code.
- [ ] **3. Its value is work between people who use Clew.** The people who do the work are Clew users, and each
      thing someone has to do shows up as a work item in their stream.
- [ ] **4. It is small.** It can be assembled from the building blocks in Part 5, or it adds one new block that
      other domains will reuse. A domain that needs its own queueing, rules engine or form language is not small.
- [ ] **5. It works with the model off.** The assistant may draft and summarise; the feature does not depend on it.

**The record**

- [ ] **6. Clew can carry it.** Before real data is entered there is a written answer, for this domain, to: how long
      the record is kept, what happens to it when a person leaves or changes manager, how one person's records are
      erased, how they are exported to the archive, which secrecy rule applies, and who may see content as opposed to
      status.
- [ ] **7. Everything that reads this data today can still get it.** Each dependent system is named, and each is fed
      by a fact that a connector follows (D55) or by an export. "Nothing depends on it" is a valid answer if it was
      checked.
- [ ] **8. There is a way in and a way out.** Either starting empty is acceptable or there is an import from the
      system being replaced, and the whole domain can be exported in an open format by an installation that leaves.

**The seam**

- [ ] **9. It stays behind capabilities.** Its reads and its effects are capabilities in the registry, so the same
      area, search, figure and assistant surfaces work whether the built-in module or a connector answers.
- [ ] **10. An installation can choose.** The domain can be switched off per installation with the governance
      connectors already have, and an organisation that keeps its own system loses nothing by doing so.

**The team**

- [ ] **11. Someone who knows the domain has reviewed it.** For an HR feature that is an HR practitioner at a pilot
      organisation, not only the Clew team.
- [ ] **12. The Clew team accepts being its vendor.** Migration, support questions and the legal answers in question
      6 become the project's to maintain for as long as the domain exists.

## Part 4 · Order among those that pass

Passing the test makes a domain a candidate, not the next thing built. Rank candidates by:

1. **How much is already built.** A domain whose booking, reminders and follow-up exist comes before one that starts
   from nothing.
2. **How light the record is.** Checklists and plans before free-text notes about a named person; notes before
   anything with secrecy.
3. **How many personas it serves** (`docs/personas.md`), and whether a pilot organisation lacks it today.
4. **Whether it unlocks another candidate.** Commitments unlock checklists; rounds unlock the annual plan.

Each domain that is built gets its own numbered decision, which records the answers to Part 3.

## Part 5 · What a core domain consists of

**Building blocks.** Prefer these to new tables.

| Block | What it is | Already in Clew |
|---|---|---|
| Round | A period in which a set of people are due something; who is due, booked, done, missing | The obligation of D30 and the occurrence identity of D47 |
| Record | What the round produces: each party's preparation, notes, approvals | New |
| Template | The sections and questions of a record, as data | New; text and scale only |
| Commitment | Something a named person does by a date, carried over until done | A thread with a reminder |
| Checklist | Ordered commitments with different owners, started by a date (a first day, a last day) | Commitments; an item with a system behind it is a job step or a watch (D55) |

**Obligations.** A core domain is not done until all of these hold.

- [ ] A D20 module: contracts, pure domain, use cases over ports, adapters; a memory adapter and a Postgres adapter
      under one store contract.
- [ ] Registered in the registry in process; reads as capabilities with declared views where a view is enough;
      first-party Astryx pages only where a person writes.
- [ ] Every change is one transaction with its audit row. Audit rows, log lines and traces carry no names and no
      free text.
- [ ] A write that stays in Clew is a use case, not an execution in the ledger. Anything that leaves Clew (an
      invitation, a step in another system) goes through the human decision and the ledger as today.
- [ ] No free text from the domain reaches a model endpoint until the installation's rule for that is settled.
- [ ] Erasure of one person's records and export of the domain are use cases with scenario tests from the first
      slice, not later work.
- [ ] Free text is sealed at rest at least as approved execution input is.
- [ ] Every new route, view and state has a spec in `tests/a11y`.
- [ ] A row in [implementation status](../reference/status.md) saying what is built and what is not.

## The candidates on 2026-11-10

Agreed with the product owner as the starting matrix. "Decided by" names the question in this list that settles the
row.

| Domain | Outcome | Decided by |
|---|---|---|
| Medarbetarsamtal and 1:1 | Core, first | Passes Part 3 once question 6 is answered; booking and follow-up are built, and the manager's Personal section (D94) is where it will sit |
| Onboarding and offboarding | Core | Passes; offboarding adds two things: closing access is a job step in another system, and it is the event that starts the retention clock of question 6 for every other domain |
| Annual plan | Core | Passes; rounds and checklists on a recurrence |
| Deviation reporting | Core, to confirm | Question 2 and the sector-law hard stop: a general workplace deviation passes, a care deviation under patient-safety law does not |
| Absence request and approval | Unsure | The ledger hard stop (leave balances) and question 7 (payroll must still be fed) |
| Internal errands and service desk | Unsure | Question 4: a service desk grows queues, categories and service levels |
| Internal news and messages | Unsure | Part 1: editorial content is outside the product unless the vision changes |
| Phone book | Unsure | The master-data hard stop: the directory is someone else's authority; the vision names Metakatalogen |
| Payroll | Connector | Hard stop: regulated calculation |
| Finance and invoices | Connector | Hard stop: ledger |
| Statistics (Qlik) | Connector | Hard stop: specialised engine |
| Calendar, mail, identity | Connector | Hard stop: open standard everyone has |

## When the answer changes

A domain can move from connector to core later, and the connector is the way to do it: start as a connector to the
system in use, build the owned module behind the same capabilities, and switch per installation. The fixture
connectors under `connectors/` (D61) are generic versions of such systems, and their manifests are a first draft of
the capabilities an owned module would answer.

Moving the other way, from core to connector, must stay possible for every installation; that is what questions 8 to
10 protect.
