# D102 · A decision is provisional until something outside the repository has tested it, and small adjustments are not numbered

**Status:** accepted (product owner, 2026-11-10) · **Date:** 2026-11-10 · **Area:** platform

**Decision.** Three rules for `docs/decisions/` from this record on.

1. **A status says what the decision rests on.** `proposed` is written up and not chosen. `provisional` is
   chosen and is the rule to follow, but nothing outside the repository has tested it: no product that was
   not written for Clew, no person outside the team, no measurement. `accepted` is chosen and has met such a
   test, or is a choice that needs none (a naming rule, a tool, a boundary of scope). A provisional record
   says in its status line what would make it accepted. A session follows a provisional decision as it
   follows an accepted one; the word tells the next reader how much to lean on it when a real source
   disagrees.
2. **Not every choice is a numbered record.** A numbered record is for a choice that binds later work across
   files or sessions: a boundary, a contract, a dependency, a rule. An adjustment to one screen (a spacing, a
   label, where a row sits, an animation) is recorded where the screen is described,
   `docs/reference/interface-spaces.md` or the page's row in `docs/reference/status.md`, and in the commit.
3. **The number is taken when the change lands.** Write the record with a working title; take the next
   unused number from the generated index (`docs/decisions/README.md`) on the day it is merged to `main`, and
   never reuse a number. The existing collisions stay as they are.

Records before this one keep the status they have. They are not relabelled; `docs/reference/status.md` and
the reviews remain the evidence for what each one rests on.

**Why.** The review `docs/reviews/2026-11-10-project-review-and-alternative-paths.md` counted 107 records in
eight days, eight numbers used twice, and two accepted decisions (the durable engine, the second web app)
reversed within five days. Changing course fast is right in a lab; recording each turn as accepted made the
record look firmer than it was, and every later session is bound by it through `CLAUDE.md`. Almost none of
those records had met anything the team did not write. One word in the status line carries that fact without
rewriting history. The collisions came from sessions working at the same time and each taking the next
number early.

**Replaces.** Nothing. `docs/decisions/TEMPLATE.md`, the index's introduction (`scripts/docs.ts`) and the
first paragraphs of `CLAUDE.md` carry the rules.
