# D73 · The review is a page in the shell, with an address

**Status:** accepted, built 2026-11-07 on `main` as a page, rebuilt the same day as a drawer (see the amendment), and on a phone as a sheet stacked over the card's sheet (see the second amendment) · **Date:** 2026-11-07 · **Area:** ui

**Decision.** The review of several rows one at a time ([D70](D70-one-press-confirms-on-the-row-and-rows-with-a-document-are-reviewed-one-at-a-time.md)
item 2) is no longer a fullscreen `Dialog` over Hem with state of its own. It is a page in the one shell, with the
rail beside it and an address of its own, so a person sees where they are in the flow and a link can lead straight to
it. The product owner asked for this on 2026-11-07, looking at Granska 3 rader on the dev stack: the separate screen
is right, but it should keep the app shell with its navigation (or be a modal) so the flow is understood, and it must
have a URL. The page was chosen over the modal: a page is what [D42](D42-a-tool-opens-as-a-page.md) already makes of
anything that takes the whole column, the rail then says where the person is and the way back, and an address is
natural to a page where a modal would carry one as an afterthought.

1. **The address** is `/cards/:threadId/review`, with the current step as `?step=<n>` (1-based, the rows in the
   card's order, the last step Skicka; left out for the first). English, plural collection ([D43](D43-addresses-are-english.md)).
   Moving between steps rewrites `step` with `replace`, as a view's controls rewrite `input` (D42), so the browser's
   Back leaves the review rather than walking the steps. Opening the address directly, from a link or a reload, shows
   that step; a `threadId` that is not a card with a review, or a step out of range, says so in Swedish on the page
   with the way to Hem, as a tool that does not exist does.
2. **The page** (`apps/web/src/pages/review.tsx`) is the `Shell` with Hem current in the rail, the review's title as
   the page's `h1` and in the document title ("Granska 3 rader"), and under it what the dialog drew: the subtitle with
   the card's title and "inget skrivs förrän du skickar", the mark row (area chip, source, "n av N"), the `Stepper`, the
   row's document beside its decision, and the last step's summary. Its composition follows Astryx's `form-wizard`
   page template (a horizontal progress track above, one step at a time at the full content width) read through
   `bunx astryx template form-wizard`, with the `checkout-wizard` template's two-column step where the document stands
   beside the decision; the footer keeps Föregående and Nästa. The `Dialog`, `DialogHeader` and the `isOpen` state go.
3. **The way in and out.** "Granska N" on the row and on the open card is a link to the page. "Spara och stäng" and
   Esc lead back to the card beside Hem (`/?card=<threadId>`) with the decisions carried as the card's selection, and
   the focus lands on "Granska N" again, as it did when the dialog closed. Skicka runs the same execute through the same
   decision endpoint (D45/D47) from the page, keeps its loading state until the source has answered, and then leads
   to `/?card=<threadId>`, where the row keeps its place with the receipt (D70 item 1) and the card shows it (item 3).
   Nothing about what is written, or when, changes.
4. **On a phone** the page is the same page: the rail is the shell's drawer, the document and the decision stack.
   D70's note that the phone's `BottomSheet` is a later polish is withdrawn; a page needs none.

**Why.** A fullscreen dialog hid the rail and the address bar said `/?card=…` while the person was somewhere else: the
dialog could not be linked to, reloaded into, or placed in the flow by looking at the shell. A modal with an address
was weighed: Astryx's `form-wizard-dialog` template is for "two to four short steps where losing the context underneath
would cost more than the flow is worth", and the review is the opposite case, a flow that takes the whole screen with
a document per row; under a fullscreen modal the context is lost anyway, so the modal only adds the chrome that says
"you have not left" where the person plainly has. A page in the shell says it plainly.

**Astryx.** `Shell`, `Layout` with `LayoutContent` and `LayoutFooter`, `Stepper` and `Step`, `Grid`, `Card`,
`Lightbox`, `Button`, `Badge`, the `form-wizard` and `checkout-wizard` templates as the models. Nothing custom and no
new dependency.

**Replaces.** D70 item 2's fullscreen `Dialog` and its "the dialog's own state" in `card.tsx`; D70 item 2's phone note.
D70 items 1, 3 and 4, the protocol fields and the receipt flow stand.

**Tests.** `tests/a11y/review.spec.ts`: Granska leads to `/cards/fakturor/review`, the page's `h1` and document title,
the steps as before with `?step=` following them, Skicka leads back to Hem with the row's receipt; Esc on step 2 leads
back to `/?card=fakturor` with the decisions as the selection and the focus on "Granska 3"; a direct open of
`/cards/fakturor/review?step=2` shows the second row; an unknown card says so. `screens.pattern.spec.ts` captures the
page instead of the dialog. No axe violations on the page at desktop and phone widths.

**Built.** The route `/cards/:threadId/review` in `apps/web/src/main.tsx`, inside `Protected` beside `/tools/:capability`;
the page `apps/web/src/pages/review.tsx`, which took over everything `ReviewDialog` drew (`apps/web/src/components/review.tsx`
is deleted); the address and the state handed back in `apps/web/src/review-address.ts`. The card's review state is gone
from `useThreadActions` in `apps/web/src/components/card.tsx`: "Granska N" is an Astryx `Button` with `href`, and the
running of an action is `useCardAction`, which the card, the row and the page share, so Skicka goes through the same
confirm, `api.act`, settle and error as a press on the card. The page waits until the answer has come to rest and then
leads back with `replace`, as Spara och stäng and Esc do, so Back from the card goes where the person was before the
review. Three things the decision did not name. The decisions ride back as router navigation state
(`{ review: { threadId, selected } }`) on the entry for `/?card=<threadId>`, where the card seeds its selection and puts
the focus on its "Granska N" a frame after the panel has focused its heading; a reload of that entry keeps them, a new
visit does not. Hem's first reading of the threads is a baseline (D70), so a receipt that came while the review was on
screen would have drawn neither the row's moment nor the toast: `expectReceipt` in `apps/web/src/linger.ts` names the
card, and Hem's first reading counts it as arriving; the linger's timer is no longer cleared when the threads are read
again or when StrictMode runs the effect twice, which would have kept the row in place for good. The pinned header of
the `form-wizard` template (title, mark row, Stepper) is pinned on a desktop only; on a phone and on a short screen it
scrolls with the step, so the document is not left a strip under it. The template's footer zones with an inline
`flexBasis` were not copied; the footer is the dialog's `HStack` with `justify="between"`. Evidence:
`tests/a11y/review.spec.ts` (6 cases), `screens.pattern.spec.ts` with `CLEW_SCREENS=1`, `bun run check`.

**Amended 2026-11-07, the same day: an overlay over Hem, not a page of its own.** The product owner saw the page on the
dev stack and preferred an overlay ("Clicking close is weird on a page. Maybe it can be a right sidebar overlay or from
the left/bottom"), with the close as an ✕ icon rather than the words "Spara och stäng". The address and everything
about what is written and when stand; only the surface changes:

1. **The review is an Astryx `Drawer` from the end edge over Hem**, wide enough for the document beside the decision
   (a desktop width budget of about 1040 px, the shell's rail and the column's edge still in sight behind the scrim),
   composed as the `Drawer` docs say: a `Layout` with `DrawerHeader` (its title "Granska N rader", its subtitle the card's
   title and "inget skrivs förrän du skickar", `onOpenChange` so it draws the one ✕ close button, named "Stäng, Esc"),
   the mark row, the `Stepper`, the document beside the decision in `LayoutContent`, and Föregående and Nästa in the
   `LayoutFooter` with the sentence "Esc sparar och stänger …" that says closing keeps the decisions. Under 640 px the
   drawer keeps Astryx's page reveal; no `BottomSheet`, since the steps need the height.
2. **The address is the same**: `/cards/:threadId/review?step=<n>` is the route, and it draws Hem with the card beside
   the column (as `/?card=<threadId>` does) and the drawer open over it, so the row says "öppet bredvid" under the
   scrim, a link or a reload lands in the review, and the step still rewrites `step` with `replace`.
3. **Closing** (✕, Esc, the scrim) leads to `/?card=<threadId>` with the decisions as the card's selection and the focus
   on "Granska N", as the page did; Skicka waits for the source's answer and then leads there too. "Spara och stäng" as
   words is gone: the ✕ is the close, and the footer's sentence says what closing does.
4. **D70 item 2's phone note stands withdrawn**; the drawer is the same on a phone.

The page of items 1 and 2 above was built and replaced within the day; its route, address rules and tests carry over to
the drawer. Weighed and left: a centred `Dialog` (the document wants the height and the width of a side overlay, and a
fullscreen one hides the shell the owner asked to keep), a `BottomSheet` (block-axis sheets are for touch, and the
steps need the height), the page (replaced by this amendment).

**Built as a drawer.** `/cards/:threadId/review` is now one of the start routes in `apps/web/src/main.tsx`, the same
element as `/` and `/conversations/:id`, so opening and closing the review never remounts Hem or the card under it.
`reviewOf` in `apps/web/src/review-address.ts` names the card the route reviews; `StartPage` (`apps/web/src/pages/start.tsx`)
then reads its address as `/?card=<threadId>`, so the card stands in the panel and the row says "öppet bredvid", and
draws `ReviewDrawer` (`apps/web/src/components/review-drawer.tsx`, which takes over everything the page drew;
`apps/web/src/pages/review.tsx` is deleted): `Drawer side="end"` with a width budget of 1040 px, a modal `dialog` named
by its title, `DrawerHeader` with the subtitle and `onOpenChange`, the mark row, the `Stepper` and the document beside
the decision in `LayoutContent`, Föregående, Nästa and the footer's sentence in `LayoutFooter`. Six things differ from
the amendment or were not in it. The ✕ is named "Stäng", Astryx's own name for it (`@astryx.dialog.close`, shared with
every Dialog), not "Stäng, Esc": `DrawerHeader` takes no label for it, and overriding the catalogue key would rename every
dialog's close. The drawer opens once the threads have been read, not before with a loading state of its own: where the
card under it is itself a drawer (below 1336 px) or the phone's sheet, the overlay shown last stacks on top, so the review
opens in the same commit as the card and after it; until then Hem draws its own loading state under the address. Closing
lets the drawer slide away first and only then leads to `/?card=<threadId>` (on the dialog's `close` event): while the
drawer is modal the page is inert and the card could not take the focus. The card stood under the drawer all along, so
`useThreadActions` in `apps/web/src/components/card.tsx` takes the handed-back selection, and `ActionRow` the focus on
"Granska N", once per history entry that carries them rather than only when the card is drawn. With Hem drawn under
the review its own reading sees the receipt arrive; `expectReceipt` is still called and is now belt and braces. A row's
heading and the summary's are level 3 under the drawer's h2. Evidence: `tests/a11y/review.spec.ts` (7 cases: the flow
and Skicka at 1280 px with the card as a drawer under the review, Esc, a direct open with a reload and ✕, an unknown
step and card, a card without a review, the card beside the column at 1440 px, the phone with Astryx's 56 px reveal,
reflow at 320 px), `screens.pattern.spec.ts` waiting for the drawer, `bun run check`.

**Amended a second time 2026-11-07: the phone.** The product owner opened the review on an iPhone SE (375 × 667). The
card there is Astryx's `BottomSheet` with "‹ Hem" and ✕ on its first row (D71, artboard 12), and "Granska 3" opened the
desktop's side `Drawer` over that sheet with Astryx's 56 px page reveal: a 319 px column with the document, the row's
heading, Attestera, Lämna kvar and Hoppa över wrapping onto three lines, and the footer's sentence with Föregående and
Nästa taking a third of the height. Their words: "On mobile, either we use stacked from the bottom sheets, astryx added
this lately, or navigation within the sheet." Decided:

1. **On a phone the review is a `BottomSheet` with `height="tall"`, stacked over the card's sheet.** "On a phone" is the
   same `mobileQuery` (767 px and narrower) where the card is a sheet. This is Astryx's documented drill-in: "open the
   next sheet over the current one and keep each sheet's isOpen where its data lives". The card's sheet recedes beneath
   (scaled and lifted, inert and hidden from assistive technology while covered), and the stack keeps one scrim. The
   sheet is `purpose="info"`, so a downward swipe, the scrim and Esc close it as the ✕ does, and it keeps the padding the
   card's sheet has (the theme's default). Inside it is the drawer's composition: a header row with the title as the
   sheet's h2 and the ✕ at the end (the sheet has no header of its own, so the row is composed as the card's sheet
   composes its first row), the subtitle under it, the mark row, the `Stepper` (it collapses to a segmented track with
   the step's label under it, `collapsedVariant: 'withLabel'`), the document above the decision (the `Grid` stacks), the
   summary on the last step, and Föregående and Nästa in the footer. The ✕ has the name Astryx gives the drawer's,
   "Stäng".
2. **The footer's sentence "Esc sparar och stänger …" is dropped on the phone.** A touch screen has no Esc, the height is
   the document's, and the decision's own line ("Beslutet sparas som markering på kortet. Inget skrivs till … förrän du
   skickar i sista steget.") and the subtitle already say that nothing is written until Skicka.
3. **The address and the flow are unchanged.** `/cards/:threadId/review?step=` draws Hem with the card in its sheet and
   the review's sheet over it; closing leads to `/?card=<threadId>` with the decisions as the card's selection and the
   focus on "Granska N" in the card's sheet; Skicka as before. A cold open of a step opens both sheets in one update, and
   Astryx then stacks them in tree order, so the review is written after the card's sheet.
4. **The first amendment's "no `BottomSheet`, since the steps need the height" is withdrawn.** A `tall` sheet is a
   pinned, near-full panel (about 92 % of the viewport), and over the card's sheet it mirrors the desktop: the review
   over the card it came from.

Weighed and left: **navigation within the card's sheet** (the review replacing the card inside one sheet). It would
hide the card entirely, and the sheet's "‹ Hem" back row would take a second meaning ("back to the card" inside the
review, "back to Hem" on the card), while a stacked sheet keeps the card in sight beneath, as the desktop keeps it beside
or under the drawer, and is what Astryx ships for a drill-in. **A sheet that replaces the card's** (Astryx's "replacing a
sheet") was not chosen for the same reason: the card would leave the screen.

**Built as a sheet on the phone.** `apps/web/src/components/review-drawer.tsx` is renamed
`apps/web/src/components/review-overlay.tsx` and `ReviewDrawer` is `ReviewOverlay`, since it is a drawer or a sheet:
on `mobileQuery` it renders `BottomSheet height="tall" purpose="info"` with the label "Granska N rader", else the
`Drawer` as before. The header is `LayoutHeader` with the `Heading` and an `IconButton` ✕ on the phone, `DrawerHeader`
on a desktop; `Review` drops the footer's sentence on the phone. `StartPage` (`apps/web/src/pages/start.tsx`) renders
`ReviewOverlay` after the card's sheet, so a deep link stacks the review on top. Closing works as the drawer's did: the
sheet slides away, its dialog closes, and only on the dialog's `close` event does the overlay lead to `/?card=<id>`; the
sheet's `ref` is its panel, so the overlay listens on the panel's enclosing dialog. Astryx returns the focus into the
card's sheet it reveals, and the card puts it on "Granska N" from the handed-back state as before, so the focus lands
there after a review opened from the card and after a cold open alike (seen in the suite and on the dev stack; which of
the two placed it first was not told apart). The verb keeps the focus on each step (a frame after the
step, as on the desktop) and carries `data-autofocus`. Three things the amendment did not name. The decisions, the step
and the leaving state live in `ReviewOverlay` above the surface, so a resize across 768 px swaps the drawer for the sheet,
or back, and keeps them; but opened in the commit of the swap, or one commit later, the new surface came out beneath the
card's own (the card's sheet or drawer on top, measured in both directions), so after a swap the review opens a frame
later. A `close` event while the address still names the review is the swap and ends nothing. On a phone a step opens on
its document, the heading "Underlag från …" taking the focus, not on the verb: focusing the verb scrolled the sheet so
that on 667 px of height the document was above the fold when a step opened, and the document is what a review is for;
the verb is a thumb's reach under it, and Enter is not the way on a touch screen. The drawer keeps the verb, with room
for both. Evidence:
`tests/a11y/review.spec.ts` (9 cases; the phone's two assert the review as a dialog with `data-sheet-stack="top"` over
the card's sheet `covered` and inert, the focus, the steps with `?step=`, Esc and ✕ back into the card's sheet at
`/?card=fakturor` with the selection and the focus on "Granska 3", a cold open of `?step=2`, no axe violations; one more
narrows a desktop review to a phone and keeps the step and the decisions; 320 px reflow), `screens.pattern.spec.ts` with
`CLEW_SCREENS=1` (`pattern-phone-review`, `pattern-phone-review-step-2`), `bun run check`.
