import { postgresProvisionStore, postgresUserReads } from '../modules/people/adapters/postgres';
import { organisationUsecases, scimUsecases, staffUsecases, usersAdminUsecases } from '../modules/people/usecases';
import { competenceTx } from '../modules/competence/adapters/postgres';
import { competenceLeavers } from '../modules/competence/usecases';
import type { AuthenticatedContext } from '@clew/contracts';
import { followedUnits } from '../modules/entities/domain';
import { boardingTx, postgresBoardingDirectory } from '../modules/boarding/adapters/postgres';
import { boardingLeavers } from '../modules/boarding/usecases';
import { combineLeavers } from '../modules/people/leavers';
import type { LeaverChange, LeaversTx } from '../modules/people/ports';
import type { Transaction } from '@clew/db';
import { openSecret, randomToken, sealSecret, tokenDigest } from '../auth-crypto';
import { logger } from '../logging';
import { clock, ids } from './ambient';
import { ledger } from './durable';

/** Local identity reads use the same scoped capability dispatch as other internal functions. */
export const userReads = postgresUserReads();
/** The code a failed leavers call carries, the driver's or its cause's: what the log needs to tell a lock wait apart. */
const codeOf = (error: unknown) =>
  (error as { code?: unknown } | null)?.code ?? (error as { cause?: { code?: unknown } } | null)?.cause?.code ?? null;
/**
 * The domains a change of `active` is told to, in the SCIM transaction that makes it (D108 item 14, D124 item 7, D113):
 * the competence module's erasure intent, and boarding's holders of a deactivated person's plans, read from the
 * directory in that same transaction. Each runs in a savepoint of its own inside the store's savepoint, so one that
 * fails is rolled back alone and logged, the other is still told, and the deactivation commits whatever either does.
 * Competence reconciles what it missed with its hourly sweep; boarding falls back to the manager who started a plan.
 */
export const leavers = combineLeavers<Transaction>(
  [
    { module: 'competence', port: tx => competenceLeavers(competenceTx(tx, ledger)) },
    {
      module: 'boarding',
      // No card port: telling boarding of a change of `active` opens or closes no card.
      port: tx =>
        boardingLeavers(
          boardingTx(tx, { sealer: { seal: sealSecret, open: openSecret } }),
          postgresBoardingDirectory(tx),
        ),
    },
  ],
  (tx, fn) => tx.transaction(fn),
  (error: unknown, change: LeaverChange, kind: keyof LeaversTx, module: string) =>
    logger.warn(
      { scope: 'scim', module, person: change.personId, kind, code: codeOf(error) },
      module === 'competence'
        ? 'the competence module could not record a change of active; its hourly sweep reconciles it with the directory'
        : "the boarding module could not record who holds a leaver's plans; the manager who started each holds it",
    ),
);
/**
 * The SCIM server's use cases and the derivation of a person's grant from memberships and the mapping (D68, D85):
 * `scim` serves `/scim/v2`. A grant is derived inside the transaction of the change that moves it, by the SCIM use
 * cases and by the mapping on the users page alike. A change of `active` is told, in the same transaction, to the
 * domains that keep data about the person (`leavers`), bound here because the people module imports no other; the
 * store runs the whole call in a savepoint with a lock timeout, and each domain in a savepoint of its own within it.
 */
export const scim = scimUsecases({
  store: postgresProvisionStore({
    leavers,
    leaverFailed: (error, change, kind) =>
      logger.warn(
        { scope: 'scim', person: change.personId, kind, code: codeOf(error) },
        'the leavers port could not be told of a change of active; each domain reconciles what it missed',
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
