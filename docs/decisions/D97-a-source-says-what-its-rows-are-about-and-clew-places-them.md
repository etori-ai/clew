# D97 · A source says what its rows are about, and Clew places them

**Status:** accepted as the direction (product owner, 2026-11-10), built 2026-11-10 (see "As built"); the items under "Open" were taken provisionally for the build and are not decided; item 9 amended by [D110](D110-a-persons-title-is-pushed-as-scims-title-and-kept-apart-from-the-role.md) (2026-11-11, provisional: a person's title is one line Clew holds, pushed as SCIM's `title`; phone and employment facts are still read from their source) · **Date:** 2026-11-10 · **Area:** integrations, ui

**Decision.** A feature that belongs on top of an entity (a person, a unit, later a room) is not written into the
entity's page. Its source, a connector or a module Clew owns, declares what its rows are **about**, and Clew decides
where that shows. Personal stops knowing about utvecklingssamtal.

1. **`about`.** A capability may declare the entity kind its rows concern: a read that takes a batch of keys and
   answers one row per key, or a `propose` or `execute` that takes one. The kinds are a closed list in
   `@clew/contracts`, `person` and `unit` first. A source never says where it shows.
2. **Four places, by what is declared.**

   | What the source declares | Where it shows |
   |---|---|
   | Only an action about a person | The person's menu, nothing else |
   | A read about a person | A section when the person is opened |
   | A field of that read with a `warn` or `alert` tone | A mark on the row, only when it needs the reader |
   | A read worth working through as a list | A lens over the list |

   The view language of D38 draws the lens and the section; a tone already means "the value that needs the person".
3. **Lenses sit under one Visa menu on the list, not as tabs.** A source gets no standing place on the page by
   declaring something. The product owner chose this over a tab per source on 2026-11-10.
4. **"Alla" has a few columns chosen by an administrator**, two or three, beside the marks, as an administrator
   chooses menu tools (D40). Enabling a source does not place it.
5. **The opened entity.** A person opens in the panel from a list (D83) and can be opened as a page. The first
   section is "Behöver dig", the cards about that person; then one section per source, each named with its source,
   each with a way into the source's fuller view. A source that does not answer says so in its own section and the
   rest stand.
6. **References.** A row that names a person, a unit or a room links to it. Card rows, search hits and view fields
   get an optional typed subject for this.
7. **The call.** Clew sends the keys of entities the reader may already see, at most 200. A row carries the key it
   was asked with; a key out of the caller's scope is answered as no row, never as a refusal. The read runs as a
   figure does under D75: current authority, a budget, cancellation, nothing stored. A read about a person is not
   offered to the model unless a later decision says so.
8. **What the core changes.** The caller and the people asked about are identified to a connector by a public key
   in the signed call; card rows carry a subject and Clew keeps an index from entity to cards; "who may be asked
   about" is a core rule per entity kind; the hard-wired talk columns and overlay wiring in
   `apps/web/src/pages/staff.tsx` go, while the reserved talks reads stay for the planner.
9. **Ownership.** Clew owns which entity a row is about, not more records. People and units are Clew's already
   (D62, D68). A room, a case or a document stays in its connector; reaching them waits until one connector per
   kind is named the provider of the key and a second real source needs it. No employee file: title, phone and
   employment facts are a section read from the system that holds them.
10. **A feature that persists its own entities** is a core module under D95, not a connector with its own
    database, where it passes the checklist; what another system is the authority for comes in through connectors.
    Competence tracking is the worked example in the review and needs its own decision.

**Open.** Not decided by this record:

- Whether the columns on "Alla" are pulled live from the chosen sources, as drawn, or the list shows marks only.
- The key on the wire: `externalId`, which is stable, or `userName`, which D96 chose and which can be renamed.
- A person's key on card rows against principle 7 ("names of individuals stay in the source system") and erasure.
- Whether a talk's summary text and employment facts may show on the person's page.
- One general mechanism for search, errands, the talk seam and `about` now, or after a second `about` source.
- Whether a list with columns from two sources, as an assistant's answer, stays inside "not a federated query
  engine". It does only if limited to one page of Clew's own people with nothing pushed to a source.

**Why.** The product owner, 2026-11-10, looking at Personal: "We need to really think this through, and not add
'Samtal' button in a column like this", and then "it's not just about talks, it's about every entity and connection
in Clew". The exploration
[one entity, many sources](../reviews/2026-11-10-one-entity-many-sources.md) read six HR products, six plugin
platforms and three open standards. None of the HR products wires a feature button into its staff list; a feature
gets its own coverage list, the person page has a section per domain, and actions sit in one menu. The platforms
separate enabling from placing and never call every plugin for every list row. The standards give the call: a
batched lookup by a public key, where a missing row stands for both "none" and "not allowed".

The proof of concept at start.sundsvall.dev agrees on the list without buttons, the feature's own list, the person
as sections and the unit as an entity, and it moved three things: columns for everyone on "Alla", the cards about a
person first on their page, and the person as a page. The core carries the pattern without a redesign: the
fan-out under a budget exists three times by hand (`modules/search`, `modules/errands`, `modules/talk-seam`), the
figure batch has the rules a list read needs, and actions are unchanged.

Alternatives weighed. A column and a button per feature on the entity's page, as Personal has: every source edits
the page. A tab per source: gives each source the same prominence, which the product owner turned down. A source
that chooses its own place: no platform that was read allows it, and it is what makes a page crowded. Marks from
every source on every row, pulled live: no platform does it; the list keeps a few chosen sources instead. Clew
keeping a copy of what sources say about a person: a second record with its own retention, against D95.

**As built, 2026-11-10.** Built the same day on branch `entity-sources`. Design: `docs/architecture/entities.md`.
Where the code settled something the items above left open, or differs from them:

- Item 1: `about` is `{ entity, param? }` on a capability, the kinds the closed list `ENTITY_KINDS` in
  `@clew/contracts`. The loader holds a read about an entity to an input with required `keys` (at most 200), rows
  that each carry `key`, a `table` or `list` view and no model tool; an action names the input property that takes
  the key, and that property is its only required input, so the menu can always start it. A core connector may add
  `about.page`, a page of an owned domain as a second way in ("Öppna samtalet"); a remote manifest cannot.
- Item 2: a lens is a read with a `table` or `list` view that an administrator chose. Marks come only from sources
  offered as a lens, and a mark is left out when a column of the same source already warns for that person. The view
  language gained what the places needed: the tone key `*` (any other non-empty value), `beside` (drawn with the
  field before it) and `compact` (the row in one value: a column, a summary), and `own` marks Clew's own domains,
  captioned "Clew".
- Item 3: the Visa menu sits under the page's title, on "Alla" as under a lens.
- Item 4: lenses and columns are chosen on the connector's admin page beside "Verktyg i menyn", stored in the
  capability's overrides (`lens`, `column`), at most three columns per entity kind, with audit rows `connector.lens`
  and `connector.column`. The count is taken outside the saving transaction, so two administrators at once could
  pass three. `bun run dev:connectors` chooses for the development stack while nothing is chosen.
- Item 5: a person opens beside the list at `?person=<key>` and as a page at `/people/<key>`; a unit is a page at
  `/units/<id>` with no rail entry. Sections are Clew's own first, each read on its own; a section draws the read
  its view opens as up to five plain lines and gives one way in.
- Item 6: a subject sits on a card row, on a thread (never drawn: an action point card names its employee this
  way, which D96 item 6 allows since the model reads only a row's label and detail), on a search hit and on a view
  row. Names link on card rows, in "Mina åtgärdspunkter", on "Läget på …", in search and in views. "I dag" and
  "Sedan i går" carry no subject and are not linked, and the calendar's planning card is written past the thread
  store, so it is not indexed.
- Item 7: keys go in calls of at most 200, four calls at once, four seconds per source (the conformance check
  warns above 1.5 seconds), with cancellation and authority checked again after the batch. A row is cut to its key
  and what its view draws before it leaves the server. A person without a user name, or deactivated, is never asked
  about. A key outside the rule answers 404.
- Item 8: the signed actor carries an optional `userName`. "Who may be asked about" is one rule in
  `modules/entities`: for a person `managed`, `self` or `colleague`; for a unit `member`. The index from entity to
  cards is migration `0046_thread_subjects`, with no backfill: an older card is indexed when its rows are next
  written. Personal reads the entities API alone; `GET /api/staff` remains for the talk drawer.
- Beyond the items: an action about an entity starts a card without the model
  (`POST /api/entities/:kind/:key/actions`, `apps/server/src/threads/usecases/started.ts`). A propose runs as the
  person and its draft is the card; an execute never reaches the source before the human decision. The card opens
  on Hem. `scripts/subject-erase.ts` removes a subject from every row and the index, with an audit row of counts
  only; a source that still sends the key writes it again at its next scan. `/protocol/preview` runs the dry run on
  a pasted manifest and draws samples from the declaration; it fetches nothing and calls nothing, since the route is
  public. `connector-check` probes every capability that is about an entity (`--keys`, `--as`).
- Sources that exist: `talks.person` and `talks.unit` (Clew's own), `hr.person` and the action `hr.prepareAbsence`
  ("Registrera frånvaro"), `appraisals.person`, and `qlik.unit`. The appraisals fixture is keyed on the directory's
  user names and no longer matches on display names.

The open items as taken for the build, each provisional until the product owner decides: the columns on "Alla" are
pulled live; the key on the wire is `userName`, compared without regard to case; a person's key may sit on card rows,
with the erasure script; a talk's summary text and employment facts are not shown; `about` is its own mechanism in
`modules/entities`, and search, errands and the talk seam are unchanged; no two-source list is built as an answer.

What the canvas draws and the product does not: "Boka möte" (the calendar has no propose capability),
"Boka samtalet som saknas", "Markera som hållet" and "4 i tjänst i dag" (no source offers them); Kompetenser,
Introduktion, access cards, cases per person or unit, a unit's economy and rooms as entities (no source); the
person selector and timing on the preview; inflected counts ("3 bokade"); "Inga" in the supporting colour; the
check mark in the Visa menu (Astryx draws radio circles); the avatar in the phone's header.

**Not established.** Written before the build: nothing is built and nothing is measured. After it: what a live read
of two or three sources for a list costs is still not measured; the full WCAG suite was not run in one go, only the
specs the build touched; no manual screen-reader pass was made; no real source has answered. The canvas **Clew · en entitet, många källor**
(https://claude.ai/artifact/Muchzp6aRAx9uxokwFLAfj) was written but not rendered and checked, is drawn in plain
markup, and shows sources Clew does not have. The Astryx components for the Visa menu and the person's panel and
page have not been looked up. The pattern is unproven beyond people and units. No HR practitioner has seen it.

**Replaces.** As built it refines
[D94](D94-a-manager-has-a-personal-section-listing-the-people-on-their-units.md) item 3 (a person gets a panel and a
page), [D96](D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md) item 7 (the status
column on Personal becomes a lens and a section) and the line in `docs/architecture/working-across-connectors.md`
that cross-connector view enrichment is not supported.
