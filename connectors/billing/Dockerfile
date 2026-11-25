# The connector uses only the Node runtime. Node's official image is MIT; nothing else is installed.
FROM node:26.13.0-bookworm-slim
WORKDIR /connector
COPY manifest.mjs connector.mjs document.mjs customers.mjs verification.mjs records.mjs billingpreprocessor.mjs http.mjs server.mjs ./
ENV PORT=4056
EXPOSE 4056
USER node
CMD ["node", "server.mjs"]
