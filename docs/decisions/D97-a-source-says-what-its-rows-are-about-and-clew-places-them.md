# D97 · A source says what its rows are about, and Clew places them

**Status:** accepted as the direction (product owner, 2026-11-10), nothing built; the items under "Open" are not decided · **Date:** 2026-11-10 · **Area:** integrations, ui

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

**Not established.** Nothing is built and nothing is measured. The canvas **Clew · en entitet, många källor**
(https://claude.ai/artifact/Muchzp6aRAx9uxokwFLAfj) was written but not rendered and checked, is drawn in plain
markup, and shows sources Clew does not have. The Astryx components for the Visa menu and the person's panel and
page have not been looked up. The pattern is unproven beyond people and units. No HR practitioner has seen it.

**Replaces.** Nothing yet. When built it refines
[D94](D94-a-manager-has-a-personal-section-listing-the-people-on-their-units.md) item 3 (a person gets a panel and a
page), [D96](D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md) item 7 (the status
column on Personal becomes a lens and a section) and the line in `docs/architecture/working-across-connectors.md`
that cross-connector view enrichment is not supported.
