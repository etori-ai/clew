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
  "areas": [{ "id": "hello", "title": "Hello-anslutningen", "roles": ["manager", "employee"], "standing": ["hello.greeting"], "schedules": [], "figure": true }],
  "capabilities": [
    { "name": "hello.greeting", "kind": "read", "title": "Säg hej", "description": "En hälsning …", "input": { "type": "object", "properties": {}, "additionalProperties": false }, "output": { "type": "object" }, "model": true, "scope": {} },
    { "name": "hello.markDone", "kind": "execute", "title": "Markera klar", "description": "…", "input": { "…": "…" }, "output": { "type": "object" }, "model": false, "scope": { "roles": ["manager"] } }
  ],
  "scan": true
}
```

Rules the loader enforces, the same as the registry's for bundled connectors: `id` equals the configured id;
every capability name is `<id>.<verb>`; an `execute` is never `model: true` (D8); every standing capability
exists; `kind` is `passthrough` or `derived` (core connectors live in Clew, D3). `scope` is declarative so Clew
can evaluate it when listing tools and areas without a round trip: no `roles` means every signed-in
person. An `execute` returns an `ExecuteResult` (`headline`, one `ReceiptRow` per ref with `outcome`
`done`, `unknown`, `failed` or `skipped`, optional `undoCapability` and `undoMinutes`); green in the UI
comes only from a read-back, so a lost answer is `unknown`.

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
answer. That is all: Clew's composite search `startsidan.search` asks every such source in the person's scope at the
same time, under a budget (3 s per source inside 4 s in all), merges the rows, marks each stale from `reviewedAt`
(or `updatedAt`) and the review interval (a year when none is given), and names the sources that did not answer.
The model sees the composite only; the person sees the rows as citations and in the sources view and can add one
to the conversation, which calls `<id>.fetch`. A source with no search of its own brings its own index inside its
container. Clew stores refs, never the text.

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

The things a connector cannot do, by design: draw a card (connectors contribute data and actions, Clew draws),
execute in another connector, be a tool with `execute`, see a token, see other people's threads, or be loaded
as code into Clew's process.
