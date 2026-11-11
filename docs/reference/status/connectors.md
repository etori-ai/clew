# Implementation status: connectors in this repository

One page of [implementation status](../status.md). Each entry says what works in this checkout, what limits it or is still to do, and where the code and tests that show it are.

## Fixture connectors

**Works in this checkout.** Six generic systems (HR, economy, deviations, communication, time reporting, payroll) as independent services behind the protocol under `connectors/`, run by the development stack, registered by `bun run dev:connectors`, run in-process by the unit suites; writes deduplicated by the operation id with read-back, fault switches, id maps.

**Limits and pending work.** Fixtures, not real systems: no vendor API and no real identity mapping. HTTP process tests cover lost-response recovery, restart, undo and the HR/payroll feed. Bootstrap preserves existing governance; reset explicitly retires old work. The destructive live-stack reset is a separate operator check.

**Evidence.** [hr](../../../connectors/hr/README.md), [helper](../../../tests/fixture-connectors.ts), [HTTP proof](../../../apps/server/tests/fixture-runtime.test.ts), [reset proof](../../../tests/db/fixture-maintenance.test.ts), [D61](../../decisions/D61-fixture-sources-are-independent-connectors.md)

## Phone book

**Works in this checkout.** Fixture, assumed HTTP adapter, search, views and protected-record filtering.

**Limits and pending work.** Real directory API and identity mapping must be confirmed; this is not a certified Metakatalogen connector.

**Evidence.** [Adapter](../../../connectors/phonebook/directory.mjs), [tests](../../../tests/unit/phonebook-connector.test.ts)

## Sick-leave statistics

**Works in this checkout.** `connectors/qlik`, the Qlik connector ([D82](../../decisions/D82-sick-leave-statistics-come-through-an-absence-connector-that-reads-only-aggregates.md)): rates per unit and month for managers as table views and an area figure, aggregates only, a minimum group size held back in the connector, a fixture and a Qlik Engine API adapter.

**Limits and pending work.** Never run against a real Qlik; field names, closed months, the WebSocket CSRF rule and licence are unverified. No client certificates or renewing token. The figure is drawn on Läget through D54.

**Evidence.** [Connector](../../../connectors/qlik/connector.mjs), [Qlik adapter](../../../connectors/qlik/engine.mjs), [tests](../../../tests/unit/qlik-connector.test.ts)

## Errands

**Works in this checkout.** Same-connector card action rule. The list profile `<id>.errands` (`ErrandRow` with a shared `state` and an `area` label, in the protocol's `$defs`) and the combined list `clew.errands` ([D89](../../decisions/D89-an-errand-connector-acts-as-the-person-and-the-case-system-decides-access.md)): every case system in the person's scope asked at once under a budget, the rows ordered by state across systems, each row opening in its own system, the systems that did not answer named, offered only to a person with a case system; one area, one menu hint and one model tool whatever the number of systems. `connectors/supportmanagement` (id `sm`): a person's errands (`sm.errands`, assigned or reported) and one errand in the panel (`sm.errand`, never a tool), read with the person's delegated token; a fixture that applies its own access rule from the token, and an API adapter. On Hem the combined list is a section "Mina ärenden" after the day's work for a person with a case system ([D90](../../decisions/D90-mina-arenden-is-a-section-on-hem.md)): the first five rows, the rest in place, a row opening its errand beside the page.

**Limits and pending work.** The API adapter has not met a SupportManagement: `errands/mine`, user tokens and access decided in the API are requirements on SupportManagement, its gateway and the identity provider ([connector README](../../../connectors/supportmanagement/README.md)). No scan (a scan carries no delegated token), so no errand cards on Hem. A card on demand, errand search, writes and a CaseData connector are not implemented. The section on Hem is a read, not cards: it is not counted in Behöver dig or Lugnt läge, and the design canvas has no errand section to compare it with. The `sm` connector is registered by hand, not by the development stack's bootstrap. No screen-reader pass.

**Evidence.** [D35](../../decisions/D35-errands-are-a-connector-profile-and-a-card-is-one-systems.md), [module](../../../apps/server/src/modules/errands/usecases.ts), [connector](../../../connectors/supportmanagement/connector.mjs), [unit tests](../../../tests/unit/errands.test.ts), [connector tests](../../../tests/unit/supportmanagement-connector.test.ts), [browser evidence](../../../tests/a11y/views.spec.ts), [Hem section](../../../tests/a11y/errands.spec.ts)

## Nextcloud Approval

**Works in this checkout.** `connectors/nextcloud-approval` (D101, provisional): the first connector to a product that was not written for Clew. It acts as the person with a token exchanged for the audience `nextcloud`, checks that the token's Nextcloud account is the actor Clew named, and holds no service credential. Reads: what waits for me (table) and one file's approval state (detail). A scan gives one card per waiting file; Godkänn and Avvisa are executes on the `manual` strategy whose receipt is the state read back from Nextcloud. The development Nextcloud ships `user_oidc` and `approval`, seeded by `sh scripts/calendar.sh seed`. The loop (visit, scan, card, decision, dispatch with the person's token, receipt, audit) passes on the memory adapters and has run through the same use cases against the real Nextcloud and Keycloak for two people.

**Limits and pending work.** Signed in on the development stack on 2026-11-11 as one person (Hillevi): the visit's scan gave her three cards, Godkänn and Avvisa each gave a receipt on Hem, and Nextcloud's own records and Clew's audit rows agree. Registered by hand, not by the development bootstrap. Not yet looked at as a second person or after access was taken away on the page (both shown through the use cases and the recorded exchanges only); no screen-reader pass; the MCP build and the comparison D101 asks for are not started, so the freeze stands. A card is stuck after a failed decision until it is dismissed (any connector). No message with a rejection; a lost answer after dispatch stays unknown; group or circle approvers, group folders and more than fifty files in one read are untried. The running calendar container must be recreated once to reach Keycloak by its compose entry.

**Evidence.** [D101](../../decisions/D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md), [findings](../../reviews/2026-11-10-what-the-first-real-integration-showed.md), [connector](../../../connectors/nextcloud-approval/README.md), [recorded exchanges](../../../connectors/nextcloud-approval/samples/README.md), [connector tests](../../../tests/unit/nextcloud-approval-connector.test.ts), [loop test](../../../tests/unit/approval-loop.test.ts)
