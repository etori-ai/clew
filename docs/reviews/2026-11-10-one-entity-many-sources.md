# Exploration: one entity, many sources · 2026-11-10

**Date:** 2026-11-10 · **Asked by:** the product owner, looking at Personal with its Samtal column ("We need to
really think this through, and not add 'Samtal' button in a column like this. We need to take into consideration a
connector wanting to tie in to an entity, for example users. […] it's not just about talks, it's about every entity
and connection in Clew") · **Outcome:** a pattern in which a source says what its rows are about and Clew places
them, drawn on a canvas, tested against the proof of concept and against the core. Recorded as the direction in
[D97](../decisions/D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md). Nothing is built.

The screens are on the canvas **Clew · en entitet, många källor** (Claude Design,
https://claude.ai/artifact/Muchzp6aRAx9uxokwFLAfj), 19 artboards, written but not rendered and checked. A summary
for readers outside the repository is the document **Clew: one entity, many sources**
(https://claude.ai/artifact/MC5SquxUxgPnJbEFhpsqxi).

## The question

Personal (`/staff`, [D94](../decisions/D94-a-manager-has-a-personal-section-listing-the-people-on-their-units.md))
knows about utvecklingssamtal. `apps/web/src/pages/staff.tsx` reads `clew.talks` itself and draws a Samtal column
with a button on every row and an Åtgärdspunkter column
([D96](../decisions/D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md) item 7).
The next source (absence, competences, cases) would need its own columns and buttons written into the same page.
The connector protocol gives a source no way to attach to a person: a row in a declared view opens only another
read of the same connector, and `docs/architecture/working-across-connectors.md` says cross-connector view
enrichment is not supported.

So: how does a source, a connector or a module Clew owns, become a feature on top of an entity it does not own, for
every entity and not only people, and what is it like to build one?

## What other systems do

Three groups were read on 2026-11-10 from public documentation. Products are named by category.

**HR products** (six commercial systems, one of them Swedish). Some help centres refused automated reading, so parts
of this come from search extracts.

- The staff list is a generic grid: the person picks columns, filters and saved views. Features do not own columns.
- A feature gets its own coverage list. The Swedish system's talk overview takes a template and a period and lists
  every employee as held, booked or not held, with booking from the row of someone missing. Others have a review
  cycle page or a "status" report.
- The person page has a tab or section per domain, and the feature's history lives in its tab.
- Actions sit in one menu that appears on the row, on the profile and in search.
- Work is pushed to the manager's home or inbox; the list is not where a talk is started.
- No product that was read wires a per-feature button column into its staff list.

**Plugin platforms** (an open-source developer portal, an issue tracker, a commerce admin, a CRM, a payments
dashboard, a support desk).

- Typed slots recur: a badge or glance, a section or card, a full tab, a related list, an action on one entity, a
  bulk action, a list column, a preview.
- The plugin declares which entity kind it targets and under what condition. Identity is explicit: the host sends
  a named property, or the entity carries the plugin's key.
- Enabling is not placing. Installing a plugin does not put it on a page; an administrator places or pins it.
- No platform calls every plugin for every list row at render time. List rows are decorated from data the host
  already holds (pushed or stored); live calls are for one open entity, lazy and under a hard time limit.
- Two documented reversals: a CRM retired its declarative cards because the fixed property list could not grow, and
  an issue tracker moved contributed content out from behind a click that replaced the owner's fields.

**Open standards.**

- GraphQL federation: one service adds fields to an entity another owns. The gateway looks entities up in one batch
  by key, and a missing row stands for both "none" and "not allowed".
- CDS Hooks (HL7): the host calls registered services at named points with a signed assertion per call and gets
  declarative cards back, whose suggested actions the host carries out after a person decides. It asks services to
  answer in about half a second.
- SCIM schema extensions (RFC 7643): stored, provisioned attributes with one owner. Not a fit for a live read by a
  third party.

What is taken from them: the lens, the sections and the one menu from the HR products; typed places, declared
targeting and "enabling is not placing" from the platforms; the batched lookup by a public key, the signed call and
"out of scope is answered as no row" from the standards.

## The pattern

A source says what its rows are **about**; Clew decides where that shows. One new manifest field, `about`, on a
capability. The view language (D38) does the rest. What a source declares decides the most room it can get; it
never claims a place itself.

| What the source declares | Where it shows |
|---|---|
| Only an action about a person | The person's menu, nothing else |
| A read about a person | A section when the person is opened |
| A field of that read with a `warn` or `alert` tone | A mark on the row, only when it needs the reader |
| A read worth working through as a list | A lens, listed under a Visa menu on the list |

- Lenses sit under one Visa menu, not as tabs. The product owner raised that some connectors do not deserve a
  prominent place although their actions must be available, and chose the menu over tabs (artboards A and A2).
- An administrator chooses the two or three columns everyone sees on the list's "Alla", as menu tools are chosen
  today (D40).
- The opened person starts with "Behöver dig": the cards about that person.
- A person opens in the panel from a list and can be opened as a page, where one source's full view has room.
- The reverse direction is a reference: any row that names a person, a unit or a room links to it.
- Other entities follow. An area's figure (D54) is the mark of the reader's unit; a room gets sections from the
  calendar and a case system.

## Every surface a source can show on

29 surfaces in three groups; ten change. Artboard L lists each with the manifest key that feeds it.

| Group | Surfaces | What changes with `about` |
|---|---|---|
| Clew shows it unasked (Hem and the header) | Kort i Behöver dig; Väntar på andra and Hanterat; Läget; Mina ärenden and Mina åtgärdspunkter; I dag and Sedan i går; Områden under rutan; Från dina tjänster; Påminnelser; Sidhuvudet | A card row that names a person links to the person. Läget is the unit's mark. People and rooms in the day link to the entity. |
| The person asks (the box, the conversation, search) | Svar; Vy under svaret; Förslag; Steg; Källhänvisning; Chip i rutan; Sökträff; Menar du | An entity can be the answer, and two sources can share one list. A person, unit or room can be a chip. Search gives one hit per entity, not one per source. |
| The person opens (tools, entities, records) | Verktygssida; Rad öppnad i panelen; Lins över en lista; Märke på raden; Sektion på entiteten; Åtgärd i entitetens meny; Områdessida; Granskning och dokument; Jobb över flera system; Kvitto och Ångra; Kalender; Egen sida i en ägd domän | The lens, the mark, the section and the menu action are new. |

## The developer's experience

A developer who works only on the talks connector never touches Clew's pages.

1. Declare it: `about` on a read that takes `{ keys }` and answers one row per key, and on any action that takes a
   person.
2. Preview it: a page draws the row mark, the section and the menu as a chosen fixture person, before anything is
   registered. A wrong declaration is refused with the field named.
3. Check it: the conformance check tests the batch, one row per key, an unknown key, and that a person out of scope
   is answered as no row.

```js
{
  name: 'appraisals.person',
  kind: 'read',
  title: 'Utvecklingssamtal',
  about: { entity: 'person' },
  input: Keys,        // { keys: [...] }, at most 200
  output: PersonRows, // { rows: [{ key, state, at, overdue }] }
  view: {
    kind: 'list',
    title: 'state',
    fields: [
      { key: 'state', label: 'Samtal', format: 'status', tones: { Saknas: 'warn' } },
      { key: 'at', label: 'När', format: 'instant' },
    ],
    open: { capability: 'appraisals.commitments', title: 'Åtgärdspunkter', params: { person: 'key' } },
  },
},
{
  name: 'appraisals.book',
  kind: 'propose',
  title: 'Boka samtal',
  about: { entity: 'person', param: 'person' },
}
```

The field names are a proposal. The preview page and the extra checks do not exist.

## Tested against the proof of concept

The product owner asked for the findings to be tested against the code demo at
https://start.sundsvall.dev/portal/start. It was read on 2026-11-10, signed in as its fixed section-manager persona:
the start page, Personal, one person's Personalakt, Kompetens and its page for one person, Dialogstöd, Mina
aktiviteter, Min AI's empty state and the flow Nytt utvecklingsärende. The demo runs on synthetic data, so it shows
what is wanted, not what a live read costs.

| Finding | What the demo does |
|---|---|
| No feature buttons in the staff list | Personal's rows are a name link plus status columns. "Boka" sits inside the talk section of the opened person. |
| A feature gets its own list to work through | Kompetens has "Att åtgärda" with filters and grouping per requirement or per person. Personal has filter chips such as "Samtal utan tid". |
| The opened person is sections per domain | Personalakt has Notiser, Ärenden, Anställning och kontakt, Utvecklingssamtal, Frånvaro och semester. |
| The unit is an entity too | Dialogstöd has one row per section with a column per domain and a tone on each. |
| Cards lead to the entity | A card about two competence plans opens that person's plan; the sick-leave activity opens the unit's sick-leave page. |

Where the demo differed, and what changed on the canvas:

1. "Alla" shows more than marks. The demo has four fixed columns for everyone (Närvaro, Notiser, Ärenden, Nästa
   utvecklingssamtal). The canvas now has two columns chosen by an administrator beside the marks (artboard A2).
2. The cards about a person come first on their page, and are counted on the row. The canvas now has "Behöver dig"
   as the first section (artboard C).
3. The person is a page, and exists twice, under Personal and under Kompetens, linked to each other. The canvas
   keeps one person and adds a page where a source's full view opens (artboard C2).

The Personalakt shows the talk's summary text and employment facts (form, start date, degree of employment). The
pattern can show both from the source without Clew storing them; D96 seals the talk's text and the vision says no
employee file, so whether to show them is a policy question, not a design one.

Not tested: no question was put to Min AI, and Kalender and Statistik lead nowhere in the demo. Godkänn and Boka
were not pressed.

## Against the core

No redesign is needed. Capabilities behind a registry, declared views, human decisions and the ledger carry the
pattern. Checked against the code and the tables on 2026-11-10.

| Feature | State in the core today |
|---|---|
| Lens and section | The mechanism exists three times by hand: `modules/search`, `modules/errands` and `modules/talk-seam` each ask sources as the person, under a time budget, and accept partial answers. |
| Actions in the person's menu | Works as is: `propose` and `execute`, the human decision and the ledger are unchanged. |
| An administrator chooses lenses and columns | Has a precedent in the menu tools (D40). |
| Marks and columns on "Alla" | The figure batch already runs under D75's rules (two seconds, four at a time, authority checked again). The same rules fit. |
| Cards listed on a person, names as links on Hem | Not possible today. `ThreadItem` is `ref`, `label`, `detail`; the name is text inside the label. |
| One search hit per entity | Not possible today. A `SearchHit` carries the connector's own ref, not a shared key. |
| A job across systems | The API and the ledger exist; the screen is planned (D55). |

Four changes:

1. **The key on the wire.** The actor a connector receives is `id`, `name`, `unitId`, `unitLabel`, `role`: not the
   user name its rows are keyed on. The appraisals fixture falls back to matching on the display name. The caller
   and the people asked about both need a public key in the signed call (D44's territory). `auth_person` holds two
   candidates: `externalId`, the directory's stable id, and `userName`, which can be renamed. D96 chose the user
   name.
2. **A typed subject on rows.** Card rows, search hits and view fields need an optional "about person X" or "about
   unit Y", and Clew needs an index from entity to cards. That puts a person's key in the card tables, so erasure
   has to cover it, and principle 7 ("names of individuals stay in the source system") has to be read against it.
3. **Who may be asked about.** Only the talk seam computes "the people on the reader's own units" today. That
   becomes a core rule per entity kind, checked before any source is called. The source still narrows further.
4. **Personal stops special-casing talks.** The hard-wired columns and the overlay wiring go. The reserved talks
   reads stay, since the planner reads the round through them.

## Ownership

Clew does not need to own more records. It needs to own which entity a row is about.

| Entity | Today | What the pattern needs |
|---|---|---|
| Person | Clew's, pushed in through SCIM (D62, D68) | Enough for the lens, the section and the menu. `auth_assignment` is current state only: no dates, no history. |
| Unit | Clew's: `auth_unit` is an id and a label | Enough for a unit page. Units have no parent, so a roll-up over sections has nothing to roll up. |
| Room, case, document | Each lives in one connector under its own ref | Clew should not own the record. One connector per kind would have to be named the provider of the key, as one system answers for talks today. Wait until a second real source needs it. |
| Card | Clew's | A subject on its rows and an index from entity to cards. |
| Marks on "Alla" | Nothing stored | No store is needed while a few chosen sources are pulled in a batch. Marks from every source would need one, and there is no change-event intake (D19 is proposed), so stored marks would be up to a day old. |

The employee file stays out. Title, phone and employment facts show as a section read from the system that holds
them.

## A worked example: competence tracking

The product owner asked how a competence feature that persists its own entities would be built: as entities native
to Clew, or as a separate connector with its own database.

Native, for the part that is workflow: a core module with its own tables, under D95. D95 weighed a first-party
remote connector with its own database and rejected it for an owned domain: no editing surface (a connector's views
are read-only, so every small write would go through the ledger, which is for writes that leave Clew), no shared
transaction with cards, timers and audit, and a second database to erase, export and back up. That shape fits only
a feature specific to one installation, built outside this repository, or holding data that must stay out of Clew.

| Part | Owner | Why |
|---|---|---|
| Which role or unit requires what | Core module | A list, the same everywhere, differing only as data |
| Certificates a manager registers by hand | Core module | A small record: what, when, valid until, who registered it |
| Expiry follow-up | Core module | A timer and a card to the manager and the employee, as action points have |
| Course completions | A connector to the learning platform | The checklist's hard stop: the value is the platform's content |
| Licences and legitimations | A connector to the issuing register | Another system is the authority |
| Development plan activities | The talks module | They are action points from the talk; a second copy would be a second owner |

The status (valid, expiring, expired, missing) is computed when read, from the module's requirements against its own
records and what the connectors answer. It shows through the pattern with nothing special-cased: about a person, a
section, a mark, a lens and "Registrera intyg" in the menu; about a unit, coverage per requirement; a tool page for
the list to work through; a page of its own only where someone writes.

Before it is built: its own numbered decision answering the checklist; answers to question 6 (retention and
secrecy for qualification records) and question 11 (a review by an HR practitioner), both still open for talks; no
file attachments, since storing the certificate itself would make Clew a document store; and a combined read for
external certificates, since several systems can hold them, closer to how errands are combined than to the single
answerer of talks.

## Not established

- The artboards were written but not rendered and checked. They are drawn in plain markup after Astryx Neutral; the
  Astryx components for the Visa menu, the person's panel and page have not been looked up.
- The canvas shows sources Clew does not have: absence per person, competences, an introduction lens, a pass
  system, a "Min enhet" page.
- The follow-on proposal after a job, merged search hits and the two-source list in an answer are drawn, not built.
  The two-source list stays inside "not a federated query engine" only if it is limited to one page of Clew's own
  people, with no filter or sort pushed to a source.
- Rooms, cases and documents have no shared key, so the pattern is unproven beyond people and units.
- What a live read of two or three sources for a list costs was not measured.
- No HR practitioner has seen any of it.
