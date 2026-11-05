# Integrator documentation after upstream reconciliation

Date: 2026-11-05

Scope: finish the [integrator documentation review](2026-11-05-integrator-documentation-review.md) after implementation commits `50c7e24` and `1ac4d02`, reconciling upstream through `0c314c8`. Both histories are retained by a merge; the implementation commits are not rewritten.

## Reconciled behavior

- The integrator home, executable walkthrough, generated contract and machine context remain the default documentation path. Current guides include the committed reliability work and link directly to its acceptance evidence.
- The connector checker keeps protocol 2 signing, the separate transport key and explicit fixture governance, alongside upstream's structured administrator results. The new upstream phone-book test now uses the protocol 2 test authority. Its assertions still verify that successful source answers stay in CLI findings and out of the administrator's result rows.
- The shared shell keeps durable delivery claims and navigation to the canonical card, alongside upstream's account row, reminder bell and shared administration navigation. Browser fixtures retain both durable delivery scenarios and upstream's controlled streaming response.
- The maintainer branding guide follows the Neutral default, optional Sundsvall profile, account navigation and updated browser-test profiles. The validation guide explains the CLI/admin result distinction.
- All 53 decision files remain at their original paths. D37–D39 and D44–D46 each identify two records; the generator discovers the collisions, and current entry points require full filenames or linked titles. No historical record was renumbered or silently accepted.

## Verification

The merged tree passed `bun run check` in the devcontainer: type checking, dependency boundaries, purity, 340 unit/web tests, four Node runtime tests, generated-reference/link checks and the signed connector walkthrough. The generated decision index includes all 53 records. `git diff --check` passed.

The full browser suite on the merged Neutral default passed: 237 tests, zero failures and 34 optional screenshot cases skipped. It ran directly through the repository's Playwright configuration inside the devcontainer, using mocked APIs. This includes the shared shell, administrator check results, reminders across tabs, durable execution states and reflow. It supersedes the earlier failing browser checkpoint for this merged tree; no manual screen-reader pass was performed.

The alternate-profile check exposed a navigation race in the appearance assertion: the heading could detach before its computed style was read. The test now waits for the calendar route and polls for the same expected theme, without weakening the assertion. The final branding-file rerun passed on Neutral (8), Sundsvall (8, with its existing rail-contrast case skipped per the default-theme decision) and custom (9).

The preceding implementation's database and durability results remain dated evidence in the [handover](../../HANDOVER.md#9-session-log); this reconciliation did not rerun those suites or change the source-effect/migration implementation. A passing mock browser suite cannot establish real-source behavior, live delivery latency, manual screen-reader conformance or coordinated service recovery. The [acceptance matrix](../reference/reliability-acceptance.md) retains those release gates and leaves the real-system pilot undecided.
