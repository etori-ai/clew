# Fact kinds: who owns them, who defines them, and what breaks when a dependency goes down

Date: 2026-11-06

Reviewed revision: `598c9f2`
Status: review and recommendation; no decision taken. The catalogue of core kinds and the dependents view are proposed below and await a decision each.

## Assessment

D55 lets one event in a person's work become work in several systems: a connector declares the fact kinds it brings
about, other connectors declare a `propose` that follows a kind, an administrator binds followers to kinds, and the
person approves one job. The product owner asked three questions about that design on 2026-11-06, after the manifest
reference (D60) had made the `facts`, `follows` and `creates` fields visible field by field:

1. Should Clew own the fact kinds? If a connector defines them ad hoc, does whoever registers first own a kind?
2. If Clew owns them, how does a user of Clew define the events? They cannot be hard-coded in the repository, which
   cannot anticipate every municipality's cases.
3. If a connector's event depends on a vendor's event and that connector is down or removed, is there a chain of
   breaking connectors that is hard to see?

Traced against the code: ownership is already settled per connector and the first-come worry does not arise, but the
vocabulary is per vendor and couples followers to one system; the right fix is small, a catalogue of Clew-owned kinds,
with administrator-defined kinds deferred under a written promotion rule; and a running job cannot cascade by design,
while a dependency can go quiet without anyone being told, which is a visibility gap Clew can close from what it already
holds in memory. The product owner's constraint throughout: do not overbuild.

## Basis and limits

Code read: `packages/connectors/src/index.ts` (the registry: `register`, `followers`, `creates`), `protocol.ts`
(`FactKindName`, `ManifestFactSchema`, `FactEnvelopeSchema`, `StepDraftSchema`), `remote.ts` (`manifestProblems`),
`apps/server/src/modules/jobs/` (bindings and the assembler), and the decisions D35, D37, D55. Not run: the job
scenario tests; the findings are about what the code enforces, read from it. Not examined: how a D19 change
notification would carry a fact, which is proposed and not built.

## Findings

1. **A kind is owned by the connector whose id prefixes it, and the registry enforces that.** `FactKindName` is
   `<connector id>:<kind>`, and `Registry.register` refuses a connector whose `facts` carry another id's prefix
   (`index.ts`, "facts must be prefixed"). There is no first-come ownership: `hr:absence` can be declared only by the
   connector registered as `hr`. The rule is applied at registration, not by `manifestProblems`, so the manifest dry
   run (`POST /api/protocol/manifest`) and the manifest reference do not mention it yet.
2. **The vocabulary is therefore per vendor.** A follower that declares `follows: ['hr:absence']` works with that HR
   connector only. Replacing Heroma with Personec, or running two HR systems across municipalities, means a new line in
   every follower's manifest and new bindings; and nothing says that `heroma:absence` and `personec:absence` carry the
   same attributes, so a follower cannot be written once. This defeats the point of D55, that the time-reporting
   connector need not know which HR system stands in front of it.
3. **Clew already owns shared vocabulary wherever two connectors must look alike.** The search profile (`<id>.search`,
   `SearchHit`, D26), the errand profile (D35), the calendar contract (D11). Fact kinds are the same situation.
4. **A running job cannot cascade.** D55 item 4 makes a job a star: one fact fans out to its bound followers, every step
   is computed from the fact alone, and no step reads another step's result. A result that must reach a third system is a
   fact on the receipt and a new job with its own approval. A connector that is down during a job fails or leaves unknown
   only its own step; the job card shows that per step and undo is per step.
5. **A removed or disabled creator is known to Clew; a merely down one is not distinguishable from quiet.**
   `Registry.creates(kind)` says whether any enabled connector still creates a kind, and a binding on a kind nobody
   creates is degraded (D55 item 9). A down creator produces no facts, and no fact looks like no event: its followers
   idle with nothing to tell them. The connector's own health shows unreachable and its areas draw the warning figure
   (D8); nothing says that three followers wait on it.
6. **A missing follower is visible.** The assembler marks the proposal partial and names the missing system; a removed
   follower's binding degrades.
7. **A missing callback target is visible to the person, not to the administrator.** `uses` names exact capabilities
   (D37); a call to one no enabled connector serves answers unavailable to the calling connector, which answers
   unavailable to the person. D37 decided that a dependent's health degrades and that its admin page lists dependents;
   `docs/reference/status.md` records that the dependent health view is not built.
8. **No page shows the dependency graph.** Which bindings and which `uses` depend on a connector is derivable from the
   manifests and bindings Clew holds, and shown nowhere; disabling or removing a connector warns about nothing.

## What must not be built

- **A mapping layer in bindings.** Letting an administrator map `heroma:absence` onto a shared kind with field renames
  or transforms puts a translation step into Clew's database. D55 kept bindings flat for a reason; translation belongs in
  the connector, which knows its own system. Weighed and left, including the one-to-one rename variant.
- **Administrator-defined kinds now.** A kinds page with a fields form, export and import between municipalities, and
  creator bindings with compatibility checks were sketched during the discussion and set aside: two admin surfaces, a
  schema-compatibility check and a rename table for a need no installation has yet. The connector-owned namespace covers
  a local need in the meantime, vendor-coupled but working.
- **Kinds for followers that do not exist.** A kind is added for a follower that exists, never for one that might.
- **Any mechanism in the protocol for dependency failure.** The star shape already prevents cascades; what is missing
  is visibility, not a mechanism.

## Recommendation

1. **A small catalogue of Clew-owned kinds under `clew:`**, defined in the protocol package beside the other shared
   profiles, each with a Swedish title and an attribute schema, published in the schema bundle and listed on the
   manifest reference page. Specific events, generic attributes: the name says what happened in municipal work (an
   absence was registered, an invoice was approved, a case was opened), the required attributes are the three to six
   every system of that class has (refs, dates, amounts), and one optional `details` object holds what the source knows
   beyond that, which followers may read and must not depend on and Clew does not validate. A connector that creates a
   core kind declares `creates: 'clew:absence'` and does not redeclare the attributes; Clew holds the schema and validates
   what the connector emits against it. Followers follow by name; D55's bindings are unchanged. A first list from Clew's
   current scope, to be confirmed: absence registered and ended, employment started and ended, invoice approved, case
   opened and closed. Each stays as it is by D37's rule: a break is a new kind.
2. **A written promotion rule instead of administrator-defined kinds.** A kind enters the catalogue when a second
   connector needs it, by a decision, the way a private capability becomes a profile. Installation-defined kinds remain
   a possible later decision if a real case arrives that the connector-owned namespace cannot serve.
3. **The dependents view, which closes finding 8 without touching the protocol.** On a connector's admin page: what it
   depends on (its `uses` and `follows`) and what depends on it (other connectors' `uses`, bindings on the kinds it
   creates); a warning on disable and remove that names those dependents; health propagation as D37 decided, degraded
   with the reason, in the list and on the person's card; and a conformance-check warning when `uses` or `follows`
   names something no enabled connector provides. What it cannot do is say that a down creator would have produced a
   fact; monitoring the source stays the connector operator's job.
4. **Two small closures of finding 1.** Add the prefix rule to `manifestProblems`, so the dry run and the reference say
   it, and add it to the reference's rules with the test that breaks it.

## Outcome

Open. The product owner agreed with the small catalogue over administrator-defined kinds on 2026-11-06 ("if we could
expose a set of predefined events from Clew that could be enough") and with the dependents view as the answer to the
visibility question. Decisions to follow: the catalogue with its first kinds, and the dependents view on the connector
page.
