# D97 · A source says what its rows are about, and Clew places them

**Status:** accepted as the direction (product owner, 2026-11-10), built 2026-11-10 (see "As built"); the items under "Open" were taken provisionally for the build and are not decided; the placement of a person's action in its source's section (amended 2026-11-11) replaced by [D112](D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md) item 5 (2026-11-11: every action in the page's header); item 9 amended by [D110](D110-a-persons-title-is-pushed-as-scims-title-and-kept-apart-from-the-role.md) (2026-11-11, provisional: a person's title is one line Clew holds, pushed as SCIM's `title`; phone and employment facts are still read from their source); item 5 and its amendments of 2026-11-11 amended by [D111](D111-where-something-opens-is-decided-by-what-it-is.md) (2026-11-11, provisional): a card opens beside the page it is on, a person is a page only, and a card's review and a person's talk lie over the page they were opened on; item 9 and the build's choice that employment facts are not shown amended by [D114](D114-person-profiles-show-employments-and-categorised-phone-numbers.md) (2026-11-12, provisional): Clew holds a person's phone numbers and current employments, pushed over SCIM, and the person's page shows them; the two open items on keys settled by [D119](D119-clew-keys-its-own-records-about-a-person-by-the-persons-id.md) (2026-11-12, provisional): the key on the wire is the user name, and a person's key on card rows is Clew's person id · **Date:** 2026-11-10 · **Area:** integrations, ui

**Amended 2026-11-12.** Three later records changed this one, and the status line now names each (O1 of the
[review of users and the organisation](../reviews/2026-11-12-users-the-organisation-and-the-guides-in-two-rounds.md)).
The items, the open items and the open items as taken for the build stay as written; where they differ from this
paragraph, this paragraph holds.

- **Item 5** and its amendments of 2026-11-11 follow
  [D111](D111-where-something-opens-is-decided-by-what-it-is.md), as those amendments say.
- **Item 9 and the employment facts.**
  [D114](D114-person-profiles-show-employments-and-categorised-phone-numbers.md) has a person's categorised phone
  numbers and current employments pushed over SCIM and held by Clew, as display data that decides nothing. The
  person's page shows them in "Anställningar" and "Kontaktuppgifter" to every active person of the organisation, each
  section only when something was sent. "Phone and employment facts are still read from their source" in the status
  line, item 9's "title, phone and employment facts are a section read from the system that holds them" and the
  build's choice that employment facts are not shown no longer hold. A talk's summary text is still not shown.
- **The two open items on keys**, settled by [D119](D119-clew-keys-its-own-records-about-a-person-by-the-persons-id.md)
  (Q11 of the same review). The key on the wire is the SCIM `userName`, since that is what a source knows; a source
  answers for the name's current holder, because a user name can be renamed and given to a newcomer. A person's key on
  card rows, on started actions and in the index from entity to cards is Clew's person id, which a rename does not
  change and nobody reuses. A source's key is resolved to the id when a row or an action arrives, and a key that names
  no current person is attached to nobody. `scripts/subject-erase.ts person <person id> --confirm` erases a person by
  that id from every card, whatever user names they have held.

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

**Amended 2026-11-11: a card about a person opens beside the list, not on Hem.** The product owner followed "1 att
agera på" on Personal and landed on Hem with the card already attached to the box: the list was gone, and a link that
counts what waits had started the work instead of showing it. Under item 5 the one card "Just nu" counts now opens in
the list's own panel (`/staff?card=<threadId>`), and a card under the opened person's Behöver dig opens over the person
(`/staff?person=<key>&card=<threadId>`); closing leaves the person or the list (D83 rules 1 and 3). The card is the one
Hem draws, from the same cache, so its decision goes through the same endpoint. The person's page and the unit's page
have no panel and still lead to Hem, as does an action started from a person's menu and the review of a card's rows
(D73). `docs/reference/interface-spaces.md` has the placement row.

**Amended 2026-11-11, the same day: the name leads to the page.** With the person in the panel and "Öppna som sida"
as a link inside it, the product owner found the two the wrong way round. On Personal a name now leads to the person's
page (`/people/<key>?from=<the list>`). A menu choice that opened the person beside the list instead was tried and
taken out the same day: a menu holds what can be done about a person, never where Clew shows them. The person is still
drawn beside the list where "Just nu" counts several cards, and the focus goes to the row's name when that closes.
Whether a person is shown beside a list at all, or only as a page, is open and waits for the navigation review.

**Amended 2026-11-11 (D111): a card opens beside the page it is on, and an action's card beside the page it was
started on.** Under [D111](D111-where-something-opens-is-decided-by-what-it-is.md) rules 2 to 4 the person's page and
the unit's page hold the panel beside their column, as Personal does: a card under their Behöver dig opens there
(`/people/<key>?section=needs-you&from=<the list>&card=<threadId>`, `/units/<id>?card=<threadId>`), with the section
and the way back kept, and closing leaves the page as it was. An action about a person or a unit no longer leads to
Hem: its card opens beside the page where it was started, over the person when it was started from the person beside
the list (`/staff?person=<key>&card=<threadId>`), beside the list from a row's menu, beside the person's or the unit's
page from their buttons. The unit's page now draws its actions as the person's do, the first two as buttons and the
rest under "Fler" ("Åtgärder" on a phone); no source in the repository offers an action about a unit yet. This
replaces the first amendment's sentence that the person's and the unit's pages have no panel and lead to Hem, and that
an action leads there; the review of a card's rows still opens over Hem (D73) until D111's rule 5 is built.

**Amended 2026-11-11 (D111): a person is a page only, and several cards are listed beside Personal.** Under
[D111](D111-where-something-opens-is-decided-by-what-it-is.md) rule 3 and the product owner's answers 1 and 6, nothing
draws a person beside a list. `?person=<key>`, the section drilled into on a phone (`person-section`) and the list drawn
compact beside the person are gone; an address that still holds them leads to the person's page
(`/people/<key>?from=<the list>`), with `person-section` as the page's `section` and an open card kept. "Just nu" that
counts several cards now lists them beside Personal, of the kind the link counted ("N att agera på", "N förslag"), from
the person's Behöver dig (`/staff?cards=<key>&cards-kind=act|proposal`); a title there opens its card over that list,
and closing leaves the card, then the list, then Personal with its lens. One card still opens directly. The list is
always drawn whole, so the panel stands beside it only where the list keeps its table's least width and is the drawer
over it elsewhere, and closing an action's card gives the focus back to the row's menu button. The person's actions
no longer offer "Öppna som sida". This replaces item 5's person beside the list and the sentences of the amendments
above that keep the person beside the list where "Just nu" counts several cards, that open an action's card over the
person, and that leave open whether a person is shown beside a list at all.

**Amended 2026-11-11: actions are drawn once, beside the name.** Actions about a person or a unit are drawn once,
beside the name, whichever section is open, and are no longer repeated in the opened section, which shows only what its
source read (the product owner saw "Registrera frånvaro" twice on a person's page).

**Amended 2026-11-11 (D111 rule 5): a card's review and a person's talk lie over the page they were opened on.** The
sentences above that keep the review of a card's rows over Hem until D111's rule 5 is built no longer hold: "Granska N"
on a card beside Personal, a person's or a unit's page opens the review over that page, and closing it leaves the page
with the card beside it ([D73](D73-the-review-is-a-page-in-the-shell-with-an-address.md), amended the same day). A
source's `about.page` may be a query alone, which lies over the page its way in is drawn on: the talks section's
"Öppna samtalet" is `?talk={id}`, so the talk opens over the person's page as well as over Personal
([D96](D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md), amended the same day).

**Amended 2026-11-11 (D111 amended): several cards lead to the person's page.** The list of a person's cards beside
Personal is gone: "Just nu" counting several cards leads to the person's page at Behöver dig
(`/people/<key>?section=needs-you&from=<the list>`), and an old `/staff?cards=<key>` address leads there in its place.
Personal's panel stands beside the list from the one width every page has, 1336 px, and the list gives way, drawn as
its rows where the table does not fit beside the panel.

**Amended 2026-11-11, later the same day: an action is drawn in its source's section.** On seeing the amendment
"actions are drawn once, beside the name" built, the product owner reversed it: "Registrera frånvaro" beside the name
was more prominent than it deserves, and it can live under Frånvaro. On the person's page an action about the person is
drawn once, in the section of the source (the connector) that offers it: a secondary button on the line of the
section's heading, on a phone a button the width of the column under it, with the source's refusal under them. Beside
the name stands only an action whose source has no section that holds it (none on the page, one that answered without
a row, or one that did not answer and so is no way in from the list of sections), so no action is lost; when every
action has its section, nothing stands beside the name. The unit's page, whose sections are drawn by another component
and all at once, keeps every action beside its name. This replaces that amendment for the person's page.

**Amended 2026-11-11: the person's sections are a tab strip.** The product owner chose top tabs over the list of
sections beside the chosen one. The sections are chosen in a tab strip under the name, "Om <namn>", one tab per
section in the same order ("Behöver dig" with the count of the reader's cards, then each source's title), each a link
to `?section=`, with the chosen section under the strip at the column's full width; without a section in the address
the first tab is chosen at every width. The list of sections with its line per section, and the phone's drill-in into
a section and back, are gone; the strip is the same on a phone and scrolls sideways. A source that did not answer keeps
its tab, so its section now holds its source's actions too: beside the name stands only an action whose source has no
section on the page or answered without a row. The unit's page is unchanged.
