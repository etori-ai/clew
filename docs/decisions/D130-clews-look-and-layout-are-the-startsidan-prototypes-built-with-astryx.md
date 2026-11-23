# D130 · Clew's look and layout are the startsidan prototype's, built with Astryx

**Status:** provisional (Oliver Borgström, 2026-11-18; first chosen 2026-11-11 and built on the branch `prototype-look`, PR #40, which did not land; accepted once a manager outside the team has used it) · **Date:** 2026-11-18 · **Area:** ui, product

**Decision.** Clew is drawn after the startsidan prototype's Version 1.0 for managers (the portal in
`startsidan-prototype/apps/portal`): its type, its form, its colours as an example theme, and its layout. It is built
with Astryx: the look through the theme (`packages/ui/src/theme.ts`, `packages/ui/src/styles.css`), the layout by
Clew's own components composed of Astryx's (`apps/web/src/components/shell/shell.tsx`, `nav.tsx`, `page-frame.tsx`,
`packages/site-header`). What a page holds is still
[D126](D126-one-page-per-thing-one-astryx-template-per-page-type.md)'s: one page per thing, a thing's name leads to
it, nothing opens over a page. The comparison this rests on is
[the prototype's Version 1.0 against Clew](../reviews/2026-11-11-startsidan-prototype-version-1-0-against-clew.md).

1. **Astryx only still holds.** The prototype is Tailwind, its own primitives and its own shell CSS; none of that comes
   into Clew. A Clew component is a composition of Astryx components. Where Astryx measures or draws differently,
   Astryx wins and the difference is recorded under "Astryx gaps"; an element drawn by hand is an exception named
   there, one at a time.
2. **Type.** Headings and buttons in Raleway at 800, body text in the system's `Arial, Helvetica, sans-serif`, on
   Astryx's scale at base 14: body text 14 px and supporting text 12 px, which the prototype's rows and lines also
   are (its 16 px is the document's default and its running text; measured in the running prototype on 2026-11-18).
   The headings are the prototype's: a page title 32 px, a section's or a card's heading 17 px with the level under it
   at 15, a key figure 30 px. A page title is 24 px below `md`, where Raleway's width would otherwise push a title's
   controls (the calendar's Förslag and Ny bokning) onto a row of their own. Raleway is
   built into the bundle (`@fontsource-variable/raleway`, OFL-1.1), in the web app and in the embedded header, so no
   font is fetched from another host: Astryx Neutral's `fonts.css`, which asked Google Fonts for Figtree on every page,
   is no longer imported.
3. **Form.** The container radius is 16 px with 8 and 6 inside it, and a card rests on the prototype's soft shadow as
   the low shadow, darker in the dark appearance.
4. **Colour stays an installation's own** ([D98](D98-the-installations-theme-and-logo-are-saved-in-clew-by-an-administrator.md)).
   The prototype's colours are an example of their own, `themes/startsidan-prototype/`: a tinted page under white
   cards, the identity blue as the accent, a lighter blue for the assistant on the info and blue roles, and the darker
   blue of the prototype's header on the inverted background. The dark appearance is derived; the prototype draws
   none. `themes/sundsvall/` and `themes/clew/` are unchanged. The header's band reads a theme's inverted background
   when it sets one, else the accent, so the band can be darker than the accent as the prototype draws it.
5. **What the theme adds to Astryx's components.** The current place and page in a `TopNav` marked with a line under
   the word instead of a filled pill; the secondary button on the card's ground with an edge and the accent's words;
   an `eyebrow` text type, small capitals that wrap, for a key figure's label; and the status colours as `Text`
   colours, so a figure's value is drawn in its tone's colour with its word under it (1.4.1).
6. **No rail.** The shell is the shared header and a centred column of at most 1280 px, on the header's lines. The
   band is on every page: the logo and the name, and at its end the search, the reminders and the person; under them
   the places the header connector lists ([D88](D88-the-web-app-draws-the-shared-header-and-an-administrator-owns-its-content.md)),
   where one answers. Where none does (no header connector is switched on) the band is the heading row alone, and
   Start stands first among Clew's own pages in the row under it (Oliver Borgström, 2026-11-18: until a header
   integration is on, Start moves down to the white row). The band and its places are the intranet's and are not
   changed. Under the band
   stand Clew's own pages, on every one of Clew's addresses: Att göra with its count, Kalender, for a manager Personal
   and Läget, Samtal, Administration for a person who holds a section of it, and at the row's end "Verktyg", a menu
   with the first tools and Alla verktyg. On a phone the header's own "Meny" lists every page and the places. Hem is
   the header's Start and the logo. The row marks the page that is open, Start on Hem and on a page opened from Hem;
   while a tool's page is open the menu's button is named by that tool, so the row still says where the person is.
   The person on the band opens their settings, and "Min sida" there leads to their own page, which the rail's foot
   led to before. Before the session is known the row already holds the pages every person has (Start and Att göra),
   so nothing under the header moves when the rest take their places.
7. **Hem is a board on the ground.** Its greeting, its line to ask and its cards stand on the page's ground, not on a
   sheet. In the prototype's order: the focus news, the unit's key figures, and then the board's two columns, the wide
   one with what needs the person and a narrow one of 360 px with the day and the news; under 1180 px they stand one
   under the other.
8. **Every page follows one pattern** (`PageFrame`). Where the window is wide, a page's way back, title, facts line,
   actions and tabs stand on the ground, on the header's lines, and what the page holds is a card under them. A
   register whose content is cards already (Att göra, Personal, Läget, Samtal, Alla verktyg) draws no card around
   them (`cards`); a page with a panel of the frame's (a thing's facts, Att göra's reading pane, the thing beside a
   conversation) keeps the frame's card, which those stand on. Every page stays in the shell's column, with or without
   a pane, so a title does not move when a pane opens. Hem and a register of cards scroll as one page under the
   shell's header, as the prototype's pages do, and nothing of them stays behind; a page with panels keeps its title
   while its column scrolls. A phone keeps the page as the window.
9. **A key figure** is drawn as the prototype draws one, on Hem (`lage.tsx`) and on the unit's page (`FigureTile`):
   the label in small capitals with an arrow when the tile leads somewhere, the value large in its tone's colour, and
   a line with the tone's word and the comparison. No badge, outline or tint.
10. **A floating "Fråga AI"** stands in the lower corner of every page but a conversation's, which has its box. It
    starts a new question about the page the person is on, as the rail's "Ny fråga" did; on Hem see item 14. It
    stands over the page, so three rules keep it out of the way (WCAG 2.2 AA, 2026-11-19): it is the last stop of
    the page for the keyboard; while the keyboard's focus is on a control that more than half lies under it, it
    stands in the other lower corner (2.4.11); and it is not drawn on a page that pins controls of its own at the
    window's foot (the review's decision, `PageFrame`'s `footer`), which it would lie over.

11. **A badge is a chip**, as the prototype draws one: 6 px corners, the heading face in bold, and for a status a
    tint with its colour's own words in place of a filled surface (error on red, warning on yellow, success on green,
    info on blue: Astryx's own pair for a tinted badge, the hue's text on the hue's ground, with the hue's border as
    the chip's edge). Every pair holds 5.9:1 or more in every example theme and both appearances, which
    `tests/unit/branding.test.ts` keeps. This replaces the filled red badge of
    [D63](D63-hem-is-drawn-as-the-canvas-draws-it.md) item 15.
12. **A line closes every page**: the site's name and the organisation the installation's logo names. It ends the
    column on a board and on a phone, and stands under the card elsewhere; a conversation has none.

13. **A board's blocks are cards with their heading inside** (`BoardCard`): the heading, how many it holds after it
    ("Behöver dig · 7") and the way to all of them on one line, and the content under it. A row that needs the person
    (`StatusRow`) stands on the ground's colour with a 4 px edge in its status colour, its title in bold, and at its
    end its due badge and "Öppna", the row's link. News is a card of rows with the headline in bold and the day first.
    The focus news is a card in the theme's blue tint: a line in small capitals saying what it is and when it was
    published, the headline large, and its buttons.
14. **The line to ask is one pill**, as the prototype draws its ask field: a round mark in the assistant's blue, the
    field, and "Fråga AI" inside it, on the card's ground with the card's shadow. The pill is a `Card` variant and the
    field inside it stands in a nested theme where it has no edge of its own, as the header's band is a nested theme;
    the pill shows focus with a 2 px outline that remains visible in forced colours. It takes the assistant's blue
    wherever that reaches 3:1 against the card and the theme's accent text colour elsewhere. The assistant's button is a `Button`
    variant, `ai`: a pill in the theme's info colour. The floating button of item 10 is the same button and reads
    "Fråga AI"; on Hem it is there too and leads to Hem's own line, which takes the focus, as the prototype's does.
    Hem then has two buttons that read "Fråga AI", so the floating one is named by what it does there ("Fråga AI:
    gå till frågefältet") for a screen reader.

15. **The band's end and a key figure's foot.** On the band the person is their name in bold over their unit with a
    mark that the row opens something, and the reminders' count is a badge beside the bell. Each is named by what
    it shows and what it opens (2.5.3): "Testa Testsson, Skönsmons skola, inställningar", "Påminnelser: 2". A key
    figure names the area it is from on a line of its own under its status.

16. **Personal is the prototype's register.** Over it the unit's key figures (`KeyFigure`, the tile Hem's figures
    share): how many people it lists, and for each lens how many of them need the reader, in that need's colour,
    leading to the lens. Under them one card with its heading inside, "Medarbetare" and how many, the search under the
    heading, and the table inside the card's inset, so its first column stands under the heading. The measures are
    the prototype's, read in its running page: 24 px between the figures and the card, 65 px rows (the table's
    `spacious` density), 40 px initials. A person's initials stand on the identity colour (the theme's accent with
    its `on-accent`), in every avatar, and the register's column headings are small capitals. The columns themselves
    are still what an administrator chose from the sources (D62), and a value without a tone is still ordinary text.
17. **A place of its own opens with a trail**: the site's name and the page, Astryx's `Breadcrumbs`, over the title.
    A page reached from another keeps its named way back (D116).
18. **A page's facts line is running text** under its title, 17 px in the softer ink with the prototype's air around
    the title; Hem's day line stays the small line it is.

19. **Att göra is the prototype's Mina aktiviteter.** Over the list the piles as key figures: what needs the person,
    how much of it is overdue, what waits on others and what is done, each leading to its pile, a plain count in the
    identity colour and a status in its own. Under them one card with its heading inside, the pile's name and how
    many it holds, the filters under the heading, and the table inside the card's inset with the register's rows.
    Beside the reading pane the figures are not drawn and the list stands in the frame's card without one of its own.
    The piles are still tabs and a row still opens beside the list (D112); the prototype stacks its piles as cards of
    rows with "Öppna".

20. **Läget and Samtal are registers of the same kind.** On Läget what to take up and each group of units is a card
    with its heading inside and, for a group, how many units it has, the table inside the card's inset with the
    registers' rows; on a phone a card per unit under the group's heading, as before. Its column headings stay in
    ordinary letters, since a measure's name can be one long word that spaced capitals push out of its column. On
    Samtal the conversations are one card, "Dina samtal" and how many, the table inside it, a list on a phone. The
    prototype's Min AI, a full-window mode with the conversations in a column of their own, is not taken: it is the
    conversation's question, below.

**Not taken yet.** The prototype answers a question under the field on its start page and keeps conversations in a
full-window mode; Clew still opens the conversation's page ([D125](D125-a-conversation-can-be-handed-to-another-systems-assistant-and-nothing-follows-the-question.md),
[D128](D128-another-systems-assistant-is-talked-to-beside-the-conversation-and-the-box-only-goes-to-clew.md)). The
dot before a chip's word is not drawn: Astryx's `Badge` is one component for a status and for a count, and a dot
belongs to the first only, so it waits for the two to be told apart where they are used. "Anpassa startsidan" is not
built. The prototype's suggestions under the ask field are not drawn (D126 rule 8 took Hem's away). A piece of news
carries no lead and no picture in Clew's news contract, so the news card and the focus news show neither. Clew's own names stand: Att göra, Samtal, Behöver
dig.

**Astryx gaps.** Recorded here, not filed (the product owner decided on 2026-11-04 that Clew sends no gap reports).

- The rule the prototype draws between the logo and the site's name is not drawn: Astryx's vertical `Divider` takes
  no height in a `TopNavHeading`'s logo slot, and the slot holds nothing else that draws a line.
- Astryx places nothing in a corner of the window: `Button` has `elevation`, which the `ButtonFloating` template
  uses, and no position. The floating button of item 10 is that button in one element with one inline `style`
  (`position: fixed` and its two insets, `apps/web/src/components/shell/assistant-corner.tsx`), and the same file
  holds the rule that moves it off the control the keyboard is on (it reads where the focus is when the focus
  moves). This is the exception `CLAUDE.md` asks a decision to record before anything custom is written; nothing
  else is positioned by hand.

**Why.** Oliver Borgström asked on 2026-11-18 for the same look and layout as the startsidan prototype, and whether
to build Clew's own components for it. Composing Clew's components from Astryx's keeps the rule that makes Clew one
system an outside municipality can theme and maintain, and keeps Astryx's keyboard, focus and role handling under
every surface; components drawn from nothing would give the same pixels and end both. Every page reaches Astryx
through `@clew/ui`, so a component that has to be replaced is replaced there.

**Replaces.** The rail of [D126](D126-one-page-per-thing-one-astryx-template-per-page-type.md) (its item 10, the
sheet beside the rail of item 12 and the pane at the sheet's far edge, Hem's order and tile on its board) and of
[D112](D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md) item 1; the type sizes
of [D71](D71-three-type-levels-and-an-area-mark-whose-colour-is-the-system.md) and
[D48](D48-one-next-step-the-rest-one-step-away.md) (their three levels and one filled button stand); Neutral's Figtree
in [D46](D46-astryx-neutral-is-the-default-theme.md); "typography, motion, radii" staying Astryx's in
[D38](D38-municipal-branding-uses-astryx-themes.md), for typography and radii.


**Amended 2026-11-23: what a phone changes.** The reference is drawn for a wide window; the review of the phone view
([review](../reviews/2026-11-23-the-mobile-view.md)) found four places where following it there worked against the
person, and the product owner asked for them to be put right.

1. *The band is one row down to 320 px.* On a phone the band's controls, "Meny" included, are marks alone, each a
   44 px target on a touch screen, standing edge to edge (item 6). With "Meny" labelled and gaps between them the row
   needed exactly 375 px, so under that the controls fell to a second row.
2. *Hem's work comes before Läget on a phone* (item 13). The reference has the key figures first; one under the other
   they are a screen, which put "Behöver dig" a screen and a half down on the page that exists to show it.
3. *A key figure has a row to itself under 480 px* (`FigureRow`). Two to a row, as the reference has them, left each a
   154 px card: a value broke over two lines, and a label was clipped behind a scrollbar of the card's own (1.4.10).
4. *The floating "Fråga AI" is the mark alone on a phone* (item 14): a round 48 px button named "Fråga AI". With its
   label it was 139 px wide and lay over a row's "Öppna", a figure's value or a heading wherever the page stood.
