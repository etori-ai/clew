# D123 · What a person ordered or reported is a profile of its own, `<id>.requests`, listed apart from the errands they handle

**Status:** provisional (built 2026-11-13 on branch `boarding`; accepted once a service desk outside the repository answers `<id>.requests` for a person and that person has used the section on Hem; no connector answers the profile yet, and no manual screen-reader pass) · **Date:** 2026-11-13 · **Area:** integrations, ui

**Decision.** What a person ordered or reported in a service desk and waits for (an account, a computer, a broken
printer, a lamp out in the corridor) is kept apart from the errands a person handles. It has a connector profile of
its own, combined across systems as the errand list is, but into a list of its own with its own section on Hem.

1. **The profile.** `<id>.requests` is a reserved name, as `<id>.errands` is ([D35](D35-errands-are-a-connector-profile-and-a-card-is-one-systems.md),
   [D89](D89-an-errand-connector-acts-as-the-person-and-the-case-system-decides-access.md)): a `read` that takes `{}`
   and answers a `RequestsOutput`, rows of `RequestRow`. Both are in `@clew/contracts` and in the published protocol's
   `$defs`. A profile is recognised by its name and kind (`isRequestSource` in `packages/connectors/src/index.ts`), not
   by a manifest field, so a connector declares nothing besides the read. The read's view names, as its `open`, the
   read that shows one request with its free text, by convention `<id>.request`. A `<id>.requests` read cannot declare
   `about` (`PROFILES` in `packages/connectors/src/validation.ts`): it is about the person who asks.
2. **The row.** `ref` (`request:<connector id>:<the system's own identity>`, opaque to Clew), `label` (the number and
   the category or type display name, "SD-4711 · Dator, Felanmälan"; never a title, a description, a name or an
   account, the errand label's rule), `state`, `status` (the system's own Swedish word), `since` (when the person
   ordered or reported it), and optionally `expectedAt` (a day or an instant: when it is expected to be delivered or
   done, where the system promises one) and `link` (an absolute http(s) address of the request in its own system).
   Nothing else: an answer with another field, a ref of another shape or a state outside the list is not a
   `RequestsOutput`.
3. **The states**, seen from the person who waits: `waiting-on-me` (the desk has asked the person something, or waits
   for them to confirm or collect), `new` (received, nobody has started), `active` (being handled, a delivery on its way
   included) and `closed` (delivered, solved or withdrawn). The names are D89's where the meaning is the same. There is
   no `waiting-on-others`: for the person who ordered, everything open waits on the desk, and a connector would have to
   choose between it and `active` without a difference the person could see. The connector derives the state from its
   own status, as an errand connector does.
4. **`clew.requests`** is a read of Clew's core connector in its own module, `apps/server/src/modules/requests/`
   (`domain.ts`, `usecases.ts`, `model.ts`, `capabilities.ts`), shaped as the errand module is. It asks every
   `<id>.requests` in the person's scope at the same time through the registry handle, so each system's scope and the
   person's delegated token apply, with a budget per system (4 s) inside one for the whole (5 s). An answer that fails
   `checkContract(RequestsOutputSchema)` counts as no answer, so a connector cannot put free text in the list. The
   rows are ordered `waiting-on-me` first, then `new` and `active` together from the one ordered longest ago, then
   `closed` from the one ordered most recently, and the list stops at 200 rows, so what the cap cuts is the oldest of
   what is closed; each row is marked with its connector and the system's name and carries the view that opens it in
   that system (`rowViews`), when the person may call that read. The systems that did not answer are named (`unanswered`); when none answers the read fails, so
   an empty list always means that nothing was ordered or reported. `apps/server/src/connectors/registry.ts` joins the
   part into the core connector beside the errand list; neither module imports the other (D20).
5. **Offered only with a source.** The capability's scope is "the person may call at least one `<id>.requests`", and
   the area "Beställningar och felanmälningar" (id `requests`, the list as its standing read) and the menu hint are
   withheld by the same test (`AreaDefinition.offered`). The menu hint is "Mina beställningar", since a menu row holds
   24 characters. The model is offered `clew.requests`, reading a summary, and never a per-connector `<id>.requests`
   while the composite is registered (`Registry.tools`).
6. **On Hem, a section of its own directly after Mina ärenden** ([D90](D90-mina-arenden-is-a-section-on-hem.md)'s
   place, under Verktygslådan since D112): "Beställningar och felanmälningar", drawn by `DeclaredView` from the view
   the core connector declares, in a `Card`: the first five rows, "5 av N rader", the systems that did not answer, and,
   when there are more than five, the view's own "Visa allt" (`showAllHref`, as under an answer) to the list's own
   page, `/tools/clew.requests`, with Hem as the way back ([D116](D116-a-panel-is-a-peek-at-one-thing-a-list-is-a-page-and-every-view-has-an-address.md)):
   the page's heading takes the focus, and Back returns it to "Visa allt". A row opens the request beside Hem, in the
   system it came from, with the focus on the panel's heading; closing gives it back to the row. The shared state is a
   badge on every row, in Clew's words for it ("väntar på dig", "ny", "pågår", "stängd"), and only "väntar på dig" has
   a tone, `warn`; the system's own status stays beside it. This uses what views already have: a `status` field over
   `state` with `tones` keyed on the state, its words from the web's dictionary of state words (`panel-labels.ts`),
   which already gives the talks round's and the competence register's states theirs. No field and no view feature was
   added. While the read is on its way the section keeps its
   place with a skeleton; a read that fails is an alert with the server's sentence and "Försök igen". As D90 item 6 says
   of the errands: nothing is stored or pushed, and the section is not counted in "Behöver dig", the rail or Lugnt
   läge. Code: `apps/web/src/components/my-requests.tsx` and one element in `apps/web/src/pages/start.tsx`; Astryx
   components only, no CSS.
7. **Protocol 3 is kept, and the reserved name is a change in behaviour.** By
   [D60](D60-the-instance-serves-its-connector-protocol.md) item 4 the schema change is additive. What was checked,
   against the published schema of 3 (`docs/protocol/connector-protocol.schema.json` as committed before this change):
   two definitions were added, `RequestRow` and `RequestsOutput`; none was removed; the one changed is
   `ConnectorManifest`, and only in the description of a capability's `name`; the OpenAPI document's paths are
   unchanged and its component schemas differ in the same three. Every manifest in this repository (the sixteen under
   `connectors/`) validates against the published `ConnectorManifest` (Ajv's 2020-12 validator over the committed
   bundle), has no problem under the changed loader, and declares no `<id>.requests` or `<id>.request`, so none of them
   is treated differently. A manifest that declares `desk.requests` and `desk.request` validates against the published
   schema too.
   Reserving the name is not additive for a manifest outside the repository that already uses `<id>.requests` for
   something else. Such a manifest is refused whole if that capability declares `about` (`PROFILES`). A `read` of that
   name without `about` is enrolled as a request source without being told: Clew asks it with `{}` for every person in
   its scope, an answer that is not a `RequestsOutput` counts as no answer, so Hem shows the section with "<system>
   svarade inte." for good (or the section's alert when it is the only source), and the model no longer sees that read
   as a tool while `clew.requests` is registered. A `propose` or `execute` of that name is left alone. `<id>.news` was
   reserved the same way ([D112](D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md),
   amended 2026-11-11), with no new number. It is accepted because no connector outside the repository is known to exist
   yet: nothing outside it has tested the protocol ([D102](D102-a-decision-is-provisional-until-something-outside-the-repository-has-tested-it.md)).
   Once one does, reserving a name will need D60's window like any other break. A Clew from before this change loads a
   connector that declares the profile and offers its reads as ordinary views, not combined.
8. **Tests.** `tests/unit/requests.test.ts`: the order across systems, closed ones newest first and the cap cutting the
   oldest of them, a repeated ref, a failing and a late system named, the budget for the whole, no answer from anyone as
   an error, a broken answer (a title, an errand state, an errand's ref, a link that is not a web address, an
   `expectedAt` that is neither a day nor an instant) dropped whole, a row with no view when the person may not open it,
   an input refused, scope, the area and the menu row, the model's one tool, the errand and request lists never asking
   each other's sources, a connector outside Clew declaring the profile on protocol 3 and answering over the protocol
   with `about` refused on it, and a delegating desk given the person's own token and named when it has none.
   `tests/unit/panel-labels.test.ts`: the state words. `tests/a11y/requests.spec.ts`: the section directly after Mina
   ärenden, the first five, the badge on what waits on the person only, the missing system named, a row opening beside
   Hem with the focus on the panel's heading and back on the row, "Visa allt" to the page with the focus on its heading,
   Hem as its way back and the focus back on "Visa allt", nothing to follow with five or fewer, no section without a
   source, the failed read and the retry, 320 px.

**Not built.** No connector answers the profile: a service-desk fixture connector among the development stack's
fixtures comes next, and until then the section is seen only in the browser suite on routed data. No input asks for
someone else's requests (a manager's view of what their people ordered): the read takes `{}` and is about the person
who asks. No scan, so the desk asking the person something does not become a work item; no writes (answering the desk,
confirming a delivery, withdrawing an order); no search kind for a request. A system that is both a case system and a
service desk declares both reads, and nothing relates the two lists. The design canvas has no such section.

**Why.** The product owner, on 2026-11-13, on whether what a person ordered or reported belongs with the errands: "I
think we need to keep them separate in clew for the user. Supportmanagement is not something all users even see I
think". Nothing more was decided by the product owner: the profile, the row, the states, the order, the place on Hem
and the names are this record's choices.

D35 put the lists a person meets about errands into `clew.errands`, and the errand profile already has a view for the
reporter's side, `view: 'reported'` ("Anmälda av mig"). That is not enough, for three reasons. The audience differs:
everyone orders and reports things, while the errand list is for the handlers of a case system and is offered only to
a person with one (D89 item 8). Served through it, a person who never handles an errand would meet the area
"Ärenden", the section "Mina ärenden" and a choice whose other half is empty for them, or the errand list would have to
be offered to everyone. The row differs: an errand row carries what a handler orders by and acts on (`waitingOn`,
`dueAt`, `area` and five states with `waiting-on-others`), while the person who waits asks whether the desk is waiting
for them and when it will be done (`expectedAt`), and has no use for a business area. One shared row with a mode would
have made every field optional for one side or the other. And the list differs: on Hem, what a person must do in their
work and what they are waiting for are two questions, and a choice inside one section shows the second only after the
first is put aside; a list of its own shows both.

A profile recognised by name, not a manifest field, because that is how every profile is recognised (D26, D35, D96,
D112): a connector author meets one rule, "name the read this", and a Clew from before the change still loads the
connector. `new` and `active` share a rank because the person who waits asks for the oldest first, and a fresh order
should not jump ahead of one that has waited a month. `closed` is in the profile so that a desk can show what was
recently delivered, so the closed ones run the other way, newest first, and the cap cuts the oldest of them; how long
a desk lists closed requests is its choice. The section leads to the list's page rather than showing the rest in
place, as Mina ärenden still does (D90 item 2), because D116 made a list a page after D90 was written; it uses the
view's own "Visa allt" rather than a link of its own, so it reads and behaves as a cut list under an answer does.

**Replaces.** In [D35](D35-errands-are-a-connector-profile-and-a-card-is-one-systems.md): item 4's reading that the
one list a person meets for errand-like work is `clew.errands`. What a person ordered or reported in a service desk is
`clew.requests`, under its own profile. D35's other items stand, as do [D89](D89-an-errand-connector-acts-as-the-person-and-the-case-system-decides-access.md)
(the errand row and `clew.errands`, with `view: 'reported'`) and [D90](D90-mina-arenden-is-a-section-on-hem.md)
(Mina ärenden on Hem). D35's status says so.
