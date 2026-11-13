import { postgresProvisionStore, postgresUserReads } from '../modules/people/adapters/postgres';
import type { UserReads } from '../modules/people/ports';
import {
  directoryUsecases,
  organisationUsecases,
  personErasureUsecases,
  provisionerKeyUsecases,
  scimUsecases,
  staffUsecases,
  usersAdminUsecases,
} from '../modules/people/usecases';
import type { AuthenticatedContext } from '@clew/contracts';
import { followedUnits } from '../modules/entities/domain';
import { randomToken, tokenDigest } from '../auth-crypto';
import { clock, ids } from './ambient';

/**
 * Local identity reads use the same scoped capability dispatch as other internal functions. The directory reads the
 * unit's placements through the provisioning store, as Personal does (A4).
 */
export const userReads: UserReads = {
  ...postgresUserReads(),
  ...directoryUsecases({ store: postgresProvisionStore() }),
};
/**
 * The SCIM server's use cases and the derivation of a person's grant from memberships and the mapping (D68, D85):
 * `scim` serves `/scim/v2`. A grant is derived inside the transaction of the change that moves it, by the SCIM use
 * cases and by the mapping on the users page alike.
 */
export const scim = scimUsecases({ store: postgresProvisionStore(), clock, ids, digest: tokenDigest });
/** Administration › Användare (D85, D107): the overview, the group-to-capability mapping and the provisioners' keys. */
export const usersAdmin = usersAdminUsecases({
  store: postgresProvisionStore(),
  clock,
  token: randomToken,
  digest: tokenDigest,
});
/**
 * The operator's half of D107 (item 6): `scripts/provisioner-token.ts` replaces and takes back a provisioner's key
 * through these, with the audit rows the users page writes.
 */
export const provisionerKeys = provisionerKeyUsecases({
  store: postgresProvisionStore(),
  clock,
  token: randomToken,
  digest: tokenDigest,
});
/** D123: `scripts/person-erase.ts` erases a deactivated person through this, in one transaction with its audit row. */
export const personErasure = personErasureUsecases({ store: postgresProvisionStore(), clock });
/** Administration › Organisation (D99): the organisation tree as the provisioner pushed it, read only. */
export const organisation = organisationUsecases({ store: postgresProvisionStore() });
/** Personal (D94, D99): the signed-in manager's reports, read only. */
export const staff = staffUsecases({ store: postgresProvisionStore() });

const followed = new WeakMap<AuthenticatedContext, Promise<AuthenticatedContext>>();
/**
 * The person with the units they follow up (D117), for a read a source may answer for those units: a manager's own and
 * the units of the managers who report to them (D99), from the same reach as Personal and the unit's page. Read once per
 * request (the context is the request's); an employee follows up nothing below and is passed on as they are.
 */
export function withFollowedUnits(persona: AuthenticatedContext): Promise<AuthenticatedContext> {
  if (persona.role !== 'manager') return Promise.resolve(persona);
  let found = followed.get(persona);
  if (!found) {
    found = staff.reach(persona).then(reach => ({ ...persona, units: followedUnits(reach) }));
    followed.set(persona, found);
  }
  return found;
}
