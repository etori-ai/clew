import { expect, test } from 'bun:test';
import { Registry, openGovernance, deniedGovernance, type Connector } from '../../packages/connectors/src/index';
import { remoteConnector, parseManifest } from '../../packages/connectors/src/remote';
import { manifest } from '../../connectors/communication/connector.mjs';

const actor = { id: 'test', name: 'Test', unitId: 'unit', unitLabel: 'Unit', role: 'manager' as const };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
function connector(id: string, figure: NonNullable<Connector['areas'][number]['figure']>): Connector {
  return {
    id,
    kind: 'passthrough',
    source: id,
    capabilities: [],
    areas: [{ id, title: id, roles: ['manager'], standing: [], schedules: [], figure }],
  };
}
const answer = (label: string) => ({ label, tone: 'none' as const });

test('figures run concurrently within a bound and retain registration order', async () => {
  const r = new Registry({ figures: { concurrency: 2, totalMs: 2000 } });
  const starts: string[] = [],
    gates = [deferred<void>(), deferred<void>(), deferred<void>()];
  const twoStarted = deferred<void>(),
    thirdStarted = deferred<void>();
  let active = 0,
    peak = 0;
  for (const [i, id] of ['a', 'b', 'c'].entries()) {
    r.register(
      connector(id, async () => {
        starts.push(id);
        active++;
        peak = Math.max(peak, active);
        if (starts.length === 2) twoStarted.resolve();
        if (starts.length === 3) thirdStarted.resolve();
        await gates[i]!.promise;
        active--;
        return answer(id);
      }),
    ).govern(id, openGovernance());
  }
  const result = r.areas(actor);
  await twoStarted.promise;
  expect(starts).toEqual(['a', 'b']);
  gates[1]!.resolve();
  await thirdStarted.promise;
  expect(peak).toBe(2);
  gates[2]!.resolve();
  gates[0]!.resolve();
  expect((await result).map(a => a.figure?.label)).toEqual(['a', 'b', 'c']);
});

test('a total deadline returns available figures and marks hanging and queued sources unavailable', async () => {
  const r = new Registry({ figures: { concurrency: 2, totalMs: 30 } });
  const late = deferred<ReturnType<typeof answer>>(),
    blocked = deferred<ReturnType<typeof answer>>();
  const started: string[] = [];
  let signal: AbortSignal | undefined;
  for (const id of ['fast', 'slow', 'blocked', 'queued']) {
    r.register(
      connector(id, async (_actor, clew) => {
        started.push(id);
        if (id === 'fast') return answer(id);
        signal = clew.signal;
        return id === 'slow' ? late.promise : blocked.promise;
      }),
    ).govern(id, openGovernance());
  }
  const result = await r.areas(actor);
  expect(result.map(a => a.id)).toEqual(['fast', 'slow', 'blocked', 'queued']);
  expect(result[0]!.figure).toEqual(answer('fast'));
  expect(result.slice(1).every(a => a.figure?.unavailable)).toBe(true);
  expect(started).not.toContain('queued');
  expect(signal?.aborted).toBe(true);
  late.resolve(answer('late sensitive content'));
  blocked.resolve(answer('late'));
  await Promise.resolve();
  expect(result[1]!.figure?.unavailable).toBe(true);
});

test('a remote figure receives cancellation when the total budget expires', async () => {
  const r = new Registry({ figures: { totalMs: 25 } });
  let signal: AbortSignal | undefined;
  r.register(
    remoteConnector(parseManifest(manifest), {
      url: 'http://fixture',
      assert: async () => 'synthetic',
      fetch: async (_url, init) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) =>
          signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
        );
      },
    }),
  ).govern('communication', openGovernance());
  expect((await r.areas(actor))[0]!.figure?.unavailable).toBe(true);
  expect(signal?.aborted).toBe(true);
});

test('the final batch check removes an earlier figure when its connector or audience is revoked', async () => {
  for (const policy of [
    deniedGovernance(),
    { ...openGovernance(), audience: { mode: 'selected' as const, units: ['other'] } },
  ]) {
    const r = new Registry();
    r.register(connector('early', async () => answer('restricted'))).govern('early', openGovernance());
    r.register(
      connector('later', async () => {
        r.govern('early', policy);
        return answer('later');
      }),
    ).govern('later', openGovernance());
    expect((await r.areas(actor)).map(a => a.id)).toEqual(['later']);
  }
});

test('final governance applies figure switches and does not release results when refresh fails', async () => {
  const r = new Registry();
  r.register(
    connector('one', async () => {
      r.govern('one', { ...openGovernance(), areas: { one: { figure: false } } });
      return answer('restricted');
    }),
  ).govern('one', openGovernance());
  expect((await r.areas(actor))[0]!.figure).toBeNull();
  let refreshes = 0;
  r.setRefresh(async () => {
    if (++refreshes === 2) throw new Error('authority unavailable');
  });
  await expect(r.areas(actor)).rejects.toThrow('authority unavailable');
});

test('a changed descriptor or revoked person cannot release a completed figure', async () => {
  const r = new Registry();
  r.register(
    connector('one', async () => {
      r.replace(connector('one', async () => answer('new contract')));
      return answer('old contract');
    }),
  ).govern('one', openGovernance());
  expect(await r.areas(actor)).toEqual([]);
  await expect(
    r.areas(actor, {
      authorize: async () => {
        throw new Error('person revoked');
      },
    }),
  ).rejects.toThrow('person revoked');
});
