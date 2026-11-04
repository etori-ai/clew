import { Client, Connection } from '@temporalio/client';

/** Where Temporal is. The devcontainer sets TEMPORAL_ADDRESS to the compose service; outside Docker the CLI dev server. */
export const temporalAddress = () => process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233';
export const temporalNamespace = () => process.env.TEMPORAL_NAMESPACE ?? 'default';
export const TASK_QUEUE = 'clew';

let pending: Promise<Client> | undefined;
/** One lazy client per process. A failed connection is forgotten so the next call tries again. */
export function temporalClient(): Promise<Client> {
  pending ??= Connection.connect({ address: temporalAddress(), connectTimeout: 3000 })
    .then(connection => new Client({ connection, namespace: temporalNamespace() }))
    .catch(error => { pending = undefined; throw error; });
  return pending;
}
