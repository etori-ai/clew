# D101 · Competence is an owned domain: one holding for competences and certificates, typed against a catalogue

**Status:** proposed; the direction below was set in a working session on 2026-11-11 and is not yet confirmed by the product owner, so the record is not accepted until it is (decided in that session: a core module shipped with Clew and switched on per installation, competences and certificates in it, a position on the person, the catalogue with the main administrator, search for HR and staffing, a person's own registration approved by their manager, erasure a period after deactivation, the matrix as a page of its own, a review by an HR practitioner before real data); the items marked "proposed" are the author's and were not discussed, the items under "Open" are not decided; the first slice built 2026-11-11 on synthetic data (the catalogue, a manager's registration, the computed status, two reads, the figure, the scan, erasure and export; see "As built"), the rest not built · **Date:** 2026-11-11 · **Area:** product, identity, integrations

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
   `connectors/` gets a fixture that proves the profile.
10. **Identifying a person to a source.** Clew sends the public key D97 item 8 names and never a national identity
    number, which Clew does not hold. A source keyed on something else (ID06 on a personal identity number) resolves
    it inside its own connector, through a small published contract `resolve(people, scheme)` with the scheme as a
    name (`se.personnummer`, `hsa-id`), an HTTP adapter and a file adapter, chosen by the connector's configuration.
    An installation's own lookup service is one implementation of that contract and lives outside this repository.
    The connector stores no resolved identifier after the call and logs none.
11. **Where it shows.** By D97's four places and nothing written into Personal: a section when a person is opened, a
    mark on the row only where something has run out or is missing, a lens "Att åtgärda" over the list, "Registrera
    intyg" in the person's menu, and coverage per requirement about a unit. The matrix of people against
    requirements is a first-party Astryx page (working session, 2026-11-11), at most ten columns at a time with a
    choice of area or position beyond that; a certificate is registered from a cell, so it is a page where a person
    writes (D95 item 4).
12. **Follow-up.** What needs a person becomes a card in the stream of the employee and of the manager they report to,
    from a scan of the module, as the HR fixture's delegation renewal does today for the person alone.
13. **Switching it on.** The built-in connector (id `competence`, kind `core`, bundled) is switched on and off by an
    administrator on Anslutna system, as talks is (D96 talks item 9). Off, nothing of the domain shows.
14. **Leaving.** When SCIM deactivates a person (D68: never erased) their holdings leave every view at once. They are
    erased after a period the operator sets, by a durable timer that a reactivation cancels, so a truncated export
    from the source cannot empty the register. Erasure of one person and export of the domain (`clew.competence/1`)
    are use cases with scenario tests from the first slice (D95 item 7).
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
| `competence_source_mapping` | connector id, the source's type id, `type_id` | `admin.competence` |
| `competence_holding` | `person_id`, `type_id` (empty while a source's type is unmapped), `issued_on`, `expires_on` (issuer's date only), `evidence` (`system`, `manager`, `self`), `state` (`pending`, `valid`, `rejected`, `revoked`), who registered and decided, the approval's thread; for a copied row the connector's id, the source's row id, type id and label, and when it was read | A manager; the person, pending; the scheduled read of a source |
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
| 6. Clew can carry it | Partly: item 14. The length of the period, export to the archive, the secrecy rule and what a new manager may read of earlier holdings are not answered |
| 7. Everything that reads it today still can | Not checked. No fact is declared until something follows one |
| 8. A way in and a way out | The way out is item 14's export. The way in is empty or an import of the spreadsheets, which is not designed |
| 9. Behind capabilities | Yes: reads as capabilities with declared views, the profile of item 9 |
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
- Item 9's schedule and shape: how often a source is read, whether a source can answer everyone at once or only a
  batch of people, and how old a copied row may be before it is shown as unknown. Neither the learning platform's
  nor ID06's interface has been read.
- The key on the wire for item 10, `externalId` or `userName` (D97, open), and which way ID06 is read; its interface
  has not been read.
- How a deactivation reaches an owned domain to start item 14's timer. Talks has the same need and is erased by an
  operator's script today.
- Who approves a registration from a person who reports to nobody, and what a manager sees when a person moves to
  them: every holding, or those registered since.
- Whether a position should follow a placement, for a person who is a machine operator on one unit and an
  administrator on another. Tied to the person, both units list them under both sets of requirements.
- A scheduled read carries no delegated token ([status](../reference/status.md)), so a source that reads as the
  person cannot be copied; whether such a source is left out or shown live in the person's section only.
- Whether checklist question 3 is amended for a register a manager works from, or this stays a recorded exception.
- The import of existing spreadsheets, and how such rows are attested afterwards.

**Not established.** Nothing is built or measured. The D97 mechanism this shows through (`about`, the section, the
lens, the mark) is itself not built, so the first slice cannot use it. The Astryx component for the matrix has not
been looked up. The audit table has not been read for item 15. No HR practitioner has seen it. What positions a real
source can deliver, and under which code, is not known.

**Order (proposed).** First: the catalogue, a manager's registration, computed status, the scan and its cards,
erasure and export; it needs no position and no source. Second: positions over SCIM, requirements, coverage and the
matrix. Third: the `holdings` profile, its fixture and the mapping. Fourth: a person's own registration and
`competence.search`. Real data waits for questions 6 and 11.

**As built.** 2026-11-11, branch `competence-module`, the first slice of "Order". Migration `0046_competence`:
`competence_type` and `competence_holding`, the holding without the columns of a copied row or an approval, which come
with their slices; `merged_into` likewise. `@clew/contracts`: the kinds, statuses and evidence as closed lists, the
type and holding rows, the bodies, and `admin.competence` in `CAPABILITIES`. `modules/competence`: `domain.ts` (the end
date, the status on a day, which of several holdings decides, months added on the calendar), `usecases.ts` (the
catalogue behind the capability and the step-up, `validityImpact` before a change of validity, a manager's
registration and revocation for their reports, the reads, erasure, export), a memory and a Postgres adapter under
`tests/competence-store-contract.ts`, and `capabilities.ts`, the bundled connector: `competence.attention` and
`competence.holdings` with declared views, the area's figure, and the scan. Routes under `/api/competence`
(`routes/competence.ts`), refused while the connector is off for the person. The connector's row is created disabled
(`offAtFirstBoot` in `connectors/reconcile.ts`, the one platform change), so item 13 holds from the first boot.
`scripts/competence-seed.ts` (called by the development chain), `competence-export.ts` and `competence-erase.ts`. The
development directory's administrator has `admin.competence`.

Three things differ from the items above. Follow-up (item 12) is the connector's scan, as written, but the manager's
card counts and names nobody, since a card's text is what the assistant reads; the rows are the read it opens. The
catalogue has no merge yet. And there is no page: the catalogue and a registration are routes only, so a certificate
could not be registered from the product in the first slice (see "Registrera intyg" below for what was added),
and the reads showed as declared views only.

Tests: `tests/unit/competence.test.ts` (the dates, every mutation with its audit row, that no audit row or manager's
card carries a name, a former manager's reach, the reads, the connector through the registry),
`tests/unit/competence-registry.test.ts` (the row created disabled and what that hides, the routes and their
refusals), the store contract on memory and on Postgres. `bun run check` passed; the Postgres contract was run alone,
not the whole of `bun run test:db`.

Added the same day: `competence.standing`, a read about a person (D97 item 1): for each person asked about whom the
reader may see, the worst status among their holdings and the counts, one row per person, none for a person without
a holding. It answers through `clew.about` (see D97's "As built"), and Personal draws it as a mark on the person's row that
opens their holdings in the panel.

**Registrera intyg**, added the same day (item 7 and the menu of item 11). On Personal, while the module is on for the
manager and the catalogue has a type that is not archived, each person who is not deactivated has a menu of actions
(Astryx `MoreMenu`, "Åtgärder för <name>") with Registrera intyg. It opens a form as a dialog over the list
(`apps/web/src/components/register-holding.tsx`; D83: origin the menu, space a Dialog, parent the list, address
`/staff?register=<personId>`, close back to the list with the focus on the menu): the competence from the catalogue
grouped by area, the day it was issued and, optionally, the day it ends, with the employer's rule said where the end
date is asked for. What is missing is said on its field; the server's sentence is an alert and keeps what was
chosen; on success the dialog closes, the marks and any open view are read again and a toast says it is registered.
The menu is first-party and names the competence module: D97's menu from declared actions is not built, and a write
that stays in Clew is a route, not a capability (D95). Spec: `tests/a11y/register-holding.spec.ts`. Revoking a holding
has a route and no place in the product.

**The catalogue's page**, added the same day (items 2, 3 and 8): Administration › Kompetens, `/admin/competence`
(`apps/web/src/pages/admin/competence.tsx`), a row in the rail for every administrator, as the other sections are; the
server refuses it without `admin.competence` and while the module is off, and the page then says which and links to
Anslutna system. It lists every type, archived ones marked, with area, kind and validity. A type is added and changed
in a dialog over the list (`?type=new`, `?type=<id>`): name, area, kind, and a switch for the employer's rule with the
number of months. A changed validity is not saved at the first press: the page asks `validityImpact` and says how
many holdings are counted from the rule and how many the change turns expired, and the second press saves. Archiving
is asked for twice in the same dialog, since there is no way back. `NumberInput` is exported from `@clew/ui` for it.
Spec: `tests/a11y/admin-competence.spec.ts`. Not there: merging two types, and bringing an archived type back.

**Not done in the slice.** Opened signed in on the development stack: the server was restarted with the module and the
row was created disabled, and nothing more was looked at. A `tests/a11y` spec, since there is no new page. The erasure
timer of item 14: an operator runs the script. The read log of item 15.

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
