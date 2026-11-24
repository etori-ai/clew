import { describe, expect, test } from 'bun:test';
import { RELEASED_BY_PERSON, SUBJECT_CHANGED, type ExecutionSummary, type Receipt, type Thread } from '@clew/contracts';
import { executionKind, executionStatus } from '../src/execution-status';
import { receiptRowsInOrder, statusOf, type StatusContext } from '../src/status-of';

/**
 * One status vocabulary (D126 item 13): what the app already knows about a work item, as one of eight states with a
 * word for its row and, unless it is a plain to-do, a notice under its title with at most one move. Every case the item
 * said before (D45, D47, D116, D122) is still said, in the notice's shape: the title what, the description why.
 */
const NOW = '2026-11-16T08:20:00.000Z';
const TODAY = '2026-11-16';
const ctx = (over: Partial<StatusContext> = {}): StatusContext => ({
  now: NOW,
  today: TODAY,
  when: instant => `när ${instant.slice(11, 16)}`,
  ...over,
});
const thread = (values: Partial<Thread> = {}): Thread => ({
  id: 'fakturor',
  title: 'Attestera 3 fakturor',
  kind: 'pushed',
  topic: 'fakturor',
  state: 'open',
  trigger: { reason: 'Fakturorna förfaller i veckan.', source: 'Ekonomisystemet', at: NOW },
  createdAt: NOW,
  updatedAt: NOW,
  handledAt: null,
  messages: [],
  proposals: [],
  week: null,
  connector: 'finance',
  area: 'budget',
  summary: '',
  items: [],
  actions: [{ id: 'approve', label: 'Attestera', capability: 'finance.approve', kind: 'execute', role: 'primary' }],
  waitingOn: null,
  deadline: null,
  receipt: null,
  remindedAt: null,
  snoozedUntil: null,
  ...values,
});
const execution = (
  state: ExecutionSummary['state'],
  reason: string | null = null,
  compensates: string | null = null,
): ExecutionSummary => ({ id: 'e1', decisionId: 'd1', operation: 'finance.approve', state, reason, compensates });
const receipt = (outcomes: Receipt['rows'][number]['outcome'][], over: Partial<Receipt> = {}): Receipt => ({
  at: '2026-11-16T08:13:00.000Z',
  headline: 'Tre fakturor attesterade.',
  undoUntil: null,
  undoCapability: null,
  rows: outcomes.map((outcome, i) => ({ ref: `r${i}`, label: `Faktura ${i + 1}`, outcome, detail: '' })),
  ...over,
});

describe('a plain to-do has no notice: its title and its buttons say what is expected', () => {
  test('needs the person, with when it is due as the row says it', () => {
    const s = statusOf(thread({ deadline: '2026-11-12' }), ctx());
    expect(s).toMatchObject({ kind: 'needs-you', detail: 'försenad', notice: null, rest: [], review: false });
    expect(statusOf(thread({ deadline: TODAY }), ctx()).detail).toBe('i dag');
    expect(statusOf(thread({ deadline: '2026-12-01' }), ctx()).detail).toBe('vecka 49');
  });
  test('a stopped reminder is said on the row', () => {
    const timers: Thread['timers'] = [{ kind: 'reminder', dueAt: NOW, state: 'blocked' }];
    expect(statusOf(thread({ timers }), ctx()).detail).toBe('påminnelsen stoppad');
  });
});

describe('a decision the source has not confirmed (D45, D47)', () => {
  test('pending: on its way, Kontrollera status offered, and the person may leave', () => {
    const s = statusOf(thread({ execution: execution('pending') }), ctx());
    expect(s.kind).toBe('sending');
    expect(s.notice).toEqual({
      title: 'Skickar ditt beslut till Ekonomisystemet',
      description: 'Beslutet är sparat och väntar på källan. Du kan lämna sidan.',
      move: { kind: 'check', label: 'Kontrollera status', offer: true },
    });
  });
  test('running: waits for the source’s confirmation', () => {
    const s = statusOf(thread({ execution: execution('running') }), ctx());
    expect(s.kind).toBe('sending');
    expect(s.notice?.description).toBe('Väntar på källans bekräftelse.');
  });
  test('pending while its system does not answer: queued and read back when it does (D116)', () => {
    const s = statusOf(
      thread({ execution: execution('pending') }),
      ctx({ silent: 'Ekonomisystemet svarar inte sedan 07:50' }),
    );
    expect(s.kind).toBe('sending');
    expect(s.notice).toMatchObject({
      title: 'Ditt beslut är sparat',
      description:
        'Ekonomisystemet svarar inte sedan 07:50. Det du skickar köas och läses tillbaka när systemet svarar.',
    });
  });
  test('unknown: unconfirmed, which rows, and Kontrollera status as the person’s move', () => {
    const s = statusOf(
      thread({ execution: execution('unknown'), receipt: receipt(['unknown', 'done', 'done']) }),
      ctx(),
    );
    expect(s).toMatchObject({ kind: 'unconfirmed', detail: '1 av 3' });
    expect(s.notice).toEqual({
      title: 'Faktura 1 är inte bekräftad',
      description:
        'Ekonomisystemet gav inget säkert besked när 08:13. Kontrollera om det gick igenom innan du gör något mer.',
      move: { kind: 'check', label: 'Kontrollera status', offer: false },
    });
    // Under ⋯, the person may let it go once they have seen the source (DE-M2).
    expect(s.rest).toEqual([{ kind: 'release', label: 'Markera som inte genomfört', offer: true }]);
    expect(statusOf(thread({ execution: execution('unknown') }), ctx()).notice?.title).toBe(
      'Utfallet är inte bekräftat',
    );
  });
  test('a decision let go by the person: said so, and the item’s own decision is the move (DE-M1, DE-M2)', () => {
    const s = statusOf(thread({ execution: execution('failed', RELEASED_BY_PERSON) }), ctx());
    expect(s.kind).toBe('failed');
    expect(s.notice).toEqual({
      title: 'Markerat som inte genomfört',
      description: 'Clew väntar inte längre på besked från Ekonomisystemet. Fatta beslutet igen om det behövs.',
      move: { kind: 'decide', label: 'Attestera', offer: false },
    });
    expect(s.rest).toEqual([]);
    expect(executionStatus(execution('failed', RELEASED_BY_PERSON))).toBe(
      'Beslutet är markerat som inte genomfört. Fatta det igen om det behövs.',
    );
  });
  test('an undo in doubt: the original receipt is kept', () => {
    const s = statusOf(thread({ execution: execution('unknown', null, 'e0') }), ctx());
    // Not let go: the decision it would undo stands whatever became of it.
    expect(s.rest).toEqual([]);
    expect(s.kind).toBe('unconfirmed');
    expect(s.notice).toMatchObject({
      title: 'Det är oklart om beslutet har ångrats',
      description: 'Ekonomisystemet har inte gett något säkert besked. Det ursprungliga kvittot finns kvar.',
      move: { kind: 'check' },
    });
  });
  test('an undo on its way', () => {
    const s = statusOf(thread({ execution: execution('pending', null, 'e0') }), ctx());
    expect(s.kind).toBe('sending');
    expect(s.notice).toMatchObject({
      title: 'Din begäran att ångra är sparad',
      description: 'Den väntar på Ekonomisystemet.',
    });
  });
  for (const [reason, description] of [
    ['needs-session', 'Ekonomisystemet kräver en aktiv inloggning. Åtgärden väntar.'],
    ['authority-revoked', 'Behörigheten har ändrats. Åtgärden väntar på kontroll.'],
    ['source-contract-changed', 'Källans villkor har ändrats. Åtgärden väntar på kontroll.'],
  ] as const)
    test(`${reason}: blocked until it is checked`, () => {
      const s = statusOf(thread({ execution: execution('pending', reason) }), ctx({ silent: 'X svarar inte' }));
      expect(s.kind).toBe('blocked');
      expect(s.notice).toEqual({
        title: 'Kan inte skickas än',
        description,
        move: { kind: 'check', label: 'Kontrollera status', offer: false },
      });
    });
  test('partial: what went through, which row needs the person, the review as the move and Ångra under ⋯', () => {
    const s = statusOf(
      thread({
        execution: execution('partial'),
        receipt: receipt(['done', 'done', 'failed'], {
          headline: 'Två av tre fakturor attesterade.',
          undoUntil: '2026-11-16T08:30:00.000Z',
          undoCapability: 'finance.unapprove',
        }),
      }),
      ctx({ reviewed: true, undoMinutes: 9 }),
    );
    expect(s).toMatchObject({ kind: 'partial', detail: '2 av 3', review: false });
    expect(s.notice).toEqual({
      title: 'Två av tre fakturor attesterade',
      description: 'Faktura 3 behöver din bedömning.',
      move: { kind: 'review', label: 'Visa granskning', offer: false },
    });
    expect(s.rest).toEqual([{ kind: 'undo', label: 'Ångra bekräftade · 9 min kvar', offer: true }]);
  });
  test('partial without a review: the item’s own decision again, on the rows that remain (DE-M1)', () => {
    const s = statusOf(
      thread({
        execution: execution('partial'),
        receipt: receipt(['done', 'failed'], {
          undoUntil: '2026-11-16T08:30:00.000Z',
          undoCapability: 'finance.unapprove',
        }),
      }),
      ctx({ undoMinutes: 9 }),
    );
    expect(s.notice?.move).toEqual({ kind: 'decide', label: 'Attestera', offer: false });
    expect(s.rest).toEqual([{ kind: 'undo', label: 'Ångra bekräftade · 9 min kvar', offer: true }]);
  });
  test('failed: the person reads why and decides again, as a new decision (DE-M1)', () => {
    const s = statusOf(thread({ execution: execution('failed') }), ctx());
    expect(s.kind).toBe('failed');
    expect(s.notice).toEqual({
      title: 'Beslutet gick inte igenom',
      description: 'Kontrollera beskedet innan du fattar ett nytt beslut.',
      move: { kind: 'decide', label: 'Attestera', offer: false },
    });
    // A settled refusal has nothing to check, whatever its reason.
    expect(statusOf(thread({ execution: execution('failed', 'other') }), ctx()).notice?.move?.kind).toBe('decide');
    // A reviewed decision is seen again on its review's page (D80).
    expect(statusOf(thread({ execution: execution('failed') }), ctx({ reviewed: true })).notice?.move?.kind).toBe(
      'review',
    );
    // An undo that was refused leaves the decision it would undo standing: nothing to decide again.
    expect(statusOf(thread({ execution: execution('failed', null, 'e0') }), ctx()).notice?.move).toBeUndefined();
    // Nor is a handled item decided again.
    expect(statusOf(thread({ state: 'handled', execution: execution('failed') }), ctx()).notice?.move).toBeUndefined();
  });
});

describe('a started action whose user name moved (D122)', () => {
  test('refused before it was sent: nothing went, and the item’s own decision is the move', () => {
    const s = statusOf(thread({ execution: execution('failed', SUBJECT_CHANGED) }), ctx());
    expect(s.kind).toBe('failed');
    expect(s.notice).toEqual({
      title: 'Inget skickades',
      description: 'Personen har inte längre det användarnamn som beslutet gällde. Fatta beslutet igen.',
      move: { kind: 'decide', label: 'Attestera', offer: false },
    });
  });
  test('refused after an attempt whose answer is missing: not sent again, checked at the source', () => {
    const s = statusOf(thread({ execution: execution('unknown', SUBJECT_CHANGED) }), ctx());
    expect(s.kind).toBe('unconfirmed');
    expect(s.notice).toEqual({
      title: 'Beslutet skickas inte igen',
      description:
        'Personen har inte längre det användarnamn som beslutet gällde. Utfallet behöver kontrolleras i källsystemet.',
      move: { kind: 'check', label: 'Kontrollera status', offer: false },
    });
  });
});

describe('every execution state has a kind, and the one-line sentence stays for the places that say it in a line', () => {
  test('the kinds', () => {
    expect(executionKind(null)).toBeNull();
    expect(executionKind(execution('succeeded'))).toBeNull();
    expect(executionKind(execution('pending'))).toBe('sending');
    expect(executionKind(execution('running'))).toBe('sending');
    expect(executionKind(execution('unknown'))).toBe('unconfirmed');
    expect(executionKind(execution('partial'))).toBe('partial');
    expect(executionKind(execution('failed'))).toBe('failed');
    expect(executionKind(execution('unknown', 'needs-session'))).toBe('blocked');
    expect(executionKind(execution('failed', SUBJECT_CHANGED))).toBe('failed');
    expect(executionKind(execution('unknown', SUBJECT_CHANGED))).toBe('unconfirmed');
  });
  test('the sentence', () => {
    expect(executionStatus(execution('pending'))).toBe('Ditt beslut är sparat och väntar på källan.');
  });
});

describe('after the source read the decision back (D70)', () => {
  const answered = (over: Partial<Receipt> = {}) =>
    receipt(['done', 'done'], {
      headline: 'Två fakturor attesterade.',
      undoUntil: '2026-11-16T08:30:00.000Z',
      undoCapability: 'finance.unapprove',
      ...over,
    });
  test('done, with Ångra offered while the window is open', () => {
    const s = statusOf(
      thread({
        state: 'handled',
        handledAt: '2026-11-16T08:13:00.000Z',
        execution: execution('succeeded'),
        receipt: answered(),
      }),
      ctx({ undoMinutes: 9, reviewed: true }),
    );
    expect(s).toMatchObject({ kind: 'done', detail: 'när 08:13', review: true });
    expect(s.notice).toEqual({
      title: 'Två fakturor attesterade',
      description: 'Bekräftat av Ekonomisystemet när 08:13.',
      move: { kind: 'undo', label: 'Ångra · 9 min kvar', offer: true },
    });
  });
  test('done, without Ångra once the window has closed', () => {
    const s = statusOf(
      thread({ state: 'handled', execution: execution('succeeded'), receipt: answered() }),
      ctx({ undoMinutes: null }),
    );
    expect(s.notice?.move).toBeUndefined();
  });
  test('a row in doubt: unconfirmed, and no Ångra until the source answers', () => {
    const s = statusOf(
      thread({ state: 'handled', receipt: receipt(['done', 'unknown'], { headline: '2 fakturor attesterade.' }) }),
      ctx({ undoMinutes: 9 }),
    );
    expect(s).toMatchObject({ kind: 'unconfirmed', detail: '1 av 2' });
    expect(s.notice).toEqual({
      title: 'Faktura 2 är inte bekräftad',
      description: '2 fakturor attesterade, men Ekonomisystemet gav inget säkert besked när 08:13.',
    });
  });
  test('a refused row: failed', () => {
    const s = statusOf(thread({ state: 'handled', receipt: receipt(['done', 'failed']) }), ctx());
    expect(s.kind).toBe('failed');
    expect(s.notice?.title).toBe('Tre fakturor attesterade');
  });
  test('waiting on someone after it: whom and what was done, Ångra first and Påminn mig under ⋯', () => {
    const s = statusOf(
      thread({
        waitingOn: 'Anna Lindqvist',
        execution: execution('succeeded'),
        receipt: answered({ headline: 'Inbjudan skickad.' }),
      }),
      ctx({ undoMinutes: 4 }),
    );
    expect(s.kind).toBe('waiting');
    expect(s.notice).toEqual({
      title: 'Väntar på Anna Lindqvist',
      description: 'Inbjudan skickad när 08:13.',
      move: { kind: 'undo', label: 'Ångra · 4 min kvar', offer: true },
    });
    expect(s.rest).toEqual([{ kind: 'remind', label: 'Påminn mig', offer: true }]);
  });
  test('the person’s own again: a plain to-do, Ångra under ⋯ while it can', () => {
    const s = statusOf(thread({ execution: execution('succeeded'), receipt: answered() }), ctx({ undoMinutes: 2 }));
    expect(s).toMatchObject({ kind: 'needs-you', notice: null });
    expect(s.rest).toEqual([{ kind: 'undo', label: 'Ångra · 2 min kvar', offer: true }]);
  });
  test('the rows that are not settled come first', () => {
    expect(receiptRowsInOrder(receipt(['done', 'skipped', 'failed', 'unknown']).rows).map(r => r.outcome)).toEqual([
      'unknown',
      'failed',
      'done',
      'skipped',
    ]);
  });
});

describe('waiting, set aside, handled, dismissed', () => {
  test('waiting on someone: Påminn mig offered, with when the person’s reminder is', () => {
    const s = statusOf(
      thread({
        waitingOn: 'skyddsombudet',
        timers: [{ kind: 'reminder', dueAt: '2026-11-17T09:00:00.000Z', state: 'scheduled' }],
      }),
      ctx(),
    );
    expect(s.kind).toBe('waiting');
    expect(s.notice?.title).toBe('Väntar på skyddsombudet');
    expect(s.notice?.description).toMatch(/^Påminner dig /);
    expect(s.notice?.move).toEqual({ kind: 'remind', label: 'Påminn mig', offer: true });
  });
  test('set aside: it comes back by itself, and Ta upp nu is the offer', () => {
    const s = statusOf(thread({ snoozedUntil: '2026-11-17T05:00:00.000Z' }), ctx());
    expect(s).toMatchObject({ kind: 'waiting', detail: 'inte nu' });
    expect(s.notice?.title).toMatch(/^Lagt åt sidan till /);
    expect(s.notice?.move).toEqual({ kind: 'take-up', label: 'Ta upp nu', offer: true });
  });
  test('handled', () => {
    const s = statusOf(thread({ state: 'handled', handledAt: '2026-11-16T08:00:00.000Z' }), ctx());
    expect(s).toMatchObject({ kind: 'done', detail: 'när 08:00' });
    expect(s.notice).toEqual({ title: 'Ärendet är klart', description: 'Avslutat när 08:00.' });
  });
  test('dismissed, with Återöppna while the server allows it', () => {
    const s = statusOf(
      thread({ state: 'dismissed', handledAt: '2026-11-16T08:00:00.000Z' }),
      ctx({ reopenable: true }),
    );
    expect(s).toMatchObject({ kind: 'done', detail: 'avfärdat' });
    expect(s.notice).toEqual({
      title: 'Avfärdat som inte aktuellt',
      description: 'När 08:00. Ekonomisystemet skapar inte ärendet igen.',
      move: { kind: 'reopen', label: 'Återöppna', offer: true },
    });
    expect(statusOf(thread({ state: 'dismissed' }), ctx()).notice?.move).toBeUndefined();
  });
});
