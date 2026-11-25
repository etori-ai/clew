# Baseline, build and supply chain: `origin/main` at `9fd4c962`

Date: 2026-11-23. Asked by the product owner as one of ten areas of a review of the whole repository. This is area
5: what passes and what fails on `main` today, how the product is built and what it is built from, and the
documentation that spans the other areas. It is a review only: nothing in the product, the tests, the scripts or the
existing documentation was changed.

Scope: `origin/main` at `9fd4c962`, read and run in a worktree of its own. Method: every suite was run by the session
that wrote this, in the devcontainer or in containers of its own; every finding below was established by a command
whose output is quoted or by reading the code path named. Two readings were delegated to automated readers that saw
only the code (the eight `proposed` records, and the causes of the failing accessibility tests); what they reported
was checked against the files they cited before it was used. No person has reviewed the findings.

## Summary

- **The automatic lanes are green and reproduce locally**: `bun run check`, `bun run test:db` and
  `bun run test:durability` pass at `9fd4c962`, with no skipped or todo test in any of them, as the four workflows
  that run on a push did on GitHub.
- **The accessibility suite is red.** Of 983 tests that run, 971 pass and 12 fail; ten of the twelve also fail when
  run alone. Eight are tests that changes to the interface left behind, two are faults in the product (a scroller a
  keyboard cannot reach on a phone, and a skipped heading level), and two are races in the tests. The suite has been
  run by hand only since D59, and its last recorded workflow runs (2026-11-19) failed too.
- **Clew is not yet open source in law, and its default branch is open.** The repository is public and has no
  licence file; `main` has no protection, so no check is required before a change lands.
- **The images of D131 build from a clean export and run as documented.** Seven of the connector images that
  `scripts/images.txt` lists do not start as built.
- **The dependency record holds with small gaps.** Every direct version is exact, every install uses the frozen
  lockfile, `bun audit` is clean for the product, and nothing in the web app, the protocol viewer or the
  documentation site is fetched from another host. One transitive package under a licence the OSI has not approved
  is not in the record.

Findings: 1 high, 3 medium, 10 low. The repository is public, so this document is public once its branch is pushed.

## Baseline

Everything ran on the worktree at `9fd4c962` (`git rev-parse --short HEAD`), inside `clew-app-1` unless the row says
otherwise, after `bun install --frozen-lockfile` (702 packages, 4.7 s, "Blocked 4 postinstalls").

| Suite | Command | Result | Duration | Failures |
|---|---|---|---|---|
| Format, types, dependency rules, purity, unit suites, Node runtime tests, documentation check | `docker exec -w /workspace/<worktree> clew-app-1 bun run check`, in a shell that had not read `apps/server/.env.local` | **Pass**, exit 0. Prettier clean; `tsc` clean; depcruise "no dependency violations found (889 modules, 3353 dependencies cruised)"; purity clean; unit: 2600 pass, 0 fail, 38 249 `expect()` calls, 180 files; `test:node`: 20 pass, 0 skipped, 0 todo; `docs:check`: "20 generated files, 155 decisions, 325 documents; local links checked", smoke passed | 69 s (the unit suites 51 s) | None |
| Migrations on an empty database | `bun run db:init` with `DATABASE_URL` pointing at a throwaway PostgreSQL (`postgres:18.6-bookworm` by the digest in `.devcontainer/compose.yaml`, on `clew_default`, data on tmpfs), after sourcing `/workspace/apps/server/.env.local` in the same shell | **Pass** | 1 s | None |
| Store contracts on PostgreSQL | `bun run test:db`, same shell and database | **Pass**, exit 0: 409 pass, 0 fail, 3054 `expect()` calls, 56 files, none skipped | 25 s | None |
| Durable engine | `bun run test:durability`, same shell and database | **Pass**, exit 0: 11 tests in 9 files, 0 skipped, 0 todo | 159 s | None |
| WCAG 2.2 AA suite, profile `neutral` | From the worktree's root on the host: `docker compose -p clew-review5 -f .devcontainer/compose.yaml --profile a11y run … a11y node_modules/.bin/playwright test -c tests/a11y`, after `bun install --frozen-lockfile` in the same project's volume | **Fail**, exit 1: 971 passed, 12 failed, 176 skipped | 29.3 min on one worker | Twelve, listed under finding 1 |
| The other two brand profiles, as the workflow runs them | The same with `-e CLEW_A11Y_BRAND_PROFILE=sundsvall` and `=custom`, `branding.spec.ts` | **Pass**: 11 passed each | 12 s each | None |
| Documentation site | `bun run docs:site` | **Pass** | 17 s | None |
| Known vulnerabilities | `bun audit` (Bun 1.4.4) at the root, and in `site/` | Root: "No vulnerabilities found (checked 758 packages)". `site/`: 9 (1 high, 7 moderate, 1 low) | under 1 s | Finding 11 |
| The connector quickstart's check | `connectors/hello` in a container of its own on `clew_default`, then `bun scripts/connector-check.ts http://<container>:4010 --id hello --secret local-docs-only-transport-key` | **Pass**: "All checks passed.", two expected warnings on the read that calls back into Clew | 2 s | None |
| The images of D131 | `docker build -f apps/server/Dockerfile … --build-arg CLEW_RELEASE=9fd4c962 .` and `docker build -f apps/web/Dockerfile … .` on a `git archive` of the commit | **Pass**: server 1.11 GB, web 25 MB. As uid 12345 in group 0: `bun run db:init` migrated an empty database, the server launched the engine under release `9fd4c962` and answered `/api/health` and `/api/ready` with 200; the web image served `/`, answered an unknown path with `index.html` and passed `/api/` and `/scim/` on | 69 s and 14 s | None |

Notes on the baseline:

- **GitHub agrees with the automatic lanes.** For `9fd4c962` the workflows Check, Reliability, Documentation and
  Documentation site all concluded `success` (push, 2026-11-23). The WCAG workflow's last three runs, on 2026-11-19,
  concluded `failure`, `failure` and `cancelled`; it has not run since D130 (PR 83) or the phone view (PR 94).
- **Skipped tests.** All 176 skipped tests are the thirteen `tests/a11y/screens.*.spec.ts` files, which take
  screenshots only when `CLEW_SCREENS` is set and assert nothing by design. Nothing else in the repository is
  skipped, `todo`, `only` or conditional, and no other test file is without an assertion.
- **A lane nothing runs.** `bun run test:calendar` (`tests/calendar`, two files: the calendar adapter contract on
  Nextcloud and on the fake of Graph as a service) is in no workflow and not in `bun run check`. It was not run
  here either: it needs the shared calendar stack and writes to it.
- **Every server test file is in a lane.** The fourteen files under `apps/server/tests` are the five of `test:node`
  and the nine of `test:durability`.
- **The suite is longer than the documentation says.** `docs/maintainers/local-development.md:79` says the whole
  WCAG suite takes "about eight minutes"; it took 29.3 minutes on one worker, as `scripts/a11y.sh` runs it. The
  workflow splits it in three shards with a 25-minute limit each.
- **From a worktree, `sh scripts/a11y.sh` uses the main checkout's packages.** `.devcontainer/compose.yaml` names its
  project `clew`, so the suite mounts the stack's `node_modules` volume over the worktree's. A project name of its
  own (`-p`) gives the worktree its own volume, which is how the suite was run here.

## Findings

### High

#### 1. The accessibility suite is red on `main`, and eight stale tests hide two faults in the product

`CLAUDE.md` makes WCAG 2.2 AA a hard requirement: a UI change is not done until the specs it touches pass. At
`9fd4c962` twelve tests fail in the whole run. Each was then run alone (`playwright test -c tests/a11y
<file>:<line>`): ten fail again, and two pass alone and in four repeats. The cause of each was then read in the code
and its history, by an automated reader that saw only the code, and checked here at the lines the table names:

- **Eight are tests that changes to the interface left behind** (1–4, 7, 9–11). Seven follow from one change, D126's
  amended item 13 and its new Hem (PR 76, `ee6bca67`, 2026-11-16: one status vocabulary, a notice under the title
  in place of the receipt banner, no composer on Hem), which updated a sibling spec (`tests/a11y/item.spec.ts:190`)
  and not these. One follows from PR 94 (2026-11-23), which changed the key figures on a phone on purpose and left
  the spec that measures them.
- **Two are faults in the product** (6 and 12): axe violations in pages as they are built.
- **Two are races in the tests** (5 and 8): they fail under the load of a whole run and pass alone.

| # | Test | Alone | Cause | What failed, and why |
|---|---|---|---|---|
| 1 | `action-dialog.spec.ts:61` | fails | Test | The receipt's headline is now the status notice's title, drawn without its full stop (`apps/web/src/status-of.ts:65`, `bare`); the test asks for "Samtalet är registrerat i personalsystemet." with it (`:118`). The next assertion would fail for the cause of 3. |
| 2 | `action-dialog.spec.ts:319` | fails | Test | As 1: "Ansökan är godkänd." (`:344`). |
| 3 | `action-dialog.spec.ts:441` | fails | Test (fixture) | Since PR 76 a receipt's rows are a list only when they say something or there is more than one (`apps/web/src/components/work/work-item.tsx:135-138`). The mock's decided item has no rows and a one-row receipt (`tests/a11y/support.ts:2045-2069`); the server would give it one row naming the person (`apps/server/src/modules/entities/actions.ts:124-133`), so the fixture is not what the server makes. |
| 4 | `action-dialog.spec.ts:725` | fails | Test | A queued decision is now a notice, "Ditt beslut är sparat" with a description (`status-of.ts:157-164`); the test wants the earlier single sentence (`:747-749`). |
| 5 | `admin-appearance.spec.ts:48` | passes | Test (race) | Astryx's `FieldStatus` also says its message through the polite live region, which holds the text for 2 s; meanwhile the exact-text locator (`:60`) matches both, and strict mode throws at once rather than retrying. The product does what it should. The suite's own remedy is `drawn()` (`admin-boarding.spec.ts:25-27`), which leaves out `[aria-live]`. |
| 6 | `admin-boarding.spec.ts:184` | fails | **Product** | axe `scrollable-region-focusable` (WCAG 2.1.1, level A) at 375 × 667, the first check (`:189`). On a phone the page frame makes the column the scroller (`apps/web/src/components/shell/page-frame.tsx:345`) and nothing in it takes focus: the page's two controls are in the header and the column is plain list rows. `PageFrame` has `scrollTabStop` for this (`:333`); `AdminFrame` does not pass it. Chromium makes such a scroller focusable on its own and Safari does not, so a keyboard user of Safari cannot scroll the layers. |
| 7 | `boarding.spec.ts:436` | fails | Test | As 1: "Beställningen är lagd hos IT-servicedesken." (`:488`). |
| 8 | `card-actions.spec.ts:18` | passes | Test (race, not pinned) | ArrowRight did not open "Flytta till". The same sub-menu is reached in `keyboard.spec.ts:26-41`, which waits for the pane to settle and passed in the same run; this test does not wait and places focus with `.focus()`. Two deferred focus moves can take focus under load: the pane's heading (`apps/web/src/pages/todo.tsx:316-332`) and Astryx's menu, a frame after it opens. |
| 9 | `reflow.spec.ts:161` | fails | Test | `dockOf` (`tests/a11y/support.ts:2582-2587`) finds Hem's docked composer as the first combobox. Hem has had no composer since PR 76, so it finds the search palette's input inside a closed `<dialog>`, whose box is zero. |
| 10 | `structure.spec.ts:486` | fails | Test | PR 94 gives a key figure a row of its own under 480 px (`packages/ui/src/components/measures.tsx:19-33`; D130's amendment of 2026-11-23, item 3), so that "−2,1 mnkr" no longer breaks (1.4.10). The spec still wants two by two at 375 px (`:497-501`), as do `docs/reference/layout-measures.md:40` and D130's text on Att göra. |
| 11 | `undo.spec.ts:57` | fails | Test | The Status column draws the vocabulary's word "Väntar" with no detail (`packages/ui/src/status-words.ts:28-33`, `status-of.ts:273-279`); the test wants "Väntar på andra · " (`:87`). |
| 12 | `views.spec.ts:255` | fails | **Product** | axe `heading-order` (a best-practice rule the suite enables, not itself an AA criterion) on the week's own page, `/tools/calendar.week`. `PanelBody` draws the week with `dayHeadingLevel={3}` (`apps/web/src/components/views/panel.tsx:273`), a level chosen when the read stood under a level-2 panel title; since D126 rule 3 it is a page whose title is the h1, so the day headings skip level 2. The heading itself dates from 2026-11-06. |

Scenario: with eight assertions out of date the suite is red whatever a change does, so it no longer tells anyone
when a change breaks a flow, and the two real faults sit among the stale ones. On a phone, a keyboard user of Safari
cannot scroll the layers of Administration › Introduktion och avslut (6); a screen reader user meets a heading
outline that skips a level on the week's own page (12). Some of this was known. PR 94's review
(`docs/reviews/2026-11-23-the-mobile-view.md:86-91`) records 9 and 11 as failing on `main` and the race of 5, and
the change landed beside them, as D59 allows while the full suite runs by hand. D59 also says the product is not
ready to ship until the suite is green.

Severity: high: a hard requirement whose one automated check has stopped telling faults from stale tests.
Established by the whole run (`exit 1`, 29.3 min), the reruns alone, and the code at the lines the table names.

### Medium

#### 2. The repository is public and has no licence

There is no `LICENSE`, `LICENCE` or `COPYING` file in the tree (`git ls-files` finds only
`docs/reference/licences.md`, the record of what Clew depends on), no `license` field in any `package.json`, and
GitHub reports `licenseInfo: null` for a repository whose visibility is `PUBLIC`. `CLAUDE.md` opens its first rule
with "Clew is an open source system that will be shared with other municipalities and governments to use as they
will".

Scenario: another municipality clones the repository, or pulls an image a pipeline built from it. Without a licence
nothing grants them the right to run, change or pass on the code, so the default of copyright applies: all rights
reserved. Every contribution made meanwhile is also made under no stated terms.

D131 says in passing that "the repository has no licence file yet"
(`docs/decisions/D131-clew-builds-a-server-image-and-a-web-image-from-the-repository-root.md:43`), but
`docs/maintainers/open-questions.md` does not list it, so it waits for nobody.

Severity: medium. Established with `git ls-files`, `grep '"license"'` over every `package.json`, and
`gh repo view --json visibility,licenseInfo`.

#### 3. `main` is unprotected, so no check is required before a change lands

`gh api repos/{owner}/{repo}/branches/main/protection` answers 404 "Branch not protected", the repository has no
rulesets, and `rules/branches/main` lists no active rule from the organisation either. Of the last 100 first-parent
commits on `main`, 34 are pull request merges; the others were pushed directly (the newest is `af57467a`,
2026-11-20, which changed the calendar page, its theme and its WCAG spec). The Pages workflow publishes the documentation from `main` on every such push.

Scenario: a change that fails `bun run check`, or a maintainer account that is taken over, reaches `main` and the
published site with nothing in the way. The workflows report afterwards; they do not gate. `CLAUDE.md` says
"`bun run deps` … fails the build on a violation", which is true of the workflow run and of nothing that decides
whether the change lands.

Also read from the same API, as they stand: the default workflow token is read-only, there are no repository
secrets, a first-time contributor's workflow run needs approval, Actions may use any action (`allowed_actions:
all`, `sha_pinning_required: false`), and secret scanning, push protection and Dependabot security updates are
disabled.

Severity: medium. Established with the `gh api` calls named, and `git log origin/main --first-parent`.

#### 4. A new checkout cannot be started as documented: Keycloak is not in the repository

`docs/maintainers/local-development.md:16` starts the identity provider with `docker start keycloak`, "the shared
local Keycloak 26.2 at keycloak.orb.local:8090". Nothing in the repository creates that container:
`.devcontainer/compose.yaml` has no such service, no document gives a `docker run` for it, and no file names its
image (`git grep -E "quay.io|keycloak/keycloak"` finds nothing outside the history folders). On the machine this
review ran on it is `quay.io/keycloak/keycloak:26.2`, a tag that moves, started outside the repository.

The host name is not incidental. `apps/server/src/auth.ts:66-69` treats the installation as local, and so allows
HTTP and the development sign-in, only when the issuer's host is exactly `keycloak.orb.local`; the compose file
maps that name to the host for the containers (`.devcontainer/compose.yaml:30,107`), and `.orb.local` is a name that
OrbStack resolves on the host by itself. With another container runtime the browser needs an entry in the hosts
file, which no document mentions.

Scenario: a developer at another municipality follows `README.md` to local development. Steps 1 to 4 work; step 5
fails with "No such container: keycloak"; `bun run auth:setup`, the seed and the sign-in all depend on it. The
licence record names Keycloak (Apache-2.0) but no version, and the image is the one service of the development
stack that is neither pinned nor described.

Severity: medium. Established by reading the compose file and the guide, `git grep`, `docker inspect keycloak`, and
`apps/server/src/auth.ts`.

### Low

#### 5. Seven connector images do not start as they are built

`connectors/hr/Dockerfile:5` sets `FIXTURE_DB=/data/hr.sqlite` and the image runs as `USER node`, but the image has
no `/data`. The same holds for `finance`, `incidents`, `communication`, `timesheet` and `servicedesk`
(`FIXTURE_DB=/data/…`) and for `reference` (`REFERENCE_DB=/data/reference.sqlite`,
`connectors/reference/Dockerfile:4`); each opens its SQLite file with `new DatabaseSync(path)` when it starts. All
seven are in `scripts/images.txt`. (`payroll` sets no path and refuses to start with "A persistent SQLite path is
required (FIXTURE_DB)", `connectors/payroll/state.mjs:33`, which at least says what is missing.)

Reproduced on images built from the clean export:

```text
$ docker run -e CLEW_CONNECTOR_SECRET=… -e CLEW_URL=http://app:3000 clew-connector-hr
file:///connector/state.mjs:35
  const db = new DatabaseSync(path);
Error: unable to open database file            (exit 1)
```

The result is the same with a new named volume on `/data` (`-v <volume>:/data`): Docker creates the mount point
owned by root and `node` cannot write to it. The `reference` image fails the same way at `connector.mjs:78`.
`connectors/reference/README.md` says "Mount the database directory when running the image"; that works only where
the platform makes the mount writable for the container's user, which is presumably why the ten images of the
development stack answer on the OpenShift test cluster that `docs/reference/status/operations.md` describes. In the
development stack itself the fixtures do not use these images: they run `node server.mjs` from the workspace as
root with `/state` volumes.

Severity: low (fixtures and the durability reference, for test installations). Established by building and running
the images.

#### 6. `.dockerignore` lets the development stack's credentials into the server image

`.dockerignore:16-17` excludes `**/.env` and `**/.env.*`. `bun run auth:setup` writes its results to
`.auth-test.env` at the repository root (`scripts/auth-setup.ts:68`), which matches neither pattern; `.gitignore:8`
names it separately for that reason. `apps/server/Dockerfile` copies the whole context (`COPY . .`).

A build with the repository's `.dockerignore` and three dummy files showed which of them reach the context:

```text
./.auth-test.env        (copied)
.env, apps/server/.env.local   (excluded)
```

Scenario: a developer who has run the development stack builds the server image "on the host and from the
repository root", as `scripts/images-build.sh` says, and pushes it to a registry. The image holds
`/app/.auth-test.env` with the keys `MASTER_KEY`, `OIDC_CLIENT_SECRET`, `DEV_PROVISIONER_TOKEN`,
`HELLO_CONNECTOR_SECRET` and four `TEST_<PERSONA>_PASSWORD` of that workstation's stack. The file is mode 600 and
owned by root, so the running server (uid 1000) cannot read it, but anyone who can pull the image can. A build from
a clean checkout, as a pipeline makes it, is not affected.

Severity: low (development values, and only from a developer's checkout). Established by the test build and by
reading the two ignore files.

#### 7. A dependency under a licence the OSI has not approved is not in the record, and it is in the server image

`caniuse-lite` 1.0.30001820 declares `CC-BY-4.0`. It comes in through one path only: the root development
dependency `@astryxdesign/cli` 0.7.13, then `@babel/core`, `@babel/helper-compilation-targets` and `browserslist`.
`docs/reference/licences.md` does not mention it, while its entry of 2026-11-18 records the decision to keep the CLI
at 0.7.13 precisely because 0.7.16 would add `mdn-data` under CC0-1.0, "a licence the OSI has not approved".
`CLAUDE.md` asks that every dependency carry an OSI-approved licence and that the result be recorded.

Because the server image installs the development dependencies (D131 item 2), it ships the package:
`/app/node_modules/.bun/caniuse-lite@1.0.30001820` is in the image built here, beside `@playwright/test` and the
Astryx CLI.

Four direct development dependencies are also missing from the record, all MIT: `@types/bun` 1.4.4, `@types/node`
26.6.6, `@types/react` 19.3.0 and `@types/react-dom` 19.3.0.

Everything else that is installed (702 packages on this platform) declares MIT, Apache-2.0, ISC, BSD, MPL-2.0,
OFL-1.1, Unlicense, 0BSD, or a choice that includes one of them; `css-mediaquery` 0.1.2 declares "BSD" and its
licence file is the three-clause text.

Severity: low. Established by reading the `license` field of every installed package and tracing the lockfile's
dependency edges from each direct dependency.

#### 8. The web image passes on third-party code and a typeface without their licence notices

The files the web image serves (`/usr/share/nginx/html`, 33 files) contain one licence notice: the Apache header of
the pdf.js worker. There is no notice for React, Astryx, StyleX, FullCalendar, TanStack, Heroicons, `ical.js`
(MPL-2.0), `docx-preview` (Apache-2.0), `intl-messageformat` (BSD-3-Clause) or the others bundled, and none for
Raleway, whose five font files are served under the SIL Open Font License. MIT, BSD, Apache-2.0 and the OFL all ask
that the notice travel with copies. The record already does this for one package: Scalar's notice ships as
`apps/server/licences/scalar-MIT.txt`.

Severity: low while no image is published. Established by copying the served files out of the built image and
searching them for licence text.

#### 9. The web image carries Sundsvall's trademark although the build is said to carry no branding

`apps/web/Dockerfile:7` and D131 item 4 say "The build carries no setting and no branding (D98), so one image serves
every environment". The image serves `/branding/sundsvall-dragon.png` and `/branding/sundsvall-dragon-white.png`:
they are in `apps/web/public/branding/`, which Vite copies into every build. The folder's own README says the dragon
is Sundsvalls kommun's registered trademark (registration 257562), "not an open-source dependency or a grant to use
the symbol for another organisation", and that the two files are there for the development stack.

Scenario: another municipality's installation, built from the repository, publishes Sundsvall's trademark at its own
address; and one that registers the `intranet` fixture connector shows it as its header logo, since
`connectors/intranet/menu.json:4` names that file.

Severity: low. Established by listing the files of the built web image.

#### 10. The web image sets no security headers

`apps/web/nginx.conf.template` adds only `Cache-Control`. The built image answers `/` with no
`Content-Security-Policy`, no `frame-ancestors` or `X-Frame-Options`, no `Strict-Transport-Security`, no
`X-Content-Type-Options` and no `Referrer-Policy` (headers read with `curl -D -`). The proxy example in
`docs/guides/scim-sign-in-and-hosting.md` has the same gap, and the server sets such headers only on a few of its
own answers (`apps/server/src/context.ts:11`, the document and appearance routes).

Scenario: the session cookie is `SameSite=Lax` (`apps/server/src/auth.ts:99`), so a page on another site cannot
frame Clew signed in. A page on a sibling address of the same registrable domain can, and Clew is where a person
approves a write. Without a policy the browser also enforces nothing of the rule that the web app loads no script or
font from another host.

Severity: low. Established by starting the image and reading the response headers.

#### 11. The documentation site's lockfile pins versions with known advisories, and nothing audits automatically

`bun audit` in `site/` reports nine advisories (one high, seven moderate, one low) against `vite` 5.4.21 and
`esbuild` 0.21.5, which `vitepress` 1.6.4 brings. All nine concern Vite's development server or its editor launcher,
so the built site is not affected; `bun run --cwd site dev` on a maintainer's machine is. The root workspace
overrides the same `esbuild` advisory for Drizzle (`package.json`, `overrides`); `site/package.json` has no
override. The licence record's "`bun audit`: no known vulnerabilities" was true of the root lockfile only.

No workflow runs `bun audit`, and Dependabot security updates are off, so a new advisory against a pinned version
is found when someone remembers to look; the record's last audit is dated 2026-11-11.

Severity: low. Established with `bun audit` in both folders.

#### 12. Connector base images are pinned by tag and named without a registry

All eighteen `connectors/*/Dockerfile` begin `FROM node:26.13.0-bookworm-slim`, and the fixture services of the
development stack use the same reference (`.devcontainer/compose.yaml:6`). The server and web images name
`docker.io/library/node:26.13.0-bookworm-slim@sha256:add5c17c…` with the comment "buildah and podman refuse a short
name" (`apps/web/Dockerfile:10`, D131 item 2). So by the repository's own account the connector images build with
Docker but not with buildah as it comes, and their base can change under an unchanged tag.

Also unpinned by content, in three Dockerfiles and the WCAG workflow: `npm install --global bun@1.4.4` fixes the
version but not the package's integrity.

Severity: low. Established by reading the Dockerfiles.

#### 13. The dependency gate does not look at `apps/web`, and one violation is on `main`

`bun run deps` cruises `apps/server/src packages connectors scripts tests/unit` (`package.json`). The rule
`clew-does-not-import-connectors` in `.dependency-cruiser.cjs:91-96` is written for everything under `apps/` and
`packages/`. Run over the folders the script leaves out, the same configuration reports:

```text
error clew-does-not-import-connectors: apps/web/tests/protocol-preview-model.test.ts → connectors/hr/connector.mjs
x 1 dependency violations (1 errors, 0 warnings). 851 modules, 3974 dependencies cruised.
```

(`depcruise --config .dependency-cruiser.cjs apps/web/src apps/web/tests apps/server/tests tests/db tests/a11y
tests/calendar`). It is the only violation there, in a test.

Severity: low. Established by running the tool.

#### 14. Documents that span areas say things the repository no longer holds

- **Twenty decision numbers name two records, not eleven.** `docs/reference/status.md:29` says "Eleven numbers name
  two records each: D37–D39, D44–D46, D85, D96 and D99–D101". The files in `docs/decisions/` and the generated
  `duplicateDecisionNumbers` in `docs/context.json` give twenty: those eleven and D116 to D124. `CLAUDE.md` is right.
- **"Protocol 2" survives D129.** `PROTOCOL_VERSION` is 1 (`packages/connectors/src/protocol.ts:77`) and a manifest
  on any other number is refused. `docs/reference/connector-protocol.md:183` still says "Protocol 2 also supports
  `document`, `record`, …", `docs/guides/document-and-semantic-views.md:3` says D79 "extends protocol 2",
  `docs/reference/status.md:39` says "D44 (protocol 2 authority)", and the status entry is still titled "Protocol 2
  authority" (`docs/reference/status/identity.md:49`) above a text that says protocol 1 is current.
- **`CLAUDE.md` names a command that does not work where it says commands run.** "Read `bunx astryx component
  <Name>`" from `/workspace` answers "Error: Could not find @astryxdesign/core package". It works from
  `packages/ui`, and as `bun run astryx component <Name>`, the script `package.json` has for it.
- **`CLAUDE.md` says FullCalendar is "imported in `packages/ui/src/calendar.tsx` alone".**
  `packages/ui/src/calendar-theme.ts:1-2` imports it too (a type and `joinClassNames`).
- **`CLAUDE.md` says "nothing in `apps/` or `packages/` imports a connector".** `apps/server/src/routes/protocol.ts:8-9`
  imports the manifests of `hello` and `phonebook` as the served protocol's examples. The cruiser's rule makes that
  file its one exception and attributes it to D60; the sentence in `CLAUDE.md` does not.
- **`docs/maintainers/local-development.md`**, beside the Keycloak step of finding 4: line 79 gives the suite eight
  minutes (29 measured); line 82 gives the fixture connectors 4040 to 4046, where `.devcontainer/compose.yaml`
  publishes 4040 to 4044 and 4046 (not 4045), and also 4048, 4049 and 4051 to 4054 (among them `nextcloud-approval`
  and `moodle-connector`) and the telemetry stack on 3023, none of which the line names; line 25 says the sign-in
  page "lists the four" after naming five accounts, and `sara.nystrom` gets a sign-in account like the personas
  (`scripts/provisioner/directory.ts:236-239`, `scripts/auth-setup.ts:347-353`).
- **The trailing slash.** `llms.txt` and the guides give `/api/protocol`; `/api/protocol/` answers 401 with the
  expired-session message instead of the public page (`curl` against the development server).

Severity: low. Established by reading each passage beside the code or the command's output.

## The eight `proposed` records: what the code does today

`docs/maintainers/open-questions.md` asks for the owner's word on eight records. This is what the code does at
`9fd4c962` for each, read by following the record's items into the code. No status was changed. D19 and D55 still
say "Temporal" where the engine has been DBOS since D85.

| Record | What the code does today | Where |
|---|---|---|
| [D18 errands](../decisions/D18-errands-are-a-clew-owned-passthrough-domain.md) | **Replaced in shape, partly built.** There is no `packages/errands`, no `ErrandProvider` port and no `errand.*` capability set. A connector's read named `<id>.errands` is an errand source, and the core joins them into `clew.errands` (D35, D89). SupportManagement is a connector with two reads and no write; the second source is `connectors/pob`, not CaseData. Executes with `If-Match`, an `errand` chip kind and "bevaka" are not built. Identity is the person's delegated token, not a service credential with `X-Sent-By`. The status line says the hosting and the identity were replaced; the body still describes them. | `packages/connectors/src/index.ts:333`, `apps/server/src/modules/errands/usecases.ts:34`, `apps/server/src/connectors/registry.ts:66,97`, `connectors/supportmanagement/manifest.mjs:57,104,144-147` |
| [D19 change notification](../decisions/D19-change-notification-is-a-clew-owned-contract.md) | **Not built.** No ingest route, no event table, no HMAC registration; "cloudevent" and "webhook" match nothing in `apps`, `packages`, `connectors`, `scripts` or `tests`. Polling, the record's fallback, is the only path: scans run from `refresh_request` rows. D47 and D55 both say they leave D19 proposed. | `apps/server/src/main.ts:95-136`, `packages/db/src/schema.ts:826`, `apps/server/src/threads/usecases/refresh.ts:30` |
| [D26 questions over documents](../decisions/D26-questions-over-documents-are-search-not-knowledge.md) | **Built.** `SearchHit`, the composite `clew.search` with its budgets, the router's catch-all, the `document` chip, the card from an answer, the citation prompt and the Eneo connector with the exchanged token exist. Follow-ups are a trailing text line parsed in code, not a structured field. The record's sentence that scans carry no token no longer holds: a delegating connector is scanned with the person's token when a live session asked. No run against a real Eneo is established by the code. | `packages/contracts/src/index.ts:404-411,1072-1098`, `apps/server/src/modules/search/usecases.ts:34-61`, `apps/server/src/assistant/index.ts:446-463`, `apps/server/src/assistant/answer.ts:8,36-55`, `connectors/eneo/connector.mjs:30,50,101,347`, `packages/connectors/src/index.ts:1304-1313` |
| [D37 connectors declare what they use](../decisions/D37-connectors-declare-what-they-use-and-a-capability-name-is-its-contract.md) | **Partly built.** `uses` exists (a list of names, not objects) and is enforced on a callback; output is validated on every capability run. Not built: `deprecated: { replacedBy, until }`, the compatible/breaking/removed verdict per dependent, the audit row at a boot refetch, `degraded` health, dependents on the administration page, `connector-check --clew`. An in-process call outside `uses` answers not-found where the record says `denied`. | `packages/connectors/src/protocol.ts:457-464`, `apps/server/src/routes/connector-callback.ts:89-91`, `packages/connectors/src/index.ts:988-989,1056-1058`, `apps/server/src/connectors/usecases/admin.ts:590-616`, `apps/server/src/connectors/remote.ts:115-118` |
| [D55 a job across systems](../decisions/D55-a-job-is-assembled-from-what-connectors-follow-approved-once-and-run-per-system.md) | **Built on the server, not in the interface.** `facts`, `follows` and `creates`, the assembler, one approval creating one execution or watch per step, the watch workflow and the bindings table exist (refined by D77, the engine replaced by D85). The assembler is reached only by `POST /api/jobs/assemble` and bindings only by `scripts/job-bind.ts`. Not built: a job card or any page in `apps/web`, a route for undoing all, a fact on a receipt that starts the next job, `deprecated` kinds. | `packages/connectors/src/protocol.ts:211-238`, `apps/server/src/modules/jobs/usecases.ts:75-126,189-239`, `apps/server/src/modules/executions/usecases.ts:193-318,360-494`, `apps/server/src/routes/api.ts:234-251`, `packages/db/src/schema.ts:707-720` |
| [D82 sick-leave statistics](../decisions/D82-sick-leave-statistics-come-through-an-absence-connector-that-reads-only-aggregates.md) | **Built, on a fixture.** `connectors/qlik` has the aggregate reads, the minimum group, the Engine API adapter with the unit map, nothing stored and the area figure, plus the areas `economy` and `hme` that only the fixture answers. The trend the record says waits for a `series` kind exists as `qlik.sickLeaveChart`. The tests use a fake engine; no run against a real Qlik is established. D119, itself proposed, says it replaces D82 once D119 is provisional. | `connectors/qlik/manifest.mjs:57-116,203-249,460-497`, `connectors/qlik/connector.mjs:81-129,221,488-510`, `connectors/qlik/engine.mjs:10-188`, `tests/unit/qlik-connector.test.ts:551-553` |
| [D87 one shared header](../decisions/D87-one-header-shared-by-the-portal-and-the-intranet.md) | **Built, with the host replaced by D88.** `packages/site-header` has the menu as data, the Astryx `SiteHeader`, the `<site-header>` custom element and the menu sources. There is no `apps/portal`: the web app draws the header from `GET /api/header`, which a connector's `header` capability answers, and the breakpoint is `md`. The status line names D88's amendment; the body still names `apps/portal/src/shell.tsx` and `xl`. The move to a repository of its own has not happened. | `packages/site-header/src/menu.ts:7-22`, `packages/site-header/src/site-header.tsx:42,185,215`, `packages/site-header/src/embed.tsx:53-68,299-392`, `apps/server/src/routes/header.ts:6-8`, `connectors/intranet/connector.mjs:53` |
| [D99 an unresolved job step](../decisions/D99-an-unresolved-job-step-reaches-a-person-and-is-finished-forward.md) | **Not built**, as its status says. The only card a job's step pushes is for a watch that expired; a failed, unknown or blocked step writes state and audit only. No `required` flag on a binding, no retry or manual completion of a job step, no reconciliation scan. `apps/server/tests/failed-step-runtime.test.ts` is about the engine's retry logging (D91), not this record. | `apps/server/src/modules/executions/usecases.ts:459,484,509-535`, `apps/server/src/modules/jobs/contracts.ts:14-30`, `apps/server/src/routes/api.ts:234-251` |

In short: D26, D82 and D87 describe things that are built (D87 as D88 amended it); D18 describes a shape that D35
and D89 replaced; D55 is built on the server without an interface; D37 is half built; D19 and D99 are not built, and
`proposed` still says what is true of them.

## Not established

- **What exactly makes test 8 fail under load**, and whether 5 and 8 also fail in the workflow's three shards. Both
  failed in the one whole run made here, on a machine four other sessions shared, and passed alone and in four
  repeats. A trace of a failing run would say which of the two deferred focus moves takes focus in 8.
- **Since when tests 6 and 12 fail.** The week has been a page since `9eb335fa` (2026-11-14) and its outline has not
  changed since; why the sibling "Dagens möten", at the same heading level, passes was not traced.
- **Whether `bun run test:calendar` passes.** Not run (see the baseline). A calendar stack of its own would settle it.
- **Whether the connector images run on the OpenShift cluster as the operations status page says.** Nothing in the
  repository can show it; finding 5 shows only that they do not start under Docker without a writable `/data`.
- **Whether the missing licence notices of finding 8 are the bundler's doing or the packages'.** Established is that
  the served files hold one notice. Whether Vite's minifier drops the others or the packages ship none in their
  built files was not traced.
- **Whether `@dbos-inc/dbos-sdk` will keep what Clew uses outside its paid tier.** See the first point under
  "Looked at and found sound".

## Looked at and found sound

- **The open-source rule for the product's own dependencies.** Every direct dependency in the seven `package.json`
  files of the workspace and in `site/package.json` is an exact version; the one override is exact. Every install
  path uses the frozen lockfile: the devcontainer's `postCreateCommand`, the four workflows, both Dockerfiles of
  D131, `docs:site`, and the guides. No connector has a `package.json`: all eighteen import only `node:` modules and
  their own files (checked by following the imports from each `server.mjs`).
- **The durable engine.** `@dbos-inc/dbos-sdk` 5.5.0 is MIT and names a proprietary package,
  `@dbos-inc/dbos-enterprise`, as an optional peer for Conductor, suspend mode, sharding, automatic upgrade and
  external storage, each checked against a key. Clew installs no such package (it is not in `bun.lock`), passes no
  `conductorKey` or `transactEnterpriseKey` (`apps/server/src/dbos/runtime.ts:48-57`), and uses none of those
  features; with no feature enabled the SDK makes no entitlement request, and the durability suite passes without
  network access to DBOS. The licence record does not mention that the SDK is open core; it is worth a line there,
  because `scripts/workflows-move.ts` exists for what the paid tier automates.
- **Scalar (PR 85).** `@scalar/api-reference` 1.81.0 is MIT and its notice is in `apps/server/licences/`. The viewer
  is served from `node_modules` at `/api/protocol/scalar.js`. Opened in a browser against the development server,
  the page made three requests, all to its own origin (the page, the script, `openapi.json`), also after scrolling;
  no font was fetched. The bundle names `fonts.scalar.com`, `proxy.scalar.com` and `api.scalar.com`, and the
  configuration in `apps/server/src/routes/protocol.ts:37-44` switches those paths off (`withDefaultFonts: false`,
  `agent: { disabled: true }`, no test requests, no client button). What remains is one link, "Powered by Scalar",
  to `scalar.com` with `utm` parameters. The package does bring 289 packages into the lockfile, among them a second
  copy of `ai` with `@ai-sdk/gateway`, none of which the server imports.
- **The open-model rule.** The only provider imported is `@ai-sdk/openai-compatible`
  (`apps/server/src/assistant/model.ts:2,242-254`), always called with an endpoint and a model an administrator
  saved; no model is passed by name, so the gateway provider that `ai` depends on is never reached. Tests, fixtures
  and placeholders name open-weight models (`gpt-oss:20b`, `gpt-oss:120b`, `qwen3:32b`); no closed model's name is in
  the code.
- **Phone-home.** No `trustedDependencies` are declared, so Bun blocks all seven install hooks in the lockfile
  (`@astryxdesign/cli`, `@astryxdesign/core`, `@swc/core`, two `esbuild`, `protobufjs`, `vue-demi`). The built web
  app names no host it would fetch from (the five Raleway files are in the bundle; the host names in it are XML
  namespaces, documentation links and placeholders). The built documentation site loads nothing from another host;
  Inter is bundled, search is local, and the theme's request to `api.iconify.design` is reached only by a social
  link the configuration does not have. Telemetry leaves the server only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set
  (`apps/server/src/server-telemetry.ts`); the development stack points it at its own container.
- **Secrets.** No key material in the tracked files or in the 565 commits of `main` (patterns for private keys,
  cloud and GitHub tokens, JWTs and assigned secrets, with a known string as a control). What the history holds are
  development values marked as such (`clew-dev-only-…`, `…-local-only`, `local-docs-only-…`, `synthetic-…`). No
  secret has a built-in default in the server or in a connector: `MASTER_KEY` unset is an empty key that fails its
  length check, connector compose files refuse to start without a secret, and the development sign-in is refused
  unless the public address is `localhost` and the issuer the local Keycloak (`apps/server/src/auth.ts:212-224`).
- **Workflows.** All five pin their actions by commit, and each commit is the one its comment's tag points at
  (checked against GitHub for `actions/checkout` v7.0.1, `upload-artifact` v7.0.2, `configure-pages` v6.0.0,
  `upload-pages-artifact` v5.0.0 and `deploy-pages` v5.0.1). Every workflow declares `contents: read`; only the
  Pages deployment job has more (`pages: write`, `id-token: write`) and it does not run for a pull request. They use
  `pull_request`, never `pull_request_target`, no secret, and `persist-credentials: false`, so a pull request from a
  fork runs its own code with a read-only token and nothing to steal.
- **Images and compose.** Every published port in `.devcontainer/compose.yaml` and in the eight
  `connectors/*/compose.yaml` is bound to `127.0.0.1`. PostgreSQL, Playwright, Mailpit, the telemetry stack,
  Nextcloud, PHP and nginx are pinned by digest, and the archives the development images download (Nextcloud's
  apps, Moodle) are checked against SHA-256 sums. The server image runs as uid 1000 and the web image as an
  unprivileged user; both ran here as an arbitrary uid in group 0 and wrote nothing under `/app`. No build argument
  carries a secret (`CLEW_RELEASE` is the only one). Each connector's `COPY` line names every file its server
  imports. The devcontainer itself runs as root with the host's Docker socket, which is a development convenience
  and is what lets scripts start sibling containers.
- **The decision index.** `docs/decisions/in-force.md` counts 98 accepted, 40 provisional, 11 proposed and 6 no
  longer in force; the first word of the status of the 155 records gives the same, and `docs:check` passes.
- **Entry documents.** Every relative link in `README.md`, `llms.txt`, `docs/README.md` and `CLAUDE.md` resolves
  (`docs:check`), and every `bun run` script and `scripts/…` file they and the maintainer pages name exists.
- **The other tools of `bun run check`.** `scripts/purity-check.ts` covers the folders `CLAUDE.md` lists;
  `docs/history/` has no commit after 2026-11-11; no `console.*` is left in `apps/server/src`.

## Seen outside this area

- `apps/server/src/assistant/model.ts:137`: the system prompt tells the model it is "Sundsvalls kommuns startsida
  för medarbetare" in every installation (the assistant, area 3).
- `packages/calendar/src/accounts.ts:25-58`: calendar accounts are five hard-coded personas and `bindCalendar` throws
  unless `CLEW_POC=true`, so an installation from the images has no calendar (the calendar; no wave-1 area).
- `apps/web/src/components/work/work-item.tsx:135-138`: an item with no rows of its own and a one-row receipt shows
  the read-back detail nowhere, while D112 item 10 and `docs/reference/status/work.md:63` say each row is read back;
  only a code comment records the rule (the work item).
- `apps/server/src/routes/protocol.ts:70,75`: two error messages of a route are English (the connector boundary,
  area 2; they are read by an integrator, which may be why).

## What was started and removed

A throwaway PostgreSQL (`clew-review5-pg`), the compose project `clew-review5` with its volume and network, a
`hello` connector container, the test images `clew-review5-*` and their containers were created for this review and
removed when it was done. The shared development database was not written to. The connector check reads it: it
ran without `--as`, so it wrote no audit row (`scripts/connector-check.ts:113-131`), and the installation's signing
key already existed, so `signingAuthority()` read it rather than creating one
(`apps/server/src/connectors/signing.ts:12-13`).
