# D61 · Text files are checked out with LF on every platform

**Status:** accepted · **Date:** 2026-11-06 · **Area:** platform

**Decision.** `.gitattributes` at the repository root sets `* text=auto eol=lf`. Every text file is checked out with LF
line endings whatever a contributor's `core.autocrlf` says, and Git's own detection leaves binary files (the branding
images) untouched. A file that must have CRLF, such as a future `.ps1` or `.bat` script, gets its own line below the
rule (`*.ps1 text eol=crlf`). A clone made before this file existed keeps its old line endings until it is checked out
again once (`git rm --cached -r -q . && git reset --hard`, on a clean tree) or cloned anew; the Windows section of
`docs/maintainers/local-development.md` says so.

**Why.** Git for Windows installs with `core.autocrlf=true` for the whole machine, so a fresh clone on Windows had CRLF
in every file. The shell scripts run in Linux containers and break on it: the calendar image copies
`.devcontainer/calendar/refresh-calendar-apps.sh` into Nextcloud's start hooks, and `set -eu` followed by a carriage
return stops it. Found while setting the stack up on Windows 11 on 2026-11-06. A per-clone setting
(`core.autocrlf=false`, `core.eol=lf`) fixed one checkout and was weighed as the documented step, but every new
contributor on Windows would meet the failure first. The index already held every text file with LF (562 files, two
binary images, seven files without a line ending), so the rule changes no content; checked by checking files out with
`core.autocrlf=true` before and after the file was added. The same day, switching that checkout to a branch without
the file rewrote all 341 files the switch touched with CRLF, and `bun run format:check` (D57) failed on 321 of them.

**Replaces.** Nothing; the line endings were left to each contributor's Git configuration.
