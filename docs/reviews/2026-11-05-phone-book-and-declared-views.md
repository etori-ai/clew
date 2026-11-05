# Phone book as a test case, and how a connector attaches a view

2026-11-05, session 33. The product owner brought a test case (the organisation's own phone book, reachable through an
API, to become a connector: search the whole organisation or one's own team, and a team contact list on every team
member's page) and then three questions: how it works without a model, whether MCP Apps or native views could show
tables and text, and whether views could be fixed, out of band from the assistant, in both modes, without iframes
carrying a connector's own design. A prototype of the start page (start.sundsvall.dev, a list of use cases to cover,
explicitly not a design to follow) was read for what views it needs. The outcome is D38 and `connectors/telefonbok`.

## What the code said before this session

- **The phone book fits the protocol as it is**: a pass-through connector with reads, a search source with
  `kinds: ["person"]`, an area with standing actions. Nothing needed inventing to expose it.
- **The search contract is document-shaped.** `SearchHit` has no phone, e-mail, title or unit; the panel called every
  hit a source in "rutiner och dokument", badged a hit without a review date as "Granskningsdatum saknas", and chipped
  it as a document.
- **No scope in the composite search.** It sends `{ query }` only, so "in my team" cannot be asked of it.
- **The names rule against the use case.** The prompt forbids naming employees the person did not name; the router's
  sentence listed the first three row labels; citations were stored with their labels. A phone book answered in text
  would put names and numbers in the stored conversation.
- **The view was guessed.** The panel inferred a presentation from the output's shape; labels came from a fixed list in
  the web app; a remote connector could supply none. A read that needs input was reachable only through the model or
  the search fallback, because the router ran a matched read with an empty input.
- **Identity mapping is thin.** A connector gets Clew's person id, name, one unit and a role: no IdP subject, no e-mail.
- **No manager-level setting and no persistent surface.** Only the administrator grant for connectors exists; the side
  panel is an overlay with one thing in it; the vision rules out operator-composed layout.

## MCP Apps, read for the purpose

The MCP Apps extension (SEP-1865, specification 2026-01-26, `modelcontextprotocol/ext-apps`):

- UI is a `ui://` resource linked from a tool by `_meta.ui.resourceUri`. The only content type is
  `text/html;profile=mcp-app`; "other content types are reserved for future extensions".
- "All View content MUST be rendered in sandboxed iframes"; a web host must add a sandbox proxy on another origin.
- Host theming is optional: CSS variables and fonts the app may apply. Spacing is excluded on purpose.
- A tool result has `content` (text, for the model and for hosts without UI) and `structuredContent` (data for the UI,
  not added to the model's context). A tool may be visible to the model, to the app, or both.
- Nothing requires a model: a host can call the tool and render the resource itself.

So MCP Apps can be used in both modes, but it is exactly the thing ruled out: the connector's markup in a frame. Clew
could not hold it to Astryx or to WCAG 2.2 AA, and its buttons would call the connector's own server past Clew's
scope, audit and decision endpoint. What is worth keeping is the split between what the model reads and what the
person sees. D9 had accepted connector-rendered MCP App views; that half is replaced.

## The alternatives for a declared view

| Option | What the connector sends | Verdict |
|---|---|---|
| MCP Apps | HTML for a sandboxed iframe | Ruled out by the requirement |
| A2UI (Apache-2.0; 0.9.1 current, 1.0 a candidate) | A component tree the host renders with its own catalogue | Open and close in spirit, but the sender composes layout, and it is aimed at model-generated UI. Watch it; a mapping from D38's kinds is possible later |
| Output schema annotations only (`title`, `format` in JSON Schema) | Nothing new | Cannot say table or list, bind input controls, or name what a row opens |
| A small semantic contract owned by Clew | A kind from a closed catalogue and fields with a label and a format | Chosen (D38). The connector says what the fields are; Clew decides everything about how they look |

## What the prototype needs, against the catalogue

| Prototype feature | Covered by | State after this session |
|---|---|---|
| Staff list with search, filter tabs and status; case table for my staff | `table` with a search field, a choice and `status` | Built (one choice; filter tabs with counts are not) |
| Development plans, expiring authorisations | `list` with fields and a status badge | Built, without avatars |
| One record (a person, a case) | `detail` | Built |
| Prose with headings | `text` (Markdown, drawn by Astryx) | Built |
| Figure tiles | A `figures` kind; area figures and Läget exist | Not built |
| Sick-leave trend with "Visa som tabell" | A `series` kind; no Astryx chart component was found | Not built, needs a decision |
| Follow-up dialogue page (figures, a chart, activities, notes) | `sections`, and a Clew-owned record for the activities and notes | Not built, needs a decision |
| "Att agera på", leave requests to approve | Cards in the stream, with their receipts | Exists |
| Today | The calendar family | Exists |
| New development case in four steps with upload and a drafted document | Not a view: a Clew-owned flow or an Eneo app | Outside |
| News | A `list` with links out at most; the vision says not a news site | Outside |
| Min AI | Eneo | Outside |
| "Anpassa startsidan" | A person pinning a view, which is not the operator-composed layout the vision rules out | Not built, needs a decision |

## What was built

D38 in full for four kinds, and the phone book on it. The gaps above that it closes: the view is declared, labels come
from the connector, a read with input is reachable without a model (the view's own search field, and the router
handing over what was typed), a person hit opens a contact card and has no review badge, and names and numbers stay
out of the model's context and the stored conversation (`modelReads: "summary"`, a counting sentence, person hits left
out of stored citations).

## What is still open

1. **Which system is the directory.** Whether the phone book is Metakatalogen or a second source of people. With two,
   the composite search does not merge the same person from both.
2. **The real API.** Its shape, and whether it accepts the IdP's tokens. With delegation (D26) the connector could act
   as the person and know who they are in the phone book; today it knows only Clew's unit id, mapped by configuration.
3. **A team list curated by a manager and pinned for the team.** The derived team list needs no one to add it. A
   curated one (a duty phone, the caretaker) is a record with no system of record, so a core domain by decision, and
   pinning it for others is a manager-level setting and a persistent surface Clew does not have.
4. **A person in several units.** The actor has one.
5. **A scope in the composite search**, so "i mitt team" can be asked of every source.
6. **A screen-reader pass** of the new views. The suite passes; that does not prove conformance.
7. **The canvas has no artboard for a declared view.** The views were built from Astryx components and templates and
   compared with their own screenshots, not with a drawing.

Sources: [MCP Apps specification 2026-01-26](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx),
[A2UI and the agent UI ecosystem](https://a2ui.org/introduction/agent-ui-ecosystem/).
