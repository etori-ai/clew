# Node's official image and Bun, both MIT, named with their registry and pinned by digest. Bun is the binary of Oven's
# own image of the release, copied in: the digest pins its content, which an install from npm does not.
FROM docker.io/library/node:26.13.0-bookworm@sha256:fa52d1669505e29b58c042875b1d65c229e0787a3610fd52869b22b68e480853
COPY --from=docker.io/oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4 /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s bun /usr/local/bin/bunx && bun --version
WORKDIR /workspace
