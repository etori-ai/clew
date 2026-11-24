# Example appearances

One folder per example: a theme file, and an `appearance.json` that names it together with a logo and, where the
example has one, the installation's name. They are here so
that anyone can see Clew in a real organisation's colours without writing a theme first. The format, what a file may
set and what is refused are described in [`docs/maintainers/branding.md`](../docs/maintainers/branding.md); the
theme file's shape is published as [`docs/protocol/theme-file.schema.json`](../docs/protocol/theme-file.schema.json).

| Folder | What it is |
|---|---|
| [`clew/`](clew/) | Clew's own look: ink indigo as the accent on a cool paper ground, the status colours left to status; the logo is the ball of thread, indigo for light ground and pale for dark. Chosen on the canvas "Clew · one pattern, on Astryx" (2026-11-14). |
| [`sundsvall/`](sundsvall/) | Sundsvalls kommun's published palette (checked 2026-11-05) on the mapping of D38: Vattjom dark blue as the accent, white text on strong fills and black on pale ones, the four colour pairs on the blue, green, purple and pink roles. The palette is a group of its own and the roles refer to it. The logo is the free-standing dragon, black for light ground and white for dark, kept here with its provenance ([`sundsvall/README.md`](sundsvall/README.md)); the name is Sundsvall's, Startsidan. |
| [`startsidan-prototype/`](startsidan-prototype/) | The colours of the startsidan prototype's Version 1.0, the reference for Clew's look ([D130](../docs/decisions/D130-clews-look-and-layout-are-the-startsidan-prototypes-built-with-astryx.md)): a tinted page under white cards, the identity blue as the accent, a lighter blue for the assistant on the info and blue roles, and the darker blue of its header on the inverted background, which the header's band reads. The dark appearance is derived; the prototype draws none. The logo and the name are `sundsvall/`'s. |

## Trying one

In one step, from the command line of a running stack:

```sh
docker exec -w /workspace clew-app-1 bun scripts/appearance-set.ts themes/sundsvall
```

Every browser shows it on its next visit; nothing is restarted. `--reset` instead of the folder goes back to Clew in
Astryx Neutral with no logo, and `--show` says what is saved. The command writes the same audit rows as the page, with
`bootstrap:appearance` as the actor.

Or by hand, signed in as a person with `admin.appearance` (in the development directory: `mikael`), on
Administration › Utseende: write the name its `appearance.json` gives under Namn, upload the folder's
`theme.tokens.json` under Tema, and the two images `appearance.json` names under Logotyp.

## Adding one

A folder with an `appearance.json`:

```json
{
  "name": "Medarbetarwebben",
  "theme": "theme.tokens.json",
  "logo": { "alt": "Exempelkommunen", "light": "logo.svg", "dark": "logo-dark.svg" }
}
```

`name` is what the installation is called in tab titles, on the sign-in page and wherever Clew names itself (one line,
at most 60 characters; without one it is Clew). `theme` names a theme file and `logo` an image for light ground,
optionally one for dark ground, and the name a screen reader reads; the paths are relative to the folder. Any part may
be left out. The logo is a PNG or SVG of
at most 256 kB.

`tests/unit/theme-file.test.ts` reads the Sundsvall file the way an upload is read, and
`tests/unit/appearance-admin.test.ts` saves every folder here through the same checks as the command, so an example
that stops being valid fails the build.

## Whose they are

A theme file is colours, and the colours of an organisation's graphic profile are that organisation's to use. A logo
is its organisation's mark: the Sundsvall dragon is a registered trademark, kept with its provenance in
[`sundsvall/`](sundsvall/README.md), and `startsidan-prototype/appearance.json` points there instead of holding a second
copy. Nothing in the web app's build carries a logo or a name: a fresh installation is Clew in Astryx Neutral with no
logo until an administrator saves its own. An example here is for trying Clew, not a grant to use another
organisation's mark in an installation of one's own.
