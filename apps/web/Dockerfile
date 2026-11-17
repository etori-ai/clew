# Clew's web app, and the one address a browser, a provisioner and an identity provider meet: it serves the built
# files and passes /api/ and /scim/ on to the server (docs/guides/scim-sign-in-and-hosting.md).
# Build from the repository root, which is the Bun workspace:
#
#   docker build -f apps/web/Dockerfile -t clew-web .
#
# The build carries no setting and no branding (D98), so one image serves every environment. Where the server is, is
# read when the container starts: CLEW_SERVER_URL.
# Node's official image is MIT and Bun is MIT. nginx is BSD-2-Clause and its unprivileged image Apache-2.0.
# The images are named with their registry: buildah and podman refuse a short name.
FROM docker.io/library/node:26.13.0-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68 AS build
RUN npm install --global bun@1.4.4 && bun --version
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile && bun run build

# Listens on 8080 and runs as any user: nothing here needs root.
FROM docker.io/nginxinc/nginx-unprivileged:1.30.6-alpine-slim@sha256:5d8bb9437d74a600ec5dbf90c035451c724dc33eac8d3a71078f6f8612c345f6
# The image's entrypoint writes this template to /etc/nginx/conf.d with the environment filled in.
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
ENV CLEW_SERVER_URL=http://clew-server:3000
EXPOSE 8080
