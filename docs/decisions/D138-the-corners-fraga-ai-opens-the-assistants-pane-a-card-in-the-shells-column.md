# D138 · The corner's "Fråga AI" opens the assistant's pane, a card in the shell's column, and the conversation stands where the box is

**Status:** provisional (the product owner chose it on 2026-11-19 from the canvas "Clew · the assistant inside the prototype's look", thirteen artboards rendered from the real components of `main`, with "Yes, as drawn", and on 2026-11-20 added the door in a pinned footer with "Yes, in the footer". Built on the branch `assistant-beside-every-page` on 2026-11-19 and 2026-11-20; see "As built". Numbered D133 until the merge of `main` on 2026-11-20, where `main` had taken D131 to D134: this record and the branch's three before it became D141 to D138, and the numbers are taken again from the generated index when the change lands on `main`. It amends a record of each side) · **Date:** 2026-11-19 · **Area:** ui, product, assistant

**Context.** Two records numbered D130 met on 2026-11-19 (the branch's is D141 since 2026-11-20).
[Clew's look and layout are the startsidan prototype's](D130-clews-look-and-layout-are-the-startsidan-prototypes-built-with-astryx.md),
on `main`, took the rail away, bounded every page to a centred column of at most 1280 px and put a floating "Fråga AI"
in the lower corner, which leaves the page for a new conversation. `D141-the-assistant-is-asked-beside-every-page-through-one-button-and-one-pane-of-the-page-frame.md`,
on the branch `assistant-beside-every-page` with its D136 and D137, put one button at the end of every title's line and
one pane in the page's end slot, and listed a conversation among the rail's latest. The product owner decided the same
day that the look on `main` is the one to work against: the organisation is testing the prototype and it meets their
expectations. The prototype shows nothing of what the branch can do, and the people testing it are not used to
assistants. The aim is that they meet the new parts through what they already know.

**Decision.**

1. **The two doors are the prototype's, and nothing is added to the shell.** The line to ask on Start and the floating
   "Fråga AI" in the corner are the ways to the assistant. The frame draws no button at the end of a title's line, and
   no page has a "Fråga Clew" or "Fråga assistenten" among its actions.
2. **The conversation stands where the box is.** On Start the box is the line, so the answer stands under it. On every
   other page the box comes with the pane. Where a page's own pane holds a picked thing, the box stands at that pane's
   foot and the conversation over it. Opened as a conversation, it has the whole column. Asking never takes the person
   away from what they asked about.
3. **On a page, "Fråga AI" opens the assistant's pane and the page stays.** It is about what the page shows, by the
   branch's rules for the subject, the address, Back, Esc and the focus's return, which hold as they are.
4. **The pane is one card at the end of the shell's column**, on the ground beside whatever the page is, from the top
   of the page to its foot, 400 px wide. The page frame provides it through one slot; no page places it. The page lays
   itself out in the width that is left, as it would in a narrower window: a table drops the columns it already drops,
   a thing's facts stand above its read. A page's way back, title and tabs stay on their lines. While the pane stands,
   a board (Start's kind of page, a register of cards) keeps its title and scrolls its column, as a page with panels
   does.
5. **The corner's button is drawn only where no box is on the page.** It is not drawn while the pane is open, with an
   item picked in Att göra, or on a conversation's page. Where a page pins controls at the window's foot (the review),
   the frame draws the same "Fråga AI" at the start of that footer instead of in the corner (the product owner,
   2026-11-20), and closing the pane gives the focus back to it. On Start it leads to the line, as it does today.
6. **The pane's heading is "Fråga AI" with the assistant's round mark**, the words and the mark of the button that
   opened it; the blue and the mark are the theme's for the assistant and nothing else. Its header holds "Öppna som
   samtal" and the way to close it, and under the heading what it is about in words.
7. **Before anything is asked the pane says what it can do here, and every line is built from what the assistant is
   allowed.** After the opening sentence: the reads it may make for this person on this page, the actions of what
   stands open that it may fill in, with "Du granskar och skickar alltid själv", and the systems it may not read. No
   line is free text and none is a suggested question. Last, what opening as a conversation adds.
8. **An action the assistant has filled in is a row of the board's own kind**, the row that needs the person with its
   edge in the assistant's blue: "Ifyllt åt dig", what it is, what was filled in, and "Granska och skicka", which
   opens the action's own dialog. Nothing is sent before that dialog's last button.
9. **On Start the answer is a card under the line and the board stays below it.** The card names what was read, shows
   the question as its heading and the answer, draws the work items it names as the rows "Behöver dig" has, and holds
   "Öppna som samtal" and "Stäng". It shows the newest exchange; the earlier ones are in the conversation.
10. **A conversation is found under Samtal in the row of pages.** The shell lists no latest conversations. The pane
    continues the person's latest conversation about its subject by itself.
11. **A phone has no pane**: the corner's button leads to the conversation's page with the subject beside it.

**Conditions, so that it is not reopened.**

- **The frame provides the pane, in one place.** A page that draws its own way to ask, its own box outside a pane of
  its own, or a pane somewhere else is a defect against this record.
- **Two placements were drawn and not chosen.** A pane at the window's edge keeps every column on a wide screen and
  moves the title off the header's lines when it opens. A panel floating over the page covers what the person may
  need to press and would be a second element placed by hand.
- **The lists of item 7 are what the server says, or they are not drawn.** A line the assistant cannot keep is a
  defect, not a wording question.

**Replaces.** Item 10 of the D130 on `main` for what the floating button does on a page; its three rules for keeping
it out of the way stand. Of the D141: rule 1 (the button at the end of the title's line), the placement
in rules 2 and 11 (the page's end slot becomes the column's end), the last clause of rule 6 (the rail's latest), and
rule 9 for Start, where the answer now stands under the line. Its rules 3 to 8 and 10 and its conditions stand, as
do the branch's D136 and D137.

**As built (2026-11-20), and what is still open.**

- **Amended on seeing it built (the product owner, 2026-11-20).** Asked whether the closed pane's button in the lower
  corner was decided, the owner said: "I think its weird. Expected location is somewhere at the top right of the
  content. Or opened by default", and, shown both placements drawn from the real components (the end of the title's
  line, the end of the row of pages), chose "On title line. closed by default to start with". So on every page with
  a frame "Fråga AI" is an ordinary button at the end of the title's line, after the page's own actions and under
  them where the line has no room, and the floating button is not drawn there. This replaces item 1's floating door
  and item 5's corner for those pages, and the review's footer door ("Yes, in the footer", 2026-11-20), which answered
  a corner that the pinned footer hid and would now be a second button on the page. What the button does is
  unchanged (items 3, 5 and 11), and the focus comes back to it when the pane closes. Start keeps the floating
  button, which leads to its line, as the prototype has it; the owner has not said whether it stays there. The pane
  starts closed; "to start with" leaves open by default for later.
- **Built on the branch:** the pane as a card in the frame's `aside` slot with the corner as its door (items 1 to 6);
  the introduction's lists, the fill-in list from the server read `POST /api/assistant/reach`, which answers what a
  turn asked now would be offered by the turn's own rules (item 7); the filled-in action as a `row-info` card, for a
  work item's action and for a record's (item 8, with
  [D137](D137-an-action-says-which-record-it-is-about-and-the-assistant-fills-in-the-actions-of-what-stands-open.md)); Start's answer card,
  drawn with the transcript's own parts (item 9); the footer's door (item 5).
- **Chosen in the build where nothing was drawn:** below 1180 px of window the pane is a drawer over the page; the
  pane's width is the person's, 400 px until they drag Astryx's grip (360 px to half the column, at most 720 px); a
  sent draft says "Skickat" with a link to the work item, and "Väntar på dig" when the item was made and nothing was
  decided in it.
- **Under a picked thing only the box is drawn before anything is asked** (the product owner, 2026-11-20: "only the
  box under a picked item is fine"): no introduction and no "Öppna som samtal" under an item in Att göra or an entry
  in Kalender until there is a conversation. The thing's own buttons stand right above, and the introduction is in
  the pane on the thing's own page.
- **An answer beside a page says what the transcript says** (the product owner, 2026-11-20: "keep the steps and
  model line, as the transcript has them"): the pane and Start's card draw the steps ("Läste …"), the time and the
  answering model's name, where the boards draw the text alone.
- **Differs from the boards, and the product owner has not said which stands:** on Start a question is always answered by Clew, never offered to another system's assistant; Start's card stays
  through a visit to another page and is gone after a reload; Fokusnyhet stays under the answer, where the board
  replaces it; the reads list names the page's reads as one chip each ("Att göra"), not the sources behind them.
- **A read and an action need not go together.** A record whose read the assistant may not make can still declare an
  action it may fill in: the pane then lists the system under "Det här kan jag inte läsa" and the action under "Det
  här kan jag fylla i åt dig". Both lines are true; whether they read as a contradiction has not been tried on anyone.
- **Not drawn and not built in the new look:** Kalender's answer as a block on the grid, another system's assistant
  beside a conversation
  ([D128](D128-another-systems-assistant-is-talked-to-beside-the-conversation-and-the-box-only-goes-to-clew.md)), the
  dark appearance. The action's dialog with its values filled in is built and was not drawn.
- With an item picked in Att göra and a filled-in action in the conversation, the read is one row high at 1440 by
  1000 px until the grip is dragged.
- Astryx places nothing in a corner and has no slot beside a page's whole layout: the pane is a `Card` in a stack
  beside the frame's `Layout`, composed of Astryx's parts with no style of its own.
- **Not seen live:** the review's decision footer with its door (the development data holds only a read-only review),
  a filled-in action on Start, and the phone. No manual screen-reader pass is made, and nobody outside the team has
  used it. The a11y specs that the change touches are brought up to date and pass (twenty spec files, 2026-11-20); the
  `screens.*` picture specs are not, and the whole suite has not been run.
