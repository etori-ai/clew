import { postgresProvisionStore, postgresUserReads } from '../modules/people/adapters/postgres';
import { organisationUsecases, scimUsecases, staffUsecases, usersAdminUsecases } from '../modules/people/usecases';
import { competenceTx } from '../modules/competence/adapters/postgres';
import { competenceLeavers } from '../modules/competence/usecases';
import { randomToken, tokenDigest } from '../auth-crypto';
import { logger } from '../logging';
import { clock, ids } from './ambient';
import { ledger } from './durable';

/** Local identity reads use the same scoped capability dispatch as other internal functions. */
export const userReads = postgresUserReads();
/**
 * The SCIM server's use cases and the derivation of a person's grant from memberships and the mapping (D68, D85):
 * `scim` serves `/scim/v2`. A grant is derived inside the transaction of the change that moves it, by the SCIM use
 * cases and by the mapping on the users page alike. A change of `active` is told, in the same transaction, to the
 * competence module's leavers (D108 item 14): its erasure intent, on a `CompetenceTx` over the SCIM transaction's own
 * savepoint, bound here because the people module imports no other. A call that fails is logged and left to the
 * competence module's hourly sweep, which records from the directory what no intent recorded (D113: the deactivation
 * commits whatever the competence module does).
 */
export const scim = scimUsecases({
  store: postgresProvisionStore({
    leavers: tx => competenceLeavers(competenceTx(tx, ledger)),
    leaverFailed: (error, change, kind) =>
      logger.warn(
        {
          scope: 'scim',
          person: change.personId,
          kind,
          code:
            (error as { code?: unknown } | null)?.code ??
            (error as { cause?: { code?: unknown } } | null)?.cause?.code ??
            null,
        },
        'the competence module could not record a change of active; its hourly sweep reconciles it with the directory',
      ),
  }),
  clock,
  ids,
  digest: tokenDigest,
});
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
