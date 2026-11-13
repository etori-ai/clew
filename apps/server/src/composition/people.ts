import type { Transaction } from '@clew/db';
import { postgresProvisionStore, postgresUserReads } from '../modules/people/adapters/postgres';
import { organisationUsecases, scimUsecases, staffUsecases, usersAdminUsecases } from '../modules/people/usecases';
import type { LeaversTx } from '../modules/people/ports';
import { competenceTx } from '../modules/competence/adapters/postgres';
import { competenceLeavers } from '../modules/competence/usecases';
import { randomToken, tokenDigest } from '../auth-crypto';
import { cancelWhereRunning } from '../dbos/start';
import { logger } from '../logging';
import { clock, ids } from './ambient';
import { ledger } from './durable';

/** Local identity reads use the same scoped capability dispatch as other internal functions. */
export const userReads = postgresUserReads();
/**
 * What a deactivation or a reactivation means beyond the people module (D108 item 14), bound here because the people
 * module imports no other: the competence module's erasure intent, on the SCIM transaction itself, so the intent, its
 * audit row and its workflow's start (D86) commit or roll back with the change. The approvals' cards are not touched
 * by a change of `active`, so the competence transaction here has none; the waits it ends go to `ended`.
 */
const leavers = (tx: Transaction, ended: string[]): LeaversTx =>
  competenceLeavers(competenceTx(tx, ledger, undefined, ended));
/** A wait a committed change ended is cancelled best effort: the generation fence covers one that fails (D86). */
const cancel = (workflowId: string) =>
  cancelWhereRunning(workflowId).catch(error =>
    logger.error({ scope: 'scim', workflow: workflowId, error }, 'durable cancel failed'),
  );
/**
 * The SCIM server's use cases and the derivation of a person's grant from memberships and the mapping (D68, D85):
 * `scim` serves `/scim/v2`. A grant is derived inside the transaction of the change that moves it, by the SCIM use
 * cases and by the mapping on the users page alike. A change of `active` is told to the leavers in the same transaction.
 */
export const scim = scimUsecases({
  store: postgresProvisionStore({ leavers, cancel }),
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
