import { expect, test } from 'bun:test';
import { startupReadiness } from '../../apps/server/src/startup';

test('a failed startup recovers after its dependency returns and starts services only once', async () => {
  let available = false,
    services = 0,
    failures = 0;
  const retries: Array<() => void> = [];
  const startup = startupReadiness({
    initialize: async () => {
      if (!available) throw new Error('migration pending');
    },
    onReady: () => {
      services++;
    },
    onError: () => {
      failures++;
    },
    retry: run => {
      retries.push(run);
    },
  });
  await startup.start();
  expect(startup.ready()).toBe(false);
  expect(services).toBe(0);
  expect(failures).toBe(1);
  expect(retries).toHaveLength(1);
  available = true;
  retries[0]!();
  await startup.start();
  expect(startup.ready()).toBe(true);
  await startup.start();
  expect(services).toBe(1);
});

test('simultaneous starts share one initialization', async () => {
  let calls = 0;
  const startup = startupReadiness({
    initialize: async () => {
      calls++;
    },
    onReady: () => {},
    onError: () => {},
    retry: () => {},
  });
  await Promise.all([startup.start(), startup.start()]);
  expect(calls).toBe(1);
  expect(startup.ready()).toBe(true);
});
