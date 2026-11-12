#!/bin/sh
# Installs Moodle into an empty database on the first start, runs its own upgrade on a later one, then serves.
set -eu
if [ "${CLEW_POC:-}" != "true" ]; then
  echo 'Synthetic POC mode required' >&2
  exit 1
fi
chown www-data:www-data /var/www/moodledata
as_www() { runuser -u www-data -- "$@"; }
cd /var/www/moodle
# Moodle 5.3 ships no "is it installed" command, so the question is put to the database: is there a version row.
installed() {
  php -r '
    $db = pg_connect(sprintf("host=%s dbname=%s user=%s password=%s", getenv("MOODLE_DB_HOST"), getenv("MOODLE_DB_NAME"),
      getenv("MOODLE_DB_USER"), getenv("MOODLE_DB_PASSWORD")));
    if (!$db) exit(2);
    $table = pg_fetch_result(pg_query($db, "select to_regclass(\x27public.mdl_config\x27)"), 0, 0);
    if ($table === null) exit(1);
    $rows = pg_fetch_result(pg_query($db, "select count(*) from mdl_config where name = \x27version\x27"), 0, 0);
    exit($rows === "1" ? 0 : 1);
  '
}
status=0
installed || status=$?
case "$status" in
  0) as_www php admin/cli/upgrade.php --non-interactive ;;
  1)
    as_www php admin/cli/install_database.php --agree-license --lang=en \
      --fullname='Lärplattformen (utveckling)' --shortname='larplattform' --summary='' \
      --adminuser="$MOODLE_ADMIN_USER" --adminpass="$MOODLE_ADMIN_PASSWORD" --adminemail='moodle-admin@clew.test' \
      --supportemail='moodle-admin@clew.test'
    ;;
  *) echo 'The Moodle database does not answer.' >&2; exit 1 ;;
esac
exec apache2-foreground
