# D59 · The WCAG suite runs by hand until the run-up to a release

**Status:** accepted · **Date:** 2026-11-06 · **Area:** platform

**Decision.** While Clew is in its lab phase, `.github/workflows/a11y.yml` runs only through `workflow_dispatch`
(`gh workflow run a11y.yml`). Its `push` and `pull_request` triggers stay in the file as comments. Landing on `main`
does not wait for the suite, and the rule in [D51](D51-the-wcag-suite-is-cis-gate.md) to read the previous landing's
WCAG check is paused. The rest of D51 stands: a change runs the spec files it touches, and a new route, view or state
gets a test in `tests/a11y`. WCAG 2.2 AA stays a hard requirement. In the run-up to a release the triggers are
uncommented, D51's gate applies again, every failure the suite then finds is fixed, and a release is not ready until the
suite is green. The job's limit goes from 15 to 25 minutes so that a run by hand reaches its last step.

**Why.** The product owner decided on 2026-11-06 that the run should not hold up work while the product changes daily.
The run takes 12 to 14 minutes on every code push, and because the GitHub plan cannot block a merge, what held work up
was the rule to read that run before landing again. On 2026-11-06 a landing waited for run `42187541853`, which then
hit the 15-minute limit in the municipal profile step after the main suite had passed. Keeping the run and dropping
only the rule was the alternative: it would have cost no waiting and kept a signal, but it spends a run per push that
nobody reads.

**Cost.** Regressions outside the specs a change touches go unseen until someone runs the suite, so the first run in
the run-up to a release may find a backlog. A run by hand now and then keeps that backlog small. Passing the suite still
does not prove conformance; new flows need a manual pass with a screen reader.

**Replaces.** For the lab phase, the automatic run and the read-before-landing rule in D51. This record ends when the
triggers are back.
