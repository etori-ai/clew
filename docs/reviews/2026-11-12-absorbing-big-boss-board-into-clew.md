# Plan: absorbing big-boss-board (Dialogstöd) into Clew · 2026-11-12

Status: a plan, not a decision. Phase 1's first step is built on the branch `qlik-key-figures`: the Qlik connector
answers economy and HME beside sick leave from made-up figures (see "Changed the same day"). The rest waits for the two
decisions in phase 0, and phases 2 to 5 wait for the freeze on new surface
([D101](../decisions/D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md)) to
lift.

## What was asked

Oliver Borgström, on 2026-11-12: the functionality in big-boss-board ("bbb", the municipality's Dialogstöd for
manager follow-up, rebuilt as the `dialogstod` module of the startsidan prototype) is to go into Clew, and bbb will not
be maintained once Clew is in production. The Qlik connector is not settled and may be replaced. Asked whether the
dialogue should be read from bbb or be part of Clew's core, the answer given was core for the dialogue and connectors
for the figures; this page is the detailed plan for that.

This settles open question 6 of [manager statistics from Qlik](2026-11-06-manager-statistics-from-qlik.md) ("is
big-boss-board replaced by Clew, or do they run side by side?"): replaced. Option D of that review (read bbb) is a
dead end and is not planned, not even as a bridge.

## Changed the same day

Oliver Borgström, later on 2026-11-12, after reading the first version:

- The dialogue is for **every manager** following up their own staff and unit, not only the förvaltningar.
- **How Clew's people and units map to the source is not settled**, and is kept loose for now.
- **The data is to come through an API, not the file feed.** Which API is being looked into in parallel.
- Until then, **build on the Qlik connector with made-up data**, to lay down the look and the data flows through Clew.

On 2026-11-13 [D116](../decisions/D116-start-and-the-row-under-it-are-clews.md) made Start and the row under it
Clew's and put Dialogstöd there for a manager, leading to their own unit's page with its key figures until the
dialogue itself exists.

So the file feed is no longer the first source, and the key-figures connector of phase 1 is, for now, the Qlik
connector on its fixture. What was built is in phase 1 below. Decision B's vendor-neutral profile still holds for when
the real source is known; a profile keeps the pages unchanged when the source changes.

## Sources read

- bbb at its last commit (2026-10-28): backend routers, services, models and migrations, frontend pages and
  components, scripts, tests and `docs/`. The behaviour below is from the code; where bbb's documents contradict
  the code, the code is taken.
- The startsidan prototype's `packages/modules/dialogstod`: manifest, data layer, components.
- In Clew: D54, D82, D95, D96, D97, D99, D101, the prototype decision on the open branch `prototype-look` (D115 there), the [core-or-connector checklist](../maintainers/core-or-connector.md),
  the talks module and its seam, the entities module, the registry, `connectors/qlik`, `connectors/hr`,
  `connectors/finance`, the status pages.

## What bbb is

One page per organisation (the nine förvaltningar plus a fire-service federation and a municipal group company), six
areas on each, and a few things around it. It runs in production with SAML sign-in and real figures.

| Part | What it does |
|---|---|
| Measured areas | Economy (forecast minus full-year budget for net cost `SK.EK.RR.005`, mnkr), sick leave (rolling twelve months, total, women, men, long-term share, three age groups, permanent staff), HME (total index and three perspectives per year) |
| Assessed areas | Verksamhet (two dimensions: grunduppdrag and fullmäktigemål), digital transformation, kommunikativt ledarskap. No figures; questions and a manually set status |
| Status | good / warn / alert ("Över mål", "Bevaka", "Åtgärd krävs"). For assessed areas an append-only history of status and comment; the newest row counts, and an area with dimensions takes the worst of them |
| Activities | Free text per organisation and area, marked done with a note, edited, reopened, deleted once done. No author, no owner, no due date |
| Questions | General questions per area, replaced per organisation and area by its own where it has them; a "bygger på" quote from the employee survey |
| Import | Endpoints behind an import token or an admin session; a scheduled job reads `kpidata_RR_*` and `kpidata_Personal_*` files from a file share and posts them; HME is posted as the official report |
| Control files | Sick-leave files that cannot be read as R12 are kept as an archive and shown as warnings on the area |
| Around it | A project status page with question cards and status reports, and an inbox for free-text submissions. Not linked from the main page |
| Kept but not shown | Support functions and their tools (removed from the page 2026-06-25), the income statement, net cost per area |

**Who sees what.** Nobody is scoped. Every signed-in person sees every organisation and may add, change or delete
activities and set statuses on any of them. Activities and statuses record no author. Roles are `user` and `admin`.

**The rules that live only in bbb** and must not be lost (bbb file and line in brackets):

- Economy: only codes 23–31; code 13 (the whole municipality) is dropped, so the federation and the company never get
  economy from the file. `diff = round(prognos − budget_helar, 1)`; below zero alert, zero or above good, no warn
  level; missing or zero budget or forecast gives no assessment. Per period the "regular" extract wins: extract day
  1–9 in the month after the period, then the latest extract date (`ekonomi_import.py:180-202`). A one-off correction
  for code 24, April 2026 (`ekonomi.py:52-71`). The page warns of incomplete data on day 1–9 (1–15 in January).
- Sick leave: a file is R12 only if a row's measure starts with `SK.P.AM.`. Alert if the increase against the point
  exactly three months back is above 1.5 percentage points; else good at or below 6.0, warn at or below 7.5, alert
  above. Older non-R12 series are discarded on import and shown as "Inväntar R12" on read. Cost estimate in the
  frontend: staff × percent × 3 000 kr a year, and the extra cost against 6.0 (`frontend/lib/sjukfranvaro.ts:28-66`).
- HME: good at 75 or above, warn at 70 or above, alert below. A later import with only the total keeps the
  perspectives; a unit with every year empty is skipped and counted.
- Organisations match on `organisation.kod` = the source's `Enhet` / `orgId`, with one alias for the fire service.

## Where each part goes in Clew

The rule from the earlier answer: Clew holds the dialogue about the figures, not the figures. The start page knows no
feature; it draws areas, figures and cards from whatever answers them, core or connector (D54, D97).

| bbb | Clew | Kind | Phase |
|---|---|---|---|
| Economy, sick leave, HME per unit, with series and tones | For now the Qlik connector on made-up figures; later a connector over the API that is being looked into, behind decision B's profile | Connector | 1 |
| The thresholds, the economy assessment, the R12 rules, the cost estimate | The connector's code and configuration: the organisation's rule, not Clew's (D82 item 7) | Connector | 1 |
| File share job and import endpoints | Not carried over if the API answers; otherwise a transport job outside the connector posting files to an operator import route, as bbb separates `smb_import.py` from its rules | Connector | 1 |
| History of the series (held only in bbb's database) | Depends on what the API holds: if it answers closed months, nothing to keep; if not, read once from bbb into a store of the connector | Connector | 1, 4 |
| Control files (`sjuk_underlag`) | The connector's own import result and a note on the unit's row; the archive is not carried over | Connector | 1 |
| Organisation master (`organisationer.json`, `kod`) | Clew's unit tree pushed over SCIM (D99); a map from Clew unit id to the source's unit in the connector, as `QLIK_UNIT_MAP` does. Kept loose for now: the fixture's open mode needs no map | Core / connector | 1 |
| "Nivån under din" | D99's reporting line: the managers directly below the reader | Core | 2 |
| Overview of organisations | A table view of the dialogue module, a tool page (D40, D42): one row per unit in the reader's reach, one tone per area, the open activities | Core | 2, 3 |
| The page per organisation | The unit's page `/units/:id` (D97): the dialogue's section first, the key figures as the connector's section, the dialogue itself in a drawer over it (D83) | Core | 3 |
| Charts | The connector's `series` views (line and bar with an equivalent table, D79) | Connector | 1 |
| Activities | The dialogue module's activity: owner, optional due date, card in the owner's stream, timer when dated | Core | 2 |
| Manual status with history | The dialogue module's assessment: append-only, per unit, area and dimension, with author | Core | 2 |
| Questions, areas, dimensions | Configuration data of the dialogue module, loaded by an operator script | Core (data) | 2 |
| KPI tiles on the start page | Area figures of the key-figures connector (D54). On `main`, D112 already lets Läget's figures stand for Dialogstöd on Hem, the heading leading to the unit's page | Connector | 1 |
| "Ny aktivitet" notice and "Att agera på" | The activity's card in the owner's stream (D96 item 5's pattern) | Core | 2 |
| The prototype's "Sammanfatta sjukfrånvaron" | D8's fixed answer from the figures (`assistant/fixed.ts` already matches "sjuk" and "budget"); the model reads the connector's aggregates. The rehab ladder is HR's content (D82 item 2) and is not carried over | Connector data | 1 |
| The prototype's notes block | Not carried over. bbb has none; it is the heaviest record (free text) and checklist Part 4 orders it last | — | — |
| Support functions and tools | Not carried over; bbb no longer shows them. Confirm with the users | — | — |
| Status page, question cards, inbox | Not carried over: they are bbb's project log, not product. Exported once and archived (phase 5) | — | — |
| Access code, SAML, sessions, own token layer | Clew's OIDC and SCIM, Astryx | — | — |

## Decisions this plan rests on

Two numbered decisions, written before any code, numbers taken from the generated index when they land on `main`.

### Decision A · The follow-up dialogue is an owned domain

Under [D95](../decisions/D95-clew-may-own-a-domain-by-choice-decided-with-the-core-or-connector-checklist.md), with
the checklist's Part 3 answered. A draft of the answers:

| Question | Draft answer |
|---|---|
| 1. It removes something | bbb, a named product in production, which is retired |
| 2. The same everywhere | The shape is: areas, an assessment, activities, questions. The areas, their questions and thresholds differ and are data |
| 3. Work between Clew users | Yes: a manager and the managers below them; every activity is a card for its owner |
| 4. Small | One new record (the assessment) and one block made reusable (the commitment, generalised to a unit; see below). No round, no notes |
| 5. Model off | Yes. No read of the dialogue is a model tool |
| 6. Clew can carry it | **Open.** bbb's rule is public information only, but whether the records are public documents, their retention and archive rules are not answered. Free text sealed as D96 seals it |
| 7. Current readers keep it | bbb's users are the readers; the migration carries their records (phase 4). Nothing else reads bbb, to be confirmed |
| 8. Way in, way out | In: a one-time migration from bbb. Out: an export `clew.followup/1` |
| 9. Behind capabilities | Yes, behind a profile (below) |
| 10. An installation can choose | Yes: the built-in connector can be switched off and another system can answer the profile |
| 11. Reviewed by the domain | **Open.** The people who run the dialogue today (the municipal director's office and HR) have not seen it |
| 12. The team accepts being vendor | Asked of whoever owns the decision |

Choices the decision must make, with the recommendation:

1. **Its own module, not an extension of talks.** `talk_commitment` cannot be about a unit (`employee_id NOT NULL`,
   keyed on the person, rows dropped by the seam unless they map to a person) and cannot exist outside an open round
   (`round_id NOT NULL`). A module `apps/server/src/modules/followup/` with its own tables. The card and timer wiring
   in `apps/server/src/composition/talk-work-items.ts` is generalised into one shared helper both modules use, which
   is the "one reusable block" of checklist question 4.
2. **No round.** bbb's `period` is free text that nobody reads ("Senaste period", overwritten by the HME import). The
   dialogue is continuous per unit; activities and assessments are dated. A round can come with the annual plan.
3. **Who follows up which unit.** The reader's own managed units and the units of the managers directly below them
   (D99's reporting line, what Personal already uses), read through a `Staff` port as talks does. This is a change
   from bbb, where everyone sees everything; the users must accept it, or the decision names a capability for a
   staff function (a new name in `CAPABILITIES` is a contract change, D85).
4. **The owner of an activity** is the manager of the unit when it is added, stored as a person. When the unit's
   manager changes, open activities stay with the old owner (as D96's cards do) and are visible to the new one on the
   unit's page; moving them is a later decision. bbb has no owner, so migrated activities get the unit's current
   manager.
5. **The due date is optional.** bbb has none. Dated activities get a timer of their own kind (`followup-due`); the
   kind `due` is routed to talks in `composition/index.ts:143-148` and is not reused. An undated card says it has no
   date (D49).
6. **Assessments** are append-only rows (unit, area, dimension, tone, comment, author, time); the newest counts and an
   area with dimensions shows the worst. Only areas configured as assessed take them, as in bbb.
7. **Delete.** bbb deletes a done activity outright. In Clew a done activity can be removed with an audit row; the
   card goes with it.
8. **The profile.** Two reserved reads as D96 has: `<id>.followup` (one row per unit and area: tone, assessment,
   open activities) and `<id>.followupActivities`. The pages read Clew's composites (`clew.followup`), so another
   system can answer.
9. **Free text.** Activity text, the done note and the assessment comment are sealed at rest and appear in no card
   title, audit row, log line or trace (D96 item 6). Limits as bbb: 4 000 characters for an activity, 1 000 for a done
   note, 2 000 for a comment.
10. **Amends D115 if it is accepted** (the startsidan prototype as the reference for Clew's look, open on the branch `prototype-look`),
    which lists the Dialogstöd module as not carried over.

### Decision B · Key figures per unit come through one vendor-neutral contract

Supersedes [D82](../decisions/D82-sick-leave-statistics-come-through-an-absence-connector-that-reads-only-aggregates.md)
(still `proposed`), whose contract names Qlik.

1. **A combined profile** `<id>.keyFigures`: one row per unit and measure (the unit key, the measure's key, label,
   value and unit, tone, target, comparison, period, observed time, and an optional series). Several connectors may
   answer and are merged, as errands are (D89), so economy and sick leave may come from different systems. The
   dialogue module reads it to put a tone in the overview's measured columns; Clew never computes a tone.
2. **The first real answerer is the API** that is being looked into. Until it is known, the Qlik connector answers on
   its fixture (phase 1). The file feed bbb runs today is the fallback, not the plan. `connectors/qlik` is either
   rebuilt to answer the profile or withdrawn with a closing note (D105).
3. **History.** If the API answers closed months, the connector keeps nothing. If it answers only the current state,
   the connector must store its series, which is health aggregates at rest outside the source (D82 weighed and left it)
   and needs an impact assessment with the data protection officer; bbb's assembled series are then its starting point.
4. **The data's class.** If key figures per förvaltning are public information (bbb's rule, and the figures are in
   annual reports), the connector checks only the role and Clew scopes what is shown. If they are not, the connector
   must check that the reader may see each unit, and the actor assertion carries one `unitId` today (D99, open), so
   the assertion would need the reader's units: a protocol change (D44). The decision says which.
5. **The rules are the connector's** and listed in its README with the source of each: the thresholds, the economy
   assessment, the R12 check, the three-month rule, the cost estimate. The April correction for code 24 is not ported
   if the migrated history already carries the corrected value (verify in phase 4).

### Answers needed from people, before or during phase 0

| Question | From |
|---|---|
| Who uses the dialogue today, how often, and is scoping by reporting line acceptable? | The municipal director's office |
| Are the records public documents; retention and archive rules for activities and assessments; what happens to bbb's database at shutdown | Registrar and archivist |
| Health aggregates at rest in the connector; is a per-unit sick-leave figure public information | Data protection officer, HR |
| Are the federation and the company in Clew's unit tree? Their economy never came from the file | Whoever runs the provisioner |
| HME: who delivers the yearly report, and in which format, once bbb is gone | HR |
| Support functions and tools: still wanted? | The users |
| Which parts of the freeze may this cross, and when | Whoever owns D101 |

## Phases

### Phase 0 · Decide (allowed under the freeze)

- [ ] Write decisions A and B as `proposed`, with the checklist answers and the choices above.
- [ ] Add the open items to `docs/maintainers/open-questions.md`; remove the Qlik review's question 6 as answered.
- [ ] Ask the questions in the table above; record the answers in the decisions.
- [ ] Take a read-only copy of bbb's production schema and row counts (no content) to size the migration.

Done when both decisions are at least `provisional` and the people's answers are recorded or marked as waiting.

### Phase 1 · The key figures (connector work; check against the freeze)

A connector changes nothing in Clew if it uses only today's protocol: an area figure, `about: unit` reads, `table`
and `series` views. The profile of decision B is a contract change and waits for phase 2.

**Built on the branch `qlik-key-figures`, not merged:**

- [x] `connectors/qlik` answers economy and HME beside sick leave: a table per measure (a menu tool), a line chart per
      unit (`series`, opened from a row), a read about a unit per measure (sections on `/units/:id`), and the areas
      `economy` and `hme` with figures on Hem. Ten reads in all.
- [x] Made-up figures for any unit, the same every time. Open mode (no `QLIK_UNIT_MAP`): every manager has figures for
      their own unit, whatever the organisation tree; the scope is still the reader's own unit, as the connector check
      requires.
- [x] The thresholds as the operator's settings, each off until set; the development stack sets bbb's (sick leave 6.0
      and 7.5 %, the economy below budget in balance, HME 75 and 70). The three-month rise rule is not built: bbb applies
      it to a rolling twelve-month rate, and which rate the source gives is not settled.
- [x] In the development stack: the compose service `qlik`, registered by `bun run dev:connectors`, which on the first
      registration switches off the HR fixture's sick-leave figure and the finance fixture's spent frame on Hem.
- [x] `tests/unit/qlik-connector.test.ts`; the connector check passes.

**Not built, and why:**

- [ ] The real source: waits for the API. Then its adapter beside `engine.mjs` or its own connector, the map from
      Clew's units, and bbb's rules checked against what the API answers (bbb's backend tests `test_ekonomi_import.py`,
      `test_product_imports.py` and `test_sjuk_underlag.py` are the cases to port).
- [ ] A manager seeing the units below: Clew's unit page opens only units the reader belongs to or manages, and the
      connector knows only the reader's own unit (the assertion carries one, D99). Both change with the mapping.
- [ ] Economy and HME in the engine adapter: HME's source is the employee survey, not Qlik.

### Phase 2 · The dialogue module (after the freeze lifts)

- [ ] Migration `00NN_followup.sql`: `followup_area` (configuration: key, title, kind measured or assessed, measure
      key, dimensions, order), `followup_question`, `followup_assessment` (append-only), `followup_activity` (unit,
      area, owner, sealed text, due date, done, done note sealed, author, thread id). A trigger bumping the unit's
      change signal (D46).
- [ ] `apps/server/src/modules/followup/`: contracts, pure domain (worst-of, the reach, the overview rows), ports in
      `model.ts`, use cases: `overview`, `unit`, `addActivity`, `editActivity`, `setDone`, `reopen`, `removeActivity`,
      `assess`, `activityDue`, `eraseActivitiesOf` (a person as author or owner), `exportDomain`. Each in one
      transaction with its audit row, no text or name in it.
- [ ] The shared card and timer helper out of `composition/talk-work-items.ts`; the timer kind `followup-due` in
      `threads/model.ts` and the dispatch in `composition/index.ts`.
- [ ] The `Staff` port filled in `apps/server/src/composition/`; the entities module's unit access widened from "a
      unit the reader belongs to or manages" to the reporting line, so a manager can open the unit page of a unit
      below (`readerUnits` in `modules/entities/domain.ts`).
- [ ] The built-in connector (`kind: core`, id `followup`, source "Uppföljningsdialog"): the overview read with a
      `table` view as a menu tool, `followup.unit` (`about: unit`, page to the drawer), an area with the figure "N
      öppna aktiviteter". Not model tools.
- [ ] The two profiles in `@clew/contracts` and the protocol's `$defs`, the registry's choice of answerer, the
      composites, `PROFILES`, `bun run protocol:schema`; a fixture connector proving the profile, as
      `connectors/appraisals` does for talks.
- [ ] Routes `/api/followup/...`, thin, refusing unless the built-in module answers.
- [ ] Operator scripts: `followup-areas.ts <file>` (areas, dimensions, questions from a JSON file; an example file
      with synthetic questions in the repository, the municipality's own file outside it), `followup-erase.ts`,
      `followup-export.ts`.
- [ ] Tests: scenario tests asserting audit rows, a store contract run on memory and Postgres, the card and timer
      in Postgres, the profile against the fixture.

### Phase 3 · The pages

- [ ] Read `bunx astryx docs layout`, `bunx astryx search` and the template list before any layout (CLAUDE.md).
- [ ] The overview as a tool page: units as rows, one column per area with tone and word (colour never alone), open
      activities.
- [ ] The unit page: the dialogue's section first, the key figures' section beside it.
- [ ] The dialogue drawer over the unit page (`/units/:id?dialog=<area>`, a sheet on a phone, D83): the areas as
      tabs; for a measured area the connector's figure and series and the questions; for an assessed area the
      questions, the assessment form and its history per dimension; the activities with add, edit, done with note,
      reopen, remove.
- [ ] Hem: the figures (phase 1) and the activity cards. No new section on Hem.
- [ ] Specs in `tests/a11y` for the tool page, the drawer and every state (empty, no reach, source down, read-only
      when another system answers); reflow at 320 px; a manual screen-reader pass.
- [ ] Re-read against D111 (where something opens) and D112 (the interface on Astryx templates), which reached `main`
      after this plan was written, and compared against the reference the interface decision in force names: D112's
      canvas, or the prototype's Dialogstöd if D115 is accepted. Differences recorded as Astryx gaps.

### Phase 4 · Migration and pilot

- [ ] `scripts/followup-import-bbb.ts`: reads a bbb export (JSON from a read-only database dump, never a live
      connection), maps `kod` to Clew unit ids from an operator's map, and writes activities (owner the unit's current
      manager, author the operator, times kept, done notes kept), assessments (times kept) and the organisation-specific
      questions; `--dry-run` prints counts per unit and refuses unmapped codes. Its own scenario test.
- [ ] The series from bbb's `measurement.details` into the connector's store through its import route; compare the
      latest value per unit with bbb's page.
- [ ] A pilot with the people who run the dialogue, against a test installation, before real data is entered
      (D95 item 3: question 6 answered first).

### Phase 5 · Cutover and retirement

- [ ] A date agreed with the users. bbb's writes stop (read-only or the sign-in closed), the final migration runs,
      the reconciliation report is kept.
- [ ] bbb's address redirects to Clew's overview.
- [ ] bbb's scheduled import jobs are switched off after the connector's transport job has run a full month.
- [ ] bbb's database, the status page's cards, reports and inbox are exported and handed to the archive under the
      rules phase 0 established; nothing is deleted before that.
- [ ] bbb's repository is archived with a pointer to Clew.
- [ ] `docs/reference/status.md` says what is built; decisions A and B move to `provisional` or `accepted`.

## Behaviour that changes for bbb's users

To be said to them before the pilot, not discovered in it:

- They see the units in their reporting line, not every organisation.
- Each activity has an owner who gets it as a card, and the author is recorded.
- A due date can be set; bbb had none.
- The notes block of the prototype, the support functions and the project status page do not come.
- The figures update when the transport job runs, as now; the page says when the source last answered (D54).

## Risks

- **The freeze.** Phases 2 and 3 are new owned domain and new surface. Until the Nextcloud loop passes, only phases 0
  and 1 can move, and phase 1 only as connector work.
- **The legal answers** (checklist 6) gate real data, not code. If they take long, the cutover waits for them, not the
  build.
- **The history.** If bbb's series are not migrated before bbb is switched off, the months before the first file the
  connector reads are gone.
- **SMB from a Linux container** is what bbb already solved (NTLM with signing); Kerberos-only shares are not supported
  there either.
- **The units outside the tree.** If the federation and the company are not in Clew's tree, their dialogues have
  nowhere to go.
