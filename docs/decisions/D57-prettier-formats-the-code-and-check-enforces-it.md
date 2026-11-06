# D57 · Prettier formats the code, and `bun run check` enforces it

**Status:** accepted · **Date:** 2026-11-06 · **Area:** platform

**Decision.** Prettier 3.9.10 (MIT, pinned exactly, development only) formats TypeScript, JavaScript and CSS, the glob
`**/*.{ts,tsx,mts,mjs,cjs,css}`. `.prettierrc.json` holds only what differs from Prettier's defaults: single quotes, no
parentheses around a single arrow parameter, and lines up to 120 characters. `bun run format` writes, and
`bun run format:check` is the first step of `bun run check`, so `.github/workflows/check.yml` fails on unformatted code.
Markdown, JSON, YAML and SQL are outside the glob. The devcontainer recommends the Prettier editor extension (MIT).

**Why.** The repository had no formatter, and nothing but habit held its style. The options were measured on 2026-11-06
at `64b914c` over 326 code files and 27,788 lines. Single quotes (1,553 imports, none double) and bare arrow parameters
(1,771 against 5) follow the code as written; `arrowParens: "always"` would only have added changed lines. For width, 100
changes 326 files (+44,687/−9,700), 120 changes 320 (+37,078/−8,514) and 140 changes 317 (+31,682/−7,675). 120 was
chosen as the width most existing lines already fit: 81 % are within it, and 19 % are longer. Narrower costs more lines,
and wider keeps long lines hard to read and review.

The cost is that the code files grow to about 56,000 lines, roughly double, because dense one-line chains and objects
are expanded. The first reformat is therefore one commit of its own, so that `git blame` can skip it through
`.git-blame-ignore-revs`, and branches open at the time need `bun run format` before they merge.

A first run over dense code needs two passes: the member-chain layout depends on the input's shape, and 18 files
changed again on the second pass. The check was clean after that, so the repository is at a fixed point.

Markdown is left out because decision bodies and session notes are preserved as written, and because Prettier would
rewrite every table. JSON is left out because most of it is generated: `packages/db/migrations/meta/` by `drizzle-kit`,
and `docs/generated/`, `docs/protocol/` and `docs/context.json` by `scripts/docs.ts`, which `docs:check` compares byte
for byte. ESLint was not added; Prettier is about layout, and the rules that matter here are `bun run deps` and
`bun run purity`.

**Replaces.** Nothing. There was no formatter or format check before this.
