# D38 · A view is declared by the connector and drawn by Clew

**Scope update, 2026-11-08.** Native connector views still follow this decision. [D81](D81-mcp-apps-extend-ai-chat-with-provider-owned-interactions.md) admits provider-owned MCP Apps as a separate AI-chat extension surface; its development preview is not production MCP support.

**Status:** accepted, built 2026-11-05; the kinds beyond the first four are not built; a view in the menu is D40, and such a view is a page of its own (D42) · **Date:** 2026-11-05 · **Area:** ui

**Decision.** A connector never draws. A read capability may declare a **view**: how its output is to be shown, as
data in the manifest, from a closed catalogue Clew owns. Clew draws it with Astryx components, in every placement, with
or without a model.

1. **The contract** (`ViewSchema` in `packages/contracts`, `view` on a capability in `packages/connectors/src/protocol.ts`,
   `$defs.View` in the published schema). Four kinds: `table` and `list` over an array of records (`rows`, default
   `"rows"`), `detail` over one record, `text` over one Markdown string. A field is `{ key, label, format }` with a
   Swedish label and a format from a fixed list (`text`, `phone`, `email`, `link`, `date`, `instant`, `number`,
   `status` with a tone per value). There is no layout, no styling, no component tree and no markup in the contract;
   `additionalProperties: false` keeps it so. The field is optional, so the protocol stays version 1.
2. **Input is the capability's own.** A `table` or `list` may bind a search field (`input.query`) and one choice
   (`input.filter`) to properties of the capability's input schema. Clew draws the controls, a change reads the
   capability again, and the address (`/vy/:capability?input=…`) carries the input, so a view is addressable and the
   back button undoes a search. This is how a read that needs input is reached without a model.
3. **A row opens a read of the same connector** (`open: { capability, title, params }`), as a card's actions are one
   system's (D35). A row with a `ref` of a connector that is a search source can be added to the conversation (D12).
   A view never executes: execute stays on a card with its receipt and audit row.
4. **The rules are enforced where a connector enters** (`viewProblem` in `packages/connectors/src/views.ts`): the
   manifest loader refuses a remote connector, `Registry.register` a bundled one, and `connector-check` exercises the
   view against a real answer. A view belongs to a read; its title is one of its fields; its controls bind to declared
   inputs; `open` names a read of the same connector whose input it can fill; where the output schema says what a row
   holds, every field is in it.
5. **One renderer** (`apps/web/src/components/view.tsx`): Astryx `Table` (a `List` below 900 px), `List`,
   `MetadataList`, `Markdown`, `Link` for `tel:`, `mailto:` and http(s) only, `Badge` for a status, `TextInput` and
   `SegmentedControl` for the controls, `EmptyState` when there is nothing, `useAnnounce` for a changing count. The
   server hands the declaration to the browser beside the output (`GET /api/cap/:name` answers `{ output, view }`,
   a card's read action likewise), so the browser never guesses a declared view. A capability without one is drawn by
   the generic panel rules, as before.
6. **Placements.** The side panel (a table gets a wider panel), and the compact embed under the latest answer in a
   conversation (five rows, no controls, "Visa …" opens the whole view). A hit in the composite search carries the view
   its source declares for a row, so a person found by name opens their contact card in the panel.
7. **Out of band from the assistant.** The view is attached to the capability, not to the model's text. The model's
   only choice is which capability and which input; the rows are read again as the person and drawn from the source.
   A view may say `modelReads: 'summary'`: the tool still runs, but the model is handed that the result is shown and how
   many rows it has, never the content (`viewSummary`). The router does the same without a model: the sentence counts
   rows and the view is the answer (`viewAnswer`), and what was typed beyond the capability's name becomes the view's
   question (`viewInput`). A person found by the search is counted in the sentence and left out of the stored
   citations. So names and numbers reach the person through the view, and neither the model nor the stored
   conversation.
8. **The worked example** is `connectors/telefonbok`: a phone book as a pass-through connector with reads only, a
   search source for people, a table with a search field and a unit filter, a team list, and a contact card.

**Not built, recorded as next steps.** The kinds the start-page prototype needs beyond these four: `figures` (stat
tiles; the area figure and Läget exist), `series` (a trend that can always be shown as its table; the Astryx search
surfaced no chart component, so it needs its own decision like D27), and `sections` (an ordered stack of views for a
page such as a follow-up dialogue). A row action that proposes a card. A view lifted to a full page. A view pinned to
the rail for a unit by its manager: D40 puts a view in the menu when an administrator chooses it, for the connector's
audience, and leaves the manager's and the person's own pin open. A person chip kind of its own (a chipped
row travels as a `document` chip, read back through `<id>.fetch`).

**Why.** The product owner's requirement, 2026-11-05: connectors must be able to attach views, the views must work
without a model, and they must not be iframes with a connector's own design, because the rendering is Clew's. The MCP
Apps extension (SEP-1865, specification 2026-01-26) is the obvious candidate and was read for it: its only content
type is `text/html;profile=mcp-app` and "all View content MUST be rendered in sandboxed iframes", with host theming as
optional CSS variables the app may ignore. That is the connector's design inside Clew, it cannot be held to WCAG 2.2 AA
or to Astryx by Clew, and its buttons would reach the connector's own server past Clew's scope, audit and decision
endpoint. A2UI (Apache-2.0) is the open declarative alternative, where the host renders with its own components, but
the sender composes a component tree, which is layout by the connector, and version 1.0 was a candidate at the time.
A small semantic contract owned by Clew (D1) gives the connector what it needs to say (what the fields are) and
nothing of what it must not decide (how they look). One renderer also means one accessibility suite covers every
connector's views (`tests/a11y/views.spec.ts`). What is kept from MCP Apps is the idea that a tool result has a part
for the model and a part for the person: `modelReads: 'summary'` is that split. Review:
`docs/reviews/2026-11-05-phone-book-and-declared-views.md`.

**Replaces.** The "app" half of D9: a connector no longer renders its own panel content through the MCP Apps
extension. A system whose screen the catalogue cannot express is a link out. A vendor's MCP server that ships an app
is wrapped as before (D4): Clew reads its structured result and ignores its HTML. Clew offering its own views as MCP
Apps to another host, when Clew is an MCP server (capability-surfaces, 3a), is not ruled out: that is Clew's design in
their frame. D9's panel, its views and what opens them stand.
