# D129 · The connector protocol is 1, and changes in place until the first release

**Status:** accepted (product owner, 2026-11-18) · **Date:** 2026-11-18 · **Area:** integrations

**Context.** [D60](D60-the-instance-serves-its-connector-protocol.md) item 4 gives the connector protocol a number,
makes a break a new number, and has Clew accept the new number and the one before it for a stated window, so that a
connector written outside the repository keeps working while its owner moves it. By 2026-11-18 the number had reached
3: 1 was retired at once for a security change ([D44](D44-authorized-reads-and-clew-signed-connector-authority.md)),
and 3 was a break ([D117](D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md)
item 10) that kept 2 accepted for a window. Every connector in the repository declared 3 the day it came. The
development stack still showed seven fixture connectors as "Äldre protokoll": their processes had been started before
the change and served the old manifest from memory. The warning read as work left to do, and the product owner asked
why an old number was accepted, and then why the first protocol anyone outside will see is called 3, when Clew is not
launched and nothing outside the repository runs a connector.

**Decision.**

1. **The protocol is 1, and only 1 is loaded.** `PROTOCOL_VERSION` is 1, `PROTOCOL_ACCEPTED` is `[1]`, and the
   manifest's `protocol` is the literal 1. What the records before this one call protocol 3 is this 1; their bodies are
   left as written. The earlier 1 and 2 are not kept anywhere: there is no list of retired numbers, and a manifest on
   any other number is refused, naming the number and the one this Clew loads. The published schemas carry
   `https://clew.dev/protocol/1/…` as their `$id`, and `x-clew-protocol` carries `current` and `accepted` only.
2. **The window's machinery goes.** `PROTOCOL_PREVIOUS`, `PROTOCOL_DEPRECATED`, `PROTOCOL_RETIRED`, `protocolTerms`,
   the health status `protocol-outdated` with its label "Följer ett äldre protokoll", the conformance check's warning
   and the loader rules that held a manifest on the previous number apart (no `installation`, no `assistants`, no
   plain-string rule, no `about`) are removed. A connector is sent `about` whenever the call carries one.
3. **Until the first release the protocol changes in place.** A change to the contract, breaking or not, keeps the
   number 1 and changes every connector in the repository in the same change. A connector process that still serves
   the old shape fails on what changed rather than on its number, which in the development stack is a restart away.
   From the first release D60 applies as written: a break is a new number, accepted beside the one before it for a
   stated window, and a security change retires the old number at once.

**Why.** Clew is in its lab phase and its data is disposable. Numbers and windows protect connectors outside the
repository, and there are none; what they cost is code to read and test, and a warning that hid a real problem (stale
processes) behind what read as a protocol problem. A number also tells an integrator how often the contract has broken
under them; before anyone has integrated, that is history only the repository needs, and it keeps it in its records.

**Replaces.** Nothing is superseded. It amends [D60](D60-the-instance-serves-its-connector-protocol.md) item 4 (the
numbering and the window apply from the first release on), renumbers the protocol of
[D117](D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md) item 10 to 1 and
closes its window, and removes the rules that a manifest on 2 cannot declare `installation`
([D119](D119-the-installation-reads-as-itself-through-a-read-no-person-can-reach.md) item 5) or `assistants`
([D125](D125-a-conversation-can-be-handed-to-another-systems-assistant-and-nothing-follows-the-question.md) item 1).

**Consequences.** A connector process that serves an old manifest is refused rather than warned about: restart the
stack's fixtures after a change to the protocol (`docker compose -f .devcontainer/compose.yaml restart <id> …`), then
the BFF, whose boot fetches every enabled connector's manifest and records its health over what was stored, and run
`bun run dev:connectors` only after that, since it refuses a stored manifest the loader refuses. A stored manifest is
never put live as it is: the loader and the reconciler ignore one the loader refuses, and an administrator's change to
the row does not register it (`applyLive` in `apps/server/src/connectors/usecases/admin.ts` reads it through
`parseManifest`). No migration or fallback carries old rows over. A branch or a system outside the repository that
declares `protocol: 3` (Eneo's own side of D125 is one in progress) declares 1 instead.
