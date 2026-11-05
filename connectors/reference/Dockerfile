FROM node:26.13.0-bookworm-slim
WORKDIR /connector
COPY connector.mjs verification.mjs server.mjs ./
ENV PORT=4030 REFERENCE_DB=/data/reference.sqlite
EXPOSE 4030
USER node
CMD ["node", "server.mjs"]
