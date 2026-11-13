# moodle: what a learning platform knows about a person, as a Clew connector

A connector to [Moodle LMS](https://moodle.org/), the open source learning platform (GPL-3.0-or-later): the courses a
person has completed and when, the courses under way, one course in detail, and the badges they hold with the day each
runs out. Its id is `moodle`. It gives the opened person a section "Utbildningar" captioned "Lärplattformen"
([D97](../../docs/decisions/D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md)), and it is the first
source of the holdings profile, `<id>.holdings`, that Clew's competence register copies
([D108](../../docs/decisions/D108-competence-is-an-owned-domain-one-holding-typed-against-a-catalogue.md) item 9): a read
Clew makes as the installation itself, with no person behind it
([D119](../../docs/decisions/D119-the-installation-reads-as-itself-through-a-read-no-person-can-reach.md)).

It reads as **one service account** through Moodle's REST web service API, with the account's token from configuration;
it never needs the person's token. It speaks protocol 3: who may be asked about is Clew's to decide
([D117](../../docs/decisions/D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md)),
and the connector answers only the people a verified request vouches for; the installation's read answers every
account, and only to the installation's own assertion. Nothing is stored between requests. No
dependencies beyond Node; nothing here imports the rest of the repository.

How Moodle actually answers is recorded in [samples/](samples/README.md): 36 real exchanges, cited below by number.

| File | Holds |
|---|---|
| `config.mjs` | Which adapter the environment names: always said, and a half-configured deployment does not start |
| `manifest.mjs` | The contract: three reads a person makes, their views, and the installation's read of the holdings profile |
| `connector.mjs` | The reads, matching a person, who may be answered about, the installation's pages, deadlines, and HTTP error handling |
| `learning.mjs` | The learning-platform port, its errors, and an in-memory stand-in shaped like the development seed |
| `moodle.mjs` | Moodle's REST API behind the port: the only code here that knows it |
| `server.mjs` | Serves it over HTTP, stops a read when Clew goes away, and reads the configuration |

## What it answers

| Capability | Shown as | Answers |
|---|---|---|
| `moodle.person` "Utbildningar" | A section on the opened person; a lens and a column on Personal when an administrator offers them | About a person (D97), asked with up to 50 keys: one row per key the platform knows, `completed` and `ongoing` course counts. Its row opens `moodle.courses` |
| `moodle.courses` "Kurser och märken" | The list under the section: course or badge, "Kurs" or "Märke", status, day, "Gäller till", and "Öppna i Lärplattformen" | One person's courses: "Pågår" (enrolled, not completed), "Genomförd" with the day; badges "Giltigt" or "Utgånget" (a warning tone) with the day issued and the day they run out. A course's row carries the person's key as asked and the course id, which open `moodle.course`, and a link to the course in Moodle. A badge's row opens nothing and links nowhere. At most 500 rows: a longer list is cut, the oldest completed courses first, then the oldest badges, and its last row is the line "Listan är avkortad: N kurser och märken till visas inte här." |
| `moodle.course` "Kurs" | A `detail` view: the course name as heading, then Kategori, Status, Genomförd (the day), Villkor, Om kursen, and the link | One person's one course: its category, status, the day it was completed, the completion criteria with which are met and when ("Markerad som klar av Teacher: uppfyllt 26 apr. 2026"), at most 12, and its summary as plain text, at most 600 characters |
| `moodle.holdings` (under `installation`) | Nothing: the installation's read, which Clew's competence register copies (D119) | Every account the service account can see, a page of at most 25 at a time in Moodle's id order: one row per account, keyed by the value of the match field, with every holding it can see: `id` (the source's row id), `type` (the source's type id), `label`, `kind` (`course` or `badge`), `issuedOn` and, when there is one, `expiresOn`; `next` for the following page, absent on the last; `withdrawalsReported: false`. Not a capability: no person reaches it ("The installation's read of every holding") |

The three reads a person makes are `model: false`, and the installation's read is never a tool. The view kinds are `list` and `detail`, from the closed catalogue (D100); `detail` is the
kind for one record, and an array field in it is drawn as one line, which is how the criteria are shown. Course and
badge names, a course's category and summary, and a criterion's title (an activity's or a role's name, as the site
names it: "Teacher" on the development Moodle, whose service account reads in English) are the only source text in an
answer; no person's name leaves the connector, and a holdings row names its account by the value of the match field. The
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
row: zeros in `moodle.person`, `holdings: []` in `moodle.holdings`, where every account the platform lists has a row
unless it is withheld or ambiguous ("The installation's read of every holding").

**Absence is never a withdrawal.** Every holdings answer says `withdrawalsReported: false`: this source cannot report
that something was withdrawn, because Moodle leaves things out without saying so ("What it cannot see"). A holding
missing from a later answer must not be read as revoked. A row also says `partial: true` when something of that person
was refused or could not be dated in this answer (one course's completion, their course list, their badges); a row
without it is not thereby complete.

## Finding the person

Clew asks with the person's key, the provisioned user name (D97, compared without regard to case).
`MOODLE_MATCH_FIELD` names the Moodle user field that holds it: `username` (default) or `idnumber`. Moodle compares a
value exactly (02), so each key is looked up in lower case, and the person's account is the one that holds the key in
that spelling. A key that no account holds in lower case, or that more than one does, is no one, whoever asks; and
whose account it is is decided by the account found, not by the key asked.

- `username` (default): the person cannot change it. Moodle keeps it in lower case and unique, and a value it would
  change refuses the whole lookup (04), so it is sent in lower case only. A key Moodle still refuses (a character
  outside its plain set, on a site without extended username characters) is dropped and the rest asked again: that
  key is no one.
- `idnumber`: free text, neither lower-cased nor kept unique by Moodle, and editable by each person on their own profile
  unless locked ("What Moodle needs"). Only an account that holds the key in lower case is the person's: an idnumber
  with a capital letter (`Anna.Berg`, `AB12`) is no one, in a person's read and in the installation's. Moodle compares
  exactly, so the connector cannot ask whether another account holds the same idnumber in another spelling, and Clew
  compares keys without regard to case: `Ab12` on one page of the installation's read and `AB12` on another would
  both have been copied to the same person. The lower-case spelling is the one an exact lookup settles, since every
  account that holds it comes back and more than one is no one. An installation whose idnumbers have capital letters
  matches on `username`, or lower-cases them in Moodle first. Clew's copy checks the same thing from its side: a
  person answered by two rows of one read gets nothing from either (D108 item 9).

## Who may be answered about

Clew's (D117). Every call that names a person goes through Clew's rule before it reaches the connector, whatever path
it came by, and carries in its body, which the assertion is bound to, how the caller stands to each key: `about`,
`{ entity: "person", relations: { <key>: <relation> } }`. The connector keeps no copy of the organisation.

| Capability | Names a person in | Admits (`person.admits`) |
|---|---|---|
| `moodle.person` | `keys` (about a person) | `self`, `managed` |
| `moodle.courses` | `person` (`person.param`) | `self`, `managed` |
| `moodle.course` | `person` (`person.param`) | `self`, `managed` |
| `moodle.holdings` | nobody: it is the installation's | no person at all: see below |

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
- **`moodle.holdings` answers the installation, and nobody else** (D119). It is declared under `installation`, not
  among the capabilities, so Clew's registry offers it to no person: a person, an administrator included, who names it
  on any path is refused as for a name nobody declared. Clew posts it to `/clew/installation/moodle.holdings` with the
  installation's own assertion (no `actor`, subject `clew:installation`, `caller: "installation"`), bound to the body
  and the name; the connector verifies it with `verify.installation` and answers any other assertion there, a person's
  however valid, with 401. The installation's assertion is in turn refused on a person's route.

### Known limits

- **Reach is Clew's D117 rule, and only that.** Whatever Clew's directory says about who reports to whom is what the
  connector answers; it cannot catch a mistake there.
- **Suspended accounts are answered.** A suspended Moodle account is found and its holdings returned: what it completed
  stays true. A user name that Clew gives to someone new after its first holder left would inherit that account, its
  courses and its badges, until the old account is renamed or deleted in Moodle.
- **A Moodle account with no person in Clew** is never asked about by a person's read, since Clew vouches only for
  people it knows. The installation's read answers every account but Moodle's guest account, the administrator and
  the service account included; Clew matches the keys to its people and has no use for the others.
- **Moodle's guest account is nobody's.** No read answers it: the local account named `guest`, which Moodle creates at
  install, keeps in `$CFG->siteguest` and recognises in `isguestuser()`, and whose name cannot be changed. A key that
  finds it is no one, and the installation's read lists it with everyone (30) and leaves it out. A remote account of an
  MNet peer named `guest` is left out too, since the list does not say which host an account is from.

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
- **Accounts whose details are withheld.** The site's list (30) gives an account the service account may not see the
  details of with its id and full name only: no username, so no key and no row in the installation's read.

## Call volume and time

Moodle has no bulk read for completion dates: `core_completion_get_course_completion_status` answers one person and one
course (07). The connector therefore asks only what each read needs:

| Read | Moodle calls |
|---|---|
| `moodle.person`, N keys | 1 lookup (per 50 values) + N `core_enrol_get_users_courses`. No completion date is read |
| `moodle.courses`, one person | 1 lookup + 1 courses + 1 badges + 1 per completed course |
| `moodle.course`, one course | 1 lookup + 1 courses + 1 `core_course_get_courses_by_field` + 1 completion status |
| `moodle.holdings`, one page of N accounts (N ≤ 25) | 1 list of the site's accounts (rarely more, below) + 1 lookup (per 50 values) + N courses + N badges + 1 per completed course |

The courses call asks for no participant counts (`returnusercount=0`), which Moodle would otherwise count per course.
At most `MOODLE_CONCURRENCY` (default 4) calls are open at once for one read, and each call has three seconds. A read
has a deadline: 3 seconds for `moodle.person`, inside the four seconds Clew gives a section's or a list's source (D97
item 7), and 8 for the others, inside the ten seconds Clew waits for any call. When the deadline passes, when Clew
closes the connection, or when one call fails the read, the calls under way are aborted, nothing still queued is
started, and the read answers that the platform did not answer. Clew sends at most 50 keys per `moodle.person` call
and at most four calls at once, so a list of 200 people is at most 16 open calls to Moodle. A holdings batch of 25
people with five completed courses each would be 177 calls; the installation's read bounds a page in time as well
("The installation's read of every holding"). On the development stack, `moodle.person` for nine keys took 80 to 117 ms.

## Errors

Moodle answers every error as HTTP 200 with `exception` and `errorcode` (04, 09, 10, 13 to 16). The connector reads the
code and never passes Moodle's message on. One bad course or person never fails a batch.

| Moodle | The connector answers |
|---|---|
| `invalidtoken`, `accessexception` (a function the service does not list, or an account it does not admit), the service account suspended, deleted, unconfirmed or not set up, the right to read people refused, or the site's accounts refused (34) | `denied`, HTTP 401: "Lärplattformen godtar inte anslutningens behörighet." An operator's matter |
| No answer within three seconds or the read's deadline, a status other than 200, a body that is not JSON, any error code not below | `unavailable`, HTTP 503: "Lärplattformen svarar inte just nu." |
| For one course or one person: `nopermissions`, `requireloginerror`, `restrictedcontextexception`, `cannotviewreport`, `accessdenied`, `usernotconfirmed`, `userdeleted`, and `guestsarenotallowed`, which Moodle gives for a guest's badges (35) | That item is left out and the person's holdings row says `partial`; a person whose course list is refused has no `moodle.person` row; a completed course whose day is refused is listed without it. In `moodle.courses` and `moodle.course`, one person's own list refused is `unavailable`: a list with a part silently missing would read as whole |
| `usernotenroled`, `invalidrecordunknown`, `nocriteriaset` on a completion (09, 10) | No date: the course is not completed for this person |
| `invalidrecordunknown` or `badgesdisabled` on badges (13) | No badges |
| A person not found or not to be answered about; a course not theirs or not there | `not-found`, HTTP 404 |
| Input not as declared, a cursor among it | `invalid`, HTTP 400 |
| On `/clew/installation/{name}`: any assertion but the installation's own, bound to the request | `denied`, HTTP 401, before anything is read |

## What Moodle needs

A Moodle account for the connector that is no administrator, with a role at system level that may read people,
courses, completions and badges and list the site's accounts; an external service with "authorised users only" that
lists the six functions below and admits that account; and a token for it. The development seed's role
(`clewconnector` in `.devcontainer/moodle/seed.php`) grants `webservice/rest:use`, `moodle/user:viewdetails`,
`moodle/user:viewalldetails`, `moodle/user:viewhiddendetails`, `moodle/course:view`, `moodle/course:viewhiddencourses`
(without it a hidden course is silently missing), `moodle/course:viewparticipants`, `moodle/site:viewparticipants`
(the site's accounts for the installation's read; without it that read is refused, 34), `moodle/site:accessallgroups`,
`report/completion:view`,
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
| `core_badges_get_user_badges` | A person's badges with their days (11 to 13, 21 to 23, 35) |
| `core_enrol_get_enrolled_users` | The site's accounts, a window at a time, as the front page's participants (30 to 32, 34) |

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
| `MOODLE_ADAPTER` | `moodle` (the real API) or `fixture` (the stand-in, made-up people: development and tests only). Required, no default: the connector does not start without it |
| `MOODLE_URL` | Moodle's base address as the connector reaches it. Required for `moodle`, refused for `fixture`; HTTPS unless localhost |
| `MOODLE_TOKEN` | The service account's web service token. Required for `moodle`, refused for `fixture`. Sent in the form body of every call, never in the address |
| `MOODLE_ALLOW_HTTP` | `true` lets `MOODLE_URL` be plain http on a private development network (`http://moodle`) |
| `MOODLE_PUBLIC_URL` | Moodle's address in the person's browser, for links to a course (`<address>/course/view.php?id=<id>`). Optional: without it there are no links. HTTPS unless localhost |
| `MOODLE_MATCH_FIELD` | `username` (default) or `idnumber`: the Moodle field that holds the key Clew sends |
| `MOODLE_SOURCE_LABEL` | The system's name as a person reads it. Default `Lärplattformen` |
| `MOODLE_TIMEZONE` | The zone Moodle's times are read as days in. Default `Europe/Stockholm` |
| `MOODLE_CONCURRENCY` | How many Moodle calls one read may have open at once, 1 to 16. Default 4 |

The adapter is always named (`config.mjs`). The stand-in answers with made-up people whose user names can be real ones
in an installation, and Clew copies what a source holds into its competence register, where a later change of adapter
does not take it out again. So a start without `MOODLE_ADAPTER`, as `moodle` without the address or the token, or as
`fixture` beside either of them, fails with the variable to change, before anything is served.

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

The conformance check also reads the installation's first pages, as Clew reads them, and reports counts only, and it
posts a person's assertion to `/clew/installation/moodle.holdings`, which must be refused (401).

Tests: `bun test tests/unit/moodle-connector.test.ts`: the connector over the stand-in through Clew's registry, given a
small directory that says how each reader stands to each person, and straight to the service as Clew calls it (the
rows, an unknown person against one holding nothing, one course opened from its row and every way of not finding one;
self, managed, a colleague refused by Clew, a manager of two units and one higher in the tree reaching their reports
because Clew says so; no `about`, a relation it does not answer, `self` for someone else's account, a forged `about`, an
assertion for another capability and one without Clew's body claim; the installation's read: every account a page at a
time to the end, the same cursor giving the same page, accounts added during a read, accounts deleted before the cursor
and more than the overlap, a withheld account, idnumber twins, a suspended account, partial rows, a failing page, the
time budget and a deadline inside the first account, a person's assertion on its route and the installation's on a
person's, and no person reaching it through Clew; the match field and case twins, one person or course refused within
a batch, deadlines, fail-fast and Clew going away, error mapping, call volume and concurrency, the conformance check),
and the API adapter against the recorded exchanges, request for request, alone and behind the connector.
`tests/unit/installation-read.test.ts` holds the registry's side and the verifier.

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
- The installation's read (D119), later that day: the seed's role given `moodle/site:viewparticipants` (34 is the
  refusal before it), and the connector of this change run in process inside the development stack against
  `http://moodle`, through a registry with an installation signing key of its own. `holdingsSources()` named `moodle`;
  `readHoldings` answered every account in one page. Its first run answered 17 rows and failed nothing but marked the
  guest's row partial, since Moodle refuses the guest's badges (35, found by that run, which before had failed the
  whole page on it); Moodle's guest account was then left out of every read. Read again after that: 16 rows (the
  administrator, the seven seeded people and the eight handed over for Hillevi's unit, and the service account), 50
  holdings (47 dated courses, 3 badges), no partial row, `withdrawalsReported: false`, no `next`. 81 Moodle calls (1
  list, 1 lookup, 16 courses, 16 badges, 47 completions) in 569 to 684 ms over three runs. A person naming it through
  the registry was refused ("Okänd förmåga."), and a person's assertion posted to its route answered 401. The
  conformance check in process passed with "1 page, 16 rows, 50 holdings, 0 partial" and the person refused. The running
  compose service still serves the checkout on `main`, and was not restarted.

Not verified: the section and the course detail on a page in the browser, a screen reader on them, a Moodle with more
than a few hundred completions or more than one page of accounts (the paging, the overlap and the time budget are
tested on the stand-in only), `MOODLE_MATCH_FIELD=idnumber` against the real Moodle (the stand-in and the recorded
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

## The installation's read of every holding

D108 item 9's copy runs on a schedule with nobody signed in, and reads `moodle.holdings` as the installation (D119): no
actor, no key, a cursor. A page answers the site's accounts in Moodle's id order, at most 25 (`HOLDINGS_PAGE`), each with
every holding the platform can see, and `next` until the last page.

**How it lists everyone.** Moodle has no call that lists every account a page at a time by id, and no bulk read of
completion dates. The cheapest correct listing its web service offers is the front page's participants:
`core_enrol_get_enrolled_users` on course 1 (`SITEID`), on which every account Moodle has not deleted counts as enrolled,
suspended ones included, sorted by id, with only `id,username,idnumber` asked for (30 to 32). It needs
`moodle/site:viewparticipants`. The alternatives read: `core_user_get_users` matches on `email LIKE '%'` (an account
without an e-mail is left out), has no paging and loads every account's courses; `core_user_get_users_by_field` by
ranges of ids cannot tell the end of the list from a run of deleted accounts; a course's participants miss accounts on no
course; a report builder report could give completion dates in bulk, but only as dates formatted for a reader, from a
report an administrator must build first.

**The cursor** is `<id>:<place>`: the id of the last account answered and its place in Moodle's list. Moodle pages that
list by place, and an account deleted before the cursor moves every later one up a place, so a page reads from 10 places
earlier (`OVERLAP`) and skips the accounts already answered. If even that window starts past an account not yet
answered, more than 10 were deleted since: the page steps back four times as far, to the list's start at worst. Accounts
are added at the end of the list, so a new one comes on a later page. The same cursor reads the same page again while
Moodle does not change. A cursor that is not one is `invalid`.

**Who has a row.** An account's key is the value of the match field. Each key of a page is checked as every read checks
one: it must be in lower case and find its own account and no other (33). So an account whose key has a capital letter
is no one, on whatever page an account that differs from it only in case may be, as are two accounts that share a key;
an account whose details the service account may not see has no key; neither has a row, and the page goes on past them.
Moodle's guest account has no row either: it is listed with everyone and nobody's. A suspended account is answered: what it completed stays true. The limit under "Known limits" stays: a user name Clew
gives to someone new while the old account is suspended and not renamed carries that account's rows. Each holding's `id`
names the Moodle account (`course:<id>:user:<user id>`), never the user name, so rows of two accounts never merge, but
which person a row is copied to is Clew's to decide.

**Cost and time.** One page of N accounts is 1 list call (one more per step back, rarely), 1 lookup (per 50 values), N
course lists, N badge lists and one completion call per completed course: for 25 accounts with five completed courses
each, 177 calls. The calls go through the read's limit (`MOODLE_CONCURRENCY`, default 4) with half as many accounts
worked on at once. A page has eight seconds (`DEADLINES.holdings`), inside the ten Clew waits, and starts no account
after half of it, except the first: a slow Moodle gives shorter pages, and the read still moves on. If the deadline
passes before the first account is finished, the page answers that account with what was read of it, marked `partial`,
and moves past it, so one account with very many courses cannot stop the read; with nothing of it read the account is
answered `partial` and empty, and the read moves past it all the same, since an `unavailable` page would stop the sweep
at that account on every try. A call that fails fails the page (`unavailable`, or `denied` when Moodle refuses the token or the list of
accounts), and Clew asks the same cursor again later. On the development Moodle a page of 16 accounts took 0.4 to 0.7 s
and 81 calls.

Node's official image is MIT. The connector has no other dependency.
