# Open questions

What is undecided and who it waits for. This page is short on purpose: an item is removed in the change that settles
it, and the answer goes where it belongs (a decision record, the status page, the code). It is not a log and not a
plan. What works today is in [implementation status](../reference/status.md); which decisions bind is in
[decisions in force](../decisions/in-force.md).

Each item says when it was last stated. The items dated before 2026-11-11 were carried over from the retired handover
file as they stood there and have not been checked against the code since.

## Waiting for the product owner

| Question | Last stated | Where it comes from |
|---|---|---|
| Is the KPI surface a commitment that must be visible at a glance, or shown by exception and on demand? "Läget" assumes at a glance. | 2026-11-03 | Design review, [handover](../history/handover.md) section 4 |
| Is Göra/Hitta/Veta/Förstå a requirement on the interface, or internal framing? Clew hides it. | 2026-11-03 | Same |
| Is a read receipt a compliance record, and must "Viktigt nu" always be visible? | 2026-11-03 | Same |
| Who owns news and documents once the new intranet exists? | 2026-11-03 | Same |
| Does a view about one person count as "inside the source system" for the rule that names stay out of pushed text? | 2026-11-03 | Same |
| Notifications: read and unread, retention, and kinds other than reminders and important links. | 2026-11-05 | [D39](../decisions/D39-compact-header-profile-and-reminders.md) |
| May a person switch between several assignments, and how? | 2026-11-09 | Identity, [D68](../decisions/D68-people-are-pushed-into-clew-through-standard-scim.md) |
| May Clew hold the `protected` fact at all, and where must it stay out? | 2026-11-09 | Same |
| Which claim does the production identity provider carry for the account name (`OIDC_BINDING_CLAIM`)? | 2026-11-09 | Same |
| Are people who should not be able to sign in pushed at all? Everyone pushed gets an account. | 2026-11-09 | Same |
| Should `Actor` in protocol 2 carry the person's `externalId` or `userName`, so a connector can map the person without Clew's id? The one real product read so far knows a person by the lowercased email claim and does not read `preferred_username`, so neither candidate matches it. | 2026-11-09, evidence 2026-11-11 | Same; [the key in Frappe HR](../reviews/2026-11-11-frappe-hr-appraisals-against-the-talks-profile.md#the-key) |
| What must a system offer before it is connected? Discussed, not decided: people reach it through the installation's identity provider; the account is the same person as in Clew's directory, by a key both sides hold, created by provisioning and never on first call; the system itself enforces what each person may see; access per person is either the identity provider's token accepted for the system's own audience or a credential the system issues per user; a system with only a service account is fit for aggregate reads alone. | 2026-11-11 | [Frappe HR against the talks profile](../reviews/2026-11-11-frappe-hr-appraisals-against-the-talks-profile.md#what-it-means-for-the-two-tracks) |
| May the documentation site keep a dependency under CC0-1.0, a public-domain dedication the OSI has not approved? `@iconify-json/simple-icons` is installed with VitePress and cannot be left out; nothing from it is in the built site. | 2026-11-11 | [D106](../decisions/D106-the-documentation-site-is-vitepress-over-docs-as-it-is.md), [licence record](../reference/licences.md) |
| Should Personal say which unit a person who reports from below leads? The role column that said "Chef för …" (D99, the organisation tree) left when the page became source-drawn (D97); the person is listed, the unit is not named, and a source may now be asked about them. | 2026-11-11 | [Personal](../reference/status/people.md#personal), [D99](../decisions/D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md) |
| How should the panel beside the page appear: in place with no motion (as it stands since 2026-11-11), as Astryx's non-modal `Drawer` that slides over the page, or with the region's own slide once Astryx can keep a folded handle inside its container? And is the fold button with its empty panel still wanted? | 2026-11-11 | [The panel against what Astryx ships](../reviews/2026-11-11-the-panel-beside-the-page-against-what-astryx-ships.md), [D63](../decisions/D63-hem-is-drawn-as-the-canvas-draws-it.md) item 14 |
| How far may the assistant act alone, and who sets the level? The direction is chosen, the governance is not designed. | 2026-11-10 | [D104](../decisions/D104-the-model-does-the-work-a-floor-holds-without-it-and-the-assistant-may-act-alone-within-limits.md) |
| May the competence domain (D108) pass the freeze on new surface, or does it wait until the first real integration works? It was built on a branch cut before the freeze reached `main`, and is proposed, not accepted. | 2026-11-11 | [D108](../decisions/D108-competence-is-an-owned-domain-one-holding-typed-against-a-catalogue.md), [D101](../decisions/D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md) |
| D108 makes competence a core domain although checklist questions 3 and 4 are not a plain yes, copies what sources hold as a cache against D97's weighed alternative, and puts a position on the person against D97 item 9. Are those three accepted? | 2026-11-11 | [D108](../decisions/D108-competence-is-an-owned-domain-one-holding-typed-against-a-catalogue.md) |
| For competence before real data: how long a holding is kept after a person is deactivated, the secrecy rule, what a new manager may read of earlier holdings, and a review by an HR practitioner (checklist questions 6 and 11). | 2026-11-11 | Same |

## Records whose status needs a look

The [digest](../decisions/in-force.md) lists eight records as `proposed`. Several describe things that have since been
built or replaced, so the status no longer says what is true. Each needs the owner's word before its first word
changes: [D18](../decisions/D18-errands-are-a-clew-owned-passthrough-domain.md),
[D19](../decisions/D19-change-notification-is-a-clew-owned-contract.md),
[D26](../decisions/D26-questions-over-documents-are-search-not-knowledge.md),
[D37](../decisions/D37-connectors-declare-what-they-use-and-a-capability-name-is-its-contract.md),
[D55](../decisions/D55-a-job-is-assembled-from-what-connectors-follow-approved-once-and-run-per-system.md),
[D82](../decisions/D82-sick-leave-statistics-come-through-an-absence-connector-that-reads-only-aggregates.md),
[D87](../decisions/D87-one-header-shared-by-the-portal-and-the-intranet.md) and
[D99](../decisions/D99-an-unresolved-job-step-reaches-a-person-and-is-finished-forward.md).

## Before the freeze on new surface lifts

[D101](../decisions/D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md)
holds new surface until the first real integration works end to end. What remains is listed in the
[Nextcloud Approval entry](../reference/status/connectors.md#nextcloud-approval) of the implementation status; it is not
repeated here.

## Accessibility

No manual screen-reader pass has been made on any flow (stated in the project review of 2026-11-10 and on the status
page). The calendar's time grid is not a WAI-ARIA grid; the list in the panel and the dialogs are the accessible path
(2026-11-04, [D32](../decisions/D32-one-calendar-family-and-the-persons-own-bookings.md)).
