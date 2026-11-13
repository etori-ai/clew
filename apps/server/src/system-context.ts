import type { AuthenticatedContext } from '@clew/contracts';
import { groupsStillMatch, readAccess, readGroups, type Reader } from '@clew/db/auth';
import { authorizationVersion } from './auth-crypto';
import { ForbiddenError } from './context';

/**
 * An identity built from the person's current grant instead of a session: the nightly scan, a connector's figure,
 * and a connector calling back into Clew. Never carries tokens, and `binding` says which path made it. `db` reads the
 * grant and the groups: the pool, or a transaction the caller holds and that may not wait for a second connection (L1);
 * `authorize` asks the pool, since it runs later.
 */
export async function systemContext(
  personId: string,
  binding = 'system:scan',
  db?: Reader,
): Promise<AuthenticatedContext | undefined> {
  const access = await readAccess(personId, db);
  if (!access) return undefined;
  const version = authorizationVersion(access),
    groups = await readGroups(personId, db);
  return {
    id: access.person.id,
    name: access.person.name,
    unitId: access.grant.unitId,
    unitLabel: access.grant.unitLabel,
    role: access.grant.role,
    ...(access.person.userName ? { userName: access.person.userName } : {}),
    organisationId: access.person.organisationId,
    principal: { id: 'person:' + personId, kind: 'person' },
    capabilities: access.grant.capabilities,
    groups,
    authorizationVersion: version,
    sessionBinding: binding,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    async authorize() {
      const current = await readAccess(personId);
      if (!current || authorizationVersion(current) !== version || !(await groupsStillMatch(personId, groups)))
        throw new ForbiddenError();
      return { version };
    },
  };
}
