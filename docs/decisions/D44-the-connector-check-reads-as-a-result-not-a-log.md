# D44 · The connector check reads as a result, not a log

**Status:** accepted, built 2026-11-05; a manual pass with a screen reader is not done · **Date:** 2026-11-05 · **Area:** ui

**Decision.** The conformance check has two readers and gives each its own result.

1. **`findings` is the log.** The English lines from `packages/connectors/src/check.ts`, answers included, stay as they
   were. `scripts/connector-check.ts` prints them for the person who builds the connector, and `healthFrom` reads them.
   They never reach the browser.
2. **`items` is what an administrator reads.** `CheckReport` carries `CheckItem`s: level, group, a Swedish label, an
   optional Swedish description, and the capability's name where there is one. One row per fact: a capability is one
   row however many calls it took, an area is one row however many roles see it, and the roles that see the same thing
   share a sentence. The groups are `connection` (Anslutning), `capabilities` (Förmågor) and `surfaces` (I Startsidan:
   the menu, cards and areas).
3. **No answer from the service is in `items`.** The log printed the first 100 characters of each answer, which put
   names from the phone book on the admin page. D23 says an administrator sees structure, never people's data. A
   figure's value stays out the same way; a row says only whether the area has one.
4. **The page** (`apps/web/src/pages/admin/check-result.tsx`, used by "Anslut system" and "Testa anslutning") shows the
   verdict in a `Banner` and the groups in a `CollapsibleGroup`, each with a dot and a count. A group with a warning or
   a failure opens by itself with its problems first; a group that passed stays shut and says so. Colour never stands
   alone. A provider's test keeps its one-line findings, which are Swedish already, and shares the dot (`LevelDot`).
5. **The check result's buttons wrap on a phone.** The connector page's four actions sit in a `Toolbar` on desktop and
   in a wrapping `HStack` at 720 px and below, because a Toolbar keeps one row and ran past the edge at 320 px.

**Why.** The check was the developer's log on a page a systemförvaltare reads: English, raw JSON schemas, truncated
answers and one flat list where the verdict had to be worked out by reading every line. That broke the rule that
Swedish is what a person reads in the product, and it showed people's data. Translating the lines at the web's edge was
considered and dropped: it would keep answers in the payload and fold nothing. A Swedish log for the CLI as well was
dropped too: script output is English by rule, and the builder of a connector needs the answers. Writing both results
beside each other in `check.ts` means each probe says in one place what it found, for both readers.

**Replaces.** Narrows D23's "report the same findings": the CLI and the admin page run the same checks and reach the
same verdict, but no longer share the same lines.
