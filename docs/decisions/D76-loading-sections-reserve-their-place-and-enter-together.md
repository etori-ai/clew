# D76 · Loading sections reserve their place and enter together

**Status:** accepted, built 2026-11-07 · **Date:** 2026-11-07 · **Area:** ui

**Decision.** A cold load or hard refresh draws the shape of pending content in its own place. Hem reserves the
work list, figures, I dag and Sedan i går. The work and its figures enter together; the side cards wait for their
day, thread and figure inputs, so late dependent reads do not insert lines into an already readable card. All four
work tabs use the same first-read treatment and do not show an empty state or a zero count before the answer.
The calendar, tool pages and administration use the same loading and entrance compositions. While authentication
is unresolved, a labelled Astryx Spinner replaces the blank screen without rendering protected content.

`apps/web/src/components/loading.tsx` composes Astryx Skeleton, Card and Stack. Loaded content uses Astryx's
`useEntryAnimation('fadeIn')`: a short, non-spatial entrance for the section as a whole, with the library's reduced
motion behavior. No custom CSS, timers, animation library or per-row stagger is introduced. Rows and side cards
reserve representative space; their final height remains content-driven, not a fixed-height clipping container.

Background refreshes retain content and its mounted controls. First-load readiness is based on query state, not
`isFetching`; Hem also checks `isFetched`, because nested mark readers can retry a failed first read on mount.
That retry must not replace the content with another skeleton and cause a mount/refetch cycle. Failed reads settle
into the existing error handling; the optional day disappears if unavailable. No minimum wait is imposed.

**Why.** The product owner reported that blocks appear asynchronously on first load and refresh, making the UI
jumpy, and requested skeletons and an entrance animation. Several sections previously rendered nothing or a single
status line before inserting a full card, table or calendar. Keeping the existing page layout and type hierarchy,
reserving those slots and revealing complete regions gives the eye one transition per region.

**Evidence.** `tests/a11y/loading.spec.ts` holds responses independently, exercises cold loads and hard refreshes
at desktop and 320 px, checks failure and reduced-motion states, and verifies that a background refresh preserves
the mounted content, focused composer and draft. Existing page and accessibility specs remain the regression checks.
Skeleton height cannot predict arbitrary connector row counts; this reduces asynchronous rearrangement rather than
promising zero layout shift for every payload. A manual screen-reader pass remains outstanding.

**Replaces.** Extends [D36](D36-an-answer-is-drawn-as-it-is-written.md)'s initial-card skeleton to the page's other
asynchronous regions. Preserves [D74](D74-one-page-header-for-every-surface.md)'s header placement and the existing
page layouts. No new visual-system exception.

Neutral's light Skeleton token is the same colour as its muted Card. The existing theme's `card` override scopes
`--color-skeleton` to `--color-border-emphasized` inside muted cards, so Sedan i går's placeholders remain visible
in both appearances. The library continues to own their opacity, motion and forced-colour behavior.
