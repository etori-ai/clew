# The connector uses only the Node runtime. Node's official image is MIT; nothing else is installed.
FROM node:26.13.0-bookworm-slim
WORKDIR /connector
COPY manifest.mjs connector.mjs state.mjs verification.mjs server.mjs ./
ENV PORT=4046
EXPOSE 4046
USER node
CMD ["node", "server.mjs"]
