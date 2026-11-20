# D135 · The assistant is asked beside every page, through one button and one pane that the page frame provides

**Status:** provisional, amended by [D138](D138-the-corners-fraga-ai-opens-the-assistants-pane-a-card-in-the-shells-column.md) (2026-11-19, in the look of `main`: the corner's "Fråga AI" replaces rule 1's button at the end of the title's line, the pane is a card at the end of the shell's column instead of rules 2 and 11's end slot, the rail's latest of rule 6 are gone with the rail, and on Start rule 9's answer stands under the line; rules 3 to 8 and 10 and the conditions stand) (the product owner chose it on 2026-11-18, after the review [Where the assistant is asked](../reviews/2026-11-18-where-the-assistant-is-asked.md) and the canvas "Clew · the assistant beside every page", where a register, Läget, a work item's page and Att göra were drawn with the pane open at 1366 px and 1728 px, and answered four of the review's five questions the same day. Stage 1 is built (2026-11-18): the frame's button and pane on a tool's list or table and on Kalender, the conversation drawn there by the same parts as on the conversation's page, the subject stored with the conversation and found again, and the rail's rule. It was tried on the development stack with its local model: asked beside a register, reloaded, opened as a conversation. Stage 2 is built (2026-11-19): every register and Läget (Nyheter, Personal's tabs with the lenses, the competence matrix and search, Introduktion och avslut, Läget, Alla verktyg, Alla samtal and Att göra's queue while no item is open) says its subject to the frame, the reads of Clew's own domains that they show are offered to the assistant, the browser is told which reads the assistant may make (`ViewEntry.assistant`) and the pane says under its heading where it may make none. Asked beside Läget on the development stack, the local model read the follow-up dialogue of the reader's units and answered in the pane. Stage 3 is built (2026-11-19), as [D136](D136-the-thing-that-stands-open-on-its-page-is-told-to-the-assistant-by-clew.md) decides it: a work item, the review, a record, a person, a unit and a plan ask through the frame, and no page can say `later` any more. Stage 4 is built (2026-11-19): an item in Att göra's reading pane has the conversation and the box under its read (rule 5 as amended), and no page or pane of the person's work has a "Fråga assistenten" of its own left but the cards on Hem and in an answer, which lead to a conversation. Nothing outside the repository has tested it, and no manual screen-reader pass is made. Numbered D130 until the merge of `main` on 2026-11-20, where `main` had taken the number) · **Date:** 2026-11-18 · **Area:** ui, product

**Context.** Where the assistant is asked has been decided four times and reversed three: beside the page was
rejected in [D50](D50-the-conversation-is-the-column-and-the-panel-holds-what-it-is-about.md), chosen in
[D112](D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md), removed in
[D126](D126-one-page-per-thing-one-astryx-template-per-page-type.md) and chosen again for Kalender in D129. The review
found three causes. Two needs were treated as one choice: asking about what is on the screen without losing it, and a
conversation as a place to work. The end slot was asked to hold a thing and the assistant at once. And each decision
was made on the page it was drawn for and reversed on another. It also found the assistant's presence uneven: of 24
page types and tabs outside Administration, 11 can ask about what they show (in five different ways), 3 are the
assistant's own and 10 have nothing, because each page decides for itself whether to draw the button. On the day D129
was made the owner met the same need on two registers, a record, Läget and Introduktion och avslut, all outside D129's
test.

**Decision.**

1. **Every page of the person's work has one button, "Fråga assistenten", at the end of its title's line, drawn by the
   page frame.** A page says what it shows (its subject) or that it has none and why; it cannot leave the button out.
   Administration has none: nothing there is a read the assistant may make. Without a model the button is not drawn
   (D8).
2. **The button opens the assistant's pane in the page's end slot, and the page stays.** The pane is in the address,
   so Back, Forward and a reload reproduce it. The button again, ✕ or Esc closes it and the focus returns to the
   button. Opening asks nothing.
3. **The pane is the assistant's and shows no thing.** It holds its heading, what it is about in words, the
   conversation and the box. A name in an answer is a link to the thing's page, and following it leaves the pane's
   conversation with the page it was asked on.
4. **The pane is about one subject: the page's thing, the page's list, or the thing standing in the page's own pane.**
   The subject goes with every question as what stands open. The reads of Clew's own domains that these pages show are
   opened to the assistant in the same change (the product owner, 2026-11-18), for the person who may make them
   ([D122](D122-the-assistant-may-read-and-propose-whatever-the-person-who-asks-may-and-adding-a-model-is-answering-for-it.md)
   item 3). Where a read of another system stays closed to it, the pane says so under its heading before anything is
   asked.
5. **Where a page's own pane holds a picked thing, the box stands at that pane's foot from the start and the
   conversation about the thing stands over it.** Kalender's entry is the reference (D129). Att göra's item follows
   (the product owner, 2026-11-18), accepting that a long item in a low window leaves the conversation under the fold.
   Amended on 2026-11-19, when it was built: the item's pane is two parts, as Kalender's is. The read scrolls in the
   upper part, the conversation and the box are a part of their own at the pane's foot, and Astryx's grip between them
   gives either more room. The board drew one scroll; Astryx's chat scroller opens at its newest message, so one scroll
   would open an item asked about before past its facts, and the product owner chose the two parts over scrolling by
   hand. Opening the thing gives the focus to its name, never to the box.
6. **A conversation beside a page is a real conversation about its subject, one per subject** (the product owner,
   2026-11-18). The pane shows the person's latest one about that subject and continues it; the pane can start
   another. "Öppna som samtal" in the pane's header leads to the conversation's page, where the subject stands beside
   the conversation if a thing can stand there. It is listed under Alla samtal with what it is about, and among the rail's latest only once it has been
   opened at full size.
7. **An answer in the pane is text, a few named rows as links, or one row for an action the assistant has filled
   in.** A card, a table, a document, a week and anything from a file are drawn on the conversation's page, and the
   pane draws one row that leads there. A list is a link to its page.
8. **The assistant fills in only an action about what stands open, and the person sends it.** The filled-in action
   opens in the action's own form: the action dialog, or the page's form where the page has one (Kalender). Nothing is
   written before its last button, and a cancellation keeps the person's confirming press.
9. **The assistant about nothing on a page is Hem's line, Ny fråga and the conversation's page**, as D126 item 4 has
   them. Things come to such a conversation with `@` and "Lägg till i samtalet" and stand beside it.
10. **A person must be able to tell the two sizes apart without knowing assistants** (the product owner, 2026-11-18:
    "most users of the system are not AI-natives"). Before anything is asked the pane says in plain words what asking
    here does and what opening it as a conversation adds; the words go with the first question. The way there is
    named with words a person already has. "Helt fönster" was drawn and found unclear by the owner the same day, who then
    chose "Öppna som samtal": the product's own word for what the question becomes and where it is found afterwards
    (Alla samtal). The row under an answer that needs room says "Visa i samtalet". Where an answer needs room the pane does not have, it says
    what the answer is and offers the conversation (rule 7), so the difference is met where it matters. The pane's box is the plain
    one: the model, `@`, dictation and other systems' assistants belong to the conversation's page (rule 9).
11. **The pane stands beside the page from one window width on every page; below it, it is a drawer over the page; on
    a phone the button leads to the conversation's page.** While the pane is open the page draws the narrow layout it
    already has: a table scrolls or becomes its list, a thing's facts stand above its read.

**Conditions, so that it is not reopened.**

- **How it differs from D112's panel, in one sentence**, because it will be read as the same thing: that panel showed
  a thing on every page and was the way to open one; this pane shows no thing, opens nothing, and exists only on the
  person's press. A later change that puts a thing into it reopens this decision and has to say so.
- **The page being laid out again when the pane opens is accepted**, as the price of asking beside it, and only on the
  person's press.
- **The frame provides it, not the page.** A page that draws its own way to ask, or its own box, is a defect against
  this record, not a variation.
- **One component.** The conversation is drawn by the same parts beside a page and at full size; Kalender's pane moves
  onto them.
- **A doubt about one page is tested against rules 1 to 11 and these conditions**, and changes the page or adds a
  rule; it does not reopen where the assistant is asked.

**Replaces.** The last sentence of D126 item 4 ("No other page has a composer") and "Fråga Clew" as a way out of the
page; D129 item 1's test ("only where its answer is drawn on the page itself") and its item 2 for pages without a pane
of their own; rule 4 of [interface spaces](../reference/interface-spaces.md) when it is built. It keeps D126 rules 1
and 3 (one page per thing, nothing opens over a page to show a thing), D116 (a list is a page) and D128 (another
system's assistant has its own panel beside a conversation).

**Not built, and what is still open.**

- A calendar proposal in Att göra's reading pane keeps its own card (D27) and has no box under it. On a short screen
  the item's pane is one flow and the conversation keeps its least height under the read, with no grip. A work item
  drawn on Hem or in an answer keeps "Fråga assistenten", which leads to a conversation with the item beside it.
- Asked under an item, a question with "varför" in it is still answered by the fixed path for a chipped work item
  ("Varför nu? …") before the model is asked: seen on the development stack, and older than the pane.
- What was opened in stage 2, read by read, is the table "Clew's own reads and the model" in
  [capability surfaces](../architecture/capability-surfaces.md): `dialogue.units` and `dialogue.activities`,
  `boarding.plans` and `boarding.plan`, the open round `talks.talks`, `people.reports`, `clew.tools` and
  `clew.conversations`. Of the talks domain only the round is offered, where each report stands: an action point's
  text and another system's round stay closed (D96 item 6, which D122 item 3 amends this far and no further). The
  registrar's search stays closed (D122 item 5), and its pane says so.
- When the pane says a system is closed. A list's own read is closed when the assistant may not make it. A source
  about a person or a unit (a lens, a column of Personal or Läget) is read through the read that answers the same
  rows without keys (D127); with none, the pane says the system is closed only when the assistant may make no read
  of that system at all. The pane can therefore stay silent about a column the assistant reads only in part. A read
  Clew joins across systems (`clew.<profile>`) is no one system, so a column from one is said closed without an
  overview: on Läget the pane says it cannot read utvecklingssamtal, although the assistant reads the round person
  by person (`talks.talks`).
- `people.reports` cannot be switched off for the assistant on Administration › Anslutna system, since the `people`
  connector has no row there (as `people.me` and `people.directory`): a gap against D122 item 4.
- The model reads only the fields a view draws, so `boarding.plans` draws the plan's id and `clew.tools` and
  `clew.conversations` an address as plain text where they are drawn as a view. A field the model reads and a
  person is not shown does not exist.
- None of the domains opened in stage 2 logs a read, so the assistant's reads of them are logged nowhere either
  (D122 item 6 asks for it only where a person's read is logged).
- The other system's assistant's panel (D128) draws its exchange and its box with the shared parts since 2026-11-19
  (`Transcript` in a third room, `aside`; the plain box, which cannot be stopped there). Its header is its own. It
  was not tried on the development stack, which has no other system's assistant; its spec passes.
- The pane shows what the shared transcript shows: the time, the model that answered and what was read. The canvas
  draws none of those; whether they stay is the owner's to say.
- An action about a record is declared and run as
  [D137](D137-an-action-says-which-record-it-is-about-and-the-assistant-fills-in-the-actions-of-what-stands-open.md)
  decides, on the server; no page draws one yet, so rule 8 is met on screen for a work item and for Kalender's own
  two.
- Files: nothing exists, and whether a file a person brings is Clew's to read or the AI platform's is undecided. It is
  not part of this decision.
- A conversation that follows the person from page to page was not chosen.
