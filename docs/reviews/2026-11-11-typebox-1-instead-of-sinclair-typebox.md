# Review: `typebox` 1.x instead of `@sinclair/typebox` 0.34 · 2026-11-11

Status: the migration is done and every check passes. The one text that differs was decided by the product owner
the same day ("The choice, and its answer" below).

The [dependency refresh](2026-11-11-dependency-refresh.md) of the same day left one thing out: TypeBox's successor is
published under another package name, and moving to it changes more than a version number. This note says what the
move does to Clew, measured on the code, and what it does not.

## The facts upstream

- `@sinclair/typebox` 0.34.52 (2026-07-11) is the newest of its line and is not deprecated. The project's README calls
  0.x "Long Term Support" and 1.x "Latest", and points 0.x issues to a repository of their own
  (`sinclairzx81/sinclair-typebox`). It gives no end date and does not say which kinds of fix the 0.x line gets. The
  line had three releases in 2026 after January: one in March and three in July, the last of them on the days when
  every older line back to 0.24 also got a release.
- `typebox` 1.0.0 came 2025-09-09. 1.4.6 (2026-11-08) is the eleventh release since mid-October. MIT, no dependencies,
  the same repository. It is ES modules only and is developed against TypeScript 7, which is what Clew pins (7.0.2).
- The upstream migration note (`changelog/1.0.0-migration.md`) lists what changed. What touches Clew: `Value.Errors`
  returns an array of Ajv-shaped errors instead of an iterator, `FormatRegistry` became `Format` in `typebox/format`,
  and the `Kind` symbols became non-enumerable `~kind` properties. `Type.Recursive`, `Type.Composite`,
  `Type.Transform`, `TypeCompiler`, `TypeRegistry`, `Type.Date` and `Value.Cast` also changed, and Clew uses none of
  them.

Four things the migration note does not say were found by measuring, and each would have changed behaviour silently:

1. **`Type.Partial` and `Type.Omit` no longer carry the options of the object they are given.** Five schemas lost
   `additionalProperties: false`: `SnoozeInput`, `ConnectorPatchInput`, `ProviderPatchInput`, `ModelPatchInput` and
   `WeekEventsSchema`. Four are request bodies, so an administrator's `PATCH` would have started to accept unknown
   properties. No test caught it.
2. **A union's static type is read from a tuple.** `Type.Union(LIST.map(v => Type.Literal(v)))`, written in seventeen
   places, has the type `never` in 1.x. That one pattern was 333 of the 346 type errors after the imports were
   switched.
3. **`Value.Errors` stops at eight errors by default** (`Settings.maxErrors`, a guard against large inputs). A failed
   union of literals gives two errors per branch, so one wrong view format hid every later problem in the same
   manifest. D60 item 3 says every problem is listed.
4. **TypeBox now ships checks for twenty-one string formats, and an unknown format passes.** In 0.34 a format nobody
   had registered failed. Clew registered its own `date-time` only `if (!FormatRegistry.Has('date-time'))`; ported as
   written, TypeBox's own check (lower-case `t` and an RFC 9557 suffix allowed) would have replaced Clew's.

## What was measured, and how

Two trees side by side in the devcontainer: `main` at `289f73a` on 0.34.52 and the worktree on 1.4.6. The change was
then rebased onto the dependency refresh, where the checks under Validation were run again; the measurements below
were made before the rebase, and the refresh changes no schema.

- **Every exported schema** (257 exports of the twelve modules that build schemas) written out as JSON from both
  trees and compared with key order ignored.
- **The same 91 732 generated values** judged against 216 schemas by `Value.Check` and by Ajv in both trees: a value
  that fits, then each place in it removed, set to the wrong type, to `undefined`, `null`, `NaN`, an empty or a
  5 000-character string, odd instants and addresses, and an extra property on every object.
- **The problem lists** of 31 094 of those values, 0.34's `path: message` lines against the migrated code's.
- **The conformance check** from both trees against the seven fixture connectors running in the development stack
  from the main checkout, whose code this change does not touch.

## Result: the published protocol schema

`docs/protocol/connector-protocol.schema.json` changes on 2 101 of its lines and means the same.

- Key order. 944 objects list the same keys in another order (`type` first where it was last). JSON object order
  carries no meaning.
- The record pattern. The 23 `patternProperties` keys read `^.*$` where they read `^(.*)$`. Both match every string;
  the group captured nothing anyone read. Ajv 8.20.0 compiles both and gave the same verdict on all 91 732 values.
- With the pattern key normalised and order ignored, the two documents are equal, and so is every one of the 257
  exports. `docs/protocol/connector-protocol.openapi.json` changes the same way and only that way.

So nothing in the published schema changes in meaning. A tool that compares the file byte for byte, or that keys on
the literal string `^(.*)$`, would notice; nothing in the repository does.

## Result: validation

- Ajv, which validates every route body and every capability input: no verdict changed on any value.
- `Value.Check`, which validates what connectors answer: no verdict changed on 214 of 216 schemas. The two that
  changed are `CreateEventInput` and `AvailabilityInput`, which hold `format: 'email'`: 0.34 failed every string
  there because nobody had registered `email`, and 1.4.6 checks it. Both are validated by Ajv in `routes/api.ts` and
  never by `Value.Check`, so nothing a person meets changes. TypeBox and Ajv now agree on them.
- Clew's `date-time` is registered unconditionally and replaces TypeBox's, so an instant is checked as before.
- `Value.Check` interprets the schema as it did. Code generation (`new Function`) is only behind `Compile`, which Clew
  does not call, so nothing changes for a content security policy.

## Result: error texts

Three places put a `Value.Errors` path or message in front of someone. All three now go through one function,
`contractProblems` in `packages/contracts`, which turns the library's errors into Clew's own lines: a missing or an
unexpected property is named at its own path, a value that fits no branch of a union is one problem at the union, and
the words are the ones in use today. No text is Swedish and none is shown in the product's own interface language;
the readers are administrators, connector authors and operators.

| Where | Who reads it | Before and after |
|---|---|---|
| `manifestProblems` in `packages/connectors/src/remote.ts`: the dry run (`POST /api/protocol/manifest` and its page), `parseManifest`'s `Invalid connector manifest: …`, `connector-check`, the connector's status detail on Administration › Anslutna system | connector authors, administrators | Identical, except that a missing property is said once, as D60 item 3 says. Before: `/source: Expected required property` and `/source: Expected string`. After: `/source: Expected required property`. |
| `scimUsecases` in `apps/server/src/modules/people/usecases.ts`: the `detail` of a `400 invalidSyntax` | whoever runs a provisioner | Identical in all 25 cases tried (`The request body does not match the User schema at 'emails.0.value'.`). |
| `Registry.header` in `packages/connectors/src/index.ts`: what `onRefused` logs when a header answer is out of shape | operators, in the log | Identical in all 7 cases tried (`answer is not a SiteHeaderOutput: /site/href Expected required property`). |

Over the 31 094 generated values: 28 441 lists are identical line for line and in order, 2 653 are identical but for
that repeated line, none differs otherwise, and the first problem (the only one SCIM and the header name) never
differs.

For comparison, the library's own words, which the code would give if it were ported as written: a missing `source`
is `/: must have required properties source`, so the dry-run page can no longer link the problem to the `source`
entry of the manifest reference; an unexpected `colour` is two lines, `/colour: schema is false` and
`/: must not have additional properties`; a wrong capability `kind` is four lines; and a wrong view `kind` is eight
lines about another branch's fields, starting with `/capabilities/0/view: must have required properties body`. Two
unit tests fail on those paths.

## Result: connector authors

- The wire is JSON, and Clew reads JSON Schema whoever wrote it. The seven running fixture connectors pass
  `bun scripts/connector-check.ts` from both trees with identical output, line for line.
- A manifest whose schemas were written with `@sinclair/typebox` 0.34 (an optional, a union of literals, two records)
  loads in the migrated tree with no problems, passes the dry run, and Ajv judges inputs and outputs the same as for
  the manifest the same source emits with 1.4.6.
- The reference's generated TypeBox tab runs unchanged under both lines and emits the same JSON; only its import line
  differs. The guidance (`packages/connectors/src/reference.ts`, the generated
  `docs/generated/manifest-reference.md` and the page at `/protocol/manifest`) now imports `typebox` and says that
  `@sinclair/typebox` 0.34 takes the same code and that a connector written with it needs no change.
  `docs/guides/creating-a-connector.md` does not name a schema library and is unchanged.

## What changed in the code

- `packages/contracts`, `packages/connectors` and `apps/server` pin `typebox` 1.4.6; 25 files change their import.
- `packages/contracts/src/index.ts`: `literals(list)` for a union of literals from a closed list (the schema is the
  same `anyOf`); `closed` passed again to the five derived bodies; `ENTITY_KEY_MAX` instead of reading `maxLength`
  back off a schema, which 1.x's types no longer show; `Format.Set('date-time', …)`; `contractProblems`.
- `packages/connectors/src/protocol.ts`: `FactEnvelope` as a type, instead of `.static` on the schema.
- `tests/unit/contract-problems.test.ts`: the words and paths, every problem listed past eight, the five bodies
  closed, Clew's `date-time`, and `literals`.
- The web bundle's main chunk grows from 2 634.50 kB to 2 652.39 kB (810.38 to 817.41 kB gzipped).

## Recommendation

Move now. The 0.x line is maintained, so there is no urgency from upstream; the reason is cost. The move has a
contract in it (the published schema's bytes, the words of a manifest's problems, the package the reference teaches),
and that is cheapest to change before the first installation and the first connector written outside the team. The
four silent differences above are found and each is now held by a test or by the type checker. Staying costs nothing
today and more with every schema and every outside author added.

## The choice, and its answer

One text a person sees differs: a missing property is said once in a manifest's problems, `/source: Expected required
property`, where 0.34 followed it with `/source: Expected string`.

Decided by the product owner on 2026-11-11: once. The second line was a side effect of the library and never a
decision; it told the author nothing the first had not. The dry run now matches D60 item 3 as it was written ("the
schema's errors one per path"), so no new decision record is needed and D60 is unchanged. Every other text is as it
was.

The alternatives were to add the property's own expectation back after the missing-property line (about ten lines in
`contractProblems`, and no text would have changed), to take the library's words (the paths stop naming the field,
which the dry-run page links from), or to stay on 0.34.52.

## Validation

In the devcontainer, Node 26.13.0 and Bun 1.4.4, after the rebase onto the dependency refresh. The same checks passed
before the rebase on `main`'s versions and PostgreSQL 17.11.

- `bun install --frozen-lockfile` from the regenerated lockfile, and `bun run check` (format, typecheck, dependency
  rules over 672 modules, purity, 1 115 unit and web tests, the 10 Node runtime tests, documentation): pass. The ten
  new tests are `tests/unit/contract-problems.test.ts`.
- `bun run test:db` (136 tests) and `bun run test:durability` (3) against a throwaway PostgreSQL 18.6 on a memory
  disk, migrated with `bun run db:init` and removed afterwards; the shared development database was not written to.
- `bun scripts/connector-check.ts` against `hr`, `finance`, `incidents`, `communication`, `timesheet`, `payroll` and
  `intranet`: all checks pass; before the rebase the output was compared with `main`'s and was identical.
- `bun run build`: passes. `bun audit`: no known vulnerabilities (524 packages).
- The WCAG specs for the two protocol pages (`sh scripts/a11y.sh`'s command on `protocol.spec.ts` and
  `screens.protocol.spec.ts`, on Playwright 1.65.0 in a compose project of its own so it installs from this
  lockfile): 6 pass, the screen capture is skipped by the suite's own condition. The whole suite was not run.
