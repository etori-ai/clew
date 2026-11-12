import type { CompetenceTypeBody } from '@clew/contracts';

/**
 * The development stack's competence data (D108), synthetic and in one place: the catalogue `competence-seed.ts` adds,
 * the requirements and the share target it sets on the synthetic directory's positions (item 6), and how the
 * development learning platform's courses map to it (`competence-map.ts --development`). Data only, so the
 * seed, the map script and the unit tests read the same lists. Nothing here is a real person's qualification.
 */
export const DEVELOPMENT_ORGANISATION = 'poc';
/**
 * The development catalogue. The last three have no seeded holdings: they are what the development learning platform's
 * courses and badge can be mapped to once it is read (D108 item 9), beside HLR, Brandskydd and Delegering läkemedel.
 */
export const DEVELOPMENT_CATALOGUE: CompetenceTypeBody[] = [
  { name: 'HLR', area: 'Akut omhändertagande', kind: 'course', validityMonths: 24 },
  { name: 'Brandskydd', area: 'Säkerhet', kind: 'course', validityMonths: 36 },
  { name: 'Heta arbeten', area: 'Säkerhet', kind: 'certificate' },
  { name: 'Fallskydd', area: 'Säkerhet', kind: 'certificate' },
  { name: 'Arbete på väg', area: 'Säkerhet', kind: 'certificate' },
  { name: 'Yrkeskompetensbevis (YKB)', area: 'Fordon', kind: 'certificate' },
  { name: 'Delegering läkemedel', area: 'Vård', kind: 'authorisation', validityMonths: 12 },
  { name: 'Socionomexamen', area: 'Examen', kind: 'degree' },
  { name: 'Informationssäkerhet', area: 'Information', kind: 'course', validityMonths: 24 },
  { name: 'Livsmedelshygien', area: 'Kök', kind: 'course' },
  { name: 'HLR-instruktör', area: 'Akut omhändertagande', kind: 'authorisation' },
];
/**
 * The development learning platform's courses (by the `idnumber` its seed gives them, `.devcontainer/moodle/seed.php`)
 * and the catalogue's names for them. Its badge is left out, so the sources page has a type to map by hand.
 */
export const DEVELOPMENT_MAPPINGS: ReadonlyArray<readonly [string, string]> = [
  ['clew-dev:hlr', 'HLR'],
  ['clew-dev:brandskydd', 'Brandskydd'],
  ['clew-dev:lakemedel', 'Delegering läkemedel'],
  ['clew-dev:informationssakerhet', 'Informationssäkerhet'],
  ['clew-dev:livsmedelshygien', 'Livsmedelshygien'],
];
/**
 * What the development catalogue requires of the synthetic directory's positions (D108 item 6), by the position's code
 * (`scripts/provisioner/directory.ts`) and the type's name: enough for a manager's reports to lack something and for a
 * unit's coverage to have something to count.
 */
export const DEVELOPMENT_REQUIREMENTS: ReadonlyArray<{ position: string; type: string }> = [
  { position: 'underskoterska', type: 'HLR' },
  { position: 'underskoterska', type: 'Brandskydd' },
  { position: 'sjukskoterska', type: 'HLR' },
  { position: 'sjukskoterska', type: 'Delegering läkemedel' },
  { position: 'maskinforare', type: 'Arbete på väg' },
  { position: 'maskinforare', type: 'Fallskydd' },
  { position: 'enhetschef', type: 'Informationssäkerhet' },
];
/** A share target across the whole organisation: at least half of the undersköterskor hold a delegation. */
export const DEVELOPMENT_SHARE_TARGETS: ReadonlyArray<{ position: string; type: string; minShare: number }> = [
  { position: 'underskoterska', type: 'Delegering läkemedel', minShare: 50 },
];
