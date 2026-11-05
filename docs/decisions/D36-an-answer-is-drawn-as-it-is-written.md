# D36 · An answer is drawn as it is written; the box never moves under the cursor

**Status:** accepted, built 2026-11-05 · **Date:** 2026-11-05 · **Area:** ui

**Decision.** A question shows at once and its answer arrives as it is written. The landing's box stays where it is
while the person types.

1. **The turn streams over server-sent events.** `POST /api/conversation/stream` takes the same body as
   `POST /api/conversation` (which stays, as JSON) and answers `text/event-stream`: `step` events (a capability the
   turn reads: id, capability, the registry's title and source, `running` then `complete` or `error` with its time in
   ms), `text` events (the model's answer so far as a delta; `reset` starts it over), then `done` with the
   `ConversationResponse`, or `error` with the Swedish message the JSON route would give. The schemas are
   `TurnStepSchema`, `TurnEventSchema` and `ConversationEventSchema` in `@clew/contracts`. The browser reads the body
   with `fetch` (`api.converseStream`), because `EventSource` only sends a GET. The body is validated before the stream
   opens, so a bad request is still a plain 400.
2. **The use case is unchanged in what it writes.** `converse(persona, input, { emit, signal })`: the question thread,
   both messages and the audit row are still written together in one transaction once the answer is known. The
   listener only hears progress. Each capability the turn runs (router or model) is a step. The model's text comes
   through `ModelGenerate.onText`, now on the AI SDK's `streamText`, with the current step's text reported and a new
   step starting it over. `visibleSoFar` in `assistant/answer.ts` holds back the "Följdfrågor:" trailer while it
   streams, so what is shown only grows. When the model fails mid-answer the listener gets a reset and the router's
   answer comes in `done`. A closed connection aborts the turn: the model call stops, `TurnStopped` is thrown before
   the write, nothing is saved, and the provider is **not** marked down (a stop is not a failure).
3. **The browser draws the turn before the answer.** On send, `ConversationProvider` keeps a `PendingTurn`: the
   question is drawn in the transcript at once (the landing switches to the conversation immediately), and under it
   the answer is pending. Before anything is known that is two Astryx `Skeleton` lines. The reads show as
   `ChatToolCalls` (the system as the call's name, what it asks as its target, "0,8 s" when done). The text goes
   through Astryx `useStreamingText` into `Markdown`, which shows it whole under reduced motion. `ChatMessageList`
   `isStreaming` marks the log `aria-busy` while the answer is written. Message rows are keyed by position, so the
   pending question and answer become the written ones in place: the log speaks the answer once and never repeats the
   question. When `done` arrives, the written turn replaces the pending one and the route becomes `/samtal/:id` as
   before.
4. **Stoppa, and the box stays open.** While an answer is pending the composer's send button is Stoppa
   (`ChatComposer` `isStopShown`, `onStop`). The field stays enabled and keeps the focus, so the next question can be
   written meanwhile. Enter waits until the answer is in, through `ChatComposerInput`'s documented `onKeyDown` seam,
   because the input empties itself on every submit. Stoppa, Esc and leaving the page abort the fetch. Stopped or
   failed, the question goes back in the box if the box is empty, and a stop is announced ("Frågan avbröts. Den ligger
   kvar i rutan."). Ny fråga, ⌘K and opening another conversation also abort, without putting the question back.
5. **The landing's box is anchored from the top (amends D34, "the landing's shape").** The brief and the box are one
   block from the top of the column, and only the day line is pushed to the foot. "Menar du" and the chips grow below
   the box and can never move it. Before, the box sat between the brief and the foot of a `vAlign="between"` stack,
   so every change in the suggestions moved it by half of that change.
6. **The cards' first read has a shape.** Until `/api/threads` answers, the landing draws `BriefSkeleton` (the brief's
   rows: the day, the title over its line, the button; one visually hidden line "Hämtar det som behöver dig …") and
   no greeting sentence. The overview's Nu draws the same skeleton instead of "Lugnt läge". The page never says that
   nothing needs the person before it has read the cards.
7. **The model menu is always there when a model answers (amends D24).** `ModelMenu` shows whenever the person's
   status has a current model, also with only one, so the box always says which model the next question goes to.
   Without a model the router answers and there is no menu.
8. **"Lägg till i samtalet" is an icon (amends D34's brief rows and the cards).** One component,
   `components/add-to-conversation.tsx`, everywhere a card, a row, a source or a meeting can go into the box. It is a
   ghost `IconButton` with Heroicons' `AtSymbolIcon`, the `@` the box itself uses for the same act and the glyph
   Astryx's `ai-chat-landing` template gives its reference button. The words are the button's name and its tooltip.
   Once the object is in the box, the button is the `check` icon named "I samtalet" and it rests. On desktop the
   brief's rows centre their day and actions vertically (`ListItem align="center"`). On a phone the actions stay
   under the text, level with its first line.

Astryx only: `ChatComposer` `isStopShown`/`onStop`, `ChatComposerInput` `onKeyDown`, `ChatMessageList` `isStreaming`,
`ChatToolCalls`, `useStreamingText`, `Skeleton`, `IconButton` with `tooltip`, `ListItem` `align`. Heroicons
(`@heroicons/react` 2.2.0, MIT) is the icon set Astryx's own templates import. It is pinned in `packages/ui`, and each
glyph is exported once from `@clew/ui`. It is a set of glyphs, not a second component system.

Not built: H1's line after the answer ("Läste attestlistan i Raindance, 0,8 s"). The steps are live only and not
stored, and the written answer keeps its source and model footer. Citations show as plain `[n]` while the text
streams and become links when the turn is written. Opening an earlier conversation from the rail has no skeleton yet.
No manual screen-reader pass of the pending state has been made.

**Why.** The product owner reported two things. The box jumped while they typed, because the suggestions changed under
it. Sending gave nothing to look at until the whole answer was back: the box went grey, and the page stayed on the
landing for as long as the model took. Weighed and left:

- For the jump: "Menar du" in a popover over the chips (its rows would sit at the end of the tab order, outside the
  box's flow); a reserved height for the suggestions (a magic number in the layout); keeping the centring and
  measuring (a `ResizeObserver` is not allowed).
- For the composer while an answer is written: Astryx's interruptible state, the composer disabled with only Stoppa
  live. It dims the whole composer to 60 % opacity, so the scope line drops below 4.5:1, which axe reports and a
  person reads as broken. A disabled field also cannot keep the focus D31 promises. The `onKeyDown` seam keeps the
  field open and still stops a second send.
- On Stoppa: keeping a partial answer would mean storing a half turn, with its own audit row. Putting the question
  back costs nothing and saves nothing.
- For the transport: server-sent events are a WHATWG standard that Hono writes (`streamSSE`) and any proxy passes
  through. WebSockets would add a second protocol for a one-way stream.

**Replaces.** Amends D24 (the composer's menu showed only with two models or more), D31 (the box no longer rests
greyed while an answer comes; focus stays in it) and D34 ("Lägg till i samtalet" as a text button on the brief and
the cards; the landing's box centred between the brief and the foot).
