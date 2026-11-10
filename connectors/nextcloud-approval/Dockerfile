# The connector uses only the Node runtime. Node's official image is MIT; nothing else is installed.
FROM node:26.13.0-bookworm-slim
WORKDIR /connector
COPY manifest.mjs connector.mjs verification.mjs approvals.mjs nextcloud.mjs server.mjs ./
ENV PORT=4052
EXPOSE 4052
USER node
CMD ["node", "server.mjs"]
