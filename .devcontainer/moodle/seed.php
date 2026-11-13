<?php
// Seeds the development Moodle: the synthetic people, a handful of courses with completions, a competency framework
// tied to them, one badge that expires, and the service account a connector reads through. Run again, it adds what is
// missing and leaves the rest. `sh scripts/moodle.sh seed` runs it as www-data inside the container.
declare(strict_types=1);
define('CLI_SCRIPT', true);
if (getenv('CLEW_POC') !== 'true') {
    fwrite(STDERR, "Synthetic POC mode required\n");
    exit(1);
}
require '/var/www/moodle/config.php';
require_once $CFG->dirroot . '/user/lib.php';
require_once $CFG->dirroot . '/course/lib.php';
require_once $CFG->libdir . '/enrollib.php';
require_once $CFG->libdir . '/completionlib.php';
require_once $CFG->dirroot . '/completion/criteria/completion_criteria_role.php';
require_once $CFG->libdir . '/badgeslib.php';
require_once $CFG->dirroot . '/webservice/lib.php';

use core_competency\api as competency;
use core_competency\course_competency;

$admin = get_admin();
\core\session\manager::set_user($admin);
$system = context_system::instance();
$now = time();
$day = 86400;

set_config('enablewebservices', 1);
set_config('webserviceprotocols', 'rest');
set_config('enablecompletion', 1);
set_config('enablebadges', 1);
set_config('timezone', 'Europe/Stockholm');
set_config('country', 'SE');
// A person may not change their own idnumber: the connector finds a person by it where an installation chooses
// idnumber over username. Unlocked, anyone could take a colleague's idnumber. The seeded accounts sign in with the
// manual method.
set_config('field_lock_idnumber', 'locked', 'auth_manual');

// The people. The three personas that can sign in to Clew and the named people of Hillevi's unit; whoever else the
// development directory puts on the unit is handed over by `moodle.sh seed` in CLEW_MOODLE_PEOPLE as
// {"<user>": "<name>"}. The Moodle user name is the Clew user name, which is what a connector matches a person on.
$people = [
    'hillevi' => 'Hillevi Berg', 'hassan' => 'Hassan Ali', 'mikael' => 'Mikael Lund',
    'anna' => 'Anna Lindqvist', 'erik' => 'Erik Sandström', 'maria' => 'Maria Källström', 'johan' => 'Johan Byström',
    'karin' => 'Karin Lindqvist',
];
$handed = getenv('CLEW_MOODLE_PEOPLE');
if ($handed !== false && $handed !== '') {
    $unit = json_decode($handed, true, 4, JSON_THROW_ON_ERROR);
    if (!is_array($unit)) throw new RuntimeException('CLEW_MOODLE_PEOPLE is not an object');
    foreach ($unit as $id => $name) {
        if (!is_string($id) || !is_string($name) || !preg_match('/^[a-z][a-z0-9.-]{0,62}$/', $id) || $name === '') {
            throw new RuntimeException('CLEW_MOODLE_PEOPLE holds an entry that is not a user name and a name');
        }
        $people[$id] ??= $name;
    }
}
$account = function (string $username, string $first, string $last) use ($DB, $CFG): stdClass {
    $user = $DB->get_record('user', ['username' => $username, 'mnethostid' => $CFG->mnet_localhost_id, 'deleted' => 0]);
    if ($user) return $user;
    $id = \core\user::create_user((object) [
        'username' => $username, 'firstname' => $first, 'lastname' => $last, 'email' => $username . '@clew.test',
        'idnumber' => $username, 'auth' => 'manual', 'confirmed' => 1, 'mnethostid' => $CFG->mnet_localhost_id,
        'password' => 'Moodle-' . $username . '-local-1', 'lang' => 'en', 'country' => 'SE',
    ], true, false);
    return $DB->get_record('user', ['id' => $id], '*', MUST_EXIST);
};
$users = [];
foreach ($people as $id => $name) {
    [$first, $last] = array_pad(explode(' ', $name, 2), 2, '-');
    $users[$id] = $account($id, $first, $last);
}

// The courses, as an employer's learning platform holds them. `months` is how long the employer counts a completion;
// Moodle LMS has no such rule for a course, so it is carried here only to place the seeded dates around it.
$courses = [
    'brandskydd' => ['Brandskydd, grundutbildning', 36],
    'hlr' => ['Hjärt-lungräddning med hjärtstartare', 12],
    'informationssakerhet' => ['Informationssäkerhet för medarbetare', 24],
    'livsmedelshygien' => ['Livsmedelshygien', 0],
    'lakemedel' => ['Läkemedelshantering, delegeringsutbildning', 12],
];
$category = $DB->get_record('course_categories', ['idnumber' => 'clew-dev'])
    ?: core_course_category::create(['name' => 'Obligatoriska utbildningar', 'idnumber' => 'clew-dev']);
$courseRows = [];
foreach ($courses as $short => [$full]) {
    $courseRows[$short] = $DB->get_record('course', ['shortname' => $short]) ?: create_course((object) [
        'fullname' => $full, 'shortname' => $short, 'idnumber' => 'clew-dev:' . $short, 'category' => $category->id,
        'enablecompletion' => 1, 'format' => 'topics', 'numsections' => 1, 'visible' => 1,
    ]);
}
// What each course is about, as a teacher writes it on the course page: HTML, which a connector reads as plain text.
$summaries = [
    'brandskydd' => '<p>Att <strong>förebygga</strong> brand, larma och släcka. Repeteras vart tredje år.</p>',
    'hlr' => '<p>Hjärt-lungräddning på vuxen och barn, och hur hjärtstartaren används.</p><p>Repeteras varje år.</p>',
    'informationssakerhet' => '<p>Att hantera uppgifter om elever, brukare och kollegor säkert: lösenord, e-post &amp; utskrifter.</p>',
    'livsmedelshygien' => '<p>Hygien i kök och servering enligt livsmedelslagen.</p>',
    'lakemedel' => '<p>Delegering av läkemedelshantering: <em>iordningställa</em>, administrera och dokumentera.</p>',
];
foreach ($courseRows as $short => $course) {
    if ($course->summary !== $summaries[$short] || (int) $course->summaryformat !== FORMAT_HTML) {
        $DB->update_record('course', (object) [
            'id' => $course->id, 'summary' => $summaries[$short], 'summaryformat' => FORMAT_HTML,
        ]);
        rebuild_course_cache((int) $course->id, true);
    }
}

// One competency per course in a framework of its own, completed when the course is.
$framework = $DB->get_record('competency_framework', ['idnumber' => 'clew-dev']);
if (!$framework) {
    // Moodle installs a two-step scale for competencies; its last step is the proficient one.
    $scale = $DB->get_record('scale', ['name' => get_string('defaultcompetencescale')], '*', IGNORE_MULTIPLE)
        ?: $DB->get_record_sql('SELECT * FROM {scale} ORDER BY id DESC', null, IGNORE_MULTIPLE);
    if (!$scale) throw new RuntimeException('Moodle has no scale to rate a competency on');
    $items = count(explode(',', $scale->scale));
    $framework = competency::create_framework((object) [
        'shortname' => 'Arbetsgivarens kompetenser', 'idnumber' => 'clew-dev', 'description' => '',
        'descriptionformat' => FORMAT_HTML, 'visible' => 1, 'contextid' => $system->id, 'scaleid' => $scale->id,
        'scaleconfiguration' => json_encode([
            ['scaleid' => (string) $scale->id], ['id' => $items, 'scaledefault' => 1, 'proficient' => 1],
        ]),
        'taxonomies' => 'competency,competency,competency,competency',
    ])->to_record();
}
foreach ($courses as $short => [$full]) {
    $competencyId = $DB->get_field('competency', 'id', ['idnumber' => 'clew-dev:' . $short]);
    if (!$competencyId) {
        $competencyId = competency::create_competency((object) [
            'shortname' => $full, 'idnumber' => 'clew-dev:' . $short, 'description' => '',
            'descriptionformat' => FORMAT_HTML, 'competencyframeworkid' => $framework->id, 'parentid' => 0,
        ])->get('id');
    }
    $link = ['courseid' => $courseRows[$short]->id, 'competencyid' => $competencyId];
    if (!$DB->record_exists('competency_coursecomp', $link)) {
        competency::add_competency_to_course($link['courseid'], $link['competencyid']);
        competency::set_course_competency_ruleoutcome(
            $DB->get_field('competency_coursecomp', 'id', $link, MUST_EXIST), course_competency::OUTCOME_COMPLETE);
    }
}

// Completions, placed by position so the same person always gets the same history: most people have most courses,
// some long ago enough to have run out under the employer's rule, some about to, and every third person lacks one.
// A course is finished when a teacher says so: one criterion per course, which is what gives a completion a date that
// Moodle's web service answers (core_completion_get_course_completion_status refuses a course without criteria).
$teacher = $DB->get_field('role', 'id', ['shortname' => 'editingteacher'], MUST_EXIST);
$criteria = [];
foreach ($courseRows as $short => $course) {
    $where = ['course' => $course->id, 'criteriatype' => COMPLETION_CRITERIA_TYPE_ROLE, 'role' => $teacher];
    if (!$DB->record_exists('course_completion_criteria', $where)) {
        $data = (object) ['id' => $course->id, 'criteria_role' => [$teacher => 1]];
        (new completion_criteria_role())->update_config($data);
    }
    $criteria[$short] = (int) $DB->get_field('course_completion_criteria', 'id', $where, MUST_EXIST);
}
$manual = enrol_get_plugin('manual');
$student = $DB->get_field('role', 'id', ['shortname' => 'student'], MUST_EXIST);
$agesInDays = [40, 200, 330, 345, 400, 700, 760, 1100];
$completed = 0;
$p = 0;
foreach ($users as $user) {
    $c = 0;
    foreach ($courseRows as $short => $course) {
        $slot = $p * 3 + $c * 5;
        $c++;
        $instance = $DB->get_record('enrol', ['courseid' => $course->id, 'enrol' => 'manual'], '*', IGNORE_MULTIPLE);
        if (!$instance) {
            $instance = $DB->get_record('enrol', ['id' => $manual->add_default_instance($course)], '*', MUST_EXIST);
        }
        if (!is_enrolled(context_course::instance($course->id), $user)) {
            $manual->enrol_user($instance, $user->id, $student);
        }
        // Enrolled and not finished: the person has the course ahead of them.
        if (($p + $c) % 3 === 0) continue;
        $completion = new completion_completion(['userid' => $user->id, 'course' => $course->id]);
        if ($completion->is_complete()) continue;
        $when = $now - $agesInDays[$slot % count($agesInDays)] * $day;
        (new completion_criteria_completion([
            'userid' => $user->id, 'course' => $course->id, 'criteriaid' => $criteria[$short],
        ]))->mark_complete($when);
        $completion = new completion_completion(['userid' => $user->id, 'course' => $course->id]);
        $completion->mark_complete($when);
        $completed++;
    }
    $p++;
}

// One badge that Moodle itself lets run out a year after it is given: the only end date Moodle LMS keeps natively.
$badgeId = $DB->get_field('badge', 'id', ['name' => 'HLR-instruktör']);
if (!$badgeId) {
    $columns = $DB->get_columns('badge');
    $row = [
        'name' => 'HLR-instruktör', 'description' => 'Får leda arbetsplatsens utbildning i hjärt-lungräddning.',
        'timecreated' => $now, 'timemodified' => $now, 'usercreated' => $admin->id, 'usermodified' => $admin->id,
        'issuername' => 'Lärplattformen (utveckling)', 'issuerurl' => $CFG->wwwroot,
        'issuercontact' => 'moodle-admin@clew.test', 'expiredate' => null, 'expireperiod' => 365 * $day,
        'type' => BADGE_TYPE_SITE, 'courseid' => null, 'message' => '', 'messagesubject' => '', 'attachment' => 0,
        'notification' => 0, 'status' => BADGE_STATUS_ACTIVE, 'version' => '1', 'language' => 'sv',
        'imageauthorname' => '', 'imageauthoremail' => '', 'imageauthorurl' => '', 'imagecaption' => '',
    ];
    $badgeId = $DB->insert_record('badge', (object) array_intersect_key($row, $columns));
}
$badge = new \core_badges\badge((int) $badgeId);
$awarded = 0;
foreach (['hillevi', 'anna', 'johan'] as $holder) {
    if (isset($users[$holder]) && !$badge->is_issued($users[$holder]->id)) {
        $badge->issue($users[$holder]->id, true);
        $awarded++;
    }
}

// Johan's has run out: given 400 days ago, so its year ended 35 days back. Moodle stamps a badge with the moment it is
// given and has no way to give one in the past, so the two dates are set on the row, counted from today on every run.
if (isset($users['johan'])) {
    $given = $now - 400 * $day;
    $issued = ['badgeid' => $badgeId, 'userid' => $users['johan']->id];
    $DB->set_field('badge_issued', 'dateissued', $given, $issued);
    $DB->set_field('badge_issued', 'dateexpire', $given + 365 * $day, $issued);
}

// The service account. A role with read capabilities only, an external service that lists exactly the functions a
// connector may call, restricted to this one user, and a token. Nothing here is an administrator.
// `moodle/site:viewparticipants` lets it list the site's accounts a page at a time (core_enrol_get_enrolled_users on the
// front page), which is how the connector answers the installation's read of every holding (D119).
$capabilities = [
    'webservice/rest:use', 'moodle/user:viewdetails', 'moodle/user:viewalldetails', 'moodle/user:viewhiddendetails',
    'moodle/course:view', 'moodle/course:viewhiddencourses', 'moodle/course:viewparticipants',
    'moodle/site:viewparticipants',
    'moodle/site:accessallgroups', 'report/completion:view',
    'moodle/competency:competencyview', 'moodle/competency:usercompetencyview', 'moodle/competency:evidenceview',
    'moodle/competency:coursecompetencyview', 'moodle/badges:viewotherbadges', 'moodle/badges:viewbadges',
];
$roleId = $DB->get_field('role', 'id', ['shortname' => 'clewconnector'])
    ?: create_role('Clew connector', 'clewconnector', 'Reads completions, badges and competencies for Clew.');
set_role_contextlevels($roleId, [CONTEXT_SYSTEM]);
foreach ($capabilities as $capability) {
    if (get_capability_info($capability)) assign_capability($capability, CAP_ALLOW, $roleId, $system->id, true);
}
$service = $account('clew-connector', 'Clew', 'Connector');
role_assign($roleId, $service->id, $system->id);

$functions = [
    'core_webservice_get_site_info', 'core_user_get_users_by_field', 'core_course_get_courses_by_field',
    'core_enrol_get_users_courses', 'core_enrol_get_enrolled_users', 'core_completion_get_course_completion_status',
    'core_badges_get_user_badges', 'core_competency_read_competency_framework', 'core_competency_list_competencies',
    'core_competency_list_competency_frameworks', 'core_competency_list_course_competencies',
    'tool_lp_data_for_user_competency_summary', 'tool_lp_data_for_user_competency_summary_in_course',
];
$manager = new webservice();
$external = $DB->get_record('external_services', ['shortname' => 'clew']);
if (!$external) {
    $external = (object) [
        'name' => 'Clew', 'shortname' => 'clew', 'enabled' => 1, 'restrictedusers' => 1, 'requiredcapability' => null,
        'downloadfiles' => 0, 'uploadfiles' => 0, 'timecreated' => $now,
    ];
    $external->id = $manager->add_external_service($external);
}
$missing = [];
foreach ($functions as $function) {
    if (!$DB->record_exists('external_functions', ['name' => $function])) {
        $missing[] = $function;
        continue;
    }
    if (!$manager->service_function_exists($function, $external->id)) {
        $manager->add_external_function_to_service($function, $external->id);
    }
}
if (!$DB->record_exists('external_services_users', ['externalserviceid' => $external->id, 'userid' => $service->id])) {
    $manager->add_ws_authorised_user((object) ['externalserviceid' => $external->id, 'userid' => $service->id]);
}
$tokenRow = ['externalserviceid' => $external->id, 'userid' => $service->id];
if (!$DB->record_exists('external_tokens', $tokenRow)) {
    \core_external\util::generate_token(EXTERNAL_TOKEN_PERMANENT, $external, (int) $service->id, $system);
}
// A fixed development token, so the stack is the same on every machine.
$fixed = getenv('MOODLE_DEV_TOKEN');
if ($fixed !== false && preg_match('/^[a-f0-9]{32}$/', $fixed)) {
    $DB->set_field('external_tokens', 'token', $fixed, $tokenRow);
}
accesslib_clear_all_caches(true);

echo sprintf(
    "Moodle is seeded: %d people, %d courses, %d completions added, %d badges given, service \"clew\" with %d functions.\n",
    count($users), count($courseRows), $completed, $awarded, count($functions) - count($missing),
);
if ($missing) echo 'Not in this Moodle: ' . implode(', ', $missing) . "\n";
