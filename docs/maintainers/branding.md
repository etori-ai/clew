# Installation branding

For the administrator of an installation. Connector authors declare semantic views and do not control the theme.

## Theme and logo

An installation's colours and its header logo are saved in Clew, on **Administration › Utseende**, by a person with
the grant capability `admin.appearance` ([D97](../decisions/D97-the-installations-theme-and-logo-are-saved-in-clew-by-an-administrator.md)).
A save applies at once, to every page and every person, the sign-in page included. Nothing is configured in the
build or the environment, and nothing needs a restart. An installation nobody has configured is Astryx Neutral
with no logo ([D46](../decisions/D46-astryx-neutral-is-the-default-theme.md)).

Give the capability the way every capability is given ([D85](../decisions/D85-capabilities-are-mapped-from-provisioned-groups-in-clew.md)):
a provisioned group with the external id `capability:admin.appearance`, or a mapping from one of the catalogue's own
groups on Administration › Användare.

### The theme file

A theme is one file in the [Design Tokens format](https://www.designtokens.org/tr/2025.10/format/)
(`.tokens.json`). Clew reads two groups, `light.color` and `dark.color`. A token's name is one of Astryx's semantic
colour tokens without the `--color-` prefix, and a token set in one appearance is set in the other too. Any other
group is the file's own and may be referenced:

```json
{
  "$description": "Exempelkommunen",
  "palette": {
    "$type": "color",
    "blue": { "$value": "#005595" },
    "pale-blue": { "$value": "#daeff1" }
  },
  "light": {
    "color": {
      "$type": "color",
      "accent": { "$value": "{palette.blue}" },
      "on-accent": { "$value": "#ffffff" }
    }
  },
  "dark": {
    "color": {
      "$type": "color",
      "accent": { "$value": "{palette.pale-blue}" },
      "on-accent": { "$value": "#000000" }
    }
  }
}
```

- `$description` at the top is the theme's name, shown on the page and written to the audit row.
- A value is six-digit hex, a reference to another colour token in the file, or a DTCG colour object in `srgb`
  without transparency. A token needs `$type: "color"`, its own or its group's.
- The colours a file may set are the closed list `THEME_COLOR_TOKENS` in
  [`packages/contracts/src/theme-file.ts`](../../packages/contracts/src/theme-file.ts), published with the file's
  shape as [`docs/protocol/theme-file.schema.json`](../protocol/theme-file.schema.json). Typography, sizes, motion and
  the colours that carry a warning or an error are Clew's own and are not in it.
- The file is at most 64 kB.

**Hämta mall för temafil** on the page downloads a valid file to start from: Clew's own base colours for the roles
the contrast check reads. Once a theme is saved the same button downloads that theme.
[`themes/sundsvall/theme.tokens.json`](../../themes/sundsvall/theme.tokens.json) is a complete example with a palette.

### What is refused

A file is refused whole, with every problem listed, when it names a colour that cannot be set, sets a colour in one
appearance only, holds a value that is not an opaque sRGB colour, or would make a theme whose text cannot be read.
The contrast check is WCAG 2.2 AA on the pairs in `THEME_CONTRAST_PAIRS`: 4.5:1 for text on the surfaces and on the
accent, info and success fills, 3:1 for the accent, the focus ring, icons and a progress bar's fill on its track (`text-primary` on `track`), in both
appearances. A colour the
file leaves alone is checked as Clew's base theme draws it. The page checks before it lets you save and shows the
theme in both appearances; the server checks again. The check covers the listed pairs, not every component state:
look at the pages, in both appearances, after a new theme is saved.

### Two colours instead of a file

**Två färger** takes a strong colour and a pale one and makes the same kind of theme: the strong colour is the
accent on light ground and the pale one on dark, with black and white text. The result goes through the same check
and can be downloaded as a file afterwards.

### The logo

A PNG or an SVG of at most 256 kB, with the name a screen reader reads in its place, and optionally a variant for
dark ground. Use the original file from the organisation's graphic profile. Without a dark variant the logo stands
on a light plate in the dark appearance and on the header's band. An SVG that carries script, event attributes,
embedded foreign content or a reference out of the file is refused. Clew serves the logo from its own origin.

The header shows the logo of the header connector when an administrator has chosen one that gives a logo
([D88](../decisions/D88-the-web-app-draws-the-shared-header-and-an-administrator-owns-its-content.md)); the installation's own logo is
shown otherwise, and always on the sign-in page.

The logo keeps its proportions at the header row's height
([D37](../decisions/D37-header-logo-is-installation-branding.md), [D39](../decisions/D39-compact-header-profile-and-reminders.md)).
The account row › Inställningar offers light and dark mode, saved as a local display preference.

### From the command line

Where the database is reachable (inside the app container), the same changes without a browser:

```sh
bun scripts/appearance-set.ts themes/sundsvall   # the theme and logo an example folder names
bun scripts/appearance-set.ts --reset            # Astryx Neutral, no logo
bun scripts/appearance-set.ts --show             # what is saved now
```

A folder holds an `appearance.json` that names a theme file and a logo ([`themes/README.md`](../../themes/README.md)).
The file and the images meet the same checks as an upload, a refused theme file is listed with its problems, and each
change writes its audit row with `bootstrap:appearance` as the actor. This is how a new installation can be given
its appearance before anyone has signed in, and how a developer tries the Sundsvall example in one step.

### Over HTTP

`GET /api/appearance` is public and answers the saved theme and the logo's address. The changes are
`PUT /api/admin/appearance/theme` with `{ "file": <the theme file> }`, `DELETE /api/admin/appearance/theme`,
`PUT /api/admin/appearance/logo` with `{ "alt", "light": { "mediaType", "data" }, "dark" }` (images in base64) and
`DELETE /api/admin/appearance/logo`, each as a signed-in administrator. Every change writes an audit row
(`appearance.theme.set`, `appearance.theme.cleared`, `appearance.logo.set`, `appearance.logo.cleared`).

## Where it lives

| What | Where |
|---|---|
| The file format, the token list, the contrast pairs, the schema | `packages/contracts/src/theme-file.ts` |
| Storage, permission, audit, the logo's rules | `apps/server/src/modules/appearance/` |
| The public and the administration routes | `apps/server/src/routes/appearance.ts`, `routes/admin.ts` |
| From saved colours to an Astryx theme, and the header's band | `packages/ui/src/theme.ts`, `branding.ts` |
| Reading the appearance in the browser | `apps/web/src/branding.ts` |
| The page | `apps/web/src/pages/admin/appearance.tsx` |
| The command line | `scripts/appearance-set.ts` |
| Example appearances | `themes/` |

## Tests

`tests/unit/theme-file.test.ts` holds the format, the contrast rules, the base table against Astryx and the
Sundsvall example; `tests/unit/appearance-admin.test.ts` the use cases and their audit rows;
`tests/appearance-store-contract.ts` runs on the memory adapter and on Postgres (`bun run test:db`);
`tests/a11y/admin-appearance.spec.ts` the page. The browser suite's theme and logo are answers of its mocked API, so
one build serves every profile. To run the header and theme checks on another saved appearance:

```sh
CLEW_A11Y_BRAND_PROFILE=custom sh scripts/a11y.sh branding.spec.ts
```

The fixture names are `sundsvall` (the example theme file and the dragon), `neutral` and `custom`
(`tests/a11y/branding-fixtures.ts`). Reports are kept in `playwright-report/<profile>` and artifacts in
`test-results/<profile>`.

Against a running development stack, `scripts/appearance-check.ts` signs in through Keycloak as the synthetic
administrator and as an employee and runs the routes end to end on real sessions: the public read, the refusals (no
session, no CSRF token, no `admin.appearance`), a theme file and a logo saved, read back and refused, and the audit
rows. It puts the earlier appearance back when it ends:

```sh
docker exec -e BFF_URL=http://127.0.0.1:3000 -w /workspace clew-app-1 bun scripts/appearance-check.ts
```

The shared navigation places the reminder bell beside the logo and product name. The account is the
rail's last row, with an account icon and the person's full session name. Reminders reuse active thread
reminders and link to their cards; start/calendar shortcuts are always available. Read/unread rules
and additional notification kinds remain open. The account row expands to Inställningar, which shows
identity/unit and controls appearance, and Logga ut, which uses the existing session flow. Administration expands in the same rail; see [the navigation decision](../decisions/D45-administration-keeps-the-rail.md).
