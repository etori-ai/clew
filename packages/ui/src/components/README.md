# Clew's components

A Clew component is a composition of Astryx components. It draws nothing of its own: no element written by hand, no
CSS, no second component system (`CLAUDE.md`, D130). This folder holds the ones that know nothing of Clew's data or
its router, so any page can use them and `@clew/ui` exports them beside Astryx's own. A component that reads a query,
the address or the session lives in the web app (`apps/web/src/components`, grouped by what it belongs to; see its
`README.md`).

| Component | File | Made of | For |
|---|---|---|---|
| `BoardCard` | `board-card.tsx` | `Card`, `Heading`, `HStack`, `VStack`, `Text`, `Skeleton`, `VisuallyHidden` | A card with its heading inside, how many it holds after it, an action at the end of that line, tools under it and the content. `list`, `flush` and `bare` say how the content is inset; `isHeadingHidden` keeps the heading and the count for a screen reader where what stands over the card already says them in view (Att göra's tab on a phone) |
| `KeyFigure` | `key-figure.tsx` | `Card` or `ClickableCard`, `Text`, `Icon` | A key figure: the label in small capitals, the value in its status colour, a line and a foot |
| `StatusRow` | `status-row.tsx` | `Card` (the theme's `row-*` variants), `Text`, `Link`, `Button` | A row that needs the person: an edge in its status colour, the title, its badge and the button that names the next press ("Öppna", "Granska 3"); where that button runs on the row, the title is the link (D142) |
| `FigureRow`, `PersonAvatar`, `registerTable`, `SECTION_GAP`, `CARD_GAP` | `measures.tsx` | `Grid`, `Avatar`, props for `Table` | The measures pages share (`docs/reference/layout-measures.md`) |
| `FigureTile`, `FigureLine`, `FigureTileSkeleton` | `figure.tsx` | `Card`, `ClickableCard`, `ProgressBar`, `Badge`, `StatusDot` | A figure as a connector declares it, drawn from `figure-items.ts`: with a bar, a silent source or a sentence. The unit's page uses it |
| `StatusNotice` and the status vocabulary's parts | `status.tsx` | `Banner`, `Badge`, `StatusDot`, `Spinner`, `Button`, `DropdownMenu` | One state said the same everywhere (D126 item 13), from `status-words.ts` |
| `AreaChip`, `AreaGlyph`, `AreaLine`, `SystemSwatch` | `mark.tsx` | `Badge`, `Icon` | The mark of an area and its system (D71) |
| `CompletionMark`, `CompletionFeedback` | `completion.tsx` | `Icon`, `Text`, `HStack`, `VStack` | That something was done |
| `MetricView`, `SeriesView`, `ActivityView` | `presentation.tsx` | `Card`, `Grid`, `List`, `Table`, `Badge`, `Text` | A connector's declared presentation (D38) |
| `UntrustedMarkdown` | `untrusted-markdown.tsx` | `Markdown` with its `components.image` | Markdown Clew did not write (an answer, another system's assistant's, a source's text view): an image is drawn as its alternative text, so nothing is fetched from an address the text names |
| `EnglishWords` | `../index.tsx` | `InternationalizationProvider` (`locale="en"`) | A page Clew writes in English (the protocol pages, D60): Astryx's own words in it, a copy button's or a tab list's, are English too (WA-L13) |
| `SwedishPart` | `../index.tsx` | `InternationalizationProvider` with Clew's Swedish catalogue, around a `span` or `div` that carries only `lang="sv"` | A Swedish part of an English page (a sample of what Clew draws, a word of its interface quoted in a sentence): read as Swedish (3.1.2), with Astryx's words in it in Swedish. The element draws nothing: Astryx has no component that marks a part's language (`bun run astryx search lang`) |

`FigureTile` and `KeyFigure` draw the same kind of thing from two models. They become one when the unit's page is
gone through against the prototype.

## Outside this folder

| What | Where | Why it is not here |
|---|---|---|
| The theme, and every value it adds to an Astryx component | `../theme.ts`, typed in `../theme-variants.ts` | A look, not a component. `theme-variants.ts` is the only file that augments an Astryx module |
| The calendar family | `../calendar.tsx`, `../calendar-embeds.tsx`, `../week-agenda.tsx`, `../calendar-theme.css` | The one sanctioned second library (FullCalendar, D27), kept in its own files |
| The document reader | `../document.tsx`, `../document.css` | Draws PDF pages and office files with their own libraries |
| The shared header | `packages/site-header` | A package of its own: the intranet embeds it without the web app |
| The shell, the page frame, the navigation, the floating "Fråga AI" | `apps/web/src/components/shell` | They read the session, the address and queries |

## What is written by hand

Each is an exception a decision records. A new one needs its own line in a decision before it is written.

| What | Where | Decision |
|---|---|---|
| One inline `style` that places the floating button in the window's corner | `apps/web/src/components/shell/assistant-corner.tsx` | D130, Astryx gaps |
| The installation's logo as a native `img` with its measure | `apps/web/src/components/shell/shell.tsx`, `packages/site-header/src/site-header.tsx` | D37, D38, D39 |
| The calendar's stylesheet, in Astryx tokens only | `../calendar-theme.css` | D27 |
| The document reader's stylesheet and class names | `../document.css`, `../document.tsx` | D79 |
| Page basics: the root's height and the body's ground | `../styles.css` | D31 |

## Adding one

1. Run `bun run astryx search <words>` and `bun run astryx template --list` first (the script runs Astryx's CLI in this
   package, where it finds the components). If Astryx has it, use that.
2. Compose it from Astryx components imported from their own modules (`@astryxdesign/core/Card`), never from this
   package's index, which would import itself.
3. Give it props for what varies. A measure a page would otherwise set goes in `measures.tsx`.
4. Export it from `../index.tsx` and add its row to the table above.
5. A value the theme must add for it (a `variant`, a text type) goes in `../theme.ts` and is typed in
   `../theme-variants.ts`.
