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
| Model tools | The read/proposal is suitable for model use under the person's access | [Capability surfaces](../architecture/capability-surfaces.md) |
| Scans and figures | The source can report outstanding occurrences or a meaningful area figure | [Actions](actions-and-receipts.md), [protocol](../reference/connector-protocol.md) |
| Writes and undo | Source permissions, preconditions, evidence and recovery are established | [Actions and receipts](actions-and-receipts.md) |
| Callbacks and jobs | An explicit use case needs another system | [Working across connectors](../architecture/working-across-connectors.md) |

A delegated interactive read does not establish background authorization. Scans/figures/callbacks do not get session tokens, and generic durable remote actions can remain pending with `needs-session`. Resolve that source constraint before adding them.

Keep deployment versions independent of protocol `2`. The current manifest has no `version` or `deprecated` field. [Implementation status](../reference/status.md) is the guide to supported features.
