/** The SCIM group keys whose meaning Clew defines (D68, D93, D96). */
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
