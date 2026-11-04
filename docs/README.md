# Clew documentation

`HANDOVER.md` at the repository root is the entry point: the state of the build, the short table of
decisions in force, and the ordered next steps. `vision.md` says why Clew exists. Everything else under
`docs/` is the reasoning behind the build.

The first mock errand contract, its field rationale and the demo scenarios are described in
[`architecture/errands.md`](architecture/errands.md).

| Folder or file | Holds | When to write here |
|---|---|---|
| [`vision.md`](vision.md) | What Clew is, what it is not, the principles, and the line between Clew and Eneo | When the answer to "should Clew do this at all?" changes |
| [`decisions/`](decisions/README.md) | The decision log, one file per decision (`D01-…`), with an index and a template | Every time something is settled that a later session must not reopen by accident |
| [`reviews/`](reviews/) | Reviews and comparisons, one file per review, dated (`YYYY-MM-DD-<topic>.md`) | When the project or a part of it is assessed against something: another project, a platform, a canvas row, a vendor |
| [`architecture/`](architecture/) | Designs that are longer than a decision: `integrations.md` (principles), `integration-paths.md` (the catalogue of supported paths and their status), `capability-surfaces.md` (how one capability is exposed over REST, as a model tool and over MCP), `working-across-modules.md` (how work and data span modules without a query engine), `scheduled-work.md` (the Postgres scheduler, its limits, when Temporal comes in), `identity.md` | When a decision needs a design to be buildable |
| [`guides/`](guides/README.md) | Step-by-step instructions: creating an integration, with a worked example | When a kind of work recurs and the next person should not have to rediscover the order |
| [`personas.md`](personas.md) | Nine personas and 35 use cases carried over from startsidan | When a persona or use case changes |

## Conventions

- English in `docs/`. Swedish only where a person reads it in the product.
- Decisions are numbered `D1`, `D2`, … and referred to by number everywhere. Add one by following
  `decisions/README.md`. Never rewrite an old decision; supersede it with a new one.
- A review records what was asked, what it was based on, what it found and what it led to. It is kept as
  delivered; later outcomes go in its "Outcome" section, not in the body.
- A design in `architecture/` says which decisions it implements and is updated when they change.
- Every session that adds or changes a file here adds a line to the session log in `HANDOVER.md`.

## Reviews

| Date | Review | Led to |
|---|---|---|
| 2026-11-03 | [Platform review against startsidan](reviews/2026-11-03-platform-review-against-startsidan.md) | D10, D11, HANDOVER next step 10 |
| 2026-11-04 | [Runtime and dependency review](reviews/2026-11-04-runtime-and-dependency-review.md) | Node 26 LTS, Bun and compatible dependency updates, CalDAV and Node runtime contracts |
| 2026-11-04 | [SupportManagement integration review](reviews/2026-11-04-support-management-integration-review.md) | Errands as a Clew-owned pass-through domain (`ErrandProvider`), SupportManagement as the first adapter, D18 proposed |
| 2026-11-04 | [Accessibility, component and motion review](reviews/2026-11-04-accessibility-and-motion-review.md) | Findings 1 to 14 fixed, the `tests/a11y` suite in CI, the WCAG rule in `CLAUDE.md`. The session warning (finding 15) and manual testing are open |
