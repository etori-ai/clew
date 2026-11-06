# Review: a side question beside the running conversation · 2026-11-06

**What was reviewed.** The product owner compared Clew's panel with the Claude desktop app on 2026-11-06 and noted that
Claude Code lets a person ask a side question that opens as a separate chat on the right, beside the running
conversation, and asked whether Clew should explore the same. This is that exploration, without building: the vision,
the four decisions that shape the column and the panel ([D50](../decisions/D50-the-conversation-is-the-column-and-the-panel-holds-what-it-is-about.md),
[D53](../decisions/D53-hem-is-the-start-page-the-days-work-under-the-box-and-the-day-beside-it.md),
[D63](../decisions/D63-hem-is-drawn-as-the-canvas-draws-it.md),
[D66](../decisions/D66-the-panel-keeps-everything-opened-beside-the-page-as-tabs.md)), the components that draw them
(`apps/web/src/components/panel.tsx`, `composer.tsx`, `thread.tsx`, `conversation-context.tsx`, `pages/start.tsx`),
the two canvases **Clew · ett sammanhängande flöde** and **Clew startsida · dagen i ett svep**, and what Astryx's Chat
family and templates offer for a second transcript. No decision is written and no product code is changed.

**Short answer.** Clew does not need a side chat today, and should not build one until a person is seen losing their
place in a running conversation. Most of what the Claude Code pattern gives is already on the page in another shape:
the panel keeps every card and view a conversation opened as tabs (D66), "Ny fråga i stället" starts a clean
conversation from the box, an earlier conversation is one click away in the rail and opens where it ended, and an
answer in Clew takes seconds, not the minutes during which a Claude Code session is busy and cannot be interrupted.
The one thing a side question would add is a question answered *about* the running conversation without becoming
part of its memory. If the product owner wants that, the shape that fits D50 is a tab in the panel named by its
question, with its own compact transcript and composer, saved as a conversation of its own that remembers which
conversation it was asked beside; never a second column, and never the main conversation moved into the panel. The
recommendation is to wait, and the open questions are at the end.

## What the Claude Code pattern does

In the Claude Code desktop app a person working in a session can open a **side chat** (the product owner's "btw"):
a second, smaller conversation that opens on the right of the running one. What is known about it from Anthropic's
own desktop documentation and from secondary sources:

- It is asked while the main session is running, often while the agent is in the middle of a long task that the
  person does not want to interrupt. Claude Code's main session is busy for minutes at a time; a question typed into
  its composer would queue behind the work or steer it.
- It reads the session's context: the side question can be about what the main session is doing, and the answer is
  drawn from the same transcript and files.
- Its answer does **not** go back into the main session. The side chat is a detour (a spec lookup, "what does this
  flag do", "remind me what we decided"), and when it is closed the main conversation is exactly as it was.
- It is a separate surface with its own composer, opened by a shortcut or a control, placed in the same right-hand
  region the app uses for other things beside the transcript (the diff, the terminal, a file).

Two of these four properties carry the pattern: the main conversation is **busy and must not be disturbed**, and the
side question is **about the main conversation but kept out of its memory**. The other two (a second composer, a
right-hand placement) are consequences.

Sources read for this: Anthropic's desktop documentation at code.claude.com (the desktop reference and quickstart
describe a side chat that "uses the session's context" without derailing it) and a handful of secondary write-ups; a
third-party guide names a `/btw` command, which was not verified against an official source.

## How Clew's column and panel relate today

[D50](../decisions/D50-the-conversation-is-the-column-and-the-panel-holds-what-it-is-about.md) gives every surface
one job. The rail holds places and earlier conversations. The column shows where the person is: a page, or **the**
conversation. The panel holds what the person keeps beside the column: a view, a source or a card. Its one sentence
that this review has to respect: *"The conversation is never in the panel."* The product owner chose this ("B") on
2026-11-05 over the drawn alternative "A", a conversation that lives in the panel on every page, because A gave a
conversation two homes and two widths, made the panel hold both the conversation and what was opened, and squeezed
rich answers into 420 px. The flow canvas's own note says the same in Swedish: "Panelen: en enda, till höger. Den har
ett jobb: det du håller bredvid ytan. … Samtalet ligger aldrig här, det är alltid ytan."

[D53](../decisions/D53-hem-is-the-start-page-the-days-work-under-the-box-and-the-day-beside-it.md) and
[D63](../decisions/D63-hem-is-drawn-as-the-canvas-draws-it.md) make Hem the page the conversation grows out of: the
box under the greeting, the day's work under the box, the day beside it. Asking swaps Hem for the transcript in the
same column (D31, D50 item 5); what the person was looking at goes along into the panel; "Stäng samtalet" leads back.
D63 item 12 gives the transcript Hem's width, 40 px in from the rail, and item 14 makes the panel a resizable region
(320 to 560 px) with a fold button that rides its edge.

[D66](../decisions/D66-the-panel-keeps-everything-opened-beside-the-page-as-tabs.md) is the closest thing Clew has to
the Claude Code right-hand region: everything a conversation opens beside itself joins a row of tabs in the panel's
header (`TabList` with `role="tablist"`, each `Tab` named by the thing itself), the address holds the current one, Esc
and ✕ close the current one, the fold drops them all. The artboards call this row "Det samtalet rör": what the
conversation is about.

In code, `usePanel` in `panel.tsx` is one hook for every page: a `PanelFrame` (id, title, body, close, address,
actions, `tab`) becomes a `LayoutPanel` in the page's `end` slot where the window is wide enough (rail 256 + the
column's least width + panel 440; 600 px for a transcript, so 1296 px and up beside a conversation) and a `Drawer`
elsewhere. The conversation's state is one object above the pages (`ConversationProvider`, `useConversation`): one
`conversation`, one `pending` turn, one `value` in the box, one list of chips. There is one `Composer`; the same
component is the box on Hem, in a conversation and at the foot of a tool's page, and it knows where it stands through
`place`. A conversation has an address (`/conversations/:id`) and a row under Samtal in the rail; opening another
closes the one on screen. Nothing in the web app holds two conversations at once, and nothing in the server's
conversation routes answers a question about a conversation without appending to it.

## What already covers the need

The Claude Code pattern answers five small needs. Four of them have a surface in Clew already.

| The need | Claude Code | Clew today | Covered? |
|---|---|---|---|
| Keep what the conversation is about in sight while it runs | the right-hand region | the panel's tabs (D66): the card, the view, the source the assistant cited; "Lägg till i samtalet" on any card or row puts it into the conversation as a chip | yes |
| Look something up without steering the running conversation | the side chat | a connector's view opens in the panel from a turn's "Öppna bredvid" or from the rail's search, without a question; `@` in the box finds any object in scope | mostly: a *read* is covered, a *question* is not |
| Ask something unrelated without losing the running conversation | the side chat | "Ny fråga i stället" in the box's scope line, or "Ny fråga" in the rail: a new conversation takes the column, the old one waits under Samtal · I dag and opens where it ended (artboard H) | yes, with a change of column |
| Come back to where you were | close the side chat | the rail's row, or "Fortsätt samtalet · …" in "Menar du" while typing | yes |
| Ask *about* the running conversation without it becoming part of the memory | the side chat | nothing: a question in the box is a turn, and every turn is remembered (HANDOVER item 2: memory is the point) | no |

The difference that remains is the fifth row. It is real but narrow: "what did we decide about Skanska", "which
systems did step 2 touch", "explain the receipt", asked of a conversation that is long. In Clew those are also
answered by the panel (the card's Historik, the job's step list in artboard J) without any question.

**The busy case is weaker in Clew than in Claude Code.** Clew's box is held while an answer is on its way
(`isDisabled={talk.busy && !talk.pending}`), the send button becomes Stoppa, and the person may type the next
question meanwhile (D36). An answer takes seconds: a router hit is instant, a model turn a few seconds, a read a few
more. The long-running things in Clew are durable, not conversational: a job across three systems (artboard J, D55)
or a watch (D47) runs in Temporal and comes back as a card, so the person is never waiting in the transcript for
minutes with nothing to do. The core reason the side chat exists in Claude Code, a session that is busy and must not
be touched, hardly arises.

## What a side question would add

- **A question answered from the conversation's context without becoming one of its turns.** This is new. It needs a
  server route that reads a conversation as context and answers without appending, and a rule for what the answer
  may read: the same scope as the conversation's actor, the same connectors, and never `execute` (a side question is
  a read, as `clew.call` is for a module).
- **Two transcripts in sight at once.** The main one in the column, the side one in the panel. Clew has never drawn
  two; D50 rejected "A" partly for this.
- **A second composer on the page.** Two text boxes, two labels ("Svara i samtalet" and, say, "Fråga vid sidan av"),
  two scope lines, two model menus or one shared. The box's placeholder and scope line rule (H3.3: the box always says
  what it talks to) would have to hold for both.
- **A new kind of thing in the address.** D50 item 4 puts what the panel holds in the query (`open`, `open-card`,
  `card`); a side question would add `open-conversation=` or the like, and D66's tab row would carry it as a tab.
- **A new kind of row in the rail.** If a side question is saved it is a conversation; under Samtal it needs to say
  which conversation it was asked beside (D50 lists "a conversation's origin shown on a card and on a tool's page" as
  not built; this would be a third origin).

## How it sits with D50

Three readings are possible, and only one is consistent with the decision as it stands.

1. **The side question is a sibling conversation that happens to be drawn in the panel.** This is "A" by another
   name: a conversation in the panel, two homes and two widths. D50 rejected it and the flow canvas's note forbids it
   in so many words. Not an option without reopening D50.
2. **The side question is what the running conversation is about.** It is asked of the conversation, it reads the
   conversation, and its answer is one more thing the person keeps beside the column, like the contract the assistant
   cited or the view it opened. Under this reading it is exactly what D50 item 3 and D66 say the panel holds: one more
   tab in "Det samtalet rör", named by its question, closed with Esc like any other tab. D50's sentence "the
   conversation is never in the panel" then means *the* conversation, the one in the column, which stays where it is;
   a side question is not that conversation, as a card's Historik is not that conversation either. This reading
   holds, and it is the only one that lets a side question be built without changing a decision.
3. **The side question is an ephemeral answer, not a conversation at all.** Asked in the main box with a marker, the
   answer appears as a system message in the transcript (Astryx's `ChatSystemMessage`) or as a toast, and is not
   saved. Nothing new in the panel, no second composer, no address. Cheapest, and it keeps D50 untouched, but an
   answer that is not saved cannot be found again, and a system message in the transcript is in the memory in
   practice even when the server leaves it out. It also conflicts with the vision's "the person sees why": an answer
   with no trace is an answer with no receipt.

Reading 2 has one consequence for D66 that is worth stating now: a tab that holds a transcript and a composer is
heavier than a tab that holds a card. The row would mix things the person *opened* with a thing the person *asked*;
the artboards draw the former only. A side question would need its own artboard before it is built.

## The canvas

Neither canvas draws a second conversation.

- **Clew · ett sammanhängande flöde** (D50's canvas) draws one conversation in the column with the panel beside it
  ("2 · Samtal med panel": two tabs, Telefonbok and Attestreglemente, "Det här samtalet · två saker i panelen"), and
  its flow map says "Tre platser, ett samtal, en panel". The rejected alternative A, the conversation in the panel on
  every page, is the nearest the canvas comes and it was drawn to be rejected.
- **Clew startsida · dagen i ett svep** draws the panel's tabs on F ("Kortet", "Avtalet Skanska 2025"), H ("Mitt team ·
  fre", "Vikarieförfrågan") and J ("Jobbet", "Hassan Ali", "Mitt team"), always as cards, views and sources, under the
  label "Det samtalet rör". Artboard H is the one that covers "coming back": the older conversation opens where it
  ended, with "Något hände sedan du var här" as a divider, and the panel still holds what that conversation opened.
  Artboard G says in its note that a new question from Hem opens no new tab: "Ingen ny flik, ingen ny sida".
- Nothing on either canvas has two composers on one screen, and no phone frame (K, 6) has room for one.

So a side question is not on the canvas, and the canvas is the reference for every screen (CLAUDE.md). If the product
owner wants it explored further, the next step is an artboard, not code: artboard F with a third tab "Vad bestämde vi
om 10241?" holding a short transcript and a one-line composer, at 1440 and at 390.

## Astryx

Astryx covers the whole of reading 2 without anything custom:

- **`ChatLayout`** in a narrow container. Astryx's own "Panel View" example is a 450 px sidebar chat with `compact`
  density, which is precisely the panel's width (320 to 560 px). The one rule in its documentation that matters here:
  *"Don't render multiple ChatLayout instances in the same scroll container; each expects to own its scroll
  context."* The `LayoutPanel` is its own scroll container (`isScrollable={false}` on the panel, the body inside it),
  so a second `ChatLayout` in the panel is allowed; a second one in the column is not.
- **`ChatMessageList`, `ChatMessage`, `ChatMessageBubble`, `ChatMessageMetadata`**, as the transcript uses them
  (`Conversation` in `thread.tsx` already draws a compact message list inside a card's Historik collapsible).
- **`ChatComposer` `compact`** with `ChatComposerInput`, a scope line in `headerActions` ("Vid sidan av · om det här
  samtalet") and no drawer and no model menu, so it is visibly the smaller box.
- **`TabList`/`Tab`** in the panel's header, as D66 has them; a side question is one more `OpenTab` with its
  question as the name.
- **`Drawer`** on a narrow window and the bottom sheet on a phone, as the panel already is (artboard K): the side
  question's transcript stands above the main one in the sheet, and the main composer is hidden under the sheet
  while it is open, which is the one place two composers would otherwise be on screen at once.
- **`ChatSystemMessage`** for reading 3 if it were chosen; **`Popover`** and **`Dialog`** were looked at and are
  wrong for it: a popover closes on a click outside and holds no transcript, a dialog is modal and takes the column
  out of use, which is the opposite of the point.

No gap report (the product owner, 2026-11-04). The `ai-chat` template places its artifact panel with its own
stylesheet and a container query; Clew composes the same shape with `LayoutPanel` and `useMediaQuery` (D50), and the
side question would reuse that, not add to it.

## WCAG 2.2 AA

The points that a side question raises, beyond what the panel already does (focus to the heading or current tab on
open, Esc back to the opener, the new name spoken, `role="complementary"` with a label):

- **Two text boxes (1.3.1, 2.4.6, 4.1.2).** Each needs a distinct label and a distinct scope line, so a screen-reader
  user hears which conversation they are writing to: "Svara i samtalet" stays on the main box, the side box says
  what it is beside. Neither may take the focus from the other on open (the panel already refuses to move focus
  away from a field the person is typing in: `TYPING` in `usePanel`).
- **Two answers on their way (4.1.3).** Clew announces an answer's progress and arrival through one live region. A
  side answer arriving while the main one streams must be announced as the side one ("Svar vid sidan av: …") and must
  not interrupt the main announcement; one `useAnnounce` with a queue, or the side one polite and the main one
  assertive. The toast locator rule in `tests/a11y` applies (text mirrored into the region named Aviseringar).
- **Focus order (2.4.3).** The tab row, the side transcript, the side composer and the panel's ✕ are one group after
  the column's composer in tab order, as the panel's body is now. Sending in the side box keeps the focus in the side
  box, as the main box does ("the row keeps focus throughout; sending never moves it").
- **Esc (2.1.1, 2.1.2).** Esc in the side composer must not close the panel while a trigger menu (`@`) is open; the
  panel already lets a menu, listbox or dialog keep its own Esc. Esc with nothing open closes the side tab and
  returns the focus to what opened it, the same as a card.
- **Reflow at 320 px (1.4.10).** There is no "beside" at 320 px: the side question is the drawer or the phone's
  sheet, full width, over the main transcript, and the main composer is under the sheet. Two composers are never
  both reachable on a phone, which is a feature, not a loss. Text in the side transcript reflows as the main one does.
- **Status messages (4.1.3) and the busy state.** If the main box is held while the side answer is on its way, or the
  other way round, the held box must say why in its status, not only be disabled; today a disabled control drops the
  focus it holds (the thread card avoids `isDisabled` on action buttons for that reason).
- **A test in `tests/a11y`** for the new state (a side question opened beside a conversation; two labelled boxes;
  Esc; the announcement; the drawer at 1280 and the sheet at 390), and a manual screen-reader pass, since a second
  live transcript is new to the product.

## Recommendation

**Do not build a side question now.** Record this review and wait for evidence. The need Claude Code answers (a busy
session that must not be disturbed) is weak in Clew, where an answer takes seconds and long work is durable and comes
back as a card; the four other needs have surfaces already (the panel's tabs, "Lägg till i samtalet", "Ny fråga i
stället", the rail). What remains, a question about the running conversation that does not become part of its memory,
is narrow, and a card's Historik and a job's step list in the panel answer much of it without a question.

**If the product owner wants it anyway, build it as reading 2**, and only after an artboard:

- A side question is a tab in the panel's row, named by its question, with a compact `ChatLayout` and a compact
  `ChatComposer`; it is in the address as the panel's other things are; Esc and ✕ close it; the fold drops it.
- It is saved as a conversation of its own with an origin ("asked beside: <conversation>"), listed under Samtal, so
  it has a receipt and can be found again; its answers never go back into the main conversation.
- It reads with the main conversation's actor and scope, and it refuses `execute`: nothing is proposed, confirmed or
  decided in a side question. A decision is asked for in the column.
- Never in the column, never two columns, and never the main conversation in the panel: D50 stands as written.
- A test in `tests/a11y` and a screen-reader pass before it is called done.

**Open questions for the product owner.**

1. What is the situation this is for? A long conversation the person cannot find their way back in, or a question
   that comes to mind while an answer streams? The first is better served by the panel's tabs and Historik; the
   second by letting the box take the next question while an answer is on its way, which D36 already allows.
2. Should a side question be remembered at all? Claude Code keeps it out of the main session; Clew's rule is that
   every answer has a trace. Saved as its own conversation (this review's recommendation), or ephemeral (reading 3)?
3. May a side question read the connectors, or only the conversation? Reading connectors makes it a conversation in
   its own right; reading only the transcript makes it a summary of what was said, which the model may be unable to
   do well for a conversation that is mostly receipts.
4. Where would it be asked from? A control in the conversation's toolbar ("Fråga vid sidan av"), a marker in the
   main box, or a keyboard shortcut (Claude Code uses Cmd+;)? A shortcut alone is not enough (2.1.1 is satisfied
   either way, but discoverability is not), and D63 took the keyboard hint out of the box.
5. Is an artboard worth drawing now, to see it beside F and K, or does this wait until a person has asked for it?

## Outcome

This review only. No decision written, no product code changed. If the product owner chooses to explore further the
next artefact is an artboard on the canvas **Clew startsida · dagen i ett svep** (F with a third tab holding a side
question, and K with the same tab in the sheet), then a decision that amends D66's tab row, not D50.
