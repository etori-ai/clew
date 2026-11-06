# The connector uses only the Node runtime (node:sqlite for its own records). Node's official image is MIT; nothing else is installed.
FROM node:26.13.0-bookworm-slim
WORKDIR /connector
COPY manifest.mjs connector.mjs fixture.mjs state.mjs verification.mjs server.mjs ./
ENV PORT=4040 FIXTURE_DB=/data/hr.sqlite
EXPOSE 4040
USER node
CMD ["node", "server.mjs"]
