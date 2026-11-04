FROM nextcloud:33.0.10-apache@sha256:53797c68b5b59c983d92be4ef9cc2ece57fbce24d94f1f6981ba6a5e63a59f28

# Published AGPL app archives; do not resolve versions at container startup.
RUN set -eu; \
    curl -fsSL --retry 3 https://github.com/nextcloud-releases/calendar/releases/download/v6.6.4/calendar-v6.6.4.tar.gz -o /tmp/calendar.tar.gz; \
    echo '0557b6b5852a467cf3f746e59d56478d227f78bf7a66357b30dfc10cae4c7e3c  /tmp/calendar.tar.gz' | sha256sum -c -; \
    curl -fsSL --retry 3 https://github.com/nextcloud/RoomVox/releases/download/v1.6.1/roomvox-1.6.1.tar.gz -o /tmp/roomvox.tar.gz; \
    echo '6002c625688f42f2ad2662ae0eb1f72db2cd0db017335cf4d9f36f61b6079de1  /tmp/roomvox.tar.gz' | sha256sum -c -; \
    mkdir -p /usr/src/nextcloud/custom_apps; \
    tar -xzf /tmp/calendar.tar.gz -C /usr/src/nextcloud/custom_apps; \
    tar -xzf /tmp/roomvox.tar.gz -C /usr/src/nextcloud/custom_apps; \
    rm /tmp/calendar.tar.gz /tmp/roomvox.tar.gz

COPY apache-workers.conf /etc/apache2/mods-available/mpm_prefork.conf
COPY poc.config.php /usr/src/nextcloud/config/poc.config.php
