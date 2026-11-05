# D44 · Authorized reads and Clew-signed connector authority

Date: 2026-11-05

Area: identity

Status: accepted; phase 1 of the approved reliability and authorization plan

## Decision

Missing connector governance denies access. Business readiness requires local governance and installation signing authority; initialization retries after temporary failure. Login is available independently. Source availability does not decide local readiness.

Every source-derived thread, receipt, object and generated answer is filtered against current access. Generated answers retain source/capability provenance and authorization version. Legacy generated answers without provenance are retained but suppressed from ordinary reads. Invocation refreshes authoritative connector state and enforces current scope, input and output contracts, including nested calls. Generic REST invocation cannot execute a source write.

Protocol 2 uses RS256 installation signing keys, sealed in PostgreSQL and never shared with connectors. Verifiers pin Clew's public key endpoint and enforce algorithm, key ID, audience and short lifetime. Separate callback grants bind origin, person/assignment, allowed dependencies and bounded call chain. A request assertion cannot authorize a callback. The existing per-connector secret remains transport authentication only. Key rotation has a public-key overlap; every Clew instance observes the current signing key. Protocol 1 is rejected.

## Why

The review found disclosure paths around the stream filter and shared-secret holders able to forge user authority. Central enforcement closes those paths. Durable local key ownership works across restarts and server instances without placing private signing material in connector deployments. Retryable readiness prevents a temporary database or migration failure from permanently blocking the service.

## Replaces

Narrows D21's identity and version-transition rules and D23's implicit governance behavior. D25's ports and functional use cases remain. This decision accepts the authorization slice of the [implementation plan](../architecture/reliability-and-authorization-plan.md); later durable execution, occurrence, timer and delivery increments remain to be implemented.
