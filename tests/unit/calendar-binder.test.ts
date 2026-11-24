import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { memoryCalendar } from '../../packages/calendar/src/memory';
import { bindCalendar } from '../../packages/calendar/src/accounts';
import { CalendarError } from '../../packages/calendar/src/model';
import { calendarBinder } from '../../apps/server/src/modules/calendar/adapters/binder';

/**
 * Which calendar a person is bound to (DE-M8): the address Clew's directory holds for them now, read on every call, and a
 * binding kept only while that address and their authorization version stay the same.
 */
const persona = (version: string): AuthenticatedContext => ({
  id: 'hillevi',
  name: 'Hillevi Berg',
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role: 'manager',
  organisationId: 'sundsvall',
  principal: { id: 'person:hillevi', kind: 'person' },
  capabilities: [],
  authorizationVersion: version,
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  async authorize() {
    return { version };
  },
});
const NOT_BOUND = 'Ditt konto har ingen kalender kopplad.';

/** A binder over a directory the test edits, which records every binding it is asked for. */
function world(address: string | null) {
  const directory = { address };
  const bound: (string | null)[] = [];
  const bind = calendarBinder({
    email: async () => directory.address,
    bindCalendar: (p, email) => {
      bound.push(email);
      if (!email) throw new CalendarError(NOT_BOUND);
      return { provider: memoryCalendar({ ref: 'memory:account:' + p.id, email, name: p.name }) };
    },
  });
  return { directory, bound, bind };
}

describe('the calendar a person is bound to (DE-M8)', () => {
  test('the same address and authorization version give the same binding', async () => {
    const w = world('hillevi@clew.test');
    const first = await w.bind(persona('v1'));
    expect(await w.bind(persona('v1'))).toBe(first);
    expect(w.bound).toEqual(['hillevi@clew.test']);
    expect(first.provider.account.email).toBe('hillevi@clew.test');
  });

  test('a new address in the directory binds again, to the new address', async () => {
    const w = world('hillevi@clew.test');
    const first = await w.bind(persona('v1'));
    w.directory.address = 'hillevi.berg@clew.test';
    const second = await w.bind(persona('v1'));
    expect(second).not.toBe(first);
    expect(second.provider.account.email).toBe('hillevi.berg@clew.test');
    expect(w.bound).toEqual(['hillevi@clew.test', 'hillevi.berg@clew.test']);
  });

  test('a new authorization version binds again', async () => {
    const w = world('hillevi@clew.test');
    const first = await w.bind(persona('v1'));
    const second = await w.bind(persona('v2'));
    expect(second).not.toBe(first);
    expect(await w.bind(persona('v2'))).toBe(second);
    expect(w.bound).toEqual(['hillevi@clew.test', 'hillevi@clew.test']);
  });

  test('an address that is gone (an erased person) is refused, and no old binding is left to answer for it', async () => {
    const w = world('hillevi@clew.test');
    const first = await w.bind(persona('v1'));
    w.directory.address = null;
    await expect(w.bind(persona('v1'))).rejects.toThrow(NOT_BOUND);
    // The address comes back: the person is bound afresh, never handed the binding from before the erasure.
    w.directory.address = 'hillevi@clew.test';
    const again = await w.bind(persona('v1'));
    expect(again).not.toBe(first);
    expect(w.bound).toEqual(['hillevi@clew.test', null, 'hillevi@clew.test']);
  });
});

describe('the development calendar sign-ins (D69)', () => {
  test('a person with a sign-in but no address in the directory has no calendar', () => {
    const before = process.env.CLEW_POC;
    process.env.CLEW_POC = 'true';
    try {
      expect(() => bindCalendar({ id: 'hillevi', name: 'Hillevi Berg' }, null)).toThrow(NOT_BOUND);
      expect(() => bindCalendar({ id: 'hillevi', name: 'Hillevi Berg' }, '')).toThrow(NOT_BOUND);
      // A person without a sign-in has none either, whatever the directory holds.
      expect(() => bindCalendar({ id: 'anna', name: 'Anna Lindqvist' }, 'anna@clew.test')).toThrow(NOT_BOUND);
      expect(bindCalendar({ id: 'hillevi', name: 'Hillevi Berg' }, 'hillevi@clew.test').provider.account.email).toBe(
        'hillevi@clew.test',
      );
    } finally {
      if (before === undefined) delete process.env.CLEW_POC;
      else process.env.CLEW_POC = before;
    }
  });
});
