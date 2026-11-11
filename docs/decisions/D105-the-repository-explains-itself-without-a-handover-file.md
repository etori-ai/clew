# D105 · The repository explains itself without a handover file

**Status:** accepted (product owner, 2026-11-11) · **Date:** 2026-11-11 · **Area:** platform

**Decision.** `HANDOVER.md` is retired, and five rules keep the repository readable without it.

1. **No handover file and no session log.** What a change did and why is written in its commit message. The
   handover and its session log up to 2026-11-11 are frozen in `docs/history/` and nothing is added there.
   They are history, never instructions.
2. **Each job the handover did has one home.**

   | Job | Home |
   |---|---|
   | Which decisions bind today | `docs/decisions/in-force.md`, generated |
   | What works in this checkout | `docs/reference/status.md` and the pages under `docs/reference/status/` |
   | Licences checked before pinning | `docs/reference/licences.md` |
   | Links to the design canvases | `docs/reference/design-canvases.md` |
   | What is undecided and who it waits for | `docs/maintainers/open-questions.md` |
   | Which connector folders exist and why | `connectors/README.md` |

   `docs/maintainers/open-questions.md` is not a log: an item is removed in the change that settles it.
3. **A decision's status starts with one word**: `proposed`, `provisional`, `accepted`, `superseded` or
   `withdrawn`. Anything after it is free text. `scripts/docs.ts` draws the digest from that word and fails
   on any other. The digest lists the decisions in force by area, one line each, with the proposed and the
   retired ones apart; the full index stays, sorted by number.
4. **An exploration that leaves the code leaves a closing note.** When something was built to learn from and
   is then removed, its decision becomes `withdrawn`, the code is deleted, and a dated note in
   `docs/reviews/` says what was asked, what was built, what it showed, what was not done and the last
   commit that holds it. Current pages stop describing it; older records keep their text, and a link into
   removed files becomes a plain path.
5. **A connector folder has a row in `connectors/README.md`**, in the section that says why it is there: a
   real product, written for a real system and not yet run against it, an example, or a fixture of the
   development stack. The row is added in the change that adds the folder.

**Why.** After eight days the product owner said the project was hard to follow: 112 decision records with no
page saying which ones bind, a handover file of 525 KB whose first eight sections described the first
session, fifteen connector folders with no list, and an exploration (external MCP services,
[D81](D81-mcp-apps-extend-ai-chat-with-provider-owned-interactions.md)) that had served its purpose and was
still in the code. Asked whether a real project has a handover file, the answer was no: it exists because
sessions passed context to each other through it, and each of its jobs has an ordinary home (commits,
decision records, a status page, a licence record). A log that every session appends to also conflicts on
every parallel branch, which the notes in it record more than once. The first word of the status was already
one of the five in every record; fixing it costs nothing and makes the digest possible. The closing note is
what the product owner asked for when the MCP lane was removed: keep what was learnt, not the code.

Not chosen: moving superseded records to an archive folder (it breaks the rule that a record keeps its
filename and path, and every link to it); an issue tracker for the open questions (the right home once the
project has contributors outside the team; a short page until then).

**Replaces.** The working rule in `CLAUDE.md` that a session ends with a note in `HANDOVER.md`, and the rule
that licence checks are recorded in its section 3. It adds `superseded` and `withdrawn` to the three status
words of [D102](D102-a-decision-is-provisional-until-something-outside-the-repository-has-tested-it.md),
which otherwise stands. The first use of rule 4 is
[the closing note on external MCP services](../reviews/2026-11-11-external-mcp-chat-services-exploration.md).
