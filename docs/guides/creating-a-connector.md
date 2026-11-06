# Create a connector

For an integrator connecting an existing system to Clew. The deliverable is your own HTTP service, with a manifest and a source adapter. No Clew SDK, frontend plugin or change to Clew's image is required.

## 1. Read the protocol from the instance, then run the contract

The Clew you will register with serves its own protocol under `/api/protocol` ([D60](../decisions/D60-the-instance-serves-its-connector-protocol.md)): open `http://<clew>/api/protocol` for the routes on both sides with every schema, fetch `/api/protocol/openapi.json` or `/api/protocol/connector-protocol.schema.json` for your generator, and post a manifest draft to `/api/protocol/manifest?id=<your id>` to read what that instance would refuse it for or make of it, before any service exists. It needs no sign-in. In the development stack the address is `http://localhost:3020/api/protocol`; [from your own project](testing-and-deployment.md#from-your-own-project-against-a-test-installation) a test installation is the one to point at.

With the devcontainer running and dependencies installed, run this from the repository root on the host:

```sh
docker exec -w /workspace clew-app-1 bun run docs:smoke
```

This runs [the executable walkthrough](../../scripts/docs-smoke.ts) against the real phone book fixture. It creates an ephemeral signing authority in memory, validates the manifest, sends a signed read, verifies the response, checks that a forged body cannot change the actor, and checks rejected credentials. It also runs the shared conformance checker. Expected final line: `Documentation smoke passed.`

It needs no running Clew BFF, database, Keycloak, model or source API. The ephemeral issuer exists only to test the connector; an installed connector trusts Clew's public keys, never a private key from this example. For a new checkout, start with [local development](../maintainers/local-development.md).

## 2. Choose working code

| Need | Start from | Important limit |
|---|---|---|
| Understand routes, callbacks, scan and receipts | [hello](../../connectors/hello/) | In-memory demonstration; its mutations do not prove durable recovery or real source scoping. |
| Read a directory, catalogue or other lookup service | [telefonbok](../../connectors/telefonbok/) | Fixture data by default; adapt the real API mapping and access policy. |
| Learn source-side operation deduplication and lookup | [reference](../../connectors/reference/) | Synthetic SQLite durability fixture; not a selected pilot or production connector. |
| Retrieve documents with a delegated user token | [eneo](../../connectors/eneo/) | Requires an operator-configured IdP and compatible source API. |

Copy the complete connector directory into your own project, including its verifier and server. For a read-only integration, the phone book is the most useful starting point. Node is only the example implementation language; another language implements the same [JSON Schema](../protocol/connector-protocol.schema.json) and [HTTP contract](../reference/connector-protocol.md).

## 3. Define the smallest contract

Decide who owns each record, who can read or change it, how a Clew person/unit maps to source identities, and how the source authenticates calls. Start with one useful `read`. Name capabilities at task level (`directory`, `openItems`), with precise input and output schemas. Write Swedish titles, descriptions and user-visible errors; keep identifiers English.

Start from the [manifest field reference](../generated/manifest-reference.md): every field with its type, constraints, an example and what it must agree with, plus three recipes; a running Clew draws the same at `/protocol/manifest`. The complete [hello manifest](../generated/hello.manifest.json) and [phone book manifest](../generated/telefonbok.manifest.json) are generated from their actual exports, not abbreviated copy-and-paste samples. The [generated field tables](../generated/README.md) are the short form. The rules in brief:

- Use protocol `2`, a stable lowercase connector id, and `<id>.<verb>` capability names.
- Declare only implemented operations. A `read` may have a view; `execute` must have `model: false`.
- List standing capabilities in an area if people should reach them without composing a question.
- Declare exact callback targets in `uses`, an array of strings such as `calendar.today`.
- Keep refs stable and validate them when they come back. Refs are opaque within the owner's contract: hello uses `hello:item:1`, while the phone book uses `person:<id>`. They do not grant access.
- Choose `scan: false` unless you can define a deterministic occurrence and its stable topic.
- To take part in work that spans systems (D55), declare the fact kinds your connector creates in `facts` (`<id>:<kind>` with the attributes' JSON Schema) and mark the capability that brings one about with `creates`. A `propose` that answers for another system's fact declares `follows`: its input is a `FactEnvelope`, its output a `FollowResponse` whose steps name your own connector only, as an execute with its payload or a watch (one of your reads, an expectation and a window). Nothing runs until an administrator binds your follower to the kind and the person approves the job; Clew runs each step as its own execution.

Do not add fields from a proposed decision unless they exist in the schema. For example, `deprecated` is not a supported manifest field today; the dry run at `/api/protocol/manifest` names such a field as a problem. See [status](../reference/status.md).

## 4. Implement the request boundary and source adapter

Serve `GET /clew/manifest` and `POST /clew/capabilities/{name}`. Add `/clew/scan` and `/clew/figure` only when declared. The [protocol reference](../reference/connector-protocol.md) lists their request and response definitions.

For each POST, verify the transport key and Clew's signed assertion, take the actor from verified claims, validate the input, enforce capability and record-level access, then call the source. Map the source's response to the declared output. Map failures to the protocol error envelope with a safe Swedish message. The body actor is not trusted identity. The full flow is in [authorization](authorization.md).

Keep the source's own vocabulary and credentials in the adapter. The phone book isolates that work in [directory.mjs](../../connectors/telefonbok/directory.mjs): a fixture and an HTTP adapter implement the same two functions. Replace its assumed HTTP shape with your source's documented shape and test recorded responses. Do not ship the fixture's organization-wide access policy without checking the real source's rules.

## 5. Add one feature at a time

- [Search and declared views](example-custom-directory.md) make the read useful from both buttons and the composer.
- [Actions and receipts](actions-and-receipts.md) explain scan drafts, approved writes and uncertain outcomes.
- [Testing and deployment](testing-and-deployment.md) covers fixture tests, live checks, registration and upgrades.

An independently deployed connector needs the source credentials and a trusted `CLEW_URL`. Clew stores its registration and transport secret in the database. Registration is not an environment variable or a code import.
