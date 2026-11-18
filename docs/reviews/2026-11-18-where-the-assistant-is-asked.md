# Where the assistant is asked

Date: 2026-11-18. Asked by the product owner, who wants one rule set for where and how the assistant is asked on every
page, because the question has been decided and reversed several times: "I feel like we go back and forth on the ask
inline vs not … if this breaks the UI expectations we need to stop and think."

Method: the decisions and reviews listed in section 2 were read in full; every route in `apps/web/src/main.tsx` and
every page under `apps/web/src/pages` was read for what it offers today; the asking machinery was read on both sides
(`thing-panel.tsx`, `conversation-context.tsx`, `ask-in-place.tsx`, `apps/server/src/assistant/`, the contracts and the
connector protocol); four other products' documentation was looked up. Nothing was run in a browser and no code was
changed. Two builders were editing `apps/web`, `apps/server` and `tests` for Kalender's stage 1 while this was written,
so the line numbers in the appendix are those of the working tree on branch `calendar-pass` that afternoon and may have
moved. This review decides nothing. It lays out the options, recommends one and says how sure it is.

## 1. The question, and why it keeps being reopened

On every page of Clew: is there a way to ask the assistant, does it open beside the page or by leaving for the
conversation's page, is it there from the start or behind a button, what is the conversation about, is it kept and found
again, and what may an answer carry. The answer has to be one a person can predict and a builder can apply to a page
that does not exist yet.

It keeps being reopened for three reasons, and the first is the one the main session named.

1. **Two needs were treated as one choice.** One need is to ask about what is on the screen without losing it: a short
   exchange, in place, whose answer is often something done to the thing shown. The other is a conversation as a place
   to work: long, about several things or about nothing on a page, with answers that are cards, tables and, one day,
   files, which need the column. Every decision so far gave the assistant one kind of home and so served one need and
   failed the other. [D50](../decisions/D50-the-conversation-is-the-column-and-the-panel-holds-what-it-is-about.md) and
   [D126](../decisions/D126-one-page-per-thing-one-astryx-template-per-page-type.md) served the second and took the
   person away from the page;
   [D112](../decisions/D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md) served
   the first and squeezed everything into a panel.
2. **The end slot was asked to hold a thing and the assistant at once.** D112's panel was "the thing's title, facts and
   buttons. Under it: the conversation about it. Bottom: the box", on every page. The critique of 2026-11-14 found that
   panel doing three jobs (peek, work surface, conversation). D126 removed the panel to fix the first two jobs, and the
   third went with it, although nothing in the critique said that asking beside a page was wrong.
3. **Each decision was made on the page it was drawn for and reversed on another.** D50 was drawn on Hem and a tool's
   page, D112 on a work item, D126 on a work item and a person, D129 on Kalender. None was walked through a register,
   Läget or a record before it was accepted. D129 item 1 is the first record with a test for an unseen page ("only where
   its answer is drawn on the page itself"), and the owner's examples of the same afternoon (two registers, a record,
   Läget, Introduktion och avslut) already fall outside it.

One thing follows from the third reason: three choices have been bundled that can be made separately. **Place** (beside
the page or on the conversation's page), **identity** (which conversation the box continues and where it is found
again), and **capacity** (what an answer may draw at that width). The options below state all three.

## 2. The history

### The decisions

| Decision | Date | What it said about the assistant's place | What reversed it |
|---|---|---|---|
| [D9](../decisions/D09-side-panel-holds-views-and-apps.md), [D13](../decisions/D13-conversation-in-the-composer-drawer.md) | 11-03 | The side panel holds views; "the conversation is never in the panel". The conversation unfolds from the composer's drawer over a dimmed stream. | D31, the next day: Astryx had `ChatLayout`, and the hand-made overlay was a violation of the Astryx rule. |
| [D31](../decisions/D31-the-conversation-swaps-the-stream-inside-one-chatlayout.md), [D34](../decisions/D34-the-box-is-the-page-and-the-push-is-its-brief.md), [D41](../decisions/D41-the-landing-is-the-ai-chat-landing-template-with-the-persons-areas-under-the-box.md) | 11-04, 11-05 | The start page is the box; a conversation replaces the stream in the same column. Asking is possible only on the landing. | D50: "a conversation could only be asked on the landing: opening a view from a conversation left the conversation's address and closed its transcript." |
| [D50](../decisions/D50-the-conversation-is-the-column-and-the-panel-holds-what-it-is-about.md) | 11-05 | Two drawings. A: on every page the panel is the assistant, the box at its foot (the owner had asked "what if the chat on a page always lives in the sidebar"). B: the conversation is always the column and the panel holds what it is about; a one-line box at the foot of Att göra and a tool's page, and sending leaves for `/conversations/new`. The owner chose B: A "gives a conversation two homes and two widths, makes the panel hold both the conversation and what was opened, squeezes an answer's card or week into the panel, and a phone has no room for it". The record adds that B is a subset of A, "so a page people stay and work in (Kalender is the candidate) can still get a conversation beside it later". | The same day: a brief row led to Att göra and "the product owner found the change of page confusing". Then D111: four links on Personal each surprised the owner, and an opened card was put in the box unasked. |
| [D53](../decisions/D53-hem-is-the-start-page-the-days-work-under-the-box-and-the-day-beside-it.md) | 11-06 | Hem: the box under the greeting, the day's work under the box. | D112 and D126 item 9: "The composer that stood there first offered the question's options before there was a question and pushed the work down the page." |
| [D111](../decisions/D111-where-something-opens-is-decided-by-what-it-is.md) | 11-11 | "Opening is not asking." A card goes into the box only with "Lägg till i samtalet", offered only where the page has a box. The panel on every page. "No control chooses a surface." | Its rule 7 the same day by D112 ("Öppna som sida" came back); seen live, "multiple different sidebars", which became one panel, one width, one thing. |
| [D112](../decisions/D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md) item 7 | 11-11 | One panel in the end slot of every page, always about a thing: the thing on top, the conversation about it under it, the box at the bottom. "Fråga Clew" in a page's header makes the page itself the thing. A long exchange continues on the conversation's page. This is drawing A of D50, with the thing added on top. | D126, three days later: the critique counted "nine ways of showing a thing and four homes for the assistant" and found that "the side panel does three jobs (peek, work surface, conversation) and reflows the page under it". |
| [D116](../decisions/D116-a-panel-is-a-peek-at-one-thing-a-list-is-a-page-and-every-view-has-an-address.md) | 11-12 | A panel is a peek at one thing; a list is a page. The panel could still hold "the page itself with 'Fråga Clew'". | D126 removed the peek panel; the list rule stands. |
| [D126](../decisions/D126-one-page-per-thing-one-astryx-template-per-page-type.md) item 4, rule 2 | 11-14, amended 11-16 | "The assistant has two homes": a one-line way in on Hem and the conversation's page. "'Fråga Clew' on a page starts a conversation with that thing beside it. No other page has a composer." A pane exists in two places only. The record names what it rejected: "an assistant dock in the shell (rejected: a conversation needs the column, and the thing beside it is the context)". | D129, four days later, on Kalender: "clicking fråga assistenten on a opened meeting takes me to a new chat window, that is not expected. I would expect to be able to ask about the meeting inline". |
| [D128](../decisions/D128-another-systems-assistant-is-talked-to-beside-the-conversation-and-the-box-only-goes-to-clew.md) | 11-16 | Another system's assistant has a panel beside the conversation with a box of its own. "Nothing in the transcript moves by itself." The first box in a pane after D126. | Stands. Its lesson is used below: "A recipient that sticks is a mode, and a mode is read from one small control and noticed after sending." |
| [D129](../decisions/D129-the-assistant-is-asked-in-place-where-its-answer-is-drawn-on-the-page.md) | 11-18 | Asked in place "only where its answer is drawn on the page itself"; on Kalender the box stands at the pane's foot wherever an entry does, the pane draws the whole conversation and finds it again, and an answer can carry a prepared decision. | The same afternoon the owner saw the pattern on two registers ("This is something that probably all list pages should support"), on a record ("I am also starting to think its the pattern a user expects even in this case"), and found pages with nothing ("This one doesnt even have a ask assistant"; "There are multiple pages without an ai assistant action as well"). |

Two records bear on the question without placing the assistant.
[D104](../decisions/D104-the-model-does-the-work-a-floor-holds-without-it-and-the-assistant-may-act-alone-within-limits.md)
(11-10) says the model is the main way work gets done, which an assistant missing from half the pages contradicts.
[D97](../decisions/D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md) and D112 item 8 say what the
assistant may fill in: an action of a work item, and since D97 an action about a person or a unit can be started from
their page. Section 6 takes that up.

Counted plainly: the assistant beside a page has been rejected (D50, 11-05), chosen for every page (D112, 11-11),
rejected (D126, 11-14) and chosen for one page (D129, 11-18). Each reversal came within four days of the owner using the
result on a page it had not been drawn for.

### The failure modes actually observed

| # | Failure | Where it was seen |
|---|---|---|
| 1 | A thing shown in two places: the same work item in a panel from Hem, a pane in Att göra and a page elsewhere. | Review of 2026-11-14, finding 1; D126 "Why". |
| 2 | One panel with three jobs, and a page that is laid out again when it opens. | Review of 2026-11-14, finding 2. |
| 3 | A box at the foot of every page and panel. | D50 item 5 built it; D129's context says D126 item 4 "was made to stop a box from growing at the foot of every page and pane". |
| 4 | A list squeezed into a panel. | The owner, 2026-11-12: "This can get extremely crammed … The sidebar needs to be for peeking or some kind of instant actions, otherwise a full route is needed." D116 found nine places doing it. |
| 5 | Being taken away from the page. | D50's amendment of 11-05; D111 (seven kinds of control ended on Hem); the owner on Kalender, 11-18. |
| 6 | A pane that forgets. | The owner, 11-18: "The chat should be persisted I think, or at least have a link to retrieve latest chat session. Also it only shows last question and answer, why?" |
| 7 | One control with two behaviours. | "Visa bredvid", removed within the hour on 11-11 (D111). Today "Fråga assistenten" leaves the page everywhere, except that Kalender's header button opens the pane (`calendar.tsx:1023`) and the same button on a phone leaves; D129 item 1 makes that a rule by page type. |
| 8 | Opening treated as asking. | D111 rule 6: a card opened on Hem was put in the box as "Om kortet". |
| 9 | A box that sends somewhere the person did not mean. | D128's context: a sticky recipient sent a question about the person's team to another system twice. |
| 10 | Several different side panels. | The owner, 11-11, at 1900 px: "multiple different sidebars" (D111, amended). |
| 11 | The assistant present on some pages and absent on others. | The owner, 11-18, on Läget and on Introduktion och avslut. Section 3 counts it. |
| 12 | The assistant not knowing what is open. | The owner, 11-17. Section 3 shows it is still true for most page types. |

## 3. The inventory

**Count.** Of the 24 page types and tabs outside Administration, 11 have a way to ask about what the page shows, 3 are
the assistant's own pages (Hem's line, Ny fråga, a conversation), and 10 have none (one of those, Alla samtal, has only
the button to a new question about nothing). None of Administration's 14 routes has one. Among the 11 there are five
different behaviours: leaving with the thing beside the conversation (a work item, a record, a person, a unit); leaving
with a chip and nothing beside (the queue, a register, the news); leaving with nothing the server is told (a lens of
Personal); asking in place behind a button (Kalender's range); and a box that stands from the start (Kalender's entry).

**What the server is told.** "About what the page shows" is true today only for a work item, a row of one, a calendar
entry and a proposal. A view sent as the subject is a chip `capability:<name>`, and the model is told one line,
`Förmågan "<title>" (<source>).` (`apps/server/src/assistant/context.ts:125`): for a register it can then make the read
itself if the read is offered to it, but for a record it is not told which record is open, since the read's input is not
part of the chip (`view-read.tsx:26-39`, and the `open` branch of `useAbout` in `pages/conversation.tsx`). A person, a unit and a lens of
Personal send no chip at all (`conversation-about.ts:102-108`, `staff.tsx:181-190`; the reason is D97 item 7 and D115).
Whether the model can then read anything depends on the read: `clew.requests`, `clew.errands`, `pob.requests` and the
calendar's reads are offered (`model: true`); `pob.request`, `dialogue.unit` (Läget's follow-up), `boarding.plan` and
`boarding.person` are not (`model: false`). So on Läget, on Introduktion och avslut and on a POB request's page the
assistant could not answer about what is shown today, wherever its box stood.

**Widths.** The rail is 260 px and the sheet has about 12 px to the window's edge (`page-frame.tsx:311`), so the sheet
is the window less 272 px. A pane of 400 px leaves the following.

| Window | Sheet | Left beside a 400 px pane | Left beside the pane and the 340 px facts panel |
|---|---|---|---|
| 1280 | 1008 | 608 | 268 |
| 1366 | 1094 | 694 | 354 |
| 1440 | 1168 | 768 | 428 |
| 1728 | 1456 | 1056 | 716 |

A tool's table is drawn from 1280 px of window, about 1000 px of sheet (`tool.tsx:24`), so beside a pane every register
is its list layout at 1280 to about 1680 px and a table only at 1728. A thing's page cannot keep its facts panel beside
a pane below about 1700 px: the facts have to stand above the read, as they already do at 1024 px
(`page-frame.tsx:235-247`). Kalender's own rule is the pane beside the grid from 1340 px (`calendar.tsx:419-420`),
which a 1280 px window does not reach.

### Page by page

"Fits" says what has to give for a 360 to 440 px pane beside the content. "Answer" is what a likely question's answer
is: text, a list, or an action on something shown.

| Page or tab | Address | Type (interface-spaces) | Way to ask today | Where the button is, or is missing | End slot today | Fits beside at 1280 / 1440 / 1728 | What a person would ask, and the answer |
|---|---|---|---|---|---|---|---|
| Hem | `/` | `ai-chat-landing`, a dashboard | Own: the line "Vad vill du göra?" and "Fråga assistenten"; the first question takes the column | `start.tsx:507-524` | None | Not needed: Hem has its line | "Vad är viktigast i dag?" Text and work items |
| Ny fråga | `/conversations/new` | A conversation not asked yet | Own: the full composer | `new-question.tsx:68` | None | Not applicable | Anything. Any |
| A conversation | `/conversations/<id>` | `ai-chat` | Own: the full composer | `pages/conversation.tsx:344-386` | The thing it is about, or another system's assistant, 360 to 720 px | Not applicable | — |
| Alla samtal | `/conversations` | Register | No, only "Ny fråga" (about nothing) | `conversations.tsx:193` | None | List / list / table | "Var frågade jag om semestern?" A list |
| Att göra, the queue | `/todo` | `table-inbox` | Yes: leaves, chip `clew.work`, nothing beside | `todo.tsx:640`, subject `todo.tsx:404-409` | The reading pane when an item is chosen | The pane is the item's: no extra width, but shared height | "Vad är mest bråttom?" A list of items |
| Att göra, the item in the pane | `/todo?item=` | Reading pane | Yes: leaves with `?card=` | `todo.tsx:618` | The item, at least 440 px | As above | "Vad händer om jag godkänner?" Text; or an action of the item filled in (exists, D112 item 8) |
| A work item | `/items/<id>` | `work-item-detail` | Yes: leaves with `?card=` | `item.tsx:79`, drawn in `work-item.tsx:691,794` | Facts, 340 px | Facts above / facts above / three columns | The same as in the pane |
| The review | `/items/<id>/review` | A page of the item | **No** | `review.tsx:856-872` has no button | Facts "Hittills", 340 px, and a footer | Facts above / facts above / three columns | "Vad avviker på den här fakturan?" Text; never a decision |
| Kalender, the range | `/calendar` | Its own (D27) | Yes: in place behind "Fråga om veckan"; on a phone it leaves | `calendar.tsx:1023-1028` | Kalender's pane, 440 px, from 1340 px | Drawer / beside / beside | "När kan jag och Lena ses?" A time: an action (a booking; not built) |
| Kalender, an entry | `/calendar?entry=` | Its pane | Yes: the box stands under the entry; on a phone a button that leaves | `calendar.tsx:795`; phone `calendar.tsx:208,302` | The entry or a form | Drawer / beside / beside | "Flytta till torsdag." An action: the form filled in (built) |
| Personal › Medarbetare | `/staff` | Register | **No** | `staff.tsx:181`: the button is made only when a lens is shown | None | List / list / table | "Vilka har inte haft samtal i år?" A list of people |
| Personal › a lens (Utvecklingssamtal, Frånvaro, any an administrator offers) | `/staff?show=<capability>` | Register | Yes: leaves with `?lens=`, no chip, nothing told to the server | `staff.tsx:181-190` | None | List / list / table | "Vem har varit borta mest?" A list; an action about one person (exists as a menu action, D97) |
| Personal › Kompetens, the matrix | `/competence/matrix` | Register (a grid) | **No** | `competence-matrix.tsx:978-986` | None | The grid loses 400 px of its columns at every width | "Vilka intyg går ut före jul?" A list; registering one is an action |
| Personal › Kompetenssökning | `/competence/search` | Register | **No** | `competence-search.tsx:523` | None | List / list / table | D122 item 5 keeps the registrar's search from the assistant: nothing about the result may be answered |
| Personal › Introduktion och avslut | `/boarding` | Register | **No** | `boarding-list.tsx:171` | None | Rows / rows / table | "Starta introduktion för Vilma": an action that exists on the row. "Vilka planer är försenade?" A list |
| A person, every tab | `/people/<id>?section=` | `work-item-detail` with tabs | Yes: one button for every tab, leaves with `?person=`, no chip | `person.tsx:425` | Facts, 340 px | Facts above / facts above / three columns | "Vad ska jag ta upp på samtalet?" Text; an action about the person (exists, D97) |
| A unit, every tab | `/units/<id>?section=` | `work-item-detail` with tabs | Yes: the same, `?unit=` | `unit.tsx:449` | Facts, 340 px | As a person | "Varför är siffran flaggad?" Text |
| Läget | `/units` | Register | **No** | `units.tsx:275-279` passes no actions | None | List / list / table | "Varför är Hagaskolan flaggad?" Text about one row. The read is not offered to the model today |
| A plan | `/boarding/<personId>` | `work-item-detail` | **No** | `boarding.tsx:591-595` | Facts, 340 px | Facts above / facts above / three columns | "Vad återstår före första dagen?" Text; ticking an item is an action |
| A tool that is a list or a table | `/tools/<capability>` | Register | Yes: leaves, chip of the read, nothing beside | `tool.tsx:146` | None | List / list / table | "Vad väntar de på från mig?" A list of rows |
| A tool that is a record, a text or a document | `/tools/<capability>?input=` | `work-item-detail` | Yes: leaves with `?open=`; the server is told the read's name, not which record | `tool.tsx:146`, placed at `tool.tsx:228` | Facts, 340 px, for a record with a body | Facts above / facts above / three columns | "Svara att fredag går bra." An action on the record: none can be declared today (section 6) |
| Nyheter | `/tools/clew.news` | Register | Yes: leaves, chip only | `news.tsx:58` | None | List at every width | "Något om löneöversynen?" A list |
| Alla verktyg | `/tools` | `library` | **No** | `tools.tsx:161-170` | None | Tiles reflow | "Var attesterar jag en faktura?" A link to a tool |
| Påminnelser | The rail's row and the bell | Not a page: a popover (`reminders.tsx:82`) | **No** | — | — | — | "Påminn mig i morgon" is asked in a conversation |

Administration (`settings-sidebar`): `admin-frame.tsx:165-190` draws every section and passes no way to ask, and its
start slot holds the sections' panel, 240 px. None of these 14 routes has a button: `/admin/connectors`,
`/admin/connectors/<id>`, `/admin/models`, `/admin/models/<id>`, `/admin/models/providers/<id>`, `/admin/users`,
`/admin/organisation`, `/admin/appearance`, `/admin/competence`, `/admin/competence/sources`,
`/admin/competence/requirements`, `/admin/competence/import`, `/admin/boarding`, `/admin/boarding/import`. Beside a pane
they would have 368, 528 and 816 px. What a person would ask there ("vilka chefer har aldrig loggat in?") is a list the
page's own filters give, and no administration read is a capability offered to the model, so the assistant could answer
nothing about these pages.

## 4. The general assistant and files

The owner added, while this was written: "also include the general assistant path and how that coexists. A user might
want to upload a file and ask it about stuff, not tied to a card. But also might be in conjunction with a card."

### The general assistant as built

The assistant that is about nothing on a page has five ways in, all leading to one place.

- **Hem's line** (D126 item 4): a field and "Fråga assistenten". What is written is sent as a conversation's first
  question and the conversation takes the column (`start.tsx:507-524`).
- **Ny fråga** (`/conversations/new`, D126 item 14): the greeting, the full composer with the focus, "Fortsätt" with the
  three latest conversations and "Fråga någon annan" (`new-question.tsx:44-73`).
- **The rail's section "Fråga assistenten"**: Ny fråga, the three latest conversations, Alla samtal
  (`nav.tsx:351-380`). The list is every thread of kind `question`, newest first (`stream.ts:48`).
- **Alla samtal**: the register of them (`conversations.tsx`).
- **The conversation's page**: the transcript in the column, the full composer docked under it, and in the end slot the
  thing the conversation is about or another system's assistant (`pages/conversation.tsx:344-386`). The header's menu
  "I samtalet" lists every thing the conversation has named, so a conversation may already be about several things.

The full composer (`composer.tsx:139-276`) has: `@` to find and attach any object the person may see; the chips'
drawer "Objekt i samtalet"; the verbs of a single attached work item; the model menu; dictation; Stop. A question is at
most 400 characters and eight chips (`packages/contracts/src/index.ts:4738-4767`).

With no chip and nothing beside, the server (`apps/server/src/assistant/index.ts:780-860`) resolves the people the
question names among those the asker manages (D115), matches open work items the text names and draws them, and gives
the model the reads and proposes offered to it, as the person. Only such a question, with nothing attached, may be
suggested for another system's assistant (`index.ts:828-840`).

The box built today for Kalender (`ask-in-place.tsx:203-243`) is a reduced one: no `@`, no drawer, no model menu, no
dictation. Its conversation is nevertheless a real one of kind `question`, made by the same endpoint, so it is listed
under Alla samtal and, as the code stands, in the rail's three latest: three meetings asked about push every earlier
conversation out of the rail.

### Files

**Nothing exists.** The composer has no control for a file; `ConversationInput` carries text and chips;
`MessageMeta` has no attachment; no decision is about a file a person brings. What is nearby:

- A chip of kind `document` is a search hit in a source system, fetched as the person (`chips.ts:65-75`), not an upload.
- D41 notes that Astryx's landing template has an attachment drawer and that Clew has none.
- [D26](../decisions/D26-questions-over-documents-are-search-not-knowledge.md) (proposed): questions answered from
  documents are a search fan-out with citations; "Clew builds no knowledge base, no index and no document store".
- `docs/vision.md`: Clew is "not an AI platform": "no knowledge bases, no document ingestion … That is Eneo's product".
- D125 leaves Eneo's file-producing functions out of a handed-over turn "since Clew's conversation cannot carry a
  generated file", and D128 item 10 says of another system's assistant that the whole of it is in its own system, "where
  its files and other functions work".

So a file in a conversation crosses a line the vision draws, unless it is kept narrow: a file read for one conversation,
with no index and no store beyond the conversation. That is the product owner's call, and it brings questions this
review can only list:

1. Is it Clew's at all, or is a file question handed to the organisation's AI platform through D128's panel?
2. If Clew's: are the bytes kept, or only the text read from them; where; and for how long (with the conversation,
   under the retention the organisation sets)?
3. Which types and sizes, and who checks a file for malware before a server opens it?
4. D122 has an administrator answer for a model receiving "whatever the person who asks may read". A file the person
   brings may hold other people's personal data that no source gave them. Does adding a model cover that too?
5. Is a file in a conversation a public record of the municipality (the vision lists that question as open for owned
   domains)?
6. The audit row says that a file was attached, never what it held (D91). Nothing of a file follows a question to
   another system's assistant (D125 item 4).

**The smallest shape that does not paint the interface into a corner** is the one a thing already has: a file is a chip
on a question. It is listed in the composer's drawer, kept on the question in `MessageMeta.chips`, shown in "I
samtalet", and can stand beside the transcript in the pane where a document already can
(`components/document-reader.tsx`). "This file and this card" is then two chips in one conversation, or the file as a
chip and the card beside the transcript, where "det öppna ärendet" already resolves (`ConversationInput.beside`). No
layout has to be invented for it. A file-heavy conversation is the workplace kind of section 1, so it belongs at full
size in every option below; each option only has to say how a person gets there from a page with one press.

## 5. The options

Five options. A to D are the four the main session asked for; E is A as this review would amend it, kept apart so the
amendments can be accepted or refused one by one.

**A. Everywhere, beside the page.** "Fråga assistenten" opens the assistant in the end pane on every page, about what
the page shows. The conversation's page is the same conversation at full size ("Öppna samtalet"). Four conditions: (1)
the pane is the assistant's and never shows a thing, and a name always navigates to the thing's page; (2) it is about
what the page shows, the thing, the list, or the row or entry picked; (3) an answer that is a list links to its page;
(4) one pane and one component on every page, and where a pane already holds a picked thing (Kalender's entry, Att
göra's item) the conversation stands under it.

**B. Collections only.** Beside the page on pages that show a collection (a register, the queue, Kalender). A single
thing's page keeps leaving for a conversation with the thing beside it, as D126 has it.

**C. The two homes of D126, with the leaving made better.** Always leave for the conversation's page. What could be
improved: the page left is restored exactly by Back and Esc (it is today); the conversation about a thing is found
again when the button is pressed a second time, so it no longer starts empty; and, for Kalender only, the pane beside
the conversation draws the week around the meeting as a day strip. What cannot be improved: a list cannot stand beside
a conversation (D116), so asking about a register still loses the register, and an answer still cannot be drawn on the
page that was left. The owner's objection of 11-18 is to the leaving itself, and no version of C removes it.

**D. One assistant panel of the shell.** A panel the shell owns, opened by one button in the same place on every page,
that stays open as the person moves. One conversation continues until the person starts a new one; what is open on the
page goes with each question. This is the option D126 rejected ("an assistant dock in the shell").

**E. A, amended.** As A, with these changes, each argued in section 6:

1. The frame owns the button and the pane, never the page. A page states its subject, or states that it has none and
   why. Administration has none, by rule.
2. Condition 2 is narrowed to what exists: the subject is the page's thing, the page's list, or the thing standing in
   the page's own pane. No register has a picked row.
3. Condition 4 is kept for Kalender as built and applied to Att göra only after it has been drawn, because under an
   item it is D112's panel again.
4. The pane's open state is in the address. A name in an answer navigates and does not carry the pane.
5. One transcript component at two widths, not a second renderer; and a stated list of what an answer may draw in the
   pane.
6. The assistant fills in an action only for what stands open.
7. A stated rule for the general path, for files, and for which conversations the rail lists.

### The same questions, asked of each

| | A | B | C | D | E |
|---|---|---|---|---|---|
| **Opened by a button, or standing** | A button on the page; standing under a picked thing | As A on collections; a button that leaves on a thing | A button that leaves | One button in the shell; stays open across pages until closed | One button drawn by the frame at the end of the title's line on every page; standing under a picked thing; closed by default on arrival |
| **Which conversation** | Not stated | Not stated | One per thing, found again | One that follows the person | One per subject, the latest about it; a new one from the pane's "Ny fråga" |
| **Found again** | In the pane, by the subject (as built for Kalender) | As A | By pressing the button again; Alla samtal | It is always there; earlier ones under Alla samtal | In the pane; under Alla samtal with what it is about; in the rail once opened at full size |
| **A thing's page (facts in the end slot)** | Not stated; the frame cannot hold both today | No change | No change | A third column, or the panel over the facts | The facts stand above the read while the pane is open, as at 1024 px; three columns only from about 1700 px |
| **Att göra's pane** | The conversation under the item | The conversation under the item, or beside the list when none is chosen | No change | A third column: 300 + 440 + 400 px does not fit a 1280 px window | Under the item, after its board is drawn; when no item is chosen the pane holds the conversation about the queue |
| **Kalender's pane** | As built | As built | The built stage is removed | The grid is 328 px at 1440 px, or the panel covers the entry and its form | As built |
| **Administration** | A pane beside the sections' panel and the content | Its lists get one | None | The panel is there, and can read nothing of the page | None, by rule |
| **Below about 1340 px** | Not stated | Not stated | No change | A drawer over the page | Astryx's `Drawer` over the page, as Kalender's pane is |
| **A phone** | Not stated | Not stated | No change | The conversation's page | The button leads to the conversation's page, which is the same conversation at full size |
| **What an answer may draw in the pane** | A list links to its page | As A | Not applicable | As A | Text; at most a handful of named rows, each a link; one row for a filled-in action with its button; one row with "Öppna samtalet" for a card, a table, a document or anything from a file |
| **"Öppna samtalet" and Back** | The conversation's page | As A | Not applicable | The conversation's page; Back returns to the page with the panel as it was | The conversation's page with the page's thing beside it and the page as where Esc leads; Back returns to the page with the pane open, since the pane is in the address |
| **Pages with no way to ask today** | Every page gets the pane, each page adding it | Registers get it (Läget, Medarbetare, Kompetens, Introduktion och avslut, Alla verktyg); the review and a plan do not | Each page still has to add the button | Solved by construction | Solved by construction: a page that passes no subject does not compile |
| **The general path beside it** | Not stated | Not stated | It is the only path | The panel is the general assistant too; Ny fråga is the same conversation at full size | Unchanged: Hem's line, Ny fråga, the conversation's page. One list of conversations |
| **The pane's box** | Not stated | Not stated | The full composer | The full composer, at 400 px | A reduced one: dictation and Stop, no `@`, no model menu, no file |
| **A file** | Not stated | Not stated | The full composer | In the panel's composer | At full size only; from a page, "Öppna samtalet" first |

### How each meets WCAG 2.2 AA

The requirements are the same for any pane beside a page, so they are stated once, for A, B, D and E. C adds no new
surface.

- **A non-modal region.** The pane is a `LayoutPanel` with `role="complementary"` and a name ("Assistenten"), as
  Kalender's and the conversation's panes are (`calendar.tsx:944`, `pages/conversation.tsx:361-383`). The page stays in
  use. As a drawer below the breakpoint it is modal, and the focus is held in it until it is closed.
- **Focus.** Pressing the button moves the focus to the box, since the person pressed it to ask (as "Fråga om veckan"
  does). Where the box stands under a picked thing, opening the thing gives the focus to the thing's name, never to the
  box (D129 item 2). ✕ or Esc in the pane closes it and returns the focus to the button (rule 7 of interface spaces).
  Opening asks nothing (rule 9).
- **Status.** The transcript is a log that says an answer once (D36, as `AskTalk` keeps it); a failure is the box's own
  status. That the pane opened is said by the focus moving into a named region.
- **The button's name (2.5.3).** The visible words and the accessible name are the same, "Fråga assistenten", on every
  page. Kalender's "Fråga om veckan" would become the same words, with the range named in the pane's heading. The button
  says whether the pane is open (`aria-expanded`).
- **Reflow (1.4.10).** Below 768 px nothing stands beside anything; on a short screen (480 px high or less) nothing is
  docked and the pane scrolls as one, as `AskTalk`'s host already arranges.
- **Target size, contrast.** Astryx's own.
- **What D adds.** A panel that stays open across pages has to say, on every navigation, what it is now about. A
  status that speaks on every page change is noise for a screen reader user; one that does not is failure 9.
- **Not verified.** No option has had a manual screen-reader pass, and none can be called conformant without one.

### What each does to interface spaces

| Option | Sentences of `docs/reference/interface-spaces.md` that change |
|---|---|
| A, E | Rule 2's first sentence ("A pane beside something exists in two places only") gains a third: the assistant's pane beside a page. Rule 4 is replaced whole. "The spaces" gains a row for the assistant's pane; "Widths" a line for it. In "Addresses", the row for `?ask=1` ("Dropped") names the pane again, and the rows for `/calendar?entry=` and `/conversations/new` are reworded. In "From origin to close", "Ask about a thing" and "Ask about a calendar entry or the range" become one row. D126 item 4's "No other page has a composer" and D129 item 1's test are replaced. Rule 3 ("Nothing opens over a page to show a thing") stands, because the pane shows no thing. |
| B | Rule 4 keeps both behaviours and says which page type has which. Rule 2 gains the pane beside a collection. |
| C | Rule 4 returns to its wording before 11-18; the sentences about Kalender's box, and D129 items 1 to 3, are withdrawn. |
| D | Rule 4 is replaced; "The spaces" gains a row for a panel of the shell; rule 8 ("The address is the state") gains an exception or the panel's state goes into every address; the row for the pane beside a conversation has to say what the shell's panel does on the conversation's own page. |

## 6. The options weighed

### Against the owner's stated principles

| Principle (the owner's words) | A | B | C | D | E |
|---|---|---|---|---|---|
| "clicking on item should navigate in a way the user will find predictable" | Holds if condition 1 is kept without exception | Holds for names; the button has two behaviours | Holds | Holds | Holds; the button has one behaviour at every width above a phone |
| A thing is shown in one way (11-11) | Holds by condition 1 | Holds | Holds | Holds | Holds |
| "The sidebar needs to be for peeking or some kind of instant actions" (11-12) | A conversation is neither; it passes only because long work has "Öppna samtalet" and an answer that is a list links out | The same | Holds | Fails as a place that is always open | The same as A, with the limit on what an answer draws written down |
| Nothing moves by itself (11-16) | At risk under an item: D112 folded the facts when a conversation ran | The same | Holds | The panel's subject changes when the person navigates | Holds: the pane opens on a press, the page is laid out again only then, nothing folds |
| General, not per domain (11-13) | Holds if the frame provides it | Fails: a rule by page type | Holds | Holds | Holds |
| "I dont think its necessary to hide the chat behind a 'fråga assistenten' button" (11-18) | Met under a picked thing | Met on Kalender | Not met | Met | Met under a picked thing. On a page with no pane open the owner's sentence was not about that case: a box that stands on every page is failure 3 |
| "The chat should be persisted … or at least have a link" (11-18) | Met | Met | Met with the improvement | Met | Met |
| The assistant knows what is open (11-17) | Only where the server is told (section 3) | The same | The same | The same | The same; the rule set says what the pane does where it is not |

### Against the failure modes

| Failure | A | B | C | D | E |
|---|---|---|---|---|---|
| 2: three jobs, the page laid out again | One job on most pages; two under a picked thing. The page is laid out again when the pane opens | The same, on fewer pages | No | One job; laid out again on every page while open | The same as A; accepted and stated |
| 3: a box on every page | No: behind a button | No | No | Yes, while the panel is open | No |
| 4: a list in a panel | Avoided by condition 3 | The same | No | The same | Avoided, with the list of what may be drawn |
| 5: taken away from the page | No, except on a phone | Yes, on a thing's page | Yes | No | No, except on a phone |
| 6: a pane that forgets | Depends on the identity, which A does not state | The same | No | No | No for a subject with a chip; yes after a reload for a person, a unit and a lens until the server is given a subject for them |
| 7: one control, two behaviours | No | Yes | No | No | No |
| 9: a box that sends to the wrong place | No: the pane is about one subject | No | No | Yes: the subject changes under a conversation that stays. A community report on one product in section 8 describes the same error | No |
| 11: present on some pages | Solved only if the frame provides it | Not solved for things without a button (the review, a plan) | Not solved | Solved | Solved |

### Three journeys

**Moving a meeting on Kalender.**

- A, B, E: as built. The entry is in the pane, the box under it; "flytta till torsdag klockan 13" fills in "Flytta …"
  and the block stands dashed on the grid; Spara. With one conversation per entry, each meeting asked about is a row in
  the rail unless a rule keeps it out (E states one).
- C: the conversation's page with the meeting beside it; the answer draws one row with "Visa i kalendern", which opens
  Kalender with the form filled in (D129 item 5 as built). Two navigations, and the week is not on screen while the
  person asks. This is what the owner objected to.
- D: beside Kalender's own pane the grid is 328 px at 1440 px. If the shell's panel takes the pane's place, the form the
  answer fills in has nowhere to stand. If the person opens another meeting, the transcript above the box is about the
  one before.

**"What are they waiting for from me?" on a register, and then answering.**

- The first step works in every option that lets the person ask at all: `clew.requests` is offered to the model, so it
  reads the list as the person and names the rows.
- A, E: the pane opens beside the list, which is drawn as its list layout below about 1680 px. The answer is text with
  the two requests named as links. Pressing one opens the request's page; in E the pane does not come along, and Back
  returns to the register with the pane and the answer as they were. On the request's page the person presses "Fråga
  assistenten" and writes "svara att fredag går bra".
- B: the first step as A. On the request's page the button leaves for a conversation with the request beside it.
- C: the first step loses the list; the answer's rows are links back to things.
- D: the panel and the exchange stay while the person moves to the request, which is the one real advantage of D.
- **In every option the last step fails today**, for two reasons that are not about layout. The server is not told
  which request is open (the chip is the read's name), and `pob.request` is not offered to the model. And a request has
  no action that could be filled in: the protocol lets a connector declare an action on a work item, a person or a unit
  only (section 7), and the POB connector declares none for a request. So the honest answer on that page today is that
  the assistant cannot do it.

**A manager on Läget asking why a unit's figure is flagged.**

- Today there is no button (`units.tsx:275`).
- A, B, D, E give the page one. The answer is text about one row, which fits a pane, and the unit's name in it is a
  link to the unit's page.
- In every option the model cannot read what Läget shows today: `dialogue.unit` is `model: false`, and a unit goes to
  the server as nothing. D122 item 3 decided that Clew's own domains are offered to the assistant; for this read it is
  not built. Until it is, a pane on Läget answers "det kan jag inte läsa", which is worse than no button unless the pane
  says so before the person writes.

The journeys show that most of what the owner wants on these pages is decided by what the server is told and may read,
and by the protocol, not by where the box stands. An option that is built without that half delivers a pane that
cannot answer on the pages the owner pointed at.

### Engineering cost, from the code

**What is already there.** `useTurns` (`conversation-context.tsx`, from line 303) is described in its own comment as
"the turn machinery a box and its transcript share". `conversationAbout` (`ask-in-place.tsx:47-55`) finds the latest
conversation about a chip in the conversations the browser holds. `ConversationInput.beside` tells the model what
stands open. The conversation's page already takes a thing by its address (`?card=`, `?open=`, `?person=`, `?unit=`),
so "Öppna samtalet" needs nothing new (`ask-in-place.tsx:275`).

**Why the full composer and transcript cannot be mounted on another page today.** Both read the one conversation held
above the pages (`Composer`, `composer.tsx:149`; `Transcript`, `components/conversation.tsx:849`), and that provider is
tied to the route: it treats the transcript as belonging to `/` and `/conversations/:id` only
(`conversation-context.tsx:547-552`), navigates to `/conversations/<id>` when a conversation gets its id (`:556-570`),
and sends a question asked anywhere else to `/conversations/new` (`:787-791`). `useAskInPlace` was written to get round
that, and repeats a part of `useTurns` with its own state (`ask-in-place.tsx:68-193`).

**What A and E need.**

- `apps/web/src/components/page-frame.tsx`: `facts` and `end` exclude each other (`:235`, `:287-301`). The frame needs
  a slot of its own for the assistant's pane, has to place the facts above the read while it is open (the branch at
  `:236-247` does that for a narrow window), and has to draw the button. A required prop for the subject, with an
  explicit "none, because", makes a page without one a type error.
- A pane-scoped provider of the same context, built on `useTurns` without the route, so that `Transcript` and a reduced
  `Composer` work inside the pane unchanged. This is what makes "one component" true. Without it there are three chat
  renderers to keep alike: `Transcript`, `AssistantPane` (D128) and `AskTalk`, and `AskTalk` draws an answer's text and
  one page-supplied row only (`ask-in-place.tsx:285-300`): no steps while Clew reads (D126 item 5), no sources, no
  named rows, no draft, no confirmation of a Clew action.
- `Transcript` at the pane's width: a card the answer is about becomes one row that links to it; a view card becomes
  its "Visa allt" link.
- Every page that draws the button itself gives it up to the frame: `tool.tsx:146,228`, `news.tsx:58`,
  `staff.tsx:181-216` with `staff-parts.tsx:651-655`, `person.tsx:425`, `unit.tsx:449`, `item.tsx:79` with
  `work-item.tsx:627-794`, `todo.tsx:618,640`, `calendar.tsx:1023-1028`. Every page without one states its subject:
  `units.tsx:275`, `boarding-list.tsx:171`, `boarding.tsx:591`, `competence-matrix.tsx:978`,
  `competence-search.tsx:523`, `review.tsx:856-872`, `tools.tsx:161`, `conversations.tsx:190`, `admin-frame.tsx:165`.
- Breakpoints that are media queries on the window have to follow the column instead: `tool.tsx:24`, `view.tsx:802`,
  `boarding-list.tsx:58`, and the lists of Personal and Läget. D111's amendment did this once ("its own breakpoint
  shifted by the panel's width while the panel is open") and D126 removed it with the panel.
- The server, for the pane to be about what the page shows: a subject for a record (the read and its input, resolved by
  making the read as the person), and one for a person, a unit and a lens within what D115 and D122 allow
  (`ChipKind`, `packages/contracts/src/index.ts:364-371`; `apps/server/src/assistant/chips.ts`; `context.ts:125`).
  Until then `conversationAbout` finds nothing for a subject with no chip (`ask-in-place.tsx:72-77`), so that pane
  forgets on a reload.
- Tests. Eight specs under `tests/a11y` name the button (`structure`, `calendar`, `answer`, `handover`, `hem`, `tools`,
  `menu`, `person`), and so does `support.ts`; the pane is a new state on every page type and needs a scenario for each (D51);
  the unit suite needs the provider's scenarios.

**B** needs the same provider and frame slot but not the change to the facts panel, and touches about half the pages.
**C** needs almost nothing in the web and removes Kalender's stage 1. **D** is the cheapest in state, because the one
conversation above the pages already exists and only its navigation has to go, and the dearest in layout: the shell has
no end slot (`shell.tsx:268-300`), and Att göra, Kalender, a thing's page and Administration each need a rule for three
columns.

## 7. The protocol half

The owner, on the calendar's two prepared kinds: "this should be something the protocol support and not custom for the
calendar right?"

### What can be declared today

| An action on | Declared by | Where a person starts it | Can the assistant fill it in |
|---|---|---|---|
| A work item | `actions` on a scan's draft or a propose's result, each naming a capability; the capability's `asks` and `effect` (`packages/connectors/src/protocol.ts:321-333`, `:566`) | The item's buttons, wherever the item is drawn | Yes: `clew.draftAction`, for the one work item the conversation is about, a propose or execute of the item's own connector that asks something and has no row-by-row review (`apps/server/src/assistant/drafts.ts:54-74`). The draft is kept on the message (`DraftSchema`, keyed on `threadId`) and opened in the action's own dialog |
| A person or a unit | `about` on a propose or an execute (`protocol.ts:302`), which becomes an `EntityAction` (`packages/contracts/src/index.ts:2197-2208`) | The buttons on their page, Personal's row menu | Only by a propose offered to the model, which the model calls and which becomes a work item with a draft (`index.ts:241-290`); an execute about a person is never drafted |
| A row or a record of a view | Nothing. A view's row can `open` another read and can name a person or a unit as its `subject`; it has no actions | — | No |
| A calendar entry | Not a capability: the calendar's writes are use cases reached by routes ("the human decision endpoint is not a capability and never a tool", `apps/server/src/modules/calendar/connector.ts:18-19`) | "Flytta …", "Ställ in …" in Kalender's pane | Since today, by two tools named in the assistant, `clew.prepareMove` and `clew.prepareCancel`, which close over the meeting that stands open and return a `Prepared` of kind `calendar.move` or `calendar.cancel` (`apps/server/src/assistant/prepared.ts`; `PreparedSchema`, contracts `:3304-3326`) |

### What "a record declares actions the assistant may fill in" would mean

Three ways to put it in the protocol.

- **P1. An action says what it is about, and "about" gains a third kind.** Today `about` names a person or a unit and
  the input property that takes their key. Add: a record of one of the same connector's reads, with the map from the
  action's input properties to the record's, the mirror of a view's `open.params`. Clew then knows, for any record that
  stands open, which actions are about it, exactly as it knows for a person. The write goes the way an entity's action
  goes: the action dialog, the decision endpoint, the execution ledger (D45), a work item with the receipt.
- **P2. The view lists its actions.** A read's view gains `actions`, beside `open` and `subject`. It reads well in a
  manifest, but it is a new presentation field of the closed view catalogue, which D100 allows only when two sources not
  written for Clew need it and a numbered decision says so.
- **P3. Leave the protocol; keep `Prepared` for Clew's own decisions.** Connectors keep work items and entities;
  Clew's modules register their own prepared kinds. This is what stands today and is what the owner said it should not
  be.

**Recommended: P1.** It adds one concept to one that exists ("a capability says what it is about: a person, a unit, or
a record of a read"), it leaves the view catalogue alone, and the registry already builds the same index for entities.

### How the calendar fits without a write becoming a model tool

The rule that holds today is that the model has one tool that writes nothing, and the decision is the person's press.
That survives if the declaration and the execution are kept apart.

1. **The declaration is general.** An action about an object has an id, a label, what it asks, and optionally a read
   that says what it will do. A connector's action names the capability the decision endpoint will run. The calendar
   declares "Flytta" and "Ställ in" about an event the same way, except that they name decisions of Clew's own
   (`rescheduleEvent`, `cancelEvent` in `modules/calendar/usecases/decisions.ts`), which stay out of the capability list
   and out of the model's tools.
2. **One tool fills in.** `clew.draftAction` is offered for the actions about whatever stands open (the work item, the
   person, the record, the event), and only for that: the model never names the object, as D129 item 7 has it. It checks
   the values against the asks as the decision will, and returns a draft. Nothing is written.
3. **One envelope.** `DraftSchema` is keyed on a work item today. It becomes a draft about an object: a work item, a
   person or a unit, a record, an event. `Prepared` and its two kinds go, and so do `clew.prepareMove` and
   `clew.prepareCancel`.
4. **The page draws the draft in the decision's own form.** For a connector's action that is the action dialog at "Det
   här händer", with "Granska och …" and "Ändra", as a work item's draft is drawn now. Kalender draws a draft of "Flytta"
   in its own form with the block on the grid, and a draft of "Ställ in" as its own question. That part stays the
   page's, and it is the only part that does.

### What this review is unsure of

- **Checks beyond the asks.** `prepareMoveTool` refuses a time that has passed, that crosses a day or that is where the
  meeting already is, and tells the model whether the person has something else then (`prepared.ts:137-167`). Asks
  cannot say that. The natural place is the action's `effect` read, called by the draft tool as a dry run; whether an
  effect may refuse, and what it costs to call a source inside a tool call, is not worked out.
- **Asks that depend on the object.** A move keeps the meeting's length; an ask of kind `meeting` has a fixed duration
  in the declaration.
- **An action about nothing that exists yet.** Stage 2's booking has no object. It is closer to a standing action than
  to an action about a record, and the draft tool would have to be offered for those too.
- **Rows.** Whether a table's rows show their actions in a row menu, as Personal does, or only the record's page does.
  The default here is the record's page only.
- **The version.** Whether a third kind of `about` is an addition within protocol 3 or a new version (D60 decides).
- **What it does not give.** A request in the POB connector still needs a reply capability written in the connector. The
  protocol only lets it be declared.

## 8. How four other products place their assistant

Looked up on 2026-11-18 in each vendor's own documentation, and for the fourth in its community forum. The products are
named by what they are, as the repository's documents name no commercial product that is only a reference; the names
and the addresses read are in the report of the session that wrote this review. What a source did not say is marked.

| Product | Opened | What it is about | Kept |
|---|---|---|---|
| The assistant pane in an office suite's word processor, spreadsheet, slides, notes and mail | A side pane "side-by-side" with the document. How it is opened, and whether it remembers being open, was not stated on the page read | The open file ("ask questions about your document") | A separate article on revisiting chat history was not read |
| The assistant side panel of a second office suite | A side panel in each application | The open file | Since early 2026, per application: "This history will only persist in a single app"; a conversation can be resumed across sessions and is private to the person. Before that the panel kept nothing |
| The agent of a notes and wiki product | An icon at the foot of every page; shown as a sidebar or a floating window, the person's choice | "By default, your agent will take in the context of the page you're currently in"; other pages are added with `@` | Earlier chats are listed in the sidebar, named by what they were about |
| The chat of an issue tracker and wiki suite | A panel from a button on a page or an issue | The open page or issue, shown as a line named "Context" | Earlier chats are kept. Threads in the vendor's community forum report the chat answering about another issue than the one shown, which a poster attributed to the earlier conversation; this is a user report, not the vendor's statement |

What they share: a panel beside the content opened by a button, about what is open, with what it is about shown in the
panel. They differ on identity: one keeps history per application, one keeps a list of chats that follow the person.
The one reported failure is the one D128 found in Clew: a conversation that stays while its subject changes.

## 9. Recommendation

**Option E: the assistant beside every page of the person's work, provided by the frame, with the conversation's page
as the same conversation at full size, and with the server and protocol work named as part of the decision, not after
it.**

### The rules as they would stand in interface spaces

1. **Every page of the person's work has one button, "Fråga assistenten", at the end of its title's line, drawn by the
   page frame.** A page says what it shows (its subject) or that it has none and why. Administration has none: nothing
   there is a read the assistant may make. Without a model the button is not drawn (D8).
2. **The button opens the assistant's pane in the page's end slot, and the page stays.** The pane is in the address
   (`ask`), so Back, Forward and a reload reproduce it. Pressing the button again, ✕ or Esc closes it and the focus
   returns to the button. Opening asks nothing.
3. **The pane is the assistant's and shows no thing.** It holds its heading with what it is about, the conversation,
   and the box. A name in an answer is a link to the thing's page, and the pane does not follow it.
4. **The pane is about one subject: the page's thing, the page's list, or the thing standing in the page's own pane.**
   The subject goes with every question as what stands open. Where the assistant cannot read what the page shows, the
   pane says so under its heading before anything is asked.
5. **Where a page's own pane holds a picked thing, the box stands at that pane's foot from the start and the
   conversation about the thing stands over it.** Kalender's entry is the reference. Opening the thing gives the focus
   to its name, never to the box.
6. **A conversation beside a page is a real conversation about its subject.** The pane shows the person's latest one
   about that subject and continues it; "Ny fråga" in the pane starts another. "Öppna samtalet" leads to the
   conversation's page with the subject beside it where a thing can stand there. It is listed under Alla samtal with
   what it is about, and in the rail once it has been opened at full size.
7. **An answer in the pane is text, a few named rows as links, or one row for an action the assistant has filled in.**
   A card, a table, a document, a week and anything from a file are drawn on the conversation's page; the pane draws
   one row that leads there. A list is a link to its page (rule 11).
8. **The assistant fills in only an action about what stands open, and the person sends it.** The filled-in action
   opens in the action's own form: the action dialog, or the page's form where the page has one (Kalender). Nothing is
   written before its last button (rule 6).
9. **The assistant about nothing on a page is Hem's line, Ny fråga and the conversation's page.** Things come to such a
   conversation with `@` and "Lägg till i samtalet" and stand beside it. A file, when files exist, is attached there
   and nowhere else.
10. **The pane stands beside the page from one window width on every page; below it, it is a drawer over the page; on
    a phone the button leads to the conversation's page.** While the pane is open the page draws the narrow layout it
    already has: a table its list, a thing's facts above its read.

Each can be tested on a page that does not exist yet: does it compile without a subject (1), does a reload keep the
pane (2), is there any thing in the pane (3), what does the server receive (4), and so on.

### Conditions to write into the decision, so that it is not reopened

- **It replaces a named list**: D126 item 4's last sentence, D129 item 1's test, and rule 4 of interface spaces. It
  keeps D126 rules 1 and 3: one page per thing, nothing over a page to show a thing.
- **How it differs from D112 item 7, in one sentence**, because it will be read as the same thing: D112's panel showed
  a thing on every page and was the way to open one; this pane shows no thing, opens nothing, and exists only on the
  person's press. If a later change puts a thing into it, that change reopens the decision and has to say so.
- **The page being laid out again when the pane opens is accepted**, as the price of asking beside it, and only on the
  person's press.
- **It is not accepted before it has been walked on five page types** drawn from the real components at 1366 px and
  1728 px: a register, a thing's page with facts, Att göra with a long item at 1280 by 720, Läget, and a phone. Every
  earlier decision was accepted on one.
- **Rule 4's second sentence is binding**: no pane ships on a page whose read the assistant cannot make without the
  line that says so, and the decision lists which reads are to be opened (D122 item 3 is not built for
  `dialogue.unit`, `boarding.plan` and `boarding.person`).
- **Per D102 it is provisional** until a manager outside the repository has asked beside a register and beside a
  thing, and a manual screen-reader pass has been made over the pane.

### What to build first, and what to leave

1. **Draw it.** The five boards above, from the real components. If the register as a list beside the pane at 1366 px
   looks crammed to the owner, stop here: the answer is then B for now, with a higher breakpoint.
2. **The frame and the provider.** `PageFrame` owns the button and the pane; the pane-scoped provider on `useTurns`;
   `Transcript` at the pane's width. Kalender's `AskTalk` moves onto it, so there is one renderer.
3. **Registers first**: a tool's list, Nyheter, Personal's tabs, Läget, Introduktion och avslut, Att göra with no item
   chosen. They have an empty end slot, they are where the owner saw the pattern, and five of them have no button today.
   Open the reads those pages show to the model in the same change.
4. **Things**: a work item, a record, a person, a unit, a plan, the review. This is the change to the facts panel.
5. **Att göra's item**, after its board.
6. **The server's subjects** (a record with its input; a person, a unit and a lens) and **the protocol** (P1), as their
   own decisions. The second has to be settled before Kalender's stage 2.

Leave: Administration; files (their own decision, section 4); a conversation that follows the person from page to page;
an answer that narrows the page's own list, which is where a register's pane would be most useful and is new surface.

### Where this differs from option A's four conditions

- **Condition 1** is right and is the one that carries the whole option. It needs its consequence stated: a link in an
  answer leaves the pane behind.
- **Condition 2** promises more than exists. No register has a picked row, and the server is told what stands open for
  a work item and a calendar entry only.
- **Condition 3** is right, and incomplete: it has to say what an answer may draw, not only what it may not.
- **Condition 4** is two things. "One component" is right and is not what stands today (three renderers). "Under a
  picked thing" is right for Kalender and is D112's stack on Att göra, with the Astryx gap D112 recorded for it
  (`ChatLayout` has no place for a thing above its messages). It should be drawn before it is decided.
- **A is silent** on which conversation the pane continues, on what the rail lists, on Administration, on a phone, on
  the general path and on files. Those silences are where the next reversal would start.

### The strongest argument against this recommendation

It is D112's panel for the fourth time, and the owner removed it three days after seeing it. The difference this review
leans on, that the pane shows no thing, is a difference of content. What the owner saw on 11-14 was a side panel on
every page that made the page give way, and that is what E builds. If the objection then was to the shape and not to
the three jobs, E will be reversed as its predecessors were, after more work than any of them. B would cost half as
much, would meet every example the owner gave on 11-18 except the record, and would leave D126 standing. And on the
pages the owner pointed at (Läget, Introduktion och avslut, a POB request) the assistant cannot read what is shown, so
the first thing a pane there would say is that it cannot help: the chat that can do little, which D104 was written
against.

### Confidence

- That the assistant should be asked beside the page and not by leaving: high. The owner has said it five ways in one
  day, and it is what the four products looked at do.
- That it should be every page through the frame, not collections only: moderate, about two in three. What would
  change it: the boards at 1366 px.
- That a conversation beside a page is one per subject and not one that follows the person: low to moderate. It is what
  is built and it avoids failure 9, but it makes many small conversations and loses the thread between a list and its
  row. What would change it: the owner finding, on the boards or live, that the pane "forgets" when moving from a
  register to a record.
- That the box should stand under an item in Att göra: low. It rests on one sentence said about Kalender.

## 10. Questions only the owner can answer

| # | Question | Default taken here |
|---|---|---|
| 1 | One conversation per subject, found again where the subject is shown, or one conversation that follows you from page to page until you start a new one? | Per subject, as built today for Kalender. |
| 2 | Should a conversation asked beside a page appear among the rail's three latest? | No: it is under Alla samtal with what it is about, and enters the rail once opened at full size. |
| 3 | On Att göra, does the box stand under every item from the start, as on Kalender, or does the item have the button? | Standing, if its board at 1280 by 720 with a long item holds; otherwise the button, with the conversation taking the read's place under the item's title and decisions. |
| 4 | Where the assistant cannot read what a page shows (Läget, Introduktion och avslut and a POB request today): the button with a line that says so, or no button until it can? | The button with the line, and the reads of Clew's own domains opened in the same change (D122 item 3). |
| 5 | Is a file a person brings to a conversation Clew's to read, or the AI platform's? | Not built now and decided on its own. If Clew's: at full size only, as a chip on the question, kept with the conversation. Until then a question about a file goes to another system's assistant through D128's panel. |

## Appendix: the facts, with where they were read

Paths are from the repository root; lines are those of the working tree on `calendar-pass` on 2026-11-18, with two
builders editing.

| Fact | Where |
|---|---|
| "Fråga assistenten" is `AskClew`; it is not drawn without a model or without a subject; `useAskAbout` starts a new conversation and navigates to `/conversations/new` plus the subject's part of the address | `apps/web/src/components/thing-panel.tsx:11-31`, `:39-59` |
| A subject is a key, a label, chips and a part of the address | `apps/web/src/components/conversation-context.tsx:1009-1014` |
| A person or a unit as a subject has no chip; a lens has none | `apps/web/src/conversation-about.ts:102-108`; `apps/web/src/pages/staff.tsx:181-190` |
| A view as a subject is the chip `capability:<name>` with the view's title; its input is in the address only | `apps/web/src/components/view-read.tsx:26-39` |
| "a person or a unit goes with none, since what a source says about them never reaches the model" | `apps/web/src/pages/conversation.tsx:128-134` |
| The one conversation is held above the pages and tied to the route | `apps/web/src/main.tsx:209`; `apps/web/src/components/conversation-context.tsx:544-570`, `:787-791` |
| `useTurns`, the machinery a box and its transcript share | `apps/web/src/components/conversation-context.tsx:303` onward |
| The full composer: `@`, the drawer, the verbs, the model menu, dictation; no file | `apps/web/src/components/composer.tsx:139-276` |
| The transcript reads the one conversation | `apps/web/src/components/conversation.tsx:816-849` |
| The conversation's page: the pane from 1200 px, 360 to 720 px wide | `apps/web/src/pages/conversation.tsx:73-82`, `:344-386` |
| Asking in place: its own state, the latest conversation about a chip, the reduced box, text and one supplied row per answer, "Öppna samtalet" | `apps/web/src/components/ask-in-place.tsx:47-55`, `:68-193`, `:203-243`, `:255-325` |
| Kalender: the pane is 440 px, beside from 1340 px, else a drawer; no asking in place on a phone; the range's button opens the pane | `apps/web/src/pages/calendar.tsx:419-420`, `:627-630`, `:944-971`, `:1023-1028` |
| Att göra: the pane at least 440 px, the list at least 300 px, one surface below 900 px of column | `apps/web/src/pages/todo.tsx:102-105` |
| The page frame: the facts panel is 340 px; `facts` wins over `end`; the facts stand above the read at 1024 px and below; the sheet's inset | `apps/web/src/components/page-frame.tsx:28-32`, `:235-247`, `:282-301`, `:311` |
| Administration's frame: the sections in the start slot, 240 px, no way to ask | `apps/web/src/components/admin-frame.tsx:60`, `:165-190` |
| The shell has a top bar, a rail and a banner, no end slot | `apps/web/src/components/shell.tsx:268-300` |
| The rail's list of conversations is every thread of kind `question` | `apps/web/src/stream.ts:48`; `apps/web/src/components/nav.tsx:194-248`, `:351-380` |
| A question: at most 400 characters and eight chips; `beside`; `own` | `packages/contracts/src/index.ts:4738-4767` |
| Chip kinds: thread, item, event, proposal, capability, document | `packages/contracts/src/index.ts:364-371` |
| A draft is keyed on a work item; a prepared decision is one of two calendar kinds | `packages/contracts/src/index.ts:3285-3293`, `:3304-3326` |
| An action about a person or a unit | `packages/contracts/src/index.ts:2197-2208` |
| What the model is told of a view chip: `Förmågan "<title>" (<source>).` | `apps/server/src/assistant/context.ts:125` |
| A chip is resolved on the server as the person; a view chip only to its capability's title and source | `apps/server/src/assistant/chips.ts:20-96` |
| The draft tool is offered for one work item; the two prepare tools for a meeting that stands open and may be changed | `apps/server/src/assistant/index.ts:522-562`; `apps/server/src/assistant/drafts.ts:54-74`; `apps/server/src/assistant/prepared.ts:107-200` |
| A question with nothing attached: people named, work items named, the model's reads, another system's assistant only then | `apps/server/src/assistant/index.ts:780-860` |
| Reads offered to the model, and not | `apps/server/src/modules/requests/capabilities.ts:26` and `errands/capabilities.ts:23` (`true`); `connectors/pob/manifest.mjs:158` (`pob.requests`, `true`), `:196` (`pob.request`, `false`); `apps/server/src/modules/dialogue/capabilities.ts:124` (`dialogue.unit`, `false`); `apps/server/src/modules/boarding/capabilities.ts:139,154` (`false`) |
| The protocol: `about` on a capability, `asks`, `effect`; a scan's actions; a view's `open` | `packages/connectors/src/protocol.ts:302`, `:321-333`, `:566`; `packages/contracts/src/index.ts:596-611` |
| The calendar's writes are not capabilities | `apps/server/src/modules/calendar/connector.ts:15-21` |

Not verified by this review: anything in a browser; whether the specs pass; the Astryx spacing behind the sheet's inset
(taken as 12 px); the phone; any claim about the other products beyond the pages cited.
