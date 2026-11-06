# D51 · The WCAG suite is CI's gate; a change runs its own specs locally

**Status:** accepted, the automatic run and the rule to read it paused by [D59](D59-the-wcag-suite-runs-by-hand-until-the-run-up-to-a-release.md) until the run-up to a release · **Date:** 2026-11-05 · **Area:** platform

**Decision.** The full WCAG 2.2 AA suite (`tests/a11y`, `sh scripts/a11y.sh`) is not run locally per edit. A change
runs the spec files it touches, `sh scripts/a11y.sh <spec>… --timeout 15000`, so a red run fails in seconds. The whole
suite runs in `.github/workflows/a11y.yml` on every code push and pull request, and that run is the gate. Because the
current GitHub plan cannot block a merge on a red run, whoever lands on `main` reads the WCAG check of the previous
landing before landing again, and a red check is fixed before new work lands. `workers` stays at `1` in
`tests/a11y/playwright.config.ts`. The rule in `CLAUDE.md` and [testing](../architecture/testing.md) say the same.

**Why.** Measured on 2026-11-05 at `8093725`: 287 tests on one worker, 247 passed and 40 skipped, 458 s wall clock
including the production build. A red run is far slower, since each failing test waits out its 30 s timeout, and a red
`main` costs every branch a baseline run to tell its own failures from the inherited ones; one session ran the suite in
full four times for one change for that reason. Two other ways to make the suite cheap were weighed. Parallel workers
(`'50%'`, four in the dev image) were set up and a trial started, and the product owner chose to stop it and take the
CI-only rule instead; the suite has timing-sensitive tests (`answer.spec.ts`, `branding.spec.ts`, HANDOVER session 41)
that would need several green runs under load before the default could be trusted. A smoke subset was not adopted: the
touched specs are the smoke run. Passing the suite still does not prove conformance; new flows need a manual pass with a
screen reader.

**Replaces.** The sentence in `CLAUDE.md` that a UI change is done when `sh scripts/a11y.sh` passes locally, and the
habit, recorded in several HANDOVER session notes, of a full local run per change.
