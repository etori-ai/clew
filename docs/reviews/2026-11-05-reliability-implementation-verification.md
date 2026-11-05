# Reliability implementation checkpoint: verification

Date: 2026-11-05

Scope: the working-tree increment described in the [implementation checkpoint](../architecture/reliability-and-authorization-plan.md), including the parallel integrator documentation. This is not acceptance of the full six-phase roadmap.

## Passing checks

- `bun run check`: type checking, dependency boundaries, purity, 333 unit/web tests, four production-Node runtime contracts, generated documentation/link checks and the signed phone-book walkthrough.
- `bun run test:db`: 30 PostgreSQL cases. Coverage includes atomic approval/audit/outbox/card projection, sealed inputs/results, uncertainty during compensation, outbox leasing, unresolved work beyond the history limit and concurrent business/change-revision writers.
- `bun run test:durability`: real PostgreSQL, Temporal and an independent Node/SQLite source. Two use-case instances approve concurrently; changed-input identity reuse fails; a dropped post-commit response is reconciled; source restart preserves evidence; repeated outbox delivery does not repeat the source effect.
- Live development endpoints: readiness 200, login 303, unauthenticated thread reads 401 and public connector verification keys 200. The configured phone-book service serves protocol 2.
- Focused browser rerun: `executions.spec.ts menu.spec.ts tools.spec.ts views.spec.ts`, 38 passed and 11 explicitly gated screenshot cases skipped. This includes keyboard operation, focus retention, axe, 320-pixel reflow, pending/running/unknown action states, policy-change cache clearing and real signed connector-backed views.

## Browser-suite limits

The full 259-case run initially returned 188 passed, 37 failed and 34 skipped. It identified two issues corrected in this increment: the phone-book browser fixture still signed protocol-1 assertions, and the reflow helper treated descendants of Astryx's deliberately hidden navigation heading as visibly clipped text. The focused rerun above passed after those corrections, resolving 24 of the original failing cases.

Thirteen cases outside those corrected groups remain red: six branding/header expectations, five shell/reminder/logout cases, one ambiguous model-provider test-button locator and one standing-action link-text expectation. The earlier session-36 handover records the existing header/navigation/test baseline; this run does not establish a fully green WCAG suite. The passive profile avatar now uses Astryx's person icon, removing the pre-existing label-in-name conflict caused by visible initials.

The Docker wrapper cannot run from inside this devcontainer because the container has no Docker CLI. The suite ran directly with the same Playwright configuration and its pinned Chromium installed in the container. No manual screen-reader pass was performed. Skipped screenshot cases are not accessibility evidence.

## Work not established by this checkpoint

Calendar write/follow-up convergence, durable occurrence and refresh semantics, timer generations and cancellation during outages, persisted attention admission, complete process-death/upgrade recovery proof, and a real-source pilot remain pending. The runtime test proves response-loss recovery and source restart, not every crash boundary named in the plan. Protocol-2 connectors must be upgraded with Clew; legacy identity-bearing protocol-1 calls are intentionally rejected. The pilot source remains undecided.
