# Design exploration: the start page's directions, and every path from it · 2026-11-06

Requested by the product owner on 2026-11-06 with a picture of the landing as built: "nothing draws my attention
here", the line "Inget behöver dig just nu" and the footer's day line were easy to miss, and the content sat in a
narrow column on a wide window. The ask: design examples, thought from the personas (`docs/personas.md`), of what
each person wants to see when opening the site for the day. Drawn on the canvas **Clew startsida · dagen i ett svep**
(Claude Design, https://claude.ai/artifact/9xn43bAwXy2VioBqiG3xc6, private until shared): four directions, then
seven flow artboards under the chosen one, joined by working links. The outcome is D53.

## What was wrong

Read from `apps/web/src/pages/start.tsx` and D34, D39, D41, D50 as built on 2026-11-05:

- The landing was the `ai-chat-landing` template on a 720 px column: a greeting, "Vad vill du göra?", the box, the
  areas. What the assistant had found was a brief of at most three rows above the box with a sentence over it, and the
  rest was a page away under "Allt i Att göra". The day was one line of supporting text in the footer.
- On a quiet day the whole page said nothing: an empty brief, the question, the box.
- A manager with a 1440 px window saw a column and two margins.

## What each persona wants on opening

- **Hillevi / Kim (manager):** what needs me today and in what order, my day with its gaps, the state of my unit
  (sick leave, budget, the talks), and what moved since yesterday without me.
- **Hassan / Fatima (care worker, elevassistent):** when my next shift starts and which it is, anything I must read
  or answer, how much leave I have. Not a sentence about the shift they are already on.
- **Mikael (operator):** that nothing is wrong, what he watches, and the things he can start.

## The four directions

- **A · Hem och Att göra i ett.** The product owner's own suggestion folded in: the greeting with the day, the box, and
  under it the tabs (Behöver dig, Väntar på andra, Inte nu, Klart) with the area filter, the groups as rows with one
  button each, Läget's four tiles, and beside the column I dag and Sedan i går. Everything above the fold at 1440.
- **B · the same page on a quiet day.** Lugnt läge with links to what waits and what closed, and the person's areas with
  what they can start take the room the rows would have taken.
- **C · ask first, but wider.** D41's hero kept on a 1080 px column; the brief as three cards above it, the day as a
  timeline with a now-marker in the footer.
- **D · the phone at 06:30.** Hassan's week of shifts as a strip with tomorrow and next Monday marked, then the cards
  that need him, with the box docked.

The team's mock start.sundsvall.dev/portal/start was looked at on request. What it does well, the day and the
schedule at one glance, is in A and D. Its news hero, widget grid and "Anpassa startsidan" are not: Clew's page is
the assistant's push and the person's day, not blocks to arrange, and the model answers the "what is new" question
when asked.

Taken out during the review, on the product owner's word: the sentence summing the day up ("the info is already
there and better presented in the cards"), the suggestion chips ("quite the promise"), the shift sentence on D
("Hassan probably knows when his shift starts"), and the tab name "Pågår utan dig" (confusing; now Väntar på andra).

## The flows under A

Drawn because "these are all super important UX flows we need to figure out", with every view type covered: a
connector's view in the chat, in the panel and as a page, and work across several connectors.

- **E · Granska.** A row opens its card beside the column; the page does not change. The card is the connector's: the
  invoices as checkboxes, "Attestera 2 valda", "Varför nu?", the contract excerpt. The box says "Om kortet" and
  carries the card as a token. Built.
- **F · asking about the card.** Sending takes the conversation into the column with the card beside it and a tab for
  what the assistant cited. The assistant lays a proposal with one line per step; the person confirms; the receipts
  come back per step with undo. The panel's tabs are not built (D50 lists them); the proposal and receipt are D30
  and D45/D47 as they are.
- **G · a plain question from Hem.** No new tab: Hem is replaced by the transcript, the question appears under Samtal
  in the rail, "Stäng samtalet" returns. The answer carries the connector's view compactly with "Öppna bredvid" and
  "Öppna som sida". Built as D50 has it.
- **H · an older conversation.** Opens where it ended; what happened since is marked by a divider and a dot in the
  rail. The panel still holds the view that conversation opened. The divider and the dot are not built.
- **I · a view as a page.** The table at full width, a row's card in the panel with the connector's actions, the box
  at the column's foot asking about the page or the open card. Built as D42 and D50 have it.
- **J · work across three systems.** A sick-leave report touches the HR system, the timesheet and the salary system.
  The assistant asks the missing question first, proposes one step per system, says which one Clew will only watch;
  one confirmation, a receipt per source; a timeout is treated as unknown and re-read, never re-written (D47). A
  conversation carrying a job with a step list is not built.
- **K · the phone.** The panel as a bottom sheet with the same tabs over the conversation. The sheet is D50's drawer;
  the tabs are not built.

## Outcome

The product owner chose A ("A probably") and asked for it to be built. D53 records the page; the flows E, G and I
are the code as it stands, F, H, J and K name what is still missing. Owed: a manual screen-reader pass of Hem with
the panel at rest, a comparison of the built page against artboard A at 1440 px, and a schedule capability before D
can be built.
