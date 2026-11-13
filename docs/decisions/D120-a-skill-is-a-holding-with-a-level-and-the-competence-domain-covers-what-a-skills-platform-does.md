# D120 · A skill is a holding with a level, and the competence domain covers what a skills platform does for a public-sector organisation

**Status:** provisional (product owner, 2026-11-12, answered as questions in a working session; nothing outside the repository has tested it; items 1 to 8 built on branch `competence-skills` by 2026-11-13, the later slices of item 9 not; see [implementation status](../reference/status/people.md) for what exists) · **Date:** 2026-11-12 · **Area:** product, identity

**Decision.** The competence domain
([D108](D108-competence-is-an-owned-domain-one-holding-typed-against-a-catalogue.md)) grows to do what a commercial
skills and certification platform does for a public-sector organisation, so that an installation does not need one.
D108's items stand and are built as written; this record adds what D108 placed outside ("a skills mapping of what is
not a course or a certificate") and says what is left out.

1. **A skill is a holding.** `skill` joins the closed list of kinds. A holding of that kind carries a **level**, one
   of three: 1 Grundläggande, 2 Självständig, 3 Expert. It has no end date. Everything that reads holdings (the
   reads, requirements, the matrix, search, erasure, export) treats it as any other holding, so D108 item 1 (one
   entity) holds.
2. **A person rates their own skills.** A person adds a skill from the catalogue with a level. It is stored with
   evidence `self`, listed at once for everyone who may read the person's holdings, and marked "Egen bedömning". It
   opens no work item. The manager the person reports to **validates** it (and may set another level), which is
   audited; only a validated skill meets a requirement. A certificate, degree, course or authorisation that a person
   registers themselves keeps D108 item 7: pending, counting towards nothing and approved through a work item.
3. **Interest.** A person may mark a skill of their own as one they want to develop ("Vill utveckla"). It is shown
   where the skill is listed and counts towards nothing.
4. **A requirement may ask for a level.** A requirement on a type of kind `skill` names a least level. A person
   meets it with a validated holding at or above that level; otherwise the status is `missing`, and the level held
   is shown beside it.
5. **Who reads.** Exactly as for certificates: the person, the manager they report to
   ([D99](D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md) item 4), and
   whoever holds the relation of [D121](D121-a-registrar-reads-competence-across-the-organisation-through-a-relation-of-its-own.md).
   There is no privacy switch per skill.
6. **No file.** D108 item 7 stands: no proof is attached to a holding.
7. **The catalogue can be imported.** An administrator with `admin.competence` uploads a file of types and chooses
   which rows to add and under which area. Two formats are read: Clew's own CSV (`name, area, kind, validityMonths,
   uri`) and the skills CSV of ESCO, the European Commission's classification of skills, recognised by its header. A
   type keeps the `uri` it came with, and an import is idempotent on it. No classification is vendored in the
   repository: the administrator downloads the file from its publisher, and the page prints the acknowledgement
   ESCO's terms ask for (Commission Decision 2011/833/EU). Two types are merged by the use case D108 item 2 names.
8. **Where it shows.** One place in the rail, **Kompetens**, drawn while the module is on: `/competence` (the
   reader's own holdings, what their positions require, and where they add one), `/competence/matrix` (a manager's
   reports against what is required of them, D108 item 11) and `/competence/search` (D121). Each is a page with its
   own address ([D116](D116-a-panel-is-a-peek-at-one-thing-a-list-is-a-page-and-every-view-has-an-address.md)). No
   design canvas has a board for them: they are built on Astryx templates (`table-comparison` for the matrix) and
   shown to the product owner stage by stage.
9. **Later slices, which the earlier ones must not block.**
   - *Position fit and key-person risk*: reads over requirements and holdings. Who is closest to what a position
     requires (a manager over their reports, a registrar across the organisation, a person for themselves), and
     which types only one person on a unit holds.
   - *Development goals*: a person or their manager sets a type, a level and a date to reach it by. The goal closes
     itself when the holding is registered or validated, and shows in the person's talk
     ([D96](D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md)) through a read the
     talks module asks for. This amends D108 "Outside this decision", which left a plan's activities to talks'
     action points alone.
   - *Learning suggestions*: a source may answer which courses it offers and their addresses; where a person lacks
     a type or is about to lose it, the course mapped to that type is shown as a link. A protocol addition, with its
     own decision when it is built.

**Left out, on purpose.** A role builder that drafts a position's requirements with a model. Connectors per HR
system: people, units and positions arrive over SCIM (D68, D108 item 5). Everything such platforms sell to consulting
firms: assembling a team for a client project, availability and utilisation, staffing scenarios, project-tool
integrations, an inventory of CVs, tracking a vendor's partner tiers, importing a profile from a professional
network, and public profiles. A plan or a report drafted by the model: D95 item 7 keeps an owned domain's rows from a
model endpoint, and every competence read stays `model: false`. Import of existing holdings from spreadsheets: still
open in D108.

**Why.** The product owner asked on 2026-11-12 whether Clew could absorb what such a platform does "instead,
eliminating the need for them", then answered the questions this record states, and after seeing the platform's
solution pages said that what targets consulting companies does not apply to the public sector and is skipped. One
entity again, because a requirement, a matrix cell and a search treat a skill as they treat a certificate. Three
levels, because that is what a person can rate consistently and what a matrix cell can show. Shown at once but not
counted, because a self-rating is useful to find people by and weak as evidence. ESCO, because the product owner
prefers European formats (2026-11-12) and it is the classification Europass uses, published in Swedish.

**Alternatives.** A second table for skills: two of every read (D108's own reason against two entities). A
self-rated skill hidden until approved: a work item per skill, and a manager's queue nobody empties. A self-rated
skill that counts at once: a requirement met by assertion. Four or more levels after a European framework: harder to
rate, and no requirement in sight that needs the difference. Free-text skills: nothing to count (D108 item 2). A
vendored copy of a classification: a file to keep current in a repository other organisations build from, for
something its publisher serves in every language.

**Open.** Who validates a skill, or approves a certificate, for a person who reports to nobody: the form says it
cannot be sent, as D108 leaves it. How long a holding is kept after a person is deactivated: the timer is built and starts
only when an operator has set the period, and no length is recommended. Whether the level should have a description per type. Whether an interest mark
should be searchable. D108's checklist question 4 ("it is small") was not a plain yes and is further from one now.

**A gap in Astryx, left open.** On the matrix (item 8), when the table scrolls sideways and a person tabs backwards,
the focused cell's menu button can come to rest under the pinned name column (WCAG 2.4.11, focus not obscured):
measured at 1280 px with the button, 28 px wide, lying 110 to 188 px inside the pinned column. Tabbing forwards is
clear. Astryx's `Table` with `useTableStickyColumns` sets no scroll padding and documents no remedy, and Clew writes
no CSS of its own, so nothing is worked around: the case stands as a `test.fixme` in
`tests/a11y/competence-matrix.spec.ts`. With ten columns or fewer on a wide window the table does not scroll and the
case does not arise; where it does not fit beside the panel or on a phone the matrix is a list. Since 2026-11-13 the cells are
narrow and a matrix holds up to thirty columns, so the table scrolls more often: tabbing backwards through twenty
columns at 1280 px, 8 of 19 stops lie under the pinned column, some wholly. It has to be closed, in Astryx or by a
decision that allows an exception, before the suite's gate returns (D59).

**As built (2026-11-13).** Narrower or other than the items in these places. A person holds a skill once, and
changing its level is an action of its own; removing it revokes the row (item 2). A manager cannot revoke a skill the
person rated themselves. A type that a source is mapped to cannot become a skill or stop being one. The import
(item 7) creates an area that a row names and that does not exist, treats names that differ only in Unicode form or
invisible characters as one, accepts an address that is `http`, `https` or `urn`, and takes 30 000 rows a file and
20 000 types an organisation; ESCO's knowledge concepts would be imported as skills, since its skills file holds
both. A merge between a skill and another kind is refused, and one is not undone.

**Not established.** No HR practitioner has read it. Nothing is measured. No screen reader has passed over any of
the pages. ESCO's CSV has not been read from a real download in this session; the importer is written against its
published column names and must be run on one before the page is called done.

**Replaces.** Amends [D108](D108-competence-is-an-owned-domain-one-holding-typed-against-a-catalogue.md): the kinds
(item 2), "Outside this decision" (skills, and a goal beside talks' action points), and item 8, whose
`competence.search` is replaced by D121's relation. D108's body is left as it is.
