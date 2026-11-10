# Authorize every connector request

Protocol 2 separates the credential that identifies Clew's transport from the key that can assert a person. Use the complete [standalone verifier](../../connectors/hello/verification.mjs) and [executable exchange](../../scripts/docs-smoke.ts) as references. The [wire schema](../protocol/connector-protocol.schema.json) defines `Actor`; [authority.ts](../../apps/server/src/connectors/authority.ts) defines the signed claims.

## Inbound requests

Every POST must pass both checks:

1. Compare `X-Clew-Connector-Key` to your configured transport secret using a constant-time comparison. It is the same secret stored in the connector registration; use at least 16 characters. It cannot sign user identity.
2. Verify the RS256 bearer assertion against public keys fetched from your configured `CLEW_URL/api/connectors/jwks`. Pin that URL in deployment configuration. Never follow a token-supplied key URL or trust an unverified claim.

| Header or claim | Expected value |
|---|---|
| `alg`, `typ`, `kid` | `RS256`, `JWT`, a known public signing-key id. |
| `iss` | `clew`. The pinned key endpoint identifies the installation. |
| `aud` | Your connector id, exactly. |
| `sub` and `actor.id` | The same person id. |
| `actor` | `id`, `name`, `unitId`, `unitLabel`, `role` (`manager` or `employee`), and `userName` when the person was provisioned with one: the directory user name ([D68](../decisions/D68-people-are-pushed-into-clew-through-standard-scim.md)) your system knows them by. A callback grant carries the same actor. |
| `iat`, `exp` | Valid numeric times; expired tokens rejected; lifetime at most 120 seconds. The sample verifier allows five seconds of future clock skew. |
| `jti` | An assertion identifier. It is not a source-operation idempotency key. |
| `callback` | Optional separate signed grant, present when dependencies are declared. |

Use the verified actor for all work. A forged `body.actor` must not alter it. Recheck the capability's role and enforce record-level source authorization, unit boundaries and protected-record rules. A manifest role filter is coarse; `manager` alone does not authorize every unit. Validate refs and current source revisions even when a request came through Clew.

Map the actor to your source by `userName` when you key people on the directory's user name, comparing without regard to case. It is optional: a person provisioned without one has none, and you then refuse or answer nothing rather than guess from the display name. D97 leaves open whether the person's key on the wire stays `userName` or becomes the stable `externalId`, which the actor does not carry.

Return 401 for invalid credentials. Fail closed when the trusted key set cannot establish the signature. Use HTTPS outside local development; the sample verifier permits plain HTTP only for its explicit local hostname allowlist. In a separate container, `127.0.0.1` points at that container, not Clew. Use a reachable service name and a Clew listener bound to the appropriate interface.

## Call another connector

Declare each exact target in manifest `uses`, for example `"uses": ["calendar.today"]`. After verifying the incoming request, extract its `callback` claim and use **that grant** as the bearer on `POST {CLEW_URL}/api/connectors/call`, with a `CallbackRequest` body such as `{ "name": "calendar.today", "input": {} }`.

Do not send the original request assertion as a callback credential. Clew accepts only the callback audience `clew:connector-callback`, rebuilds current person/assignment access, checks the origin and target, verifies declared dependencies, and validates the call. Callbacks allow reads and proposals, never executes. Circular calls and chains beyond the bound of eight are refused. Call within the request's two-minute authority window; do not persist the grant for a background job.

See [hello's callback implementation](../../connectors/hello/connector.mjs) and [Clew's callback route](../../apps/server/src/routes/connectors.ts). `callbackFor` decodes a claim; it is safe to use only after the containing assertion was verified.

## Reads about a person or a unit

A read that declares `about` ([D97](../decisions/D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md)) is asked with `{ keys }`: other people's user names, or unit ids. Clew sends only keys the acting person may be asked about under its core rule, checked before your connector is called:

| Kind | The acting person may be asked about |
|---|---|
| Person | Themselves; anyone active on a unit they manage; any other active person in their organisation, when they open that person |
| Unit | A unit they manage or are assigned to |

That rule is Clew's floor, not your permission. A colleague's key reaches you because the person opened a colleague, not because they may read that colleague's records in your system. Narrow every key to what the verified actor may see in your source, and answer a key outside it as no row, never as an error, so a missing row stands for both "none" and "not allowed". The rule lives in [the entities module](../../apps/server/src/modules/entities/usecases.ts); [Entities](../architecture/entities.md#who-may-be-asked-about) explains it.

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
