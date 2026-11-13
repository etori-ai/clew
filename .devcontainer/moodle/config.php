<?php
// Development only: synthetic people, fixed local passwords, plain HTTP on loopback.
if (getenv('CLEW_POC') !== 'true') {
    throw new RuntimeException('Synthetic POC mode required');
}
unset($CFG);
global $CFG;
$CFG = new stdClass();

$CFG->dbtype = 'pgsql';
$CFG->dblibrary = 'native';
$CFG->dbhost = getenv('MOODLE_DB_HOST') ?: 'postgres';
$CFG->dbname = getenv('MOODLE_DB_NAME') ?: 'clew_moodle';
$CFG->dbuser = getenv('MOODLE_DB_USER') ?: 'clew_moodle';
$CFG->dbpass = getenv('MOODLE_DB_PASSWORD') ?: '';
$CFG->prefix = 'mdl_';
$CFG->dboptions = ['dbpersist' => 0, 'dbport' => 5432, 'dbsocket' => ''];

// Moodle answers under one address only and redirects every other host to it. The stack reaches it under two: the
// browser on the host's published port and a connector on the compose network. So the address follows the request,
// among the names listed in MOODLE_HOSTS; the command line and anything else get the first.
$hosts = array_values(array_filter(array_map('trim', explode(' ', getenv('MOODLE_HOSTS') ?: 'localhost:3024'))));
$asked = $_SERVER['HTTP_HOST'] ?? '';
$CFG->wwwroot = 'http://' . (in_array($asked, $hosts, true) ? $asked : $hosts[0]);

$CFG->dataroot = '/var/www/moodledata';
$CFG->directorypermissions = 02777;
$CFG->admin = 'admin';
// Nothing leaves the stack: no mail, no update check, no registration prompt.
$CFG->noemailever = true;
$CFG->noreplyaddress = 'noreply@clew.test';
$CFG->disableupdatenotifications = true;
$CFG->site_is_public = false;
// The seed and the upgrade say what went wrong; a web request never prints a notice into its JSON.
if (PHP_SAPI === 'cli') {
    $CFG->debug = E_ERROR | E_PARSE | E_WARNING | E_NOTICE;
    $CFG->debugdisplay = 1;
}

require_once(__DIR__ . '/lib/setup.php');
