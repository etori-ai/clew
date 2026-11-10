<?php
declare(strict_types=1);
// Approval fixtures (D101): one rule whose approvers are Hillevi and Hassan, files that colleagues share with one of
// them and ask to have approved, and nothing for Mikael. A file waits for an approver only when it carries the rule's
// pending tag and the approver can reach it, so each file is shared with one approver alone. Synthetic data only.
// Idempotent: files, shares and decisions already made are kept. `php approval-seed.php reset` undoes the decisions on
// these files so that every one of them waits again.

use OCA\Approval\Service\ApprovalService;
use OCA\Approval\Service\RuleService;
use OCA\Approval\Service\UtilsService;
use OCP\Files\IRootFolder;
use OCP\Share\IManager as IShareManager;
use OCP\Share\IShare;
use OCP\SystemTag\ISystemTagManager;
use OCP\SystemTag\ISystemTagObjectMapper;
use OCP\SystemTag\TagNotFoundException;

if (getenv('CLEW_POC') !== 'true') {
    throw new RuntimeException('Synthetic POC mode required');
}
require '/var/www/html/lib/base.php';
set_exception_handler(function (Throwable $error): never {
    fwrite(STDERR, 'Approval provisioning failed: ' . $error->getMessage() . "\n");
    exit(1);
});
$reset = in_array('reset', array_slice($argv, 1), true);
foreach (['files_sharing', 'approval'] as $app) {
    if (!in_array($app, OC::$server->getAppManager()->getEnabledApps(), true)) {
        throw new RuntimeException("Enable $app first");
    }
}
OC_App::loadApps();

$tagManager = OC::$server->get(ISystemTagManager::class);
$tag = function (string $name) use ($tagManager): string {
    try {
        return $tagManager->getTag($name, true, false)->getId();
    } catch (TagNotFoundException) {
        return $tagManager->createTag($name, true, false)->getId();
    }
};
$pending = $tag('Väntar på godkännande');
$approved = $tag('Godkänd');
$rejected = $tag('Avvisad');

$rules = OC::$server->get(RuleService::class);
$approvers = [['type' => 'user', 'entityId' => 'hillevi'], ['type' => 'user', 'entityId' => 'hassan']];
$requesters = [['type' => 'group', 'entityId' => 'calendar-staff']];
$description = 'Underlag att godkänna';
$existing = array_values(array_filter($rules->getRules(), fn($rule) => $rule['tagPending'] === $pending));
$saved = $existing
    ? $rules->saveRule($existing[0]['id'], (int)$pending, (int)$approved, (int)$rejected, $approvers, $requesters, $description, false)
    : $rules->createRule((int)$pending, (int)$approved, (int)$rejected, $approvers, $requesters, $description, false);
if (isset($saved['error'])) throw new RuntimeException('Approval rule: ' . $saved['error']);
$rule = array_values(array_filter($rules->getRules(), fn($rule) => $rule['tagPending'] === $pending))[0]
    ?? throw new RuntimeException('Approval rule missing after save');

// [owner, approver, file name, content]. The owners are Hillevi's colleagues in seed.php, members of calendar-staff.
$files = [
    ['erik', 'hillevi', 'Inköp av läsplattor.txt', "Förslag: tolv läsplattor till årskurs 4.\n"],
    ['erik', 'hillevi', 'Schema för studiedag.txt', "Förslag: studiedag med två pass före lunch och ett efter.\n"],
    ['erik', 'hillevi', 'Plan för klassresa.txt', "Förslag: dagsresa med buss, åter före klockan 16.\n"],
    ['karin', 'hassan', 'Beställning av förbrukningsmaterial.txt', "Förslag: handskar och förband för ett kvartal.\n"],
    ['karin', 'hassan', 'Rutin för överlämning.txt', "Förslag: överlämning mellan passen med fasta rubriker.\n"],
];
$root = OC::$server->get(IRootFolder::class);
$shares = OC::$server->get(IShareManager::class);
$utils = OC::$server->get(UtilsService::class);
$approval = OC::$server->get(ApprovalService::class);
$mapper = OC::$server->get(ISystemTagObjectMapper::class);
// Every share first: a request checks that an approver reaches the file, and this process sets up an approver's file
// system once, with the shares that exist at that moment.
$requests = [];
foreach ($files as [$owner, $approver, $name, $text]) {
    $home = $root->getUserFolder($owner);
    $folder = $home->nodeExists('Underlag') ? $home->get('Underlag') : $home->newFolder('Underlag');
    $file = $folder->nodeExists($name) ? $folder->get($name) : $folder->newFile($name, $text);
    $shared = array_filter(
        $shares->getSharesBy($owner, IShare::TYPE_USER, $file, false, -1),
        fn($share) => $share->getSharedWith() === $approver,
    );
    if (!$shared && !$utils->createShare($file, IShare::TYPE_USER, $approver, $owner, 'Underlag att godkänna')) {
        throw new RuntimeException("Cannot share $name with $approver");
    }
    $requests[] = [(string)$file->getId(), $owner, $name];
}
foreach ($requests as [$id, $owner, $name]) {
    $tags = array_map('strval', $mapper->getTagIdsForObjects([$id], 'files')[$id] ?? []);
    $decided = array_values(array_intersect([$approved, $rejected], $tags));
    if ($decided && $reset) {
        $mapper->unassignTags($id, 'files', $decided);
        $decided = [];
    }
    if (!$decided && !in_array($pending, $tags, true)) {
        $requested = $approval->request((int)$id, $rule['id'], $owner, false);
        if (isset($requested['error']) || isset($requested['warning'])) {
            throw new RuntimeException("Request for $name: " . ($requested['error'] ?? $requested['warning']));
        }
    }
}
foreach (['hillevi', 'hassan', 'mikael'] as $person) {
    $count = count($approval->getPendingNodes($person));
    echo "$person: $count waiting\n";
}
echo 'Approval rule ' . $rule['id'] . ' and its files are in place.' . ($reset ? ' Decisions on them were undone.' : ' Decisions already made were kept.') . "\n";
