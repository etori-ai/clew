# Review: the product owner's Startsidan proof of concept against Clew's core · 2026-11-06

**What was reviewed.** The code demo at https://start.sundsvall.dev/portal/start (signed in as "Kim Andersson,
Sektionschef", the demo's fixed persona), read on 2026-11-06: the start page, Mina aktiviteter, Min AI, Personal,
Kompetens, Dialogstöd and the flow Nytt utvecklingsärende. The demo says of itself "Prototyp under utveckling.
Innehållet är illustrativt" and "Uppgifter hämtas i realtid från verksamhetssystemen"; it is a front end over
synthetic data, and this review reads it as a statement of what the product owner wants the page to be.

**The question.** Does Clew's core logic (`docs/vision.md`, the thread, card, decision, receipt and connector
contracts in `packages/contracts/src/index.ts`, the decisions D34, D45, D47, D50, D53) still hold when the page looks
like this? And could this page be built as a second web app over the same server?

**Short answer.** Yes, with one line drawn clearly. Everything on the demo's start page that is _work_ (what needs
Kim, what the assistant has drafted, what waits for a decision, today's meetings, the four figures, the counts per
service) is a view over what Clew already holds: pushed threads with their one next step, proposals, the day, the
figures and the areas. The demo's layout is a dashboard where Hem is a stream, but it reads the same facts. What does
not fit is the _intranet_ around it: the six editorial sections in the top bar, the fokusnyhet, the news feed from
sundsvall.se, "Anpassa startsidan", and Min AI as a general-purpose assistant with web search, image and document
generation. The vision names each of these as not Clew ("Not an intranet, a news site or a document store", "Not a
page builder", "Not an AI platform"). The demo is therefore two products on one page: an intranet start page, and
Clew as the engine behind every tile and row that is about the person's work. The core holds; the page is a host.

## 1. What the demo shows, element by element

| Demo element                                                                                                                       | What it is                                                                                                                                                                             | Clew's counterpart                                                                                                                                                                                                        | Holds?                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "God morgon, Kim!"                                                                                                                 | Greeting by time of day                                                                                                                                                                | Hem's lead "Hej Hillevi · onsdag 5 november · vecka 45 · Skolan" (D63 item 2)                                                                                                                                             | Yes; wording differs                                                                                                                                                                                                                                                                                                   |
| "Vad vill du göra?" with "Fråga AI"                                                                                                | The box                                                                                                                                                                                | The box (D34, D36): one question box, `POST /api/conversation/stream`, "Menar du"                                                                                                                                         | Yes                                                                                                                                                                                                                                                                                                                    |
| Chips "Starta ett utvecklingsärende", "Godkänn 4 ledighetsansökningar" …                                                           | Suggested questions; a click puts the text in the box and the model "Svarar …"                                                                                                         | `GET /api/completions` (`do`, `ask`); on Hem the chips are gone at the product owner's wish (D63 item 9) but the endpoint stands                                                                                          | Yes as _questions_. **No** if "Godkänn 4 ledighetsansökningar" lets the model approve: a decision reaches a source only through the human decision endpoint, which is never a tool (vision, D45). The right answer to that chip is "Menar du: Attest: 4 ledighetsansökningar", a row, and its card's Attestera button. |
| Four tiles: Min budget, Sjukfrånvaro, Rekryteringar, Ledighetsansökningar                                                          | Figures with a target, a trend, a tone and a source ("ur dialogstödet")                                                                                                                | `GET /api/figures` (`Figure`: label, value, comparison, tone, source, optional progress) and `GET /api/areas` (`Area.figure`, `needsYou`, `waiting`)                                                                      | Yes for the shape. The figures are a fixed synthetic list until D54 decides where they come from (the review of 2026-11-06 on Läget); the two count tiles are areas.                                                                                                                                                   |
| "Att agera på · 8 · Visa alla →"                                                                                                   | Eight rows: title, one reason line, a state badge ("✦ Utkast klart", "Redo", "Utgånget", "Pågår", "Aktivitet"), one button ("Öppna", "Fortsätt", "Godkänn", "Granska", "Visa", "Boka") | Hem's rows (`ThreadRow`, D48 "one next step, the rest one step away"): a pushed thread, `summary`, `deadline`, `actions` with one `primary`, `cardKind` krav / forslag / handelse                                         | Yes, closely. The demo's badges map to `cardKind` and `attentionLevel`: "✦ Utkast" is a proposal, "Redo" an executable krav, "Pågår" waiting, "Aktivitet" a händelse, "Frist passerad" the overdue badge.                                                                                                              |
| "Ärenden kopplade till min personal" table                                                                                         | A connector's rows: name, case, dates, status                                                                                                                                          | A declared `table` view (D38) from an errands connector; D35 says errands are a connector profile and a card is one system's                                                                                              | Yes as a view in a panel or a page (D42, D50). No errands connector exists (status.md).                                                                                                                                                                                                                                |
| Individuella utvecklingsplaner, Behörigheter som går ut                                                                            | Per-person rows from the Kompetens module                                                                                                                                              | A declared `list` view from a competence connector; the vision names utvecklingssamtal records and delegations as candidates for a _core_ connector (a domain nobody else owns)                                           | Yes as views; which of them Clew owns is an undecided ladder step (vision, open questions)                                                                                                                                                                                                                             |
| Idag: 07:30 Ledningsgrupp, 09:00 Utvecklingssamtal, 12:00 Avstämning                                                               | The day                                                                                                                                                                                | `GET /api/today` (`TodayView`: events and gaps), I dag on Hem (D53, D63 item 3)                                                                                                                                           | Yes                                                                                                                                                                                                                                                                                                                    |
| Ledighetsansökningar: 2 Ledighet · Öppna, 4 Semester · Godkänn, 1 Föräldraledighet · Öppna                                         | One area's open cards grouped by kind                                                                                                                                                  | The area's cards; "Godkänn" is the card's execute action                                                                                                                                                                  | Yes; the grouping by leave kind is a connector's `items`, not Clew's                                                                                                                                                                                                                                                   |
| Återkommande händelser / Årshjul: delårsrapport 27 dagar, löneöversyn, enkät klar                                                  | Dated obligations                                                                                                                                                                      | Pushed cards with a `deadline` from a connector's scan; "Klar" is the Klart tab                                                                                                                                           | Yes as cards. There is no årshjul entity and the vision does not want one (no process model); the scheduler is for the person's own timers and jobs' watches (D47, D55).                                                                                                                                               |
| Fokusnyhet, Nyheter från sundsvall.se, "Lämna synpunkter"                                                                          | Editorial content                                                                                                                                                                      | Not Clew: "Editorial content can appear as a card with a link; it is not authored here."                                                                                                                                  | Outside Clew. A communication connector may push a händelse card with a link.                                                                                                                                                                                                                                          |
| Top bar: Anställning och arbetsmiljö, Chefsstöd, Ekonomi och styrning, Kompetensförsörjning, Organisation, Service, IT och lokaler | The intranet's sections                                                                                                                                                                | Not Clew: Clew's rail has Hem, the conversations, the tools an administrator put in the menu (D40, D42), the calendar and administration                                                                                  | Outside Clew. The tools strip under it (Mina aktiviteter, Min AI, Personal, Kompetens, Dialogstöd, Kalender, Statistik) is the menu.                                                                                                                                                                                   |
| "Anpassa startsidan"                                                                                                               | The person arranges the page                                                                                                                                                           | Not Clew: "Not a page builder. There is no operator-composed layout; the page is the stream, the areas and the composer." The vision speaks of operators; a person's own arrangement is the same question one level down. | Outside Clew's current line; a decision if wanted                                                                                                                                                                                                                                                                      |
| Bell "26 olästa"                                                                                                                   | Notifications                                                                                                                                                                          | `ReminderBell` (D39) counts reminders only; attention is budgeted (vision principle 6, D47): a fixed number of interruptions per day, the rest bundles                                                                    | Tension: 26 unread is what the budget exists to prevent. The count a Clew bell may show is the day's deliveries and reminders.                                                                                                                                                                                         |
| "Personlig vy: Sektionschef · Uppgifter hämtas i realtid från verksamhetssystemen"                                                 | The promise of a live mirror                                                                                                                                                           | Scans with persisted occurrences and revisions (D47), SSE change notices with committed revisions (D46), source states on the threads read                                                                                | Holds with a caveat: Clew is not a pure mirror. It holds what the source does not: dismissals, Inte nu, decisions on their way, receipts. "Samma läge som tjänsterna" is true of the facts, not of the person's own state over them.                                                                                   |

### Mina aktiviteter

"Allt som väntar på dig, samlat ur 6 tjänster" with the tiles Att göra 8, Frist passerad 1, Tjänster 6, Hanterade 1,
a filter per service and the lists Att göra and Hanterade. This is Hem's four tabs (Behöver dig, Väntar på andra,
Inte nu, Klart; D53) with the area filter, drawn as a page with counts. `groupThreads` in `apps/web/src/stream.ts`
already computes every number on it. The one thing the demo adds is "Frist passerad" as its own count, which is the
overdue badge counted.

### Personal, Kompetens, Dialogstöd

Three tool pages: a table of the unit's people with presence, notices, cases and next utvecklingssamtal; a competence
page with requirement coverage, expiring certificates and plans to confirm; a key-figure matrix per section for the
uppföljningsdialog. Each is a declared view (D38) as a page (D42): `table` and `list` kinds exist, with the view's own
search and choice. The demo draws figures and bars (coverage 55 %, a KPI matrix with tones); the `figures`/`series`
view kinds are not implemented (status.md) and would be the gap to close before Kompetens and Dialogstöd look like
the demo. Dialogstöd is the aggregates persona (Johan, Eva in `docs/personas.md`): never individuals, which the demo's
page respects.

The Personal table shows "Sjukfrånvaro · Dag 12" per named person on a page one click from the start page, and the
start page itself names people in rehab and sick-leave rows. HANDOVER records the product owner's 2026-11-03 decision
that names may appear in card rows (the guardrail covers pushed text and notifications), so the rows are allowed.
Health data beside a name on a list page is a scope question for the server, not for the layout: the manager of the
unit sees it, nobody else does, and a connector returns rows for the actor's scope only. That rule is unchanged.

### Nytt utvecklingsärende

A four-step flow (Underlag, Utkast, Arbeta igenom, Granska & lämna): the person describes an initiative, drops up to
five files that "lagras inte, de läses en gång och skickas till assistenten", the model writes a first draft under a
fixed template of fourteen headings, the person works through it and hands it in. On the start page it shows as
"Utkast: Startsida för medarbetare och chef · 10 rubriker är inte granskade · ✦ Utkast skrivet av assistenten ·
Fortsätt".

The vision's line puts the drafting on Eneo's side ("Apps and services: transcription, summarisation, structured
prompts: Eneo; an app run can be a `propose` capability in the `eneo` connector whose result lands as a card") and the
obligation on Clew's: the card "Utkast … 10 rubriker inte granskade" with Fortsätt as its next step, the handing in as
a decision with a receipt from the case system. The flow page itself is the kind of surface D50 opens as a view beside
the conversation or as a page, if the connector declares it; a `form` view kind does not exist. Files that are read
once and never stored fit Clew's rule that it holds refs, never other systems' content. So the flow is a connector's
(Eneo's app plus the case system's write), reached through Clew's card. Clew does not own the template, the draft or
the document.

### Min AI

Own conversations with history, "Webbsök, Mina aktiviteter, Skapa bild, Skapa dokument, Skapa graf", and the note
"Demo: svaren kommer från en språkmodell via startsidans server, i drift från Eneo". That is Eneo's product by the
vision's own table ("Operator-built assistants … Eneo. An Eneo assistant can be opened as a view in Clew's side
panel"). Clew's conversation is about Clew: the cards, the views, the capabilities; its one tool for the person's
activities is what the demo lists as "Mina aktiviteter" among Min AI's tools. The demo has the line right and says so
in its own footnote. The right build is Min AI as a link or an embedded view of Eneo, and Clew's box as the box on the
start page.

## 2. Where the core logic holds

1. **The stream is the data; the dashboard is a layout.** Every work element on the page is a pushed thread, a
   proposal, a figure, an area or the day, read from the five endpoints Hem reads. Nothing on the page needs a new
   contract to be drawn.
2. **One next step per row.** The demo draws exactly one button per row, as D48 does, with the state as a badge
   before it. The demo's "Öppna" where Clew would have the next step is the one difference: the demo opens a page,
   Clew opens the card beside the column (D50). Both are one click.
3. **The person decides.** "✦ Utkast klart", "✦ Utkast skrivet av assistenten", "✦ Utkast kan tas fram" are three
   states of a proposal that nothing executes until the person says so. D45's approved intent before dispatch and
   the receipt as a read-back are untouched by the layout.
4. **Views come from connectors.** Personal, Kompetens, Dialogstöd and the errands table are declared views, not
   pages anyone composes in Clew.
5. **Scope is the server's.** The demo's "anpassar sig efter om du är medarbetare eller chef" is Clew's areas and
   capabilities per actor; the layout changes nothing there.

## 3. Where it bends or breaks

1. **A chip that executes.** If "Godkänn 4 ledighetsansökningar" in the box lets the model approve, it breaks the one
   rule the whole backend is built on. The chip must resolve to the card. The demo's own "Attest: 4
   ledighetsansökningar · Redo · Godkänn" row is the correct path and already on the page.
2. **The intranet chrome.** Sections, news, fokusnyhet, "Anpassa startsidan", "Lämna synpunkter". None is Clew, and the
   vision says so three times. Either the intranet hosts Clew (the page is the intranet's and reads Clew's API), or
   Clew's start page gets an editorial slot by a decision that changes the vision. The second web app below takes the
   first position: it draws the work and leaves the editorial places empty.
3. **26 unread.** Attention is budgeted. A bell that counts every change is the inbox Clew replaces.
4. **Figures without an owner.** The four tiles are the demo's most visible element and Clew's least settled (D54
   undecided, the figures synthetic). The demo makes the decision more urgent, not different.
5. **View kinds.** `figures`, `series` (the coverage bars, the KPI matrix) and `form` (the utvecklingsärende flow) do
   not exist. The demo shows what they would be for.
6. **"I realtid".** True of the facts, not of the person's own state over them; the footer's sentence should not be
   copied as a promise.

## 4. A second web app over the same server

The page can be built as `apps/portal`, a second Vite app beside `apps/web`, over the same BFF, the same session, the
same `@clew/ui` and `@clew/contracts`, and the same components for a row, a card, the day, Sedan i går, the composer
and a declared view, imported from `apps/web/src` until what both apps use moves into a package. Astryx has the
shell the demo draws (`AppShell` with `TopNav`, the `shell-top-nav` template), the tiles (`Card`, `Grid`) and the
rest. What it would draw on day one: the greeting, the box with "Menar du" and the chips from `completions`, the four
figures, Att agera på with Hem's rows, the areas as count cards, I dag, Sedan i går, Mina aktiviteter with its four
counts and its filter, a card as a page, a tool's view as a page, and the conversation. What it would leave empty: the
intranet sections, the news, "Anpassa startsidan", Min AI, the errands table (no connector), the Kompetens figures and
the Dialogstöd matrix (no view kinds). Built as D67.

## 5. Recommendation

- Treat the demo as the specification of a _host page_, and keep Clew's contracts as they are. The next decision it
  forces is D54 (who owns the figures); the next gap it names is a `figures` view kind.
- Build the portal as a second app, not a mode of Hem: the two layouts disagree on what the page is (a stream with the
  card beside it, or a dashboard with pages behind it) and should be compared side by side, with the same data, by the
  product owner. The canvas rule (CLAUDE.md) stays: the demo is this app's canvas.
- Take two things from the demo into Hem's backlog as questions, not as changes: "Frist passerad" as its own count,
  and the state badge drawn before the next step on a row.
- Say no, in a decision if asked, to a chip that executes, to an unbudgeted unread count and to an arrangeable page.
