# D108 · Competence is an owned domain: one holding for competences and certificates, typed against a catalogue

**Status:** proposed, and built against the freeze on new surface: [D101](D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md) (the first real integration) item 4 allows no new owned domain, administration page or rail destination until its loop works, and this record is all three. It was begun on a branch cut before that freeze reached `main`, continued in the same working session after the freeze was pointed out, and brought into `main` on 2026-11-11 on that session's instruction, with the question whether it may pass the freeze asked and not answered by the product owner. The module is switched off until an administrator enables it. The product owner lifted the freeze on 2026-11-12, so it stays on `main`. The direction below was set in that working session on 2026-11-11 and is not yet confirmed by the product owner (decided in the session: a core module shipped with Clew and switched on per installation, competences and certificates in it, a position on the person, the catalogue with the main administrator, search for HR and staffing, a person's own registration approved by their manager, erasure a period after deactivation, the matrix as a page of its own, a review by an HR practitioner before real data); the items marked "proposed" are the author's and were not discussed, the items under "Open" are not decided; built 2026-11-11 on synthetic data: the catalogue with its page, a manager's registration, the computed status, the reads, the figure, the scan, erasure and export (see "As built"); built 2026-11-12, provisional: item 9 from source to status, the installation's read of the holdings profile ([D119](D119-the-installation-reads-as-itself-through-a-read-no-person-can-reach.md)), the copy of what a source holds, its daily read and the mapping of a source's types on Administration › Kompetens › Källor (see the three "As built, 2026-11-12" sections), read end to end in process against the development Moodle but not yet by the running server; positions, requirements, coverage, the matrix, a person's own registration, search and the read log not built; amended by [D120](D120-a-skill-is-a-holding-with-a-level-and-the-competence-domain-covers-what-a-skills-platform-does.md) (2026-11-12, provisional: a skill is a holding with a level, the catalogue can be imported, the Kompetens place in the rail, goals beside talks' action points) and [D121](D121-a-registrar-reads-competence-across-the-organisation-through-a-relation-of-its-own.md) (2026-11-12, provisional: item 8's `competence.search` is a relation of its own, not a capability, and item 15's read log is built with it) · **Date:** 2026-11-11 · **Area:** product, identity, integrations

**Decision.** Competence (Swedish in the product: **Kompetens**) becomes a domain Clew owns under
[D95](D95-clew-may-own-a-domain-by-choice-decided-with-the-core-or-connector-checklist.md): a module
`apps/server/src/modules/competence/` with its own tables. It answers what a person holds, what their position
requires and when it runs out, for the person and for the manager they report to. It is the domain
[D97](D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md) item 10 names as needing its own decision.

1. **One entity.** A competence and a certificate are the same record, a **holding**: a person, a type, the date it
   was issued. A certificate is a holding that has an end date and is attested. Requirements, coverage, share targets
   and reminders treat both alike, so there is one table and not two.
2. **Typed against a catalogue that is data.** A holding always names a row in the catalogue of **competence types**
   (name, area, a kind from a closed list in `@clew/contracts`: `certificate`, `degree`, `course`, `authorisation`,
   and the employer's validity in months, empty when it does not expire). The catalogue is rows per installation,
   never an enumeration in code. A person does not type free text: they choose a type, so the domain has no sealed
   column. A type is archived, not deleted, and two types are merged by a use case that moves holdings, requirements
   and mappings in one transaction.
3. **Two kinds of end date.** Where the issuer set the date it is stored on the holding and never recomputed. Where
   the employer sets the rule the holding stores only the issue date, and the end date is computed from the type when
   read. A change of a type's validity applies to everyone at once; the use case answers how many holdings it turns
   expired before it is confirmed.
4. **Status is computed, never stored.** Valid, expiring within 90 days, expired or missing is worked out when the
   data is read, from the requirements against Clew's own holdings and what the sources answer (item 9). A card or a
   mark is derived from it and goes when a certificate is registered.
5. **A position on the person.** A person has zero or more **positions**, each a code and a label and nothing else.
   They arrive over SCIM as membership of a group whose `externalId` is `position:<code>` (proposed transport), the
   group's display name being the label. `position:` becomes a reserved prefix beside `unit:`, `unit-manager:` and
   `capability:`, written wrong it is refused as
   [D96](D96-a-key-written-wrong-is-refused-at-the-scim-boundary.md) refuses the others. The code is whatever the
   installation's source has: Clew builds in no classification (SKR's AID groups work for statistics and is not
   assumed to be fine enough). A position is tied to the person, not to a placement on a unit.
6. **Requirements.** A requirement names a type and exactly one of a position, a unit or a person (an assignment such
   as fire-safety representative is not a position). A person with two positions is under both sets. A **share
   target** names a type, a position as the denominator and a least share, for a unit or the whole organisation.
7. **Who registers.** The manager a person reports to
   ([D99](D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md) item 4) registers
   a certificate with its date; the server computes the validity. A person may register their own holding: it is
   stored as pending, counts towards nothing, and its approval is a work item in that manager's stream, closed in the
   same transaction as the decision. No file is attached: storing the certificate itself would make Clew a document
   store.
8. **Who reads.** A person reads their own. A manager reads their reports (D99 item 4); coverage for a unit, which
   names nobody, may be counted over the branch (D99 item 5), while the list behind it stays the reports. Two new
   names in the closed list `CAPABILITIES`: `admin.competence` (the catalogue, requirements, share targets and source
   mappings; the main administrator's group until HR takes it) and `competence.search` (who holds a type across the
   organisation; HR and staffing). Each comes with the check that enforces it (D85).
9. **What a source holds is copied in as a cache** (working session, 2026-11-11). Course completions stay in the
   learning platform and licences with the register that issues them; the source remains the authority. A connector
   to such a system declares a reserved profile read, `<id>.holdings`: it answers the holdings it has, each with the
   person's key, its own type id and row id, the issue date and the end date. Clew reads every answering source on a
   schedule and stores each row in `competence_holding` with the connector's id, the source's row id and the time it
   was read, unique on the connector and the row id so a read can be repeated. A copied row holds a person, a type
   and two dates, never a name, free text or a document; it cannot be changed in Clew; a source that withdraws a row
   marks it revoked; and every row of a connector goes when the connector is removed. A source's type id is mapped to
   the catalogue through a table an administrator keeps; a row with no mapping is kept under the source's own label
   and counts towards nothing until it is mapped. Where several holdings of one type exist for a person, the valid
   one that ends last decides the status. The time of the last read shows wherever copied rows are counted.
   `connectors/` gets a fixture that proves the profile. Amended 2026-11-12 by
   [D119](D119-the-installation-reads-as-itself-through-a-read-no-person-can-reach.md): `<id>.holdings` is a read the
   installation makes itself, declared under the manifest's `installation` and reachable by no person's path; it takes
   a cursor, not a person's key, and answers a page of every account the source has, each row keyed by the value of
   the source's match field, with `next` and `withdrawalsReported`. The shape is the protocol's (`HoldingsOutput`), and
   the core reads it through the port `HoldingsReader`.
   *Settled as built (2026-11-12, provisional):* every source
   is read once a day at 04:00 Swedish time and when an administrator presses "Läs in nu", never two runs of one
   source at once. A page the source does not answer is asked again twice after a pause, and a cursor the source no
   longer knows starts the sweep again from the first page once; a source still silent, refusing or answering outside
   the profile ends the read, which keeps what it read, and is read at the next run. So does a write the database
   refuses: nothing changes, and the read is recorded as failed. One source's failure never keeps a run from the
   others. A key is matched to an active person by user name without regard to case, and one that matches nobody is
   counted and never stored. A string a database column cannot hold (a control character, half a surrogate pair) or a
   day the calendar lacks costs that one holding: an id or a type with one is unusable, a label is cleaned. A source
   that says it reports withdrawals has a row revoked for absence only after a complete read; one that does not, or
   a read that failed or was marked partial, never revokes anything. The mapping is per organisation, since a
   catalogue type is. "Wherever copied rows are counted" is read as wherever one is listed: every row of a copied
   holding shows its source and when it was read, and the Källor page shows each source's last read and how it went;
   the counts (a person's row on Personal, the figure, the cards) do not, and no row is hidden for its age.
   *Audiences (working session, 2026-11-12, following D23; not confirmed by the product owner):* the session's
   coordinator decided that a copied row is kept only for a person who is active, has access, and is inside both the
   source connector's audience and the competence module's own, as they stand when the row is read. That the rows of
   anyone else are deleted at each read, not hidden, was the implementer's choice in the same session: a copy is a
   cache, the source keeps the holding, deletion is the simpler promise to the person outside, and a person who comes
   back into both audiences is copied again at the next read. Applying it to a person the directory deactivates
   followed from that choice, and departs from item 14 (see there); whether it stands is asked of the product owner
   ([open questions](../maintainers/open-questions.md)). Källor shows a source, with
   its counts for the administrator's own organisation, only to an organisation that has someone inside both; the
   keys that matched nobody belong to no organisation and are shown to each. "Läs in nu" reads the whole source, for
   every organisation, as the daily run does.
10. **Identifying a person to a source.** Clew sends the public key D97 item 8 names and never a national identity
    number, which Clew does not hold. A source keyed on something else (ID06 on a personal identity number) resolves
    it inside its own connector, through a small published contract `resolve(people, scheme)` with the scheme as a
    name (`se.personnummer`, `hsa-id`), an HTTP adapter and a file adapter, chosen by the connector's configuration.
    An installation's own lookup service is one implementation of that contract and lives outside this repository.
    The connector stores no resolved identifier after the call and logs none.
11. **Where it shows.** Through D97 as it is built and nothing written into Personal: the module declares a read about
    a person, which Clew draws as a section when the person is opened and, where an administrator chooses it, as a
    lens and a column on Personal, with a mark where the status warns. The section's page is the registration form.
    The matrix of people against requirements is a first-party Astryx page (working session, 2026-11-11), at most ten
    columns at a time with a choice of area or position beyond that; a certificate is registered from a cell, so it is
    a page where a person writes (D95 item 4).
12. **Follow-up.** What needs a person becomes a card in the stream of the employee and of the manager they report to,
    from a scan of the module, as the HR fixture's delegation renewal does today for the person alone.
13. **Switching it on.** The built-in connector (id `competence`, kind `core`, bundled) is switched on and off by an
    administrator on Anslutna system, as talks is (D96 talks item 9). Off, nothing of the domain shows.
14. **Leaving.** When SCIM deactivates a person (D68: never erased) their holdings leave every view at once. They are
    erased after a period the operator sets, by a durable timer that a reactivation cancels, so a truncated export
    from the source cannot empty the register. Erasure of one person and export of the domain (`clew.competence/1`)
    are use cases with scenario tests from the first slice (D95 item 7). *Exception, as built 2026-11-12 (working
    session, not confirmed by the product owner):* rows copied from a source (item 9) are a cache, and go at the next
    read after their person is deactivated or leaves an audience; the period applies to holdings registered in Clew
    alone. The consequence: a provisioner fault that deactivates many people before the daily read deletes their
    copied rows, and they come back at a later read only if the source still holds them, as new rows with new ids and
    creation dates (the source's own row ids, days and labels, so the statuses come back as they were). A manager's
    attestation is not touched.
15. **A read is recorded (proposed).** Opening one person's competence, a search across the organisation and an
    export each write a row saying who read whom and when, with no name and no content. Unit coverage writes one row
    per unit.

**Outside this decision.** Professionsprogrammet (higher-education credits per category and a level computed from an
ordinance, decided by Skolverket): a regulated calculation and one sector's, so a connector if it is built. A plan
drafted by the model from a talk: D95 item 7 keeps free text from an owned domain away from a model endpoint, and the
plan's activities are action points in talks (D96 talks item 4), not a second copy here. A skills mapping of what is
not a course or a certificate.

**The tables (proposed).**

| Table | Holds | Written by |
|---|---|---|
| `auth_position` | `organisation_id`, `code`, `label` | The SCIM use cases only |
| `auth_person_position` | `person_id`, `position_id` | The SCIM use cases only |
| `competence_type` | `name`, `area`, `kind`, `validity_months`, `archived_at`, `merged_into` | `admin.competence` |
| `competence_source_mapping` | connector id, organisation, the source's type id, `type_id`, who mapped it and when (built 2026-11-12) | `admin.competence` |
| `competence_source` | per connector: the read under way as a lease, and the last read's start, end, outcome and counts (built 2026-11-12) | The scheduled read of a source |
| `competence_holding` | `person_id`, `type_id` (empty while a source's type is unmapped), `issued_on`, `expires_on` (issuer's date only), `evidence` (`system`, `manager`, `self`), `state` (`pending`, `valid`, `rejected`, `revoked`), who registered and decided, the approval's thread; for a copied row the connector's id, the source's row id, type id and label, and when it was read (the copy's columns built 2026-11-12) | A manager; the person, pending; the scheduled read of a source |
| `competence_requirement` | `type_id` and one of `position_id`, `unit_id`, `person_id` | `admin.competence`; a manager for one person |
| `competence_share_target` | `type_id`, `position_id`, `unit_id` or none, `min_share` | `admin.competence` |

**The checklist.** [Core or connector](../maintainers/core-or-connector.md), answered as it stands. Part 1: none
apply. Part 2: the learning platform's courses, the issuing registers and professionsprogrammet are kept out by items
9 and "Outside"; positions are received, not issued.

| Question | Answer |
|---|---|
| 1. It removes something | The spreadsheets and paper files managers keep. The proof of concept at start.sundsvall.dev says the municipality has had no shared support since its HR system's competence module was retired; not checked at a second organisation |
| 2. The same everywhere | Yes for the catalogue, requirements and holdings, which differ as data. Professionsprogrammet is not, and is outside |
| 3. Work between people who use Clew | In part. Registering, approving a person's own registration and renewing before an end date are work items. The holding itself is a fact about a person, which the [review of 2026-11-10](../reviews/2026-11-10-owned-domains-against-a-commercial-hr-system.md) placed with connectors; see "Replaces" |
| 4. It is small | Not shown. It adds requirement and coverage, which no other candidate has asked for yet, and a combined read over sources |
| 5. Works with the model off | Yes. Nothing in the domain uses the model |
| 6. Clew can carry it | Partly: item 14. A copied row goes with the person on erasure and with its connector when the connector is removed (2026-11-12). The length of the period, export to the archive, the secrecy rule and what a new manager may read of earlier holdings are not answered |
| 7. Everything that reads it today still can | Not checked. No fact is declared until something follows one |
| 8. A way in and a way out | The way out is item 14's export, `clew.competence/2` since 2026-11-12 with copied rows and mappings. The ways in are a manager's registration and, since 2026-11-12, the copy from a system that answers the profile of item 9; an import of the spreadsheets is not designed |
| 9. Behind capabilities | Yes: reads as capabilities with declared views, the profile of item 9; the mapping and "Läs in nu" behind `admin.competence` and its step-up (2026-11-12) |
| 10. An installation can choose | Yes: item 13, and a system that already holds competences answers the profile |
| 11. Reviewed by someone who knows the domain | No. An HR practitioner is to read it before real data (agreed in the session, 2026-11-11) |
| 12. The team accepts being its vendor | Taken from the session's word that it ships with Clew; not asked in those terms, and not asked of the product owner |

Questions 3 and 4 are not a plain yes, and the checklist says one no means connector. The working session of 2026-11-11 decided core
knowing this ("it is so important for the manager's view that it should be a core part of the system").
This record does not change the checklist; whether question 3 should read differently for a register a manager works
from is under "Open".

**Why.** The session began with the question whether Clew has competences per employee in a manager's view. It does not: the
proof of concept has a Kompetens module on invented data held in memory, and Clew has persona use case UC-KIM-4 and
an expiring delegation shown to the person alone. One entity, because every function that reads holdings treats a
certificate and a competence alike. A catalogue, because coverage and "the same thing from two sources" need a
shared key and free text gives neither. Positions, because a requirement has to say who must hold something, and
`Role` says only manager or employee: "everyone on the unit" marks a park worker as lacking a machine operator's
certificate. A list, because a person can hold two part-time positions.

**Alternatives.** A separate service with its own database behind a connector: the author's first recommendation,
turned down in the session, and by D95 and the review
[one entity, many sources](../reviews/2026-11-10-one-entity-many-sources.md) for an owned domain (no editing
surface, no shared transaction with cards and audit, a second database to erase and back up). Two entities, one for
competences and one for certificates: two of every read. Untyped holdings: nothing to count. SCIM's `title` on the
user: one value per person. A requirement profile assigned by a manager in place of a position: turned down in the
session, which wants the position on the person. Reading sources live and storing nothing, which is D97's
direction and what this record first said: the daily scan, search across the organisation, coverage, share targets
and the matrix each need every person's holdings from every source, so a live read is a full fetch thrown away, a
source that is down makes "missing" indistinguishable from "unknown", and search would push a query to each source.
The session chose the copy on 2026-11-11. Erasing with the SCIM delete: an export cut short would empty the register,
and a manager's attestation exists nowhere else.

**Open.**
- Item 9's schedule and staleness, answered provisionally on 2026-11-12 (item 9, "Settled as built"): once a day and
  by hand, every copied row listed with the time it was read, nothing hidden for age. Still open: whether a person's
  row on Personal, the figure and the cards should say how old the copy behind their counts is, and whether a source
  not read for days should be marked. The shape is settled by D119 (a page of every account at a time, read as the
  installation); the learning platform answers it ("As built, 2026-11-12: the installation's read"); ID06's interface
  has not been read.
- The key on the wire for item 10, `externalId` or `userName` (D97, open), and which way ID06 is read; its interface
  has not been read.
- Settled 2026-11-13 for competence: a deactivation reaches the domain through the people module's `leavers` port,
  inside the provisioning transaction. Talks has the same need, does not use the port, and is erased by an
  operator's script today.
- Whether erasure should also reach the audit rows. `competence.holding_registered`, `holding_submitted`,
  `skill_rated` and `skill_validated` record the type, the dates and the level beside the person's id, the person
  stays in the directory (D68), and so the audit log still tells what the erased register told.
- Who approves a registration from a person who reports to nobody, and what a manager sees when a person moves to
  them: every holding, or those registered since.
- Whether a position should follow a placement, for a person who is a machine operator on one unit and an
  administrator on another. Tied to the person, both units list them under both sets of requirements.
- A scheduled read carries no delegated token ([status](../reference/status.md)), and the installation's read (D119)
  has no person at all, so a source that reads as the person cannot be copied; whether such a source is left out or
  shown live in the person's section only.
- Whether checklist question 3 is amended for a register a manager works from, or this stays a recorded exception.
- The import of existing spreadsheets, and how such rows are attested afterwards.

**Not established.** Nothing is measured, and nothing was seen signed in. The Astryx component for the matrix has not
been looked up. The audit table has not been read for item 15. No HR practitioner has seen it. What positions a real
source can deliver, and under which code, is not known.

**Order (proposed).** First: the catalogue, a manager's registration, computed status, the scan and its cards,
erasure and export; it needs no position and no source. Second: positions over SCIM, requirements, coverage and the
matrix. Third: the `holdings` profile, its fixture and the mapping. Fourth: a person's own registration and
`competence.search`. Real data waits for questions 6 and 11.

**As built.** 2026-11-11, branch `competence-module`, merged with `main` the same day: the first slice of "Order" and
the two pages a person writes on.

*Server.* Migration `0049_competence`: `competence_type` and `competence_holding`, the holding without the columns of
a copied row or an approval, which come with their slices; `merged_into` likewise. `@clew/contracts`: the kinds,
statuses and evidence as closed lists, the type and holding rows, the bodies, and `admin.competence` in
`CAPABILITIES`. `modules/competence`: `domain.ts` (the end date, the status on a day, which of several holdings
decides, months added on the calendar), `usecases.ts` (the catalogue behind the capability and the step-up,
`validityImpact` before a change of validity, a manager's registration and revocation for their reports, the reads,
erasure, export), a memory and a Postgres adapter under `tests/competence-store-contract.ts`, and `capabilities.ts`,
the bundled connector. Routes under `/api/competence` (`routes/competence.ts`), refused while the connector is off for
the person. The connector's row is created disabled (`offAtFirstBoot` in `connectors/reconcile.ts`, the one platform
change), so item 13 holds from the first boot. `scripts/competence-seed.ts` (called by the development chain),
`competence-export.ts` and `competence-erase.ts`. The development directory's administrator has `admin.competence`.

*The reads.* `competence.attention` (what has run out or soon will among a manager's reports) and
`competence.holdings` (one person's), both with declared views; and `competence.person`, a read about a person as
[D97](D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md) is built: asked with a batch of user names
it answers one row per person who reports to the reader, with the status in a word ("Utgånget", "Går ut snart",
"Giltigt", "Inget registrerat"), how many have run out or soon will, and how many are registered. A person who holds
nothing has a row too, since their section is where a first certificate is registered from. Only what has run out or
soon will has a tone, so only that can be a mark. Its declared page is `/staff?register={id}`. An area with a figure
on Hem, and a scan: a person gets a card per holding of their own that has run out or soon will, a manager one card
that counts and names nobody, since a card's text is what the assistant reads.

*Registrera intyg* (item 7): `apps/web/src/components/register-holding.tsx`, a dialog over Personal at
`/staff?register=<personId>`, mounted beside the talk drawer and reading its own data only when the address names
someone. The competence from the catalogue grouped by area, the day it was issued and, optionally, the day it ends,
with the employer's rule said where the end date is asked for. The date fields take any day and the form says what is
wrong on the field: a field that refused a day dropped what was typed without a word, and the certificate was then
registered without the end date the person meant. With the module off, a deactivated person or nobody named, the
address opens nothing.

*The catalogue's page* (items 2, 3 and 8): Administration › Kompetens, `/admin/competence`
(`apps/web/src/pages/admin/competence.tsx`), a row in the rail for every administrator; the server refuses it without
`admin.competence` and while the module is off, and the page then says which and links to Anslutna system. A type is
added and changed in a dialog over the list (`?type=new`, `?type=<id>`). A changed validity is not saved at the first
press: the page asks `validityImpact` and says how many holdings are counted from the rule and how many the change
turns expired, and the second press saves. Archiving is asked for twice, since there is no way back. `NumberInput` is
exported from `@clew/ui` for it.

*What was thrown away.* The branch first built its own half of D97 (a composite `clew.about`, a mark column and a
panel on Personal, a menu per person). `main` had built D97 whole in the meantime, keyed on the user name where the
branch sent Clew's person id, so that half was removed in the merge and the module declares itself to `main`'s.

Tests: `tests/unit/competence.test.ts` (the dates, every mutation with its audit row, that no audit row or manager's
card carries a name, a former manager's reach, the reads, the connector and its read about a person through the
registry), `tests/unit/competence-registry.test.ts` (the row created disabled and what that hides, the routes and
their refusals), the store contract on memory and on Postgres, and two browser specs,
`tests/a11y/register-holding.spec.ts` and `tests/a11y/admin-competence.spec.ts` (keyboard, axe and reflow at desktop,
phone and 320 px).

**Not done.** Seen signed in on the development stack. A manual pass with a screen reader. The Kompetens section on
an opened person has no browser spec of its own: the specs open the form by its address. Merging two types (no
`merged_into`), bringing an archived type back, and revoking a holding from the product (the route exists). The
erasure timer of item 14: an operator runs the script. The read log of item 15. Positions, requirements, coverage,
share targets, the matrix, a person's own registration and `competence.search`. Of the third step of "Order", the
fixture item 9 asks for under `connectors/`, and a copy made by the running server against a real system.

**As built, 2026-11-12: a first source for the holdings profile.** `connectors/moodle` answers `moodle.holdings` from
Moodle LMS, the learning platform the development stack now runs, read through its web service API as one service
account: for the keys asked (user names, at most 25), one row per person the platform knows, carrying the key and every
holding of that person, each with the source's row id (`course:<id>:user:<id>`, `badge:<id>:user:<id>`), its type id
(a course's `idnumber`, else `course:<id>`; `badge:<id>`), the type's label, its kind (`course` or `badge`), the day
issued and, for a badge that has one, the day it ends. A person the platform does not know is no row and a person who
holds nothing a row without holdings, so item 9's copy can tell "holds nothing" from "unknown", the concern under
"Alternatives". It cannot tell "withdrawn" from "not seen": Moodle leaves out ended enrolments, courses the service
account cannot enter, badges the holder keeps private and, when switched off, course badges, all without a word. So
the answer says `withdrawalsReported: false`, and item 9's "a source that withdraws a row marks it revoked" cannot be
applied to this source: a holding missing from a later read must not be revoked. A row marked `partial` says only that
something of that person was refused or could not be dated in this answer; a row without it is not thereby complete.
What reading Moodle showed for the open questions: it answers a batch of people, not everyone at once; a completion's
day costs one call per person and course; and only a badge has an end date. On protocol 3
([D117](D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md)) the connector
answers only the keys Clew vouches for as `self` or `managed`, and the profile's `keys` list is something protocol 3
cannot declare on a read that is not about a person, so through Clew `moodle.holdings` is sent no relation and answers
no row. D117 places item 9's copy as a read the installation makes with no actor and no key in its input, which this
read is not: the copy would need a read without keys that answers every holding, and a way for the connector to know
the call is the installation's own, which protocol 3 does not give. The shape is the connector's own: the protocol does
not list the profile, and nothing in Clew copies it yet. Item 9's schedule, store and type mapping, and the fixture item
9 asks for, are still not built. (The installation's read, the schedule, the store and the mapping were built the
same day: see the next two sections.)

**As built, 2026-11-12: the installation's read.** [D119](D119-the-installation-reads-as-itself-through-a-read-no-person-can-reach.md)
settles what the paragraph above left open. A connector declares `<id>.holdings` under the manifest's `installation`;
Clew posts it to `/clew/installation/{name}` with an assertion that carries no actor and is bound to the request, and
no person's path reaches it. The profile is the protocol's: `{ cursor? }` in, a page of rows
`{ key, holdings: [{ id, type, label, kind, issuedOn, expiresOn? }], partial? }` out, with `next` and
`withdrawalsReported`, checked when a manifest is loaded and on every answer. The core reads it through
`HoldingsReader` (`holdingsSources()`, `readHoldings(connectorId, cursor?)`), bound to the registry as
`holdingsReader` in `apps/server/src/connectors/registry.ts`. `connectors/moodle` answers it: every account the
service account can see, 25 to a page in Moodle's id order, listed through `core_enrol_get_enrolled_users` on the
front page (which needs `moodle/site:viewparticipants`), each with its dated completed courses and its badges,
suspended accounts included and Moodle's guest account left out, `withdrawalsReported: false`. Read in process
against the development Moodle: 16 accounts, one page, 50 holdings, no partial row, 81 Moodle calls, 0.4 to 0.7 s. What reading Moodle showed for "Open": it can answer
everyone, a page at a time, but a completion's day still costs one call per person and course. The copy into the
register (its schedule, store and type mapping) is the next section; the fixture item 9 asks
for is still not built (the Moodle stand-in answers the profile in the unit suite).

**As built, 2026-11-12: the copy and the mapping (item 9, the register's side).** What a source holds is copied into
`competence_holding` and an administrator maps the source's types to the catalogue. Built beside the installation's
read and joined to it the same day; run end to end in process (below), not yet by the running server.

*Server.* Migration `0055_competence_sources`: the copy's columns on `competence_holding` (`connector_id`,
`source_id`, `source_type`, `source_label`, `read_at`; `type_id` may be empty only on a copied row, a copied row has
evidence `system` and no `registered_by`, checked by the table), unique on the connector and the source's row id;
`competence_source_mapping` (connector, organisation, source type, catalogue type, who and when; its primary key named
`competence_source_mapping_pk`, since the name Postgres would make is longer than its 63 characters); and
`competence_source`, a row per source with the read under way as a lease and the last read's outcome and counts, the
whole read's and each organisation's (`{ unmatched, total, organisations }` in its `counts`). All
three refer to the connector's row with `ON DELETE CASCADE`, so removing a connector on Anslutna system takes what it
put in the register in the same transaction; `scripts/competence-forget-source.ts` does the same, audited, for a
connector that stays. The module declares the source as a port (`HoldingsPort` in `model.ts`: whether the module is
on, the sources that answer the profile, one page of one, in the profile's own types from `@clew/contracts`), which
`composition/index.ts` binds to the registry's `holdingsReader` (D119); the module imports no connector code and
reads a failure's kind from its `code`. The copy (`copySource` in `usecases.ts`, `planCopy` in `domain.ts`) takes a
lease on the source and reads it page by page to the end, renewing the lease after each page. The lease is taken
through `openSource`, which writes the source's row when it has none before locking it, so two first runs of a source
wait for each other and only one reads (2026-11-13); whether the module is on
is asked again for each source. Each page is taken in as it comes: its new keys are matched to active people by user
name, and what a key that matches nobody holds is counted and dropped there, and so is what a person outside the
audiences holds (`HoldingsPort.admitted`, which composition answers with the registry's own `inAudience` over
`readAudienceFacts` in `@clew/db/auth`). The read holds only the usable holdings of people it may keep rows for and the
source's row ids. A key, an id or a type with a control character or a lone surrogate, which Postgres would refuse or
which names nothing reliably, is unusable; a label has them taken out. A person is one row of a read: a key a second
row answers for, in any spelling and on any page, is nobody's, nothing of either row is kept, their holdings count as
unusable (`ambiguous` in the audit row), and what the person already has from the source is left as it is (2026-11-13;
a source cannot always tell that two of its accounts differ only in case, and Clew compares keys without it).
A failure is handled by its kind: `unavailable` asks the same page again after 5 and 30 seconds, `invalid` (a cursor
the source no longer knows) starts the sweep again from the first page once, and `not-found`, `denied`, `unknown`, a
second `invalid`, a third `unavailable`, a cancelled run, a cursor that comes back, ten thousand pages or more than
200 000 holdings end the read. A read that ends so keeps what it read, revokes nothing and is recorded as `failed`
with the kind; the next run reads the source again. Then everything is written in one transaction with one audit row,
`competence.source_read`, which carries the run, the outcome (`complete`, `partial`, `failed`), the failure's kind and
the whole read's counts (read, stored, unchanged, keys that matched nobody, unusable, types not mapped, revoked, people
outside an audience, rows removed), never a name, a key or a label. The transaction locks the source's row first, as a
mapping, an erasure (`erasePerson`, the row of every source in one order, whether the person has rows from it yet or
not, so an erasure also waits for the write of a person's very first copied row; 2026-11-13) and forgetting a
source do, so two writers wait for each other and never deadlock; it checks again that each person it writes for is
still active, and deletes the rows of anyone no longer admitted. Removing the connector takes the same order: a copied
row refers to its source's row in `competence_source` (`competence_holding_source_fk`), not to the connector's, so the
cascade from the connector's row deletes the source's row first, waiting for a write that holds it, and only then the
copied rows; a write that comes after finds the row gone and writes nothing. (Built first with the copied rows
referring to the connector, a removal held the connector's row and waited for the source's row, while the write held
the source's row and, inserting a copied row, waited to check it against the connector's: Postgres broke the deadlock
by aborting one of the two (40P01), and the administrator's removal, when it was the one, answered 503 "Något gick fel.
Försök igen." from the routes' catch-all. A mapping still refers to the connector, so a removal and a mapping saved at
the same moment can still meet that way, with the same answer.) A write that fails (a value the database refuses, the database itself) changes nothing, is recorded as
`failed` with the kind `storage` and lets go of the source. Logs carry kinds, counts and the database's error code,
never an error's text. Erasure is only for a person the directory has deactivated: the use case and
`scripts/competence-erase.ts` refuse an active person (`PersonStillActive`), whose rows the next read would copy back. A source's `kind` (`badge` among them) is not
kept: the catalogue type, and with it the kind, comes from a mapping. A repeated read changes nothing but `read_at`. The end date is the source's where it gives one; else the catalogue
type's rule computes it when read, as for a registered holding. Mapping or unmapping (`competence.source_mapped`,
`competence.source_unmapped`) re-types the copied rows of that organisation in the same transaction. A manager
cannot revoke a copied row. Erasure takes a person's copied rows; the export is `clew.competence/2` (a holding may
have no type and carries `copy`, and the document lists the mappings), a version because `typeId` may now be empty.

*Scheduling.* `competenceCopy` in `dbos/workflows.ts`, started inside the transaction that asks for it (D86): the
daily run `competence-copy:<day>` at 04:00 Swedish time, asked for at boot and by each daily run before it reads, and
"Läs in nu" `competence-read:<run>` for one source, audited as `competence.read_requested`. One step per source,
without the one-minute step timeout (the engine would start a second attempt beside a slow one); the lease keeps two
runs off one source, and a run the engine recovers after a restart takes its own lease again and reads from the start.
Each page has the read's own deadline and cancelling the workflow aborts the page under way through the step's signal,
so a read always ends without a step timeout. A source whose step still fails after its retries is left for the next
run and the others are read; a daily run whose step that asks for the next day fails still reads, and the server asks
for the next daily run at boot and every hour after (`startCompetenceCopy`), so the chain heals within the hour, and
also after a day on which no instance ran.
`scripts/competence-read.ts` asks for a run and prints each source's counts.

*The reads.* A mapped copied row counts exactly as a registered one in `competence.holdings`, `competence.attention`,
`competence.person`, the figure and the scan. A row whose type is not mapped is listed in `competence.holdings` under
the source's label with the status `uncounted` ("räknas inte") and no area or kind, and counts towards nothing. Both
declared views gained the fields `source` ("Källa") and `readAt` ("Inläst", beside it), drawn with the catalogue's
existing formats; no view kind or presentation field was added.

*Källor* (`apps/web/src/pages/admin/competence-sources.tsx`): a page of its own at `/admin/competence/sources`, linked
from the catalogue's page, because a list that can grow is a page with an address
([D116](D116-a-panel-is-a-peek-at-one-thing-a-list-is-a-page-and-every-view-has-an-address.md)) and the
administration's tabs have none. One card per source: its last read and how it went, "Läs in nu", and its types with
how many holdings carry each and the catalogue type it is mapped to or "Inte kopplad". A type is mapped in a dialog
at `?source=<connector>&type=<the source's type id>`, where the mapping is also removed. Behind `admin.competence` and
the module's switch, as the catalogue is. A source is listed, read by hand or mapped only for an organisation that
has someone inside its audience and the module's (`HoldingsPort.reaches`, `organisationInAudiences` in
`@clew/db/auth`); the counts are that organisation's, the outcome and the time the source's, and the keys that matched
nobody every organisation's. A source no longer answering is "Läses inte in", since Anslutna system says "Svarar inte"
of a system it cannot reach.

*Development.* `competence-seed.ts` adds the catalogue types the development learning platform's courses and badge can
be mapped to; `scripts/competence-map.ts --connector <id> --development` maps its seeded course ids, for whatever id
the platform was registered under, and leaves the badge for the page.

*End to end, in process.* `tests/unit/competence-moodle.test.ts` drives the copy on the memory store through Clew's
registry and the installation's signed read against the Moodle connector over its stand-in: 10 accounts, 34 holdings
read, 33 stored, 2 keys matching nobody (accounts with no person in Clew), 3 types not mapped (a course without an
`idnumber` and two badges), and Johan's own list as the statuses follow from the catalogue's rules. The same, run from
the worktree against the development Moodle with the development directory's 250 people and every audience open: first
one page of 17 accounts, outcome `partial` because Moodle marked its guest account's row partial; after the connector
began leaving the guest account out (the product owner's decision) and the review's fixes, run again: one page of 16 accounts, 50 holdings read and
stored for 14 people, 2 keys matching nobody (the administrator and the service account), one type not mapped (the
badge, 3 rows), outcome `complete`, about 0.46 s; read again, 50 unchanged. Johan: Delegering läkemedel expired
2025-10-13, HLR expired 2025-11-08, Brandskydd valid until 2028-12-17, Livsmedelshygien valid with no end, and
HLR-instruktör "räknas inte" until its badge is mapped, then expired 2026-10-08.

Tests: `tests/unit/competence-copy.test.ts` (matching, the repeated read, withdrawals, each failure kind, a restarted
sweep, a cancelled run, the bound of one read, a page in the profile's shape with the platform's own accounts, partial
reads, what a column refuses, a write that fails, the audiences and a person who leaves one, each organisation's
counts, the switch asked per source, the lease, status with copied rows, the mapping, the page's read, "Läs in nu", the
daily schedule across summer time, leaving and the refusal to erase an active person, the routes; no audit row with a
name, a key or a label), `tests/db/postgres-competence-copy.test.ts` (a NUL refused by Postgres and taken in its stride
by the copy, two writers at once in both orders, the audience asked of the database), new cases of the store contract on memory and
Postgres with the connector's removal on Postgres, `apps/server/tests/competence-runtime.test.ts` (a run committed
before the engine launches, the daily run, a source whose step keeps failing beside one that is read and a next day
that cannot be asked for, and an instance killed while it reads whose run is adopted and finishes once under its
lease), and `tests/a11y/admin-competence-sources.spec.ts`.

**As built, 2026-11-13: the rest of the decision, on branch `competence-skills`.** What the "Not done" paragraph
above lists is built, except what this paragraph says is not. A person's positions arrive as `position:` groups
(item 5); requirements on a position, a unit or a person, the status `missing`, coverage and share targets (items 6
and 10); the place Kompetens with the reader's own page and the matrix (item 11); a person's own registration,
approved or rejected by the manager they report to through a work item (item 7); merging two types and bringing an
archived one back (item 2); revoking from the product; erasure after a person leaves (item 14), which happens only when an
operator has set a period, and is an intent per person and an hourly sweep, not a durable timer per person: a
sleeping workflow did not survive a deployment; and the read log (item 15) together with the search across the organisation, which
[D121](D121-a-registrar-reads-competence-across-the-organisation-through-a-relation-of-its-own.md) builds as a
relation and not as the capability `competence.search` that item 8 names. Skills with levels and the catalogue
import are [D120](D120-a-skill-is-a-holding-with-a-level-and-the-competence-domain-covers-what-a-skills-platform-does.md).
What each does, its limits and its tests are in [implementation status](../reference/status/people.md), which is
kept current; this paragraph is not.

Where the build is narrower than the items: a small group is never counted on its own in coverage (fewer than five
is not shown), and the same rule holds for the numbers an administrator sees before a merge; a manager's people are
their direct reports ([D99](D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md)
item 4), not everyone on a unit they lead; item 15's row per unit for coverage is not written, and of a manager's
reads only one report's holdings and the matrix export are logged (D121, "As built"); a person who reports to nobody
cannot send a registration.

Still not done: seen signed in by a person; a manual pass with a screen reader; a review by an HR practitioner; the
length of the retention period, which no installation has set; a copy made by the running server against a real
system; an import of existing holdings from spreadsheets.

**Replaces.** Amends [D68](D68-people-are-pushed-into-clew-through-standard-scim.md) item 2 and
[D96](D96-a-key-written-wrong-is-refused-at-the-scim-boundary.md) (a key written wrong): `position:` is a fourth
reserved prefix. Narrows [D97](D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md) item 9 ("no
employee file: title … read from the system that holds them"): Clew holds a position's code and label, as it holds a
unit's id and name, and nothing else about an employment. Departs from D97's weighed alternative ("Clew keeping a
copy of what sources say about a person: a second record with its own retention, against D95") for this domain
alone, by item 9: the copy is a cache with its source named, erased and exported with the rest. Departs from finding 3 of the
[review of 2026-11-10](../reviews/2026-11-10-owned-domains-against-a-commercial-hr-system.md), which placed
competence and certificates "as a register" with connectors, for the holdings a manager or the person registers in
Clew; what another system is the authority for still comes through connectors. Those records' bodies are left as
they are.
