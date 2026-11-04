# D9 · The side panel holds conversation, Clew views and MCP App views

**Status:** accepted · **Date:** 2026-11-03 · **Area:** ui

**Decision.** The surface to the right of the stream on desktop (bottom sheet on the phone) is a side
panel with two kinds of content, as in Eneo's sidebar: a
**view** rendered by Clew from a `read` capability's output schema, and an **app** rendered by the module
itself through the MCP Apps extension, sandboxed. In phase one the panel shows one thing at a time: a view or an app, carrying its own
interaction (day navigation, tapping a free slot), Stacking
a "Du tittar på" scope block and suggested questions under a view comes later. A
full-page button lifts a view into the main column.

**What opens it.** Clicking a row in a card opens a view about that row (the day around a proposed time). A secondary action with `kind: read` and `target: panel` opens an app or a view.
"Svara" sets the composer's scope to the thread and opens the conversation overlay with its memory (the conversation is never in the panel; see integrations.md, "Where the conversation lives").

**Rules for apps.** Sandboxed, no access to the page, given only what the card already knows (refs, period).
Buttons inside the app call the module's own MCP server with the user's token (D5), never the assistant and
never Clew's capabilities. Nothing from the app is stored in Clew except an audit row that it was opened.
Views and apps work unchanged without the model (D8).

**Why.** Two open questions close. A free slot in the calendar is not the same as a usable slot; the planner
sees gaps, not context, so the person previews the day around the proposal and decides. No travel-time
estimates or similar reasoning at this stage: the preview is enough. And the names guardrail holds: an app surface is
the source system, inside Startsidan, so a name may appear there and never in the card. Modules still never
draw cards (D1); they draw their own panel content, which is a different thing.
