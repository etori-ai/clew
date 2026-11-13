/**
 * The SCIM group keys Clew reserves: the three that carry meaning (D68), and `protected`, which is refused at the SCIM
 * boundary (D93), as a reserved key written wrong is (D96); how a key is read, the one way the boundary, the derivation
 * and the example's check take it; and the capability names a `capability:` key may carry. This file imports nothing,
 * so the example provisioner and its check (`scripts/provisioner/`) take it alone, without loading TypeBox at run time;
 * the contracts index re-exports the capability names.
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

/** A key with meaning, read: its prefix, and the unit id or the capability name after it. */
export interface ScimGroupKey {
  prefix: (typeof prefixes)[number];
  value: string;
}
/**
 * A key as the SCIM boundary accepts it (D96): one of the three prefixes exactly, in lower case, and directly after it
 * a unit id or a capability name that is not empty and has no space at either end. Clew reads a key this way wherever
 * it reads one, so any other key means nothing: a plain group, `protected` (D93), and a reserved word written wrong,
 * which a group stored before D96 may still carry and which therefore gives nobody anything. Whether a capability name
 * is one of the closed list is asked apart (`isCapability`): the boundary refuses one that is not, the derivation gives
 * none, and the example's check names one its copy of the list does not know.
 */
export function readScimGroupKey(key: string | null | undefined): ScimGroupKey | undefined {
  if (!key) return undefined;
  const prefix = prefixes.find(p => key.startsWith(p));
  if (!prefix) return undefined;
  const value = key.slice(prefix.length);
  return value && value === value.trim() ? { prefix, value } : undefined;
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
