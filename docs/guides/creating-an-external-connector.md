# Creating an external connector

For a team that wants to connect a system to Clew without changing Clew: a municipality's own case
system, a vendor's product, a department's tool. Also the way the Clew team builds its own integrations
(D21), so this guide is the default; `creating-an-integration.md` is for the in-process shape that only
Clew's core uses. The reference connector is `connectors/hello` (one file, no dependencies); the protocol is in
`docs/architecture/connector-protocol.md` and `docs/protocol/connector-protocol.schema.json`.

You need: a place to run one more container next to Clew, a shared secret, and about an afternoon.

## 1. Decide what the connector is for

Answer the same questions as for any integration (`creating-an-integration.md`, section 1): who owns the
records (almost always the system: a `passthrough` connector), what a person needs from it today that makes
them act (each answer is a capability), who may see and do what (the scope rule, then narrowing in code),
how the system recognises the user (its own accounts, an integration account, or tokens later). Write the
answers at the top of your connector's main file.

Then write the manifest first, before any code, and read it as a list of buttons and questions. If it
reads like your system's API ("GET /v2/cases?page="), it is wrong; if it reads like what a person does
("Ärenden som väntar på mig", "Avsluta ärende"), it is right. Refs are strings prefixed with your connector id
(`errands:case:2026-1187`) and must be stable across days.

## 2. Build the service

Any language, any framework. Four routes:

```
GET  /clew/manifest                → the manifest (static JSON)
POST /clew/capabilities/{name}     { actor, input } → { output } | { error }
POST /clew/scan                    { actor } → { drafts }          (if manifest.scan)
POST /clew/figure                  { actor, area } → { figure }    (if any area has figure: true)
```

On every `POST`:

1. Verify the bearer: HS256 JWT, your shared secret, `iss` = `clew`, `aud` = your connector id, not expired.
   Reject with 401 and `{ error: { code: 'denied', message: 'Ogiltigt behörighetsbevis.' } }`. Take the
   actor from the `actor` claim. `connectors/hello/connector.mjs` has a 15-line verifier with no library.
2. Check the capability's scope yourself, then narrow in the body: a manager sees their unit, an employee
   their own records. Never widen because Clew asked; Clew already filtered, you filter again.
3. Talk to your system as the person or as the integration account, map its answer to your output schema,
   and answer `{ output }`.
4. On a failure, answer `{ error: { code, message } }` with a Swedish `message` the person can read. If
   your system did not answer at all, `unavailable` and HTTP 503; Clew shows "<source> svarar inte just nu."

For an `execute`, return an `ExecuteResult`: a Swedish `headline`, one row per ref with `outcome` `done`,
`unknown`, `failed` or `skipped` and a `detail` that is your system's answer read back, and
`undoCapability` + `undoMinutes` when you have a compensating capability. Only answer `done` when the
system confirmed; a timeout is `unknown`.

For `scan`, return the drafts you want pushed for this person now: deterministic, no model, the same
`topic` for the same occurrence every night (Clew keeps one open card per person and topic). Each draft
names an `area` from your manifest, a `reason` (shown under "Varför ser jag detta?"), items with refs, and
actions: at most one primary (`execute` or `propose`), up to two secondary `read`s with `target: 'panel'`
or `target: 'link'`. Clew adds its standard actions itself.

Need another connector's data (the person's calendar, the directory)? Post the assertion you received to
`{CLEW_URL}/api/connectors/call` with `{ name: 'calendar.today', input: {} }` inside the same request. Reads
and proposals only; scope is the person's.

Store nothing but what your system already holds. No cache of rows, no log line with a row in it.

## 3. Check it before wiring it in

```sh
bun scripts/connector-check.ts http://127.0.0.1:4010 --secret <your secret>
```

The checker does what Clew's loader does and then exercises the connector as a manager and as an employee:
manifest valid, every read callable with its declared scope, out-of-scope roles refused, a call signed with
another secret refused by your service (not only by Clew), scan idempotent and naming known areas, figures
present. It needs no database and no Clew. A capability that calls back into Clew is reported as a warning
when no Clew is running. (The checker ships in this repository today and will ship as a small image with
Clew's image.)

## 4. Wire it into a Clew stack

Two environment variables on Clew's container, one more container in the compose file:

```yaml
services:
  errands:
    image: your-registry/clew-errands:1.0.0
    environment:
      CLEW_CONNECTOR_SECRET: ${ERRANDS_SECRET}
      CLEW_URL: http://clew:3000
  clew:
    environment:
      CLEW_CONNECTORS: errands=http://errands:4010
      CLEW_CONNECTOR_SECRET_ERRANDS: ${ERRANDS_SECRET}
      HOST: 0.0.0.0
```

Restart Clew. The log says `Remote connector "errands" (…) registered …`; `GET /api/connectors` lists it;
the sidebar gets your areas; a manager gets your cards after the first visit; the composer offers your
`model: true` reads. Nothing in Clew's image changed.

In the devcontainer, run your connector inside the app container (`node your-connector.mjs` on a port) and set
`CLEW_CONNECTORS=<id>=http://127.0.0.1:<port>` plus the secret in `apps/server/.env.local`; the BFF listens on
loopback there.

## 5. Ship it

- One image, pinned base, no secrets baked in, `PORT`, your secret variable and `CLEW_URL` documented.
- Semantic versions. A manifest change that removes a capability or changes an input schema is a major
  version, because cards already pushed carry the old action.
- A fixture mode (an environment flag) that answers from canned data, so Clew's UI can be demonstrated
  without your system (D8), and so the checker can run in your CI.
- Licences: whatever you ship under is yours; Clew asks nothing. If you contribute the connector to this
  repository under `connectors/<name>/`, it must be OSI-licensed and depend on nothing else in the repository
  (`bun run deps` checks that).

## What a review checks

The same list as `creating-an-integration.md`, "What a review checks", plus: the assertion is verified on
every `POST`, the scope is re-checked on the connector side, `CLEW_URL` is used only with the assertion from
the current request, and `unavailable` is answered instead of a success when the system did not answer.
