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

Expected final line: `Documentation smoke passed.` The [walkthrough](../../scripts/docs-smoke.ts) validates the phone book manifest, exercises real handlers with ephemeral signed requests and verifies that a forged body cannot change the actor. Its private signing key is test-only; a deployed connector trusts Clew's public keys.

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
  "protocol": 2,
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

`scope: {}` imposes no role restriction, but Clew's configured audience and your source's record permissions still apply. `model: false` keeps this first read out of the assistant's tools. The empty input means the unit must come from verified identity, not a browser-supplied unit id. The view makes it eligible for administrator-selected menu placement; it does not publish itself.

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
| Model tools | The read/proposal is suitable for model use under the person's access | [Capability surfaces](../architecture/capability-surfaces.md) |
| Scans and figures | The source can report outstanding occurrences or a meaningful area figure | [Actions](actions-and-receipts.md), [protocol](../reference/connector-protocol.md) |
| Writes and undo | Source permissions, preconditions, evidence and recovery are established | [Actions and receipts](actions-and-receipts.md) |
| Callbacks and jobs | A read needs another source, or one task needs changes/follow-up in several systems | [Working across connectors](../architecture/working-across-connectors.md) |
| The talks profile | Your system holds utvecklingssamtal and their action points, and an installation uses it instead of Clew's own module | Reads `<id>.talks` and `<id>.commitments` in the [protocol](../reference/connector-protocol.md#related-profiles), [D96](../decisions/D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md), the fixture [connectors/appraisals](../../connectors/appraisals/README.md) |
| Rows about a person or a unit | Your records concern a person or a unit Clew holds and belong on the opened person or unit, as a lens on Personal, or as an action in the person's menu | [Say what your rows are about](#8-say-what-your-rows-are-about), [Entities](../architecture/entities.md) |

For a connector that participates in multi-system tasks, declare the fact kinds it creates and the facts its proposal capabilities follow. Clew assembles those offered steps into a job for one approval after an administrator binds them. Each connector supplies only its own writes or watches; Clew coordinates their progress. [The job design](../architecture/working-across-connectors.md#jobs-facts-followers-and-one-approval) also explains the planned next proposal after a confirmed result.

A delegated interactive read does not establish background authorization. Scans/figures/callbacks do not get session tokens, and generic durable remote actions can remain pending with `needs-session`. Resolve that source constraint before adding them.

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
| `open` with `params: { person: 'key' }` | The fuller read under the section and on the person's page |
| `model: false` | Required: a read about an entity is never a model tool |

The handler answers one row per key it knows, each carrying `key` as Clew asked it, and nothing for an unknown key or a person outside the caller's scope in your system. Compare a person's key without regard to case. The caller's own user name is `actor.userName` in the verified assertion; the fixture uses it to find the manager. Beside `rows` an output may declare `heading` and `note`, two strings Clew draws over the lens.

An action about a person names the input property that takes the key, and requires nothing else. The HR fixture's `hr.prepareAbsence` ([manifest](../../connectors/hr/manifest.mjs)) declares `about: { entity: 'person', param: 'person' }` with an input that requires only `person`; it shows as "Registrera frånvaro" in a manager's menu on a person. Clew starts it with `{ person: <key> }` without the model: a propose answers a `ThreadDraft`, which becomes the manager's card, and an execute is a card whose button is the human decision.

For values drawn in a column or a section, three view options help: the `tones` key `*` warns for any present value ("2 försenade") while an absent one stays neutral; `beside: true` draws a field on the line of the one before it ("Bokat", "tors 12 nov kl. 09:00"); `compact: true` marks the one field that says the row in one value where there is room for only one ("Inte bokat").

**Preview it.** Open `/protocol/preview` on a running instance and paste the manifest or choose its file. The page posts it to the dry run and shows every problem placed in the document, where each capability about an entity would show, who would see it there, and the row mark, the section and the menu drawn with sample rows. The samples are made from your declaration; nothing is called. The same answer comes from `POST /api/protocol/manifest?id=<id>` as `places`, `audience` and `samples`.

**Check it.** The conformance check asks every read about an entity with an unknown key and with the same keys asked by the check's own people on a unit no installation has, and expects no row and no error. Give it real keys and a person who may see them to check the rows too:

```sh
docker exec -w /workspace clew-app-1 bun scripts/connector-check.ts http://127.0.0.1:4051 --id appraisals --secret <transport key> --keys anna,erik --as hillevi
```

`--keys` are user names (or unit ids) asked in one batch; `--as` is the user name of a person in that installation's directory to sign the batch as. Without `--as` the batch is signed as the check's own manager, for whom every real key is out of scope; without `--keys` the rows are not checked.

**Place it.** Registration places nothing. An administrator offers the read as a lens and chooses a column on the connector's page under Administration › Anslutna system, in "På Personal och andra listor".

Not available: a read about an entity is never offered to the model, the entity kinds are `person` and `unit` only, and a page inside Clew where the person writes (`about.page`) is for Clew's own domains.
