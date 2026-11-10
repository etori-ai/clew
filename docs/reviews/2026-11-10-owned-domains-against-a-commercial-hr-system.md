# Exploration: the layer where Clew owns the feature and its data, against a commercial HR system · 2026-11-10

**Date:** 2026-11-10 · **Asked by:** the product owner ("We might have taken the modularity a bit too far. […] a lot
of features like the ones [a commercial HR system] provide is standard for all organizations, 1-on-1 with employees
etc. So now we need to explore the layer where clew takes ownership of the feature and data, and how it relates to
what we have already built") · **Outcome:** the discussion the same day widened the premise; see
[Outcome of the discussion](#outcome-of-the-discussion-2026-11-10) at the end, which replaces the line and the sorting
below with a checklist for maintainers ([core or connector](../maintainers/core-or-connector.md)). Recorded as
[D95](../decisions/D95-clew-may-own-a-domain-by-choice-decided-with-the-core-or-connector-checklist.md).

## The question

Clew was built on the assumption that the record lives somewhere else: a connector reads it, Clew coordinates and
keeps the receipt. For a set of manager-and-employee features there is often no such system, and the feature is the
same in every organisation. What should Clew own outright, what should it keep refusing to own, and how much of what
is already built carries over?

## Short answer

1. **The vision already allows this; the code has no place for it.** `docs/vision.md` ("Own the model where nobody
   else does") describes a ladder of pass-through, derived and core, and names utvecklingssamtal records and
   delegations as the first candidates. No module in the repository owns a business record today.
2. **The modularity is not wasted.** The connector boundary is right for systems that exist. What is missing is the
   top rung of the ladder. Most of what an owned feature needs besides its record (booking, reminders, follow-up,
   work items, attention, audit, effects in other systems) is already there, which is why the owned layer can be thin.
3. **Own the work between people, never the facts about a person.** A conversation held, what was agreed, a checklist
   and who did which item: Clew may own. Employment, pay, absence, competence: stays in the HR system, read through a
   connector. This keeps Clew from growing an employee file, which is the centre of the reference product and of
   every HR system.
4. **Of the reference product's fifteen features, three fit now**: medarbetarsamtal and 1:1, on- and offboarding
   checklists, and the annual plan. They reduce to five building blocks, four of which Clew partly has.
5. **Start by giving utvecklingssamtal a home of its own.** Today the flow ends when the invitation is answered.
   The first owned domain is the rest of it: the round, the record and the action points.

## What the reference product is

The reference product is a Swedish commercial HR system for small and medium-sized companies; its site names no
public-sector customer and no AI feature. It lists fifteen features in four groups.

| Group | Features |
|---|---|
| Medarbetarresan | Rekrytering, on- och offboarding, personkort, årsplanering |
| Utveckling | Medarbetarsamtal, medarbetarundersökningar, kompetenskartläggning, CV-generator |
| Lön och frånvaro | Lönekartläggning, lönerevision, frånvaro |
| Regelefterlevnad | GDPR-center, visselblåsning, e-signering, personalhandbok |

Three observations matter for Clew:

- **Everything lands on the personkort.** Meeting notes, signed contracts, survey answers, absence and competence all
  attach to the employee's record. The product is an employee file with features around it.
- **The medarbetarsamtal feature is small.** HR builds a template (sections, five question types, a visibility rule
  per question). Manager and employee each prepare. Notes are approved and kept. Action points have an owner and a
  deadline and carry over to the next meeting until done. HR sees held, booked and missing per template and period.
  Retention is set per template and deletion is automatic. The record follows the employee, so it survives a change
  of manager.
- **Much of the rest is plumbing Clew already has.** Reminders the day before, reminders on overdue action points,
  calendar sync, tasks pushed to a task app, notices in a chat tool. The product integrates outwards to reach the
  place where the person works. Clew is that place.

## What Clew has today

| Need of an owned feature | In the repository | Evidence |
|---|---|---|
| Book twenty talks as one obligation, wait for answers, remind, close | Built; the fullest flow in the product | [samtal.ts](../../apps/server/src/modules/calendar/usecases/samtal.ts), [D30](../decisions/D30-a-proposal-thread-is-an-obligation-with-four-steps.md) |
| A work item in a person's stream with a reason, a deadline, a reminder and a snooze | Built | threads, timers and attention in [status](../reference/status.md) |
| Recurring and durable waits | Built (DBOS, D85) | [workflows.ts](../../apps/server/src/dbos/workflows.ts) |
| An audit row in the same transaction as every change | Built | `audit` in [schema.ts](../../packages/db/src/schema.ts) |
| Effects in other systems from one approval | Built for the first job (D55) | [jobs module](../../apps/server/src/modules/jobs/) |
| A record of the talk itself: template, preparation, notes, what was agreed | **Nothing** | The `proposal` table holds a time, a participant and a calendar ref |
| "Who has had theirs this year" | **Nothing durable** | The obligation's topic and deadline are constants (`TOPIC`, `DEADLINE = '2026-11-28'`) |
| Who is whose manager, over time | **A development fixture** | `members` from the persona table in [accounts.ts](../../packages/calendar/src/accounts.ts); one unit and role per person |
| Retention, export and erasure of owned records | **Not established** | [architecture overview](../architecture/overview.md), "Data ownership and persistence" |

Two things in the code show the missing rung:

- `ConnectorKind` has `core`, but it means "runs inside the server" (`people`, `search`), not "owns the record". The
  bundled describer even reports a core connector as `passthrough`
  ([describe.ts](../../apps/server/src/connectors/describe.ts)).
- Utvecklingssamtal, the flagship flow, lives in the `calendar` module, whose connector is `passthrough`. It had
  nowhere else to go. Clew knows a talk was booked. It does not know it was held, and nothing carries to next year.

So the diagnosis is narrower than "too modular". The connector lane was built out thoroughly and the owned lane was
left as a paragraph in the vision.

## The line: what Clew may own

A test in one sentence: **Clew may own a record of work done between people in Clew; it never owns a fact about a
person that the employer must hold whatever tool is used.**

| Clew may own | Clew never owns (connector) |
|---|---|
| A talk: its round, preparation, notes, approval | Employment, position, organisation (HR master, SCIM) |
| What was agreed and who does it by when | Pay, pay review, pay mapping |
| A checklist and who completed which item | Absence and its approval |
| A recurring plan of obligations | Competence, certificates, formal delegations as a register |
| Its own threads, decisions and receipts (already) | Recruitment, contracts, signatures, whistleblowing cases |

This is the vision's rule ("Clew never copies a record another system owns in order to own it") made usable for HR
features, and it settles the personkort: Clew does not have one. An owned record is keyed on Clew's person and on a
period or occurrence. What a manager sees about an employee beside a talk (absence pattern, expiring certificate)
is read live from the HR connector, as UC-KIM-2 already describes.

## The reference product's fifteen, sorted

| Feature | Verdict | Why |
|---|---|---|
| Medarbetarsamtal, 1:1 | **Own, first** | The vision's first candidate; half built; rarely has a system of record |
| On- och offboarding | **Own, second** | A checklist of work items with owners; UC-LENA-2 already says "a checklist kept in Startsidan itself"; items can be job steps in other systems |
| Årsplanering | **Own, third** | Recurring obligations with an owner and a date; this is the scheduler with a calendar on top |
| Medarbetarundersökningar | Defer | A form builder and an anonymity model (minimum group size, publish-time lock) are a product of their own; D82 holds the same rule for sick leave in a connector |
| Kompetenskartläggning | Connector | Lives in the HR system or the LMS; the 60-day warning is a scan (UC-KIM-4) |
| Frånvaro | Connector | Already the fixture's job (`hr:absence`, D55) |
| Lönerevision, lönekartläggning | Connector | Pay data and statutory documentation belong with payroll |
| Personkort | Never | The employee file; see the line above |
| Rekrytering, e-signering | Connector | Separate procured systems |
| Visselblåsning | Never | Must be independent of the line organisation it reports on |
| Personalhandbok | Never | "Not an intranet"; D88 already takes editorial content from a connector |
| CV-generator | Out of scope | Consultancy feature |
| GDPR-center | Not a feature | Retention, erasure and traceability are properties every owned domain must have |

## Five building blocks, not fifteen modules

| Block | What it is | Relation to what is built |
|---|---|---|
| **Round** | A period in which a set of people are due something ("utvecklingssamtal 2026"): who is due, booked, held, missing | The D30 obligation with its constants made data. The occurrence identity of D47 (person, source key, period) is the same idea |
| **Record** | What the round produces per pair: each party's preparation, the notes, both approvals | New. The only block with sensitive free text |
| **Template** | Sections and questions for a record, written by HR | New, and should stay small: text and scale, no form builder |
| **Commitment** | An action point with an owner and a deadline that carries over until done | A work item. It is a thread in the owner's stream with a reminder; the only new part is the link back to the record |
| **Checklist** | Ordered commitments with different owners, started by an event (a start date) | Commitments plus a start. An item that has a system behind it ("konto skapat") is a D55 job step with a receipt, or a watch |

The plan (årshjul) is rounds and checklists on a recurrence, which the durable engine already runs.

This is where Clew can be better than a stand-alone HR tool and not only equal to it. The reference product's
onboarding item is a checkbox someone ticks. A Clew onboarding item can be an approved execution in the IT system,
or a watch that closes itself when the account exists.

## What the layer is in code

Three shapes are possible.

| Shape | What it means | For | Against |
|---|---|---|---|
| A. First-party remote connector with its own database | `connectors/talks` as a separate service | Keeps the core free of HR content; optional per installation | Declared views have no editing surface beyond twelve text fields; a second database to back up, erase and export; no shared transaction with threads, timers or audit; `core` is not a remote kind |
| B. Server module registered as an in-process connector, UI through declared views only | `apps/server/src/modules/talks/`, tables in Clew's database | One transaction with the audit row and the commitment's thread; appears in areas, search, figures and model tools for free | Writing notes and agendas through the view contract means growing the protocol into a form language |
| C. B plus its own pages | As B, with a small Astryx page family the way the calendar has one | The person gets a real writing surface; the protocol stays as it is | More code per domain; needs discipline to stay small |

**Recommendation: C.** An owned domain is a D20 module with its own tables, registered in the registry as an
in-process connector so that everything that already works on capabilities (areas, scans to cards, figures, search,
the assistant's reads, facts for jobs) works for it unchanged, plus first-party pages where the person writes. The
reads go through capabilities; the writing does not have to.

Do not build the swap seam in advance. It is tempting to define a profile (`<id>.talks`, as D89 did for errands) so
that a municipality with its own tool can plug it in instead. D35 and D89 extracted the errand profile after a real
system showed its shape. The same order applies here: build the owned module behind capabilities, switch it on and
off per installation with the governance that exists, and extract a profile when a second implementation is real.

## Rules that need restating

Owning a record changes the meaning of five existing rules. A decision has to say so explicitly.

1. **"Names of individuals stay in the source system" (principle 7).** For an owned domain Clew is the source
   system. The rule becomes: names and free text live in the owning module's tables, are read under current scope,
   and never enter an audit row, a log line or a trace (the audit table's own comment already says metadata only).
2. **"Every write is a human decision through the execution ledger" (D45).** The ledger exists because a remote write
   can succeed while its answer is lost. A local write cannot. Precedent: local proposal edits stay in `events.ts`.
   An owned write is a use case, one transaction and its audit row. The ledger stays for whatever leaves Clew (the
   calendar invitation, a job step).
3. **The assistant proposes, the person decides.** Unchanged, and it needs a sentence: a note the person types is a
   direct act; a note the model drafts is a proposal the person accepts.
4. **Classification-gated inference** is listed in the vision as "not needed until a real source is connected". Talk
   notes are personal data about an identifiable employee from the first day. No owned free text reaches a model
   until that question has an answer; the first slice should work with the model off, which D8 requires anyway.
5. **`core` in the contracts** should mean what the vision means. Either split "bundled" from "owns the record" in
   `ConnectorKind`, or record that `core` now implies retention, erasure and export.

## What has to exist first

- **The manager relation.** One unit and one role per person, with the team read from a fixture, cannot carry a
  record that outlives a change of manager, an acting manager (UC-KIM-5) or an HR partner who sees status across
  units (UC-LENA-1). SCIM (D68) and multiple assignments are designs today. A first slice can run on the fixture; a
  pilot cannot.
- **Retention, export and erasure, per domain.** The vision ties ownership to these three. For a municipality there
  is more than GDPR: whether a talk record is a public document, which secrecy rule covers it, and what the archive
  rules say about keeping and weeding it. The reference product's customers do not have that question, and this
  review has not answered it. It needs the municipality's lawyer and archivist before real data is entered.
- **Sealing at rest.** Approved execution input is already encrypted. Talk notes need at least the same.

## A first slice

One vertical slice, on the development stack, model off:

1. A `talks` module with three tables: round, record, commitment. The calendar module keeps booking and nothing else;
   the obligation's topic and deadline come from the round.
2. One built-in template. Manager and employee each write their preparation, visible to the other when the talk
   starts. Notes during the talk, approved by both.
3. Each action point becomes a thread in its owner's stream with its deadline and reminder. Open ones are listed at
   the top of the next talk with the same person.
4. The manager's list for the round: held, booked, missing, with "Boka" on the missing row leading into the existing
   planner. A figure on Läget ("14 av 20 hållna").
5. Scenario tests asserting the audit rows, a store contract on both adapters, an a11y spec for the new pages, and
   erasure of one person's records as a tested use case from the start.

Out of the slice: the template editor, HR's cross-unit view, checklists, the plan, surveys.

## Questions for the product owner

1. **Is the owned layer part of every installation or switched on per domain?** Recommended: per domain, with the
   governance connectors already have.
2. **Who does a talk record belong to?** Recommended: the employee and the manager role, so it survives a change of
   manager; the outgoing manager loses access with the assignment.
3. **What does HR see?** Recommended: status only (held, booked, missing), never content.
4. **Are surveys in?** Recommended: not now. A pulse survey is a form builder plus an anonymity model, and the vision
   says no page builder.
5. **Is "standard for all organisations" meant beyond the public sector?** The Petra persona says the same needs
   exist in a company. Nothing proposed here is municipal, but the archive and secrecy work is.
6. **Does this replace or sit beside an HR system's own samtal module where one exists?** The line above says beside:
   where the HR system holds the record, Clew stays a connector and the owned module is switched off.

## Outcome of the discussion, 2026-11-10

The product owner read the review and corrected its premise: "some of the connector systems should be part of clew.
Part of clew project is to get rid of some third party dependencies." The body above is kept as written; these
points replace parts of it.

1. **Ownership by choice, not only where nobody else owns.** The vision's rule ("where nobody else does", "never
   copies a record another system owns in order to own it") is narrower than the product's purpose. Clew may become
   the system of record for a domain so that an organisation can stop buying a system for it. Recorded in
   [D95](../decisions/D95-clew-may-own-a-domain-by-choice-decided-with-the-core-or-connector-checklist.md), which
   also rewrote the vision's paragraph.
2. **The line in "The line: what Clew may own" is too narrow.** "Work between people, never a fact about a person"
   excludes systems that are meant to be absorbed. It is replaced by a set of hard stops and a twelve-question test
   in [core or connector](../maintainers/core-or-connector.md). The refusal of an employee file survives as one hard
   stop: master data that other systems treat as the authority.
3. **The advice against a swap seam is withdrawn.** With replacement as the goal there are two implementations by
   design: the third-party system behind a connector and Clew's own module. Both answer the same capabilities and an
   installation chooses. Shape C in "What the layer is in code" stands, with the seam as a requirement.
4. **The connector layer is the migration path.** A domain can start as a connector to the system in use, get an
   owned module behind the same capabilities and be switched per installation. The fixture connectors (D61) are
   generic versions of such systems, so their manifests are a first draft of what an owned module answers.
5. **An owned domain feeds the systems that depended on the one it replaces** through the fact-and-follower
   mechanism of D55: the owned module creates the fact, a payroll or HR connector follows it.
6. **The matrix agreed as the starting point**, with onboarding and offboarding as one domain:

   | Absorb | Unsure | Keep as connector |
   |---|---|---|
   | Medarbetarsamtal and 1:1 | Absence request and approval | Payroll |
   | Onboarding and offboarding | Internal errands and service desk | Finance and invoices |
   | Annual plan | Internal news and messages | Statistics (Qlik) |
   | Deviation reporting | Phone book | Calendar, mail, identity |

   Offboarding is more than the checklist run backwards: closing access is a step in other systems (a D55 job step),
   the exit talk is a talk record, and the last working day starts the retention clock for the person's records in
   every owned domain.
7. **A checklist for maintainers** was asked for and drafted:
   [core or connector](../maintainers/core-or-connector.md), bound by D95.

8. **The users work that landed the same day changes one finding.** This review was written against `97e5f28`,
   where the manager relation was a development fixture. Origin then brought SCIM provisioning with units and
   assignments (D68), capabilities mapped from groups, and a manager's Personal section at `/staff` (D94), whose
   decision says it "lays the section" the utvecklingssamtal and notes will live in. So the row "Who is whose
   manager, over time" above is half answered: who manages whom now comes from the directory, and a person can be on
   two units. "Over time" is not: an assignment has no period or history and there is no acting manager. The
   utvecklingssamtal planner still reads its team from the calendar's persona fixture, not from the assignments.

Still open: the questions above about who a talk record belongs to and what HR sees, what Sundsvall uses today, and
the legal answers per domain.

## Sources and limits

- The reference product: its homepage and its pages for medarbetarsamtal, medarbetarundersökningar, integrations,
  pricing and customers were read on 2026-11-10. The other thirteen features are described from the homepage's taglines only.
  All claims are the vendor's own.
- What municipalities have and lack for each feature is an assumption drawn from the personas and the vision, not a
  survey. Sundsvall's actual tools for medarbetarsamtal, onboarding and the annual plan should be confirmed before
  the first decision.
- The legal points (public documents, secrecy, archive rules) are named as questions, not answered.
- Code references were checked against the working tree at `97e5f28`.
