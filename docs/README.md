# Clew documentation

`HANDOVER.md` at the repository root is the entry point: the state of the build, the short table of
decisions in force, and the ordered next steps. `vision.md` says why Clew exists. Everything else under
`docs/` is the reasoning behind the build.

| Folder or file | Holds | When to write here |
|---|---|---|
| [`vision.md`](vision.md) | What Clew is, what it is not, the principles, and the line between Clew and Eneo | When the answer to "should Clew do this at all?" changes |
| [`decisions/`](decisions/README.md) | The decision log, one file per decision (`D01-…`), with an index and a template | Every time something is settled that a later session must not reopen by accident |
| [`reviews/`](reviews/) | Reviews and comparisons, one file per review, dated (`YYYY-MM-DD-<topic>.md`) | When the project or a part of it is assessed against something: another project, a platform, a canvas row, a vendor |
| [`architecture/`](architecture/) | Designs that are longer than a decision: `integrations.md` (principles), `integration-paths.md` (the catalogue of supported paths and their status), `capability-surfaces.md` (how one capability is exposed over REST, as a model tool and over MCP), `working-across-modules.md` (how work and data span modules without a query engine), `identity.md` | When a decision needs a design to be buildable |
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
