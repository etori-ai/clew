# The connector uses only the Node runtime (node:sqlite for its own records). Node's official image is MIT; nothing else is installed.
FROM docker.io/library/node:26.13.0-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68
WORKDIR /connector
# The SQLite file is kept in /data: the image's node user owns it, and group 0 may write it, as the user a
# platform gives the container is in that group. Mount a volume there to keep the records past the container.
RUN install -d -o node -g 0 -m 0770 /data
COPY LICENSE manifest.mjs connector.mjs fixture.mjs state.mjs verification.mjs server.mjs ./
ENV PORT=4043 FIXTURE_DB=/data/communication.sqlite
EXPOSE 4043
USER node
CMD ["node", "server.mjs"]
