# The connector uses only the Node runtime. Node's official image is MIT; nothing else is installed.
FROM node:26.13.0-bookworm-slim
WORKDIR /connector
COPY manifest.mjs connector.mjs verification.mjs errands.mjs supportmanagement.mjs server.mjs ./
ENV PORT=4050
EXPOSE 4050
USER node
CMD ["node", "server.mjs"]
