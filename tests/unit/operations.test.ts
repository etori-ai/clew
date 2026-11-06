import { expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src';
import { operationsUsecases, type ReliabilityCounts } from '../../apps/server/src/modules/operations/usecases';
test('operational counts require a current administrative grant before reading any state', async () => {
  let reads = 0;
  const uc = operationsUsecases(async () => {
    reads++;
    return {} as ReliabilityCounts;
  });
  const person = { capabilities: [], authorize: async () => ({ version: 'v1' }) } as unknown as AuthenticatedContext;
  await expect(uc.reliability(person)).rejects.toThrow();
  expect(reads).toBe(0);
  await uc.reliability({ ...person, capabilities: ['admin.connectors'] });
  expect(reads).toBe(1);
  await expect(
    uc.reliability({
      ...person,
      capabilities: ['admin.connectors'],
      authorize: async () => {
        throw new Error('revoked');
      },
    }),
  ).rejects.toThrow('revoked');
  expect(reads).toBe(1);
});
