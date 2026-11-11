FROM nextcloud:35.0.2-apache@sha256:786c102155d2717ba0f53a62b3fdd7a1354edc48e800b94dbe32294d9a5752a2

# Published AGPL app archives; do not resolve versions at container startup.
# user_oidc validates the development Keycloak's bearer tokens and approval is the first real integration (D101).
RUN set -eu; \
    curl -fsSL --retry 3 https://github.com/nextcloud-releases/calendar/releases/download/v6.6.5/calendar-v6.6.5.tar.gz -o /tmp/calendar.tar.gz; \
    echo 'e3afbc2a10db87920f5347279423422411010550a809b2902c0e8cf2f2492107  /tmp/calendar.tar.gz' | sha256sum -c -; \
    curl -fsSL --retry 3 https://github.com/nextcloud/RoomVox/releases/download/v1.6.1/roomvox-1.6.1.tar.gz -o /tmp/roomvox.tar.gz; \
    echo '6002c625688f42f2ad2662ae0eb1f72db2cd0db017335cf4d9f36f61b6079de1  /tmp/roomvox.tar.gz' | sha256sum -c -; \
    curl -fsSL --retry 3 https://github.com/nextcloud-releases/user_oidc/releases/download/v8.13.0/user_oidc-v8.13.0.tar.gz -o /tmp/user_oidc.tar.gz; \
    echo '6f13fa0477144a6812d8648626c64cee91807d1d0b60ca41424543086b9e2775  /tmp/user_oidc.tar.gz' | sha256sum -c -; \
    curl -fsSL --retry 3 https://github.com/nextcloud-releases/approval/releases/download/v3.3.2/approval-v3.3.2.tar.gz -o /tmp/approval.tar.gz; \
    echo '3c7e0b93e1ce774d6c21f14d9af2ff6b36bb0a268de036e3ce8b2b621e8514e0  /tmp/approval.tar.gz' | sha256sum -c -; \
    mkdir -p /usr/src/nextcloud/custom_apps; \
    for app in calendar roomvox user_oidc approval; do \
      tar -xzf "/tmp/$app.tar.gz" -C /usr/src/nextcloud/custom_apps; \
      rm "/tmp/$app.tar.gz"; \
    done

COPY apache-workers.conf /etc/apache2/mods-available/mpm_prefork.conf
COPY poc.config.php /usr/src/nextcloud/config/poc.config.php
COPY refresh-calendar-apps.php /usr/local/lib/clew-calendar-apps.php
COPY --chmod=755 refresh-calendar-apps.sh /docker-entrypoint-hooks.d/before-starting/10-clew-calendar-apps.sh
