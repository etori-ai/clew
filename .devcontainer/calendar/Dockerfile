FROM nextcloud:33.0.9-apache@sha256:63e74e341d302e94d52a4ee1cf5bdc7ee94c04c3c661823c5e5a5270741310e8

# Published AGPL app archives; do not resolve versions at container startup.
RUN set -eu; \
    curl -fsSL --retry 3 https://github.com/nextcloud-releases/calendar/releases/download/v6.5.4/calendar-v6.5.4.tar.gz -o /tmp/calendar.tar.gz; \
    echo '67c777a6ea974409e9d228c23fc60f2be8e675d376531b6b1b125f2f0365738d  /tmp/calendar.tar.gz' | sha256sum -c -; \
    curl -fsSL --retry 3 https://github.com/nextcloud/roomvox/releases/download/v1.5.0/roomvox-1.5.0.tar.gz -o /tmp/roomvox.tar.gz; \
    echo '4b496b416873753ddf3601aa729baa25c3a67aa15f17c9a06e5e8838ea707860  /tmp/roomvox.tar.gz' | sha256sum -c -; \
    mkdir -p /usr/src/nextcloud/custom_apps; \
    tar -xzf /tmp/calendar.tar.gz -C /usr/src/nextcloud/custom_apps; \
    tar -xzf /tmp/roomvox.tar.gz -C /usr/src/nextcloud/custom_apps; \
    rm /tmp/calendar.tar.gz /tmp/roomvox.tar.gz

COPY apache-workers.conf /etc/apache2/mods-available/mpm_prefork.conf
COPY poc.config.php /usr/src/nextcloud/config/poc.config.php
