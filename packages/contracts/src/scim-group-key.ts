/**
 * The SCIM group keys whose meaning Clew defines (D68, D93, D96), and the capability names a `capability:` key may carry.
 * This file imports nothing, so the example provisioner and its check (`scripts/provisioner/`) take it alone, without
 * loading TypeBox at run time; the contracts index re-exports the capability names.
 */
export const UNIT_KEY = 'unit:',
  MANAGER_KEY = 'unit-manager:',
  CAPABILITY_KEY = 'capability:',
  PROTECTED_KEY = 'protected';

const prefixes = [UNIT_KEY, MANAGER_KEY, CAPABILITY_KEY] as const;

/** Also recognise a reserved key written with the wrong case or spacing so callers can refuse it. */
export function reservedScimGroupKey(key: string) {
  const normalized = key.replace(/\s+/g, '').toLowerCase();
  return normalized === PROTECTED_KEY ? PROTECTED_KEY : prefixes.find(prefix => normalized.startsWith(prefix));
}

/**
 * The grant capabilities Clew enforces (D85): a closed list. A group mapping, a `capability:` group key or the development
 * seed may name nothing else; a new name is a contract change. `admin.connectors` administers connected systems (D23),
 * `admin.users` the users page and the group-to-capability mapping (D85), `admin.appearance` the installation's theme
 * and logo (D98), `admin.competence` the catalogue of competence types (D108 item 8).
 */
export const CAPABILITIES = ['admin.connectors', 'admin.users', 'admin.appearance', 'admin.competence'] as const;
export type Capability = (typeof CAPABILITIES)[number];
export const isCapability = (value: string): value is Capability => (CAPABILITIES as readonly string[]).includes(value);
