# Personas and use cases

Carried over from the startsidan repository (`docs/11-personas-and-use-cases.md`, 35 use cases, 2026-09)
on 2026-11-03 so that Clew's design ideas are validated against the same people. The text below is the
original, unchanged except for this header. Use case ids (`UC-<persona>-<n>`) are stable and are cited on the
design canvas and in `docs/decisions/`.

## How the personas map to Clew

Clew's synthetic accounts are `hillevi` (rektor, manager) and `hassan` (undersköterska, employee), chosen
for the school use case. They are the same archetypes as startsidan's Kim and Fatima:

| Clew account | Startsidan persona | Use cases to validate against |
|---|---|---|
| `hillevi`, rektor | **Kim**, enhetschef hemtjänst: own unit, individuals, approvals | UC-KIM-1 to UC-KIM-8 |
| `hassan`, undersköterska | **Fatima**, undersköterska: own shift, leave, phone first | UC-FATIMA-1 to UC-FATIMA-5 |
| not provisioned | **Johan**, förvaltningschef; **Eva**, kommundirektör: aggregates, never individuals | UC-JOHAN-1 to 3, UC-EVA-1 to 3 |
| not provisioned | **Lena**, HR-partner: several units by assignment, nobody's manager | UC-LENA-1, UC-LENA-2 |
| not provisioned | **Omar**, new employee; **Mikael**, operator; **Petra**, non-municipal manager | UC-OMAR-1, UC-MIKAEL-1 to 5, UC-PETRA-1 to 2 |

Every design artboard on the canvas should say which use cases it covers and which it does not. The
mission-control row (2026-11-03) is validated in its orange sticky note; the open gaps are UC-KIM-5 (acting
manager), the aggregated views for Johan and Eva, and the operator view for Mikael.

---


Each use case has: trigger, what happens, data involved, and what it exercises in the design. Ids are stable (`UC-<persona>-<n>`) for use in ADRs and tests.

The 2026-09-16 source review adds six use cases for the product commitments in B18–B21, bringing the total to 35. Their acceptance remains pending; [30](30-assisted-workflows-and-product-scope.md) records the selected bounded document workflow as the next synthetic slice.

## Persona overview

| Persona | Role | Scale of view | Device | Primary need |
|---------|------|---------------|--------|--------------|
| Eva | Kommundirektör (CEO) | Whole organisation, aggregated | Laptop, phone | Trend and deviation, never individuals |
| Johan | Förvaltningschef (department head, socialförvaltningen) | One department, ~1 200 staff, several levels | Laptop | Aggregates plus escalated decisions |
| Kim | Enhetschef (unit manager, hemtjänst, 32 staff) | Own unit, individuals | Laptop, phone | Staffing today, follow-ups, approvals |
| Alex | Handläggare (case officer, bygglov) | Own cases | Desktop | Deadlines, inbound documents, calendar |
| Fatima | Undersköterska (care worker, hemtjänst) | Own schedule and balances | Phone, shared tablet | Today's shift, leave, quick errands |
| Lena | HR-partner for socialförvaltningen | Several units, not their manager | Laptop | Rehab cases, absence patterns, onboarding |
| Omar | New employee, week one (IT support) | Own onboarding | Laptop | Checklist, people, mandatory training |
| Mikael | Systemförvaltare / operator of Startsidan | Configuration for the whole organisation | Desktop | Build pages, connect data, stay compliant |

| Petra | Produktionschef, mid-sized manufacturing company (non-municipal) | Two plants, ~200 staff | Laptop, shop-floor screen | Same needs as Kim and Johan, different vocabulary and systems |

Elected officials (nämndpolitiker) are out of scope for now but noted as a future persona.

---

## Eva, kommundirektör

Runs a municipality of ~9 000 employees. Wants to open one page in the morning and know where things deviate. Must never see individual employees' health data; has no legal basis for it.

### UC-EVA-1 · Sick leave trend per department
- **Trigger:** Monday morning, before ledningsgrupp.
- **Flow:** Opens Startsidan. A KPI row shows total sjukfrånvaro % for the last 30 days versus same period last year. A chart block shows the trend per förvaltning for 24 months. Clicks a department to see the trend per enhet, still aggregated.
- **Data:** HR absences (sensitive-personal), org structure, headcount. Aggregated to unit level with a minimum group size.
- **Exercises:** Separate reviewed edge-aggregate history (Tier 2), approved periods/dimensions and suppression, aggregate-only access, org tree traversal; availability depends on a source-side feed.

### UC-EVA-2 · Budget deviation and forecast
- **Trigger:** Same morning.
- **Flow:** KPI block: prognosavvikelse total and top three deviating units. Table block: units sorted by deviation with a trend sparkline.
- **Data:** Economy system (budget, outcome, forecast per kostnadsställe), org mapping of kostnadsställe to unit.
- **Exercises:** A join between two systems on `orgunit.id` where the economy system uses kostnadsställe ids; identity resolution for org units, not persons.

### UC-EVA-3 · Delegated view for the executive assistant
- **Trigger:** Eva's assistant prepares the ledningsgrupp agenda.
- **Flow:** The assistant sees the same aggregated page, without approval actions.
- **Data:** Same as above.
- **Exercises:** Targeting a page to a group ("ledningsstöd") that is not a manager role; visibility rules per block instance (actions hidden).

---

## Johan, förvaltningschef

Department with four verksamhetsområden and ~60 enhetschefer under them. Needs aggregates most of the time and individuals only when something is escalated.

### UC-JOHAN-1 · Escalated approvals
- **Trigger:** A leave request over 30 days, or a purchase over the unit manager's limit, escalates.
- **Flow:** "Att agera på" shows the item with source, deadline and a one-click approve or a link to a focus flow. After approval the item disappears everywhere.
- **Data:** HR leave requests, purchase system; both push action items.
- **Exercises:** Action item contract (9) from two sources, dedupe, resolution events, write-back to the source system.

### UC-JOHAN-2 · Absence pattern across two levels of managers
- **Trigger:** Quarterly follow-up with verksamhetschefer.
- **Flow:** Table per verksamhetsområde and per enhet, aggregated. Johan can drill to a unit but not to persons.
- **Data:** HR absences, org tree.
- **Exercises:** "Manager of, transitively" in row policies; aggregate-only for sensitive data above the direct-manager level.

### UC-JOHAN-3 · Nämnd calendar and documents
- **Trigger:** Two days before socialnämnden.
- **Flow:** Side block: upcoming nämnd meetings with links to handlingar. Action row: "Föredragning to prepare".
- **Data:** Meeting system (e.g. Ciceron or Meetings Plus), calendar.
- **Exercises:** Live dataset (Tier 3) with context `person.id`; a domain block with links; a connector against a proprietary system written by a vendor under the Apache-2.0 SDK.

---

## Kim, enhetschef hemtjänst

32 employees, shift-based, high absence, many short-term substitutes. The manager the operator asked about in the days-off example.

### UC-KIM-1 · Who is at work today
- **Trigger:** 06:45, before the morning meeting.
- **Flow:** Block: today's staffing for the unit with planned shifts, reported absences, and unfilled shifts highlighted. Link to the scheduling system to fill a gap.
- **Data:** Scheduling system (shifts), HR absences reported today, substitute pool.
- **Exercises:** Live datasets joined on `employment.id` with validity/date context; freshness under one hour; row policy "direct reports"; phone layout.

### UC-KIM-2 · Days off per employee, last twelve months
- **Trigger:** Preparing a medarbetarsamtal, or noticing a pattern.
- **Flow:** A table block built by the operator or an agent: per employee, total days by type (semester, vab, sjuk), number of periods. Sorted by sick periods. Employees with six or more short sick periods in twelve months are flagged since that triggers a rehabiliteringsutredning obligation.
- **Data:** HR absences from the HR system, absences from the timekeeping system for hourly substitutes (two datasets, unioned).
- **Exercises:** The view DSL end to end: union with canonical absence deduplication and unit agreement, temporal many-to-one employment join, group by person, measures, time window, dataset policy supplying current manager/acting scope; classification sensitive-personal; a derived flag in the view.

### UC-KIM-3 · Approve leave requests
- **Trigger:** Fatima applies for two weeks in July.
- **Flow:** Action row "3 ledighetsansökningar att hantera". Opens a focus flow that shows the request, who else is off in the same period, and the staffing impact. Approve or reject with a comment. The HR system is updated.
- **Data:** HR leave requests, schedule.
- **Exercises:** Write-back to a source system through a connector; focus flow; action item lifecycle.

### UC-KIM-4 · Expiring certificates and delegations
- **Trigger:** Monthly.
- **Flow:** List block: employees whose delegering (medication delegation from a nurse), körkort or mandatory training expires within 60 days.
- **Data:** Delegation register (healthcare system), training system (LMS), HR.
- **Exercises:** Three sources joined on `person.id`; a view where the operator defined "within 60 days"; targeted only to units in vård och omsorg.

### UC-KIM-5 · Kim is on vacation, Sara steps in
- **Trigger:** Kim is away three weeks; Sara, enhetschef of a neighbouring unit, is ställföreträdare.
- **Flow:** Sara sees Kim's approvals and staffing blocks for the period, clearly labelled as acting for Kim. After the period, access ends automatically.
- **Data:** HR assignment "ställföreträdare för enhet X, 2026-07-06 to 2026-07-26".
- **Exercises:** Time-bounded delegation in `UserContext`; row policies honouring it; audit trail showing "Sara as acting manager".

### UC-KIM-6 · Review a development proposal
- **Trigger:** A colleague submits a development proposal and Kim has the designated reviewer assignment.
- **Flow:** Open the exact submitted revision from the action inbox, inspect calculations, permitted evidence, assumptions and AI provenance. Request changes or record a decision with a comment. The author's next action/status follows the committed outcome; a later draft cannot silently replace the version Kim reviewed.
- **Data:** Startsidan-owned proposal, revision, review and decision records; only storage-permitted evidence/references.
- **Exercises:** B18, C23, D3/D9/D16; reviewer authority independent of navigation, content-review versus decision distinction, optimistic concurrency and atomic local mutation/audit. Synthetic reviewers are fixtures, not production authorization.

### UC-KIM-7 · Complete a recurring managerial obligation
- **Trigger:** This year's reporting deadline approaches.
- **Flow:** Show the responsible assignment, due date, preparation guidance and next action. Kim or a currently authorized acting manager completes the occurrence through its declared workflow. Next year's occurrence remains separate; confirmed completion removes only the corresponding action.
- **Data:** Declared obligation source or approved owned obligation records, assignments, completion events and guidance links.
- **Exercises:** B19, A6, C19–C20; occurrence identity, authoritative completion, acting scope and safe source-failure states. Source ownership is decided before implementation.

### UC-KIM-8 · Follow up employee development
- **Trigger:** The unit prepares for development conversations.
- **Flow:** Identify authorized employees whose conversations lack a booking or preparation, and development activities needing follow-up. Open the permitted plan or booking workflow; progress changes only when its owning source confirms it.
- **Data:** Development-plan/training source, permitted calendar evidence, current employee/manager relations.
- **Exercises:** B20, C11–C15; scoped progress, separation of booking from preparation/completion, source-denial handling and no stored protected conversation notes.

---

## Alex, handläggare bygglov

Desk-based case officer with ~40 open cases and statutory deadlines (ten weeks for bygglov).

### UC-ALEX-1 · My cases by deadline
- **Trigger:** Start of day.
- **Flow:** Main block: cases sorted by remaining statutory time, colour by status, with the next required step. Action rows for cases where a deadline is within five working days.
- **Data:** Case system (ärendehantering), working-day calendar.
- **Exercises:** Live dataset with `person.id` context; per-row status tones from the POC; derived measure "working days remaining" that needs a calendar dataset.

### UC-ALEX-2 · New inbound documents
- **Trigger:** A complement arrives on a case.
- **Flow:** Notification in the inbox and an action row on the case. Disappears when the document is opened in the case system.
- **Data:** Case system events.
- **Exercises:** Event ingest (4b) of case events; notification contract (9); resolution driven by a second event from the source.

### UC-ALEX-3 · Personalisation
- **Trigger:** Alex prefers the calendar on the left.
- **Flow:** Drags the calendar block from side to main. The operator had allowed reordering in these two regions. Alex cannot remove the "Att agera på" block because the operator locked it.
- **Data:** Personalisation record.
- **Exercises:** Personalisation within operator bounds (B8); page model with locked instances.

### UC-ALEX-4 · Ask about outstanding tasks and a possible handover
- **Trigger:** Alex asks which outstanding tasks could be handed to John Doe.
- **Flow:** Clarify task/time scope and ambiguous colleague identity; combine permitted task, directory, qualification and availability information. Distinguish assignment rights, recipient eligibility and scheduling evidence. Show missing facts as unknown. Only a separately confirmed proposal reassigns selected tasks, with current preconditions and visible per-source outcomes.
- **Data:** Live task systems, reviewed identity mappings, directory/employment relations and purpose-limited availability/eligibility operations.
- **Exercises:** LLM-authored validated query plans, source ID mapping, per-source caller authorization, no colleague impersonation, request-only derived data, and confirmed command recovery. See 25. The POC's read-only Alex persona does not implement this production role.

### UC-ALEX-5 · Prepare and resume a development proposal
- **Trigger:** Alex proposes a change to how the unit works.
- **Flow:** Start an approved template, enter text and typed resource/cost/benefit rows, attach permitted evidence and optionally request an AI draft/revision. Inspect what was read, assumptions, missing information and deterministic totals. Save a permitted draft, resume it later, review required sections and explicitly submit the exact revision to an authorized internal reviewer. A request for changes becomes Alex's next action. Manual editing/review remains available without AI.
- **Data:** Startsidan-owned draft/revisions and internal review records; bounded synthetic evidence in the first slice.
- **Exercises:** B18, C23, D3/D9/D15–D16, E12/H5; durable save/resume, stale-review invalidation, extraction failure, deterministic calculations, separate draft-edit/submission confirmation and authoritative status. See 30 for the selected scope; Word export and external handoff are not implemented.

### UC-ALEX-6 · Prepare for a development conversation
- **Trigger:** Alex has an upcoming development conversation.
- **Flow:** See the permitted plan, activity/training progress and outstanding preparation. Complete a preparation or activity action through the owning source. Keep booking, preparation and actual activity completion distinct.
- **Data:** Declared development/training source, permitted calendar and preparation information.
- **Exercises:** B20, C11–C15; employee scope, authoritative progress, usable source links and explicit unknown/unavailable states.

---

## Fatima, undersköterska

Works shifts in hemtjänst, no desk, uses a phone and sometimes a shared tablet in the group office. Has two employments: 75 % in hemtjänst and 25 % at a särskilt boende in another unit.

### UC-FATIMA-1 · Today's shift and route
- **Trigger:** 06:30 on the phone.
- **Flow:** First block: today's shift, start time, and a link to the route in the care app. Second: leave balance. Third: any message from Kim.
- **Data:** Scheduling system, HR balances, internal messages.
- **Exercises:** Phone-first layout of an operator-built page targeted to "medarbetare i hemtjänst"; multiple employments in `UserContext` (which unit's schedule is shown, both?).

### UC-FATIMA-2 · Apply for leave
- **Trigger:** Wants two weeks in July.
- **Flow:** Focus flow "Ansök om ledighet": dates, type, balance check, submit. Confirmation and an entry under "Mina ansökningar" with status. Kim gets the action (UC-KIM-3).
- **Data:** HR leave.
- **Exercises:** Write-back; focus flow; the same event producing an action for someone else.

### UC-FATIMA-3 · Shared tablet
- **Trigger:** Logs in on the group office tablet between visits.
- **Flow:** Quick login (badge or short OIDC session), sees the same page, session ends after five minutes idle.
- **Data:** n/a.
- **Exercises:** Session policy per device class; nothing about the user cached client-side.

### UC-FATIMA-4 · Report a broken device
- **Trigger:** The care phone's screen is cracked.
- **Flow:** Focus flow "Felanmälan" from the POC: the AI drafts the report from a photo and a sentence. Fatima sees the interpreted fields, corrects permitted values, supplies conditional details if reporting for another person, and confirms the exact report. A ticket is created in the IT system; an uncertain response shows reconciliation status. Recoverable errors preserve only permitted work, and support/link-out remains available.
- **Data:** IT service management system.
- **Exercises:** D3/D15–D16; visible interpretation and correction, conditional validation, narrow-screen/keyboard review, recovery without duplicate effects, write-back and the self-hosted model path (H5). Photo input requires a verified supported extraction/inference path.

### UC-FATIMA-5 · Find service guidance and take the right action
- **Trigger:** A work application is unavailable during a shift.
- **Flow:** Open the relevant service page, see current incident information separately from support guidance, and inspect its source, owner and update/review status. Follow a recommended self-service action, open a fault-report flow with permitted context or contact support. If the source/assistant is unavailable, the contact/link-out path still works.
- **Data:** Approved intranet/CMS or owned guidance, service-incident source, contact information and module workflow entry points.
- **Exercises:** B21, C16–C17, D15–D16; content authority/freshness, topic context, safe failure and phone/keyboard usability. Editorial content and service-incident ownership remain explicit source decisions.

---

## Lena, HR-partner

Supports socialförvaltningen. Is nobody's manager but works with sensitive data across ~60 units by assignment.

### UC-LENA-1 · Rehab cases needing action
- **Trigger:** Weekly.
- **Flow:** Shows authorised live absence indicators or reviewed aggregate counts for the assigned units, with links to the rehab tool. Rehab plan details remain in the source; individual indicators appear only where the live dataset policy permits them.
- **Data:** HR absences, rehab case register.
- **Exercises:** Row policy based on an assignment ("HR-partner for förvaltning X"), not on manager-of; the same view as UC-KIM-2 but with a different scope; purpose text mandatory.

### UC-LENA-2 · Onboarding status
- **Trigger:** Ten people start next Monday.
- **Flow:** List of new hires per unit with checklist progress: account created, badge, training booked, manager introduction done.
- **Data:** HR (start dates), IT (accounts), LMS, a checklist kept in Startsidan itself.
- **Exercises:** A dataset owned by the platform (checklist), joined with external datasets; target by attribute "employed less than 30 days".

---

## Omar, new employee

Started Monday in IT support. Knows nobody, has ten mandatory trainings, and one login.

### UC-OMAR-1 · First-week page
- **Trigger:** First login.
- **Flow:** A page the operator targeted to "anställd < 30 dagar": onboarding checklist, mandatory training with due dates, who is who in the unit with photos, where to find things. After 30 days the page is replaced by the regular IT-support page without anyone doing anything.
- **Data:** HR start date, LMS, org directory, editorial content (Sida).
- **Exercises:** Time-based targeting; page precedence when two pages match; editorial content blocks.

---

## Mikael, systemförvaltare (operator)

Owns Startsidan's configuration. Not a developer. Accountable to the data protection officer for what is shown to whom.

### UC-MIKAEL-1 · Build the hemtjänst manager page
- **Trigger:** The care department asks for a page for their enhetschefer.
- **Flow:** In the studio: new page, target "enhetschef in vård och omsorg", add "Today's staffing" domain block, add a generic table block bound to a new view (UC-KIM-2), add the action inbox and lock it. Preview, publish.
- **Data:** Block registry, catalog, page model.
- **Exercises:** Manifest split; registry as API; generated props forms; view builder; targeting; draft/publish; audit log.

### UC-MIKAEL-2 · Let the agent build the view
- **Trigger:** Mikael types "Visa frånvarodagar per medarbetare de senaste tolv månaderna för chefens egna medarbetare, dela upp på typ".
- **Flow:** The agent lists candidate datasets, proposes a view, the engine validates and previews with Mikael's own scope, the studio shows the effective classification and asks for a purpose text. Mikael confirms.
- **Data:** Catalog, view DSL.
- **Exercises:** MCP tools (10); validation error codes; proposal-then-confirm; self-hosted model.

### UC-MIKAEL-3 · Preview as Kim
- **Trigger:** Before publishing, Mikael wants to see what Kim will see.
- **Flow:** "Förhandsgranska som" Kim. The page renders with Kim's layout and targeting, but the data shown is masked or synthetic because Mikael has no legal basis to see Kim's employees' absences.
- **Data:** Everything the page uses.
- **Exercises:** Preview mode that applies policies for layout but not data access; masking strategy.

### UC-MIKAEL-4 · Connect a new system
- **Trigger:** The municipality buys a new LMS. The vendor ships a connector.
- **Flow:** A superadmin registers the host and its credential (with infrastructure help if it runs on another network). Mikael sees installed manifest metadata, runs conformance checks, and enables the connector only after dependencies, grants, review, configuration and erasure reconciliation pass.
- **Data:** Dataset manifests.
- **Exercises:** Dataset registration (3), read API (4a), conformance kit, Apache-2.0 SDK, connector health.

### UC-MIKAEL-5 · Answer the data protection officer
- **Trigger:** Annual review.
- **Flow:** Export: every view touching `personal` or above, its purpose, who can see it, which pages use it, when it was last changed and by whom.
- **Data:** Catalog lineage, audit log.
- **Exercises:** Lineage as ordinary relations (10-data-strategy); audit contract; classification propagation.

---

## Petra, produktionschef (non-municipal check)

Runs production at a company with two plants. The organisation has no förvaltningar or nämnder; it has divisions, plants, shifts and cost centres. HR runs on a different system than any municipality uses, and the company is a private employer under the same Swedish labour and GDPR rules.

### UC-PETRA-1 · Same manager page, different vocabulary
- **Trigger:** The company's operator builds a page for shift leaders.
- **Flow:** Today's staffing, absence follow-up per employee, approvals. Functionally UC-KIM-1 to KIM-3.
- **Data:** Company HR system, shift planning tool, both through vendor connectors.
- **Exercises:** That `orgunit`, `person`, `employment`, `managerOf` and classification are generic. That no block, view or policy references municipal concepts. That the operator names things (plant, shift) without the platform caring.

### UC-PETRA-2 · Shop-floor screen
- **Trigger:** A shared screen at the line shows a page for the whole shift.
- **Flow:** A page targeted to a device identity rather than a person: shift KPIs, safety notices, who is on call. No personal data.
- **Data:** Production system, editorial content.
- **Exercises:** Pages for non-person principals (a device or a group account) with only `public` and `internal` datasets. Whether `UserContext` can represent a principal with no `person.id`.
