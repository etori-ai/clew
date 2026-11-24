# D142 · An item reviewed row by row has one page, which is its review, and a row's button names the next press

**Status:** provisional (the product owner chose it on 2026-11-21 from the canvas "Clew · card or straight to the work": "Yes B", then "Yes build as drawn, row buttons too". Built on the branch `review-is-the-item-page`, cut from `assistant-beside-every-page`, the same day; see "As built". Accepted when a person outside the repository has attested invoices from Hem, met a refused row and reviewed it again, and a manual screen-reader pass has been made over the page before and after sending. The number is taken again from the generated index when the change lands on `main`. It amends [D73](D73-the-review-is-a-page-in-the-shell-with-an-address.md), item 2 of [D70](D70-one-press-confirms-on-the-row-and-rows-with-a-document-are-reviewed-one-at-a-time.md), items 1 and 13 of [D126](D126-one-page-per-thing-one-astryx-template-per-page-type.md) and item 13 of [D130](D130-clews-look-and-layout-are-the-startsidan-prototypes-built-with-astryx.md)) · **Date:** 2026-11-21 · **Area:** ui, product

**Context.** Three invoices to attest were two pages for one thing. From Hem, "Öppna" led to the item's page, whose
notice said "2 fakturor attesterade, 1 avvisad" with the button "Visa granskning", which led to the review's page
(`/items/<threadId>/review`, D73 as amended 2026-11-12). The three invoices were drawn three times: in the notice, under
"Rader" on the item's page, and again as the review's steps and under its "Hittills". The review's title was "Visa 3
rader" where the item was "Attestera 3 fakturor", and a row was "Misslyckades" on one page and "Avvisad" on the other.
The product owner: "it seems a bit redundant to have to show a card first and then the granskning. What can we do to
improve this? In general, sometimes a card might be needed and sometimes not, explore and investigate."

The canvas "Clew · card or straight to the work" (https://claude.ai/artifact/3jw2peQtyD2erW8swALoQk) drew the rule for
when a card's page is the landing place, and three ways for the invoices: A, the row leads straight to the review and
the item's page stays behind the name; B, the review is the item's page; C, both pages kept and the item's page says
nothing twice. With the recommendation of B and the rule for rows, the product owner chose B, saw it drawn from the real
components (four boards: before sending, after, twelve rows, a phone) and said "Yes build as drawn, row buttons too".

**Decision.** General, for every source, never per domain.

1. **One page.** A work item whose decision is reviewed one row at a time (an execute marked `review: 'each'`, D70 item
   2) has one page, `/items/<threadId>`, and that page is the review, before the decision is sent and after it. There
   is no page of the review beside it. The name of the item leads there from every row, pane and answer, as for any
   thing (D126 rule 1). An item with no such decision keeps the page it had.
2. **What the page holds.** In the header the way back to where the item was opened, the item's own title as the
   page's heading and the tab's, its due badge, "Inget skrivs förrän du skickar" until it is sent, and at the end of the
   title's line ⋯ with what else the item offers (its reads, "Inte nu", "Avfärda", the state's other moves) before
   "Fråga AI". Under the title the item's status notice once something has happened, then the rows. In the column one
   row at a time: what was decided or answered on it, its name, its facts and its document. In the end panel the item
   about itself: "Uppgifter", then "Varför ser jag detta?" and "Händelser", folded; it follows the row in the column
   where the window is narrow or the assistant's pane has the end slot. In the pinned footer, until it is sent, the
   decision's buttons and on the last step the one button that writes.
3. **The rows are drawn once.** Below five rows they are the steps (`Stepper`), with "Skicka" last until it is sent,
   and there is no list of them beside the steps. From five rows the steps give way to a progress bar with the way
   between the rows under it, and the rows are a list named "Rader" at the top of the end panel, before the facts. The
   item's own "Rader" section and the review's "Hittills" are gone from this page.
4. **After sending the page stays.** It shows what the source answered: the notice under the title, each step with
   "Bekräftad", "Avvisad", "Obekräftad" or "Inte skickad", no last step and no footer. Where the source refused rows,
   the notice's one move is "Granska avvisade igen" (D80), which puts the new item's page in this one's place. A
   decision the source confirmed whole shows the check for a moment first, as before.
5. **The address.** `step` is the step, 1-based, rewritten in place, so Back leaves the item. An address that names no
   step opens where the next press is: the first row not yet judged, or once it is sent the first row the source
   refused or left unanswered. `/items/<threadId>/review`, `?review=<threadId>` over a page and
   `/cards/<threadId>/review` lead to the item's page at the step they named.
6. **A row's button names the next press and leads to where it is made** (Hem's "Behöver dig", `rowStep`). "Granska N"
   for an item reviewed row by row, "Fortsätt granska" at the first row not yet judged once it is begun, and "Granska N
   avvisade" where the source refused rows of a decision already sent: all three lead to the item's page. One press
   with nothing to read first (D70 item 1: an execute that neither asks nor says beforehand what it writes, and takes
   no chosen rows) is the action's own label and runs from the row, through the item's own path (D45/D47); the row then
   keeps its place with the receipt and the toast offers Ångra, as Hem already does for a receipt that arrives.
   Everything else is "Öppna": the next step is on the item's page (several ways forward, something to read, nothing to
   decide, a state to read).
7. **The name is the way to the page wherever the button is not.** On a row whose button runs, the item's title is the
   link to its page. On every other row the button is the row's one link, as D130 item 13 has it.

**Why.** The item's page was a stop on the way to the one surface the item is worked on, and it showed the same rows
with less on each. A names the stop and passes it, but keeps two pages for one thing, which D126 rule 1 set out to end.
C keeps the stop. B removes it: the steps are the rows, so the three lists become one, and the same address is the
item before, during and after its decision, which is also what the receipt of D70 wants (the answer where the decision
was made). The review's own address was D73's answer to a dialog that could not be linked to; the item's address
answers that as well, with the step in it.

For rows, "Öppna" on every row said nothing about what waits behind it. The rule is the one D48 gave a card (one next
step, the rest one step away), applied to the row: the button says the step, and the page is the landing place only
when the step is made there.

**Not as drawn.** Four things are built that the boards do not show, and one is worded otherwise.

- On a phone, below five rows, "‹ 2 av 3 ›" stands under the steps: at that width the steps are a bare track with
  no names and no controls, and a row already judged, or another row of a sent decision, could not be reached (2.1.1).
- From five rows "Översikt" stands beside "x av N bedömda": without it the last step is a press per row away.
- Once sent, "Underlaget visar källans nuvarande version." stands over the document. The review's header said it
  before, and it is true of what the person reads.
- Below five rows a visually hidden status says "2 av 3" when the step changes (4.1.3); the steps draw it.
- The boards say "Attesterad" on a confirmed row. The page says "Bekräftad", the review's word for every source: the
  action's verb has no participle Clew can form.

**Not built, and open.** In Att göra's reading pane, beside a conversation and in an answer the narrow item is as it
was: its "Rader" with a link per row, "Granska N" and "Visa granskning" now lead to the item's page. There a row still
says "Klart" and "Misslyckades" (the status vocabulary of D126 item 13) where the page says "Bekräftad" and "Avvisad".
Whether the pane should say the page's words, and whether "Visa granskning" is still the right name for a link to the
item's page, is the product owner's to say. Att göra's rows have no button and are unchanged.

**Astryx.** `Stepper` and `Step`, `ProgressBar`, `LayoutFooter`, `Banner` through `StatusNotice`, `DropdownMenu`,
`MetadataList`, `Collapsible`, `List`, `VisuallyHidden`, `Card`, `Button`, `Link`, in `PageFrame`. Nothing custom, no
new dependency, no gap.

**Replaces.** D73's page of the review beside the item's (its address leads to the item's page); D70 item 2's "the
card's next step is then Granska N, and it opens the review" in so far as the review was another surface than the
item; D126 item 1's composition for this kind of item (the read in the column is the row, the facts' panel also holds
the two folded sections) and item 13's "Visa granskning" on the item's page; D130 item 13's "Öppna" as the one word on
a row of "Behöver dig". What is written, when, and through which endpoint does not change.

## As built

- The page: `ReviewedItem` in [review.tsx](../../apps/web/src/pages/review.tsx), drawn by
  [item.tsx](../../apps/web/src/pages/item.tsx) for an item with a reviewed decision. The item's parts come from
  [work-item.tsx](../../apps/web/src/components/work/work-item.tsx) (`useWorkItem`, `ItemAbout`, `Notes`, `dueBadge`)
  and its notice and ⋯ from `ActionRow` in [card.tsx](../../apps/web/src/components/work/card.tsx), which draws them
  apart there (`part`) and takes the notice's move on that page (`retry`).
- The address: [review-address.ts](../../apps/web/src/review-address.ts) (`reviewHref` and `documentHref` give the
  item's page; `atStep`, `namesStep`, `formerReviewPage`), the route in [main.tsx](../../apps/web/src/main.tsx).
- The row: `rowStep` in [row-step.ts](../../apps/web/src/row-step.ts), `NeedRow` in
  [need-row.tsx](../../apps/web/src/components/work/need-row.tsx), `StatusRow`'s `open` and `action` in
  [status-row.tsx](../../packages/ui/src/components/status-row.tsx).
- Evidence: [the address](../../apps/web/tests/review-address.test.ts), [the row's step](../../apps/web/tests/row-step.test.ts),
  browser scenarios in [review](../../tests/a11y/review.spec.ts) and [documents](../../tests/a11y/documents.spec.ts).
  Not verified with a screen reader.
