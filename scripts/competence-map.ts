/**
 * Map a type of a source that answers the holdings profile to a type of the competence catalogue (D108 item 9), or
 * remove the mapping, as an administrator does on Administration › Kompetens › Källor. The rows already copied with the
 * type are re-typed in the same transaction, audited (`competence.source_mapped`, `competence.source_unmapped`) with the
 * actor `operator:cli`. The connector must be registered; it need not have been read yet, so the first read is typed.
 * Runs inside the app container with the server's local settings (DATABASE_URL); no route and no `package.json` entry.
 *
 *   bun scripts/competence-map.ts --connector <id> --type <source type id> --to "<catalogue type name>" [--organisation poc]
 *   bun scripts/competence-map.ts --connector <id> --type <source type id> --remove [--organisation poc]
 *   bun scripts/competence-map.ts --connector <id> --development [--organisation poc]
 *
 * `--development` is a convenience for the development stack only: it maps the course ids the development learning
 * platform is seeded with (`.devcontainer/moodle/seed.php`, `clew-dev:<course>`) to the catalogue that
 * `competence-seed.ts` adds, for whatever connector id that platform was registered under. Its badge is left unmapped,
 * so the page has a type to map by hand.
 */
import { resolve } from 'node:path';
import { closeDatabase } from '@clew/db';
import { competence, competenceStore } from '../apps/server/src/composition/competence';
import { OPERATOR } from './competence-seed';
import { DEVELOPMENT_MAPPINGS, DEVELOPMENT_ORGANISATION } from './competence-development';

try {
  process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
} catch {
  /* settings may come from the environment */
}
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf('--' + name);
  const value = i >= 0 ? args[i + 1] : undefined;
  return value?.startsWith('--') ? undefined : value;
};
const connectorId = option('connector');
const organisationId = option('organisation') ?? DEVELOPMENT_ORGANISATION;
const sourceType = option('type'),
  to = option('to');
const remove = args.includes('--remove'),
  development = args.includes('--development');
const usage =
  'Usage: bun scripts/competence-map.ts --connector <id> (--type <source type id> (--to "<catalogue type name>" | --remove) | --development) [--organisation <id>]';
if (!connectorId || (!development && (!sourceType || (!to && !remove)))) {
  console.error(usage);
  process.exit(2);
}
try {
  const catalogue = await competenceStore.transaction(tx => tx.types(organisationId));
  const typeNamed = (name: string) => catalogue.find(t => t.name.toLowerCase() === name.toLowerCase())?.id;
  const wanted: Array<[string, string | null, string]> = development
    ? DEVELOPMENT_MAPPINGS.flatMap(([type, name]) => {
        const id = typeNamed(name);
        if (!id) console.log(`${type}: the catalogue has no "${name}"; run competence-seed.ts first. Skipped.`);
        return id ? [[type, id, name] as [string, string, string]] : [];
      })
    : [[sourceType!, remove ? null : (typeNamed(to!) ?? ''), to ?? '']];
  for (const [type, typeId, name] of wanted) {
    if (typeId === '') {
      console.error(`The catalogue of organisation "${organisationId}" has no type named "${name}".`);
      process.exitCode = 1;
      continue;
    }
    const { holdings } = await competence.seedMapping(OPERATOR, organisationId, connectorId, {
      sourceType: type,
      typeId,
    });
    console.log(
      `${connectorId} ${type}: ${typeId ? `mapped to "${name}"` : 'mapping removed'}, ${holdings} copied holdings re-typed.`,
    );
  }
} catch (error) {
  console.error(`Could not map: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
