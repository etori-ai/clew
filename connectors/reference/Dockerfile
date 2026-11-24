FROM docker.io/library/node:26.13.0-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68
WORKDIR /connector
# The SQLite file is kept in /data: the image's node user owns it, and group 0 may write it. The user a platform
# gives the container is in that group, and so is node, which runs in it (USER below). The setgid bit gives every
# file made there group 0. SQLite makes a new database 0644 whatever the umask, and its journal files take the
# database's mode, so the command below makes the database file first, group-writable: a volume made by one user is
# written by the next, in either order. Mount a volume there to keep the records past the container.
RUN install -d -o node -g 0 -m 2770 /data
COPY LICENSE connector.mjs verification.mjs server.mjs ./
ENV PORT=4030 REFERENCE_DB=/data/reference.sqlite
EXPOSE 4030
USER node:0
CMD ["sh", "-c", "umask 002 && touch \"$REFERENCE_DB\" && exec node server.mjs"]
