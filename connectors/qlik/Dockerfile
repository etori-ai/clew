# The connector uses only the Node runtime, including its built-in WebSocket for Qlik's Engine API.
# Node's official image is MIT; nothing else is installed.
FROM node:26.13.0-bookworm-slim
WORKDIR /connector
COPY manifest.mjs connector.mjs verification.mjs statistics.mjs engine.mjs server.mjs ./
ENV PORT=4048
EXPOSE 4048
USER node
CMD ["node", "server.mjs"]
