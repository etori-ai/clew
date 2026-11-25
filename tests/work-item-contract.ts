import { describe, expect, test } from 'bun:test';
import type { WorkItemTx as TalkWorkItemTx } from '../apps/server/src/modules/talks/model';
import type { WorkItemTx as BoardingWorkItemTx } from '../apps/server/src/modules/boarding/model';
import type { DialogueWorkItems } from '../apps/server/src/modules/dialogue/model';
import type { ApprovalWorkItemTx } from '../apps/server/src/modules/competence/model';

/**
 * The owned domains' card ports (D25): the cards talks, boarding and the follow-up dialogue put in an owner's stream
 * with their timers, and competence's approval cards. One suite, two adapters: `tests/unit/work-items.test.ts` runs it
 * on each module's memory card sink, `tests/db/postgres-work-items.test.ts` on composition's card port over a Postgres
 * transaction (`withThreadTx`). The timer fence is what a late or retried workflow meets: a card's timer fires only at
 * its active generation, once, and not before it is due (`dueTimerFires`). What only Postgres has (messages,
 * deliveries, audit rows, workflows) is asserted in the `tests/db/postgres-*-work-items.test.ts` files.
 */
export interface CardTimer {
  generation: number;
  state: string;
  dueAt: string;
}
export interface CardHarness<P> {
  /** A person the cards are for, as provisioning would have written them: their id. */
  person(): Promise<string>;
  /** An id for a new card, unique to this run. */
  cardId(): string;
  /** `fn` on the port in one transaction of the adapter: a throw rolls back everything it wrote. */
  run<T>(fn: (port: P) => Promise<T>): Promise<T>;
  /** The card's state, or undefined when there is no card. */
  card(threadId: string): Promise<string | undefined>;
  /** The card's timer as the thread store keeps it, or undefined when it has none. */
  timer(threadId: string): Promise<CardTimer | undefined>;
}

/** The timer-carrying ports reduced to what every one of them shares. */
interface TimedPort {
  open(threadId: string, personId: string, dueOn: string, at: string): Promise<void>;
  close(threadId: string, at: string): Promise<void>;
  reopen(threadId: string, dueOn: string, at: string): Promise<void>;
  fire(threadId: string, generation: number, at: string): Promise<boolean>;
  remove(threadIds: readonly string[]): Promise<void>;
}

const AT = '2026-03-01T09:00:00.000Z';
const DUE = '2026-03-12';
/** 06:00 Europe/Stockholm on the day after `DUE`, in winter time. */
const MORNING = '2026-03-13T05:00:00.000Z';
const LATER = '2026-04-01';
/** 06:00 Europe/Stockholm on the day after `LATER`, in summer time. */
const LATER_MORNING = '2026-04-02T04:00:00.000Z';

function timedCases<P>(h: () => Promise<CardHarness<P>>, port: (p: P) => TimedPort) {
  const setup = async () => {
    const harness = await h();
    const run = <T>(fn: (p: TimedPort) => Promise<T>) => harness.run(p => fn(port(p)));
    return { ...harness, run, owner: await harness.person() };
  };

  test('open gives the card its timer at the first generation, due 06:00 Stockholm the morning after the due day', async () => {
    const w = await setup();
    const id = w.cardId();
    await w.run(p => p.open(id, w.owner, DUE, AT));
    expect(await w.card(id)).toBe('open');
    expect(await w.timer(id)).toEqual({ generation: 1, state: 'active', dueAt: MORNING });
  });

  test('a second open of the same card is refused and leaves the first as it was', async () => {
    const w = await setup();
    const id = w.cardId();
    await w.run(p => p.open(id, w.owner, DUE, AT));
    await expect(w.run(p => p.open(id, w.owner, LATER, AT))).rejects.toThrow();
    expect(await w.card(id)).toBe('open');
    expect(await w.timer(id)).toEqual({ generation: 1, state: 'active', dueAt: MORNING });
  });

  test('fire answers true only at the active generation once it is due, and only once', async () => {
    const w = await setup();
    const id = w.cardId();
    await w.run(p => p.open(id, w.owner, DUE, AT));
    expect(await w.run(p => p.fire(id, 1, '2026-03-13T04:59:59.999Z'))).toBe(false);
    expect(await w.run(p => p.fire(id, 2, MORNING))).toBe(false);
    expect(await w.timer(id)).toEqual({ generation: 1, state: 'active', dueAt: MORNING });
    expect(await w.run(p => p.fire(id, 1, MORNING))).toBe(true);
    expect(await w.card(id)).toBe('open');
    expect(await w.timer(id)).toMatchObject({ generation: 1, state: 'fired' });
    // A retried workflow finds the timer fired; one for a card that does not exist finds nothing.
    expect(await w.run(p => p.fire(id, 1, '2026-03-14T08:00:00.000Z'))).toBe(false);
    expect(await w.run(p => p.fire(w.cardId(), 1, MORNING))).toBe(false);
  });

  test('close hands the card over and cancels its timer, so its late workflow changes nothing; a missing card is no error', async () => {
    const w = await setup();
    const id = w.cardId();
    await w.run(p => p.open(id, w.owner, DUE, AT));
    await w.run(p => p.close(id, '2026-03-05T10:00:00.000Z'));
    expect(await w.card(id)).toBe('handled');
    expect(await w.timer(id)).toMatchObject({ generation: 1, state: 'cancelled' });
    expect(await w.run(p => p.fire(id, 1, MORNING))).toBe(false);
    expect(await w.card(id)).toBe('handled');
    const missing = w.cardId();
    await w.run(p => p.close(missing, '2026-03-05T10:00:00.000Z'));
    await w.run(p => p.reopen(missing, DUE, '2026-03-05T10:00:00.000Z'));
    expect(await w.card(missing)).toBeUndefined();
    expect(await w.timer(missing)).toBeUndefined();
  });

  test('reopen opens the card with the next generation, due the morning after its day; the old generation is stale', async () => {
    const w = await setup();
    const id = w.cardId();
    await w.run(p => p.open(id, w.owner, DUE, AT));
    await w.run(p => p.close(id, '2026-03-05T10:00:00.000Z'));
    await w.run(p => p.reopen(id, LATER, '2026-03-06T10:00:00.000Z'));
    expect(await w.card(id)).toBe('open');
    expect(await w.timer(id)).toEqual({ generation: 2, state: 'active', dueAt: LATER_MORNING });
    expect(await w.run(p => p.fire(id, 1, LATER_MORNING))).toBe(false);
    expect(await w.run(p => p.fire(id, 2, LATER_MORNING))).toBe(true);
    expect(await w.timer(id)).toMatchObject({ generation: 2, state: 'fired' });
  });

  test('remove takes the card and its timer, and leaves the others; a missing id is no error', async () => {
    const w = await setup();
    const [first, kept] = [w.cardId(), w.cardId()];
    for (const id of [first, kept]) await w.run(p => p.open(id, w.owner, DUE, AT));
    await w.run(p => p.remove([first, w.cardId()]));
    expect(await w.card(first)).toBeUndefined();
    expect(await w.timer(first)).toBeUndefined();
    expect(await w.run(p => p.fire(first, 1, MORNING))).toBe(false);
    expect(await w.card(kept)).toBe('open');
    expect(await w.timer(kept)).toEqual({ generation: 1, state: 'active', dueAt: MORNING });
  });
}

/** Talks' action-point card (D96 item 5): `WorkItemTx` in `modules/talks/model.ts`. */
export function talkWorkItemContract(name: string, h: () => Promise<CardHarness<TalkWorkItemTx>>) {
  const port = (p: TalkWorkItemTx): TimedPort => ({
    open: (threadId, personId, dueOn, at) =>
      p.open({
        threadId,
        personId,
        commitmentId: `commitment-${threadId}`,
        dueOn,
        at,
        subject: { entity: 'person', key: personId },
      }),
    close: (threadId, at) => p.close(threadId, at),
    reopen: (threadId, dueOn, at) => p.reopen(threadId, dueOn, at),
    fire: (threadId, generation, at) => p.fire(threadId, generation, at),
    remove: threadIds => p.remove(threadIds),
  });
  describe(`${name} talks card port`, () => {
    timedCases(h, port);

    test('a due day whose morning has passed gives a timer due at once, opened or opened again', async () => {
      const w = await h();
      const owner = await w.person();
      const late = w.cardId();
      await w.run(p => port(p).open(late, owner, '2026-02-20', AT));
      expect(await w.timer(late)).toEqual({ generation: 1, state: 'active', dueAt: AT });
      const id = w.cardId();
      await w.run(p => port(p).open(id, owner, DUE, AT));
      await w.run(p => p.close(id, '2026-03-05T10:00:00.000Z'));
      const reopenedAt = '2026-03-20T10:00:00.000Z';
      await w.run(p => p.reopen(id, DUE, reopenedAt));
      expect(await w.timer(id)).toEqual({ generation: 2, state: 'active', dueAt: reopenedAt });
      expect(await w.run(p => p.fire(id, 2, reopenedAt))).toBe(true);
    });
  });
}

/** Boarding's item card (D124): `WorkItemTx` in `modules/boarding/model.ts`. */
export function boardingWorkItemContract(name: string, h: () => Promise<CardHarness<BoardingWorkItemTx>>) {
  const port = (p: BoardingWorkItemTx): TimedPort => ({
    open: (threadId, personId, dueOn, at) =>
      p.open({
        threadId,
        personId,
        itemId: `item-${threadId}`,
        planId: `plan-${threadId}`,
        event: 'introduction',
        title: 'Beställ dator',
        dueOn,
        at,
      }),
    close: (threadId, at) => p.close(threadId, at, 'done'),
    reopen: (threadId, dueOn, at) => p.reopen(threadId, dueOn, at),
    fire: (threadId, generation, at) => p.fire(threadId, generation, at),
    remove: threadIds => p.remove(threadIds),
  });
  describe(`${name} boarding card port`, () => {
    timedCases(h, port);

    test('a due day whose next morning has passed gives no timer, opened or opened again', async () => {
      const w = await h();
      const owner = await w.person();
      const late = w.cardId();
      await w.run(p => port(p).open(late, owner, '2026-02-20', AT));
      expect(await w.card(late)).toBe('open');
      expect(await w.timer(late)).toBeUndefined();
      expect(await w.run(p => p.fire(late, 1, AT))).toBe(false);
      // Closed, then opened again once the morning has passed: the old timer stays cancelled, and nothing fires.
      const ahead = w.cardId();
      await w.run(p => port(p).open(ahead, owner, '2026-03-05', AT));
      await w.run(p => p.close(ahead, '2026-03-06T10:00:00.000Z', 'closed'));
      await w.run(p => p.reopen(ahead, '2026-03-05', '2026-03-07T10:00:00.000Z'));
      expect(await w.card(ahead)).toBe('open');
      expect(await w.timer(ahead)).toMatchObject({ generation: 1, state: 'cancelled' });
      expect(await w.run(p => p.fire(ahead, 1, '2026-03-07T10:00:00.000Z'))).toBe(false);
    });
  });
}

/** The follow-up dialogue's activity card (D118 item 4): `DialogueWorkItems` in `modules/dialogue/model.ts`. */
export function dialogueWorkItemContract(name: string, h: () => Promise<CardHarness<DialogueWorkItems>>) {
  const open = (p: DialogueWorkItems, threadId: string, personId: string, dueOn: string | null, at: string) =>
    p.open({
      threadId,
      personId,
      activityId: `activity-${threadId}`,
      dueOn,
      at,
      subject: { entity: 'unit', key: `unit-${personId}` },
    });
  const port = (p: DialogueWorkItems): TimedPort => ({
    open: (threadId, personId, dueOn, at) => open(p, threadId, personId, dueOn, at),
    close: (threadId, at) => p.close(threadId, at),
    reopen: (threadId, dueOn, at) => p.reopen(threadId, dueOn, at),
    fire: (threadId, generation, at) => p.fire(threadId, generation, at),
    remove: threadIds => p.remove(threadIds, 'erasure'),
  });
  describe(`${name} dialogue card port`, () => {
    timedCases(h, port);

    test('an undated card has no timer until retime gives it a date', async () => {
      const w = await h();
      const owner = await w.person();
      const id = w.cardId();
      await w.run(p => open(p, id, owner, null, AT));
      expect(await w.card(id)).toBe('open');
      expect(await w.timer(id)).toBeUndefined();
      expect(await w.run(p => p.fire(id, 1, MORNING))).toBe(false);
      await w.run(p => p.retime(id, DUE, '2026-03-02T09:00:00.000Z'));
      expect(await w.timer(id)).toEqual({ generation: 1, state: 'active', dueAt: MORNING });
      expect(await w.run(p => p.fire(id, 1, MORNING))).toBe(true);
    });

    test('retime moves the timer to the next generation, and taking the date away cancels it', async () => {
      const w = await h();
      const owner = await w.person();
      const id = w.cardId();
      await w.run(p => open(p, id, owner, DUE, AT));
      await w.run(p => p.retime(id, LATER, '2026-03-02T09:00:00.000Z'));
      expect(await w.timer(id)).toEqual({ generation: 2, state: 'active', dueAt: LATER_MORNING });
      expect(await w.run(p => p.fire(id, 1, LATER_MORNING))).toBe(false);
      await w.run(p => p.retime(id, null, '2026-03-03T09:00:00.000Z'));
      expect(await w.timer(id)).toMatchObject({ generation: 2, state: 'cancelled' });
      expect(await w.run(p => p.fire(id, 2, LATER_MORNING))).toBe(false);
      expect(await w.card(id)).toBe('open');
    });

    test('retime leaves a handled card and its timer alone; reopen without a date schedules nothing', async () => {
      const w = await h();
      const owner = await w.person();
      const id = w.cardId();
      await w.run(p => open(p, id, owner, DUE, AT));
      await w.run(p => p.close(id, '2026-03-05T10:00:00.000Z'));
      await w.run(p => p.retime(id, LATER, '2026-03-06T10:00:00.000Z'));
      expect(await w.card(id)).toBe('handled');
      expect(await w.timer(id)).toMatchObject({ generation: 1, state: 'cancelled' });
      await w.run(p => p.reopen(id, null, '2026-03-07T10:00:00.000Z'));
      expect(await w.card(id)).toBe('open');
      expect(await w.timer(id)).toMatchObject({ generation: 1, state: 'cancelled' });
      await w.run(p => p.retime(w.cardId(), DUE, '2026-03-07T10:00:00.000Z'));
    });
  });
}

/** The approval cards of a person's own registration (D108 item 7): `ApprovalWorkItemTx` in `modules/competence/model.ts`. */
export interface ApprovalCardHarness {
  /** A person, as provisioning would have written them: their id. */
  person(): Promise<string>;
  /** An id for a new approval, unique to this run. */
  approvalId(): string;
  /** `fn` on the port in one transaction of the adapter: a throw rolls back everything it wrote. */
  run<T>(fn: (port: ApprovalWorkItemTx) => Promise<T>): Promise<T>;
  /** The manager puts their card of the approval away themselves, as the stream lets them. */
  putAway(approvalId: string, managerId: string, state: 'handled' | 'dismissed'): Promise<void>;
}
export function approvalWorkItemContract(name: string, h: () => Promise<ApprovalCardHarness>) {
  describe(`${name} competence approval card port`, () => {
    async function world() {
      const harness = await h();
      const [registrant, m1, m2, m3] = [
        await harness.person(),
        await harness.person(),
        await harness.person(),
        await harness.person(),
      ];
      // The managers in the order the port sorts them by: `cards` lists by owner.
      const managers = [m1!, m2!, m3!].sort();
      const open = (threadId: string, owners: readonly string[], about = registrant!) =>
        harness.run(p =>
          p.open({
            threadId,
            holdingId: `holding-${threadId}`,
            managers: owners,
            at: AT,
            subject: { entity: 'person', key: about },
          }),
        );
      const cards = (threadId: string) => harness.run(p => p.cards(threadId));
      return { ...harness, registrant: registrant!, m: managers, open, cards };
    }
    const card = (personId: string, open: boolean, setAside = false) => ({ personId, open, setAside });

    test('open makes one open card per manager, a manager named twice once; a second open of the approval is refused', async () => {
      const w = await world();
      const [m1, m2] = w.m;
      const a = w.approvalId();
      await w.open(a, [m2!, m1!, m1!]);
      expect(await w.cards(a)).toEqual([card(m1!, true), card(m2!, true)]);
      await expect(w.open(a, [m1!])).rejects.toThrow();
      expect(await w.cards(a)).toEqual([card(m1!, true), card(m2!, true)]);
      expect(await w.cards(w.approvalId())).toEqual([]);
    });

    test('close puts away the open cards, of the owners named when it names them, set aside only when Clew did it', async () => {
      const w = await world();
      const [m1, m2] = w.m;
      const a = w.approvalId();
      await w.open(a, [m1!, m2!]);
      await w.run(p => p.close(a, '2026-03-02T09:00:00.000Z', 'reassigned', [m1!]));
      expect(await w.cards(a)).toEqual([card(m1!, false, true), card(m2!, true)]);
      // A decision closes the rest; a card already put away stays as it was.
      await w.run(p => p.close(a, '2026-03-03T09:00:00.000Z', 'approved'));
      expect(await w.cards(a)).toEqual([card(m1!, false, true), card(m2!, false)]);
      await w.run(p => p.close(w.approvalId(), '2026-03-03T09:00:00.000Z', 'withdrawn'));
    });

    test('reopen opens again only the cards Clew set aside, of the owners named; one its owner put away stays', async () => {
      const w = await world();
      const [m1, m2, m3] = w.m;
      const a = w.approvalId();
      await w.open(a, [m1!, m2!, m3!]);
      await w.putAway(a, m3!, 'handled');
      await w.run(p => p.close(a, '2026-03-02T09:00:00.000Z', 'paused'));
      expect(await w.cards(a)).toEqual([card(m1!, false, true), card(m2!, false, true), card(m3!, false)]);
      await w.run(p => p.reopen(a, [m1!, m3!], '2026-03-03T09:00:00.000Z'));
      expect(await w.cards(a)).toEqual([card(m1!, true), card(m2!, false, true), card(m3!, false)]);
      // A card a decision closed is not set aside, and is not opened again.
      const b = w.approvalId();
      await w.open(b, [m1!]);
      await w.run(p => p.close(b, '2026-03-02T09:00:00.000Z', 'rejected'));
      await w.run(p => p.reopen(b, [m1!], '2026-03-03T09:00:00.000Z'));
      expect(await w.cards(b)).toEqual([card(m1!, false)]);
    });

    test('remove takes every card of the approvals named and leaves the others', async () => {
      const w = await world();
      const [m1, m2] = w.m;
      const [a, b] = [w.approvalId(), w.approvalId()];
      await w.open(a, [m1!, m2!]);
      await w.open(b, [m1!]);
      await w.run(p => p.remove([a, w.approvalId()]));
      expect(await w.cards(a)).toEqual([]);
      expect(await w.cards(b)).toEqual([card(m1!, true)]);
      await w.run(p => p.remove([]));
    });

    test('removeAbout takes every approval card about the person, whatever its state, and none about anyone else', async () => {
      const w = await world();
      const [m1, m2] = w.m;
      const other = await w.person();
      const [a, b, c] = [w.approvalId(), w.approvalId(), w.approvalId()];
      await w.open(a, [m1!, m2!]);
      await w.open(b, [m1!]);
      await w.run(p => p.close(b, '2026-03-02T09:00:00.000Z', 'withdrawn'));
      await w.open(c, [m1!], other);
      await w.run(p => p.removeAbout({ entity: 'person', key: w.registrant }));
      expect(await w.cards(a)).toEqual([]);
      expect(await w.cards(b)).toEqual([]);
      expect(await w.cards(c)).toEqual([card(m1!, true)]);
    });

    test('removeOwned takes the manager’s cards and leaves the other managers’ cards of the same approval', async () => {
      const w = await world();
      const [m1, m2] = w.m;
      const [a, b] = [w.approvalId(), w.approvalId()];
      await w.open(a, [m1!, m2!]);
      await w.open(b, [m1!]);
      await w.run(p => p.removeOwned(m1!));
      expect(await w.cards(a)).toEqual([card(m2!, true)]);
      expect(await w.cards(b)).toEqual([]);
    });
  });
}
