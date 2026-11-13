# Create a custom connector

A connector is your own HTTP service with a manifest and a source adapter. It can live in a separate repository and use any language. You do not install code into Clew's server or frontend, and no Clew SDK is required.

Read [What Clew is](../overview.md) and [How Clew works](../architecture/overview.md) first. This guide takes you from a runnable example to one authorized read shown in Clew. Search, scans and writes can follow later.

## 1. Choose how to develop

| Available environment | Start here |
|---|---|
| A running test installation of Clew | Open `https://<test-clew>/api/protocol`. It serves the contract that installation accepts. Obtain permission from its operator to register your test service. |
| This repository and its devcontainer | Run the signed fixture exchange below. It needs installed dependencies, but no running BFF, database, identity provider, model or source API. |
| A new checkout and no running stack | Follow [local development](../maintainers/local-development.md), then return here. |

From this repository's host terminal:

```sh
docker exec -w /workspace clew-app-1 bun run docs:smoke
```

Expected final line: `Documentation smoke passed.` The [walkthrough](../../scripts/docs-smoke.ts) validates the phone book manifest, exercises real handlers with ephemeral signed requests bound to their bodies, and verifies that a forged body is refused. Its private signing key is test-only; a deployed connector trusts Clew's public keys.

A running instance serves JSON Schema at `/api/protocol/connector-protocol.schema.json`, OpenAPI at `/api/protocol/openapi.json` and a manifest dry run at `POST /api/protocol/manifest?id=<id>`. Use that instance's contract when integrating with it. The committed [protocol reference](../reference/connector-protocol.md) explains the same boundary.

## 2. Copy a complete working example

| Need | Start from | Limit |
|---|---|---|
| Read a directory/catalogue and display it | [phonebook](../../connectors/phonebook/README.md) | Synthetic data by default; its HTTP API and organization-wide lookup policy are assumptions to replace. |
| Explore routes, callbacks, scans and figures | [hello](../../connectors/hello/README.md) | In-memory demonstration; toy writes are not a recovery guarantee. |
| Study source-side deduplication and lookup | [reference](../../connectors/reference/README.md) | Synthetic SQLite source, not a real-system pilot. |
| Retrieve documents using delegated user authority | [eneo](../../connectors/eneo/README.md) | Requires compatible source and IdP configuration; interactive reads only. |

For a first read integration, copy the **whole phonebook directory** to your own project: manifest, connector handlers, source adapter, verifier, server and Dockerfile. It has no workspace dependency. The existing [service walkthrough](example-custom-directory.md#run-the-fixture-as-a-service) gives start, check and registration commands.

Run the unmodified fixture first. You should be able to register it as a draft, enable it for a test audience and open Telefonbok or Mitt team after selecting that view as a menu tool. This proves the Clew-to-connector boundary before you add your source.

## 3. Define one useful read

Decide what the person needs to see, who may see it, how Clew person/unit ids map to the source, and which source credential supports that access. Name operations for the task, such as `directory.team`, rather than copying every vendor endpoint.

This complete minimal manifest declares one team list. It is a contract example, not a running service; your handler must implement it. The documentation smoke validates it against Clew's actual manifest rules.

<!-- minimal-connector-manifest -->
```json
{
  "protocol": 3,
  "id": "directory",
  "kind": "passthrough",
  "source": "Personalkatalogen",
  "areas": [
    {
      "id": "contacts",
      "title": "Kontakter",
      "roles": ["manager", "employee"],
      "standing": ["directory.team"],
      "schedules": []
    }
  ],
  "capabilities": [
    {
      "name": "directory.team",
      "kind": "read",
      "title": "Mitt team",
      "description": "Visar kollegor på den inloggades enhet.",
      "input": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      },
      "output": {
        "type": "object",
        "properties": {
          "rows": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "ref": { "type": "string" },
                "name": { "type": "string" }
              },
              "required": ["ref", "name"],
              "additionalProperties": false
            }
          }
        },
        "required": ["rows"],
        "additionalProperties": false
      },
      "model": false,
      "scope": {},
      "view": {
        "kind": "list",
        "title": "name",
        "ref": "ref",
        "fields": [{ "key": "name", "label": "Namn" }],
        "empty": "Inga kollegor hittades."
      }
    }
  ],
  "scan": false
}
```

`scope: {}` imposes no role restriction, but Clew's configured audience and your source's record permissions still apply. `model: false` keeps this first read out of the assistant's tools. The empty input means the unit must come from verified identity, not a browser-supplied unit id. The view makes it eligible for administrator-selected menu placement; it does not publish itself. Its kind decides where it opens ([D116](../decisions/D116-a-panel-is-a-peek-at-one-thing-a-list-is-a-page-and-every-view-has-an-address.md)): a `table` or a `list` is a page of its own at `/tools/<capability>` for everyone who may call the read, placed in the rail or not, and one thing (a `detail`, a `record`) opens beside the page it was opened from. [Where things open](where-things-open.md) says where Clew shows each thing a manifest declares.

Save the JSON as `manifest.json` in your project and post it to the test installation:

```sh
curl --fail-with-body -sS -X POST 'https://<test-clew>/api/protocol/manifest?id=directory' \
  -H 'content-type: application/json' --data-binary @manifest.json
```

Inspect the response's `ok` and problems, not just the HTTP status. A successful preview validates the manifest; it neither registers a service nor tests source permissions. Full field rules and additional recipes are in the [manifest reference](../generated/manifest-reference.md).

## 4. Implement the HTTP boundary

A read-only connector needs:

| Route on your service | Behavior |
|---|---|
| `GET /clew/manifest` | Return the manifest as JSON. It contains no credentials or source records. |
| `POST /clew/capabilities/directory.team` | Verify credentials, validate input, read the allowed team and return `{ output }`. |

Clew sends a `CallRequest` with `{ actor, input }`, `Authorization: Bearer <assertion>` and `X-Clew-Connector-Key`. For each POST:

1. Verify the transport key and RS256 assertion against the pinned Clew public-key endpoint.
2. Take the actor from the verified claims. Ignore the body actor as an identity source.
3. Validate the operation/input and map the actor to source identity and access.
4. Read only authorized records and map them to the declared output schema.
5. Return the envelope below, or a protocol error with a safe Swedish message.

For a synthetic colleague, the minimal example responds:

<!-- minimal-connector-response -->
```json
{
  "output": {
    "rows": [
      { "ref": "person:42", "name": "Exempelperson" }
    ]
  }
}
```

The list is scoped by the verified actor's unit and source permissions. A ref must stay stable and must be checked again if a later capability accepts it. Do not add `/clew/scan` or `/clew/figure` until you declare those features.

A content system (an intranet on Sitevision, SharePoint or WordPress) can also give Clew its **shared header** ([D88](../decisions/D88-the-web-app-draws-the-shared-header-and-an-administrator-owns-its-content.md)): declare `header: { capability: '<id>.header' }` in the manifest and let that read, which takes no input, answer the site's name and address, the places in the band with their own pages, and the logo when the system has one, as absolute addresses, listing what the acting person may read. Clew checks the answer against `SiteHeaderOutput`, draws it above every page for the people in the connector's audience, and edits nothing of it. [`connectors/intranet`](../../connectors/intranet/README.md) is the fixture.

Use the complete [verifier](../../connectors/phonebook/verification.mjs) and [authorization guide](authorization.md), including key rotation and source authentication. A curl request with only a body actor and transport secret must fail: the secret cannot sign a person. Use the signed fixture harness or a registered Clew test instance for authenticated calls.

## 5. Adapt the example to your system

If you copied phonebook, make these changes together:

| File | Change |
|---|---|
| `manifest.mjs` | Choose your stable lowercase id; update capability names, area standing names and any `view.open.capability` references. Keep only the reads you implement. Update schemas, Swedish labels and view fields together. |
| `connector.mjs` | Rename matching dispatch keys, remove unused handlers and map each read to your source adapter. The verifier takes its audience from `manifest.id`. |
| `directory.mjs` | Replace the assumed API, response mapping and access rules with your source's documented behavior. |
| `server.mjs` | Configure the chosen adapter, trusted `CLEW_URL`, transport key and source credentials. |
| Tests/deployment | Update names, id mappings, recorded source responses, image and configuration documentation. |

The full directory walkthrough explains [the source adapter and view declarations](example-custom-directory.md). Merely renaming fields is not enough: the fixture permits organization-wide lookup, while a real source may require actor-aware search **and** individual-record fetches.

Keep the verifier's security checks intact and maintain its updates in your copied project. Node is the sample language, not a protocol requirement.

## 6. Test and register your connector

Test the real request handler with synthetic records: authorized read, another unit, unknown/inaccessible ref, invalid input, expired/wrong-audience assertion, wrong transport key and source outage. Check output against its declared schema.

Deploy the service where the test Clew can reach it, then have an administrator add its id, base URL and transport secret in Administration → Anslutna system. Registration starts as a draft. Run the connection check, set the audience, enable it and select the eligible read as a menu tool. Confirm that an eligible person sees the view and a person outside the audience does not.

The [testing and deployment guide](testing-and-deployment.md) covers this from an independent repository and provides the operator CLI alternative. The live checker uses synthetic actors and skips required-input reads; it does not prove real-source authorization.

## 7. Add optional features deliberately

| Feature | Add when | Next guide |
|---|---|---|
| Search | Records should join Clew's composite search | [Search and views](example-custom-directory.md) |
| Documents and semantic views | Records need original PDF/DOCX/XLSX/images, composed facts, measurements, charts or history | [Document and semantic views](document-and-semantic-views.md) |
| Model tools | The read/proposal is suitable for model use under the person's access | [Make your reads work in the chat](#10-make-your-reads-work-in-the-chat), [capability surfaces](../architecture/capability-surfaces.md) |
| Scans and figures | The source can report outstanding occurrences or a meaningful area figure | [Actions](actions-and-receipts.md), [protocol](../reference/connector-protocol.md) |
| Writes and undo | Source permissions, preconditions, evidence and recovery are established | [Actions and receipts](actions-and-receipts.md) |
| Callbacks and jobs | A read needs another source, or one task needs changes/follow-up in several systems | [Working across connectors](../architecture/working-across-connectors.md) |
| The news profile | Your system publishes news the person reads (an intranet, a newsroom): the newest show as "Nyheter" on Hem and all of them as "Alla nyheter" | A read `<id>.news` taking `{}` and answering `NewsOutput` (`ref`, `title`, `sender`, `publishedAt`, optional `link`; nothing else) in the [protocol](../reference/connector-protocol.md#related-profiles); a row with `link` leaves Clew, a row without opens the read your view's `open` names (`<id>.newsItem`). Clew joins every source as `clew.news`; a source that fails contributes nothing. The fixture [connectors/communication](../../connectors/communication/README.md) |
| The requests profile | Your system is a service desk where people order things and report faults, and each person should see what they ordered or reported and are waiting for: the first five under "Beställningar och felanmälningar" on Hem, apart from "Mina ärenden", and the whole list, at most 200, on its own page | A read `<id>.requests` taking `{}` and answering `RequestsOutput` (`ref` as `request:<id>:…`, `label` with the number and the type only, `state`, `status`, `since`, optional `expectedAt` and `link`; nothing else) in the [protocol](../reference/connector-protocol.md#related-profiles), and a read your view's `open` names (`<id>.request`) that shows one request with its free text, never a tool. Ask your system as the person: list what they ordered or reported, not what they handle, which is `<id>.errands`. Clew joins every source as `clew.requests` and names a source that does not answer ([D123](../decisions/D123-requests-are-a-profile-of-their-own-apart-from-the-errands-a-person-handles.md)). The fixture [connectors/servicedesk](../../connectors/servicedesk/README.md) |
| A read receipt | Something published must be acknowledged: the person's "Jag har läst" is a write in your system | Mark that execute on your scan draft's action with `acknowledgement: { publishedAt }`, one per draft; Hem lifts the open card above its blocks until it is pressed. Put the text to read in the draft's `summary` (paragraphs separated by a blank line), say who published it and when in `reason`, and, when your system shows it in full, add a `read` with `target: "link"` that answers `{ url }`: Clew draws it after the text ([where things open](where-things-open.md); the fixture [connectors/communication](../../connectors/communication/README.md)) |
| The talks profile | Your system holds utvecklingssamtal and their action points, and an installation uses it instead of Clew's own module | Reads `<id>.talks` and `<id>.commitments` in the [protocol](../reference/connector-protocol.md#related-profiles), [D96](../decisions/D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md), the fixture [connectors/appraisals](../../connectors/appraisals/README.md) |
| The holdings profile | Your system holds people's completed courses, certificates or licences, and Clew's competence register should copy them | An installation read `<id>.holdings` under the manifest's `installation`: Clew reads every account a page at a time as the installation itself, with no person behind the call, on `/clew/installation/{name}`; answer it to the installation's assertion only (`verify.installation`). [Reads the installation makes](../reference/connector-protocol.md#reads-the-installation-makes), [D119](../decisions/D119-the-installation-reads-as-itself-through-a-read-no-person-can-reach.md), the example [connectors/moodle](../../connectors/moodle/README.md#the-installations-read-of-every-holding) |
| Rows about a person or a unit | Your records concern a person or a unit Clew holds and belong on the opened person or unit, as a lens on Personal, or as an action in the person's menu | [Say what your rows are about](#8-say-what-your-rows-are-about), [Entities](../architecture/entities.md) |
| Input the person gives, and what a write says it will do | A write needs a time, a place, a comment or a choice from the person, or the person should see what it will write before it is sent | [Ask the person, and say what a write will do](#9-ask-the-person-and-say-what-a-write-will-do), [protocol](../reference/connector-protocol.md#what-a-write-asks-and-what-it-says-it-will-do) |

For a connector that participates in multi-system tasks, declare the fact kinds it creates and the facts its proposal capabilities follow. Clew assembles those offered steps into a job for one approval after an administrator binds them. Each connector supplies only its own writes or watches; Clew coordinates their progress. [The job design](../architecture/working-across-connectors.md#jobs-facts-followers-and-one-approval) also explains the planned next proposal after a confirmed result.

A delegated interactive read does not establish background authorization. Figures and callbacks do not get session tokens. Approved writes and scans on a delegating connector get the person's token only while the session that approved or asked for them is active; otherwise a write remains pending with `needs-session` and Clew does not call the scan. Resolve the source's own background authorization before promising work that must happen while the person is away.

Keep deployment versions independent of protocol `2`. The current manifest has no `version` or `deprecated` field. [Implementation status](../reference/status.md) is the guide to supported features.

## 8. Say what your rows are about

When your system knows something about a person or a unit Clew holds (a talk's state, today's absence, a unit's sick-leave rate), declare what the capability's rows are **about** ([D97](../decisions/D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md)). Clew then decides where they show. You never name a place and never change a page in Clew. [Entities](../architecture/entities.md) describes what Clew does with the declaration; the [protocol reference](../reference/connector-protocol.md#reads-and-actions-about-an-entity) lists the rules.

The appraisals fixture is the worked example. Its read about a person, from [connectors/appraisals/connector.mjs](../../connectors/appraisals/connector.mjs):

```js
const calendarDay = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', maxLength: 10 };
const instant = { type: 'string', format: 'date-time', maxLength: 40 };
const userName = { type: 'string', minLength: 1, maxLength: 512 };
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const STATE_WORDS = { missing: 'Saknas', booked: 'Bokat', held: 'Hållet' };

const KEYS_MAX = 200;
export const PersonInput = object({ keys: { type: 'array', items: userName, maxItems: KEYS_MAX } });
export const PersonOutput = object({
  rows: {
    type: 'array',
    maxItems: KEYS_MAX,
    items: object(
      {
        key: userName,
        state: { type: 'string', enum: Object.values(STATE_WORDS) },
        at: { anyOf: [calendarDay, instant] },
        overdue: { type: 'integer', minimum: 0 },
      },
      ['key', 'state', 'overdue'],
    ),
  },
});

// In manifest.capabilities:
{
  name: 'appraisals.person',
  kind: 'read',
  title: 'Utvecklingssamtal',
  description:
    'Var varje medarbetare som du är chef för står i den öppna omgången utvecklingssamtal, och hur många åtgärdspunkter som är försenade.',
  model: false,
  scope: { roles: ['manager'] },
  about: { entity: 'person' },
  // Only the manager's reports are asked about (D117); the system still answers only for those it has them as manager of.
  person: { admits: ['managed'] },
  input: PersonInput,
  output: PersonOutput,
  view: {
    kind: 'list',
    title: 'state',
    empty: 'Ingen av dem är med i omgången.',
    fields: [
      { key: 'state', label: 'Samtal', format: 'status', tones: { Saknas: 'warn' } },
      { key: 'at', label: 'När', format: 'instant' },
      { key: 'overdue', label: 'Försenade', format: 'number' },
    ],
    open: { capability: 'appraisals.commitments', title: 'Åtgärdspunkter', params: { person: 'key' } },
  },
},
```

What each part buys:

| Part | What Clew does with it |
|---|---|
| `about: { entity: 'person' }` on a read | A section "Utvecklingssamtal" on the opened person, captioned with the connector's `source` ("Samtalssystemet"); once an administrator chooses to, a lens under "Visa" on Personal and one of its fields as a column on "Alla" |
| The `list` view | How the section, the lens and the column draw the rows; a read about an entity must declare a table or a list |
| `tones: { Saknas: 'warn' }` | A row whose talk is missing gets a mark under "Just nu", where the read is a lens |
| `person: { admits: ['managed'] }` | Who Clew may ask it about: only the caller's direct reports, never the caller or a colleague ([D117](../decisions/D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md)) |
| `open` with `params: { person: 'key' }` | The fuller read under the section and on the person's page |
| `model: false` | Required: a read about an entity is never a model tool |

The handler answers one row per key it knows, each carrying `key` as Clew asked it, and nothing for an unknown key or a person outside the caller's scope in your system. Compare a person's key without regard to case. The caller's own user name is `actor.userName` in the verified assertion; the fixture uses it to find the manager. Beside `rows` an output may declare `heading` and `note`, two strings Clew draws over the lens.

**Say who it may be asked about.** `person.admits` lists the relations Clew may send keys under: `self` (the caller), `managed` (the caller's direct reports under D99, a co-manager only when their line runs to the caller, never their own manager) and `colleague` (anyone else active in the organisation); a read about a unit says `unit.admits`, `manages`, `member` or `below` (a unit led by a manager who reports to the caller, one level down D99's line). Without it Clew sends `self` and `managed` only. Clew resolves every key against its own directory before the call, on every path, a page, a card, a tool or another connector's callback: a key outside what you admit never reaches you, and `about` in the request body, which the verified assertion binds, tells you each key's relation, so you can answer the caller's own row differently from a report's without a copy of the organisation ([Authorization](authorization.md#reads-about-a-person-or-a-unit)). Keep narrowing as the person in your own system; a relation is Clew's floor, not your permission. A read that is not about a person but takes one person's user name declares the property too: `appraisals.commitments` says `person: { param: 'person', admits: ['self', 'managed'] }`. The read a section's row opens with the row's `key`, and a `<id>.commitments` read's `person`, are treated as naming a person even when they do not say so, and every input that names someone must be a plain string property of the input schema, or the manifest is refused.

An action about a person names the input property that takes the key, and requires nothing else that it does not ask the person for ([section 9](#9-ask-the-person-and-say-what-a-write-will-do)). The HR fixture's `hr.prepareAbsence` ([manifest](../../connectors/hr/manifest.mjs)) declares `about: { entity: 'person', param: 'person' }` with an input that requires only `person`; it shows as "Registrera frånvaro" in a manager's menu on a person. Clew starts it with `{ person: <key> }` without the model: a propose answers a `ThreadDraft`, which becomes the manager's card, and an execute is a card whose button is the human decision. Either card opens beside the page the action was started on ([Where things open](where-things-open.md)).

For values drawn in a column or a section, three view options help: the `tones` key `*` warns for any present value ("2 försenade") while an absent one stays neutral; `beside: true` draws a field on the line of the one before it ("Bokat", "tors 12 nov kl. 09:00"); `compact: true` marks the one field that says the row in one value where there is room for only one ("Inte bokat").

**Protocol 3.** Who may be asked about, `about` in the request body and the assertion's binding to its body are protocol 3, a break from 2 ([D117](../decisions/D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md)): declare `"protocol": 3`, validate request bodies against the schema of 3 (its `CallRequest` has `about`), copy the verifier of 3 and hand it the request (`verify(token, key, request)`), and make every input that names a person a plain string property. A connector still on 2 keeps working for a window, gets no `about`, is held to the looser rules of 2 and shows a warning in administration; the [protocol reference](../reference/connector-protocol.md#contract-changes) lists exactly what breaks.

**Preview it.** Open `/protocol/preview` on a running instance and paste the manifest or choose its file. The page posts it to the dry run and shows every problem placed in the document, where each capability about an entity would show, who would see it there, and the row mark, the section and the menu drawn with sample rows. The samples are made from your declaration; nothing is called. The same answer comes from `POST /api/protocol/manifest?id=<id>` as `places`, `audience` and `samples`.

**Check it.** The conformance check asks every read about an entity with an unknown key and with the same keys asked by the check's own people on a unit no installation has, and expects no row and no error. Give it real keys and a person who may see them to check the rows too:

```sh
docker exec -w /workspace clew-app-1 bun scripts/connector-check.ts http://127.0.0.1:4051 --id appraisals --secret <transport key> --keys anna,erik --as hillevi
```

`--keys` are user names (or unit ids) asked in one batch; `--as` is the user name of a person in that installation's directory to sign the batch as. With `--as` the batch passes the installation's own rule of who may be asked about, so a key that person may not ask about is left out as Clew leaves it out, and the body carries each key's relation. Without `--as` the batch is signed as the check's own manager and vouches for no key, so nothing real is sent; without `--keys` the rows are not checked. The unknown key and the keys of another unit are sent straight to your service, past the rule and with no `about`: answer them as no row. The check also lists what each capability that names a person admits, and warns when it declares nothing.

**Place it.** Registration places nothing. An administrator offers the read as a lens and chooses a column on the connector's page under Administration › Anslutna system, in "På Personal och andra listor".

Not available: a read about an entity is never offered to the model, the entity kinds are `person` and `unit` only, and a page inside Clew where the person writes (`about.page`) is for Clew's own domains.

## 9. Ask the person, and say what a write will do

Some writes need something only the person knows: when a talk is held, where, what to tell the employee. Declare it on the capability as **asks**, and Clew draws them as the first step, "Uppgifter", of one dialog wherever the action can be started: a work item's button, a person's or a unit's page, the row menu on Personal. Declare an **effect** on an execute, and the dialog's last step, "Det här händer", shows what your system will do with exactly those answers before anything is sent ([D112](../decisions/D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md)). You never send a form or markup.

The HR fixture's `hr.bookTalk` is the worked example, from [connectors/hr/manifest.mjs](../../connectors/hr/manifest.mjs):

```js
const talkInput = object(
  {
    refs: array({ type: 'string', pattern: '^hr:emp:' }),
    when: { type: 'string', format: 'date-time' },
    place: { type: 'string', maxLength: 120 },
    message: { type: 'string', maxLength: 400 },
  },
  ['refs'],
);

// In manifest.capabilities:
{
  name: 'hr.bookTalk',
  kind: 'execute',
  title: 'Boka samtalet',
  description: 'Registrerar ett omtankesamtal i personalsystemet.',
  model: false,
  scope: { roles: ['manager'] },
  execution: deduplicated,
  input: talkInput,
  output: executeResult,
  asks: [
    { kind: 'meeting', property: 'when', label: 'När', required: true, durationMinutes: 45 },
    { kind: 'text', property: 'place', label: 'Plats', required: false },
    { kind: 'long-text', property: 'message', label: 'Meddelande till medarbetaren', required: false },
  ],
  effect: 'hr.bookTalkEffect',
},
{
  name: 'hr.bookTalkEffect',
  kind: 'read',
  title: 'Det här händer när samtalet bokas',
  description: 'Vad bokningen av ett omtankesamtal gör i personalsystemet, utan att något skrivs.',
  model: false,
  scope: { roles: ['manager'] },
  input: talkInput,
  output: effectOutput, // { rows: [{ label, detail?, source? }], undoMinutes? }
},
```

What each part buys:

| Part | What Clew does with it |
|---|---|
| `kind: 'meeting'` with `durationMinutes` | "När": three free times of that length from the manager's own calendar, "Annan tid", and the chosen day drawn underneath. The answer is the start as an ISO 8601 instant, never in the past. Clew reads nobody else's calendar and writes nothing to a calendar: the time reaches your system only |
| `kind: 'text'`, `'long-text'` | A field and a text area, trimmed; an optional one left empty is not sent |
| `kind: 'date'`, `'choice'` | A day as `YYYY-MM-DD`; one of the property's `enum` values, each named in `options` with a Swedish label |
| `required` | The person must answer before the last step. `true` whenever your input schema requires the property |
| `effect` | "Det här händer": Clew posts your read as the person with exactly the input the execute would get and draws its rows; `undoMinutes` says how long Ångra lasts. Without it the dialog names your `source` and shows the `description` |

Only the asks an action does not already fill are drawn: on the rehab card the rows give `refs`, so the manager meets "När", "Plats" and the message; on the leave card the button's own `input` gives `decision`, so "Godkänn" asks only for the optional comment (`hr.decideLeave` asks for `comment`). An answer to anything not asked is refused, so a person cannot change what the work item fixed. When the manager presses the last button, Clew validates the merged input against your schema, records the answers in the audit row with the approved intent, and your execute receives them in `input`, under its operation id, like any approved write. Store what you are given: the fixture keeps the place and the message with the talk.

The effect read answers as the write would check (the fixture refuses an employee outside the manager's unit) but writes nothing, and declares `model: false`; its input schema is the execute's own. A write without asks whose result can be undone stays one press. `confirm` and `review: "each"` on a work item's action still apply: a reviewed action keeps its review, and a `confirm` on an action that opens the dialog is shown on Det här händer instead of a second dialog.

What the person sees ([where things open](where-things-open.md#asks-and-effect) has the whole list): the dialog opens at "Uppgifter" when an ask is required and at "Det här händer" when none is, so "Godkänn" with its optional comment is two presses. "Det här händer" lists the values, then your effect read's rows with the system each is written in, and "Du kan ångra i 10 minuter." from `undoMinutes`; nothing can be sent until your effect read has answered. A refusal whose sentence starts with an ask's label (Clew's checks of the answers do, and a source's own refusal may) is shown on that field with the focus there, so write yours that way: "Plats: rummet finns inte." An execute about a person or a unit starts its work item first and takes the answers at its decision; a propose about one takes them when it starts.

The loader refuses an ask on a read or a follower, an ask that names no property of the input or the entity's key, a kind that does not fit its property, an optional ask for a property the input requires, and an `effect` that is not such a read. An action about a person may now require more than the key, as long as it asks for it. The [manifest preview](../reference/connector-protocol.md#served-by-the-instance) shows, for every propose and execute, where a person can start it, which steps of the path it draws and who fills each property of its input; the [field reference](../generated/manifest-reference.md) has every rule.

## 10. Make your reads work in the chat

A read with `model: true` is a tool the assistant may call for the person who asks. You write no model code: Clew derives what the model reads, the card under its answer and the source line from what the read already declares, the same way for every connector ([capability surfaces](../architecture/capability-surfaces.md#what-the-model-reads-of-a-read)). What to declare so it works well, using fields that exist:

| Declare | What it buys in the chat |
|---|---|
| A `view` | The model reads each row as the person would: your fields' Swedish `label`s as keys, statuses as words, numbers with their `unit`, dates written out ("27 november 2027", "måndag 16 november 2026 kl. 09:00"). Without one the model reads your output's own keys, less refs, ids and links. A `table` or `list` is also the card drawn under the answer |
| `format` on every date, moment, number and status field | A `date` or `instant` reaches the model in Swedish words and unambiguous, never as `2027-11-27` or a UTC instant; a `status` value reaches it as the word the page shows |
| `title` and plain text fields that name the row | The card shows the rows the answer is about: a row is matched when the answer writes the values your view draws as text (its title first), so name rows the way a person would write them. A number, a date or a status never ties a row to an answer |
| `ref` on a `table` or `list` | The card finds the rows the answer named again when it is read later, even when their values changed. Without it a row is recognised by what the view draws of it |
| `subject` on rows that name a person or a unit | The name in the row leads to the person's or unit's page, in the card under an answer too, and only there; a row's `open` read is then a link of its own beside it, named with the read's title. The model reads the key ("Användarnamn", "Enhetens id") that a read about one of them takes |
| `open` on rows that have a read of their own | The name in the row opens that read; a row that also names a person keeps the person as a link of its own |
| Input properties that narrow the read (a person, a query) | The model can set them from the question; the card is drawn with the same input |
| `modelReads: "summary"` | The model gets only how many rows are shown, never their content; the card is always the whole view. Use it for rows about people's health or anything else the model should not read |
| `opens` on an area's figure | The figure is drawn as a line above a card of the read it opens, and only that read's, when the card is the read as a whole |

Do not ask the model for a source or a time in your descriptions: the transcript names the systems the turn read, by your manifest's `source`, and when. Write the `description` for the model in Swedish, saying what the read answers and what its input takes; Clew adds "Källa: <your source>." to it.
