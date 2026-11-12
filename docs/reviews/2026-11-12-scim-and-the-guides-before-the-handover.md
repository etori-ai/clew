# Review: SCIM and the two guides before they are handed to the directory team · 2026-11-12

Date: 2026-11-12

Reviewed revision: the working tree on `main` at `eb8d4a8`, with the uncommitted work of
[D114](../decisions/D114-person-profiles-show-employments-and-categorised-phone-numbers.md) (phone numbers and current
employments)
Status: review; every finding was fixed the same day on the product owner's word, see Outcome

## Question

The product owner asked for one more review of the SCIM handling together with the guides, to be sure they can be
sent to the people who answer for users and for the organisation.

This is the fifth review of the SCIM server. The [fourth](2026-11-11-scim-full-review.md) ended in D113, which is
merged. Since then one thing is new and unreviewed: D114, which adds `phoneNumbers` and an employment extension to a
user, and both guides now ask the directory team to send them.

## Method

- Both guides read as the directory team reads them, every statement about the server held against the code.
- Three probes on the memory adapter through the HTTP routes, about ninety requests: the refusal table of the
  operations guide row by row, every statement the guides make about phone numbers and employments, the shapes a
  hand-written provisioner and the stock clients send, and the example provisioner pushed twice with the check run
  after it. "Reproduced" below means the request was sent and the answer seen.
- `bun run check` on the working tree (format, types, dependency rules, purity, the unit suite, the Node suite, the
  documentation check): passed. The SCIM store contract and the concurrency test on PostgreSQL: 31 passed.

Not covered: the profile page's accessibility, a real directory or identity provider, and the published site, which
is built from `main` and so does not yet contain D114.

## Assessment

**What was reviewed before holds.** Every row of the refusal table answers with the status and the `detail` the guide
prints, but one word in one row (G8). The walkthrough's blocks are run verbatim by a test and pass. The example pushes
250 people and 113 groups, a second push changes nothing, and the check reads the tree as the guide says. D113 holds
for the new attributes too: a deactivation goes through beside a phone number or an employment Clew cannot read.

**D114 is not ready to be sent.** It was written in a day, and it breaks the three rules the earlier reviews
established for everything else:

- *Display data refuses a person.* D110 says a title decides nothing and so never refuses a request. A phone number
  and an employment decide nothing either, and one empty mobile field refuses the whole person (S1).
- *A request the server does not read answers 200.* `employments` written without the extension's URN is accepted and
  stores nothing, and the check cannot show it (S3).
- *The guides do not say what goes wrong or what the reader has to decide.* Which title the user list shows, what an
  employment has to do with a placement, that every number sent is shown to every colleague (G1 to G4).

**The page the directory team receives is not the page that was reviewed.** D114 is uncommitted. The published guides
are the ones from before it, which say a phone number is ignored.

## Findings

### The server

| # | Finding | Evidence |
|---|---|---|
| S1 | **A phone number or an employment Clew cannot read refuses the whole person.** `POST`, `PUT` and a `PATCH` that does not deactivate answer 400 for a phone `value` that is empty, `null`, a number or longer than 512 characters, for a `type` that is empty, and for an employment without a `unitId`. A person who cannot be created cannot sign in; on the daily `PUT` the person's other changes are lost with it. `value: null` contradicts the guide's own rule that `null` is the same as absent. A directory of several thousand people has empty phone fields. | Reproduced |
| S2 | **`home` numbers are stored and shown to every colleague.** A work address of type `home` is never taken, so that a private address is not shown as the work one. A phone number of type `home` is taken and listed on the profile as "Hem", for anybody who is signed in to the organisation. | Reproduced |
| S3 | **`employments` without the URN is accepted and ignored.** A `PATCH` with the path `employments`, and a body with `employments` at the top, answer 200 and store nothing. A bare `parent` on a unit is refused for exactly this reason. The check counts no employments, so nothing shows the mistake. | Reproduced |
| S4 | **An employment may name a unit Clew does not hold**, and the profile then shows the unit's id as its name ("9540"). Nothing refuses it, nothing warns, and the guides do not mention it. | Reproduced |
| S5 | **The user list shows and searches the core `title` only; the profile shows the employments only** (the core title when there are none). The example sends a core title to people with exactly one employment, so four people of the development directory have two titles on the profile and none in the list. The check's "249 of 250 active users have a title" now counts employment titles and no longer says what the list shows. | Reproduced |
| S6 | `employments` as one object is refused where `phoneNumbers` as one object is read; its `detail` ("employments must be an array.") does not name the attribute as every other refusal does. | Reproduced |
| S7 | Identical employments are kept twice by `POST` and `PUT` and once by `PATCH` `add`. An entry has no id, so two identical ones cannot be told apart. | Reproduced |
| S8 | A phone `value` keeps the space around it and its control characters, where `type` is trimmed and a title has them replaced; `" 070-1 "` and `"070-1"` are two numbers. | Reproduced |
| S9 | No limit on the number of entries: 5,000 phone numbers, and 5,000 employments, are stored on one person and drawn on the profile. | Reproduced |
| S10 | Under `phoneNumbers[…]`, a sub-attribute Clew does not hold (`.display`, `.primary`) and a filter with `and primary eq true` answer 400 `invalidPath`; under `emails[…]` the first is ignored and the second read. | Reproduced |
| S11 | The store contract has a case for phone numbers on PostgreSQL and none for employments. | Read |
| S12 | `scripts/provisioner/push.ts` and `check.ts` now import `@clew/contracts` for one URN. The example was two files a directory team could copy; it now needs Clew's contracts package. | Read |

### The guides

| # | Finding |
|---|---|
| G1 | **Neither guide says which title is shown where** (S5), or whether a provisioner that sends employments also sends `title`. |
| G2 | **Neither guide says what an employment has to do with a placement.** The operations guide lists "Current employments" beside "The organisational unit each person is assigned to" and says of neither that the first gives no access and the second is still required. One sentence in the protocol guide says it. |
| G3 | **Nothing says that every number sent is shown to everybody in the organisation**, or what is done with a private one (S2). |
| G4 | **Neither table of "what to send when something changes" has a row for a phone number or an employment**, and the refusal table has none of S1's refusals. The same gap as G10 of the fourth review, for the title. |
| G5 | **`### Current employments` is the only third-level heading under "What Clew expects"**, so in the page's outline everything after it (how a request is read, groups, the tree, transport, authentication) stands under "Current employments". |
| G6 | The two guides write a number two ways: `tel:+46-70-100-00-02` in one, `010-100 00 01` in the other. Neither says what to send. The profile shows the value as sent, less a leading `tel:`. |
| G7 | "If a source supplies a start date for one employment, that date describes that employment alone" stands directly after the sentence that says a start date is outside the contract. What the server does: anything else in an entry is accepted and ignored. |
| G8 | The refusal table gives one `detail` for a required attribute that is "empty, only space, longer than 512 characters or not text". An empty one answers `Attribute 'displayName' is required.` |
| G9 | "Not decided yet" lists "which current employments and unit ids the directory can supply" as open on Clew's side and says the list matches the open questions. It is a question for the directory team, it is missing from "Answer these before anything is built", and `open-questions.md` has no such row. |
| G10 | The sentence about **Arbetsplats** ("can be shown … through a connector") describes something nobody has built, in the page that says what to send. |
| G11 | The first line of "What Clew expects" names `phoneNumbers` and `title` as optional and not the employment extension. "The example" at the end still describes a person with "a title after the unit they work in", and says nothing of phone numbers or employments. |
| G12 | D114 is nine lines. It does not say that it was built against the freeze on new surface (D101), as D110 does, and records none of the choices S1, S2 and S5 are about. |

## Recommended

1. **S1: an entry Clew cannot read is left out, and never refuses the person**, as a title is. The check counts people
   with a phone number and with employments, so a mapping that sends nothing readable shows there.
2. **S2: a `home` number is not held**, as a `home` address is not. This is the product owner's to decide; the guide
   says in plain words that every number sent is shown to every signed-in person, whichever way it goes.
3. **S3: `employments` without the URN is refused on a user**, with the path to use, as `parent` is on a unit.
4. **S4: the check warns for an employment that names a unit Clew does not hold**, the guide says a unit is sent before
   an employment names it, and the profile shows the title alone when the unit is unknown.
5. **S5: the guide says to send `title` beside the employments**, as the one line the list shows, and the example
   sends the first employment's title. The check says the two counts apart.
6. S6 to S12 and G1 to G12 as each row says.
7. **Land D114 before anything is sent**, so that the link the directory team opens is the page that was reviewed.
   The alternative is to send the published guides as they are, without phone numbers and employments, and add those
   when a real source has said what it can supply.

## Left as it is

- **The two migrations of D114**, where the second replaces the columns of the first. The shared development database
  has applied both; one migration would be tidier and changes nothing for an installation.
- **What the fourth review left**: connector audiences without an organisation, a taken `userName` beside a
  deactivation, the unverified C locale, no request yet from a real Entra or Okta tenant, and no reading of the guides
  by somebody from the directory team.

## Outcome

The product owner answered the findings the same day, and every one was fixed in the working tree.
[D114](../decisions/D114-person-profiles-show-employments-and-categorised-phone-numbers.md) now records the choices.

**Decided by the product owner, against the recommendation where they differ.**

- **S2: nothing is left out for what it is called.** The recommendation was to hold no `home` number. He decided the
  opposite and for e-mail too: what is sent is the directory's to answer for. A `home` number is stored and shown, and
  a person whose only address is called `home` is stored with it, where the server refused such a person before. The
  guides say in plain words that every number sent is shown to everybody in the organisation.
- **S4: an employment on a unit Clew does not hold is refused**, with a `detail` that names the unit and says how the
  id is written. The unit is asked about when a request changes the list, so a unit removed afterwards does not stop
  the person's other changes; the profile then shows the title without a unit, and the check names the employment.
- **S5: the user list shows every title.** A person's titles are those of their employments, each once, on the list,
  in its search (both adapters) and on the profile; the core `title` where no employment carries one.

**The server.**

| # | Done |
|---|---|
| S1 | A number or an employment entry with nothing readable in it is left out and the person is stored. An emptied number in a `PATCH` is taken away. A title with no `unitId` is refused, since it says something Clew cannot place. |
| S3 | `employments` without the URN answers 400 `invalidPath` with the name to use, in a body and as a path. |
| S6 | One employment by itself is read as a list of one. Every refusal names the attribute or the path. |
| S7 | Two entries that say the same are one, in a body and in a patch. |
| S8 | A number is stored less the space around it, a control character as a space; a type is cut at 64 characters. |
| S9 | At most 50 numbers and 50 employments on a person; more answers 400 and says the limit. |
| S10 | Under `phoneNumbers[…]` a sub-attribute Clew does not hold is nothing to change, and `and primary eq …` in the filter is not asked about, as under `emails[…]`. |
| S11 | The store contract has a case for employments, and for the search in their titles, on both adapters. |
| S12 | The example and the check write the URN out and import nothing of Clew's. The check counts people with a number and with an employment, and warns for an employment on a unit that is gone. |

**The guides.** The protocol guide has a section for each subject (users, phone numbers, employments, how a request is
read, deactivation, groups, the tree, transport, authentication), so its outline reads as its contents (G5). Each of
the two new sections says what is shown and to whom, what is left out, what is refused and how a change is sent (G1 to
G4, G6, G7). The operations guide asks about numbers and employments before anything is built, lists them after what
gives access, and sends them in the walkthrough, where Lena's employment moves with her (G2, G9). Both tables of
changes and the refusal table have the new rows (G4, G8). The sentence about Arbetsplats is gone (G10), the example's
description is current (G11), and D114 says what was decided and by whom (G12).

**Verified.** `bun run check` on the working tree; the store contract and the concurrency tests on PostgreSQL; the
walkthrough's blocks, run verbatim by `tests/unit/provisioner.test.ts`; `tests/a11y/users.spec.ts`. New cases in
`tests/unit/scim-as-clients-send-it.test.ts`, `scim.test.ts`, `users-admin.test.ts`, `provisioner.test.ts` and
`tests/scim-store-contract.ts`.

**Still open.** D114 is not committed, so the published guides are the ones from before it. No real directory has
sent a number or an employment. The profile has had no manual pass with a screen reader.
