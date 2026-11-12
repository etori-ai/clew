# D115 · The startsidan prototype's Version 1.0 is the reference for Clew's look and layout, built with Astryx

**Status:** provisional (Oliver Borgström, 2026-11-11: "the prototype is the truth right now"; every item is built on the branch `prototype-look`, with the differences listed under "Built", and the accessibility specs are not yet rewritten for items 4 to 6; accepted once a manager outside the team has used the rebuilt start page) · **Date:** 2026-11-11 · **Area:** ui, product

**Decision.** Clew is redrawn after the startsidan prototype: the portal in `startsidan-prototype/apps/portal` as it
runs in its Version 1.0 for managers (`apps/portal/src/shell/version.ts` there). The prototype replaces the design
canvases as the reference a screen is compared with. Oliver Borgström chose this on 2026-11-11, with five answers
that set the scope: the look is built with Astryx, the layout follows as well as the look, the running Version 1.0
is the reference and not the older static sheet, everything Clew does today stays and is drawn in the prototype's
style, and the conversation works as the prototype's does. The comparison this rests on is
[the prototype's Version 1.0 against Clew](../reviews/2026-11-11-startsidan-prototype-version-1-0-against-clew.md).

1. **Astryx only still holds.** The prototype is Tailwind, its own primitives and 555 lines of shell CSS; none of
   that comes into Clew. The look is reached through `defineTheme`, Astryx components and Astryx layout. Where Astryx
   measures or draws differently, Astryx wins and the difference is recorded under "Astryx gaps" below, never styled
   around. The result is close to the prototype, not identical to it.
2. **The theme carries the form; the installation's file carries the colour.** `clewBaseTheme`
   (`packages/ui/src/theme.ts`) sets headings and buttons in Raleway, body text in the system stack
   `Arial, Helvetica, sans-serif`, the container radius at 16 px with 8 and 6 under it, the prototype's card shadow as
   the low shadow, and a card that rests on that shadow. Raleway is built into the bundle, so the request to Google
   Fonts that Astryx Neutral's `fonts.css` makes for Figtree is gone. Colour stays an installation's own
   ([D98](D98-the-installations-theme-and-logo-are-saved-in-clew-by-an-administrator.md)): the prototype's tinted page,
   white cards, borders, ink and blues go into `themes/sundsvall/theme.tokens.json`, and Neutral keeps its own colours
   on the same form. The header's band reads the theme's inverted background when a theme sets one, else the accent,
   so the band can be darker than the accent as the prototype draws it. Dark appearance stays, although the prototype
   has none; its colours are derived and held to the contrast pairs.
3. **No rail.** The shell is the shared header and a centred page of at most 1280 px. The header's band and its row
   of places are untouched, since they are the intranet's and must look as the intranet draws its own. The third row,
   under Start, is Clew's own: Mina aktiviteter, Min AI, Kalender, Personal for a manager, the approved tools with the
   rest under "Fler verktyg", and Administration for an administrator. Its links move inside the app without a page
   load. On a phone the header's own menu lists the places and those pages.
4. **The start page is the prototype's.** From the top: the greeting, the ask field with its mark and "Fråga AI",
   suggestions as pills while the field is empty, the answer under the field, a row of key figures drawn from Läget's
   figures ([D54](D54-figures-come-from-connectors-and-laget-draws-them.md)), and two columns: "Att agera på" with what
   needs the person, then Mina ärenden and Mina åtgärdspunkter when they hold something, and beside them I dag and
   Sedan i går. The tabs Behöver dig, Väntar på andra, Inte nu and Klart, with the area filter, move to a page of
   their own, Mina aktiviteter at `/activities`. A status is a badge or the colour of one value, never a tinted
   surface.
5. **The conversation is the prototype's.** A question asked on the start page is answered under the field and the
   address stays `/`. Conversations have a full-window place, Min AI at `/conversations`, with a narrow bar in the
   band's colours, the list of conversations at the start and the transcript beside it; the panel still holds what a
   conversation is about. On every other page a floating "Fråga AI" in the lower corner opens the assistant in a
   modal panel over the page, with the field, the answer and the way on to Min AI. The docked field on tool pages
   goes. A proposal is still executed only through the human decision endpoint; nothing in the server changes.
6. **Every page follows one pattern.** A trail, the title, one line of meta, then the content in cards with a
   heading row: the title and its count at the start, a link at the end.
7. **An exception to the freeze.** [D101](D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md)
   holds new surface back until the first real integration works. This work is excepted from it by the same person's
   word on the same day, for what is listed here and nothing more: no new owned domain, entity kind, view kind,
   presentation field or administration page comes with it. Mina aktiviteter and Min AI are existing content at a new
   address.

**Not carried over.** The prototype's focus news and its news card, because Clew has no news source: a notice carries
a title and a text, and an image, a lead, a sender and a link are new fields that
[D100](D100-the-vision-is-narrowed-to-what-clew-can-keep-today.md) asks a decision of its own for; the start page
keeps the place. The prototype's "Anpassa startsidan", which needs storage of its own. Its demo menu, its feature
tour and its material bar. Its Dialogstöd module, which Clew has no counterpart to.

**Astryx gaps.** Recorded here as they are met, not filed (the product owner decided on 2026-11-04 that Clew sends
no gap reports).

- A row has no border of its own to colour, so the edge at the start of a row that needs the person is Astryx's
  vertical `Divider` in a variant the theme adds (`status-error`, `status-warning`, `status-info`, `status-success`,
  `status-neutral`), 4 px wide and as tall as the row's first line, not the row's whole height as the reference
  draws it. The reference's tinted ground under each row is not drawn.
- Astryx places nothing in a corner of the window: `Button` has `elevation`, which the `ButtonFloating` template
  uses, and no position. The floating "Fråga AI" of item 5 is that button in one element with one inline `style`
  (`position: fixed` and its two insets, `apps/web/src/components/assistant-corner.tsx`). This is the exception
  `CLAUDE.md` asks a decision to record before anything custom is written; nothing else on the page is positioned
  by hand.
- `ChatLayout` keeps its content at the newest line and has no setting to start at the top. On a phone the board
  stands in it, under the docked box, and opened scrolled to its foot. `start.tsx` puts the board back at its top as
  each of its parts arrives, until the person scrolls, taps or types; nothing else of the layout is changed.
- The box is Astryx's `ChatComposer` as it is. The prototype's one-line pill with its mark and "Fråga AI" is not
  drawn; the model's name stays in the box's footer ([D36](D36-an-answer-is-drawn-as-it-is-written.md)).

**Drawn through the theme's own extensions** (2026-11-12, after the first build was compared with the prototype side
by side and found far from it: the theme and the pages' composition had changed, and every component still drew
itself as before). Astryx lets a theme add values to a component's props (`variant:value`, with a type
augmentation), and Clew already did so for two badges and a card. `packages/ui/src/theme.ts` now adds: the current
place and the current page in the header as a line under the word instead of a filled pill (`top-nav-item`,
`selected`); the secondary button as the card's ground with an edge and the accent's words; a `suggestion` button, a
pill in the assistant's blue, for what stands under the box; an `eyebrow` badge, small capitals, for a key figure's
label; the status colours as `Text` colours, so a key figure's value is drawn in its tone's colour with the tone's
word beside it; and the row's edge above. The header's rows are bounded to the page's 1280 px (`contentWidth` on
`SiteHeader`), and a header connector's logo is drawn on the band as it is, where the header used to lay a white
ground under it and hide a white mark.

**Built, and where it differs from the list above** (2026-11-12; items 1 to 6, on the branch `prototype-look`).

- Item 2: the prototype's colours are an example of their own, `themes/startsidan-prototype/`, and
  `themes/sundsvall/` keeps the published palette.
- Item 3: the administration's sections, which were rows in the rail, are tabs under the trail and a menu on a phone.
  The fixture's own pages under Start (`connectors/intranet/menu.json`) are still listed by the connector and not
  drawn by the web app. The panel beside the page keeps the breakpoints it had with the rail.
- Item 4: the day, the week and the unit stay as a line under the greeting. Mina aktiviteter has no row of counts
  above its tabs, since each tab carries its count. Mina ärenden is drawn for a person with a case system also when
  it holds no errand ([D90](D90-mina-arenden-is-a-section-on-hem.md)), because its own choice between what is
  assigned and what was reported stands in it. A row keeps one button, its next step; "Lägg till i samtalet" is the
  open card's. Sedan i går no longer repeats the figures.
- Item 5: the answer under the box is the conversation's own transcript in a card, so a second question asked there
  continues it; "Stäng" and Esc put it away. Min AI's list is a column from 768 px and a drawer on a phone; it has
  "Nytt samtal" and no search (the rail's search over conversations and cards is not rebuilt). The assistant's panel
  draws no card: a card an answer is about is named with a link to it on the start page, and a view an answer names
  opens in Min AI. On a tool's page a question asked in the panel still takes what the page shows with it
  ([D50](D50-the-conversation-is-the-column-and-the-panel-holds-what-it-is-about.md)). The cache inspector of the
  development build moved to the other lower corner.
- Item 6: Mina aktiviteter, Personal and a tool's page open with the trail from the start page; a person's and a
  unit's page keep the trail to where they were opened from ([D97](D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md)).
  Every page but the calendar and Min AI, which fill the window, is bounded to 1280 px with its gutters and closes
  with the line naming the site and whose view it is. On Mina aktiviteter a group's rows stand in a card. The pages
  get no key figures of their own, since no source gives any, and Personal keeps its Visa menu in place of the
  prototype's search and filter buttons. The calendar, a person's sections, the administration's pages and the
  sign-in page are redrawn by the theme alone.
- The accessibility specs for items 4 to 6 are not rewritten yet: they are done in one pass after item 6, on Oliver
  Borgström's word (2026-11-12), so the suite is red on this branch until then.

**Why.** The reason given was that the prototype is the truth right now. The review that day found the start page
grown to nine blocks in one flow with five frame zones around them, regions fenced in four different ways, and the
same figures drawn twice. The prototype is ordered where Clew was not (one navigation zone, one frame for every
region, one heading row), and its header is already the one Clew draws
([D88](D88-the-web-app-draws-the-shared-header-and-an-administrator-owns-its-content.md)). Two paths were weighed
for reaching it. Bringing the prototype's Tailwind and components into Clew would give the same pixels and end the
rule that makes the product one system an outside municipality can theme and maintain; building the look with
Astryx keeps that rule and costs exactness. The second was chosen.

**Replaces.** When each step is built, and not before:
[D63](D63-hem-is-drawn-as-the-canvas-draws-it.md) (Hem drawn as the canvas draws it) whole;
the layout of [D53](D53-hem-is-the-start-page-the-days-work-under-the-box-and-the-day-beside-it.md) (the tabs and
groups on Hem, no suggestions at rest) and of
[D72](D72-the-day-is-the-pages-and-the-panel-holds-only-what-was-opened.md) (the breakpoints that count the rail);
in [D50](D50-the-conversation-is-the-column-and-the-panel-holds-what-it-is-about.md), the rail, "the conversation is
the column", "the conversation is never in the panel" and the box on every page;
items 2 and 3 of [D88](D88-the-web-app-draws-the-shared-header-and-an-administrator-owns-its-content.md) where they
keep the rail and give the third row to the connector for the Start place;
the rail's surface in [D46](D46-astryx-neutral-is-the-default-theme.md);
the type sizes of [D71](D71-three-type-levels-and-an-area-mark-whose-colour-is-the-system.md) and
[D48](D48-one-next-step-the-rest-one-step-away.md), whose three levels and one filled button stand;
the width rule of [D42](D42-a-tool-opens-as-a-page.md) and the tile's drawing in
[D54](D54-figures-come-from-connectors-and-laget-draws-them.md).
[Interface spaces](../reference/interface-spaces.md) is rewritten with the step that removes the rail.
