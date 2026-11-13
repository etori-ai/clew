/**
 * Load an organisation's follow-up dialogue (D118 item 3): its areas, their dimensions and their questions, from a JSON
 * file that `DialogueConfigSchema` describes. It replaces the organisation's configuration whole; assessments and
 * activities stay. Runs inside the app container with the server's local settings (DATABASE_URL); no route and no
 * `package.json` entry, as for the other operator scripts. Audited as `dialogue.config_replaced` with the actor
 * `operator:cli`, counts only.
 *
 *   bun scripts/dialogue-areas.ts <file> [--organisation poc]
 *   bun scripts/dialogue-areas.ts <file> --if-none     load only when the organisation has no areas (the development seed)
 *
 * `scripts/dialogue-areas.example.json` holds made-up questions for the development stack; an organisation's own file
 * belongs outside the repository.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Ajv from 'ajv';
import { closeDatabase } from '@clew/db';
import { DialogueConfigSchema, type DialogueConfig } from '@clew/contracts';
import { dialogue } from '../apps/server/src/composition/dialogue';
import { DEVELOPMENT_ORGANISATION, OPERATOR } from './talk-round';

/** The development stack's areas, loaded by `dev-connectors.ts` when the organisation has none. */
export const EXAMPLE_AREAS = resolve(import.meta.dir, 'dialogue-areas.example.json');
const validate = new Ajv({ allErrors: true, strict: false }).compile<DialogueConfig>(DialogueConfigSchema);

/** Read and check a configuration file; the first problem is thrown, with where it is. */
export async function readDialogueConfig(file: string): Promise<DialogueConfig> {
  const value: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!validate(value)) {
    const first = validate.errors?.[0];
    throw new Error(`${file} is not a dialogue configuration: ${first?.instancePath || '/'} ${first?.message ?? ''}`);
  }
  return value;
}
/** Load the file. With `ifNone`, an organisation that already has areas keeps them and nothing is written. */
export async function loadDialogueAreas(file: string, organisationId: string, options: { ifNone?: boolean } = {}) {
  const config = await readDialogueConfig(file);
  if (options.ifNone && (await dialogue.hasAreas(organisationId))) return { kept: true as const };
  return { kept: false as const, ...(await dialogue.replaceConfig(OPERATOR, organisationId, config)) };
}

if (import.meta.main) {
  try {
    process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
  } catch {
    /* settings may come from the environment */
  }
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const i = args.indexOf('--' + name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--organisation'));
  const organisationId = option('organisation') ?? DEVELOPMENT_ORGANISATION;
  if (!file) {
    console.error('Usage: bun scripts/dialogue-areas.ts <file> [--organisation <id>] [--if-none]');
    process.exit(2);
  }
  try {
    const result = await loadDialogueAreas(file, organisationId, { ifNone: args.includes('--if-none') });
    console.log(
      result.kept
        ? `Organisation "${organisationId}" already has dialogue areas; kept them.`
        : `Loaded ${result.areas} areas and ${result.questions} questions for organisation "${organisationId}".`,
    );
  } catch (error) {
    console.error(`Could not load the dialogue areas: ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}
