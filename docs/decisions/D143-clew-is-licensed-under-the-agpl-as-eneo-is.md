# D143 · Clew is licensed under the AGPL, as Eneo is

**Status:** provisional (the product owner, 2026-11-23: start with Eneo's licence and revise it later if needed; accepted once the copyright holder is named in the licence notice) · **Date:** 2026-11-23 · **Area:** platform

**Decision.** Clew's own code is licensed under the GNU Affero General Public License, version 3 only.

1. **The text is the licence.** `LICENSE` at the repository root is the FSF's text of the AGPL v3, unchanged and
   identical to Eneo's. It covers every file of Clew's own, a connector folder included, whether or not the file
   carries a header.
2. **Every package of Clew's says so.** Each named `package.json` declares `"license": "AGPL-3.0-only"`. The two
   `package.json` files under `tests/` only mark their folders as ES modules and name no package.
3. **What Clew passes on carries its notices.** The web app's build writes `third-party-notices.txt` beside the built
   files (`apps/web/third-party-notices.ts`): every bundled package, the typeface included, with its version, declared
   licence and its own licence and notice files. The server image installs its dependencies with their packages, and
   Scalar's notice ships as `apps/server/licences/scalar-MIT.txt` (D60).
4. **Dependencies stay as `CLAUDE.md` says.** Every dependency carries an OSI-approved licence that may be combined with
   the AGPL (MIT, Apache-2.0, BSD, ISC, MPL-2.0, the OFL for a typeface), recorded in `docs/reference/licences.md`.

**Why.** The repository is public and had no licence, so nothing granted another municipality the right to run, change
or pass on the code (the baseline review's finding `BL-2`, `docs/reviews/2026-11-23-review-baseline-build-and-supply-chain.md`).
Clew is shared with other municipalities and governments, and Eneo, whose line to Clew `docs/vision.md` draws, is
licensed under the AGPL v3 for the same reason: a municipality that runs a changed Clew as a service for its staff must
offer them the source. The product owner chose Eneo's licence as the start on 2026-11-23. "Only" follows Eneo's own
words, "Licensed under GNU Affero General Public License v3.0"; a later version is a later decision. Who holds the
copyright that the notice names is not decided (`docs/maintainers/open-questions.md`).

**Replaces.** The note in [D131](D131-clew-builds-a-server-image-and-a-web-image-from-the-repository-root.md) that the
repository has no licence file yet.
