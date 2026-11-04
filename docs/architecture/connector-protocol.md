# The Clew connector protocol

How a connector that is not part of this repository plugs into a running Clew. Implements D21. The shapes are
`packages/connectors/src/protocol.ts`; the generated JSON Schema for authors in other languages is
`docs/protocol/connector-protocol.schema.json` (`bun run protocol:schema` regenerates it and a unit test keeps
it current). The step-by-step guide is `docs/guides/creating-an-external-connector.md`; the reference connector
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
             CLEW_CONNECTORS=hello=http://hello:4010 · CLEW_CONNECTOR_SECRET_HELLO=…
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
secret is per connector (`CLEW_CONNECTOR_SECRET_<ID>` on Clew's side, whatever name the connector uses on its),
16 characters or more, and is the only credential between the two. The person's own IdP token is not
forwarded; when token exchange is in place (D5) a `user-delegated` connector gets an audience-bound token in
the same header and nothing else changes.

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

## Configuration and deployment

```
CLEW_CONNECTORS=hello=http://hello:4010,errands=https://errands.example.se
CLEW_CONNECTOR_SECRET_HELLO=…
CLEW_CONNECTOR_SECRET_ERRANDS=…
```

Clew reads this at start-up, fetches every manifest (20 attempts, 3 s apart, so containers may start in
any order), registers each connector and logs one line per connector. A manifest that is invalid is logged once
and skipped. The stack is then Clew's image, Postgres, Temporal and one container per connector, wired by
compose; `connectors/hello/compose.yaml` shows the shape. Removing a connector is removing its line.

What Clew stores about a remote connector: nothing but what it stores for any connector, the threads it pushed,
their receipts and the audit rows. The connector's own state is the connector's.

## Versioning

`protocol` is an integer. A change that a connector built against version 1 would not survive is version 2,
and Clew will accept both for at least one release and say which in the manifest error. Adding an optional
field is not a version change.

## What stays in Clew

The things a connector cannot do, by design: draw a card (connectors contribute data and actions, Clew draws),
execute in another connector, be a tool with `execute`, see a token, see other people's threads, or be loaded
as code into Clew's process.
