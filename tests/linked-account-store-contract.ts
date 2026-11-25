import { describe, expect, test } from 'bun:test';
import type { LinkedAccount, PendingLink } from '../apps/server/src/modules/linked-accounts/contracts';
import type {
  Approval,
  LinkAuditEntry,
  LinkStore,
  OAuthClient,
} from '../apps/server/src/modules/linked-accounts/ports';

/**
 * The link store contract (D25, D147): one suite for every adapter. `tests/unit/linked-account-store.test.ts` runs it
 * against the memory adapter; the Postgres adapter runs it from `tests/db` when it is written.
 */
export interface LinkStoreHarness {
  store: LinkStore;
  /** The audit rows this store's transactions wrote, oldest first. */
  audit(): Promise<LinkAuditEntry[]>;
  /** A prefix for this run's people and connectors, so an adapter on a shared database finds and removes its own. */
  prefix: string;
}
const T = '2026-11-25T08:00:00.000Z';

export function linkStoreContract(name: string, make: () => Promise<LinkStoreHarness>) {
  const link = (prefix: string, person: string, connector: string, overrides: Partial<LinkedAccount> = {}) =>
    ({
      personId: prefix + person,
      connectorId: prefix + connector,
      issuer: 'https://id.vendor.test',
      resource: 'https://hr.vendor.test',
      scopes: ['leave'],
      state: 'linked',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: '2026-11-25T09:00:00.000Z',
      lastError: null,
      linkedAt: T,
      ...overrides,
    }) satisfies LinkedAccount;
  const pending = (prefix: string, state: string, expiresAt: string): PendingLink => ({
    state: prefix + state,
    verifier: 'verifier-' + state,
    personId: prefix + 'anna',
    connectorId: prefix + 'hr',
    issuer: 'https://id.vendor.test',
    returnTo: '/todo',
    expiresAt,
  });
  const client: OAuthClient = { id: 'client-1', secret: 'secret-1', source: 'registered' };

  describe(`${name} link store`, () => {
    test('a link is read back as written, replaced by the next write, and gone when removed', async () => {
      const { store, prefix } = await make();
      const first = link(prefix, 'anna', 'hr');
      expect(await store.transaction(tx => tx.link(first.personId, first.connectorId))).toBeNull();
      await store.transaction(tx => tx.save(first));
      expect(await store.transaction(tx => tx.link(first.personId, first.connectorId))).toEqual(first);
      const lost = link(prefix, 'anna', 'hr', {
        state: 'needs-link',
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
        lastError: 'invalid_grant',
        scopes: [],
      });
      await store.transaction(tx => tx.save(lost));
      expect(await store.transaction(tx => tx.link(first.personId, first.connectorId))).toEqual(lost);
      await store.transaction(tx => tx.remove(first.personId, first.connectorId));
      expect(await store.transaction(tx => tx.link(first.personId, first.connectorId))).toBeNull();
      expect(await store.linksOf(first.personId)).toEqual([]);
    });

    test("a person's links and a connector's links are listed apart, in the connector's then the person's order", async () => {
      const { store, prefix } = await make();
      const rows = [link(prefix, 'bo', 'hr'), link(prefix, 'anna', 'ledger'), link(prefix, 'anna', 'hr')];
      await store.transaction(async tx => {
        for (const row of rows) await tx.save(row);
      });
      expect((await store.linksOf(prefix + 'anna')).map(l => l.connectorId)).toEqual([
        prefix + 'hr',
        prefix + 'ledger',
      ]);
      expect((await store.transaction(tx => tx.linksOf(prefix + 'anna'))).length).toBe(2);
      expect((await store.transaction(tx => tx.linksTo(prefix + 'hr'))).map(l => l.personId)).toEqual([
        prefix + 'anna',
        prefix + 'bo',
      ]);
      expect(await store.linksOf(prefix + 'nobody')).toEqual([]);
    });

    test('a pending authorization is taken once, and the ones whose time has passed are removed', async () => {
      const { store, prefix } = await make();
      const kept = pending(prefix, 'kept', '2026-11-25T08:10:00.000Z');
      await store.transaction(async tx => {
        await tx.pend(kept);
        await tx.pend(pending(prefix, 'old', '2026-11-25T08:00:00.000Z'));
      });
      await store.transaction(tx => tx.expire('2026-11-25T08:00:00.000Z'));
      expect(await store.transaction(tx => tx.take(prefix + 'old'))).toBeNull();
      expect(await store.transaction(tx => tx.take(prefix + 'kept'))).toEqual(kept);
      expect(await store.transaction(tx => tx.take(prefix + 'kept'))).toBeNull();
      expect(await store.transaction(tx => tx.take(prefix + 'never'))).toBeNull();
    });

    test('a registered client is kept per connector and issuer', async () => {
      const { store, prefix } = await make();
      await store.transaction(tx => tx.saveClient(prefix + 'hr', 'https://id.vendor.test', client));
      expect(await store.transaction(tx => tx.client(prefix + 'hr', 'https://id.vendor.test'))).toEqual(client);
      expect(await store.transaction(tx => tx.client(prefix + 'hr', 'https://other.vendor.test'))).toBeNull();
      expect(await store.transaction(tx => tx.client(prefix + 'ledger', 'https://id.vendor.test'))).toBeNull();
    });

    test('an approval is kept per connector, its client with it, and replaced by the next', async () => {
      const { store, prefix } = await make();
      const approval: Approval = {
        resource: 'https://hr.vendor.test',
        server: {
          issuer: 'https://id.vendor.test',
          authorizationEndpoint: 'https://id.vendor.test/authorize',
          tokenEndpoint: 'https://id.vendor.test/token',
          revocationEndpoint: 'https://id.vendor.test/revoke',
          registrationEndpoint: 'https://id.vendor.test/register',
          pkce: true,
          issuerOnReturn: true,
          clientDocuments: false,
        },
        origin: 'discovered',
        client: null,
        approvedBy: 'Mikael Lund',
        approvedAt: T,
      };
      expect(await store.transaction(tx => tx.approval(prefix + 'hr'))).toBeNull();
      await store.transaction(tx => tx.approve(prefix + 'hr', approval));
      expect(await store.transaction(tx => tx.approval(prefix + 'hr'))).toEqual(approval);
      expect(await store.transaction(tx => tx.approval(prefix + 'ledger'))).toBeNull();
      const entered: Approval = {
        ...approval,
        server: {
          ...approval.server,
          revocationEndpoint: null,
          registrationEndpoint: null,
          pkce: false,
          issuerOnReturn: false,
        },
        origin: 'entered',
        client: { id: 'clew', secret: 'a-secret', source: 'entered' },
        approvedAt: '2026-11-25T09:00:00.000Z',
      };
      await store.transaction(tx => tx.approve(prefix + 'hr', entered));
      expect(await store.transaction(tx => tx.approval(prefix + 'hr'))).toEqual(entered);
    });

    test('a transaction that throws writes nothing, its audit row included', async () => {
      const { store, audit, prefix } = await make();
      const row = link(prefix, 'anna', 'hr');
      const subject = 'linked-account:' + row.connectorId;
      await store.transaction(async tx => {
        await tx.save(row);
        await tx.audit({ actor: 'person:anna', action: 'account.linked', subject, details: { connector: 'hr' } });
      });
      await expect(
        store.transaction(async tx => {
          await tx.remove(row.personId, row.connectorId);
          await tx.pend(pending(prefix, 'lost', '2026-11-25T08:10:00.000Z'));
          await tx.saveClient(row.connectorId, row.issuer, client);
          await tx.audit({ actor: 'person:anna', action: 'account.unlinked', subject, details: {} });
          throw new Error('stopped');
        }),
      ).rejects.toThrow('stopped');
      expect(await store.linksOf(row.personId)).toEqual([row]);
      expect(await store.transaction(tx => tx.take(prefix + 'lost'))).toBeNull();
      expect(await store.transaction(tx => tx.client(row.connectorId, row.issuer))).toBeNull();
      expect((await audit()).map(a => [a.actor, a.action, a.subject, a.details])).toEqual([
        ['person:anna', 'account.linked', subject, { connector: 'hr' }],
      ]);
    });

    test('a link is held for the transaction that asked for it: the next one reads what the first wrote', async () => {
      const { store, prefix } = await make();
      const row = link(prefix, 'anna', 'hr');
      await store.transaction(tx => tx.save(row));
      const order: string[] = [];
      const spend = (label: string) =>
        store.transaction(async tx => {
          const held = await tx.link(row.personId, row.connectorId);
          order.push(`${label} read ${held!.refreshToken}`);
          // Whatever else the process does meanwhile, the second transaction does not read before this one has written.
          await new Promise(resolve => setTimeout(resolve, 20));
          await tx.save({ ...held!, refreshToken: 'refresh-after-' + label });
          order.push(`${label} wrote`);
        });
      await Promise.all([spend('first'), spend('second')]);
      expect(order).toEqual(['first read refresh-1', 'first wrote', 'second read refresh-after-first', 'second wrote']);
    });
  });
}
