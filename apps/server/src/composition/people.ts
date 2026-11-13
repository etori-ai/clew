import { postgresProvisionStore, postgresUserReads } from '../modules/people/adapters/postgres';
import type { UserReads } from '../modules/people/ports';
import {
  directoryUsecases,
  organisationUsecases,
  provisionerKeyUsecases,
  scimUsecases,
  staffUsecases,
  usersAdminUsecases,
} from '../modules/people/usecases';
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
/** Administration › Organisation (D99): the organisation tree as the provisioner pushed it, read only. */
export const organisation = organisationUsecases({ store: postgresProvisionStore() });
/** Personal (D94, D99): the signed-in manager's reports, read only. */
export const staff = staffUsecases({ store: postgresProvisionStore() });
