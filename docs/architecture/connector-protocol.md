# The Clew connector protocol

How a connector that is not part of this repository plugs into a running Clew. Implements D21. The shapes are
`packages/connectors/src/protocol.ts`; the generated JSON Schema for authors in other languages is
`docs/protocol/connector-protocol.schema.json` (`bun run protocol:schema` regenerates it and a unit test keeps
it current). The step-by-step guide is `docs/guides/creating-a-connector.md`; the reference connector
is `connectors/hello`.

## What a connector is

A connector is an HTTP service that owns one Clew contract: capabilities (`read`, `propose`, `execute`) with
Swedish titles, JSON Schema inputs and outputs, a scope rule and a tool flag; areas for the sidebar; a
scan that says what it wants to push for a person; a figure per area. That is exactly what a bundled
connector declares in TypeScript (`Connector` in `packages/connectors`), as data. The registry turns the manifest
into a `Connector` whose `run`, `scan` and `figure` are HTTP calls (`packages/connectors/src/remote.ts`), so
REST, model tools, cards and areas derive from a remote connector exactly as from a bundled one. The
capability-surfaces page applies unchanged.

```
             connector row: id hello · url http://hello:4010 · sealed secret · state enabled (D23)
   ┌────────────────┐  GET  /clew/manifest           ┌──────────────────────┐
   │  Clew (BFF)    │ ─────────────────────────────► │  connector      │
   │  registry      │  POST /clew/capabilities/{name}│  any language        │
   │  scope, audit, │  POST /clew/scan               │  verifies assertion  │
   │  validation    │  POST /clew/figure             │  narrows to actor    │
   │                │ ◄───────────────────────────── │  talks to its system │
   │                │  POST /api/connectors/call         │                      │
   └────────────────┘  (same assertion back)         └──────────────────────┘
```

## Routes the connector serves

All JSON. The base URL is what Clew is configured with; paths are fixed.

| Route | Body | Answer | When Clew calls it |
|---|---|---|---|
| `GET /clew/manifest` | none | `ConnectorManifest` | Once at start-up (with retries while the container comes up) |
| `POST /clew/capabilities/{name}` | `{ actor, input }` | `{ output }` or `{ error }` | A button, a card action, a tool call, a standing action, another connector |
| `POST /clew/scan` | `{ actor }` | `{ drafts: ThreadDraft[] }` | First visit of the day and the nightly scan, per person, when `manifest.scan` is true |
| `POST /clew/figure` | `{ actor, area }` | `{ figure: { label, tone } \| null }` | When the sidebar is built, for areas with `figure: true` |

Every `POST` carries `Authorization: Bearer <assertion>`. Input has already been validated by Clew against
the capability's `input` schema and the actor has passed the manifest's `scope`; the connector validates and
narrows again anyway (the secret could leak, the caller could be a test).

Errors are `{ error: { code, message } }` with a Swedish `message` that is shown to the person and a
`code` of `invalid`, `denied`, `not-found`, `unavailable` or `unknown`. HTTP 5xx, a timeout (10 s) or a
body that does not parse count as `unavailable`: the person sees "<source> svarar inte just nu." and the
area's figure turns into a warning. One connector being down never takes the page down (D8).

## The manifest

```json
{
  "protocol": 1,
  "id": "hello",
  "kind": "passthrough",
  "source": "Hello",
  "areas": [{ "id": "hello", "title": "Hello-anslutningen", "roles": ["manager", "employee"], "standing": ["hello.greeting"], "schedules": [], "figure": true, "icon": "document" }],
  "capabilities": [
    { "name": "hello.greeting", "kind": "read", "title": "Säg hej", "description": "En hälsning …", "input": { "type": "object", "properties": {}, "additionalProperties": false }, "output": { "type": "object" }, "model": true, "scope": {} },
    { "name": "hello.markDone", "kind": "execute", "title": "Markera klar", "description": "…", "input": { "…": "…" }, "output": { "type": "object" }, "model": false, "scope": { "roles": ["manager"] } }
  ],
  "scan": true
}
```

Rules the loader enforces, the same as the registry's for bundled connectors: `id` equals the configured id;
every capability name is `<id>.<verb>`; an `execute` is never `model: true` (D8); every standing capability
exists; an area's optional `icon` is a name from Clew's list (D41, the list under "A view as a tool in the menu"); `menu` (D40, below) sits only on a capability whose view can be a tool; `kind` is `passthrough` or `derived` (core connectors live in Clew, D3). `scope` is declarative so Clew
can evaluate it when listing tools and areas without a round trip: no `roles` means every signed-in
person. An `execute` returns an `ExecuteResult` (`headline`, one `ReceiptRow` per ref with `outcome`
`done`, `unknown`, `failed` or `skipped`, optional `undoCapability` and `undoMinutes`); green in the UI
comes only from a read-back, so a lost answer is `unknown`.

A card is one system's (D35). Every action in a scan draft names one of the connector's own capabilities, and its `kind`
is that capability's kind; Clew refuses a draft that breaks this (the connector's other drafts still become cards, the
refusal is logged, and `connector-check` fails on it), and a card's button never reaches another connector. An
`undoCapability` names an `execute` of the same connector; any other is dropped and the receipt has no Ångra.

## Identity: the assertion

Clew signs a JWT per call with the connector's shared secret (HS256):

| Claim | Value |
|---|---|
| `iss` | `clew` |
| `aud` | the connector id |
| `sub` | the person id |
| `actor` | `{ id, name, unitId, unitLabel, role }`, the same object as in the body |
| `iat`, `exp`, `jti` | issued now, valid two minutes, unique |

The connector verifies signature, issuer, audience and expiry and takes the actor from the claim. The
secret is per connector (sealed in Clew's `connector` row, whatever name the connector uses on its side),
16 characters or more, and is the only credential between the two. The person's own IdP token is never
forwarded. A connector that must act as the person against its system declares `delegation` (section "Acting as
the person") and gets a token bound to its own audience in a second header; the assertion stays as it is.

## Calling back: other connectors' capabilities

A connector that needs another connector (the calendar, the directory) posts the assertion it just received to
Clew:

```
POST {CLEW_URL}/api/connectors/call
Authorization: Bearer <the assertion from the current request>
{ "name": "calendar.today", "input": {} }
→ { "output": … }  or  { "error": { "code", "message" } }
```

Clew verifies the assertion against that connector's secret, rebuilds the person's identity from their grant
(so a connector can never widen what the person could reach themselves), re-applies the target capability's
scope, validates the input and runs it. `read` and `propose` only; `execute` is refused with `denied`, as
it is for bundled connectors through `clew.call`. The assertion is valid for two minutes, so the callback
happens inside the request that triggered it. `CLEW_URL` is the BFF as seen from the connector's network; in
a container stack Clew listens with `HOST=0.0.0.0`.

## Registration and deployment

A connector is registered in Clew's database by an administrator (D23), never through Clew's environment:
one `connector` row with the id, the address, the secret sealed with the master key, a state (`draft`,
`enabled`, `disabled`), who may see it, and the last valid manifest. The admin page
(`connector-administration.md`) writes that row; until it exists, `scripts/connector-add.ts` writes the same
row from the command line. At boot Clew registers every enabled row: a row with a stored manifest is served
at once, then the manifest is refetched (20 attempts, 3 s apart, so containers may start in any order) and
replaced if it changed, and the health is recorded (`ok`, `unreachable`, `manifest-invalid`). A connector
whose service is down keeps its areas with the warning figure instead of vanishing (D8). The stack is Clew's
image, Postgres, Temporal and one container per connector; `connectors/hello/compose.yaml` shows the shape,
and nothing on Clew's container names a connector. Removing a connector is removing its row.

What Clew stores about a remote connector: nothing but what it stores for any connector, the threads it pushed,
their receipts and the audit rows. The connector's own state is the connector's.

## Versioning

`protocol` is an integer. A change that a connector built against version 1 would not survive is version 2,
and Clew will accept both for at least one release and say which in the manifest error. Adding an optional
field is not a version change.

## Being a search source (D26)

A connector whose system holds documents, people, cases or rooms declares a `read` capability named `<id>.search`
with input `{ query }` and output `{ rows: SearchHit[] }` (`SearchHit` and `SearchOutput` are in the schema's
`$defs`: `ref`, `kind`, `label`, `snippet`, `link`, `source`, `section`, `owner`, `updatedAt`, `reviewedAt`,
`reviewIntervalDays`, `score`), and a `<id>.fetch` read that takes one of its refs back and returns one `SearchHit`.
The capability may carry `kinds` (`document`, `person`, `case`, `room`) so Clew skips it for a question it cannot
answer. That is all: Clew's composite search `clew.search` asks every such source in the person's scope at the
same time, under a budget (3 s per source inside 4 s in all), merges the rows, marks each stale from `reviewedAt`
(or `updatedAt`) and the review interval (a year when none is given), and names the sources that did not answer.
The model sees the composite only; the person sees the rows as citations and in the sources view and can add one
to the conversation, which calls `<id>.fetch`. A source with no search of its own brings its own index inside its
container. Clew stores refs, never the text.

## Declaring a view (D38)

A connector never draws: no markup, no styles, no frame of its own. A `read` capability may instead say how its output
is to be shown, and Clew draws it with its own components, the same in the side panel, under an answer in a
conversation and on a tool's own page (D42), with a model and without one. `view` is optional on a capability; without it Clew falls back to its
generic rules (rows become a list, anything else label and value pairs).

```json
{ "name": "telefonbok.directory", "kind": "read", "title": "Sök i telefonboken", "model": true, "scope": {},
  "input": { "type": "object", "properties": { "query": { "type": "string", "maxLength": 80 }, "scope": { "type": "string", "enum": ["all", "unit"] } }, "additionalProperties": false },
  "output": { "type": "object", "properties": { "rows": { "type": "array", "items": { "type": "object", "properties": { "ref": {}, "name": {}, "title": {}, "phone": {}, "email": {} } } } } },
  "view": {
    "kind": "table", "title": "name", "ref": "ref", "modelReads": "summary", "empty": "Inga träffar i telefonboken.",
    "fields": [{ "key": "name", "label": "Namn" }, { "key": "title", "label": "Titel" }, { "key": "phone", "label": "Telefon", "format": "phone" }, { "key": "email", "label": "E-post", "format": "email" }],
    "input": { "query": { "key": "query", "label": "Sök i telefonboken", "placeholder": "Namn, titel eller enhet" },
               "filter": { "key": "scope", "label": "Sök i", "options": [{ "value": "all", "label": "Hela organisationen" }, { "value": "unit", "label": "Min enhet" }] } },
    "open": { "capability": "telefonbok.person", "title": "Kontaktkort", "params": { "ref": "ref" } }
  } }
```

| Part | Meaning |
|---|---|
| `kind` | `table` or `list` over an array of records, `detail` over one record, `text` over one Markdown string (`body` names the property). A table is uniform records compared across columns; a list is things to pick from. Clew draws a table as a list on a narrow surface |
| `rows` | The property holding the array, default `"rows"` |
| `fields` | What is shown, in order: `key` (a property of a row or of the record), a Swedish `label`, and a `format`: `text` (default), `phone` (a link that calls), `email` (a link that writes), `link` (an http(s) link out, labelled by the field's label), `date`, `instant`, `number`, `status` (a badge; `tones` maps a value to `ok`, `warn`, `alert` or `none`). An empty value is a dash in a table and left out elsewhere |
| `title` | The field that names a row (one of `fields`), or the record's heading in a `detail` |
| `ref` | The field holding your ref for the row. With it, and when the connector is a search source with `<id>.fetch`, a row can be added to the conversation |
| `input` | A search field (`query`) and one choice of two to six options (`filter`), each bound to a property of the capability's own `input` schema. A change calls the capability again with the new input. A capability that should open without a question must accept an empty input |
| `open` | The read a row opens as a view: a `read` of the same connector, its `title` in Swedish, and `params` mapping that read's input properties to the row's |
| `empty` | Swedish. What is said when there are no rows |
| `modelReads` | `output` (default) or `summary`. With `summary` the capability is still run when the model calls it as a tool, so the person's view has its rows, but the model is handed only that the result is shown and how many rows it has. Use it where the content should reach the person and not a model or the stored conversation: names, numbers, anything about an identifiable person |

The loader refuses a manifest whose view breaks a rule, the same way it refuses an `execute` that is a tool: a view on
a capability that is not a `read`; a `title` that is not a field; a control bound to an input the capability does not
declare; an `open` that names another connector's capability, a capability that is not a `read`, or input the row
cannot fill; a field the output schema does not declare, when the schema says what a row holds. Declare the output
schema's properties and the check is exact. `connector-check` then calls the capability and reports whether the answer
holds the rows where the view says and whether any column is empty in every row.

A search source (D26) may declare a view on `<id>.search` too. Its `open` is then what a hit of that source opens in
Clew's panel, beside the link out: a person's contact card, a case. The hit itself should say who or what and where,
not the content the card holds.

What a view cannot do, by design: carry markup or style, compose layout, execute, reach another connector, or be an
iframe. A screen the catalogue cannot express is a link out to the system. `connectors/telefonbok` is the reference.

## A view as a tool in the menu (D40)

Clew's menu has a section Verktyg: the calendar, and the views an administrator has chosen as tools. A view can be a
tool when its capability is a `read`, declares a `view`, and its input lists nothing as `required`: the row opens it
with one click and no question. A connector does nothing to make a view eligible; every such view is on the
administrator's list. What a connector may add is what the row is called, with `menu` on the capability:

```json
{ "name": "telefonbok.directory", "kind": "read", "title": "Sök i telefonboken", "view": { "…": "…" },
  "menu": { "label": "Telefonbok", "icon": "phone" } }
```

| Field | Meaning |
|---|---|
| `label` | Swedish, at most 24 characters. The row in the menu, so the name of the tool, not of the action: "Telefonbok", not "Sök i telefonboken" |
| `icon` | One of `phone`, `people`, `book`, `document`, `chart`, `search`, `clock`, `link`, `calendar`, `bell`. Clew draws it; a connector sends a name. An area's optional `icon` takes a name from the same list (D41): it is drawn on the area's button under the box on the start page, where the area's standing actions open as cards |

Without `menu` the row takes the capability's `title` and the `document` icon. The loader refuses `menu` on a
capability that cannot be a tool. Nothing is in the menu until an administrator chooses it (Administration › Anslutna
system › the connector › Områden, "Verktyg i menyn", one switch per view), and then for everyone in the connector's
audience who may call the read. A connector cannot place, order or style a row: Clew puts the tools in alphabetical
order after the calendar, shows four and keeps the rest under "Fler verktyg". `connector-check` lists the views that
can be tools.

## Acting as the person (D26)

A connector that must call its system as the person, not as a service, declares in its manifest:

```json
"delegation": { "audience": "eneo" }
```

On every capability call Clew then trades the person's session for an IdP token bound to that audience (RFC 8693
token exchange at the IdP, the audience being a client the administrator has set up for the system) and sends it as
`X-Clew-Delegated-Token` beside the assertion. The connector forwards it as the bearer to its system and nothing
else: no header from the incoming request, no `Origin`, never stored, never retried after a 401. The token lives
about a minute. The header is absent on `scan`, `figure`, a callback and a session that holds no IdP token (a dev
session); the connector then answers `{ error: { code: "denied", … } }`, which the composite search reports as that
source not answering. `bun scripts/connector-check.ts` has no session, so for a delegating connector a `denied`
answer is the expected one. `connectors/eneo` is the reference.

## What stays in Clew

The things a connector cannot do, by design: draw a card or a view (connectors contribute data, actions and a declared
view, D38; Clew draws),
execute in another connector, be a tool with `execute`, see a token, see other people's threads, or be loaded
as code into Clew's process.
