# hello: a Clew connector in one file

The smallest complete integration that a running Clew can load without any change to Clew's code or
image. It shows every part of the connector protocol (`docs/architecture/connector-protocol.md`): a manifest,
`read` and `execute` capabilities with a receipt and an undo, a nightly `scan` that pushes a card, a figure
for the sidebar, the assertion check, and one capability that calls back into Clew to read the person's
calendar through another connector.

```sh
CLEW_CONNECTOR_SECRET=change-me-change-me node connectors/hello/server.mjs      # :4010
bun scripts/connector-check.ts http://127.0.0.1:4010 --secret change-me-change-me     # conformance report
```

Then tell Clew about it (`apps/server/.env.local` in the devcontainer, or the environment of the Clew container):

```
CLEW_CONNECTORS=hello=http://127.0.0.1:4010
CLEW_CONNECTOR_SECRET_HELLO=change-me-change-me
```

Restart the BFF: `GET /api/connectors` lists `hello`, the sidebar gets "Hello-anslutningen", a manager gets the
card after the first visit, and "Dagen med möten" answers through Clew's calendar connector.

Writing your own: copy `connector.mjs`, change `CONNECTOR`, the manifest and the capability bodies; keep
`verifyAssertion` and the scope check as they are. Any language works: the protocol is four JSON routes
and one HMAC check, and `docs/protocol/connector-protocol.schema.json` holds every shape.
