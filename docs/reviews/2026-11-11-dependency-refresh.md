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
   `tests/unit/dependency-rules.test.ts` fails when dependency-cruiser cannot read `.ts`, or when a run with the real
   configuration follows no import between two TypeScript files. With the rules seeing
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
     svarar inte sedan 06:00") and never the name, and the page showed the id until the name came. `useSourceBanner`
     now waits for that answer, or its failure, before the banner is drawn or spoken. A new case in
     `tests/a11y/views.spec.ts` delays the areas answer and watches the page for the id; it fails on the old code.
   - A test's selector. `getByText('Katalogen är tom')` in `admin-competence.spec.ts` matched the heading and,
     while the empty state's words sat in the live region, the region too. It asks for the heading by role now.

5. **The documented first start did not work from nothing.** Found by running the guide's commands on a new stack
   with no volumes and no `node_modules`; none of it comes from the upgrades. The `graph` service mounts the
   workspace read-only with the `node_modules` volume inside it, so it could not start before `app` had created
   that directory, and it runs from packages that are only there after `bun install`: `compose up -d --wait` failed
   as the first command. And `bun run dev:connectors` came before `bun run auth:setup`, which creates the key the
   connectors' secrets are sealed with and the people the competence seed is for: it stopped on "Authentication
   encryption key unavailable", and where a key existed it seeded holdings for nobody. `graph` now starts after
   `app`; [local development](../maintainers/local-development.md#run-it) starts `app`, installs, starts the rest,
   and seeds the connectors after the directory; the container's create command no longer runs the connector seed,
   which could not succeed on first creation.

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

The 18 image keeps data under `/var/lib/postgresql/<major>`, so the volume is mounted one level up, under a new name
(`postgres_clusters`) because the old one holds a PostgreSQL 17 directory at its root. Stayed on `bookworm`: a move to
`trixie` changes the C library and with it collation order under indexes. Nothing is carried across from a
PostgreSQL 17 stack: development data is synthetic and seeded, so an old stack is removed with its volumes and made
again ([local development](../maintainers/local-development.md#a-stack-made-before-postgresql-18-and-nextcloud-35)).
A first version of this change had a script that copied the old databases over and a `reset` command for the
calendar; both were removed as support for something that is not a problem.

## Nextcloud 35

Nextcloud upgrades one major version at a time: a volume made by 33 exits under the 35 image with that message.
The calendar is synthetic and is seeded again with the rest. Against Nextcloud 35.0.2 on PostgreSQL 18.6:

- The CalDAV adapter contract (`tests/calendar/nextcloud-provider.test.ts`, eight cases): the same result as on 33.
- The Approval connector's recorded exchanges 01 to 26: every status and body as recorded on 33
  ([connector notes](../../connectors/nextcloud-approval/README.md#checked-against-the-development-nextcloud)).
- `php tests/calendar-image.php` on the new image's PHP 8.5: four cases pass.

## The seed, from nothing

The whole stack was made a second time beside the shared one, in a compose project of its own with no published
ports, from a copy of the tree with no `node_modules`, and the guide's commands were run in order:

- `compose up` of `app`, `bun install --frozen-lockfile`, `compose up` of the rest: every service up, `graph` healthy.
- `bun run db:init`, twice.
- `bun run dev:connectors`: eight fixture connectors registered, three follower bindings, the round of talks, the
  competence catalogue; run again, everything kept.
- The server started: the BFF listens, the durable engine launches, the connectors register, no error in its log.
- The development directory pushed through `/scim/v2` with `bun run dev:provision`: 250 people and 113 groups
  created; pushed again, 250 and 113 replaced, none created. `bun run dev:connectors` then seeded 451 holdings for
  the 250 people.
- `sh scripts/calendar.sh start`: Nextcloud 35 built, its four apps enabled, accounts, rooms and the Approval files
  seeded, 31 meetings booked across Nextcloud and the local fake of Microsoft Graph; `seed` again booked none and
  found 39.
- `bun run test:calendar` (both adapters, sixteen cases) and `bun run test:db` (136) against that stack.
- `bun scripts/connector-check.ts` against all seven fixture connectors and `nextcloud-approval`: all checks pass.

`bun run auth:setup` was not run there: it signs in to the shared Keycloak as its administrator. The key it would
have created was generated by hand, and the directory went in through `dev:provision` with a token issued by
`scripts/provisioner-token.ts`, which is the same push over HTTP.

## Not taken

`typebox` 1.x is the successor of `@sinclair/typebox` under another package name; 0.34.52 is the newest of the line
Clew uses and is not deprecated. Side by side on Clew's schemas' vocabulary, 1.4.6 writes JSON Schema with other key
order and another pattern for records, so the published `docs/protocol/connector-protocol.schema.json` changes; its
validation errors have another shape and other texts (`Value.Errors` returns an array of `{ keyword, instancePath,
message }` with no `First()`), which reach administrators and connector authors; and the manifest reference teaches
`import { Type } from '@sinclair/typebox'`. That is a migration with a contract in it, not a version change.

## Validation

All in the devcontainer on Node 26.13.0 and Bun 1.4.4, in a worktree, with `main` measured first as the baseline.

- `bun install --frozen-lockfile`, `bun run check` (format, typecheck, dependency rules, purity, 1106 unit tests, the
  Node runtime tests, documentation): pass. Baseline: 1104 tests; the two new ones are the guard above. One test in
  `tests/unit/approval-loop.test.ts` began to fail on every branch at 12:45 UTC the same day: it runs on the wall
  clock with a token that expired a day after the test was written. The token now lasts as long as its session.
- `bun run build` and `bun run build:site-header`: pass. `astryx doctor`: ten checks pass; `astryx upgrade --from
  0.7.12`: no codemods.
- `bun run test:db` and `bun run test:durability` on PostgreSQL 17 and 18 with the final tree: 136 and 3, as before.
- The recovery rehearsal of the [runbook](../maintainers/reliability-operations.md) on PostgreSQL 18 (`pg_dump`,
  `pg_restore` into a second database): the same digest.
- The WCAG suite (`tests/a11y`, 53 files, one worker) on Playwright 1.65.0, from a clean frozen install as CI does
  it: 546 pass, none fail, 174 are skipped by the suite's own conditions. That is the second run; the first failed
  the two tests of finding 4. Afterwards those and the new case passed forty times in forty, and the eleven specs
  that draw the banner were run again after it learnt to wait: 209 pass, none fail.

## Not verified

- `bun run auth:setup` on the new stack, and with it a sign-in: it needs the Keycloak administrator.
- The Approval loop with a token exchanged through Keycloak against Nextcloud 35: the replay signed with the seed's
  accounts. `user_oidc` 8.13.0 is unchanged and refuses a garbage token as before, but samples 27 to 31 need a login.
- The application in a browser against the upgraded stack.
- The shared development stack itself: it still runs PostgreSQL 17 and Nextcloud 33 until someone removes it and
  follows [local development](../maintainers/local-development.md#a-stack-made-before-postgresql-18-and-nextcloud-35).
- The first start through an editor's "reopen in container": there every service starts before the packages are
  installed, so `graph` stops and is started again with `sh scripts/compose.sh up -d`.
- A production PostgreSQL upgrade. Nothing here moves real data between major versions.
