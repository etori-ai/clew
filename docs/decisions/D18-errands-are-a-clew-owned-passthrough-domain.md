# D18 · Errands are a Clew-owned pass-through domain; SupportManagement is the first adapter

**Status:** proposed, hosting shape replaced by D35, identity replaced by D89 (2026-11-09) · **Date:** 2026-11-04 · **Area:** integrations

**Decision.** An errand (ärende) is a first-class Clew *concept* and a *pass-through* module kind (D3),
never core. Clew owns the contract: an `ErrandProvider` interface and model in `packages/errands`, modelled
on `packages/calendar`, with a ref scheme `errand:<adapter>:<municipalityId>:<namespace>:<id>`, an `errand`
object type for items, chips and search results (D12), and capabilities at domain granularity
(`errand.mine`, `errand.reported`, `errand.search`, `errand.view` as reads; `errand.draftReply` as a propose;
`errand.acknowledge`, `errand.takeOver`, `errand.park`, `errand.setStatus`, `errand.addNote`,
`errand.reply`, `errand.watch` as executes with `model: false`). The module is wrapped in
`apps/server/src/errand-module.ts` and registered like the calendar.

One adapter per case system, selected per configured source. The first is `sm` for Sundsvall's
`api-service-support-management` (MIT); the second is `casedata` for `api-service-case-data`, which proves
the contract the way `microsoft365` does for the calendar (D11). A municipality without a case system
configures no adapter and the module is empty.

The record stays in the case system. Clew stores the ref, the errand version seen when a proposal was
drawn, the notification ids acknowledged, the audit row and the receipt. Cards are composed from
non-personal fields only: errand number, category and type display names, status display name, what is
waiting and since when. Free-text title, description and stakeholders are read live for the side panel and
never written to `thread.title` or `thread.summary` (principle 7; stricter than the mock modules).

Every execute re-reads the errand, sends `If-Match` with the version seen, and reads the result back for the
receipt; a 412 means the errand changed and the card is redrawn. Communications sent to a stakeholder have
no undo and the card says so. Clew's "bevaka" on an errand uses the source's own subscription mechanism
where one exists and polls through the adapter where none does; Clew keeps no second subscription store.

Identity reaches dept44 services as **a service credential with asserted identity**: the adapter runs in
`service` mode behind the WSO2 gateway, Clew's `scope` rule narrows every call to the person's own account,
group and namespaces, and the adapter sets `X-Sent-By: type=adAccount; <ad account>` from the person's AD
account, as Draken does today. The AD account comes from the IdP claim verified at login and is the first
column of the identity mapping table designed in `working-across-modules.md`. The source enforces its own
per-user access and `GET …/errands/{id}/access` decides which buttons a card shows. The asserted-identity
risk (the BFF credential can act as any AD user at the gateway) is accepted for now and is to be removed by
the gateway accepting exchanged user tokens (RFC 8693), a dept44 change outside this repository.

**Why.** `docs/reviews/2026-11-04-support-management-integration-review.md`. The vision's ladder asks who
owns the record: the case system does, by law and by "not a case system", so core is ruled out; what Clew
owns around an errand (thread, reminder, watch, audit, receipt) is already core. The concept is shared: two
errand systems in Sundsvall with the same shape and one Draken UI, other systems in other municipalities,
and every employee is the reporter of some errand, so the reporter side reaches every persona. A
`supportmanagement` module with its own vocabulary would have to be rebuilt for CaseData and again for the
next municipality. SupportManagement already has what the scan needs (notifications per AD owner,
assignee and group, suspensions, `dueAt` on investigations, decisions, statements and measures,
subscriptions), per-errand access reporting, optimistic locking and a link-out from namespace `baseUrl`,
so the adapter is thin; asking it to implement `ErrandProvider` natively (D10 first path) would couple a
shared API to Clew for no gain. Its 30 000-line OpenAPI document is the textbook case for D2.

**Replaces.** Nothing. Adds a row to the Sundsvall landscape in `integration-paths.md` and makes the
identity mapping table a near-term need rather than a design.
