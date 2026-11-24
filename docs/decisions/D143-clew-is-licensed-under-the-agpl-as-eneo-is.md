# D143 · Clew is licensed under the AGPL, as Eneo is

**Status:** accepted (the product owner, 2026-11-23: start with Eneo's licence and revise it later if needed; a choice of licence needs no test outside the repository, D102 item 1; who holds the copyright is an open question; item 3 amended 2026-11-24, finding `BL-15` of the baseline review: the connector protocol's viewer script is served with the notices of every package it bundles, not Scalar's alone) · **Date:** 2026-11-23 · **Area:** platform

**Decision.** Clew's own code is licensed under the GNU Affero General Public License, version 3 only.

1. **The text is the licence.** `LICENSE` at the repository root is the FSF's text of the AGPL v3, unchanged and
   identical to Eneo's. It covers every file of Clew's own, whether or not the file carries a header. A connector
   folder is built on its own, so each folder with a Dockerfile holds the same text and its image copies it in.
2. **Every package of Clew's says so.** Each named `package.json` declares `"license": "AGPL-3.0-only"`. The two
   `package.json` files under `tests/` only mark their folders as ES modules and name no package.
3. **What Clew passes on carries its notices.** Every browser build Clew publishes writes `third-party-notices.txt`
   and Clew's own `LICENSE.txt` beside its files: the web app with its workers, the header embed the intranet loads,
   and the documentation site (`scripts/third-party-notices.ts`). The notice names where Clew's source is, then every
   bundled package, a stylesheet's typeface included, with its version, declared licence and its own licence and
   notice files, then the runtime dependencies those packages carry, since a package built ahead of time can hold
   them inside its own files. A package that ships no licence file has its upstream text kept in `licences/`; a build
   that bundles a package with neither fails, unless its licence asks for no notice (CC0-1.0, 0BSD, MIT-0, the
   Unlicense). A typeface a package ships beside its code, as VitePress ships Inter, is under a licence of its own,
   kept in `licences/` too, and a build whose stylesheets bring a typeface with no typeface licence fails. So does a
   build with a bundled module that cannot be traced to a named package, or a dependency that resolves nowhere: a
   notice with a package left out is not whole. The server image is built from the whole repository and holds `LICENSE` and its dependencies' own
   files. The one script it passes on to a browser, the connector protocol's viewer (D60), is Scalar's packaged
   build: `/api/protocol/third-party-notices.txt` and `/api/protocol/LICENSE.txt` are served beside it, made by the same
   code from Scalar's package and its runtime dependencies, with what Scalar's build bundled that Clew's install does
   not hold named in `apps/server/src/routes/protocol.ts` and checked against the script's source map and banners.
4. **Dependencies may be combined with the AGPL.** A dependency carries an OSI-approved licence that may be combined
   with the AGPL v3 (MIT, Apache-2.0, BSD, ISC, MPL-2.0, the OFL for a typeface), recorded in
   `docs/reference/licences.md`; EPL-2.0 without a secondary licence, the CDDL and GPL-2.0-only cannot be. `CLAUDE.md`
   says the same. The exceptions are recorded there and asked in `docs/maintainers/open-questions.md`: `caniuse-lite`
   (CC-BY-4.0) in the server image, through the Astryx CLI.

**Why.** The repository is public and had no licence, so nothing granted another municipality the right to run, change
or pass on the code (the baseline review's finding `BL-2`, `docs/reviews/2026-11-23-review-baseline-build-and-supply-chain.md`).
Clew is shared with other municipalities and governments, and Eneo, whose line to Clew `docs/vision.md` draws, is
licensed under the AGPL v3. The AGPL suits that sharing: a municipality that runs a changed Clew as a service for its
staff must offer them the source. The product owner chose Eneo's licence as the start on 2026-11-23. "Only" follows
Eneo, which names version 3 and no later one; a later version is a later decision. Who holds the copyright is not
decided (`docs/maintainers/open-questions.md`); the notice will name it when it is.

**Replaces.** The note in [D131](D131-clew-builds-a-server-image-and-a-web-image-from-the-repository-root.md) that the
repository has no licence file yet.
