# D115 · Clew's look is the startsidan prototype's, drawn through the Astryx theme on D112's layout

**Status:** provisional (Oliver Borgström, 2026-11-11 and 2026-11-12; built through the theme; accepted once a manager outside the team has used it) · **Date:** 2026-11-11 · **Area:** ui

**Decision.** Clew looks like the startsidan prototype's Version 1.0 for managers (the portal in
`startsidan-prototype/apps/portal`, run with the cookie `startsidan-version=1.0`), and keeps the layout
[D112](D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md) gives it: the rail, Hem,
Att göra, the work item, the one panel. The look is reached through the theme alone (`packages/ui/src/theme.ts`,
`packages/ui/src/figure.tsx`, `packages/ui/src/styles.css`), with Astryx's own tokens and its documented
`variant:value` extension, so it follows every surface D112 draws without changing what any surface holds. The
comparison this rests on is
[the prototype's Version 1.0 against Clew](../reviews/2026-11-11-startsidan-prototype-version-1-0-against-clew.md).

1. **Astryx only still holds.** The prototype is Tailwind, its own primitives and its own shell CSS; none of that comes
   into Clew. Where Astryx measures or draws differently, Astryx wins and the difference is recorded below.
2. **Type.** Headings and buttons in Raleway at 800, body text in the system's `Arial, Helvetica, sans-serif`, on
   Astryx's scale at base 14; a page title one step larger (29 px). Raleway is built into the bundle
   (`@fontsource-variable/raleway`, OFL-1.1), in the web app and in the embedded header, so no font is fetched from
   another host: Astryx Neutral's `fonts.css`, which asked Google Fonts for Figtree on every page, is no longer imported.
3. **Form.** The container radius is 16 px with 8 and 6 inside it, and a card rests on the prototype's soft shadow as
   the low shadow, darker in the dark appearance.
4. **Colour stays an installation's own** ([D98](D98-the-installations-theme-and-logo-are-saved-in-clew-by-an-administrator.md)).
   The prototype's colours are an example of their own, `themes/startsidan-prototype/`: a tinted page under white
   cards, the identity blue as the accent, a lighter blue for the assistant on the info and blue roles, and the darker
   blue of the prototype's header on the inverted background. The dark appearance is derived; the prototype draws
   none. `themes/sundsvall/` keeps the published palette. The header's band reads a theme's inverted background when
   it sets one, else the accent, so the band can be darker than the accent as the prototype draws it.
5. **What the theme adds to Astryx's components.** The current place and page in a `TopNav` marked with a line under
   the word instead of a filled pill; the secondary button on the card's ground with an edge and the accent's words;
   a `suggestion` button, a pill in the assistant's blue; an `eyebrow` text type, small capitals that wrap, for a
   key figure's label; the status colours as `Text` colours, so a figure's value can be drawn in its tone's colour
   with its word beside it (1.4.1); and `status-*` variants of the vertical `Divider` for an edge in a status colour.
6. **A key figure** (`FigureTile`) is drawn as the prototype draws one: the label in small capitals with an arrow when
   the tile leads somewhere, the value large in its tone's colour, a line with the tone's word and the comparison, and
   last the area and the view it opens. No outline or tint for a figure that needs the person: its word and colour say
   so.

**Withdrawn the same day.** This record first also took the prototype's layout: no rail, the start page as the
prototype's board with Mina aktiviteter at `/activities`, Min AI at `/conversations`, a floating "Fråga AI" on every
other page, and a trail and closing line on every page. It was built on the branch `prototype-look` (PR #40) while
`main` took D112, which rebuilds the same surfaces on Astryx's templates from another reference. Merging the two on
2026-11-12, Oliver Borgström asked for the better of them; D112's layout was kept, being the product owner's choice
for the structure and the more complete of the two (Att göra, the work item, one panel with the assistant, a news
feed), and the prototype's look was carried over onto it. The layout half is gone from the code; this paragraph is
its record.

**Astryx gaps.** Recorded here, not filed (the product owner decided on 2026-11-04 that Clew sends no gap reports).
The prototype's one-line pill of a question box is not drawn: the box is Astryx's `ChatComposer` as it is.

**Why.** The reason given was that the prototype is the truth right now. Building its look with Astryx keeps the
rule that makes Clew one system an outside municipality can theme and maintain; bringing in the prototype's own
components would give the same pixels and end it.

**Replaces.** The type sizes of [D71](D71-three-type-levels-and-an-area-mark-whose-colour-is-the-system.md) and
[D48](D48-one-next-step-the-rest-one-step-away.md) (their three levels and one filled button stand); the tile's
drawing in [D54](D54-figures-come-from-connectors-and-laget-draws-them.md); Neutral's Figtree in
[D46](D46-astryx-neutral-is-the-default-theme.md).
