# hello: a Clew connector in one file

The smallest complete connector that a running Clew can use without any change to Clew's code or image. It
shows every part of the connector protocol (`docs/architecture/connector-protocol.md`): a manifest, `read`
and `execute` capabilities with a receipt and an undo, a nightly `scan` that pushes a card, a figure for the
sidebar, the assertion check, and one capability that calls back into Clew to read the person's calendar
through another connector.

Inside the devcontainer (the BFF listens on loopback there, so the connector runs in the same container):

```sh
CLEW_CONNECTOR_SECRET=change-me-change-me CLEW_URL=http://127.0.0.1:3000 node connectors/hello/server.mjs   # :4010
bun scripts/connector-check.ts http://127.0.0.1:4010 --secret change-me-change-me                           # conformance report
```

Then register it (D23: connectors live in Clew's database, never in its environment). `bun run auth:setup`
already seeds `hello` as a draft row with a generated secret (`HELLO_CONNECTOR_SECRET` in `.auth-test.env`);
start the connector with that secret and enable the row, or add it with a secret of your own:

```sh
bun scripts/connector-add.ts hello --enable
bun scripts/connector-add.ts hello http://127.0.0.1:4010 --secret change-me-change-me --enable
```

Within a few seconds, with no restart (the BFF watches the rows), the log says `Connector "hello" (Hello) registered …`, `GET /api/connectors` lists it, the
sidebar gets "Hello-modulen", a manager gets the card after the first visit, and "Dagen med möten" answers
through Clew's calendar connector. The admin page (Administration › Anslutna system, for a person with the grant capability
`admin.connectors`, `mikael` in the dev realm) does the same in the browser, with the conformance check built in.

Writing your own: copy `connector.mjs`, change `CONNECTOR`, the manifest and the capability bodies; keep
`verifyAssertion` and the scope check as they are. Any language works: the protocol is four JSON routes and
one HMAC check, and `docs/protocol/connector-protocol.schema.json` holds every shape. Guide:
`docs/guides/creating-a-connector.md`.
