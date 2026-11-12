# Moodle LMS: recorded requests and responses

Real exchanges with the development Moodle, recorded 2026-11-12 for the connector's adapter tests, after the stack's
PostgreSQL was recreated and Moodle reinstalled that afternoon. Moodle LMS 5.3.1 (Build: 20261112), seeded by
`.devcontainer/moodle/seed.php`: synthetic people (with their development-directory unit in `department`, which a seed
of that afternoon set and which neither the seed nor the connector uses any longer), five courses
under "Obligatoriska utbildningar" with a summary each, dated completions and the badge "HLR-instruktör", Johan's run
out. Every call was a POST from the host to `http://localhost:3024/webservice/rest/server.php` as the seed's service
account `clew-connector` (no administrator; a role with read capabilities only, admitted to the external service
`clew`), and every one but 23 and 25 asked for text as stored (`moodlewssettingraw=true`), as the connector does.
Samples 30 to 36 were added later that day for the installation's read of every holding (D119), after the seed gave the
service account `moodle/site:viewparticipants`: sent from inside the development stack (the connector's container) to
`http://moodle`, with the same account and token. 34 is the answer the same account got before that right was given,
written down from the answer as it came.

Each `NN-*.json` holds `description`, `request` (method, path, headers and the form body) and `response` (status, the
content type and the body as Moodle sent it, parsed). The token is replaced by `<the service account token>` in every
request except 14, where it is the made-up token that was sent. Ids and times belong to this instance: Hillevi is user
3, Hassan 4, Mikael 5, Johan 9, Karin 10; the courses are 2 to 6; the badge is 1. A reinstall gave the same ids and
the same days, with other seconds.

| Sample | Function | What it shows |
|---|---|---|
| 01 | `core_user_get_users_by_field`, `idnumber` | Two of three values found; the unknown one is simply absent. Accounts come back in Moodle's order (by id), not in the order asked |
| 02 | Same | `idnumber` is compared with its case: `HILLEVI` finds nobody |
| 03 | Same, `username` | Found by username |
| 04 | Same, `username` | A value Moodle's username cleaning would change (here upper case) refuses the whole batch with `invalidparameter` |
| 05 | `core_enrol_get_users_courses` | `completed` per course, `completionhascriteria`, `idnumber`; no completion date. Asked without participant counts (`returnusercount=0`) |
| 06 | Same | A user id that does not exist answers an empty list, not an error |
| 07, 18 to 20 | `core_completion_get_course_completion_status` | Completed: a `timecompleted` per criterion, none for the course; each criterion's `type` and `title` |
| 08 | Same | Not completed: `completed: false`, the criterion's time null |
| 09 | Same | Not enrolled: `usernotenroled` |
| 10 | Same | No such user: `invalidrecordunknown` |
| 11 | `core_badges_get_user_badges` | `dateissued` and `dateexpire` in Unix seconds; the recipient's full name, which the connector does not pass on |
| 12 | Same | No badge: an empty list |
| 13 | Same | No such user: `invalidrecordunknown` |
| 14 | Any | A token Moodle does not know: `invalidtoken` |
| 15 | `core_user_create_users` | A function the service does not list: `accessexception` |
| 16 | `core_enrol_get_users_courses` | A required parameter missing: `invalidparameter` |
| 17 | `core_user_get_users_by_field` | One person by idnumber |
| 21 | `core_badges_get_user_badges` | Johan's badge, run out 35 days before the recording: still listed, its `dateexpire` in the past |
| 22 | Same | The badge renamed "HLR- & AED-instruktör" for the recording, asked raw: the name comes back as `HLR- &#38; AED-instruktör` |
| 23 | Same | The same without `moodlewssettingraw`: the same escaping |
| 24 | `core_enrol_get_users_courses` | Course 4 renamed "Informationssäkerhet & dataskydd för medarbetare" for the recording, asked raw: the name as stored |
| 25 | Same | The same without `moodlewssettingraw`: `&amp;` |
| 26 | `core_course_get_courses_by_field`, `id` | One course: `categoryname`, `summary` as HTML with `summaryformat` 1 |
| 27 | Same | A course id that does not exist: `courses: []`, not an error |
| 28 | `core_user_get_users_by_field`, `username` | One person by username, as the connector asks by default |
| 29 | `core_course_get_courses_by_field`, `id` | Course 6, completed by Hillevi, with a summary that has inline HTML |
| 30 | `core_enrol_get_enrolled_users`, course 1 | The site's accounts from place 0, as the installation's first page asks: all seventeen in id order, Moodle's guest account (user 1), the administrator and the service account among them; `id`, `username`, `idnumber` and always the full name |
| 31 | Same | A window of six from place 5: Moodle pages the list by place (`limitfrom`), not by id |
| 32 | Same | A window past the end: an empty list, not an error |
| 33 | `core_user_get_users_by_field`, `username` | The first page's sixteen keys (every account of 30 but the guest's, which no read answers), looked up as the installation's read checks each finds its own account |
| 34 | `core_enrol_get_enrolled_users`, course 1 | Before `moodle/site:viewparticipants` was given: `nopermissions` |
| 35 | `core_badges_get_user_badges` | The guest's badges: `guestsarenotallowed`, an error about that one account. Why the installation's read leaves the guest out |
| 36 | `core_enrol_get_users_courses` | The guest's courses: an empty list |

## What the recordings say

- **Every error is HTTP 200.** The body is `{"exception", "errorcode", "message"}` instead of the answer (04, 09, 10,
  13 to 16). The connector reads `errorcode` and never passes `message` on.
- **A completion has no date of its own on the API.** `core_enrol_get_users_courses` says whether a course is completed
  (05); the date comes from `core_completion_get_course_completion_status`, one call per person and course, as the time
  each criterion was met (07). Moodle's completion cron stamps the course with the latest of those times whatever the
  aggregation (`max` in `lib/completionlib.php`, then `mark_complete`), so the latest is the course's. In the seed each
  course has one criterion, and its time is the one Moodle stores for the course (checked against
  `mdl_course_completions.timecompleted` on 2026-11-12).
- **Only a badge has an end date.** `dateexpire` (11), null when the badge does not expire. A course completion has
  none in Moodle LMS. A badge that has run out is still listed (21); whether it holds is the reader's to decide.
- **A person is looked up by an exact value.** `idnumber` is free text that Moodle does not lower-case or keep unique
  (02); `username` is always lower case and a value that is not is refused outright (04).
- **Names are escaped for HTML unless asked raw, and a badge's always.** A course name comes as stored with
  `moodlewssettingraw=true` and with `&amp;` without it (24, 25). A badge's name comes as `&#38;` either way (22, 23):
  `core_badges_get_user_badges` goes through Moodle's exporter, which runs `clean_string` on every text property.
- **What the account sees, and what it does not.** With the seed's capabilities the service account reads people,
  their courses, completions and badges. It is not an administrator, and the service lists thirteen
  read functions only (15). It does not see every holding: `core_enrol_get_users_courses` answers active enrolments
  only and skips a course the account may not enter, and for anyone but the holder Moodle forces `onlypublic` on badges,
  so a badge its holder has made private is not in the answer at all. The `visible: 0` on the badge in 11 is not the
  holder's choice (the three seeded badges have `mdl_badge_issued.visible = 1`): Moodle strips another person's badge
  record for a viewer who may not configure badges, and `visible` falls back to 0. Moodle has no relation the account
  can read that says whom a manager manages; Clew says it on every call (D117).

- **The site's accounts are the front page's participants.** On course 1 every account Moodle has not deleted counts as
  enrolled, suspended ones included (`get_enrolled_join` in `lib/enrollib.php`), so `core_enrol_get_enrolled_users`
  lists the whole site in id order, a window at a time (30 to 32). It needs `moodle/site:viewparticipants` (34). The
  function leaves out `suspended` even when asked for it, so whether an account is suspended comes from the lookup (33).
- **The guest is an account like the others in the list** (30, user 1), but Moodle refuses to read its badges (35). It is
  Moodle's own account for visitors, the local account named `guest` that `isguestuser()` recognises (`$CFG->siteguest`,
  set when Moodle is installed; the name cannot be changed), and nobody's, so no read of the connector answers it.

The site information (`core_webservice_get_site_info`) is not recorded: its answer carries the account's private access
key.
