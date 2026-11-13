/** Explicit development opt-in: fixture tools must never activate against a normal installation. */
export const FIXTURE_IDS = ['hr', 'finance', 'incidents', 'communication', 'timesheet', 'payroll', 'servicedesk'];
export function requireFixtureDevelopment(env: Record<string, string | undefined> = process.env) {
  if (env.CLEW_POC !== 'true' || env.NODE_ENV === 'production')
    throw new Error('Fixture tools require CLEW_POC=true and must not run in production.');
}
