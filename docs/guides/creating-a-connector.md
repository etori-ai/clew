# Creating a connector

How a system gets connected to Clew. A connector is its own service behind the Clew connector protocol
(D21, D22), registered in a running Clew by an administrator (D23). Nothing in Clew's code or image changes
for it, whoever writes it: the system's owner, a vendor, another municipality, or the Clew team. The
connectors the Clew team writes live under `connectors/<name>/` in this repository and depend on nothing else
in it; `connectors/hello` is the reference (one file, no dependencies). The protocol is in
`docs/architecture/connector-protocol.md` and `docs/protocol/connector-protocol.schema.json`; the
administration side is `docs/architecture/connector-administration.md`.

Two ways exist, and the order between them is fixed (D10):

1. **The system fulfils Clew's contract itself.** Its owner serves the manifest and the four routes from the
   system, or from a thin service next to it. Nothing is written anywhere else.
2. **Someone writes a connector for it.** When the system cannot or will not do that, a connector translates
   the system's protocol (REST, SOAP, CalDAV, RPA) to Clew's contract. Whoever is closest to the system writes
   it; Clew's own process is never the place for it. The only in-process code is Clew's core (people, the
   stream, and the calendar until it is lifted), which is covered by `docs/architecture/backend-structure.md`.

You need: a place to run one more container next to Clew, a shared secret, and about an afternoon.

## 1. Decide what the connector is for

Answer these in a short note; it becomes the top of your connector's main file and the row in the landscape
table in `docs/architecture/integration-paths.md`.

| Question | Why it matters | Where the answer goes |
|---|---|---|
| Who owns the records? | Almost always the system: a `passthrough` connector (Clew stores refs and audit rows). A scheduled snapshot over other connectors is `derived`. If nobody else owns the domain, it is Clew core and needs a decision (D3) | `kind` in the manifest |
| What does a person need from it, today, that makes them act? | Each answer is a capability: a `read` to look, a `propose` to draft, an `execute` to do. If nothing makes a person act, the system may only need link-out and search | The capability list |
| Who may see and do what, and how is a call narrowed to that person's unit or own records? | The manifest's `scope` says who may call at all; the connector narrows further on every call | `scope` and the capability body |
| How does the system recognise the user? Its own accounts, one integration account, or tokens from the shared IdP? | Picks the auth mode: `bound-credential`, `service` (then you narrow every call yourself) or `user-delegated` (token exchange, D5, later) | The connector's credential handling |
| Does the system have an API at all? | No API means read through whatever exists plus link-out; writes are not offered in v1 | Capability kinds |
| What is the system's licence and that of any client library you use? | A connector contributed to this repository must be OSI-licensed | Your README; `HANDOVER.md` section 3 when contributed |
| Does a dept44 service, another municipality or a vendor already expose this domain? | May already fulfil the contract | The landscape table |

Then write the manifest first, before any code, and read it as a list of buttons and questions:

- Domain granularity, not endpoint granularity. "Ärenden som väntar på mig", "Avsluta ärende"; never
  "GET /v2/cases?page=".
- Every row has a `ref`: a string Clew can store and hand back, prefixed with your connector id
  (`errands:case:2026-1187`), stable across days.
- Outputs are rows the UI renders: no markup, no links for the browser to follow, no names of individuals
  where a card would show them (names belong in a panel view or the source system).
- Say how a read is shown instead of leaving it to Clew's generic rules: a `view` on the capability (D38) names the
  kind (a table, a list, one record, a text), the fields with their Swedish labels and formats, the search field and
  choice the person gets, and what a row opens. Clew draws it; you never send markup. Where the content is about
  identifiable people, add `modelReads: "summary"` so it reaches the person and not the model. The parts are in
  `docs/architecture/connector-protocol.md`, "Declaring a view"; `connectors/telefonbok` shows all of them.
- If one of those views is a tool people reach for from anywhere (a phone book, a room list), offer it as a row in
  Clew's menu with `menu: { capability, label, icon }` in the manifest (D40). It is only an offer: an administrator
  switches the row on, and Clew decides where it sits. One row per connector, on a read that opens without input.
- Writes return an outcome per row and, when reversible, what reverses them.
- If the capability list reads well as five to ten tool descriptions, it is right.

## 2. Build the service

Any language, any framework. Four routes:

```
GET  /clew/manifest                → the manifest (static JSON)
POST /clew/capabilities/{name}     { actor, input } → { output } | { error }
POST /clew/scan                    { actor } → { drafts }          (if manifest.scan)
POST /clew/figure                  { actor, area } → { figure }    (if any area has figure: true)
```

On every `POST`:

1. Verify the bearer: HS256 JWT, your shared secret, `iss` = `clew`, `aud` = your connector id, not
   expired. Reject with 401 and `{ error: { code: 'denied', message: 'Ogiltigt behörighetsbevis.' } }`.
   Take the actor from the `actor` claim. `connectors/hello/connector.mjs` has a 15-line verifier with no
   library.
2. Check the capability's scope yourself, then narrow in the body: a manager sees their unit, an employee
   their own records. Never widen because Clew asked; Clew already filtered, you filter again.
3. Talk to your system as the person or as the integration account, map its answer to your output schema,
   and answer `{ output }`. Translate the system's errors into the protocol's: `invalid`, `denied`,
   `not-found`, `unavailable`, `unknown`. Never let a protocol exception reach Clew as a success.
4. On a failure, answer `{ error: { code, message } }` with a Swedish `message` the person can read. If
   your system did not answer at all, `unavailable` and HTTP 503; Clew shows "<source> svarar inte just nu."

For an `execute`, return an `ExecuteResult`: a Swedish `headline`, one row per ref with `outcome` `done`,
`unknown`, `failed` or `skipped` and a `detail` that is your system's answer read back, and
`undoCapability` + `undoMinutes` when you have a compensating capability. Only answer `done` when the
system confirmed; a timeout is `unknown`. Green in the UI comes only from a read-back.

For `scan`, return the drafts you want pushed for this person now: deterministic, no model, the same
`topic` for the same occurrence every night (Clew keeps one open card per person and topic). Each draft
names an `area` from your manifest, a `reason` (shown under "Varför ser jag detta?"), items with refs, and
actions: at most one primary (`execute` or `propose`), up to two secondary `read`s with `target: 'panel'`
or `target: 'link'`. Clew adds its standard actions itself. Every action names one of your own capabilities with
the `kind` your manifest gives it, and an `undoCapability` is one of your own executes: Clew refuses a draft that names
another connector's capability or calls an execute a read, and `connector-check` fails on it (D35).

Need another connector's data (the person's calendar, the directory)? Post the assertion you received to
`{CLEW_URL}/api/connectors/call` with `{ name: 'calendar.today', input: {} }` inside the same request.
Reads and proposals only; scope is the person's.

Store nothing but what your system already holds. No cache of rows, no log line with a row in it.
Dependencies: the standard library first; a client library only if its licence allows what you ship.

### Being a search source, and acting as the person

If your system holds documents, people, cases or rooms, declare a `read` named `<id>.search` with input `{ query }`
and output `{ rows: SearchHit[] }`, plus a `<id>.fetch` that takes one of your refs back; add `kinds` on the search
so Clew skips it for questions it cannot answer. Clew's composite search then asks you beside every other source,
under a budget, and your rows become citations and panel rows. If your system must be called as the person rather
than as a service, declare `delegation: { audience: "<your IdP client id>" }` in the manifest and read
`X-Clew-Delegated-Token` on every call; answer `denied` without it. Both are described in
`docs/architecture/connector-protocol.md` ("Being a search source", "Acting as the person"); `connectors/eneo` does both.

## 3. Check it before connecting it

```sh
bun scripts/connector-check.ts http://127.0.0.1:4010 --secret <your secret>
```

The checker does what Clew does when an administrator adds a connector and then exercises it as a manager
and as an employee: manifest valid, every read callable with its declared scope, out-of-scope roles refused,
a call signed with another secret refused by your service (not only by Clew), scan idempotent and naming
known areas, figures present. It needs no database and no Clew. A capability that calls back into Clew is
reported as a warning when no Clew is running. (The checker ships in this repository today and will ship as
a small image with Clew's image; the admin page's "Testa anslutning" runs the same checks.)

## 4. Connect it to a running Clew

A connector is registered in Clew's database by an administrator, not by configuration (D23). The stack is
Clew's image, Postgres, Temporal and one container per connector; nothing on Clew's container names the
connector:

```yaml
services:
  errands:
    image: your-registry/clew-errands:1.0.0
    environment:
      ERRANDS_SECRET: ${ERRANDS_SECRET}     # whatever your service calls it
      CLEW_URL: http://clew:3000
  clew:
    environment:
      HOST: 0.0.0.0                          # so connectors can reach /api/connectors/call
```

Then, in Clew, an administrator (grant capability `admin.connectors`) opens Administration › Anslutna
system › Anslut system, enters the id, the address and the secret, reads the check result, chooses who sees
it, and turns it on. No restart. The log says `Connector "errands" (…) registered …`; `GET /api/connectors`
lists it; the sidebar gets your areas; a manager gets your cards after the first visit; the composer offers
your `model: true` reads.

Until the admin page exists, the same row is written from the command line inside the app container:

```sh
docker exec -w /workspace clew-app-1 bun scripts/connector-add.ts errands http://errands:4010 --secret <secret> --enable
```

The BFF registers enabled rows at boot and watches the rows every few seconds, so nothing is restarted after an enable. In the devcontainer
the BFF listens on loopback, so a connector under development runs inside the app container
(`node your-connector.mjs` on a port) with `CLEW_URL=http://127.0.0.1:3000`; `bun run auth:setup` seeds the
hello connector as a draft with a generated secret (`HELLO_CONNECTOR_SECRET` in `.auth-test.env`).

## 5. Ship it

- One image, pinned base, no secrets baked in, `PORT`, your secret variable and `CLEW_URL` documented.
- Semantic versions. A manifest change that removes a capability or changes an input schema is a major
  version, because cards already pushed carry the old action; the admin page shows the diff on refresh.
- A fixture mode (an environment flag) that answers from canned data, so Clew's UI can be demonstrated
  without your system (D8), and so the checker can run in your CI.
- Licences: whatever you ship under is yours; Clew asks nothing. If you contribute the connector to this
  repository under `connectors/<name>/`, it must be OSI-licensed and depend on nothing else in the repository
  (`bun run deps` checks that), and its row goes in the landscape table in `integration-paths.md`.

## What a review checks

- The contract is Clew's: nothing in the manifest names the system's endpoints, ids or vocabulary.
- The assertion is verified on every `POST`; the scope is re-checked on the connector side; `run` narrows
  to the actor; nothing from a request body is trusted for identity.
- No `execute` with `model: true`. `CLEW_URL` is used only with the assertion from the current request.
- The connector stores nothing and logs no rows.
- Names of individuals appear only in panel views or link-outs, never in a card's title, summary or items.
- Every `execute` returns one outcome per ref and `unknown`, never `done`, when the system did not answer.
- `scan` is deterministic and idempotent by `topic`.
- Swedish only in titles, descriptions, headlines and error messages; English everywhere else.
