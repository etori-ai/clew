# Hem against the canvas, artboard by artboard · 2026-11-06

The product owner asked on 2026-11-06 for Hem to match the canvas **Clew startsida · dagen i ett svep**
(https://claude.ai/artifact/9xn43bAwXy2VioBqiG3xc6) pixel for pixel, and for anything the drawings show without a
capability behind it to be asked about rather than invented or dropped. The outcome is
[D63](../decisions/D63-hem-is-drawn-as-the-canvas-draws-it.md). This review is the side-by-side comparison it asks for:
every artboard that was built, at the artboard's own size, element by element.

## Method

- Each artboard's HTML (`project/<name>.dc.html` of the artifact) was rendered to a PNG at its own size, 1440 × 1120
  for the desktop boards (1240 for F, 1000 for G, 1300 for J) and 390 × 844 for the phone, in the suite's Playwright
  image, with the fonts the artboard asks for (Inter from Google Fonts).
- The page was captured at the same sizes with `CLEW_SCREENS=1 … playwright test -c tests/a11y screens.hem`
  (`tests/a11y/screens.hem.spec.ts`: A, B, E, G, I at 1440, D and K at 390), on the suite's fixtures
  (`tests/a11y/data.ts`), which is why the words differ: the fixtures are Testa Testsson at Skönsmons skola on
  Wednesday 4 November, with "Attestera 3 fakturor, 48 200 kr" where the artboard has Hillevi Berg and Skanska.
- The two images were read side by side, and every element compared for position, size, spacing, type, colour,
  border, radius, icon, order and wording. Computed sizes were read from the page with a probe (font sizes, paddings,
  the spacing scale: 1 = 4 px, radius-element 10 px, radius-container 12 px, element-sm 28 px, element-md 32 px).
- The comparison was repeated after every change until nothing visible was left that Astryx can draw differently.

## A · Hem for a manager (1440 × 1120)

| Element | Artboard | Built | Verdict |
|---|---|---|---|
| Rail | 272 px, grey, "Startsidan" 18/700 with the bell, black "Ny fråga" 40 px wide as the rail, pill search, Hem row with home icon and the badge "2 i dag", Verktyg, Samtal under "I dag"/"I går", Alla samtal, Administration and the person's row at the foot | Astryx `SideNav` 260 px, grey, the same heading and bell, `Button variant="primary"` "Ny fråga" full width, `Typeahead` search, Hem with `HomeIcon` and `Badge variant="error"` "1 i dag" (the fixture has one card due), Verktyg with the tools the person has, Samtal grouped under "I dag" and "I går", Alla samtal, the person's row | Matches except the rail's 12 px and the person's row (an icon, no initials; no role word: asked) |
| Lead | h1 "Hej Hillevi" 16/600 with the sparkle; "Onsdag 5 november · vecka 45 · Skolan" at the line's end in the secondary colour | `Heading level={3} accessibilityLevel={1}` "Hej Testa" 16.8/600 with `SparklesIcon`; "Onsdag 4 november · vecka 45 · Skönsmons skola" at the end | Matches (16.8 against 16 px; the sparkle is black, Neutral's accent, against the artboard's blue) |
| The box | one line, 16 px radius, model button bottom left, mic and the round send bottom right, 12/14 px padding, full content width | `ChatComposer` balanced, one line, model menu, mic, send; the column's width, since the day beside it is a foldable panel (D63 item 14) | Differs on purpose: the product owner asked for a sidebar that folds and opens, which a grid track cannot |
| Tabs | Behöver dig 4 · Väntar på andra 2 · Inte nu · Klart 1, the count a neutral pill, 2 px underline on the chosen, "Alla områden ▾" ghost at the end, one line under both | `TabList` with `Badge variant="neutral"` as `endContent`, "Inte nu" without a count when empty, the `DropdownMenu` ghost button "Alla områden", one `Divider` | Matches (the badge is 20 px high at 13/500 against 22 px at 12/600) |
| Group heading | "Nu · 2" 16/600, caption 12 px secondary at the end of the line, 6 px to the rows | `Heading level={3} accessibilityLevel={2}`, `Text type="supporting"` caption, `VStack gap={1.5}` | Matches |
| Nu | a card with a red border on a faint red ground, rows with a 56 px day cell holding the red "i dag", the title in semibold, the line "Ekonomi · förfaller i dag · …", "Lägg till i samtalet" ghost and the black "Granska 3" | `Card variant="red"` with the tokens of D63 item 12, `List edge="flush"`, the day cell as `VStack width={56}` with `Badge variant="error"` "i dag", `Link` title, the line "Budget · Fakturorna förfaller i veckan", ghost and primary `Button size="md"` "Attestera 2" | Matches |
| Jag föreslår | "✦ klart" / "✦ utkast" info pills in the day cell, secondary "Visa förslaget" | `Badge variant="info"` "✦ klart" on the proposal, "✦ utkast" on a draft, the connector's secondary next step | Matches |
| Senare | "fre" in the day cell, rows fenced by lines, secondary "Granska" | the day word from `dayWord` ("13 nov", "20 nov", "20 dec" on the fixtures), lines, the next step | Matches |
| Läget | heading "Läget · Skolan" with the caption; four tiles with a dot, a figure and a line or a bar | not drawn: the product owner chose to leave Läget out until D54 decides where the figures come from | Left out on the product owner's word |
| I dag | a card, "I dag" 16/600 with "Hela veckan" 12/500 underlined; rows with a 52 px time, the name in semibold and "Personalrummet · 30 min · underlaget ligger i samtalet"; gaps as "Ledigt till 12:30" with "Längsta luckan · jag bokar inget här utan att fråga", dashed line above | `Card padding={4}`, the heading and `Link hasUnderline`; `List edge="flush"` rows with the time cell, "Rektorsmöte", "A12 · 1 tim · underlaget ligger i samtalet" as a link to the conversation that pointed at the meeting, "från kortet …" to the card whose confirmed proposal made it; "Ledigt till 12:00" with the longest-gap line | Matches except the dashed line (Astryx gap); "förberedelsen är klar" has nothing to read from |
| Sedan i går | a muted card, a green dot before "Sedan i går", three sentences in the secondary colour, "Allt som är klart" underlined | `Card variant="muted"`, `StatusDot` and the heading, the sentences from the cards, their receipts and the sources ("2 klara: attesterade fakturor, kvitto läst från ekonomisystemet 09:00 och …", "2 väntar på andra: … (1 av 2 har svarat) och …", "Nästa genomgång i morgon 06:00."), `Link hasUnderline` | Matches (the sources sentence appears only when the read reports its sources, which the fixtures do not) |
| Under Läget | nothing | nothing: the areas of D41 are not drawn with work on Hem | Matches (the product owner, 2026-11-06) |

Measured differences that remain, all Astryx's: Figtree against Inter; the rail 260 against 272 px; the content's top
padding 24 against 28 px; body 14 px and supporting 11.7 against 12 px; headings 16.8 against 16 px.

## B · The same page on a quiet day (1440 × 1120)

| Element | Artboard | Built | Verdict |
|---|---|---|---|
| Hem badge | green "lugnt" | `Badge variant="success"` "lugnt" | Matches |
| Lugnt läge | a card on a faint green with a green border, a 40 px circled check, "Lugnt läge" 18/600, one sentence ("Alla fyra källor svarade i natt 06:00. Två saker väntar på andra och kommer tillbaka när de svarar. Nästa genomgång i morgon 06:00, eller tidigare om något händer."), links "2 väntar på andra · 1 klar i dag · Vad jag bevakar" | `Card variant="green"` with D63's tokens, `Icon size="lg"` check, `Heading level={3} accessibilityLevel={2}` (16.8 px), the sentence from the sources' status, the waiting count and the review, the two count links | Matches except the circle (gap), 16.8 against 18 px, and "Vad jag bevakar" (asked, left out) |
| Det du kan göra | heading with "Dina områden · varje kort fungerar utan modellen"; toggles with the first pressed; six muted cards in three columns | not drawn: the product owner saw the toggles on the dev stack and asked for the section to go | Left out on the product owner's word |
| I dag, Sedan i går | as A, with "i morgon" as a last row | as A; tomorrow's meetings are not in the day's read | Matches except the "i morgon" row (no read; listed) |

## E · A card beside the column (1440 × 1120)

| Element | Artboard | Built | Verdict |
|---|---|---|---|
| The box | the card as a token in the drawer, "Om kortet · Ny fråga i stället" on the token's line, the field with the question | `ChatComposerDrawer` with the card as a `Token`, "Om kortet" and "Ny fråga i stället" in the header slots, the placeholder "Fråga om kortet …" | Matches except that Astryx draws the scope line above the drawer, not beside the token |
| The open row | grey ground, 8 px radius, "öppet bredvid" on the line, ✕ "Stäng kortet" as the one control | `ListItem isSelected` (Astryx's current-row ground), "· öppet bredvid", `IconButton` "Stäng kortet" | Matches |
| Other rows | the next step alone | `compact`: "Lägg till i samtalet" is not drawn beside the panel | Matches |
| Läget | two tiles a row, no caption, no bottom line | `Grid` of two, no caption | Matches, except that the bottom line stays (the artboard drops it only for want of room; the figure's comparison is kept) |
| The panel | 440 px, a line on the left, 20/24/32 px padding; "KORT" small capitals, "Inte nu" and ✕ at the end | `LayoutPanel width={440} hasDivider`, `padding={6}`; `Heading level={4} accessibilityLevel={2} color="secondary"` "Kort", `CardTimeAction` "Inte nu" and the ✕ | Matches except "KORT" (gap) |
| The card | "i dag" pill and "Ekonomi · ekonomisystemet"; the title 20/600; the lead sentence; a bordered card with three checkbox rows (number and name in semibold, the sum at the end, a 12 px line, the deviating one with a warning pill); "Attestera 2 valda" black 36 px, "Påminn mig", "Lägg till i samtalet"; the 12 px line on what happens; "Varför nu?" and "Avtalet Skanska 2025 · 2 träffar" as disclosures in cards | the same state line; `Heading level={2}` 20.2 px; the summary; `Card` with `CheckboxList` rows, label semibold, detail under; `Button size="lg"` "Attestera 2 valda", "Öppna i ekonomisystemet", "Lägg till i samtalet", ⋯; the line "Attestera skrivs till ekonomisystemet och läses tillbaka som kvitto. Ångra i 10 minuter. Fungerar utan modellen."; "Varför nu?" as a `Collapsible` in a card with `useAnimatedLayout` | Matches except the sum at the row's end (the contract has no amount field; the sum sits in the label) and the cited contract (asked, left out) |

## G · A question from Hem (1440 × 1000)

| Element | Artboard | Built | Verdict |
|---|---|---|---|
| Header | the question as h1 16/600; "Startat av dig 07:36 · från Hem" and "Stäng samtalet ✕" | the title as the drawn-small h1; "Startat av dig 09:00"; `Button` "Stäng samtalet" with the ✕ after the words | Matches except "· från Hem" (a conversation's origin, D50: not built) |
| The turns | the question in a filled bubble; the answer with "Assistenten · läste Mitt team · i dag ur personalsystemet 07:36" and the sparkle, the text, the compact view with "Öppna bredvid" and "Öppna som sida", a question with two buttons | the bubble; the answer named "Assistenten · läste Personalsystemet" with the sparkle, the text, the follow-up as buttons; a declared view would be the embed of D38 | Matches on what the fixture answers (no declared view in the mock) |
| The box | 800 px centred, "Det här samtalet · Ny fråga i stället", the model, mic, send | the box at the width of the transcript, "Det här samtalet · svaret kommer under frågan", "Ny fråga i stället", no shortcut | Differs on purpose: the product owner asked for the conversation at Hem's width (D63 item 11) |
| Width | the transcript 32 px in from the rail, the box centred at 800 px | the header, the transcript and the box 40 px in from the rail, as Hem's content | As asked |

## I · A view as a page (1440 × 1120)

| Element | Artboard | Built | Verdict |
|---|---|---|---|
| Header | "Mitt team" 22/600 with "Personalsystemet · 23 medarbetare i Skolan · uppdaterat 07:36 · öppnad från samtalet i går" under it; at the line's end a 240 px search, "fre 7 nov ▾", "Alla hus ▾", "Visa: frånvaro ▾" | `Heading level={2} accessibilityLevel={1}` "Telefonbok" (20.2 px) with "Telefonboken" under it; the view's search at 240 px with its label hidden and its choice as a `Selector variant="secondary"` at the line's end | Matches on what the view declares (one search, one choice); the count, the time and the origin are not in a view's read (listed) |
| Table | in a bordered card, 32 px in from the rail, a footer line "8 av 23 · sorterat efter hus" | Astryx `Table` in a `Card padding={0}`, 32 px in; "14 rader · Telefonboken. Inget av det sparas på Startsidan." under it | Matches except the footer's place (under the card, not inside it) |
| The box | at the foot, "Hassan Ali" as a token with "Om kortet · Om Mitt team · Ny fråga i stället" | at the foot, "Telefonbok" as a token, "Fråga om Telefonbok …" | Matches on the page's box; the open row's card is the panel of D50 |
| The panel | "MEDARBETARE", initials, the person's facts and the connector's actions | the row's own view as the connector declares it (D38) | On what the connector declares; the actions on a person (artboard I) wait for a connector that offers them (listed) |

## D and K · The phone (390 × 844)

| Element | Artboard | Built | Verdict |
|---|---|---|---|
| Top bar | ☰ at the start, "Startsidan" centred, the bell at the end | Astryx `AppShell`: "Startsidan" and the bell at the start, ☰ at the end | Astryx gap |
| Lead | "Hej Hassan" 15/600 with the sparkle, "Onsdag 5 nov · v. 45" at the end | "Hej Testa", "Ons 4 nov · v. 45" | Matches |
| Mina pass | the 7-day shift strip | not built: no connector declares a schedule read (asked) | Left out |
| Cards | one card per thing, 14 px radius, the pill and the area on the first line, the title 16/600, one line, 44 px buttons | `GenericCard` with the same state line, title, lead, rows and 44 px buttons under a coarse pointer | Matches on the cards the fixtures have (the artboard's "Semester kvar i år" balance has no read; asked) |
| Footer | three chips over the docked box | the docked box | Chips asked, left out |
| K, the sheet | the card as a bottom sheet with tabs Kortet/Avtalet over the conversation | on a phone Hem draws its cards in the list (D50); the card's own read opens as a `Drawer` | The tabs are not built (asked) |

## What was asked and left out

The twelve questions put to the product owner on 2026-11-06 are answered in D63 under "Asked and answered". Two
changed what was built: Läget is off Hem until D54, and a meeting's row links to the conversation or the card behind it.
"Det du kan göra" went entirely on a later word.

## What this review does not claim

A manual pass with a screen reader of the new rows, the panel's header and the quiet page is owed. The comparison was
made on the suite's fixtures, not on the fixture connectors of the development stack, and in the light appearance only.
