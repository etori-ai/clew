# Dependency refresh: every package and image to its newest release · 2026-11-11

Requested: bring the libraries and the development stack up to date, majors included, before much more is built on
them, and show that nothing breaks. Based on `main` at `289f73a`. The [review of 2026-11-04](2026-11-04-runtime-and-dependency-review.md)
left three majors for later (`postgres` 4, PostgreSQL 18, Nextcloud 35); this one takes them.

## Outcome

`bun outdated` reports nothing and `bun audit` no known vulnerability (524 packages). Node 26.13.0, Bun 1.4.4,
TypeScript 7.0.2, React 19.3.1, Drizzle (`drizzle-orm` 0.45.4, `drizzle-kit` 0.31.11) and FullCalendar 7.1.4 were
already the newest.

| Dependency | Before | After |
|---|---|---|
| `postgres` (postgres.js) | 3.4.9 | 4.1.1 |
| PostgreSQL image | `17.11-bookworm` | `18.6-bookworm` |
| Nextcloud image | `33.0.10-apache` | `35.0.2-apache` (PHP 8.4 to 8.5) |
| Nextcloud Calendar | 6.6.4 | 6.6.5 |
| `dependency-cruiser` | 17.4.3 | 18.7.2 |
| `@swc/core` | not declared | 1.16.22, development only |
| Playwright, package and image | 1.64.1 | 1.65.0 |
| Mailpit image | 1.33.0 | 1.33.1 |
| `@astryxdesign/core`, `theme-neutral`, `cli` | 0.7.12 | 0.7.13 |
| `@dbos-inc/dbos-sdk` | 5.4.0 | 5.5.0 |
| `ai`, `@ai-sdk/otel`, `@ai-sdk/openai-compatible` | 7.0.166, 1.0.166, 3.0.84 | 7.0.169, 1.0.169, 3.0.90 |
| `hono`, `@hono/node-server`, `jose` | 4.13.16, 2.1.6, 6.2.15 | 4.13.18, 2.1.7, 6.2.17 |
| Five `@opentelemetry/*` packages | 0.301.0 and 3.1.0 | 0.301.1 and 3.1.1 |
| `@tanstack/react-query`, `query-core`, devtools | 5.105.3 | 5.107.1 |
| `vite`, `@vitejs/plugin-react` | 8.3.5, 6.2.1 | 8.3.8, 6.3.0 |
| `rapidoc`, `read-excel-file`, `temporal-polyfill` | 12.0.0, 9.3.10, 1.0.7 | 12.2.0, 9.3.14, 1.0.8 |

RoomVox 1.6.1, `user_oidc` 8.13.0 and Approval 3.3.2 were already the newest and declare support for Nextcloud 35.
`grafana/otel-lgtm` 0.40.0 is the newest; the pinned GitHub Actions were not examined. Licences are in the
[licence record](../reference/licences.md).

## Findings

1. **The backend structure rules were not being enforced.** `bun run deps` reported "no dependency violations" over
   80 modules in every clean install, CI included; the server alone has more than 150 TypeScript files. TypeScript 7
   gives dependency-cruiser no compiler API, so it had been reading TypeScript through `@swc/core`, which nothing
   declared: it came with the Temporal worker and left the lockfile when DBOS replaced Temporal on 2026-11-09. CI
   cruised 436 modules on 2026-11-07 and 80 on 2026-11-11. A checkout whose `node_modules` predates the removal still
   had the package and still enforced the rules, which is why it went unseen. dependency-cruiser 17 said nothing;
   18 warns. Fixed: `@swc/core` is a root development dependency, `parser: 'swc'` is set in `.dependency-cruiser.cjs`
   in place of `tsPreCompilationDeps` (which 18 ties to the TypeScript compiler), and
   `tests/unit/dependency-rules.test.ts` fails when dependency-cruiser cannot read `.ts`. With the rules seeing
   everything again (673 modules, 2283 dependencies) the code has no violation: nothing slipped in during the two
   days. A planted route that imports `@clew/db` and a planted type-only import between two modules are both refused.
2. **Clew's own Nextcloud seed scripts did not run on Nextcloud 35.** Nextcloud 35 removed the server's getters
   (`OC::$server->getAppManager()` and the rest); `seed.php` and `approval-seed.php` now ask the container for the
   public interfaces. And from 35, creating a share sets up the recipient's file system at once, so within one
   process an approver reached only the first file shared with them and the second approval request was refused;
   `approval-seed.php` drops what the process has mounted before it makes the requests. Both are in the seed, not in
   Nextcloud's behaviour towards a client.
3. **Many "latest" versions were hours old.** Nineteen of the twenty-six were published within three days, `postgres`
   4.1.1 and `rapidoc` 12.2.0 within the hour. For each, the publisher, the provenance attestation and the install
   hooks were compared with the pinned version's: all but three are published from CI with provenance, as before.
   `rapidoc` gained provenance. `postgres` has none in either version and the same publisher; its 4.1.0 to 4.1.1 diff
   was read (transaction and cursor fixes, nothing else). Bun blocks install scripts. This is a check, not a
   guarantee; a waiting period before taking a release is not something the repository has, and `minimumReleaseAge`
   in `bunfig.toml` would add one.

4. **The newer browser lost two races the older one won.** The first full WCAG run on Playwright 1.65.0 failed two
   tests; neither fails with Astryx pinned back, and Playwright 1.65.0 alone on untouched `main` fails them 12 times
   in 20 where `main` fails once in 20. Both were there before and only became likely:
   - A product fault. The banner for a system that does not answer is spoken once, and it was spoken as soon as the
     statuses arrived. When `/api/areas` answered after them, a screen reader said the connector's id ("finance
     svarar inte sedan 06:00") and never the name. `useSourceBanner` now waits for that answer, or its failure,
     before it speaks. A new case in `tests/a11y/views.spec.ts` delays the areas answer; it fails three times in
     three on the old code.
   - A test's selector. `getByText('Katalogen är tom')` in `admin-competence.spec.ts` matched the heading and,
     while the empty state's words sat in the live region, the region too. It asks for the heading by role now.

## postgres.js 4 under Drizzle

4.0 rewrites everything below the public API and lets the server decide parameter types. Drizzle 0.45.4 declares
`postgres >=3` and hooks the driver by replacing its date parsers and serializers. What was done:

- An A/B probe ran the same thirty-odd Drizzle operations on 3.4.9 and 4.1.1 and compared the output: `timestamptz`
  as `Date` and as string, `date`, `jsonb` (objects, arrays, scalars, null), text and integer arrays, boolean,
  `bigint`, `numeric`, `uuid`, comparisons with `Date` values across both daylight-saving changes, raw SQL with a cast,
  upserts, `returning`, unique and not-null violations (code, constraint and table names, the `cause` chain),
  rollback on throw, savepoints, a swallowed error inside a transaction, `tx.rollback()`, parallel queries in a
  transaction and across the pool, isolation level, `for update skip locked`, a multi-statement migration. Identical
  on Node and Bun, in UTC and with both the process and the session in Europe/Stockholm, on PostgreSQL 17 and 18.
- The upgrade guide's risk is `timestamp` and `date` columns outside UTC. Clew has no `timestamp` without time zone;
  its six `date` columns are read and written as strings; raw SQL already casts (`::timestamptz`).
- `bun run test:db` (136 tests) passes on both servers, also with `TZ=Europe/Stockholm`; `bun run test:durability`
  (three workflows on the real engine) passes; `drizzle-kit generate` still reports no schema change.

4.1.1 also rejects a statement sent after its transaction ended, where 3.x ran it outside the transaction. No test
trips on it.

## PostgreSQL 18

The 18 image keeps data under `/var/lib/postgresql/<major>`, so the volume is mounted one level up and has a new name
(`postgres_18_data`); the 17 volume is left untouched. Stayed on `bookworm`: a move to `trixie` changes the C library
and with it collation order under existing indexes. Checked on throwaway servers, never the shared development
database: migrations from nothing; both suites; the recovery rehearsal of the
[runbook](../maintainers/reliability-operations.md) (`pg_dump`, `pg_restore` into a second database, same digest); a
`pg_dumpall` of a migrated 17 restored into 18, then migrations and both suites again. `scripts/postgres-upgrade.sh`
does that carry-over for a development stack and was run against a copy with a second database and role, as the
calendar's: same rows, sequences and migration history after; it refuses a target that already has Clew's schema, a
target that is not 18, and does nothing without an old volume.

## Nextcloud 35

Nextcloud upgrades one major version at a time: a volume made by 33 exits under the 35 image with that message and
its data unchanged. The calendar is synthetic, so `sh scripts/calendar.sh reset` removes the volume and the database
and `start` makes them again. On a throwaway Nextcloud 35 on PostgreSQL 18, seeded from nothing in one run:

- The CalDAV adapter contract (`tests/calendar/nextcloud-provider.test.ts`, eight cases): the same result as on 33.
- The Approval connector's recorded exchanges 01 to 26: every status and body as recorded on 33
  ([connector notes](../../connectors/nextcloud-approval/README.md#checked-against-the-development-nextcloud)).
- `php tests/calendar-image.php` on the new image's PHP 8.5: four cases pass.

## Not taken

`typebox` 1.x is the successor of `@sinclair/typebox` under another package name; 0.34.52 is the newest of the line
Clew uses and is not deprecated. Side by side on Clew's schemas' vocabulary, 1.4.6 writes JSON Schema with other key
order and another pattern for records, so the published `docs/protocol/connector-protocol.schema.json` changes; its
validation errors have another shape and other texts (`Value.Errors` returns an array of `{ keyword, instancePath,
message }` with no `First()`), which reach administrators and connector authors; and the manifest reference teaches
`import { Type } from '@sinclair/typebox'`. That is a migration with a contract in it, not a version change.

## Validation

All in the devcontainer on Node 26.13.0 and Bun 1.4.4, in a worktree, with `main` measured first as the baseline.

- `bun install --frozen-lockfile`, `bun run check` (format, typecheck, dependency rules, purity, 1105 unit tests, the
  Node runtime tests, documentation): pass. Baseline: 1104 tests; the new one is the guard above.
- `bun run build` and `bun run build:site-header`: pass. `astryx doctor`: ten checks pass; `astryx upgrade --from
  0.7.12`: no codemods.
- `bun run test:db` and `bun run test:durability` on PostgreSQL 17 and 18 with the final tree: 136 and 3, as before.
- The WCAG suite (`tests/a11y`, 53 files, one worker) on Playwright 1.65.0, from a clean frozen install as CI does
  it: 546 pass, none fail, 174 are skipped by the suite's own conditions. That is the second run; the first failed
  the two tests of finding 4. Afterwards those and the new case passed forty times in forty.

## Not verified

- The Approval loop with a token exchanged through Keycloak against Nextcloud 35: the replay signed with the seed's
  accounts. `user_oidc` 8.13.0 is unchanged and refuses a garbage token as before, but samples 27 to 31 need a login.
- The running application in a browser against the upgraded stack, and Keycloak, which this repository does not own.
- The shared development stack itself: it still runs PostgreSQL 17 and Nextcloud 33 until someone follows
  [local development](../maintainers/local-development.md#a-stack-made-before-postgresql-18-and-nextcloud-35).
- A production PostgreSQL upgrade. The dump and restore here was a development database with little in it.
