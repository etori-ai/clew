import { postgresProvisionStore, postgresUserReads } from '../modules/people/adapters/postgres';
import { scimUsecases, staffUsecases, usersAdminUsecases } from '../modules/people/usecases';
import { tokenDigest } from '../auth-crypto';
import { clock, ids } from './ambient';

/** Local identity reads use the same scoped capability dispatch as other internal functions. */
export const userReads = postgresUserReads();
/**
 * The SCIM server's use cases and the derivation of a person's grant from memberships and the mapping (D68, D85):
 * `scim` serves `/scim/v2`; its `derivePerson` and `deriveGroup` are what the users page will call when a mapping changes.
 */
export const scim = scimUsecases({ store: postgresProvisionStore(), clock, ids, digest: tokenDigest });
export const provisioning = scim;
/** Administration › Användare (D85): the overview and the group-to-capability mapping. */
export const usersAdmin = usersAdminUsecases({ store: postgresProvisionStore(), clock });
/** Personal (D94): the people on the units the signed-in manager manages, read only. */
export const staff = staffUsecases({ store: postgresProvisionStore() });
