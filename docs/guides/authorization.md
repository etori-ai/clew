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
| `actor` | `id`, `name`, `unitId`, `unitLabel`, `role` (`manager` or `employee`). |
| `iat`, `exp` | Valid numeric times; expired tokens rejected; lifetime at most 120 seconds. The sample verifier allows five seconds of future clock skew. |
| `jti` | An assertion identifier. It is not a source-operation idempotency key. |
| `callback` | Optional separate signed grant, present when dependencies are declared. |

Use the verified actor for all work. A forged `body.actor` must not alter it. Recheck the capability's role and enforce record-level source authorization, unit boundaries and protected-record rules. A manifest role filter is coarse; `manager` alone does not authorize every unit. Validate refs and current source revisions even when a request came through Clew.

Return 401 for invalid credentials. Fail closed when the trusted key set cannot establish the signature. Use HTTPS outside local development; the sample verifier permits plain HTTP only for its explicit local hostname allowlist. In a separate container, `127.0.0.1` points at that container, not Clew. Use a reachable service name and a Clew listener bound to the appropriate interface.

## Call another connector

Declare each exact target in manifest `uses`, for example `"uses": ["calendar.today"]`. After verifying the incoming request, extract its `callback` claim and use **that grant** as the bearer on `POST {CLEW_URL}/api/connectors/call`, with a `CallbackRequest` body such as `{ "name": "calendar.today", "input": {} }`.

Do not send the original request assertion as a callback credential. Clew accepts only the callback audience `clew:connector-callback`, rebuilds current person/assignment access, checks the origin and target, verifies declared dependencies, and validates the call. Callbacks allow reads and proposals, never executes. Circular calls and chains beyond the bound of eight are refused. Call within the request's two-minute authority window; do not persist the grant for a background job.

See [hello's callback implementation](../../connectors/hello/connector.mjs) and [Clew's callback route](../../apps/server/src/routes/connectors.ts). `callbackFor` decodes a claim; it is safe to use only after the containing assertion was verified.

## Authenticate to the source

The Clew assertion identifies the actor to your connector. It is not automatically a credential your source accepts. Pick a source-specific policy:

| Source authentication | Connector responsibility |
|---|---|
| Service credential | Keep the credential in the connector and explicitly narrow every query and mutation to the verified actor's allowed records. |
| Source account bound to a person | Resolve a verified identity mapping and use only that person's credential. Do not infer authority from a display name or an arbitrary body field. |
| Delegated user token | Declare `delegation: { audience: "<source audience>" }`; consume `X-Clew-Delegated-Token` only for that source. |

For delegation, Clew exchanges a session token for the declared audience through the configured IdP. The connector forwards the resulting token to the source as intended, without storing or logging it. The ordinary Clew assertion remains in `Authorization` on the incoming connector call. Scans, figures, connector callbacks and sessions without suitable IdP credentials do not provide a delegated token. A connector requiring one must deny the operation when it is absent. The [Eneo connector README](../../connectors/eneo/README.md) documents its specific deployment requirements.

## Rotation and revocation

Clew holds the private signing key, sealed in its database; connectors get public keys only. [connector-key-rotate.ts](../../scripts/connector-key-rotate.ts) rotates the installation key with audit. Previous public keys overlap for three minutes, while assertions last at most two. The sample verifier refreshes its pinned key set on expiry or an unknown key id, with bounded refresh frequency.

Clew rechecks current connector governance when invoking and when reading source-derived work. Your source is still responsible for enforcing its current permissions. Do not treat a previously seen card, actor or ref as permanent access. Use the [authorization boundary tests](../../tests/unit/authorization-boundaries.test.ts) for Clew-side cases, and add equivalent source-side tests for your integration.


## Persisted cards and permission changes

Clew records the current person/grant version on a newly scanned source card and checks it on every shared read. A unit transfer, changed role or changed Clew grant makes the old snapshot unavailable, including its history, chips and model context. New authorized observations create fresh cards without copying the old messages. Confirmed, dismissed or uncertain occurrences are not blindly offered as new approvals. See [D75](../decisions/D75-source-snapshots-retain-the-authority-that-produced-them.md).

Migration `0034_source_authorization` does not guess the permissions of legacy cards. External-source cards lacking provenance are hidden; a fresh scan may replace them while their original records and receipts remain stored. Apply migrations before starting the updated server. This is a conservative visibility change, not deletion or a retention policy.

Source-only ACL changes need an explicit revocation path into Clew's grant or connector access. Persisted snapshots cannot discover independently changed source entitlements just by comparing a Clew version. Keep scanning disabled until that path is established; live reads must still enforce current source permissions. Figure responses recheck current Clew authority after their bounded read batch, but are subject to the same source-side responsibility.
