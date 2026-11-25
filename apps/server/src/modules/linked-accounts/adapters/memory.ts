import type { LinkedAccount, PendingLink } from '../contracts';
import type { LinkAuditEntry, LinkStore, OAuthClient } from '../ports';

/**
 * The link store in memory (D25, D147): the unit tests' adapter, held to the store contract in
 * `tests/linked-account-store-contract.ts`. Transactions run one at a time, which is what holding a link gives in a
 * database, and a throw rolls back every write of the transaction and its audit rows.
 */
export interface MemoryLinkStore extends LinkStore {
  audit: LinkAuditEntry[];
  /** The authorizations people have started and not returned from, for a test to read. */
  pending(): PendingLink[];
}
const key = (a: string, b: string) => JSON.stringify([a, b]);
const byConnector = (a: LinkedAccount, b: LinkedAccount) =>
  a.connectorId < b.connectorId ? -1 : a.connectorId > b.connectorId ? 1 : a.personId < b.personId ? -1 : 1;

export function memoryLinkStore(): MemoryLinkStore {
  let links = new Map<string, LinkedAccount>();
  let pendings = new Map<string, PendingLink>();
  let clients = new Map<string, OAuthClient>();
  let queue: Promise<unknown> = Promise.resolve();
  const listed = (keep: (link: LinkedAccount) => boolean) =>
    [...links.values()]
      .filter(keep)
      .sort(byConnector)
      .map(link => structuredClone(link));
  const self: MemoryLinkStore = {
    audit: [],
    pending: () => [...pendings.values()].map(p => structuredClone(p)),
    async linksOf(personId) {
      return listed(link => link.personId === personId);
    },
    transaction(fn) {
      const run = queue.then(async () => {
        const before = {
          links: new Map(links),
          pendings: new Map(pendings),
          clients: new Map(clients),
          audit: self.audit.length,
        };
        try {
          return await fn({
            link: async (personId, connectorId) => structuredClone(links.get(key(personId, connectorId)) ?? null),
            save: async link => {
              links.set(key(link.personId, link.connectorId), structuredClone(link));
            },
            remove: async (personId, connectorId) => {
              links.delete(key(personId, connectorId));
            },
            linksOf: async personId => listed(link => link.personId === personId),
            linksTo: async connectorId => listed(link => link.connectorId === connectorId),
            pend: async pending => {
              pendings.set(pending.state, structuredClone(pending));
            },
            take: async state => {
              const pending = pendings.get(state) ?? null;
              pendings.delete(state);
              return structuredClone(pending);
            },
            expire: async now => {
              for (const [state, pending] of pendings)
                if (Date.parse(pending.expiresAt) <= Date.parse(now)) pendings.delete(state);
            },
            client: async (connectorId, issuer) => structuredClone(clients.get(key(connectorId, issuer)) ?? null),
            saveClient: async (connectorId, issuer, client) => {
              clients.set(key(connectorId, issuer), structuredClone(client));
            },
            audit: async entry => {
              self.audit.push(structuredClone(entry));
            },
          });
        } catch (error) {
          links = before.links;
          pendings = before.pendings;
          clients = before.clients;
          self.audit.length = before.audit;
          throw error;
        }
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
  return self;
}
