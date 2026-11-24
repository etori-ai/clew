# The connector uses only the Node runtime. Node's official image is MIT; nothing else is installed.
FROM docker.io/library/node:26.13.0-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68
WORKDIR /connector
COPY LICENSE manifest.mjs connector.mjs verification.mjs errands.mjs supportmanagement.mjs http.mjs server.mjs ./
ENV PORT=4050
EXPOSE 4050
USER node
CMD ["node", "server.mjs"]
