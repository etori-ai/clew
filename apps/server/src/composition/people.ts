import { postgresProvisionStore, postgresUserReads } from '../modules/people/adapters/postgres';
import { organisationUsecases, scimUsecases, staffUsecases, usersAdminUsecases } from '../modules/people/usecases';
import { randomToken, tokenDigest } from '../auth-crypto';
import { clock, ids } from './ambient';

/** Local identity reads use the same scoped capability dispatch as other internal functions. */
export const userReads = postgresUserReads();
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
/** Administration › Organisation (D99): the organisation tree as the provisioner pushed it, read only. */
export const organisation = organisationUsecases({ store: postgresProvisionStore() });
/** Personal (D94, D99): the signed-in manager's reports, read only. */
export const staff = staffUsecases({ store: postgresProvisionStore() });
