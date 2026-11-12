# D53 · Hem is the start page: the day's work under the box, and the day beside it

**Status:** accepted, built 2026-11-06 on branch `hem`; not built: the phone's shift strip (artboard D needs a schedule capability no connector declares), the panel's tabs for everything a conversation has opened (artboards F, H, J) (built 2026-11-06, [D66](D66-the-panel-keeps-everything-opened-beside-the-page-as-tabs.md)), a conversation carrying a job across connectors with a step list (artboard J), and the mark on an earlier conversation that something happened since (artboard H); items 2 and 6 and the pixels changed by [D63](D63-hem-is-drawn-as-the-canvas-draws-it.md) on 2026-11-06 (the greeting drawn small with the day on its line, the day and Sedan i går as cards in the page's own side column); the layout to be replaced by [D115](D115-the-startsidan-prototypes-version-1-0-is-the-reference-for-clews-look-and-layout.md) (provisional, 2026-11-11; not built, so this record still binds what is built): the tabs move to Mina aktiviteter and suggestions stand under the box at rest · **Date:** 2026-11-06 · **Area:** ui

**Decision.** The landing and Att göra are one page, **Hem**, at `/`. It answers three questions above the fold at
1440 px: what needs me, how my day looks, and how my unit stands. Drawn as artboard A of the canvas
**Clew startsida · dagen i ett svep** (https://claude.ai/artifact/9xn43bAwXy2VioBqiG3xc6, private until shared) and
chosen by the product owner on 2026-11-06 over three other directions ("A probably"); the flows under it (artboards
E to K) say what every button on A leads to. Review:
[the start page's directions and flows](../reviews/2026-11-06-start-page-directions-and-flows.md).

1. **One page, one address.** `/` is Hem; `/todo` is gone. A card's state is the tabs (`tab=needs-you|waiting|snoozed|done`,
   the first left out of the address), the areas are the filter (`area=`), and what the panel holds is in the query as
   D50 item 4 has it (`card=`, `open=`, `open-card=`). Everything that led to `/todo` (the rail's row and search, the
   bell, the reminder toast, Alla samtal) leads to `/`. The rail's row is **Hem**, with how much needs the person.
2. **The lead.** "Hej, <first name>" is the page's one h1 (`display-2`, the template's sparkle beside it), with the day
   under it ("onsdag 4 november"). There is no "Vad vill du göra?" heading: the box's own label keeps those words for a
   screen reader. No sentence sums the day up ("Två saker behöver dig i dag …") and no suggestion chips are offered: the
   rows carry the facts, and a person who wants them in words asks the box. "Menar du" stays, as D36 has it, because it
   answers what the person is already typing from what the router can do without the model.
3. **The box under the greeting, anchored.** The box is the first thing after the lead and never moves while the
   person types (D36): "Menar du" grows under it and pushes the day's work down. D39's block, the brief and the box at
   least half the column high with the box on the centre line, is gone with the brief it was built for.
4. **Under the box, the day's work.** The tabs (Behöver dig · n, Väntar på andra · n, Inte nu · n, Klart) with the area
   filter and the attention tip on their line and a divider under both; then the tab's rows as D50 drew them: the groups
   Nu, Senare, Jag föreslår and Till kännedom as the h2s, Läget's four figures after them for every area at once, and
   last the person's areas and what they can start (D41 items 3 to 5, "Det du kan göra"). On a phone the tabs are one
   menu and every thread is a card in the list, as before.
5. **"Väntar på andra" replaces "Pågår utan dig".** The pile is D28's (open, `waitingOn` set); the name says the state
   from the person's side, who they wait for, not what the system is doing. The address keeps `tab=waiting`.
6. **Beside the column: the day and what happened since yesterday.** Two regions: **I dag**, the day's meetings in order
   with the free gaps as rows and "Hela veckan" to the calendar, and **Sedan i går**, what closed since the day began
   (each row to Klart), what waits on someone else (each row to its card) and when the assistant next goes through
   everything. Where the panel fits beside the column (window at least 1336 px: the rail's 256, the column's 640 and
   the panel's 440) they are the panel at rest, a `LayoutPanel` named "Vid sidan av"; a card, a view or a card's read
   takes that place and gives it back when closed. Narrower, and on a phone, they end the page after the day's work.
   The old footer line "I dag · 08:30 … · längsta luckan …" is gone; so is the sentence about the longest gap.
7. **The box asks about the open card.** With a card beside Hem the box says "Om kortet", its placeholder names the
   card, and "Ny fråga i stället" or the X on the card's token lets go of it (the token's X since 2026-11-06, D63 item
   14). Sending takes the card along to the conversation (D50 item 5), where it
   stays beside the transcript, and "Stäng samtalet" leads back to Hem with the card still open.

**Astryx.** `Layout` with `LayoutPanel` in `end` (the resting panel and the open one are the same slot), `LayoutContent`,
`LayoutFooter` for the docked phone box, `TabList` and `Tab` with `role="tablist"`, `Selector` and `DropdownMenu`,
`List` and `ListItem` with `href`, `Heading`, `Text`, `Icon`, `EmptyState`, `InfoTip`, `Divider`, `Grid`,
`ClickableCard`, `ToggleButton`, `ChatComposer`'s `headerActions` and `headerContext` for the scope line. No style and
no new dependency. **The Astryx gap this allows for:** a `TabList` with `role="tablist"` may hold only tabs, so the
area filter cannot stand in its strip; the tabs and the filter are an `HStack` with one `Divider` under both instead of
the strip's own `hasDivider`.

**Tests.** `tests/a11y/structure.spec.ts` (the greeting is the h1 with the day under it, no sentence, the box under the
greeting and the first group under the box, four tabs, Läget, the day and Sedan i går at the page's end at 1280 px,
the page titles, the rail's Hem row, a row reaches the box by `@`), `tests/a11y/todo.spec.ts` (at 1440 px the panel
rests on the day and Sedan i går with their links, a row's card takes its place, the box says "Om kortet" with "Ny
fråga i stället", Esc gives the row and the resting panel back; the tabs and their addresses; the box on Hem asks about
the open card and the conversation keeps it), `tests/a11y/answer.spec.ts` (with nothing pushed the page says Lugnt
läge under the box, which stays under the greeting while "Menar du" comes; the rows' shape while the cards load),
`tests/a11y/announcements.spec.ts` (Hem and the area are spoken), `tests/a11y/shell.spec.ts` (the bell leads to Hem),
and every other spec that opened `/todo` now opens `/`. The `screens.*` specs take the pictures on demand.

**Why.** The product owner reviewed the landing as built (D41, D50) on 2026-11-06 with a picture: nothing drew the eye,
"Inget behöver dig just nu" and the footer's day line were easy to miss, and the content sat in a 720 px column on a
1440 px window. The personas (`docs/personas.md`) were read for what each wants on opening the site: a manager wants
what needs her, her day and the state of her unit; a care worker wants when the next shift starts and what is new;
an operator wants to see that nothing is wrong. Four directions were drawn: **A**, Hem and Att göra folded into one
page (the product owner's own suggestion, "maybe the att göra section and the startpage can be folded in to each
other"); **B**, the same page on a quiet day; **C**, D41's hero kept but wider, with the brief as cards and the day as
a timeline in the footer; **D**, a care worker's phone with a week of shifts. The team's own mock
(start.sundsvall.dev/portal/start) was looked at on request: its strengths, the day and the schedule at one glance,
are in A; its news hero, its widget grid and "Anpassa startsidan" are not, because Clew's page is the assistant's
push and the person's day, never blocks to arrange. Weighed and left:

- **Keeping two pages with a better landing (C).** The brief above the box repeated the first three rows of Att göra,
  and "Allt i Att göra" was a change of page for the same list. One page with the tabs is the list itself.
- **A sentence over the rows, and suggestion chips under the box.** Both were drawn at first and taken out on the
  product owner's word: the sentence repeated what the rows said, and a chip in free text promises an answer the model
  may not have. "Menar du" is kept because it is drawn from what the router can do.
- **"Pågår utan dig".** Found confusing; the pile is the same.
- **The phone with a week of shifts (D).** Wanted ("what they probably want to check is when do I start tomorrow"),
  but no connector declares a schedule read today. The phone gets Hem as drawn here until one does; the artboard stays
  as the target.
- **Cards for I dag and Sedan i går.** The canvas draws them as cards in a side column; beside the column they stand in a
  divided panel, where a heading per region is enough and a card would be a box in a box.
- **A Card around the box.** The template's `ChatComposer` is already a bordered surface.

**Replaces.** [D41](D41-the-landing-is-the-ai-chat-landing-template-with-the-persons-areas-under-the-box.md) items 1, 2
and 6 (the greeting as a paragraph with "Vad vill du göra?" as the h1, the 720 px column, the brief above the box);
items 3 to 5 stand, after the day's work. [D39](D39-the-landings-box-rests-on-the-columns-centre-line.md) as a whole:
the box is anchored under the greeting, and the day line is now the region beside the column. [D50](D50-the-conversation-is-the-column-and-the-panel-holds-what-it-is-about.md) item 2's
address: Att göra's page is `/`; its tabs, filter, panel and box are as D50 has them, and "the day beside Att göra",
which D50 lists as not built, is item 6 here. [D34](D34-the-box-is-the-page-and-the-push-is-its-brief.md): the brief of
at most three rows above the box and its sentence; the four kinds of card and the groups stand.
[D28](D28-the-stream-has-two-groups-and-three-piles.md) item 2's name "Pågår utan dig". D36 and D48 stand.

**Amended 2026-11-07: the phone's box floats.** The docked box on a phone is no longer a `LayoutFooter`, whose solid
ground cut the day and Sedan i går off at the foot of the page (the product owner, 2026-11-07: "the input container
shouldn't need a background, could be floating on top of content"). Hem on a phone is composed as the conversation is:
`ChatLayout` with the landing as its content and the box (with "Menar du") as its composer, docked in Astryx's
frosted-glass layer the page scrolls under, with no scroll-to-bottom button since Hem is read from the top, inside a
`VStack height="100%"` so the layout owns the scroll. The focus checks of `tests/a11y/reflow.spec.ts` (2.4.11) hold:
every stop scrolls into view above the dock.
