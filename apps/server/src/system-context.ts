import type { AuthenticatedContext } from '@clew/contracts';
import { groupsStillMatch, readAccess, readGroups } from '@clew/db/auth';
import { authorizationVersion } from './auth-crypto';
import { ForbiddenError } from './context';
import { personFields } from './person-context';

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
  const version = authorizationVersion(access),
    groups = await readGroups(personId);
  return {
    ...personFields(access, groups, version),
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
