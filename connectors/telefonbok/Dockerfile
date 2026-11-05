# The connector uses only the Node runtime. Node's official image is MIT; nothing else is installed.
FROM node:26.13.0-bookworm-slim
WORKDIR /connector
COPY connector.mjs verification.mjs directory.mjs server.mjs ./
ENV PORT=4020
EXPOSE 4020
USER node
CMD ["node", "server.mjs"]
