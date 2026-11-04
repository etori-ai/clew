<?php
declare(strict_types=1);
require __DIR__ . '/../.devcontainer/calendar/refresh-calendar-apps.php';

function expectCalendar(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
function writeCalendarApp(string $root, string $app, string $version, string $code): void {
    mkdir("$root/$app/appinfo", 0775, true);
    file_put_contents("$root/$app/appinfo/info.xml", "<info><version>$version</version></info>");
    file_put_contents("$root/$app/code.php", $code);
}
/** @return array{0:string,1:string} */
function calendarFixture(string $root, string $name): array {
    $image = "$root/$name/image";
    $installed = "$root/$name/installed";
    writeCalendarApp($image, 'calendar', '6.6.4', 'new calendar');
    writeCalendarApp($image, 'roomvox', '1.6.1', 'new roomvox');
    writeCalendarApp("$installed/custom_apps", 'calendar', '6.5.4', 'old calendar');
    writeCalendarApp("$installed/custom_apps", 'roomvox', '1.5.0', 'old roomvox');
    file_put_contents("$installed/occ", <<<'PHP'
<?php
if ($argv !== [__FILE__, 'upgrade', '--no-interaction']) exit(64);
file_put_contents(__DIR__ . '/migration-runs', "upgrade\n", FILE_APPEND);
exit(is_file(__DIR__ . '/fail-migration') ? 1 : 0);
PHP);
    return [$image, $installed];
}
function expectCalendarFailure(callable $operation, string $message): void {
    try { $operation(); }
    catch (RuntimeException $error) {
        expectCalendar(str_contains($error->getMessage(), $message), $error->getMessage());
        return;
    }
    throw new RuntimeException("Expected failure: $message");
}

$root = sys_get_temp_dir() . '/clew calendar-image-' . bin2hex(random_bytes(8));
mkdir($root);
try {
    [$image, $installed] = calendarFixture($root, 'existing');
    file_put_contents("$installed/custom_apps/calendar/obsolete.php", 'obsolete');
    mkdir("$installed/custom_apps/unrelated");
    file_put_contents("$installed/custom_apps/unrelated/keep", 'keep');
    mkdir("$installed/data");
    file_put_contents("$installed/data/meeting.ics", 'existing meeting');
    refreshPinnedCalendarApps($image, $installed);
    expectCalendar(file_get_contents("$installed/custom_apps/calendar/code.php") === 'new calendar', 'Calendar not updated');
    expectCalendar(file_get_contents("$installed/custom_apps/roomvox/code.php") === 'new roomvox', 'RoomVox not updated');
    expectCalendar(!is_file("$installed/custom_apps/calendar/obsolete.php"), 'Obsolete code retained');
    expectCalendar(file_get_contents("$installed/custom_apps/unrelated/keep") === 'keep', 'Unrelated app changed');
    expectCalendar(file_get_contents("$installed/data/meeting.ics") === 'existing meeting', 'Meeting data changed');
    refreshPinnedCalendarApps($image, $installed);
    expectCalendar(file_get_contents("$installed/migration-runs") === "upgrade\n", 'Unchanged apps migrated again');
    echo "PASS existing-volume update and idempotence\n";

    [$image, $installed] = calendarFixture($root, 'downgrade');
    file_put_contents("$installed/custom_apps/roomvox/appinfo/info.xml", '<info><version>1.7.0</version></info>');
    expectCalendarFailure(fn() => refreshPinnedCalendarApps($image, $installed), 'downgrade');
    expectCalendar(file_get_contents("$installed/custom_apps/calendar/code.php") === 'old calendar', 'Partial downgrade changed Calendar');
    expectCalendar(!is_file("$installed/migration-runs"), 'Downgrade ran migration');
    echo "PASS downgrade refused before changes\n";

    [$image, $installed] = calendarFixture($root, 'retry');
    touch("$installed/fail-migration");
    expectCalendarFailure(fn() => refreshPinnedCalendarApps($image, $installed), 'migration failed');
    expectCalendar(is_file("$installed/custom_apps/.clew-app-upgrade-pending"), 'Failed migration lost pending state');
    file_put_contents("$installed/custom_apps/calendar/code.php", 'partial copy');
    unlink("$installed/fail-migration");
    refreshPinnedCalendarApps($image, $installed);
    expectCalendar(file_get_contents("$installed/custom_apps/calendar/code.php") === 'new calendar', 'Retry did not repair app files');
    expectCalendar(!is_file("$installed/custom_apps/.clew-app-upgrade-pending"), 'Successful retry retained pending state');
    expectCalendar(file_get_contents("$installed/migration-runs") === "upgrade\nupgrade\n", 'Migration not retried');
    echo "PASS failed migration recovery\n";

    [$image, $installed] = calendarFixture($root, 'invalid');
    file_put_contents("$image/roomvox/appinfo/info.xml", '<info><version>invalid</version></info>');
    expectCalendarFailure(fn() => refreshPinnedCalendarApps($image, $installed), 'Invalid app version');
    expectCalendar(file_get_contents("$installed/custom_apps/calendar/code.php") === 'old calendar', 'Invalid source changed volume');
    expectCalendar(!is_file("$installed/migration-runs"), 'Invalid source ran migration');
    echo "PASS invalid source refused before changes\n";
} finally {
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($files as $file) {
        if ($file->isDir()) rmdir($file->getPathname());
        else unlink($file->getPathname());
    }
    rmdir($root);
}
