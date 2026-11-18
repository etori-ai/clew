# D129 · Protocol 2 is retired before the first release, and until a release a break retires the number before it

**Status:** accepted (product owner, 2026-11-18) · **Date:** 2026-11-18 · **Area:** integrations

**Context.** [D60](D60-the-instance-serves-its-connector-protocol.md) item 4 has Clew accept a new protocol number and
the one before it for a stated window after a break, so that a connector written outside the repository keeps working
while its owner moves it. Protocol 3 was such a break
([D117](D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md) item 10), and 2
stayed accepted for a window that was to close "by a decision of its own, no earlier than the first release after
2026-11-12". Every connector in the repository declared 3 the day it came. On 2026-11-18 the development stack still
showed seven fixture connectors as "Äldre protokoll": their processes had been started before the change and served the
old manifest from memory. The warning looked like work left to do, and the product owner asked why the old number was
still accepted when no one runs Clew yet.

**Decision.**

1. **Protocol 2 is retired.** `PROTOCOL_ACCEPTED` is 3 alone, and the manifest's `protocol` is the literal 3. A
   manifest on 2 is refused as 1 is: the loader, the dry run and the conformance check name the number, what this Clew
   loads and what to change (`PROTOCOL_RETIRED[2]`), and the served documents carry it under `x-clew-protocol.retired`.
2. **The window's machinery goes with it.** `PROTOCOL_PREVIOUS`, `PROTOCOL_DEPRECATED`, `protocolTerms`, the health
   status `protocol-outdated` with its label "Följer ett äldre protokoll", the conformance check's warning and the loader
   rules that held a manifest on 2 apart (no `installation`, no `assistants`, no plain-string rule, no `about`) are
   removed. A connector is sent `about` whenever the call carries one.
3. **Until the first release, a break retires the number before it at once.** Nothing outside the repository runs a
   connector, so a window protects no one and costs a second set of rules in the loader and the transport. D60's
   window applies from the first release on: the next break after it keeps the number before it for a stated window,
   and the machinery is written again then. A security change still retires the old number at once, before or after a
   release.

**Why.** Clew is in its lab phase and its data is disposable. A compatibility path no one uses is code to read, test
and explain, and it hid a real problem (stale processes) behind a warning that read as a protocol problem.

**Replaces.** Nothing is superseded. It amends [D60](D60-the-instance-serves-its-connector-protocol.md) item 4 (the
window applies from the first release on), closes the window of
[D117](D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md) item 10, and
removes the rules that a manifest on 2 cannot declare `installation`
([D119](D119-the-installation-reads-as-itself-through-a-read-no-person-can-reach.md) item 5) or `assistants`
([D125](D125-a-conversation-can-be-handed-to-another-systems-assistant-and-nothing-follows-the-question.md) item 1),
since every manifest on 2 is refused.

**Consequences.** A connector process that serves an old manifest is now refused rather than warned about: the stack's
fixtures need a restart after a protocol change (`docker compose -f .devcontainer/compose.yaml restart <id> …`), and
the loader records `manifest-invalid` with the steps until they get one. A manifest stored before the change is never
put live as it is: the loader and the reconciler ignore it, an administrator's change to the row does not register it
(`applyLive` in `apps/server/src/connectors/usecases/admin.ts` reads it through `parseManifest`), and
`bun run dev:connectors` fetches the service's current one in its place. Migration `0080_retire_protocol_outdated`
sets a stored health of `protocol-outdated` to `untested`, which the next load or check replaces. The verifiers in
`connectors/` still refuse an assertion without the `body` claim or a call without `about`, which is what a Clew on 2
sent; nothing there changes.
