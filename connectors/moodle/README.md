# moodle: what a learning platform knows about a person, as a Clew connector

A connector to [Moodle LMS](https://moodle.org/), the open source learning platform (GPL-3.0-or-later): the courses a
person has completed and when, the courses under way, one course in detail, and the badges they hold with the day each
runs out. Its id is `moodle`. It is the first source of the reserved profile `<id>.holdings` that Clew's competence
register is to copy ([D108](../../docs/decisions/D108-competence-is-an-owned-domain-one-holding-typed-against-a-catalogue.md)
item 9), and it gives the opened person a section "Utbildningar" captioned "Lärplattformen"
([D97](../../docs/decisions/D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md)).

It reads as **one service account** through Moodle's REST web service API, with the account's token from configuration;
it never needs the person's token. It speaks protocol 3: who may be asked about is Clew's to decide
([D117](../../docs/decisions/D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md)),
and the connector answers only the people a verified request vouches for. Nothing is stored between requests. No
dependencies beyond Node; nothing here imports the rest of the repository.

How Moodle actually answers is recorded in [samples/](samples/README.md): 29 real exchanges, cited below by number.

| File | Holds |
|---|---|
| `manifest.mjs` | The contract: four reads, their views, the holdings shape |
| `connector.mjs` | The reads, matching a person, who may be answered about, deadlines, and HTTP error handling |
| `learning.mjs` | The learning-platform port, its errors, and an in-memory stand-in shaped like the development seed |
| `moodle.mjs` | Moodle's REST API behind the port: the only code here that knows it |
| `server.mjs` | Serves it over HTTP, stops a read when Clew goes away, and reads the configuration |

## What it answers

| Capability | Shown as | Answers |
|---|---|---|
| `moodle.person` "Utbildningar" | A section on the opened person; a lens and a column on Personal when an administrator offers them | About a person (D97), asked with up to 50 keys: one row per key the platform knows, `completed` and `ongoing` course counts. Its row opens `moodle.courses` |
| `moodle.courses` "Kurser och märken" | The list under the section: course or badge, "Kurs" or "Märke", status, day, "Gäller till", and "Öppna i Lärplattformen" | One person's courses: "Pågår" (enrolled, not completed), "Genomförd" with the day; badges "Giltigt" or "Utgånget" (a warning tone) with the day issued and the day they run out. A course's row carries the person's key as asked and the course id, which open `moodle.course`, and a link to the course in Moodle. A badge's row opens nothing and links nowhere |
| `moodle.course` "Kurs" | A `detail` view: the course name as heading, then Kategori, Status, Genomförd (the day), Villkor, Om kursen, and the link | One person's one course: its category, status, the day it was completed, the completion criteria with which are met and when ("Markerad som klar av Teacher: uppfyllt 26 apr. 2026"), at most 12, and its summary as plain text, at most 600 characters |
| `moodle.holdings` | Nothing: the profile Clew's competence register is to copy | Up to 25 keys: `withdrawalsReported: false`, and one row per key vouched for that the platform knows, with every holding it can see: `id` (the source's row id), `type` (the source's type id), `label`, `kind` (`course` or `badge`), `issuedOn` and, when there is one, `expiresOn`. Through Clew today it answers no row ("Who may be answered about") |

All four are `model: false`. The view kinds are `list` and `detail`, from the closed catalogue (D100); `detail` is the
kind for one record, and an array field in it is drawn as one line, which is how the criteria are shown. Course and
badge names, a course's category and summary, and a criterion's title (an activity's or a role's name, as the site
names it: "Teacher" on the development Moodle, whose service account reads in English) are the only source text in an
answer; no person's name leaves the connector, and a holdings row names its person by the key Clew asked with. The
summary is a teacher's text, which is why `moodle.course` is never a tool.

**Badges have no drill-down.** A badge's row already holds everything Moodle says of it to another person (the name,
the day issued and the day it ends), and Moodle's answer holds no address for it: only its `uniquehash`, from which its
public assertion page could be built, a page anyone with the address can open. So a badge neither opens nor links.

**A holding.** A completed course is one holding: row id `course:<course id>:user:<Moodle user id>`, type the course's
`idnumber` (what an administrator sets, stable across sites) or `course:<course id>` when it has none, issued the day
it was completed, no end date (Moodle keeps none for a course). A badge is one holding: row id
`badge:<badge id>:user:<user id>`, type `badge:<badge id>`, issued `dateissued`, ends `dateexpire` when the badge has one
(11). Days are calendar days in `MOODLE_TIMEZONE`. A course `idnumber` that looks like `course:<n>` or `badge:<n>` is
not used as a type, so the two kinds never collide.

**Unknown and holding nothing are different answers.** A key the platform has no account for is no row, as D97 says for
a key it does not know (and for one the caller may not ask about). A person with an account and nothing completed is a
row: zeros in `moodle.person`, `holdings: []` in `moodle.holdings`.

**Absence is never a withdrawal.** Every holdings answer says `withdrawalsReported: false`: this source cannot report
that something was withdrawn, because Moodle leaves things out without saying so ("What it cannot see"). A holding
missing from a later answer must not be read as revoked. A row also says `partial: true` when something of that person
was refused or could not be dated in this answer (one course's completion, their course list, their badges); a row
without it is not thereby complete.

## Finding the person

Clew asks with the person's key, the provisioned user name (D97, compared without regard to case).
`MOODLE_MATCH_FIELD` names the Moodle user field that holds it: `username` (default) or `idnumber`. Moodle compares a
value exactly (02), so each key is looked up as asked and in lower case. A key that matches more than one account
without regard to case (two accounts that differ only in case, or that share the value) is no one, whoever asks; and
whose account it is is decided by the account found, not by the key asked.

- `username` (default): the person cannot change it. Moodle keeps it in lower case and unique, and a value it would
  change refuses the whole lookup (04), so it is sent in lower case only. A key Moodle still refuses (a character
  outside its plain set, on a site without extended username characters) is dropped and the rest asked again: that
  key is no one.
- `idnumber`: free text, neither lower-cased nor kept unique by Moodle, and editable by each person on their own profile
  unless locked ("What Moodle needs"). Only the spellings asked can be compared, so an account whose idnumber differs
  from the key in case other than all lower case (`Anna.Berg` for the key `anna.berg`) is not found, and a twin in a
  third spelling is not noticed.

## Who may be answered about

Clew's (D117). Every call that names a person goes through Clew's rule before it reaches the connector, whatever path
it came by, and carries in its body, which the assertion is bound to, how the caller stands to each key: `about`,
`{ entity: "person", relations: { <key>: <relation> } }`. The connector keeps no copy of the organisation.

| Capability | Names a person in | Admits (`person.admits`) |
|---|---|---|
| `moodle.person` | `keys` (about a person) | `self`, `managed` |
| `moodle.courses` | `person` (`person.param`) | `self`, `managed` |
| `moodle.course` | `person` (`person.param`) | `self`, `managed` |
| `moodle.holdings` | nothing Clew can resolve | nothing: see below |

- **Answered:** exactly the keys the verified request vouches for as `self` (the caller) or `managed` (a direct report
  as D99 has it, which Clew works out: a manager of several units reaches the reports on each, a manager higher in the
  tree the managers of the units below). Clew never sends a colleague to these reads: a key it may not be asked about is
  left out of `keys`, and a single `person` outside them is refused by Clew as an unknown capability is.
- **Fail-closed:** a key with no vouched relation, a missing `about` (a Clew on protocol 2, anything sending keys past
  Clew), an `about` for another entity and a relation other than `self` or `managed` are no row (`moodle.person`,
  `moodle.holdings`) or not found (`moodle.courses`, `moodle.course`), the same answer as for a person Moodle does not
  know, and nothing is looked up for them. The verifier, handed the request, refuses an assertion that was not issued
  for exactly this body and this capability, so an `about` cannot be added or changed, and refuses one without Clew's
  `body` claim, as a Clew on protocol 2 signs it.
- **What stays the connector's, because it is about Moodle and not about the organisation:** exactly one account must
  match a key; under `self` the account found must be the signed caller's own; and `moodle.course` answers not found for
  a course the person is not enrolled in, one that does not exist, and one the list would not show (enrolled, never
  completed, recording no completion), checking the caller's course id against the person's own enrolments before
  anything about the course is read.
- **`moodle.holdings` is answered by Clew with no `about`.** Its `keys` list names people, but protocol 3 can declare a
  list of people only on a read about a person; a read that is not one names a single person in `person.param`, and the
  loader refuses `person.param: "keys"` because `keys` is not a plain string property. So Clew resolves nobody in it,
  and the read, fail-closed, answers no row through Clew. It stays for the profile's shape (D108 item 9); see "The
  scheduled copy" for how D117 places a caller that would read it.

### Known limits

- **Reach is Clew's D117 rule, and only that.** Whatever Clew's directory says about who reports to whom is what the
  connector answers; it cannot catch a mistake there.
- **Suspended accounts are answered.** A suspended Moodle account is found and its holdings returned: what it completed
  stays true. A user name that Clew gives to someone new after its first holder left would inherit that account, its
  courses and its badges, until the old account is renamed or deleted in Moodle.
- **A Moodle account with no person in Clew** is never asked about, since Clew vouches only for people it knows.

## What it cannot see

Moodle leaves things out of its answers without saying so. None of these is an error, and none can be told from "does
not hold":

- **Ended enrolments.** `core_enrol_get_users_courses` answers active enrolments only, so a course whose enrolment has
  ended or been suspended is gone from the list, and with it its completion.
- **Courses the service account cannot enter.** The same function skips a course the account may not see (a hidden one,
  without `moodle/course:viewhiddencourses`) or whose participants or the person's profile it may not view.
- **Badges the holder does not show.** For anyone but the holder Moodle forces `onlypublic`: a badge its holder has made
  private is not returned at all. The `visible: 0` in another person's answer (11) is a default left by Moodle stripping
  the record for a non-owner, not the holder's choice.
- **Course badges, when switched off.** With `badges_allowcoursebadges` off a course's badges are left out, and with
  badges switched off altogether the answer is no badges.

## Call volume and time

Moodle has no bulk read for completion dates: `core_completion_get_course_completion_status` answers one person and one
course (07). The connector therefore asks only what each read needs:

| Read | Moodle calls |
|---|---|
| `moodle.person`, N keys | 1 lookup (per 50 values) + N `core_enrol_get_users_courses`. No completion date is read |
| `moodle.courses`, one person | 1 lookup + 1 courses + 1 badges + 1 per completed course |
| `moodle.course`, one course | 1 lookup + 1 courses + 1 `core_course_get_courses_by_field` + 1 completion status |
| `moodle.holdings`, N keys | 1 lookup + N courses + N badges + 1 per completed course |

The courses call asks for no participant counts (`returnusercount=0`), which Moodle would otherwise count per course.
At most `MOODLE_CONCURRENCY` (default 4) calls are open at once for one read, and each call has three seconds. A read
has a deadline: 3 seconds for `moodle.person`, inside the four seconds Clew gives a section's or a list's source (D97
item 7), and 8 for the others, inside the ten seconds Clew waits for any call. When the deadline passes, when Clew
closes the connection, or when one call fails the read, the calls under way are aborted, nothing still queued is
started, and the read answers that the platform did not answer. Clew sends at most 50 keys per `moodle.person` call
and at most four calls at once, so a list of 200 people is at most 16 open calls to Moodle. A holdings batch of 25
people with five completed courses each is 176 calls; Clew's copy of item 9 should spread its batches. On the
development stack, `moodle.person` for nine keys took 80 to 117 ms.

## Errors

Moodle answers every error as HTTP 200 with `exception` and `errorcode` (04, 09, 10, 13 to 16). The connector reads the
code and never passes Moodle's message on. One bad course or person never fails a batch.

| Moodle | The connector answers |
|---|---|
| `invalidtoken`, `accessexception` (a function the service does not list, or an account it does not admit), the service account suspended, deleted, unconfirmed or not set up, or the right to read people refused | `denied`, HTTP 401: "Lärplattformen godtar inte anslutningens behörighet." An operator's matter |
| No answer within three seconds or the read's deadline, a status other than 200, a body that is not JSON, any error code not below | `unavailable`, HTTP 503: "Lärplattformen svarar inte just nu." |
| For one course or one person: `nopermissions`, `requireloginerror`, `restrictedcontextexception`, `cannotviewreport`, `accessdenied`, `usernotconfirmed`, `userdeleted` | That item is left out and the person's holdings row says `partial`; a person whose course list is refused has no `moodle.person` row; a completed course whose day is refused is listed without it. In `moodle.courses` and `moodle.course`, one person's own list refused is `unavailable`: a list with a part silently missing would read as whole |
| `usernotenroled`, `invalidrecordunknown`, `nocriteriaset` on a completion (09, 10) | No date: the course is not completed for this person |
| `invalidrecordunknown` or `badgesdisabled` on badges (13) | No badges |
| A person not found or not to be answered about; a course not theirs or not there | `not-found`, HTTP 404 |
| Input not as declared | `invalid`, HTTP 400 |

## What Moodle needs

A Moodle account for the connector that is no administrator, with a role at system level that may read people,
courses, completions and badges; an external service with "authorised users only" that lists the five functions below
and admits that account; and a token for it. The development seed's role (`clewconnector` in
`.devcontainer/moodle/seed.php`) grants `webservice/rest:use`, `moodle/user:viewdetails`, `moodle/user:viewalldetails`,
`moodle/user:viewhiddendetails`, `moodle/course:view`, `moodle/course:viewhiddencourses` (without it a hidden course is
silently missing), `moodle/course:viewparticipants`, `moodle/site:accessallgroups`, `report/completion:view`,
`moodle/badges:viewotherbadges`, `moodle/badges:viewbadges` and four competency capabilities this connector does not
use; whether fewer suffice has not been tried.

**Lock `idnumber` when it is the match field.** A person can change their own `idnumber` on their profile unless the
authentication method locks it (`field_lock_idnumber` set to `locked` for each method in use, under Site administration
› Plugins › Authentication). Unlocked, a person could give themself a colleague's idnumber, so that the colleague is no
one (two accounts match) or, had the colleague none, so that their own courses pass for the colleague's. `username`, the
default match field, cannot be changed by its holder. The seed locks `idnumber` for `manual`, the method its accounts
use.

| Function | For |
|---|---|
| `core_user_get_users_by_field` | Finding a person by username or idnumber (01 to 04, 17, 28) |
| `core_enrol_get_users_courses` | A person's courses, completed or not (05, 06, 24, 25) |
| `core_completion_get_course_completion_status` | The day a course was completed and its criteria (07 to 10, 18 to 20) |
| `core_course_get_courses_by_field` | One course's category and summary (26, 27, 29) |
| `core_badges_get_user_badges` | A person's badges with their days (11 to 13, 21 to 23) |

Every call asks for text as it is stored (`moodlewssettingraw=true`), since Clew draws text and not HTML: a course name
then comes as stored (24; without it, `&amp;` in 25). A badge's name is escaped by Moodle whatever is asked (22, 23),
so the connector reads `&#38;` and its kin back to text. A course summary is HTML, read as plain text.

`.devcontainer/moodle/seed.php` sets all of this up on the development Moodle, with a fixed development token.

## Configuration

| Variable | Meaning |
|---|---|
| `CLEW_CONNECTOR_SECRET` | The secret shared with Clew, 16 characters or more. Required |
| `CLEW_URL` | Trusted Clew base URL, used to fetch `/api/connectors/jwks`. Required; HTTPS outside the local development allowlist |
| `PORT` | Default 4053 |
| `MOODLE_ADAPTER` | `fixture` (default, the stand-in) or `moodle` (the real API) |
| `MOODLE_URL` | Moodle's base address as the connector reaches it. Required for `moodle`; HTTPS unless localhost |
| `MOODLE_TOKEN` | The service account's web service token. Required for `moodle`. Sent in the form body of every call, never in the address |
| `MOODLE_ALLOW_HTTP` | `true` lets `MOODLE_URL` be plain http on a private development network (`http://moodle`) |
| `MOODLE_PUBLIC_URL` | Moodle's address in the person's browser, for links to a course (`<address>/course/view.php?id=<id>`). Optional: without it there are no links. HTTPS unless localhost |
| `MOODLE_MATCH_FIELD` | `username` (default) or `idnumber`: the Moodle field that holds the key Clew sends |
| `MOODLE_SOURCE_LABEL` | The system's name as a person reads it. Default `Lärplattformen` |
| `MOODLE_TIMEZONE` | The zone Moodle's times are read as days in. Default `Europe/Stockholm` |
| `MOODLE_CONCURRENCY` | How many Moodle calls one read may have open at once, 1 to 16. Default 4 |

## The stand-in

`learning.mjs` holds a made-up Moodle shaped like the development seed: the same people, five courses and completion
pattern, dated from the clock, with a category and a summary, and the badge "HLR-instruktör", Johan's
run out; plus what the tests need and the seed lacks: `sara`, whose idnumber is an employee number, `lisa` with an
account and no course, a completed course without an idnumber, a course that records no completion, and a second
badge, run out for one person and without an end for another. It compares a looked-up value exactly, as Moodle does,
and every course is finished by a teacher's word, as in the seed. Its `controls` take it down, make it refuse the
token, refuse one person's courses or badges or one course's completion, add an account, complete a course and count
the calls.

## Run and check

In the development stack the connector is the `moodle-connector` service of `.devcontainer/compose.yaml`, in the
`moodle` profile, on `127.0.0.1:4053`, with the `moodle` adapter against `http://moodle`, the seed's token, and links
to `http://localhost:3024`. It is not started or registered by `bun run dev:connectors`. From the host, with the
development Moodle running (`sh scripts/moodle.sh start`):

```sh
sh scripts/compose.sh --profile moodle up -d --no-deps moodle-connector
docker exec -w /workspace clew-app-1 bun scripts/connector-check.ts http://moodle-connector:4053 --id moodle --secret <CLEW_DEV_CONNECTOR_SECRET> --keys hillevi,anna,erik --as hillevi
docker exec -w /workspace clew-app-1 bun scripts/connector-add.ts moodle http://moodle-connector:4053 --secret <CLEW_DEV_CONNECTOR_SECRET>
```

The secret is the stack's development transport key (`CLEW_DEV_CONNECTOR_SECRET`, `clew-dev-only-transport-key` unless
set). The last command creates a draft registration; set its audience and enable it under Administration › Anslutna
system, where "Utbildningar" can also be offered as a lens on Personal. A changed environment (such as
`MOODLE_PUBLIC_URL`) takes effect when the container is created again, not on a restart.

Tests: `bun test tests/unit/moodle-connector.test.ts`: the connector over the stand-in through Clew's registry, given a
small directory that says how each reader stands to each person, and straight to the service as Clew calls it (the
rows, an unknown person against one holding nothing, `withdrawalsReported`, one course opened from its row and every way
of not finding one; self, managed, a colleague refused by Clew, a manager of two units and one higher in the tree
reaching their reports because Clew says so; no `about`, a relation it does not answer, `self` for someone else's
account, a forged `about`, an assertion for another capability and one without Clew's body claim; holdings answering no
row through Clew; the match field and case twins, one person or course refused within a batch, deadlines, fail-fast and
Clew going away, error mapping, call volume and concurrency, the conformance check), and the API adapter against the
recorded exchanges, request for request, alone and behind the connector.

## Checked against the development Moodle

On 2026-11-12 against Moodle LMS 5.3.1 as seeded by `.devcontainer/moodle/seed.php`, reinstalled that afternoon:

- The exchanges in [samples](samples/README.md) were recorded from it, and the adapter tests replay them. Samples 22 to
  25 were recorded while a badge and a course were renamed with "&" and named back afterwards.
- The `idnumber` lock was read back as Moodle's profile form reads it: for Johan's account (`manual`),
  `field_lock_idnumber` is `locked`, which the form hard-freezes; `firstname` stays editable.
- On protocol 3 (D117), the connector ran as the compose service with the `moodle` adapter, `username` matching and
  `MOODLE_PUBLIC_URL`. `connector-check` with
  `--keys hillevi,hassan,anna,erik,maria,johan,karin,mikael,lars.bergstrom,okand --as hillevi`, through the
  installation's own rule and signed by its key, passed: four capabilities, each naming a person admitting `self` and
  `managed`; ten keys gave seven rows in 335 ms (Hillevi and six of her reports; Hassan and Mikael are colleagues to
  her, `okand` nobody), and no row for an unknown key or for keys sent without a relation.
- Through a registry with the installation's own rule (`relations.relate` over the development directory), its signing
  key and the running service: Clew said Hillevi stands as `self` to herself and `managed` to anna, erik, maria, johan,
  karin, lars.bergstrom, maria.eriksson, omar.hosseini, petra.karlsson, sven.lundgren and yusuf.lindqvist, and
  `colleague` to Hassan and Mikael. As Hillevi, `moodle.person` for those fourteen keys answered her and her eleven
  reports (117 ms); `moodle.courses` for Johan his courses with links to `http://localhost:3024/course/view.php?id=<id>`;
  `moodle.course` for Johan's course 5 "Genomförd" on 2026-04-26 with "Markerad som klar av Teacher: uppfyllt 26 apr.
  2026", the summary and the link; `moodle.courses` for Hassan refused by Clew ("Okänd förmåga."); `moodle.holdings`
  `withdrawalsReported: false` and no row, as protocol 3 leaves it. As Hassan: `moodle.person` for himself, Johan and
  Hillevi answered himself only; his own list answered; Johan's list and Johan's course refused by Clew.
- Straight to the running service, signed by the installation's key and bound to the body: Johan's list as Hassan with
  no `about`, and with `about` saying `colleague`, not found (404); keys with no `about`, no row; an assertion without
  the body claim, as a Clew on protocol 2 signs it, refused (401).
- With a badge and a course renamed to contain "&", `moodle.courses` through the running service answered
  "HLR- & AED-instruktör" and "Informationssäkerhet & dataskydd för medarbetare"; both were named back (before the move
  to protocol 3).

Not verified: the section and the course detail on a page in the browser, a screen reader on them, a Moodle with more
than a few hundred completions, `MOODLE_MATCH_FIELD=idnumber` against the real Moodle (the stand-in and the recorded
lookups only), a Moodle site with extended username characters, a course whose completion has several criteria (the
recorded courses have one each), the per-item refusals against a real Moodle (stand-in and synthetic answers only), the
deadline and disconnect against a slow real Moodle, and the running Clew's own registration on protocol 3 (refreshed
by hand).

## What Moodle could not say

- **When a course completion ends.** Moodle LMS keeps no end date for a course or a competency; only a badge has one.
  An employer's validity rule (three years for fire safety) belongs to the type in Clew's catalogue (D108 item 3).
- **A completion's own date over the API.** Only a time per criterion (07). Moodle's completion cron stamps the course
  with the latest time of the criteria met, whatever the aggregation (`max` in `lib/completionlib.php`, then
  `mark_complete`), and the connector takes the same.
- **Whom a manager manages.** Moodle keeps no such relation that the service account can read; Clew says it (D117).
- **That something was withdrawn.** See "What it cannot see".
- **Competencies.** The seed rates one competency per course, and the service lists the functions for them, but a
  rating carries the time it was rated, not the time of the course; this connector does not read them.

## What it never does

It does not write to Moodle, store or cache anything between requests, log request or response bodies, pass on Moodle's
error text, or name a person in an answer beyond the key Clew asked with.

## The scheduled copy

D108 item 9's copy runs on a schedule with nobody signed in, and is not built. D117 says how such a caller fits: a read
the installation makes, with no actor and no key in its input, so nothing in it is resolved; what it brings back is
shown under Clew's own rules; and if such a read ever had to name people, the rule would need an answer for a system
caller, decided then. `moodle.holdings` is not that read: it takes keys and answers only those vouched for as `self` or
`managed`, so a caller that is nobody gets no row. A copy as D117 describes it would be a read without keys that answers
every holding the platform has, and the connector would need a way to tell that the call is the installation's own,
which protocol 3 does not give it. Both are left for when the copy is built.

Node's official image is MIT. The connector has no other dependency.
