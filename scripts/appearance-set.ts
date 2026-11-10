/**
 * Set the installation's theme and logo (D97) from the command line, as an alternative to Administration › Utseende.
 * Runs inside the app container with the server's local settings (DATABASE_URL). The work is the appearance use cases'
 * `operator` side: the same checks of the theme file and the images as an upload meets, the same audit rows, with
 * `bootstrap:appearance` as the actor. Every browser reads the change on its next visit; nothing is restarted.
 *
 *   bun scripts/appearance-set.ts themes/sundsvall     the theme and logo an example folder names
 *   bun scripts/appearance-set.ts --reset              back to Astryx Neutral, with no logo
 *   bun scripts/appearance-set.ts --show               what is saved now
 *
 * An example folder holds `appearance.json`: `theme` names a theme file, `logo` an `alt` and the `light` and optional
 * `dark` image, each path relative to the folder. Either part may be left out, and then that part is left as it is.
 */
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { closeDatabase } from '@clew/db';
import type { AppearanceAdminView, LogoMediaType } from '@clew/contracts';

try {
  process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
} catch {
  /* settings may come from the environment */
}
const { appearance } = await import('../apps/server/src/composition/appearance');
const { ThemeFileError } = await import('../apps/server/src/modules/appearance/usecases');

interface Manifest {
  theme?: string;
  logo?: { alt: string; light: string; dark?: string };
}
const usage =
  'Usage: bun scripts/appearance-set.ts <folder with appearance.json> | --reset | --show   (examples: themes/)';
const show = (view: AppearanceAdminView) =>
  console.log(
    `Theme: ${view.theme ? `${view.theme.name ?? 'unnamed'}, ${Object.keys(view.theme.colors).length} colours` : 'Astryx Neutral'}. ` +
      `Logo: ${view.logo ? `${view.logo.alt}${view.logo.darkSrc ? ', with a dark variant' : ''}` : 'none'}. Revision ${view.revision}.`,
  );
const mediaTypes: Record<string, LogoMediaType> = { '.png': 'image/png', '.svg': 'image/svg+xml' };
async function image(path: string) {
  const mediaType = mediaTypes[extname(path).toLowerCase()];
  if (!mediaType) throw new Error(`${path}: a logo is a .png or .svg file.`);
  return { mediaType, data: (await readFile(path)).toString('base64') };
}

const args = process.argv.slice(2);
const folder = args.find(a => !a.startsWith('--'));
let failed = false;
try {
  if (args.includes('--show')) {
    const now = await appearance.read();
    show({ ...now, updatedAt: null, updatedBy: null });
  } else if (args.includes('--reset')) {
    await appearance.operator.clearTheme();
    show(await appearance.operator.clearLogo());
  } else if (!folder) {
    console.error(usage);
    failed = true;
  } else {
    const root = resolve(folder);
    const manifest = JSON.parse(await readFile(resolve(root, 'appearance.json'), 'utf8')) as Manifest;
    if (!manifest.theme && !manifest.logo) throw new Error('appearance.json names neither a theme nor a logo.');
    // Everything is read before anything is saved, so a missing image does not leave half an appearance behind.
    const file = manifest.theme ? JSON.parse(await readFile(resolve(root, manifest.theme), 'utf8')) : undefined;
    const logo = manifest.logo && {
      alt: manifest.logo.alt,
      light: await image(resolve(root, manifest.logo.light)),
      dark: manifest.logo.dark ? await image(resolve(root, manifest.logo.dark)) : null,
    };
    let view: AppearanceAdminView | undefined;
    if (file !== undefined) view = await appearance.operator.setTheme(file);
    if (logo) view = await appearance.operator.setLogo(logo);
    show(view!);
  }
} catch (error) {
  failed = true;
  if (error instanceof ThemeFileError) {
    // The problems are written for the administration page, so they are in Swedish.
    console.error('The theme file was refused:');
    for (const problem of error.problems) console.error('- ' + problem.message);
  } else console.error(error instanceof Error ? error.message : String(error));
} finally {
  await closeDatabase();
}
process.exit(failed ? 1 : 0);
