# D47 · One next step on a surface, the rest one step away

**Status:** accepted, implemented · **Date:** 2026-11-05 · **Area:** ui

**Decision.** A surface says what is next and why, and everything else waits one deliberate step away. The product owner
approved this on 2026-11-05 after the review in `docs/reviews/2026-11-05-ux-review.md`, which measured the same surfaces
before and after a prototype.

1. **Type.** `clewBaseTheme` sets `typography: { scale: { base: 15, ratio: 1.2 } }` in `packages/ui/src/theme.ts`. Every
   profile inherits it. This is Astryx's own scale setting, not an override of a component.
2. **One filled button.** A row or a card has one visible next step. It is filled (`variant="primary"`, black in Neutral)
   only when the thread is due today: a level that is not `notice` and `streamGroup(thread, today()) === 'nu'`. Anything
   else that is a next step is secondary. So the overview has one filled button when one thing is due, and none when
   nothing is.
3. **Fler val.** Everything a row or card tucks away sits behind one `DropdownMenu` in compound mode (`DropdownMenuItem`,
   `DropdownMenuDivider`, `DropdownMenuSubMenu`) in `apps/web/src/components/card.tsx`: the remaining actions, Lägg till i
   samtalet, the two time pickers, Avfärda · inte aktuellt and Varför ser jag detta?. A card keeps Inte nu in view, a row
   does not. `MoreMenu` cannot hold a sub-menu, which is why the compound form is used. The assistant's page context
   (`apps/server/src/assistant/context.ts`) names the same places, so it does not point at a button that is not there.
4. **What a card prints.** The title, the reason as a line (`Varför: …`), and the rows. The area is a word, never a colour:
   the area dots and tints are gone from cards and from the rail, where a count (`Badge` when something is due today, a
   plain number otherwise) says the same with less. This changes D28's coloured reason and area.
5. **The overview.** One `h1`, one line, and an `InfoTip` named Så här hör jag av mig that holds what used to be a
   paragraph. Group headings stand alone, without captions, and are `h2`. The aside is Today and one Klart i dag row with
   its progress. Så här bevakar jag and Vid sidan av are gone from the overview. On a phone the figures come after the
   day's work. A position (`1 av 3`) is shown only when there is more than one.
6. **The rail.** Från mig has an icon on each row. A section Vid sidan av holds Pågår utan dig, Inte nu and Redan hanterat.
   One section Samtal holds the five latest. Nytt samtal is secondary, so the rail never competes with the page for the
   filled button.
7. **The box in the footer.** It has no scope line, no shortcut and no model menu (D34, D36 had them). Its placeholder says
   what it is: `Nytt samtal: skriv eller säg vad du vill göra …`. The scope line and model menu stay in the box on the landing
   and in a conversation, where the choice matters.
8. **The week agenda.** `WeekAgenda` uses `Grid columns={{ minWidth: 96, max: days }}` so it reflows instead of cutting
   Friday off, draws a booked event as text with its time, and its legend names only proposal and booked. A number of
   columns never reflows; the `{ minWidth, max }` form does. Same reason for `Lage`.
9. **A thread.** Lägg till i samtalet moves into the thread's own menu, Skicka N is secondary (it is not due, it is chosen),
   and an unplaced proposal is a line of text, not a token, since `Token` can neither wrap nor truncate.

10. **Under a finger.** The theme's `adaptations` raise every control to 44 px under a coarse pointer (HANDOVER §6), and list
    rows, segments and disclosure rows with them; a mouse keeps the compact sizes the screens were drawn with. By the
    pointer, not the width. Switch and InfoTip have Astryx's own touch layer. `tests/a11y/touch.spec.ts` measures every page.
11. **A conversation.** The title is an `h1` drawn small and capitalised, in a `LayoutHeader`, so it stands on the box's text
    edge. An answer's sentence says how much (`Sök i telefonboken: 2 rader.`), never where or when: the message's own line
    has both. A cited answer names its source once. The button under an answer is `Lägg under Behöver dig`, secondary, and
    a declared view's is `Visa allt`.
12. **The side panel.** `--color-overlay` is half of Astryx's, since the page behind it is still its context. A plain read
    says where it comes from (`GET /api/cap/:name` returns the connector's `source`) and writes a date as a date.
13. **A table when there is room.** A declared table starts at 1260 px beside the rail, so a 1280 px laptop has one row per
    person. Under that the list puts the numbers and the address on one wrapping line.
14. **Administration.** The filter carries the counts (`Problem 1`) and the tiles are gone, on both Anslutna system and
    Modeller. Ta bort stands at the far end of the row of actions. On a connector, what an administrator acts on stands open
    and the rest folds under Tekniska uppgifter. A form is at most 560 px, and a switch that applies at once stands apart
    from the form that waits for Spara. `Standard` is a neutral badge. Words: Funktioner for Förmågor, "systemet" for
    manifest, plain words for a connector's kind, `Startsidan` for Clew, and no "router" or "OpenAI-kompatibel" where a
    sentence can say what it means.
15. **The calendar.** A panel whose proposals are in another week says so first, with the way there. A week's meeting shows
    its name; the grid's axis says when, and the time stays for a screen reader. A phone has one row for the title and the
    booking and one for the rest. Boka says what is missing while it is greyed.
16. **Redan hanterat.** When and what are two choices, so this week's questions can be asked for. The time leads the line, so
    the times stand under each other.
17. **Pågår utan dig.** The Stepper holds the sum; the progress bar that said the same is gone.
18. **Appearance.** Samma som datorn is the first choice and the default (D39).
19. **Words.** Kort, never tråd. Nytt samtal, never Ny fråga, so the button says what it starts and matches Samtal and Stäng
    samtalet. Sammanfattning, never samling. A brief row has no `@`: on the landing it was one more thing to explain, and the
    box reaches what the page shows by `@` anyway.

**Not changed.** Inte nu and Påminn mig stay two sub-menus, each now saying what it does (`lägg undan`, `kortet ligger kvar`).
They are two behaviours, D28's pile and D17's timer, and merging them is a product decision, not a layout one. The answer's
text stands 36 px inside the box's edge: that is `ChatLayout`'s own spacious column, with no prop to change it. The 9.6 px
numeral in a Stepper's pending step is Astryx's.

**Why.** The review counted 78 tab stops, 42 buttons and 585 words on the overview at 1280 px, five filled buttons on it
and three on the landing, and most text at 12 px. With the rules above the same page has 59 stops, 26 buttons, 420 words,
one filled button, and most text at 13 to 15 px. Nothing is removed from the keyboard: `tests/a11y/card-actions.spec.ts`
walks every tucked action from the keyboard, sub-menus included. The alternatives weighed were a density setting
(a setting does not fix a default, and the default is what a rektor meets on a Monday) and shortening copy only (the
buttons, not the words, were what made every row shout at once).

**Replaces.** Amends D27 §6, D28, D29, D34, D36 and D39, each noted there. HANDOVER §6's slots for thread actions now read as
"one visible next step, the rest behind Fler val".
