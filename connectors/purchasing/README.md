# purchasing: a generic purchasing system that issues its own credential, as a fixture connector

The purchasing system of a municipality as the development stack and the unit suite meet it: purchase requests that
wait for an approver, approved or rejected from Clew. A kind of system, not a product (D52); the requests are made up.
An independent Node service behind the connector protocol that imports nothing from the rest of the repository (D21);
the shape is [incidents](../incidents/README.md)'s, with the same store and switches.

It is the fixture of a **linked account** ([D147](../../docs/decisions/D147-a-person-links-an-account-once-where-a-system-issues-its-own-credential.md)):
the system does not take the identity provider's token. Its own authorization server issues the tokens it accepts, so
its manifest declares `linkedAccount` and a person links their account once.

| What                                | How                                                                                                                                                                                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who issues its tokens               | `PURCHASING_ISSUER`. In the development stack the realm `vendor` of the stack's Keycloak, made by `bun scripts/vendor-realm.ts`: a server written by somebody else, standing for the system's own.                                                                                |
| What Clew discovers                 | `GET /.well-known/oauth-protected-resource` answers the system's address (`PURCHASING_RESOURCE`, which the manifest names as `linkedAccount.resource`) and the issuer (RFC 9728).                                                                                                 |
| Whose account a call is for         | The access token in `X-Clew-Delegated-Token`, checked in [tokens.mjs](tokens.mjs): RS256 against the issuer's published keys, its issuer and its expiry. The account is the token's `preferred_username`. Clew's assertion says who is asking and is checked as in every fixture. |
| No token the system takes           | `authorization-required` with a 403, on every capability and on the scan. Clew then counts the link as lost.                                                                                                                                                                      |
| An account that is not the person's | Where Clew's actor carries a user name and it is not the token's account, `denied`: the person linked somebody else's account, and nothing is answered for it.                                                                                                                    |

The connector and the system are one service, so the address Clew discovers from is the connector's own. The system
knows a person by its own account name, never by Clew's id: `hillevi` and `hassan` are approvers with different
requests, and anybody else has none.

- `purchasing.requests` lists what waits for the account, as a list view (D38).
- `purchasing.decide` approves or rejects the chosen requests. It is deduplicated by Clew's operation id and read back
  through `purchasing.lookup` (D45). A request of another approver is answered as one that does not exist.
- The scan raises one card for an account with requests waiting, with the requests as its rows and "Godkänn valda" and
  "Avslå valda" as its actions.

Figures and callbacks carry no token of the person, so the area has no figure.

## Run it

In the development stack it is the service `purchasing`, in the compose profile `linked`, on port 4057. It is not
registered by `bun run dev:connectors`; register it and approve where its people are sent:

```sh
docker exec -w /workspace clew-app-1 bun scripts/vendor-realm.ts
docker exec -w /workspace clew-app-1 bun scripts/connector-add.ts purchasing http://purchasing:4057 --enable
docker exec -w /workspace clew-app-1 bun scripts/connector-link.ts purchasing
```

`bun scripts/linked-account-check.ts` runs the whole of it against the real Keycloak without a browser: it starts this
connector itself, links two people, reads, decides, refreshes, and takes a link away.

| Variable                                           | Meaning                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `PORT`                                             | 4057                                                                                          |
| `CLEW_URL`, `CLEW_CONNECTOR_SECRET`                | Where Clew's keys are read, and the transport key, as for every fixture                       |
| `PURCHASING_ISSUER`                                | The authorization server whose tokens the system takes. Required                              |
| `PURCHASING_RESOURCE`                              | The system's own address as Clew and a browser reach it. Default `http://purchasing:<PORT>`   |
| `PURCHASING_SCOPES`                                | Scopes the manifest asks for, space separated. Default none                                   |
| `FIXTURE_DB`                                       | The SQLite file; the records are seeded into it on first start. Default `./purchasing.sqlite` |
| `FIXTURE_TODAY`, `FIXTURE_RESEED`, `FIXTURE_FAULT` | As in [hr](../hr/README.md); the faults here are `unavailable`, `slow` and `unauthorized`     |

`tests/unit/purchasing-connector.test.ts` runs it over the protocol with the memory store and tokens signed by a key of
the test's own.
