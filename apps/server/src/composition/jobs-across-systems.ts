import { registry } from '../connectors/registry';
import { jobUsecases } from '../modules/jobs/usecases';
import { postgresFollowBindingStore } from '../modules/jobs/adapters/postgres';
import { executions } from './executions';
import { clock, ids } from './ambient';

/**
 * Jobs across systems (D55): the registry supplies followers and offers, the executions module is the ledger behind one
 * approval. No route yet; the proof is the unit scenario and the store contract. Not the scheduler's job rows (`./jobs.ts`).
 */
export const followBindings = postgresFollowBindingStore();
export const jobs = jobUsecases({
  bindings: followBindings,
  followers: (actor, kind) => registry.followers(actor, kind),
  offered: kind => registry.offered(kind),
  ledger: executions,
  clock,
  ids,
});
