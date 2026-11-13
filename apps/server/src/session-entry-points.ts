import { CAPABILITIES, relationGrantsOf, type AuthenticatedContext, type Capability } from '@clew/contracts';

/**
 * What `GET /api/auth/session` tells the browser to draw, never what the person may do (D23, D85): `admin` and
 * `capabilities` decide which rows under Administration the rail draws, and `relations` (D121) whether the Kompetens
 * place offers its search. A relation to people is no capability (D118), so it never turns `admin` on. Every admin call
 * and every read is checked again on the server.
 */
export function sessionEntryPoints(context: Pick<AuthenticatedContext, 'capabilities' | 'relationGrants'>): {
  admin: boolean;
  capabilities: Capability[];
  relations: ReturnType<typeof relationGrantsOf>;
} {
  const held = CAPABILITIES.filter(c => context.capabilities.includes(c));
  return { admin: held.length > 0, capabilities: held, relations: relationGrantsOf(context.relationGrants) };
}
