# The connector uses only the Node runtime. Node's official image is MIT; nothing else is installed.
FROM node:26.13.0-bookworm-slim
WORKDIR /connector
COPY connector.mjs verification.mjs server.mjs ./
ENV PORT=4010
EXPOSE 4010
USER node
CMD ["node", "server.mjs"]
