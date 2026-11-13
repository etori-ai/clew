import { relationGrantsOf, type AuthenticatedContext } from '@clew/contracts';
import { readAccess, readGroups } from '@clew/db/auth';
import { authorizationVersion } from './auth-crypto';

/**
 * An identity built from the person's current grant instead of a session: the nightly scan, a connector's figure,
 * and a connector calling back into Clew. Never carries tokens, and `binding` says which path made it.
 */
export async function systemContext(
  personId: string,
  binding = 'system:scan',
): Promise<AuthenticatedContext | undefined> {
  const access = await readAccess(personId);
  if (!access) return undefined;
  const version = authorizationVersion(access);
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
    ...(relationGrantsOf(access.grant.relations).length
      ? { relationGrants: relationGrantsOf(access.grant.relations) }
      : {}),
    groups: await readGroups(personId),
    authorizationVersion: version,
    sessionBinding: binding,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    async authorize() {
      const current = await readAccess(personId);
      if (!current || authorizationVersion(current) !== version)
        throw new Error('Authorization changed before dispatch.');
      return { version };
    },
  };
}
