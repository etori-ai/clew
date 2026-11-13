# D44 · Authorized reads and Clew-signed connector authority

Date: 2026-11-05

Area: identity

Status: accepted; phase 1 of the approved reliability and authorization plan; the request assertion bound to its body and capability by [D117](D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md) (2026-11-12, provisional)

## Decision

Missing connector governance denies access. Business readiness requires local governance and installation signing authority; initialization retries after temporary failure. Login is available independently. Source availability does not decide local readiness.

Every source-derived thread, receipt, object and generated answer is filtered against current access. Generated answers retain source/capability provenance and authorization version. Legacy generated answers without provenance are retained but suppressed from ordinary reads. Invocation refreshes authoritative connector state and enforces current scope, input and output contracts, including nested calls. Generic REST invocation cannot execute a source write.

Protocol 2 uses RS256 installation signing keys, sealed in PostgreSQL and never shared with connectors. Verifiers pin Clew's public key endpoint and enforce algorithm, key ID, audience and short lifetime. Separate callback grants bind origin, person/assignment, allowed dependencies and bounded call chain. A request assertion cannot authorize a callback. The existing per-connector secret remains transport authentication only. Key rotation has a public-key overlap; every Clew instance observes the current signing key. Protocol 1 is rejected.

## Why

The review found disclosure paths around the stream filter and shared-secret holders able to forge user authority. Central enforcement closes those paths. Durable local key ownership works across restarts and server instances without placing private signing material in connector deployments. Retryable readiness prevents a temporary database or migration failure from permanently blocking the service.

## Replaces

Narrows D21's identity and version-transition rules and D23's implicit governance behavior. D25's ports and functional use cases remain. This decision accepts the authorization slice of the [implementation plan](../architecture/reliability-and-authorization-plan.md); later durable execution, occurrence, timer and delivery increments remain to be implemented.

## Amended 2026-11-12 (D117)

Every request assertion is bound to the one request it is sent with: its `body` claim is the SHA-256 of the exact
request body (base64url), and on `/clew/capabilities/{name}` its `capability` claim is that name
([D117](D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md)). The verifier
every connector in the repository carries recomputes both from the request it received and refuses any other, so the
input cannot be changed and an assertion cannot be replayed on another capability within its two minutes. When the input
names people or units, the body also carries `about`: each key sent and how the actor stands to it. It is in the bound
body rather than the bearer, so the header stays one size however many keys a call names, and it is never in the
callback grant. This is part of protocol 3, a break under D60: the verifier of 3 refuses an assertion without `body`,
so a connector built from it answers 401 to a Clew that speaks only 2, and a connector that validates request bodies
against the closed `CallRequest` of 2 refuses one that carries `about`. A connector on 2 is loaded for a window, is sent
no `about`, and verifies the actor as before; to move to 3 it verifies `body` and `capability` against the request.
