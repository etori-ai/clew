# D39 · A compact header owns profile, appearance and the reminder entry point

**Status:** accepted · **Date:** 2026-11-05 · **Area:** ui

**Problem and owner.** The product owner requests compact identity and account controls. The requested behaviour is a slimmer header, adjacent reminder/profile controls, real settings,
light/dark mode and logout. `components/shell.tsx` remains the owner on every protected surface;
`packages/ui/src/appearance.tsx` owns the display preference and applies `theme.ts` through Astryx
`Theme`. Providers compose that lifecycle once above routing and the session boundary.

**Decision.** Use Astryx `DropdownMenu` with a passive `Avatar` for profile, user name/unit in its
header, and actions for Inställningar and the existing `signOut`. Settings is a `Dialog` with an
actual `RadioList` preference, not a placeholder route. Only `clew:color-mode` (`light` or `dark`) is
persisted in localStorage. Invalid/missing values select light. Storage failures leave the choice
usable in memory and explicitly tell the person it cannot survive reload. Session/identity/work
content remains in memory. Logout failures are shown and can be retried; the existing CSRF/session
invalidation/provider redirect remains canonical.

Preserve current D34's shell-side-nav frame: no desktop TopNav, rail on desktop and Astryx's compact
header/drawer on mobile. Reduce `side-nav-heading` padding through its public theme target and remove
the identity subheading. The bell belongs in `SideNavHeading.headerEndContent`, beside the logo and
product name; the named account menu stays in `SideNav.footerIcons` (amendment below). Keep the rail's existing top/sections/footer and elevated shell.
Close the controlled mobile navigation when a link changes the route.
The logo's contain box becomes 20 × 20 with `spacing-3` (12 px) clearance. The official dragon's
rendered width is about 10.9 px, so this still exceeds its own width on every side. No new header CSS.

**Appearance and logo.** Use Astryx's documented light/dark token tuples. Sundsvall's dark surfaces
use the published black/dark grey and white/light-grey text. Accent fills swap the official strong
and pale pair, with white/black foregrounds respectively. Neutral retains Astryx's two modes; custom
uses the same two-mode accent contract over Neutral. No approximate municipal colours are generated.

Use the original white dragon from the same official archive in dark mode. `HeaderLogo.darkSrc` /
`VITE_HEADER_LOGO_DARK_SRC` optionally supplies another municipality's original dark variant alongside
its explicit source and alt text. Both sources share same-origin validation. Without a dark variant,
a custom logo retains a white clearance area in dark mode; this narrowly extends D37/D38's image-only
inline-style exception with a theme-token background. Never filter, invert, recolour or crop a logo.

**Reminders.** Start simple, as clarified by the product owner: show existing active thread reminders
and links to the start page and calendar. `activeReminders()` selects existing active threads with
`remindedAt`, excluding waiting/snoozed work, newest first, without mutating the query cache.
The shell observes the existing session-scoped `threadsQuery`; no new endpoint, polling, permission
path, notification store or duplicated lifecycle. Selection reuses canonical `groupThreads` in `stream.ts`, including scope and lifecycle filters.
The count is active reminders, not unread items.
The drawer shows loading, empty and retryable failure states, retaining cached items after a failed
refresh. Links reuse `/oversikt?kort=<id>`; the existing start-page card owner expands that card, scrolls and
focuses it after modal close. Refetches do not retake focus. An unavailable card has an explicit message.
These are private in-app links to the same scoped cards, not OS/email push notifications.

A separate notification model, read/unread rules, retention and other notification kinds remain an
**open product question**. Backend reminder scheduling, scope enforcement, calendar writes and auth
contracts deliberately do not change. No editable profile data is invented for this request.

**Dependencies.** Astryx Icon has no semantic bell. Reuse BellIcon from the Heroicons 2.2.0 (MIT)
dependency already owned by current main, exported once by the UI package; no new dependency.

**Acceptance and validation.** Navigation heading at most 56 px; organisation mark keeps proportions and
clearance; menu/dialog/drawer work by keyboard at desktop and 320 px; preference changes actual
colours and survives navigation/reload; blocked storage stays usable; reminder links focus the right
card; errors are explicit; logout ends the session. Focused Bun contracts cover branding, dark pairs,
fixture isolation and reminder selection; TypeScript covers all code. New Playwright/axe cases cover
the visible behaviours and await authorised browser execution. Run local checks through the global
supervisor and one worker, as required by the user's resource rules; full browser runs and production
builds require an explicit request. Manual screen-reader validation remains necessary.

**Review and recovery.** One shared shell and one appearance owner replace the inline identity and
standalone logout path. No data migration. Revert the feature commit and rebuild to recover; the sole
new persisted value is an ignorable display preference. Main risks are component contrast/focus and
small-screen layout, covered by the new browser scenarios but not claimed verified by static checks.

**Replaces.** Extends D31/D34's navigation composition and D37/D38's light-only logo/theme sizing. Their
configuration/profile ownership and original-asset rules remain in force.


**Amended 2026-11-05: account and reminder placement.** At the product owner's request, the bell and
its count move to `SideNavHeading.headerEndContent`, beside the logo and Startsidan. The home link
and bell are separate controls. The account stays in `SideNav.footerIcons` and its trigger shows
`SessionUser.name` as visible text beside a decorative Heroicons account glyph, with the menu chevron.
No name is parsed, shortened or copied into another owner. This also removes the initials-only
trigger's label/content mismatch recorded in session 36. Settings, appearance, reminder selection
and logout retain their existing lifecycle. The desktop/320 px shell cases protect placement, the
visible full name, keyboard activation and focus restoration; browser/axe execution remains pending.
