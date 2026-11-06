# Hello: a small connector demonstration

Hello demonstrates a manifest, reads, a scan, a figure, a callback and toy execute/undo receipts. It uses Node and no workspace library. Its state is in memory and its data is synthetic: use it to understand the protocol, not as proof of durable writes or production record-level authorization.

- [Create a connector](../../docs/guides/creating-a-connector.md): the supported authoring path.
- [Protocol reference](../../docs/reference/connector-protocol.md) and [generated manifest](../../docs/generated/hello.manifest.json).
- [connector.mjs](connector.mjs): declarations and handlers.
- [verification.mjs](verification.mjs): required companion verifier; protocol 2 RS256 assertions and the separate transport secret.
- [server.mjs](server.mjs): Node HTTP service.

## Run locally

With the Clew BFF and its signing authority available in the devcontainer, run from the host:

```sh
docker exec -w /workspace -e CLEW_CONNECTOR_SECRET=local-docs-only-transport-key -e CLEW_URL=http://127.0.0.1:3000 clew-app-1 node connectors/hello/server.mjs
```

Leave it running; in another terminal:

```sh
docker exec -w /workspace clew-app-1 bun scripts/connector-check.ts http://127.0.0.1:4010 --id hello --secret local-docs-only-transport-key
docker exec -w /workspace clew-app-1 bun scripts/connector-add.ts hello http://127.0.0.1:4010 --secret local-docs-only-transport-key
```

Registration creates or updates a draft. Review its audience and enable it in Administration → Anslutna system. These commands reuse the hello registration in a development installation. The callback to calendar.today requires the current actor's local grant; the synthetic live checker actors may not have that grant. A callback failure is not permission to bypass it. The [remote connector tests](../../tests/unit/remote-connector.test.ts) use a synthetic callback transport.

Configuration: CLEW_CONNECTOR_SECRET (at least 16 characters), CLEW_URL (the trusted public-key endpoint base and callback destination), PORT (default 4010). The transport key cannot sign an actor; every POST also needs a valid assertion. The callback sends the separate verified callback grant, not that assertion.

Copy the whole directory, including the verifier. For a lookup integration use [phonebook](../phonebook/README.md); for source-side deduplication and recovery study the [synthetic reference source](../reference/README.md). The [documentation smoke](../../scripts/docs-smoke.ts) exercises the phone book without any running services.
