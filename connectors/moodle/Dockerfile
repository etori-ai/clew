# The connector uses only the Node runtime. Node's official image is MIT; nothing else is installed.
FROM node:26.13.0-bookworm-slim
WORKDIR /connector
COPY manifest.mjs connector.mjs verification.mjs learning.mjs moodle.mjs server.mjs ./
ENV PORT=4053
EXPOSE 4053
USER node
CMD ["node", "server.mjs"]
