import { describe, expect, test } from 'bun:test';
import { delegationFor } from '../../apps/server/src/auth-exchange';

/** Token exchange behind the cache (D26): once per session and audience, reused until the margin, nothing cached on failure. */
function world(options: { subject?: string | undefined; expiresIn?: number } = {}) {
  let now = 1_000_000;
  const exchanges: string[] = [];
  const subjects: string[] = [];
  let fail = false;
  const delegation = delegationFor({
    clock: () => now,
    subjectToken: async digest => {
      subjects.push(digest);
      return 'subject' in options ? options.subject : 'subj-' + digest;
    },
    exchange: async (subject, audience) => {
      exchanges.push(subject + '>' + audience);
      if (fail) throw new Error('invalid_target');
      return { access_token: `tok-${audience}-${exchanges.length}`, expires_in: options.expiresIn ?? 60 };
    },
    marginMs: 10_000,
  });
  return {
    delegation,
    exchanges,
    subjects,
    advance: (ms: number) => {
      now += ms;
    },
    setFail: (v: boolean) => {
      fail = v;
    },
  };
}
describe('delegation', () => {
  test('two concurrent calls exchange once; the token is reused until its margin, then exchanged again', async () => {
    const w = world();
    const [a, b] = await Promise.all([w.delegation.token('s1', 'eneo'), w.delegation.token('s1', 'eneo')]);
    expect(a).toBe('tok-eneo-1');
    expect(b).toBe('tok-eneo-1');
    expect(w.exchanges).toEqual(['subj-s1>eneo']);
    w.advance(45_000);
    expect(await w.delegation.token('s1', 'eneo')).toBe('tok-eneo-1');
    w.advance(10_000);
    expect(await w.delegation.token('s1', 'eneo')).toBe('tok-eneo-2');
    expect(await w.delegation.token('s1', 'sharepoint')).toBe('tok-sharepoint-3');
    expect(await w.delegation.token('s2', 'eneo')).toBe('tok-eneo-4');
  });
  test('a session without IdP tokens yields undefined and caches nothing; a failed exchange is not cached either', async () => {
    const w = world({ subject: undefined });
    expect(await w.delegation.token('dev', 'eneo')).toBeUndefined();
    expect(await w.delegation.token('dev', 'eneo')).toBeUndefined();
    expect(w.subjects).toEqual(['dev', 'dev']);
    expect(w.exchanges).toEqual([]);
    const f = world();
    f.setFail(true);
    await expect(f.delegation.token('s1', 'eneo')).rejects.toThrow('invalid_target');
    f.setFail(false);
    expect(await f.delegation.token('s1', 'eneo')).toBe('tok-eneo-2');
  });
  test("forget drops one session's tokens only; the exchanged life is capped; a bad audience is refused before any call", async () => {
    const w = world({ expiresIn: 3600 });
    await w.delegation.token('s1', 'eneo');
    await w.delegation.token('s2', 'eneo');
    w.delegation.forget('s1');
    expect(await w.delegation.token('s2', 'eneo')).toBe('tok-eneo-2');
    expect(await w.delegation.token('s1', 'eneo')).toBe('tok-eneo-3');
    w.advance(295_000);
    expect(await w.delegation.token('s2', 'eneo')).toBe('tok-eneo-4');
    await expect(w.delegation.token('s1', 'bad audience')).rejects.toThrow('Invalid delegation audience');
    expect(w.exchanges).toHaveLength(4);
  });
});
