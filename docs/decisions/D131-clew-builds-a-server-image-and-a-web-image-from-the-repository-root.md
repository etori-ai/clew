# D131 · Clew builds a server image and a web image from the repository root

**Status:** provisional (asked for by Oliver Borgström on 2026-11-17, to run a test installation on a container platform; both images were built with Docker and with buildah and run on a workstation as an arbitrary user, and since 2026-11-18 a pipeline outside the repository builds them and they run on an OpenShift test cluster on made-up data; accepted once a person has done a day's work in an installation that runs on them) · **Date:** 2026-11-17 · **Area:** platform

**Decision.**

1. **Two images, both built with the repository root as their context.** `apps/server/Dockerfile` is the server and
   `apps/web/Dockerfile` is the web app. The root is the Bun workspace: the server needs `packages/` and `bun.lock`,
   which no narrower context reaches. `.dockerignore` at the root keeps out what neither needs. A connector's image
   is unchanged: it builds from its own folder.
2. **The server image is the workspace as the development container runs it.** Node 26.13.0 runs the server through
   tsx (D16), and Bun 1.4.4 is in the image because the operator's scripts run inside the app container
   (`bun run db:init`, `bun scripts/workflows-move.ts`, `bun scripts/provisioner-token.ts`). The whole workspace is
   installed, development dependencies included. Nothing is written under `/app`, `HOME` is `/tmp`, and the image
   names its user by number, so it runs as whichever user a platform gives it. Base images are named with their
   registry and pinned by digest: buildah and podman refuse a short name.
3. **A build is given its release.** The build argument `CLEW_RELEASE` becomes the server image's `CLEW_RELEASE`,
   which the durable engine marks waiting work with (D85). Unset, the engine hashes the workflow code as before. An
   operator can still set it on the container.
4. **The web image is the one address.** `nginxinc/nginx-unprivileged` serves the built files, answers a path that
   is not a file with `index.html`, and passes `/api/` and `/scim/` on to the server named by `CLEW_SERVER_URL`,
   unbuffered. It is the reverse proxy of the hosting guide, built. The build carries no setting and no branding
   (D98), so one image serves every environment.
5. **`scripts/images.txt` is the list of what the repository builds**: a name, a Dockerfile and a context per line,
   the connectors' included. `scripts/images-build.sh` builds what it lists with Docker. A pipeline reads the same
   list, so adding a connector's image is a line here and no change to a pipeline.
6. **Nothing of one installation is in the repository.** No registry, host name, manifest or pipeline: those are
   the installing organisation's, kept in its own repositories.

**Why.** The hosting guide said there was no image of the server, and every installation needs one. The
alternatives weighed:

- *Top-level `frontend/` and `backend/` folders with their own contexts*, which is the shape one organisation's
  shared pipeline expects. It would bend the repository to one installation, and a context of one folder cannot
  hold the workspace.
- *A production-only install in the server image.* The workspace is installed with the isolated linker, so the
  scripts at the root resolve `@clew/db` and `drizzle-orm` through the root's own dependencies, which are
  development dependencies. Without them `bun run db:init` does not start. The cost is size: about 1.4 GB.
- *A web image that only serves files, with the platform routing `/api/` and `/scim/`.* Every installation would
  then build the proxy the hosting guide describes, each with its own buffering and time limits to get wrong for
  streamed answers.
- *Publishing images from this repository.* Not decided here: where images are published and what a release is
  called is the product owner's, and the repository has no licence file yet.

**Replaces.** The hosting guide's statement that there is no image of the server and that an installation is built
from a checkout; the checkout remains possible. No numbered decision is superseded.
