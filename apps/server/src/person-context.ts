import { assignmentsOf, relationGrantsOf, type AuthenticatedContext } from '@clew/contracts';
import type { Access } from '@clew/db/auth';

/**
 * The part of an authenticated context that is the person and their authority, read from one access record: the same
 * for a request's session (`authenticate`) and for work with no session behind it (`systemContext`), so the two never
 * hand a connector different people. The caller adds how it was reached: binding, expiry and the check it repeats.
 */
export function personFields(
  access: Access,
  groups: string[],
  version: string,
): Omit<AuthenticatedContext, 'sessionBinding' | 'expiresAt' | 'authorize' | 'delegate'> {
  const relationGrants = relationGrantsOf(access.grant.relations),
    assignments = assignmentsOf(access.grant.assignments);
  return {
    id: access.person.id,
    name: access.person.name,
    unitId: access.grant.unitId,
    unitLabel: access.grant.unitLabel,
    role: access.grant.role,
    ...(access.person.userName ? { userName: access.person.userName } : {}),
    organisationId: access.person.organisationId,
    principal: { id: 'person:' + access.person.id, kind: 'person' },
    capabilities: access.grant.capabilities,
    // D121: a relation to people held by grant, from this access record; never a capability.
    ...(relationGrants.length ? { relationGrants } : {}),
    // D135: every assignment from the same record, when the person holds more than one.
    ...(assignments ? { assignments } : {}),
    groups,
    authorizationVersion: version,
  };
}
