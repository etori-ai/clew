# D41 · The landing is Astryx's `ai-chat-landing` template, with the person's areas under the box

**Status:** accepted, built 2026-11-05 · **Date:** 2026-11-05 · **Area:** ui

**Decision.** The landing (`/`, `apps/web/src/pages/start.tsx`) is drawn as Astryx's `ai-chat-landing` template
(`bun run astryx template ai-chat-landing`): the greeting, the question, the box, a row of categories and the chosen
category's suggestion cards. What the template shows as fixed examples is the person's own in Clew.

1. **The greeting and the question.** A line with the sparkle icon in the accent colour and "Hej, <first name>"
   (`Text type="large"`, the first word of the session's name), then "Vad vill du göra?" as the page's one h1 in
   `display-2`, both on the column's start edge as in the template. The greeting is a paragraph, not a heading: the
   template makes it an h2 above the h1, which puts the outline in the wrong order. On a phone the h1 keeps its plain
   size.
2. **The box.** The template's column, 720 px (`Layout contentWidth`), and the template's field height: `minHeight: 84`
   on `ChatComposerInput`, the one style the template itself sets (`Composer`'s `roomy`, in `components/composer.tsx`).
   The model menu stays in `footerActions` where the template has its mode menu, dictation in `sendActions`. Docked on a
   phone the field keeps its own height.
3. **The categories are the person's areas.** Under the box a group "Områden" holds one `ToggleButton` (`size="lg"`)
   per area the person has that offers something to start (an area of `GET /api/areas` with at least one standing
   action), in the order the areas come. So the row differs per person by role, unit and what the administrator has
   given them (D23), and changes when a connector is added, without the page knowing any connector. Nothing is chosen
   at first, as in the template; pressing the chosen area again closes it.
   **The Astryx gap this allows for:** the template's row is a `ToggleButtonGroup`, which lays its buttons on one line
   and has no wrap (`flex-wrap: nowrap`, no prop for it; `TabList` scrolls but is navigation with one tab always
   selected, `Carousel` is for browsing items). The template has four fixed categories; a person's areas are as many
   as their connectors give them, six already for a manager in the dev data, wider than the 720 px column and far
   wider than 320 px (1.4.10). So the same `ToggleButton`s stand in an `HStack wrap="wrap" role="group"` with the
   group's own gap, each with `isPressed` and `onPressedChange`, the documented standalone form; the one thing the
   group did, one pressed at a time, is the page's state. No style and no second component.
4. **The suggestion cards are the area's standing actions.** The chosen area shows a `Grid columns={{ minWidth: 280 }}`
   of `ClickableCard variant="muted"`, one per standing action: the capability's title, and under it the system and
   what happens ("Raindance · öppnar vyn", "Raindance · öppnar kortet") in Clew's supporting text (the template's
   `xsm` is too small to read), the same words as "Menar du". A read is a link to its view in the panel; anything
   else is asked in the box, as the chips did. Every card works without the model (D8). Where the cards open under
   the fold (a phone with the box docked, a low window) they are scrolled into view, without animation.
5. **An area may name an icon.** `icon` on an area in the manifest (`ManifestAreaSchema`, `AreaDefinition`, `Area`) is
   optional and takes a name from Clew's list, the one D40 made for the menu, now with `calendar` and `bell`:
   `phone`, `people`, `book`, `document`, `chart`, `search`, `clock`, `link`, `calendar`, `bell`. The connector sends a
   name, Clew draws it (`apps/web/src/icons.ts`, one map for the rail and the landing). An area without one is its
   title alone. The bundled connectors name theirs.
6. **The brief stays above (D34) and the box stays still (D36, D39).** The push is still the brief of at most three
   rows at the top of the column, with its sentence ("En sak behöver dig i dag …"; the salutation moved to the
   greeting) and "Visa hela bilden". The brief, the greeting, the question and the box are D39's block, at least half
   the column high with the box at its lower edge; "Menar du", the areas and their cards come after it, so neither
   typing nor choosing an area moves the field. The day line is still the `Layout`'s footer.

Astryx only: `Layout`, `VStack`, `HStack`, `Icon`, `Text`, `Heading`, `ChatComposer`, `ToggleButton`, `Grid`,
`ClickableCard`. Tests: `tests/a11y/structure.spec.ts` (the greeting is text and the question
the one h1; the areas offered, their icons, nothing chosen at first, the cards of the chosen one, the box does not
move, axe; a read card opens its view and the area is still chosen when the panel closes; a card that is not a read
asks in the box from the keyboard), `tests/a11y/answer.spec.ts` (D39's cases, unchanged), `tests/a11y/reflow.spec.ts`
(the areas wrap at 320 px and the chosen area's cards come into view above the docked box), `tests/unit/connectors.test.ts` and `tests/unit/remote-connector.test.ts` (the icon from a bundled connector
and from a manifest; a name outside the list is refused). `tests/a11y/screens.landing.spec.ts` takes the pictures on
demand.

**Why.** The product owner asked for it on 2026-11-05 with the template's preview and a picture of its category row:
"Hi <username>", and the options included, "they will differ for our users though and be dynamic". The landing was
already said to follow this template (D34's artboard G), but it had a centred heading with no greeting, a one-line
field, and one flat row of at most eight buttons for everything a person may start. Weighed:

- **The categories as the areas** rather than a new grouping: the areas already are the person's own, role-scoped and
  administered grouping of what the connectors offer, and each already lists its standing actions. A second taxonomy
  ("Fråga", "Gör", "Hitta") would be the page's invention and would not change with the connectors.
- **The card's second line** from the source and the kind, not the capability's `description`: that text is written
  for the model ("Ange måndagen som from, annars denna vecka") and is not something to show a person. A line written
  for people would be a new manifest field; it can come when a connector needs to say more than its title.
- **The icon in the manifest** rather than a table of area ids in the page: the registry is the only place that names
  connectors (D20, D21), and D40 already settled that a connector names an icon and Clew draws it.
- **Centring the whole group as the template does** was weighed in D39 and left: the box would move when the cards
  appear and when "Menar du" does. The template's look is kept and D39's block holds the box.
- **The brief under the box, as one more category**, was left: the push is what the assistant brings unasked (D34),
  and a toggle would hide it until asked for.
- **The explanatory line under the old chips** ("Knapparna är anslutningarnas stående handlingar …") is gone: each
  card now says which system it belongs to and what it does. When the model is down the D8 banner still says that the
  buttons work.

Not taken from the template: the `@` menu button in the box's header (the field's `@` and the card's "Lägg till i
samtalet" are the ways in), the attachment drawer and the settings menu (Clew has neither), and the template's h2
greeting (item 1).

**Replaces.** D34's chips under the box ("the standing actions as chips", at most eight) and its centred heading;
narrows nothing else in D34. D39 and D36 stand; D39's "the chips and their line" now reads "the areas and their
cards", and its 760 px column is 720. Extends D40's icon list by two names and lets an area use it.
