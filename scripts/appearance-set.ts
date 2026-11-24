/**
 * Set the installation's name, theme and logo (D98) from the command line, as an alternative to Administration › Utseende.
 * Runs inside the app container with the server's local settings (DATABASE_URL). The work is the appearance use cases'
 * `operator` side: the same checks of the name, the theme file and the images as the page meets, the same audit rows, with
 * `bootstrap:appearance` as the actor. Every browser reads the change on its next visit; nothing is restarted. The script
 * checks each part with the same functions before it saves anything and says what it refuses in English.
 *
 *   bun scripts/appearance-set.ts themes/sundsvall     the name, theme and logo an example folder names
 *   bun scripts/appearance-set.ts --reset              back to Clew in Astryx Neutral, with no logo
 *   bun scripts/appearance-set.ts --show               what is saved now
 *
 * An example folder holds `appearance.json`: `name` is the installation's name, `theme` names a theme file, `logo` an
 * `alt` and the `light` and optional `dark` image, each path relative to the folder. Any part may be left out, and then
 * that part is left as it is.
 */
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { closeDatabase } from '@clew/db';
import {
  LOGO_ALT_MAX,
  LOGO_MAX_BYTES,
  SITE_NAME_MAX,
  THEME_COLOR_TOKENS,
  THEME_NAME_MAX,
  checkSiteName,
  parseThemeFile,
  type AppearanceAdminView,
  type LogoMediaType,
  type SiteNameProblem,
  type ThemeProblem,
} from '@clew/contracts';

try {
  process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
} catch {
  /* settings may come from the environment */
}
const { appearance } = await import('../apps/server/src/composition/appearance');
const { isLogoProblem, logoImageOf } = await import('../apps/server/src/modules/appearance/domain');

interface Manifest {
  name?: string;
  theme?: string;
  logo?: { alt: string; light: string; dark?: string };
}
const usage =
  'Usage: bun scripts/appearance-set.ts <folder with appearance.json> | --reset | --show   (examples: themes/)';
const show = (view: AppearanceAdminView) =>
  console.log(
    `Name: ${view.name}. Theme: ${view.theme ? `${view.theme.name ?? 'unnamed'}, ${Object.keys(view.theme.colors).length} colours` : 'Astryx Neutral'}. ` +
      `Logo: ${view.logo ? `${view.logo.alt}${view.logo.darkSrc ? ', with a dark variant' : ''}` : 'none'}. Revision ${view.revision}.`,
  );
const mediaTypes: Record<string, LogoMediaType> = { '.png': 'image/png', '.svg': 'image/svg+xml' };
/**
 * The script speaks English (CLAUDE.md): the use cases' refusals are written in Swedish for Administration › Utseende,
 * so the script checks each part with the same functions first and says what is wrong in its own words.
 */
class Refused extends Error {}
const nameProblem: Record<SiteNameProblem, string> = {
  empty: 'it is empty',
  lines: 'it must stand on one line, without control characters',
  invisible: 'it holds an invisible character or one that turns the text direction',
  undrawable: 'it holds a private-use or unassigned character that a page cannot draw',
  marks: 'it stacks more than two combining marks on one letter',
  letters: 'it needs at least one letter or digit',
  length: `it is longer than ${SITE_NAME_MAX} characters`,
};
const tokens: readonly string[] = THEME_COLOR_TOKENS;
function themeProblem(p: ThemeProblem): string {
  const at = p.token ? `${p.mode ? `${p.mode}.color.` : ''}${p.token}: ` : '';
  if (p.code === 'contrast') return `${at}too little contrast against the colour it is read on`;
  if (p.code === 'value')
    return `${at}not a colour Clew reads (six-digit hex, a reference to another colour, or an sRGB colour without transparency)`;
  if (p.code === 'token')
    return p.token && tokens.includes(p.token)
      ? `${p.token}: set in one appearance only; set it in both light and dark`
      : `${at}not a colour a theme can set (see THEME_COLOR_TOKENS)`;
  return `not a theme file: an object with $description (at most ${THEME_NAME_MAX} characters) and the groups light.color and dark.color, setting at least one colour`;
}
async function image(path: string, variant: 'light' | 'dark') {
  const mediaType = mediaTypes[extname(path).toLowerCase()];
  if (!mediaType) throw new Refused(`${path}: a logo is a .png or .svg file.`);
  const input = { mediaType, data: (await readFile(path)).toString('base64') };
  if (isLogoProblem(logoImageOf(input, variant)))
    throw new Refused(
      `${path}: the ${variant} logo was refused: it must be a PNG, or a drawing in SVG and UTF-8 with no script, no ` +
        `foreign markup and nothing loaded from elsewhere, of at most ${Math.round(LOGO_MAX_BYTES / 1000)} kB. ` +
        'Administration › Utseende names the exact problem.',
    );
  return input;
}

const args = process.argv.slice(2);
const folder = args.find(a => !a.startsWith('--'));
let failed = false;
try {
  if (args.includes('--show')) {
    const now = await appearance.read();
    show({ ...now, updatedAt: null, updatedBy: null });
  } else if (args.includes('--reset')) {
    await appearance.operator.clearName();
    await appearance.operator.clearTheme();
    show(await appearance.operator.clearLogo());
  } else if (!folder) {
    console.error(usage);
    failed = true;
  } else {
    const root = resolve(folder);
    const manifest = JSON.parse(await readFile(resolve(root, 'appearance.json'), 'utf8')) as Manifest;
    if (manifest.name === undefined && !manifest.theme && !manifest.logo)
      throw new Refused('appearance.json names no name, theme or logo.');
    // Everything is read and checked before anything is saved, so a refused part does not leave half an appearance.
    if (manifest.name !== undefined) {
      const named = checkSiteName(manifest.name);
      if ('code' in named) throw new Refused(`The name was refused: ${nameProblem[named.code]}.`);
    }
    const file = manifest.theme ? JSON.parse(await readFile(resolve(root, manifest.theme), 'utf8')) : undefined;
    if (file !== undefined) {
      const parsed = parseThemeFile(file);
      if (!parsed.ok)
        throw new Refused(
          ['The theme file was refused:', ...parsed.problems.map(p => '- ' + themeProblem(p))].join('\n'),
        );
    }
    if (manifest.logo && !(manifest.logo.alt?.trim() && manifest.logo.alt.trim().length <= LOGO_ALT_MAX))
      throw new Refused(`The logo needs an alt text of 1 to ${LOGO_ALT_MAX} characters in appearance.json.`);
    const logo = manifest.logo && {
      alt: manifest.logo.alt,
      light: await image(resolve(root, manifest.logo.light), 'light'),
      dark: manifest.logo.dark ? await image(resolve(root, manifest.logo.dark), 'dark') : null,
    };
    let view: AppearanceAdminView | undefined;
    if (manifest.name !== undefined) view = await appearance.operator.setName(manifest.name);
    if (file !== undefined) view = await appearance.operator.setTheme(file);
    if (logo) view = await appearance.operator.setLogo(logo);
    show(view!);
  }
} catch (error) {
  failed = true;
  console.error(
    error instanceof Refused
      ? error.message
      : // Anything else was checked above, so what is left is the database's or the file system's, in English.
        error instanceof Error
        ? error.message
        : String(error),
  );
} finally {
  await closeDatabase();
}
process.exit(failed ? 1 : 0);
