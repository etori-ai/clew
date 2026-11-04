<?php
declare(strict_types=1);

function pinnedCalendarAppVersion(string $path): string {
    if (!is_file($path)) throw new RuntimeException("Missing app metadata: $path");
    $metadata = simplexml_load_file($path, SimpleXMLElement::class, LIBXML_NONET);
    $version = $metadata === false ? '' : trim((string)$metadata->version);
    if (!preg_match('/^[0-9]+(?:\.[0-9]+){1,3}$/D', $version)) {
        throw new RuntimeException("Invalid app version: $path");
    }
    return $version;
}

/** Refresh only the two image-owned apps before Apache starts. */
function refreshPinnedCalendarApps(string $imageApps, string $nextcloudRoot): void {
    $apps = ['calendar', 'roomvox'];
    $installedApps = $nextcloudRoot . '/custom_apps';
    $pending = $installedApps . '/.clew-app-upgrade-pending';
    $changed = is_file($pending);
    // Validate every app before changing either one. Never downgrade persisted app code.
    foreach ($apps as $app) {
        $expected = pinnedCalendarAppVersion("$imageApps/$app/appinfo/info.xml");
        $metadata = "$installedApps/$app/appinfo/info.xml";
        if (is_file($metadata)) {
            $installed = pinnedCalendarAppVersion($metadata);
            if (version_compare($installed, $expected, '>')) {
                throw new RuntimeException("Refusing to downgrade $app from $installed to $expected");
            }
            $changed = $changed || version_compare($installed, $expected, '<');
        } else {
            $changed = true;
        }
    }
    if (!$changed) return;
    if (!is_dir($installedApps) && !mkdir($installedApps, 0775, true)) {
        throw new RuntimeException('Cannot create custom_apps');
    }
    // Keep this marker until migration succeeds: retries must also repair partial copies.
    if (file_put_contents($pending, "Pinned calendar app upgrade pending\n", LOCK_EX) === false) {
        throw new RuntimeException('Cannot record pending calendar app upgrade');
    }
    foreach ($apps as $app) {
        // Releases can contain equal-sized files with equal timestamps; compare content.
        passthru('rsync -rlpt --checksum --delete -- ' . escapeshellarg("$imageApps/$app/") . ' '
            . escapeshellarg("$installedApps/$app/"), $status);
        if ($status !== 0) throw new RuntimeException("Failed to refresh $app; upgrade remains pending");
    }
    passthru(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg("$nextcloudRoot/occ")
        . ' upgrade --no-interaction', $status);
    if ($status !== 0) throw new RuntimeException('Calendar app migration failed; upgrade remains pending');
    if (!unlink($pending)) throw new RuntimeException('Cannot clear pending calendar app upgrade');
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    refreshPinnedCalendarApps('/usr/src/nextcloud/custom_apps', '/var/www/html');
}
