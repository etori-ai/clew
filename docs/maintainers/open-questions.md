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
| Is a read receipt a compliance record? (Whether it must stay visible was settled by [D112](../decisions/D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md), amended: Fokusnyhet stands on Hem until the receipt is given and has no dismiss.) | 2026-11-03, narrowed 2026-11-11 | Same |
| Who owns news and documents once the new intranet exists? | 2026-11-03 | Same |
| Does a view about one person count as "inside the source system" for the rule that names stay out of pushed text? | 2026-11-03 | Same |
| Notifications: read and unread, retention, and kinds other than reminders and important links. | 2026-11-05 | [D39](../decisions/D39-compact-header-profile-and-reminders.md) |
| May one installation hold several organisations? One is what is supported today ([D101](../decisions/D101-a-provisioner-pushes-the-organisation-first-and-adds-before-it-removes-and-a-unit-belongs-to-one-organisation.md) item 5). The SCIM server and the capability mapping keep two apart; connector audiences, which name a group by its `externalId`, and the connector registry do not know of organisations at all. | 2026-11-11 | Identity, [the full SCIM review](../reviews/2026-11-11-scim-full-review.md) |
| How is a person bound to a new account when the identity provider has replaced the old one? The sign-in is refused (`identity-conflict`) and nothing in Clew, no page and no script, removes or replaces a binding. | 2026-11-11 | Same |
| May a person switch between several assignments, and how? | 2026-11-09 | Identity, [D68](../decisions/D68-people-are-pushed-into-clew-through-standard-scim.md) |
| May Clew hold the `protected` fact at all, and where must it stay out? | 2026-11-09 | Same |
| Which claim does the production identity provider carry for the account name (`OIDC_BINDING_CLAIM`)? | 2026-11-09 | Same |
| Are people who should not be able to sign in pushed at all? Everyone pushed gets an account. | 2026-11-09 | Same |
| Should `Actor` in protocol 2 carry the person's `externalId` or `userName`, so a connector can map the person without Clew's id? The one real product read so far knows a person by the lowercased email claim and does not read `preferred_username`, so neither candidate matches it. | 2026-11-09, evidence 2026-11-11 | Same; [the key in Frappe HR](../reviews/2026-11-11-frappe-hr-appraisals-against-the-talks-profile.md#the-key) |
| What must a system offer before it is connected? Discussed, not decided: people reach it through the installation's identity provider; the account is the same person as in Clew's directory, by a key both sides hold, created by provisioning and never on first call; the system itself enforces what each person may see; access per person is either the identity provider's token accepted for the system's own audience or a credential the system issues per user; a system with only a service account is fit for aggregate reads alone. | 2026-11-11 | [Frappe HR against the talks profile](../reviews/2026-11-11-frappe-hr-appraisals-against-the-talks-profile.md#what-it-means-for-the-two-tracks) |
| When a person loses access to what a card was about, may its title stay in Sedan i går and under Klart, and is it "klart"? Two files a person could no longer reach were listed there by name as done; D101 asks that such a person "sees none", and the cards themselves were gone. | 2026-11-11 | [The second signed-in pass](../reviews/2026-11-10-what-the-first-real-integration-showed.md#the-second-signed-in-pass-2026-11-11) |
| May the documentation site keep a dependency under CC0-1.0, a public-domain dedication the OSI has not approved? `@iconify-json/simple-icons` is installed with VitePress and cannot be left out; nothing from it is in the built site. | 2026-11-11 | [D106](../decisions/D106-the-documentation-site-is-vitepress-over-docs-as-it-is.md), [licence record](../reference/licences.md) |
| Should Personal say which unit a person who reports from below leads? The role column that said "Chef för …" (D99, the organisation tree) left when the page became source-drawn (D97); the person is listed, the unit is not named, and a source may now be asked about them. | 2026-11-11 | [Personal](../reference/status/people.md#personal), [D99](../decisions/D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md) |
| How should the panel beside the page appear: in place with no motion (as it stands since 2026-11-11), as Astryx's non-modal `Drawer` that slides over the page, or with the region's own slide once Astryx can keep a folded handle inside its container? And is the fold button with its empty panel still wanted? [D112](../decisions/D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md) item 7 says the panel is always about a thing, but the fold button still shows it empty. | 2026-11-11 | [The panel against what Astryx ships](../reviews/2026-11-11-the-panel-beside-the-page-against-what-astryx-ships.md), [D63](../decisions/D63-hem-is-drawn-as-the-canvas-draws-it.md) item 14 |
| Where does a card's read that is a table open? Every other read unfolds inside the card (D111, amended); `hr.leaveRequests` ("Se i personalsystemet" on leave requests) is a table that does not fit there, so it still takes the card's place in the panel (`unfoldsInCard()` in `apps/web/src/components/card-read.tsx`). | 2026-11-11 | [D111](../decisions/D111-where-something-opens-is-decided-by-what-it-is.md) |
| Administration draws the panel only as the drawer over the page, never beside it: its pages have no narrow layout to give way to. Is that acceptable under "the same panel on every page"? (Kalender holds the panel beside the grid since D112 item 9.) | 2026-11-11 | [D111](../decisions/D111-where-something-opens-is-decided-by-what-it-is.md) |
| May the box beside a person's or a unit's page tell the model who the page is about? What a source says about an entity never reaches the model (D97 item 7), so "Fråga Clew" there sends the question with no data attached, not even the name, and the model knows only what the one asking writes. | 2026-11-11 | [D112](../decisions/D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md) item 7, [the panel](../reference/status/interface.md#the-panel-and-the-assistant-beside-a-thing) |
| Should a person answer an invitation from Kalender? The board draws "Ändra mitt svar …" on a meeting someone else organises; the calendar contract (D11) has no reply of the invitee's own, and neither calendar source exposes the invitee's answer to Clew, so the panel draws no button and does not say what the person answered. | 2026-11-11 | [D112](../decisions/D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md) item 9, [the calendar page](../reference/status/calendar.md#the-calendar-page) |
| May a write's free-text answer be kept in the audit row as written? The decision puts every answer of the action dialog into `execution.approved` `details.asked` (seen live: "Meddelande till medarbetaren" stored word for word with the booked talk), so whatever a source lets a person type, a sensitive word included, is in the audit log for as long as it is kept, and no erasure script reaches it. | 2026-11-11 | [D112](../decisions/D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md) item 10, [what a write asks](../reference/status/protocol.md#what-a-write-asks-and-what-it-says-it-will-do) |
| Should "Fråga om veckan" tell the model which range is on screen? It sends the calendar's week read as its chip, so a week, a day or a month other than the current one is not named and the model reads the current week through its tool. | 2026-11-11 | [D112](../decisions/D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md) item 7, [the panel](../reference/status/interface.md#the-panel-and-the-assistant-beside-a-thing) |
| Is the thing scrolling with the transcript in the panel acceptable (D112 gap 10)? The board Calendar draws the thing fixed above the conversation; `ChatLayout`'s panel view has no slot for it, so the thing is the first child of the message area and scrolls away in a long exchange, its title and buttons kept in view by folding its facts. | 2026-11-11 | [D112](../decisions/D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md) Astryx gaps |
| Where do "Mina ärenden", the person's own action points and "Sedan i går" belong? No board draws them; they stand on Hem under Verktygslådan with their earlier components until one does. | 2026-11-11 | [D112](../decisions/D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md), amended, items 6 and 7 |
| Should a tool's page draw a view that no administrator placed in the person's menu? "Alla nyheter" (`/tools/clew.news`) is drawn by its own page, `pages/news.tsx`, a copy of the tool page's composition in `pages/tool.tsx`, because `/tools/:capability` answers only for a view in the menu. | 2026-11-11 | [D112](../decisions/D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md), amended, item 2 |
| Does the vision's line on editorial content still hold? `docs/vision.md` says editorial content "can appear as a card with a link; it is not authored here"; since D112 (amended) news comes as rows from a news source's `<id>.news`, on Hem and as Alla nyheter, still authored elsewhere. Amend the line, or keep it as written? | 2026-11-11 | [Vision](../vision.md), [D112](../decisions/D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md), amended, item 3 |
| On a phone, is the panel a sheet or the end drawer? D112 item 12 says a sheet; it is built as Astryx's end `Drawer`, full height with the page showing at its edge, as on every narrow window. | 2026-11-11 | [D112](../decisions/D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md) item 12, [Interface spaces](../reference/interface-spaces.md#widths) |
| Does the amendment to D6 stand? The development sign-in was built as a list of personas through the local Keycloak's password grant, not as the accepted form that mints a session without Keycloak. | 2026-11-11 | [D6](../decisions/D06-dev-login-local-only.md) |
| How far may the assistant act alone, and who sets the level? The direction is chosen, the governance is not designed. | 2026-11-10 | [D104](../decisions/D104-the-model-does-the-work-a-floor-holds-without-it-and-the-assistant-may-act-alone-within-limits.md) |
| The competence domain (D108) is on `main` although the freeze on new surface holds: it was built on a branch cut before the freeze reached `main` and brought in on 2026-11-11 without the product owner's word. May it stay, switched off as it is, or is it taken out until the first real integration works? | 2026-11-11 | [D108](../decisions/D108-competence-is-an-owned-domain-one-holding-typed-against-a-catalogue.md), [D101](../decisions/D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md) |
| D108 makes competence a core domain although checklist questions 3 and 4 are not a plain yes, copies what sources hold as a cache against D97's weighed alternative, and puts a position on the person against D97 item 9. Are those three accepted? | 2026-11-11 | [D108](../decisions/D108-competence-is-an-owned-domain-one-holding-typed-against-a-catalogue.md) |
| For competence before real data: how long a holding is kept after a person is deactivated, the secrecy rule, what a new manager may read of earlier holdings, and a review by an HR practitioner (checklist questions 6 and 11). | 2026-11-11 | Same |
| The follow-up dialogue (D118) before real data: are its assessments and activities public documents, how long are they kept and archived, and what happens to big-boss-board's database at shutdown (checklist question 6)? Have the people who run the dialogue today seen it (question 11), and does the team accept being its vendor (question 12)? | 2026-11-13 | [D118](../decisions/D118-the-follow-up-dialogue-is-an-owned-domain.md) |
| Is following up by reporting line enough for the municipal director's office, which in big-boss-board sees every organisation, or does a staff function need a capability that reaches further? | 2026-11-13 | Same |
| Which API answers the key figures (D119), and how do Clew's units map to its units? Until then only the Qlik connector's fixture answers, and whether `connectors/qlik` is rebuilt for the profile or withdrawn follows from it. | 2026-11-13 | [D119](../decisions/D119-key-figures-per-unit-come-through-one-vendor-neutral-profile.md) |
| Does the key-figure source answer closed months, or must a connector store the series (health aggregates at rest, an impact assessment with the data protection officer)? | 2026-11-13 | Same |
| Are key figures per unit public information? If not, a connector must check that the reader may see each unit's figures (data protection officer, HR). | 2026-11-13 | Same |
| Who delivers the employee survey's HME report, and in which format, once big-boss-board is gone (HR)? | 2026-11-13 | Same |
| May the key-figure profile, its measure list and `clew.keyFigures` be built before the freeze lifts (D101)? | 2026-11-13 | Same |

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

Att göra's reading pane opens past the item's title on a wide screen: the pane is Astryx's `ChatLayout`, which scrolls
to its latest message and has no setting to open at the top, so the title and "Jag har läst" sit above the fold until
the person scrolls up (app critique, 2026-11-13). Whether Astryx gains such a setting, or the pane stops being a
`ChatLayout`, is undecided; nothing custom is built against it.
