# The connector uses only the Node runtime. Node's official image is MIT; nothing else is installed.
FROM node:26.13.0-bookworm-slim
WORKDIR /connector
COPY manifest.mjs connector.mjs verification.mjs identity.mjs cases.mjs pob.mjs config.mjs http.mjs server.mjs ./
ENV PORT=4055
EXPOSE 4055
USER node
CMD ["node", "server.mjs"]
