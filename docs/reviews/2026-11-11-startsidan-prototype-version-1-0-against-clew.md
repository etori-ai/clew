# Review: the startsidan prototype's Version 1.0 against Clew · 2026-11-11

Status: a comparison with an outcome. The choice it led to is
[D115](../decisions/D115-clews-look-is-the-startsidan-prototypes-drawn-through-the-astryx-theme.md)
(provisional). The look is built through the theme; the layout half was built on a branch and withdrawn when it met
D112 (see Outcome).

## What was asked

Oliver Borgström, on 2026-11-11, first asked how the interface could be made less cluttered ("a great deal of
information is presented and the boundaries between components and sections are not clear"), then whether the
startsidan prototype had advantages worth taking, and then that the whole of Clew be ported to the prototype's look,
"the same", since "the prototype is the truth right now".

## What was looked at

- **Clew** on the development stack (`http://localhost:3020`, `main` at `265e01e`), signed in as the manager persona,
  at 1440 px in both appearances: Hem, Personal, a person beside the list.
- **The prototype** from `startsidan-prototype` at `a623404`: the portal (`apps/portal`, Next.js, Tailwind 4, its own
  primitives in `packages/ui`) run locally on port 3010 with the cookie `startsidan-version=1.0`, at 1440 px: the start
  page, Personal, Min AI, Dialogstöd, and an answer under the ask field. Its code was read for exact values. The
  older static sheet `docs/startsidan-prototyp-v3.html` was seen first and is not the reference: it draws a dark side
  panel that the running portal no longer has.

## What Clew's start page was

Nine blocks in one flow (the greeting, the box, the tabs with the area filter, Nu, Senare, Mina ärenden, Läget's
seven tiles, I dag, Sedan i går) inside five frame zones (the header's three rows, the rail, the column beside the
work). Four ways of fencing a region: Nu in a red-tinted card, Senare as bare rows between dividers, Mina ärenden as
a card with a toolbar, Läget as separate cards. "Behöver dig" or red in five places. "Lägg till i samtalet" on every
row, seven times. Three of Läget's figures repeated in Sedan i går. The badge "försenad" clipped to "förse…" in the
56 px day cell (`apps/web/src/components/card.tsx`).

## What the prototype's Version 1.0 is

Version 1.0 is a selection: the modules `agera`, `min-ai`, `personal`, `nyheter`, `fokusnyhet`, `dialogstod` and
`verktygslada`, for the role `chef`, without the placeholders the full prototype shows.

**The shell.** No side panel. A header that stays at the top from 1024 px: a band in `#003c69` with the logo, a rule
and "Startsidan" at the start and the bell and the person at the end; under it, in the band, the places as tabs
("Start" and the intranet's sections, the current one bold with a 3 px white line); and, on the start page and the
tool pages, a white strip with the tools (Mina aktiviteter, Min AI, Personal, Dialogstöd), the current one with a blue
line. Below 768 px a "Meny" button drops the places and the tools as one list. The content is a centred column of at
most 1280 px with 32 px at each side. A footer line closes every page. A floating "✦ Fråga AI" stands in the lower
corner; in the portal it only scrolls to the ask field, while the project site in the same repository has a corner
button that opens its assistant in a modal panel.

**The form.** The page is `#edf1f5`; a card is white with a 1 px `#dde3e9` border, a 16 px radius and a soft shadow
(`0 1px 2px rgba(31,31,37,.05), 0 12px 30px -20px rgba(31,31,37,.32)`). Radii are 6, 8, 10 and 16 px. Headings and
buttons are Raleway at 800, body text Arial; the sizes are 12, 14, 16 and 18 px with a 17 px card title, a 30 px key
figure and an 11 px uppercase eyebrow. Ink is `#1f1f25` and `#4a4a55`.

**The colour rules.** Blue (`#005595`) is identity: links, primary buttons, avatars. A lighter blue (`#1f64b8`) with
the mark ✦ is the assistant. Green, amber and red are status only, and a status is a chip, a 4 px edge at the start
of a row or the colour of one value, never a whole surface (the area cards of Dialogstöd are the one exception).

**The start page**, from the top: "God morgon, Kim!" as the one heading; the ask field as a white pill with the
mark, "Vad vill du göra?" and "Fråga AI"; suggestions as pills; the answer in a box under the field, with a chip
naming its kind, its source and "Stäng"; the focus news as a wide card with an image; a row of three key figures
(the label in small capitals with an arrow, the value large and coloured by status, a line with the status word and
the goal, a line with the source); "Anpassa startsidan"; and two columns, "Att agera på · 1" with "Visa alla" at
the start and "Nyheter" beside it.

**A tool page** (Personal): a trail, the title, one line of meta, four key figures, and one card "Medarbetare · 10"
with a search field, filter buttons with counts and a table whose cells carry chips.

**Min AI** is a full-window mode: a 52 px bar in the band's colour ("‹ Startsidan", a rule, "Min AI", the person),
a 280 px column with "Dina samtal", "+ Nytt samtal" and the conversations grouped by time, and the transcript with
its field at the foot.

## What differs in kind, not in paint

1. Clew has a rail and the prototype has none; the tools are the third row of the header.
2. Clew answers in a conversation that takes the column; the prototype answers under the field and keeps
   conversations in a mode of their own.
3. Clew's start page is the work list with tabs; the prototype's is a board of cards, and the full list is a page.
4. Clew's figures sit after the work as tiles with a status dot; the prototype's sit before it with the value coloured.
5. Clew has a dark appearance; the prototype has none.
6. Clew draws the header's band in the installation's accent; the prototype's band is darker than its accent.

## What Astryx has for it

Read with `bunx astryx` in the development container on 2026-11-11 (0.7.12): `Table`, `Avatar`, `Badge`,
`StatusDot`, `SegmentedControl`, `Breadcrumbs`, `ProgressBar`, `Stepper`, `Card` with `elevation`, `Section` (the
component Astryx names for a region of a page, where `Card` is for one discrete thing), the Chat family and the
templates `ai-chat-landing` and `ButtonFloating`. `defineTheme` takes the type families, the radius and shadow
tokens, colour tokens and component overrides. Nothing ready-made was found for a key figure tile or a news card
with an image; they are composed from `Card` and layout components. Astryx draws no coloured edge at the start of a
row. Astryx is MIT, supports Next.js and ships a bridge for Tailwind 4
(`@astryxdesign/core/tailwind-theme.css`), so the prototype could read the same theme if it were published as a
package; that is noted in D115's plan as later work, in the prototype's repository.

## What Clew lacks for it

A news source. `connectors/communication` answers notices with a title and a text and lists them by title alone;
no image, lead, sender or link. The focus news and the news card wait for a decision on those fields
([D100](../decisions/D100-the-vision-is-narrowed-to-what-clew-can-keep-today.md)).

## Two things found on the way

- Astryx Neutral's `fonts.css`, which `packages/ui/src/styles.css` imports, loads Figtree from Google Fonts when the
  page opens. The request is not in [the licence record](../reference/licences.md). D115 item 2 removes it.
- No lint or build step enforces "Astryx only, no custom CSS"; the rule is held by `CLAUDE.md` and by review.

## Outcome

[D115](../decisions/D115-clews-look-is-the-startsidan-prototypes-drawn-through-the-astryx-theme.md). The prototype's
Version 1.0 was first taken as the reference for both look and layout and built in five steps on the branch
`prototype-look` (PR #40): the theme, a shell without a rail, the start page as a board, the conversation in place
and in Min AI, and one page pattern. Meanwhile `main` took
[D112](../decisions/D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md), which
rebuilds the same surfaces on Astryx's templates. On 2026-11-12, merging the two, D112's layout was kept and the
prototype's look carried over onto it through the theme: the type, the form, the example colours, the theme's
extensions to Astryx's components and the key figure's drawing. A first sketch of a calmer Hem, made the same day,
was set aside and is not listed among the design canvases.
