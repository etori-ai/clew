# Clew's server: the BFF, the SCIM server and the durable engine in one process.
# Build from the repository root, which is the Bun workspace:
#
#   docker build -f apps/server/Dockerfile -t clew-server --build-arg CLEW_RELEASE=<release> .
#
# Node runs the server through tsx (D16). Bun is in the image because the operator's scripts run inside this
# container (`bun run db:init`, `bun scripts/workflows-move.ts`, `bun scripts/provisioner-token.ts`).
# Node's official image is MIT and Bun is MIT; nothing else is installed. The images are named with their registry
# (buildah and podman refuse a short name) and pinned by digest. Bun is the binary of Oven's own image of the release,
# copied in: the digest pins its content, which an install from npm does not.
FROM docker.io/library/node:26.13.0-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68
COPY --from=docker.io/oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4 /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s bun /usr/local/bin/bunx && bun --version
WORKDIR /app
COPY . .
# The whole workspace, development dependencies included: the scripts at the root resolve `@clew/db` and
# `drizzle-orm` through the root's own dependencies, which are development dependencies.
RUN bun install --frozen-lockfile

# The release this image is: the durable engine resumes waiting work only in a process of the release that started it
# (D85), so every build that is deployed needs a name of its own, such as the commit. Unset, the engine hashes the
# workflow code instead. An operator can still set CLEW_RELEASE on the container.
ARG CLEW_RELEASE=""
# Nothing is written under /app: the files belong to root and are read by whichever user the container runs as, an
# arbitrary one included. tsx and Bun keep their caches under HOME.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    HOME=/tmp \
    CLEW_RELEASE=${CLEW_RELEASE}
EXPOSE 3000
# The image's own `node` user, by number: a cluster that requires a non-root user can only check a number.
USER 1000
# The working directory stays the workspace root, where the scripts are run from. The server starts in its own
# folder, where tsx resolves, and `exec` leaves Node as the process that receives SIGTERM.
CMD ["sh", "-c", "cd apps/server && exec node --import tsx src/main.ts"]
