import { createHash } from 'node:crypto';
import { registry } from '../connectors/registry';
import { jobUsecases } from '../modules/jobs/usecases';
import { postgresFollowBindingStore } from '../modules/jobs/adapters/postgres';
import { executions } from './executions';
import { clock, ids } from './ambient';

/**
 * Jobs across systems (D55): the registry supplies followers and offers, the executions module is the ledger behind one
 * approval. Used by the job routes and fixture scenario. Not the scheduler's job rows (`./jobs.ts`).
 */
export const followBindings = postgresFollowBindingStore();
export const jobs = jobUsecases({
  bindings: followBindings,
  followers: (actor, kind) => registry.followers(actor, kind),
  offered: kind => registry.offered(kind),
  refresh: () => registry.refreshGovernance(),
  digest: value => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  ledger: executions,
  clock,
  ids,
});
