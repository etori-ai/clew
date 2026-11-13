/**
 * The SCIM group keys Clew reserves: the three that carry meaning (D68), and `protected`, which is refused at the SCIM
 * boundary (D93), as a reserved key written wrong is (D96).
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
