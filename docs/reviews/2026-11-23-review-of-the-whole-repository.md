# Review of the whole repository · 2026-11-23

Asked by the product owner on 2026-11-23: is anything wrong with Clew? Reviewed: `origin/main` at `9fd4c962`. The
repository was split into ten areas, each reviewed by an automated review session of its own, in two waves of five. A
coordinating session planned the areas, read the reports and checked the high findings against the code. Nothing was
changed: every session added its review and nothing else.

The product owner decided the same day that the findings are recorded and not fixed for now.
[Open findings](../maintainers/open-findings.md) lists every finding on one row and is the page to work from; this
page says what the review covered, what it found in short, and how far to trust it.

## What was reviewed

| Area | Review | High | Medium | Low |
|---|---|---|---|---|
| Identity, sessions and authorization | [review](2026-11-23-review-identity-sessions-and-authorization.md) | 1 | 3 | 6 |
| The connector boundary in the core | [review](2026-11-23-review-connector-boundary-in-the-core.md) | 1 | 6 | 6 |
| The assistant and the model boundary | [review](2026-11-23-review-assistant-and-model-boundary.md) | 1 | 6 | 6 |
| Decisions, durable execution, audit and the database | [review](2026-11-23-review-decisions-durable-execution-audit-and-database.md) | 2 | 9 | 16 |
| Baseline, build and supply chain | [review](2026-11-23-review-baseline-build-and-supply-chain.md) | 1 | 3 | 10 |
| Competence | [review](2026-11-23-review-competence.md) | 0 | 1 | 1 |
| Boarding, dialogue and talks | [review](2026-11-23-review-boarding-dialogue-and-talks.md) | 0 | 2 | 6 |
| The web app's data, state and errors | [review](2026-11-23-review-web-data-state-and-errors.md) | 0 | 4 | 9 |
| The web app's Astryx rule, interface spaces and accessibility | [review](2026-11-23-review-web-astryx-interface-spaces-and-accessibility.md) | 0 | 5 | 13 |
| The connector services in the repository | [review](2026-11-23-review-connector-services.md) | 0 | 2 | 8 |
| **All** | | **6** | **41** | **81** |

No finding is critical. The counts are the reviews' own, and a few findings are the same defect seen from two areas:
the register marks them.

Out of scope: open pull requests, the feature branches, and the connectors' real source systems, none of which was
reached. No screen was compared with its design canvas: the review of the web app does not mention the canvases.

## What it found

The baseline first. At `9fd4c962`, `bun run check`, `bun run test:db` and `bun run test:durability` pass, and the
images of D131 build and start from a clean export. The accessibility suite, which runs by hand since D59, does not
pass: 12 of 983 tests fail.

The six high findings are five defects:

- **A connector's manifest goes live with no administrator's decision and no audit row** (`CB-1`, `CB-3`, `DE-H1`).
  "Testa anslutning", every start of the server and enabling a draft store the manifest the connector's own service
  serves. The manifest decides which capabilities exist, which of other systems' reads the connector may call as the
  person, and whether it is handed the person's token.
- **An answer is drawn as Markdown that loads images from any address, and the web app sends no content security
  policy** (`AM-1`, with `ID-4` and `BL-10`). Text planted in a source can make the page send what the model read to
  an outside address, with no press.
- **A booking or a move made from the calendar page is carried out and never confirmed** (`DE-H2`). The read-back
  compares two spellings of the same instant as text.
- **A SCIM write of a group mapped to Kompetenssökning derives nobody** (`ID-1`). A person the directory takes out of
  the group keeps the read of everybody's competence.
- **The accessibility suite is red on `main`** (`BL-1`). Eight of the twelve failures are tests the interface left
  behind, two are races, and two are faults in the product that the stale tests hide.

What held, in the reviews' own words: the sign-in and the session, the execution ledger's core (one decision is one
row, nothing is sent twice), the rule that nothing the model can call executes or approves, who may read whose
competence, the Astryx rule in the web app, and the verifier every connector carries.

## Themes across the areas

Several findings from different areas are one weakness:

1. **A manifest is trusted as served.** What a connector may read through Clew and whose token it gets is its own
   say (`CB-1`, `CB-3`, `DE-H1`). The connector services review has the table of what every connector in the
   repository declares, which no administration page shows.
2. **Nothing holds what a page may load.** No content security policy, no framing rule (`ID-4`, `BL-10`), Markdown
   images from any address (`AM-1`) and link fields without a scheme rule (`CB-8`). The web data review says what a
   policy for this app has to allow.
3. **A decision is not bound to what the person was shown** (`AM-4`, `DE-M9`). The web data review says what the
   browser could send to bind it.
4. **A decision that failed or whose outcome is unknown has no way out** (`DE-M1`, `DE-M2`), and `DE-H2` puts every
   booking from the calendar page there.
5. **Erasure does not reach everything** (`DE-M6`, `BD-M1`, `BD-M2`, `BD-L3`).
6. **Tests that cannot see the fault.** The accessibility suite's stale tests and a mock that answers what the server
   never does (`BL-1`, `WA-M4`, `WA-M5`); rules that exist only as SQL in the composition root, which the unit suite
   cannot run (`DE-M4`, `DE-M7`); a test that binds a port differently from the composition root (`AM-3`).
7. **No limit on what another party sends.** A connector's answer of any size, redirects followed, a public route
   that grows the server's memory (`CB-4`, `CB-5`, `CB-6`); one unauthenticated request ends eight connector
   processes (`CS-M1`).
8. **Open source in name only so far.** The repository is public and has no licence, and `main` is unprotected
   (`BL-2`, `BL-3`).

## How far to trust it

Every review was written by an automated reviewer and says for each finding how it was established: a code path read
end to end, or a test or command whose output is quoted. The coordinating session then checked, at `9fd4c962`:

- The high findings of the first five reviews, by reading the code they name. None was run again, except that the
  suites behind `BL-1` had been run by the baseline session itself.
- `ID-2` (the return address after sign-in), by running the same URL logic: `/.//evil.example/login` comes back as
  `//evil.example/login`.
- `BL-2` and `BL-3`, against GitHub: public, no licence, no branch protection.

The second five reviews report no high finding and were not checked again. No person has reviewed any finding. Each
review also has a section "Not established" for what it suspected and could not settle, with what would settle it,
and those points are not in the register.

## Outcome

Nothing was fixed. The findings stand in [open findings](../maintainers/open-findings.md); a row is removed in the
change that fixes it.
