# D144 · A connector's manifest goes live only when an administrator approves it

**Status:** provisional (the product owner, 2026-11-23, set the order of work that fixes the review of 2026-11-23 and left this choice to the team: a municipality reviews what another system may read through Clew and whose token it is handed before it happens; tested by nothing outside the repository yet) · **Date:** 2026-11-23 · **Area:** integrations

**Decision.** A remote connector's manifest decides which capabilities exist, which of other systems' reads the
connector may call back through Clew as the person (`uses`), and whether it is handed the person's own token and for
which audience (`delegation`). The service that serves the manifest does not decide when that changes: an
administrator does, after seeing the change.

1. **The approved manifest.** A connector's row holds the manifest an administrator approved, and it is the only one
   the registry registers. It is set when the connector is added (the draft goes live only when an administrator
   enables it, D23), when an administrator approves a change, and by the operator's `bun scripts/connector-add.ts`,
   each with its audit row. Nothing else replaces it: not a boot, not "Testa anslutning", not the five-second
   reconciler, not enabling a draft. A bundled connector's description is its code, reviewed with the code, and still
   moves with the build.
2. **A changed manifest is offered, never live.** When the service serves a manifest that differs from the approved
   one, at a boot, on "Testa anslutning" or on "Läs in igen från systemet", Clew stores it beside the approved one as
   offered, with the instant it was first seen, and changes nothing live. The served manifest is compared with the
   approved one in the same write that stores it, so an approval made meanwhile is seen. The same offer seen again
   keeps its instant; a service that serves the approved manifest again takes the offer away. Clew reads the manifest
   at those moments only and polls no service. A change that only narrows waits too: one
   rule, and every manifest that was live is in the history. Meanwhile a capability the service has removed answers
   as unavailable.
3. **The connector's page says so and shows what matters.** A banner on the connector's page says a change waits and
   opens its review, and "Testa anslutning" says it where the administrator is. The review lists, beside the
   capabilities and areas added and removed, each one changed with the fields that changed in it (a widened `scope` or
   area `roles` is named), the reads of
   other systems the connector would now or would no longer call back as the person, the audience whose token it would
   be handed before and after, and every other field of the manifest that changed, by name. The page's Översikt shows
   what the approved manifest reads through Clew and whose token it is handed today. The audit row of an approval,
   `connector.manifest`, records the same; the row of an addition records what was approved with it.
4. **Approving is bound to what was shown.** "Använd det nya" names the offer it showed by the instant it was first
   seen. Clew applies the stored offer, never a new fetch, in one write that holds only while that offer, the same
   instant and the same content, is still the stored one, and refuses when another has taken its place or none is
   left. The session is checked again before the write, as for every administration change.
5. **A draft without a manifest is not enabled.** Enabling approves nothing, on the page or from
   `connector-add.ts --enable`: an administrator reads the manifest in from the system and approves it first. Adding
   approves what the service serves then, and so does checking again while adding, since the draft is not live; the
   wizard's summary names what it reads and whose token it gets before it is switched on.
6. **A source's assistant reads nothing back.** A question handed to another system's assistant
   ([D125](D125-a-conversation-can-be-handed-to-another-systems-assistant-and-nothing-follows-the-question.md))
   carries no callback grant, whatever the connector's `uses` say, and nor does the read that lists the assistants,
   which Clew makes before a question is sent and again for each question; so nothing is read back through Clew
   while it is answered. The connector's other reads still call back exactly the approved `uses`.

**Why.** The review of 2026-11-23 found that a connector's own service decided what it may read through Clew and
whose token it gets: a manifest served at boot, on "Testa anslutning" or when a draft was enabled was stored and live
within seconds, with no audit row and nobody's decision, and the reviewed refresh showed none of it (findings `CB-1`,
`CB-3`, `DE-H1` and `AM-11` in [the register](../maintainers/open-findings.md) of that day). For a municipality the
question "may the vendor's service now read the HR rows of the people this manager manages, as the manager?" is a
decision someone must be able to point to. Holding only widening changes back was weighed and left: it needs a
classification of every field that is easy to get wrong, and an administrator who approves every change knows what
is live. That a removed capability fails until approval is the lesser harm, and the banner says why.

For item 6, D125 item 4 already holds that only the person's text leaves Clew in a handed-over turn; a source's
assistant reading the person's calendar back while it answers would be more leaving by another door.

**Replaces.** Nothing. Amends [D23](D23-connectors-are-managed-in-the-database.md) (a manifest change is an
administration change, audited and approved), the "Not held back" and "Boot" bullets of
[D37](D37-connectors-declare-what-they-use-and-a-capability-name-is-its-contract.md) item 4, which is proposed and
was never built (a changed manifest waits instead of going live), and
[D125](D125-a-conversation-can-be-handed-to-another-systems-assistant-and-nothing-follows-the-question.md) item 4
(no callback during an answer).
