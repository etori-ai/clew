# Authorize every connector request

Protocol 3 (and 2, for its window: see the [protocol reference](../reference/connector-protocol.md#contract-changes)) separates the credential that identifies Clew's transport from the key that can assert a person. Use the complete [standalone verifier](../../connectors/hello/verification.mjs) and [executable exchange](../../scripts/docs-smoke.ts) as references. The [wire schema](../protocol/connector-protocol.schema.json) defines `Actor`; [authority.ts](../../apps/server/src/connectors/authority.ts) defines the signed claims.

## Inbound requests

Every POST must pass both checks:

1. Compare `X-Clew-Connector-Key` to your configured transport secret using a constant-time comparison. It is the same secret stored in the connector registration; use at least 16 characters. It cannot sign user identity.
2. Verify the RS256 bearer assertion against public keys fetched from your configured `CLEW_URL/api/connectors/jwks`. Pin that URL in deployment configuration. Never follow a token-supplied key URL or trust an unverified claim. Check that it was issued for this request (its `body` and `capability` claims below); the sample verifier does both when you pass it the request.

| Header or claim | Expected value |
|---|---|
| `alg`, `typ`, `kid` | `RS256`, `JWT`, a known public signing-key id. |
| `iss` | `clew`. The pinned key endpoint identifies the installation. |
| `aud` | Your connector id, exactly. |
| `sub` and `actor.id` | The same person id. |
| `actor` | `id`, `name`, `unitId`, `unitLabel`, `role` (`manager` or `employee`), and `userName` when the person was provisioned with one: the directory user name ([D68](../decisions/D68-people-are-pushed-into-clew-through-standard-scim.md)) your system knows them by. A callback grant carries the same actor. |
| `iat`, `exp` | Valid numeric times; expired tokens rejected; lifetime at most 120 seconds. The sample verifier allows five seconds of future clock skew. |
| `jti` | An assertion identifier. It is not a source-operation idempotency key. |
| `body` | The SHA-256 of the exact request body, base64url ([D117](../decisions/D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md)). Recompute it from the bytes you received; any other body was not sent by Clew. |
| `capability` | On `/clew/capabilities/{name}`, that name; absent on every other route. An assertion for one capability is refused on another. |
| `callback` | Optional separate signed grant, present when dependencies are declared. |

Use the verified actor for all work. A forged `body.actor` must not alter it. Recheck the capability's role and enforce record-level source authorization, unit boundaries and protected-record rules. A manifest role filter is coarse; `manager` alone does not authorize every unit. Validate refs and current source revisions even when a request came through Clew.

Map the actor to your source by `userName` when you key people on the directory's user name, comparing without regard to case. It is optional: a person provisioned without one has none, and you then refuse or answer nothing rather than guess from the display name. D97 leaves open whether the person's key on the wire stays `userName` or becomes the stable `externalId`, which the actor does not carry.

Return 401 for invalid credentials. Fail closed when the trusted key set cannot establish the signature. Use HTTPS outside local development; the sample verifier permits plain HTTP only for its explicit local hostname allowlist. In a separate container, `127.0.0.1` points at that container, not Clew. Use a reachable service name and a Clew listener bound to the appropriate interface.

## Call another connector

Declare each exact target in manifest `uses`, for example `"uses": ["calendar.today"]`. After verifying the incoming request, extract its `callback` claim and use **that grant** as the bearer on `POST {CLEW_URL}/api/connectors/call`, with a `CallbackRequest` body such as `{ "name": "calendar.today", "input": {} }`.

Do not send the original request assertion as a callback credential. Clew accepts only the callback audience `clew:connector-callback`, rebuilds current person/assignment access, checks the origin and target, verifies declared dependencies, and validates the call. Callbacks allow reads and proposals, never executes. Circular calls and chains beyond the bound of eight are refused. Call within the request's two-minute authority window; do not persist the grant for a background job.

See [hello's callback implementation](../../connectors/hello/connector.mjs) and [Clew's callback route](../../apps/server/src/routes/connectors.ts). `callbackFor` decodes a claim; it is safe to use only after the containing assertion was verified.

## Reads about a person or a unit

A read that declares `about` ([D97](../decisions/D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md)) is asked with `{ keys }`: other people's user names, or unit ids. A capability may also take one person's user name in a property it names in `person.param`. Clew sends only keys the acting person may be asked about under its core rule, checked on every call before your connector is called, whichever path the call came by ([D117](../decisions/D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md)):

| Kind | The acting person may be asked about | Relation |
|---|---|---|
| Person | Themselves | `self` |
| Person | Their direct reports under D99: people placed on a unit they manage without a manager's role there, and those who report to it from below. A co-manager only when their line runs to a unit above it that they lead too; never their own manager | `managed` |
| Person | Any other active person in their organisation, only where the capability admits it | `colleague` |
| Unit | A unit they hold a manager's role on | `manages` |
| Unit | A unit they are placed on otherwise, only where the capability admits it | `member` |

Declare in `person.admits` (or `unit.admits`) which relations your capability answers; without it Clew sends only `self` and `managed` (or `manages`). A key outside them is left out of `keys`, and a call whose single key is outside them, or is not a string, is refused before it reaches you. Every input that names someone must be a plain string property of your input schema; the loader refuses anything else, including the `person` of a `<id>.commitments` read and a property a row of your read about a person fills from its `key`, which name a person whether you declare them or not.

The request body maps each key in the input to its relation:

```json
{ "actor": { "id": "…", "role": "manager", "userName": "hillevi", "…": "…" },
  "input": { "keys": ["anna", "hillevi"] },
  "about": { "entity": "person", "relations": { "anna": "managed", "hillevi": "self" } } }
```

Trust `about` only from a body the verified assertion is bound to: its `body` claim is the SHA-256 of the exact body bytes (base64url), and on `/clew/capabilities/{name}` its `capability` claim is that name. The [verifier](../../connectors/hello/verification.mjs) checks both when it is handed the request (`verify(token, key, request)`; `bindingOf(request)` reads a clone, so the handler can still read the body), and refuses an assertion replayed with another body or on another capability. Then answer `self` differently from `managed` without a copy of the organisation. A key in the input that `about` does not name is one Clew did not vouch for: answer it as no row. The relations are never in the `callback` grant, and the bearer stays one size however many keys a call names.

The rule is Clew's floor, not your permission. A relation says how the person stands to someone in Clew's directory, not that they may read that someone's records in your system. Narrow every key to what the verified actor may see in your source, and answer a key outside it as no row, never as an error, so a missing row stands for both "none" and "not allowed". The rule lives in [the entities module](../../apps/server/src/modules/entities/relations.ts); [Entities](../architecture/entities.md#who-may-be-asked-about) explains it.

## Authenticate to the source

The Clew assertion identifies the actor to your connector. It is not automatically a credential your source accepts. Pick a source-specific policy:

| Source authentication | Connector responsibility |
|---|---|
| Service credential | Keep the credential in the connector and explicitly narrow every query and mutation to the verified actor's allowed records. |
| Source account bound to a person | Resolve a verified identity mapping and use only that person's credential. Do not infer authority from a display name or an arbitrary body field. |
| Delegated user token | Declare `delegation: { audience: "<source audience>" }`; consume `X-Clew-Delegated-Token` only for that source. |

For delegation, Clew exchanges a session token for the declared audience through the configured IdP. The connector forwards the resulting token to the source as intended, without storing or logging it. The ordinary Clew assertion remains in `Authorization` on the incoming connector call. Figures, connector callbacks, the nightly scan, sessions without suitable IdP credentials and any work no live session of the person stands behind do not provide a delegated token. A connector requiring one must deny the operation when it is absent. The [Eneo connector README](../../connectors/eneo/README.md) documents its specific deployment requirements.

### Work the person's own session stands behind

An approved write and a scan do not run inside the request that asked for them. On a connector that declares `delegation` they still run with the person's own token, from the signed-in session that asked for them and only while that session is active: not logged out, not ended by the IdP's back-channel logout or a failed refresh, not idle- or absolute-expired, and still bound to the same person. There is no fallback to a credential of Clew's, a stored token or another session.

- **Writes.** The approval keeps a binding to the session that approved it, sealed with the execution: the session's digest, never a token. When the workflow carries the write out, Clew finds that session, exchanges the token for the connector's audience before it records the dispatch, and sends it as `X-Clew-Delegated-Token` with the operation id. Without such a session the write stays pending with `needs-session` and nothing is sent; when the IdP cannot exchange a token it stays pending with `source-unavailable`. A replay inside the source's deduplication window needs the approving session as well.
- **Read-back.** When the approving session has ended, the person can ask to check a write that was already sent. The session they ask from is kept for that execution and may stand behind its lookup, never behind a dispatch or a replay.
- **Scans.** A refresh request keeps a binding to the session that last asked for it; the page asks on every visit. The worker scans a delegating connector with that session's token, sent as `X-Clew-Delegated-Token` on `POST /clew/scan`, and only while the person has been active in that session within the last 15 minutes (`PRESENCE_MS` in [refresh-model.ts](../../apps/server/src/threads/refresh-model.ts)). Activity is the sign-in or the page's last report to `POST /api/auth/activity`, which an open page sends at most every 30 seconds on a key, pointer, wheel or touch event while it is visible. A session's own idle limit is eight hours, so without this bound a completed request, which the worker scans again every minute, would be scanned as the person for hours after the tab was closed. Without a session that stands behind it Clew does not call the connector: the scan answers `authorization-required`, the request is blocked (the audit row says `session: "idle"` when the person was away), and the cards already there stay. The person's next ask from a session requeues a blocked request at once and clears that block's error, so the page they come back to reads the source as pending rather than failed, and its scan runs as soon as their activity is reported. A request without a session, such as the nightly scan's, clears the binding when it queues a scan, and the person's next visit queues one with theirs.

An approved write has no such activity bound: the approval is the person's own act, and the approving session stands behind it for as long as the session is active. The current Clew grant is checked as before; the session adds the person's token, never more authority. The audit rows say which of the person's sessions stood behind a call (`session: "approving"` or `"checking"` on an execution's rows, `session: true` on a refresh's), never the binding or the token. A write left pending with `needs-session` is not resumed by a later sign-in, and approving the same card decision again returns the waiting execution; checked again after its 24 hours, it fails as `approval-expired`. A watch step of a job reads without a session. Because the token lives only as long as the session, prove the source's own background authorization path before promising work that must happen while the person is away. See [execution composition](../../apps/server/src/composition/executions.ts) and [refresh composition](../../apps/server/src/composition/refresh.ts).

## Rotation and revocation

Clew holds the private signing key, sealed in its database; connectors get public keys only. [connector-key-rotate.ts](../../scripts/connector-key-rotate.ts) rotates the installation key with audit. Previous public keys overlap for three minutes, while assertions last at most two. The sample verifier refreshes its pinned key set on expiry or an unknown key id, with bounded refresh frequency.

Clew rechecks current connector governance when invoking and when reading source-derived work. Your source is still responsible for enforcing its current permissions. Do not treat a previously seen card, actor or ref as permanent access. Use the [authorization boundary tests](../../tests/unit/authorization-boundaries.test.ts) for Clew-side cases, and add equivalent source-side tests for your integration.


## Persisted cards and permission changes

Clew records the current person/grant version on a newly scanned source card and checks it on every shared read. A unit transfer, changed role or changed Clew grant makes the old snapshot unavailable, including its history, chips and model context. New authorized observations create fresh cards without copying the old messages. Confirmed, dismissed or uncertain occurrences are not blindly offered as new approvals. See [D75](../decisions/D75-source-snapshots-retain-the-authority-that-produced-them.md).

Migration `0034_source_authorization` does not guess the permissions of legacy cards. External-source cards lacking provenance are hidden; a fresh scan may replace them while their original records and receipts remain stored. Apply migrations before starting the updated server. This is a conservative visibility change, not deletion or a retention policy.

Source-only ACL changes need an explicit revocation path into Clew's grant or connector access. Persisted snapshots cannot discover independently changed source entitlements just by comparing a Clew version. Keep scanning disabled until that path is established; live reads must still enforce current source permissions. Figure responses recheck current Clew authority after their bounded read batch, but are subject to the same source-side responsibility.
