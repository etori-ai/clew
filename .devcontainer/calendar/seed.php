<?php
declare(strict_types=1);
if (getenv('CLEW_POC') !== 'true') {
    throw new RuntimeException('Synthetic POC mode required');
}
require '/var/www/html/lib/base.php';
set_exception_handler(function (Throwable $error): never {
    fwrite(STDERR, 'Calendar provisioning failed: ' . $error->getMessage() . "\n");
    exit(1);
});
$appManager = OC::$server->getAppManager();
$required = array_merge($appManager->getAlwaysEnabledApps(), [
    'calendar', 'roomvox', 'dav', 'files', 'settings', 'provisioning_api',
    'theming', 'bruteforcesettings', 'password_policy',
]);
foreach ($appManager->getEnabledApps() as $app) {
    if (!in_array($app, $required, true)) $appManager->disableApp($app);
}
OC_App::loadApps();
$users = OC::$server->getUserManager();
$groups = OC::$server->getGroupManager();
$config = OC::$server->getConfig();
$dav = OC::$server->get(OCA\DAV\CalDAV\CalDavBackend::class);
if (!$groups->groupExists('calendar-staff')) $groups->createGroup('calendar-staff');
// Synthetic people. Hillevi (rektor), Hassan (undersköterska) and Mikael (systemförvaltare) are the three personas
// that can sign in; every persona gets a calendar. The rest are Hillevi's unit.
$people = [
    'hillevi' => 'Hillevi Berg', 'hassan' => 'Hassan Ali', 'mikael' => 'Mikael Lund',
    'anna' => 'Anna Lindqvist', 'erik' => 'Erik Sandström', 'maria' => 'Maria Källström', 'johan' => 'Johan Byström',
];
foreach ($people as $id => $name) {
    $user = $users->get($id) ?? $users->createUser($id, 'calendar-' . $id . '-local-only');
    $user->setEMailAddress($id . '@clew.test');
    $user->setDisplayName($name);
    $groups->get('calendar-staff')->addUser($user);
    $config->setUserValue($id, 'core', 'lang', 'sv');
    $calendars = $dav->getCalendarsForUser('principals/users/' . $id);
    if (!array_filter($calendars, fn($c) => $c['uri'] === 'personal')) {
        $dav->createCalendar('principals/users/' . $id, 'personal', ['{DAV:}displayname' => 'Min kalender']);
    }
}
$rooms = OC::$server->get(OCA\RoomVox\Service\RoomService::class);
$permissions = OC::$server->get(OCA\RoomVox\Service\PermissionService::class);
$service = OC::$server->get(OCA\RoomVox\Service\CalDAVService::class);
foreach ([['Eken', 6, 'calendar-staff', ['whiteboard']], ['Tallen', 12, 'calendar-staff', ['whiteboard', 'projector', 'video']]] as [$name, $capacity, $group, $equipment]) {
    $matches = array_filter($rooms->getAllRooms(), fn($r) => $r['name'] === $name);
    $room = $matches ? array_values($matches)[0] : $rooms->createRoom([
        'name' => $name, 'capacity' => $capacity, 'email' => strtolower($name) . '@clew.test',
        'address' => 'Demohuset, Testgatan 1, 00000, Demostad',
        'facilities' => $equipment, 'autoAccept' => true,
    ]);
    $rooms->updateRoom($room['id'], ['capacity' => $capacity, 'facilities' => $equipment]);
    $permissions->setPermissions($room['id'], [
        'viewers' => [['type' => 'group', 'id' => $group]],
        'bookers' => [['type' => 'group', 'id' => $group]],
        'managers' => [['type' => 'user', 'id' => 'calendar-admin']],
    ]);
    if (empty($room['calendarUri'])) {
        $uri = $service->provisionCalendar($room['userId'], $room['name']);
        $rooms->setCalendarUri($room['id'], $uri);
    }
}
OC::$server->get(OCP\Calendar\Room\IManager::class)->update();
echo "Synthetic calendar accounts and rooms are in place. Existing meetings were kept.\n";
