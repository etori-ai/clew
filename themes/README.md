# Example appearances

One folder per example: a theme file, and an `appearance.json` that names it together with a logo. They are here so
that anyone can see Clew in a real organisation's colours without writing a theme first. The format, what a file may
set and what is refused are described in [`docs/maintainers/branding.md`](../docs/maintainers/branding.md); the
theme file's shape is published as [`docs/protocol/theme-file.schema.json`](../docs/protocol/theme-file.schema.json).

| Folder | What it is |
|---|---|
| [`sundsvall/`](sundsvall/) | Sundsvalls kommun's published palette (checked 2026-11-05) on the mapping of D38: Vattjom dark blue as the accent, white text on strong fills and black on pale ones, the four colour pairs on the blue, green, purple and pink roles. The palette is a group of its own and the roles refer to it. The logo is the free-standing dragon, black for light ground and white for dark. |
| [`startsidan-prototype/`](startsidan-prototype/) | The colours of the startsidan prototype's Version 1.0, the reference for Clew's look ([D115](../docs/decisions/D115-the-startsidan-prototypes-version-1-0-is-the-reference-for-clews-look-and-layout.md)): a tinted page under white cards, the identity blue as the accent, a lighter blue for the assistant on the info and blue roles, and the darker blue of its header on the inverted background, which the header's band reads. The dark appearance is derived; the prototype draws none. The logo is `sundsvall/`'s. |

## Trying one

In one step, from the command line of a running stack:

```sh
docker exec -w /workspace clew-app-1 bun scripts/appearance-set.ts themes/sundsvall
```

Every browser shows it on its next visit; nothing is restarted. `--reset` instead of the folder goes back to Astryx
Neutral with no logo, and `--show` says what is saved. The command writes the same audit rows as the page, with
`bootstrap:appearance` as the actor.

Or by hand, signed in as a person with `admin.appearance` (in the development directory: `mikael`), on
Administration › Utseende: upload the folder's `theme.tokens.json` under Tema, and the two images its
`appearance.json` names under Logotyp.

## Adding one

A folder with an `appearance.json`:

```json
{
  "theme": "theme.tokens.json",
  "logo": { "alt": "Exempelkommunen", "light": "logo.svg", "dark": "logo-dark.svg" }
}
```

`theme` names a theme file and `logo` an image for light ground, optionally one for dark ground, and the name a
screen reader reads; the paths are relative to the folder. Either part may be left out. The logo is a PNG or SVG of
at most 256 kB.

`tests/unit/theme-file.test.ts` reads the Sundsvall file the way an upload is read, and
`tests/unit/appearance-admin.test.ts` saves every folder here through the same checks as the command, so an example
that stops being valid fails the build.

## Whose they are

A theme file is colours, and the colours of an organisation's graphic profile are that organisation's to use. A logo
is its organisation's mark: the Sundsvall dragon is a registered trademark, kept with its provenance in
[`apps/web/public/branding/`](../apps/web/public/branding/README.md) for the development stack, which is why
`sundsvall/appearance.json` points there instead of holding a second copy. An example here is for trying Clew, not a
grant to use another organisation's mark in an installation of one's own.
