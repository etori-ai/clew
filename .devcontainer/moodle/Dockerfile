# Moodle LMS (GPL-3.0-or-later) as a learning platform in the development stack: a source that was not written for Clew
# and holds what people have completed. Built on the official PHP image and not on moodlehq/moodle-php-apache, which
# carries no licence file and installs Microsoft's SQL Server driver under its own EULA.
FROM php:8.4-apache-bookworm@sha256:5d55c49594dd833e2e4ff677b65f7d8ff48817f443a60691d9b2b382413bba42

# The extensions Moodle asks for on PostgreSQL; the rest of its list (curl, mbstring, openssl, sodium, xml, ctype,
# iconv, simplexml, dom, tokenizer, fileinfo, zlib) is already in the base image.
RUN set -eu; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      libpq-dev libicu-dev libpng-dev libjpeg62-turbo-dev libfreetype6-dev libwebp-dev libzip-dev libxml2-dev; \
    rm -rf /var/lib/apt/lists/*; \
    docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp; \
    docker-php-ext-install -j"$(nproc)" pgsql intl gd zip soap exif opcache

# The published release archive, pinned by checksum; no version is resolved when the container starts.
RUN set -eu; \
    curl -fsSL --retry 3 https://packaging.moodle.org/stable503/moodle-5.3.1.tgz -o /tmp/moodle.tgz; \
    echo '820ee2bcd89acc6b91df255b2010bbbab108f29952ab78895a79c4feabf541e7  /tmp/moodle.tgz' | sha256sum -c -; \
    tar -xzf /tmp/moodle.tgz -C /var/www; \
    rm /tmp/moodle.tgz; \
    mkdir -p /var/www/moodledata; \
    chown www-data:www-data /var/www/moodledata

# Moodle 5.1 and later serve from public/ and route every other address through r.php.
ENV APACHE_DOCUMENT_ROOT=/var/www/moodle/public
RUN set -eu; \
    sed -ri -e 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf; \
    sed -ri -e 's!/var/www/!/var/www/moodle/!g' /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf; \
    printf '<Directory /var/www/moodle/public>\n  FallbackResource /r.php\n  AllowOverride None\n  Require all granted\n</Directory>\n' \
      > /etc/apache2/conf-available/moodle.conf; \
    a2enconf moodle; \
    printf 'max_input_vars = 5000\nmemory_limit = 256M\nopcache.enable_cli = 0\n' > /usr/local/etc/php/conf.d/moodle.ini

COPY config.php /var/www/moodle/config.php
COPY --chmod=755 start.sh /usr/local/bin/clew-moodle-start
WORKDIR /var/www/moodle
CMD ["clew-moodle-start"]
