import { describe, expect, test } from 'bun:test';
import type { CalendarProvider, EventOccurrence } from '../packages/calendar/src/model';

/**
 * The calendar's adapter contract (D61). Every `CalendarProvider` that talks to a real protocol must pass it, so a use
 * case tested on one adapter holds on the other. It runs on `Microsoft365Provider` over the local fake in
 * `tests/unit/microsoft365.test.ts` and on `NextcloudProvider` in `tests/calendar/`. A harness may keep state between
 * tests and runs, so each test takes a fresh day after `base`, and a harness on a lasting calendar draws its own base.
 */
export interface CalendarHarness {
  /** A person who organizes, and a person in their unit who is invited. */
  organizer(): CalendarProvider & Acceptor;
  guest(): CalendarProvider & Acceptor;
  guestEmail: string;
  uid(): string;
}
interface Acceptor {
  accept(ref: string, revision: string): Promise<EventOccurrence>;
}
let offset = 0;
/** A fresh day per test, at noon, so two tests never share a room or a person's time. */
function day(base: string) {
  const at = new Date(Date.parse(`${base}T12:00:00.000Z`) + ++offset * 86400000);
  return (hour: number, minutes = 0) => {
    const value = new Date(at);
    value.setUTCHours(hour, minutes);
    return value.toISOString();
  };
}
const refused = (work: Promise<unknown>) =>
  work.then(
    () => false,
    () => true,
  );

/** A room answers after the booking, so `create` may still say `pending` (D61). */
async function answered(provider: CalendarProvider, event: EventOccurrence) {
  const deadline = Date.now() + 20000;
  let current = event;
  while (current.roomResponse === 'pending' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 250));
    current = (await provider.lookup(event.ref)) ?? current;
  }
  return current;
}

export function calendarProviderContract(name: string, harness: CalendarHarness, base = '2031-03-03') {
  const hour = () => day(base);
  const meeting = (at: ReturnType<typeof hour>, participants: string[] = [], room?: string) => ({
    title: 'Kontraktsmöte & test',
    start: at(9),
    end: at(10),
    participants,
    ...(room ? { room } : {}),
  });
  describe(`${name}: the calendar provider contract`, () => {
    test('a reference exists before the event, and a repeated create leaves one event', async () => {
      const provider = harness.organizer(),
        uid = harness.uid(),
        at = hour();
      const ref = await provider.eventRef(uid);
      expect(await provider.lookup(ref)).toBeNull();
      const first = await provider.create(uid, meeting(at));
      const second = await provider.create(uid, meeting(at));
      expect(second.ref).toBe(first.ref);
      expect((await provider.list(at(0), at(23))).filter(e => e.uid === uid)).toHaveLength(1);
      await provider.cancel(first.ref, (await provider.lookup(first.ref))!.revision);
    });
    test('a booking reads back with exact times, its organizer and its guest', async () => {
      const provider = harness.organizer(),
        uid = harness.uid(),
        at = hour();
      const created = await provider.create(uid, meeting(at, [harness.guestEmail]));
      const found = (await provider.lookup(await provider.eventRef(uid)))!;
      expect(found).toMatchObject({
        ref: created.ref,
        uid,
        title: 'Kontraktsmöte & test',
        start: at(9),
        end: at(10),
        allDay: false,
        recurring: false,
        organizer: provider.account.email,
        canCancel: true,
        roomResponse: 'none',
      });
      expect(found.participants.find(p => p.email === harness.guestEmail)).toMatchObject({
        resource: false,
        response: 'needs-action',
      });
      await provider.cancel(found.ref, found.revision);
    });
    test('a list holds the window in order and refuses a window over 32 days', async () => {
      const provider = harness.organizer(),
        at = hour();
      const late = await provider.create(harness.uid(), {
        title: 'Sent',
        start: at(15),
        end: at(16),
        participants: [],
      });
      const early = await provider.create(harness.uid(), {
        title: 'Tidigt',
        start: at(8),
        end: at(9),
        participants: [],
      });
      expect((await provider.list(at(0), at(23))).map(e => e.ref)).toEqual([early.ref, late.ref]);
      expect((await provider.list(at(10), at(12))).map(e => e.ref)).toEqual([]);
      const far = new Date(Date.parse(at(0)) + 33 * 86400000).toISOString();
      expect(await refused(provider.list(at(0), far))).toBe(true);
      for (const event of [early, late]) await provider.cancel(event.ref, (await provider.lookup(event.ref))!.revision);
    });
    test('free-busy tells busy from free and an unknown address from both', async () => {
      const provider = harness.organizer(),
        at = hour(),
        guest = { ref: 'guest', email: harness.guestEmail },
        stranger = { ref: 'stranger', email: 'finns-inte@clew.test' };
      const event = await provider.create(harness.uid(), meeting(at, [harness.guestEmail]));
      const busy = await provider.freeBusy(at(8), at(11), [guest, stranger]);
      expect(busy.find(x => x.ref === 'guest')).toMatchObject({
        state: 'known',
        busy: [{ start: at(9), end: at(10) }],
      });
      expect(busy.find(x => x.ref === 'stranger')?.state).toBe('unknown');
      expect(await provider.availability(at(9), at(10), [guest])).toEqual([{ ref: 'guest', state: 'busy' }]);
      expect(await provider.availability(at(14), at(15), [guest])).toEqual([{ ref: 'guest', state: 'free' }]);
      expect(await provider.availability(at(9), at(10), [])).toEqual([]);
      await provider.cancel(event.ref, (await provider.lookup(event.ref))!.revision);
    });
    test('a room accepts a free time, shows as busy, and declines the next booking', async () => {
      const provider = harness.organizer(),
        at = hour();
      const rooms = await provider.resources();
      const room = rooms.find(r => r.name === 'Eken')!;
      expect(room).toMatchObject({ email: 'eken@clew.test', capacity: 6 });
      const first = await answered(provider, await provider.create(harness.uid(), meeting(at, [], room.ref)));
      expect(first.roomResponse).toBe('accepted');
      expect(['Eken', room.email]).toContain(first.room);
      expect(await provider.availability(at(9), at(10), [room])).toEqual([{ ref: room.ref, state: 'busy' }]);
      const second = await answered(provider, await provider.create(harness.uid(), meeting(at, [], room.ref)));
      expect(second.roomResponse).toBe('declined');
      expect(second.room).toBe('');
      for (const event of [first, second])
        await provider.cancel(event.ref, (await provider.lookup(event.ref))!.revision);
      expect(await refused(provider.create(harness.uid(), meeting(at, [], 'okänt-rum')))).toBe(true);
    }, 45000);
    test('a move needs the current revision and keeps the guests', async () => {
      const provider = harness.organizer(),
        at = hour();
      const event = await provider.create(harness.uid(), meeting(at, [harness.guestEmail]));
      expect(await refused(provider.reschedule(event.ref, 'stale', at(13), at(14)))).toBe(true);
      const moved = await provider.reschedule(event.ref, event.revision, at(13), at(14));
      expect(moved).toMatchObject({ ref: event.ref, start: at(13), end: at(14) });
      expect(moved.revision).not.toBe(event.revision);
      expect(moved.participants.map(p => p.email)).toContain(harness.guestEmail);
      expect(await refused(provider.reschedule(event.ref, event.revision, at(15), at(16)))).toBe(true);
      await provider.cancel(event.ref, moved.revision);
    });
    test('a cancel needs the current revision, belongs to the organizer and tolerates a repeat', async () => {
      const provider = harness.organizer(),
        guest = harness.guest(),
        at = hour();
      const event = await provider.create(harness.uid(), meeting(at, [harness.guestEmail]));
      const invitation = (await guest.list(at(0), at(23))).find(e => e.start === at(9))!;
      expect(invitation.canCancel).toBe(false);
      expect(await refused(guest.cancel(invitation.ref, invitation.revision))).toBe(true);
      expect(await refused(provider.cancel(event.ref, 'stale'))).toBe(true);
      await provider.cancel(event.ref, event.revision);
      expect(await provider.lookup(event.ref)).toBeNull();
      await provider.cancel(event.ref, event.revision);
      expect((await guest.list(at(0), at(23))).filter(e => e.start === at(9))).toEqual([]);
    });
    test("a guest's answer reaches the organizer, and nobody reads another person's event", async () => {
      const provider = harness.organizer(),
        guest = harness.guest(),
        at = hour();
      const event = await provider.create(harness.uid(), meeting(at, [harness.guestEmail]));
      const invitation = (await guest.list(at(0), at(23))).find(e => e.start === at(9))!;
      expect(invitation.organizer).toBe(provider.account.email);
      expect(await guest.lookup(event.ref).catch(() => null)).toBeNull();
      const accepted = await guest.accept(invitation.ref, invitation.revision);
      expect(accepted.participants.find(p => p.email === harness.guestEmail)?.response).toBe('accepted');
      const seen = (await provider.lookup(event.ref))!;
      expect(seen.participants.find(p => p.email === harness.guestEmail)?.response).toBe('accepted');
      await provider.cancel(seen.ref, seen.revision);
    });
  });
}
