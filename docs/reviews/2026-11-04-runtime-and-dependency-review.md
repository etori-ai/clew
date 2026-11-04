# Runtime and dependency review · 2026-11-04

Requested: move Clew to Node 26 and check the other dependencies for current, compatible releases.
Based on `main` at `e403480`, the npm registry's `latest` manifests for all 30 direct external package
names, upstream release notes and compatibility declarations, and Docker Registry manifest digests.

## Outcome

Pre-merge review, 2026-11-04: Nextcloud's entrypoint preserves nonempty `custom_apps`, so image pins
alone would leave old Calendar/RoomVox code on an existing volume. The image now owns a
`before-starting` hook that validates both versions before copying either app, refreshes only those
two apps with checksum-based rsync, and runs `occ upgrade --no-interaction` before Apache starts.
A persistent pending marker makes a failed copy/migration retryable even after app metadata has
already changed; downgrade attempts fail before any copying. Other apps and meeting data are retained.
Four filesystem/process contract cases pass with real PHP and rsync in an isolated, cached
Nextcloud-derived CLI image, as UID 33, with networking disabled, a read-only root and a 256 MiB
container memory limit. The host command ran under the global supervisor; the container memory limit
is enforced by Docker, not measured by the host supervisor. The test uses a fixture `occ` process,
so this does not establish live Nextcloud database migration success. Run the contracts with
`php tests/calendar-image.php` in an environment with PHP SimpleXML and rsync. Full image rebuild
and live acceptance checks remain outstanding.

Node 26.13.0 is selected by Dockerfile and `.mise.toml` on `main`; this refresh retains that LTS line
and aligns Bun and the remaining dependency pins. Node 26 [entered LTS on 28 October](https://nodejs.org/en/blog/release/v26.13.0).
The existing owners remain: Dockerfile and `.mise.toml` select runtimes; workspace manifests select exact
package versions; Bun generates `bun.lock`. No application runtime or database major migration is included.

| Dependency | Before | After |
|---|---|---|
| Node | 26.13.0, already on main | 26.13.0 LTS retained |
| Bun | 1.4.2 | 1.4.4 |
| Astryx CLI, Core and Neutral theme | 0.7.6 | 0.7.7 together |
| `fast-xml-parser` | 5.11.2 | 5.12.0 |
| `temporal-polyfill` | 1.0.6 | 1.0.7 in both consuming workspaces |
| Legacy `@esbuild-kit/core-utils > esbuild` | 0.18.20 | 0.25.12, scoped override |
| PostgreSQL image | `17-bookworm`, previous digest | `17.11-bookworm`, current digest |
| Nextcloud image | 33.0.9-apache | 33.0.10-apache |
| Nextcloud Calendar | 6.5.4 | 6.6.4 |
| RoomVox | 1.5.0 | 1.6.1 |
| Mailpit | 1.29.3 | 1.33.0 |

All images retain immutable SHA-256 digests. Both Nextcloud app archives were downloaded and checked
against the release assets' SHA-256 digests. The Calendar 6.6.4 and RoomVox 1.6.1 `appinfo/info.xml`
declarations both support Nextcloud 32 through 35, including the retained 33 line.

Astryx's CLI now runs from its consumer, `packages/ui`, instead of depending on a manually copied Bun
cache path and hash. README uses that same command. `astryx doctor` verifies package alignment and peers;
the upgrade preview reports no codemods for 0.7.6 to 0.7.7.

## Other packages

Twenty-four direct packages were already at `latest`: `react`, `react-dom`, `react-router`, `vite`,
`@vitejs/plugin-react`, `@stylexjs/stylex`, `hono`, `@hono/node-server`, `drizzle-orm`, `drizzle-kit`,
`ai`, `@ai-sdk/openai-compatible`, `openid-client`, `jose`, `ical.js`, `@sinclair/typebox`, `ajv`,
`ajv-formats`, `tsx`, `typescript`, `@types/node`, `@types/bun`, `@types/react` and `@types/react-dom`.
`@types/node` was already on the Node 26 line. The Docker-outside-of-Docker feature is already at its
upstream version, 1.10.1.

The remaining direct package is `postgres`: keep 3.4.9. Its [4.0.0 release](https://github.com/porsager/postgres/releases/tag/v4.0.0)
rewrites pooling and protocol handling and changes parameter inference, timestamp handling, array
helpers and transaction failure semantics. Test Drizzle migrations, timestamps, transactions and audit
writes against a disposable database before upgrading it. Its major number is unrelated to the
PostgreSQL server's major number.

Newer PostgreSQL and Nextcloud major lines need a separate persistent-data upgrade. The shared Keycloak
is described as 26.2 in HANDOVER and is not owned by Clew's Compose file; upstream is now
[26.8.1](https://github.com/keycloak/keycloak/releases/tag/26.8.1). Upgrade it in the project that owns
the shared instance, with login and token-exchange checks. No shared container was changed here.

D7's Bun server migration remains pending. The Temporal polyfill stays because the calendar package
is shared with the browser and Bun scripts; Node's native Temporal does not provide those runtimes.

## Dependency audit and licences

`bun audit` initially found [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)
in the old esbuild brought in by `drizzle-kit > @esbuild-kit/esm-loader > @esbuild-kit/core-utils`.
The advisory concerns esbuild's development server; this review does not establish application exposure.
The root override applies only to that legacy parent's esbuild dependency and reuses Drizzle's own
0.25.12 version. It leaves Vite and tsx resolutions intact and removes the separate 0.18 installation.
Remove the override when Drizzle no longer pulls an affected esbuild through that legacy loader.
The final audit reports no known vulnerabilities across 263 checked packages.

`npm view <package>@<version> name version license --json` verified MIT for the selected Node, Bun,
Astryx, XML parser, Temporal polyfill and esbuild versions. Nextcloud's COPYING and both apps'
licence declarations are AGPL-3.0; Mailpit is MIT; PostgreSQL retains the PostgreSQL licence. The two
new Astryx postinstall hooks only print setup hints; Bun's default blocking remains in place, with no
new trusted dependencies.

## Validation

All local installs and checks ran one at a time under the global `run-guarded.py` supervisor. Because
no Clew devcontainer was running, checks used temporary, integrity-verified macOS binaries of exactly
Node 26.13.0 and Bun 1.4.4. This is host validation, not a Linux container smoke test.

- `bun install --frozen-lockfile --concurrent-scripts 1 --network-concurrency 4`: passes.
- `bun run typecheck`: passes.
- `bun run test:node`: four tests pass under Node through tsx: session-bound token encryption,
  JWT/PKCE, a Hono Web Request, and Stockholm meetings across daylight-saving transitions.
- `bun test --max-concurrency 1 tests/unit/nextcloud.test.ts tests/unit/proposals.test.ts`: eight tests
  pass, including real HTTP fixtures for namespaced DAV room data, CRLF iCalendar reports, busy periods
  and an unanswered attendee's explicit `unknown` state. Fixture servers close in `finally`.
- `bun run astryx doctor`: ten checks pass, no warnings or failures. Component documentation resolves
  through the root script; the upgrade preview requires no code changes.
- `drizzle-kit export --config drizzle.config.ts`: SQL is byte-identical before and after the esbuild
  override, SHA-256 `88e44102fdb85ed9c056492b684429c4da50ff0d436a8c7b738a0a1a59249513`.
- `bun audit`: no known vulnerabilities.
- `docker compose -f .devcontainer/compose.yaml --profile calendar config --quiet`: passes.

No development server, production build, full test suite, live database migration, Keycloak flow or
Nextcloud rebuild was run. Container compatibility and calendar app upgrades still need a rebuild and
live acceptance checks before deployment. Source rollback restores the previous pins and lockfile;
after applying a Nextcloud persistent-data upgrade, recovery needs the pre-upgrade volume backup.

## Upstream references

- [Bun 1.4.4](https://bun.com/blog/bun-v1.4.4)
- [Astryx 0.7.7](https://github.com/meta/astryx/releases/tag/v0.7.7)
- [fast-xml-parser 5.12.0](https://github.com/NaturalIntelligence/fast-xml-parser/releases/tag/v5.12.0)
- [Temporal polyfill 1.0.7](https://github.com/fullcalendar/temporal-polyfill/releases/tag/temporal-polyfill%401.0.7)
- [Calendar 6.6.4 compatibility](https://github.com/nextcloud-releases/calendar/blob/v6.6.4/appinfo/info.xml)
- [RoomVox 1.6.1 compatibility](https://github.com/nextcloud/RoomVox/blob/v1.6.1/appinfo/info.xml)
- [Mailpit 1.33.0](https://github.com/axllent/mailpit/releases/tag/v1.33.0)
- [Bun scoped overrides](https://bun.com/docs/pm/overrides)
