# D39 · A compact header owns profile, appearance and the reminder entry point

**Status:** accepted · **Date:** 2026-11-05 · **Area:** ui

**Problem and owner.** The product owner requests compact identity and account controls. The requested behaviour is a slimmer header, adjacent reminder/profile controls, real settings,
light/dark mode and logout. `components/shell.tsx` remains the owner on every protected surface;
`packages/ui/src/appearance.tsx` owns the display preference and applies `theme.ts` through Astryx
`Theme`. Providers compose that lifecycle once above routing and the session boundary.

**Decision.** Profile opens Inställningar and the existing `signOut`; the shape is the rail row in the
amendment at the end, which replaced the first `DropdownMenu` with a passive `Avatar`. Settings is a `Dialog` with an
actual `RadioList` preference, not a placeholder route. Only `clew:color-mode` (`light` or `dark`) is
persisted in localStorage. Invalid/missing values select light. Storage failures leave the choice
usable in memory and explicitly tell the person it cannot survive reload. Session/identity/work
content remains in memory. Logout failures are shown and can be retried; the existing CSRF/session
invalidation/provider redirect remains canonical.

Preserve current D34's shell-side-nav frame: no desktop TopNav, rail on desktop and Astryx's compact
header/drawer on mobile. Reduce `side-nav-heading` padding through its public theme target and remove
the identity subheading. The bell belongs in `SideNavHeading.headerEndContent`, beside the logo and
product name; the account is the rail's last row (amendments below). Keep the rail's existing top/sections/footer and elevated shell.
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
and bell are separate controls. The account stays in the navigation footer and its trigger shows
`SessionUser.name` as visible text beside a decorative Heroicons account glyph, with the menu chevron.
No name is parsed, shortened or copied into another owner. This also removes the initials-only
trigger's label/content mismatch recorded in session 36. Settings, appearance, reminder selection
and logout retain their existing lifecycle. The desktop/320 px shell cases protect placement, the
visible full name, keyboard activation and focus restoration; browser/axe execution remains pending.

**Amended 2026-11-05: align the account row.** The screenshot showed a centred account control under
left-aligned navigation rows. Keep the existing DropdownMenu and its complete trigger semantics.
Remove the button's full width and keep it in footerIcons inside an HStack with start justification,
so its icon and label start with the other rows. No custom CSS or
global button override. The standard SideNavItem is not used as DropdownMenu.renderTrigger because
its public contract does not preserve the dropdown's expanded/controls attributes and its mouse
event type differs; the supported Button trigger keeps keyboard, pointer, naming and focus behaviour.
The desktop/320 px shell case compares the account's icon and label positions with Kalender.

**Replaced later the same day:** the row below takes the account out of `footerIcons`.

**Amended 2026-11-05: the account is a row in the rail.** The product owner found the account out of
place under the rail's rows: a `Button` with its own type and indent, a wider gap above it and the chevron
beside the name. It is now a collapsible `SideNavItem`, the last row of the `footer` section and built like
Områden: the Heroicons account glyph, `SessionUser.name`, the chevron at the row's end. Inställningar and
Logga ut are nested rows. This disclosure replaces the `DropdownMenu`, so the unit no longer shows in a menu
header; the Inställningar dialog already shows name and unit.

`DropdownMenu.renderTrigger` can hang a menu off a row, but `SideNavItem` closes the phone drawer on every
click, and the menu it opened would close with it. A row that expands has no such problem.

The placement also settles the phone. Astryx's SideNav draws `footerIcons` in the mobile top bar as well as
in the drawer, and there the full name took the room from Startsidan and clipped both at 320 px. `footer` is
drawn in the drawer alone, so the account stays out of the top bar with no code of ours; the bell stays in it.

Because a drawer row asks to close the drawer, `Shell` turns that request down for Inställningar
(`keepNavigation`, through the controlled `mobileNav.onOpenChange`). The dialog opens over the drawer, so
Escape has a row to return focus to (2.4.3); with the drawer gone, focus fell to the body. Logga ut closes the
drawer like any other row.

A name is one line, like every rail row. CSS ends a name too long for the row with an ellipsis; nothing is
parsed or changed, and the full name stays in the row's accessible name and in Inställningar.

Områden (Heroicons `Squares2X2Icon`) and Fler verktyg (Astryx `moreHorizontal`) took an icon at the same request, so
every top-level row at the rail's foot starts its label in the same place.

The shell case `the account is a rail row like the others` asserts the same start, width, height and type as
Kalender, the icon and label lined up with it, the chevron where Områden has it and the gap between the rows,
then the keyboard path with axe, reflow and focus return at desktop and 320 px. Manual screen-reader
validation remains necessary.

**Amended 2026-11-05: the logo's box holds.** The `width` and `height` attributes alone lost to a stylesheet's height
reset, so the dragon rendered 20 × 36.7 and the heading 68.7 px. The inline `width` and `height` on the image, inside
D37's exception, give the 20 × 20 contain box, the 52 px heading and the clearance this decision asks for.

**Amended 2026-11-05 by D48.** Utseende has three choices, and the first is the default: Samma som datorn (Astryx's `system`), Ljust and Mörkt. Until a person chooses, the page follows the computer.

**Amended 2026-11-05: the reminders hang from the bell.** The product owner found a full-height drawer too heavy for
a short list. A `Drawer` is for inspectors and detail views; this is a glance. The list is now an Astryx `Popover`
anchored under the bell, with `presentation="adaptive"`, so a touch phone gets Astryx's `BottomSheet` with the same content
and no code of ours. `components/reminders.tsx` owns the bell, its state and its query; `Shell` only places it in
`headerEndContent` and keeps the toast for what arrives. Selection (`activeReminders()`), the session-scoped `threadsQuery`,
the links to `/overview?card=<id>` and the loading and failure states keep their rules above.

A row reads as a card's own line does: the title, then `trigger.source · <Timestamp>`. The source and time replace the
"Visa kortet på startsidan" that stood on every row, and `trigger.at` is the moment the reminder fired. `trigger.reason`
stays on the card: it opens with the same "Du bad …" on every reminder. `relative` and not `relative_short`, whose Swedish
pattern reads "−12 min".

The count moves inside the button, as plain figures like the rail's counts, so the whole control is the target and no
number stands beside it unpressable. The name is `Påminnelser: <n>`; axe's label-in-name rule did not accept the figure
inside `Påminnelser (<n>)`, because the brackets stop it being a word of its own. No overlay badge: that would need CSS
of ours, and Astryx's `Badge` advises against counts.

Genvägar (Startsidan and Kalender) goes. The rail already has both and it turned a list into a menu; one link, Öppna
översikten, stays under the list and also leads on from the empty `EmptyState`. This replaces the "links to the start page
and calendar" above. A popover's close and `?card=` still agree: the card keeps focus after the close, and a sheet is a
`dialog`, which the start page already waits for.

Read/unread and other notification kinds stay the open product question above. Since D49 the list also holds what comes
back from Inte nu, so the empty state speaks of a chosen time and not of asking for a reminder. The shell cases cover the
anchored surface and its position, the sheet on a touch phone, the empty state, a failed read and the path to the card,
with axe and reflow at 320 px. Manual screen-reader validation remains necessary.
