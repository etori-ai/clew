# Review: municipal branding and the shared header (2026-11-05)

Scope: the uncommitted D37/D38 logo and theme changes, including new files. Reviewed the shared
shell, the browser and Vite configuration adapters, the UI package export/provider, brand validation,
theme mappings, tests and deployment documentation. No application code changed during this review.

**Resolution, 2026-11-05:** the P2 finding below is fixed. `tests/a11y/vite.config.ts` reuses the web
configuration while disabling environment files and explicitly replacing all branding inputs,
including absent values. Typed fixtures provide independent expectations for Sundsvall, Neutral and
custom branding. CI checks those profiles sequentially with one worker. The missing-image scenario
now requires an observed failed request and runs only for fixtures that actually have a logo.
The focused Vite contract tests package the real browser branding entry with conflicting process
variables and an isolated invalid `.env.local`; all three fixture outputs match their expectations.
Seventeen focused tests and focused TypeScript checks passed. Playwright successfully collected all
20 branding cases (7 Sundsvall, 6 Neutral, 7 custom) without launching a browser or server. The actual
Vite test configuration loader also passed with conflicting operator variables. The browser test
folder now declares its ESM boundary so both configuration loaders handle `import.meta` correctly.
The original review and its evidence are retained below. Browser/manual checks remain distinct from
these configuration contracts.

## Finding

### [P2] The browser tests require Sundsvall while the build uses the installation's profile

Location: `tests/a11y/branding.spec.ts:13–27`.

The six desktop/320 px header scenarios always require an image named `Sundsvalls kommun` and
the accent `#005595`. However, the Playwright web server (`tests/a11y/playwright.config.ts:15–20`)
builds the actual application without isolating branding configuration. Vite therefore reads the
operator's `apps/web/.env.local`, exactly as the README instructs other municipalities to configure it.

With the valid `neutral` profile, the resolver intentionally returns no logo. With the valid `custom`
profile, it uses the supplied accent and either no logo or the operator's own image/name. Those
installations cannot satisfy the hard-coded assertions, so a supported configuration makes the
browser suite fail. The missing-image scenario can also pass under `neutral` without exercising an
image request or its error handler.

Recommended correction: isolate browser-test branding from the operator's environment and use
explicit fixtures for Sundsvall, Neutral and custom branding. Test their respective expected logo,
accent and omission/error behaviour. Pinning only the profile name is insufficient when an existing
custom installation still supplies accent variables, because the resolver correctly rejects those
overrides for a non-custom profile.

## Evidence and validation

- Checked the installed Astryx 0.7.7 Link, Button and AppShell documentation, and inspected public
  theme objects through their API.
- Rendered the documented `TopNavHeading` composition to static markup. The original logo remains
  an image inside the home link, with its alt text available to the link's accessible name.
- Used Vite's actual `loadEnv('production', ...)` with disposable isolated environment files and the
  production `resolveBranding` function. Results: Sundsvall resolves the dragon and `#005595`;
  Neutral resolves no logo/accent override; custom resolves no default logo and the supplied
  `#5b1f78`. The temporary fixtures were removed in `finally`.
- These focused runtime probes ran sequentially under the global supervisor. They did not start a
  server, browser, production build or full test suite.

## Verification still outstanding

The review does not establish visual or WCAG conformance. The padded logo's actual header size,
320 px reflow, pointer/focus states and screen-reader behaviour still require browser/manual checks.
Those were not run because the global resource rules require an explicit request for that execution.
Full host typechecking remains subject to the missing dependencies recorded in session 26.

The configuration remains owned by `packages/ui/src/branding.ts`, token mappings by `theme.ts`, and
the header by the existing shared Shell. No additional confirmed application regression was found
within the static and focused-runtime scope above.

## Integrated implementation

Before push, upstream `609fe5e` introduced D34–D36 and moved identity into the common rail. This
feature uses D37–D39, keeps that frame, and renders the logo through `SideNavHeading.icon`. A focused
React server-render probe confirmed the image and alt text inside its home link. Appearance/profile
and active reminder controls use the rail's footer icon slot. Full repository TypeScript and all
21 focused contracts / 109 assertions passed against the integrated tree; 16 Sundsvall browser
scenarios collected successfully. Browser execution, rendered geometry and screen-reader checks
remain pending. Earlier review observations above describe the reviewed draft, not browser evidence.
