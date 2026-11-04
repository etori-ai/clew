# D12 · Objects, chips, proposals: the general interaction pattern

**Status:** accepted · **Date:** 2026-11-03 · **Area:** ui

**Decision.** Everything rendered on the page is an **object** with a stable ref, a label and a type: a card,
a row in a card, a calendar event in the side panel, a row in a view, an item in an MCP App view. Any
object can be added to the conversation as a **chip** in one of three equivalent ways: click it and choose
"Lägg till i samtalet", drag it to the composer row, or type `@` in the row and pick from what is visible
first, then everything else. Chips sit above the input, are removable, and the chipped object is
highlighted where it is. The row prefix reads "Om 2 saker".

Chips are the explicit context; the page is the implicit one. With chips the assistant does not guess.
Without chips it may resolve a reference such as "mötesförslaget" against the page state, and must then
show which object it picked by lifting it above the dim. That is the fallback, not the main path.

The side panel stays live during a conversation: the dim covers the stream only. The panel is where the
person browses and points, the overlay is where they talk, chips are what travels between them.

The conversation edits **cards**, never systems. "Flytta det så Annas samtal får 15:00" updates the
proposal card (Anna at 15:00, a new row "Rektorsmötet flyttas till 16:00"), marked as a draft in the card
and in the panel's day view. The card's own button executes everything. Clew-side actions (dismiss,
remind) are confirmed in the overlay. "Svara" on a card is the same as "Lägg till i samtalet" and is
named so.

**Why.** The strongest analogues converge on this: Cursor and Claude Code (select, Add to Chat, `@`
mentions, context pills), Microsoft 365 Copilot's Context IQ (`/` for people, files, meetings, emails),
Gemini in Gmail (`@Calendar`, `@Drive`). The thing you talk about is an attachment, visible as a chip,
added by selecting or typing a trigger. None rely on the model guessing from the screen as the primary
path. It also dissolves the conflict between panel and overlay: they stop competing once chips connect
them.

**Replaces.** The "Svara" button on cards (D9 wording and the thread action contract), and the lift-by-
guessing board as the main path. Canvas row "Det generella mönstret".
