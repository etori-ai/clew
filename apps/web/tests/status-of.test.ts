import { describe, expect, test } from 'bun:test';
import { SUBJECT_CHANGED, type ExecutionSummary, type Receipt, type Thread } from '@clew/contracts';
import { executionKind, executionStatus } from '../src/execution-status';
import { nothingToDecide, receiptRowsInOrder, statusOf, summaryNotice, type StatusContext } from '../src/status-of';

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

describe('a to-do with nothing to decide says what holds in a notice, in the source’s words', () => {
  const read = { id: 'open', label: 'Visa mina kompetenser', capability: 'competence.holdings', kind: 'read' } as const;
  const expired = (values: Partial<Thread> = {}) =>
    thread({
      title: 'Delegering läkemedel gick ut 8 oktober',
      trigger: { reason: 'Har gått ut', source: 'Kompetens', at: NOW },
      summary:
        'Intyget gäller inte längre. Prata med din chef om att förnya det. Ärendet avslutas av sig självt när ett giltigt intyg är registrerat.',
      deadline: '2026-10-08',
      actions: [{ ...read, role: 'primary' }],
      ...values,
    });
  test('every action is a read: the summary’s first sentence is the title, the rest the description, and no move', () => {
    const s = statusOf(expired(), ctx());
    expect(s).toMatchObject({ kind: 'needs-you', noDecision: true, rest: [], review: false });
    expect(s.notice).toEqual({
      title: 'Intyget gäller inte längre',
      description:
        'Prata med din chef om att förnya det. Ärendet avslutas av sig självt när ett giltigt intyg är registrerat.',
    });
    // The row says the source's reason where another item says when its answer is due: no answer is late here.
    expect(s.detail).toBe('har gått ut');
    const long = 'Intyget gick ut för mer än en månad sedan';
    expect(
      statusOf(expired({ trigger: { reason: long, source: 'Kompetens', at: NOW } }), ctx()).detail,
    ).toBeUndefined();
    // With a decision to make the row says the day as before.
    const approve = { id: 'a', label: 'Förnya', capability: 'x.renew', kind: 'execute', role: 'primary' } as const;
    expect(statusOf(expired({ actions: [approve] }), ctx()).detail).toBe('försenad');
  });
  test('several reads are still nothing to decide; one sentence is a title alone; no summary is no notice', () => {
    const more = { ...read, id: 'more', label: 'Visa kraven', role: 'secondary' } as const;
    const two = statusOf(
      expired({ actions: [{ ...read, role: 'primary' }, more], summary: 'Kravet gäller alla.' }),
      ctx(),
    );
    expect(two).toMatchObject({ noDecision: true, notice: { title: 'Kravet gäller alla' } });
    expect(two.notice?.description).toBeUndefined();
    expect(statusOf(expired({ summary: ' ' }), ctx())).toMatchObject({ noDecision: true, notice: null });
  });
  test('a decision to make, a proposal, or no action at all is a plain to-do as before', () => {
    const approve = {
      id: 'a',
      label: 'Attestera',
      capability: 'finance.approve',
      kind: 'execute',
      role: 'primary',
    } as const;
    const propose = {
      id: 'p',
      label: 'Föreslå tid',
      capability: 'calendar.propose',
      kind: 'propose',
      role: 'primary',
    } as const;
    for (const actions of [[approve, { ...read, role: 'secondary' as const }], [propose], []])
      expect(statusOf(expired({ actions }), ctx())).toMatchObject({ noDecision: false, notice: null });
    const proposals = [{ id: 'p1' }] as unknown as Thread['proposals'];
    expect(statusOf(expired({ proposals }), ctx())).toMatchObject({ noDecision: false, notice: null });
  });
  test('waiting, set aside, decided or closed, it is not: the state’s own notice stands', () => {
    const cases: Partial<Thread>[] = [
      { waitingOn: 'din chef' },
      { snoozedUntil: '2026-11-17T05:00:00.000Z' },
      { receipt: receipt(['done']) },
      { execution: execution('pending') },
      { state: 'handled', handledAt: NOW },
      { state: 'dismissed', handledAt: NOW },
    ];
    for (const values of cases) {
      expect(nothingToDecide(expired(values), NOW)).toBe(false);
      expect(statusOf(expired(values), ctx()).noDecision).toBe(false);
    }
    expect(statusOf(expired({ waitingOn: 'din chef' }), ctx()).notice?.title).toBe('Väntar på din chef');
    // A time to come back that has passed is awake, as everywhere else.
    expect(nothingToDecide(expired({ snoozedUntil: '2026-11-16T05:00:00.000Z' }), NOW)).toBe(true);
  });
  const OFFER = { label: 'Jag har bett min chef', waitingOn: 'din chef' };
  test('the source’s offer to say the next step is taken (D139): the filled button here, a row under ⋯ on a to-do with a decision', () => {
    const s = statusOf(expired({ handOn: OFFER }), ctx());
    expect(s).toMatchObject({ noDecision: true, handOn: 'Jag har bett min chef', rest: [] });
    expect(s.notice?.move).toBeUndefined();
    const approve = { id: 'a', label: 'Förnya', capability: 'x.renew', kind: 'execute', role: 'primary' } as const;
    const decide = statusOf(expired({ handOn: OFFER, actions: [approve] }), ctx());
    expect(decide).toMatchObject({ noDecision: false, notice: null, handOn: 'Jag har bett min chef' });
    expect(decide.rest).toEqual([{ kind: 'hand-on', label: 'Jag har bett min chef', offer: false }]);
    // Without the offer there is none, and once decided or waiting it cannot be said.
    expect(statusOf(expired(), ctx()).handOn).toBeUndefined();
    for (const values of [
      { waitingOn: 'din chef' },
      { receipt: receipt(['done']) },
      { execution: execution('pending') },
    ])
      expect(statusOf(expired({ handOn: OFFER, ...values }), ctx()).handOn).toBeUndefined();
  });
  test('once said, the item waits on whom the source named: when the person said it, Påminn mig, and the way back under ⋯', () => {
    const handedOn = { to: 'din chef', at: '2026-11-16T07:40:00.000Z' };
    const s = statusOf(expired({ handOn: OFFER, waitingOn: 'din chef', handedOn }), ctx());
    expect(s).toMatchObject({ kind: 'waiting', noDecision: false });
    expect(s.notice).toEqual({
      title: 'Väntar på din chef',
      description: 'Du sa ”Jag har bett min chef” när 07:40.',
      move: { kind: 'remind', label: 'Påminn mig', offer: true },
    });
    expect(s.rest).toEqual([{ kind: 'hand-back', label: 'Det blev inte gjort', offer: true }]);
    // With the person's own reminder, both are said; an offer the source has taken away leaves plain words.
    const timers: Thread['timers'] = [{ kind: 'reminder', dueAt: '2026-11-17T09:00:00.000Z', state: 'scheduled' }];
    expect(
      statusOf(expired({ handOn: OFFER, waitingOn: 'din chef', handedOn, timers }), ctx()).notice?.description,
    ).toMatch(/^Du sa ”Jag har bett min chef” när 07:40\. Påminner dig /);
    expect(statusOf(expired({ waitingOn: 'din chef', handedOn }), ctx()).notice?.description).toBe(
      'Du lämnade ärendet vidare när 07:40.',
    );
    // An item that waits because its source says so has no way back of the person's.
    expect(statusOf(expired({ waitingOn: 'din chef' }), ctx()).rest).toEqual([]);
  });
  test('a sentence ends before a capital letter, so an abbreviation or a time does not end one', () => {
    expect(summaryNotice('Ansökan kom kl. 16.40 i går. Läs den i personalsystemet.')).toEqual({
      title: 'Ansökan kom kl. 16.40 i går',
      description: 'Läs den i personalsystemet.',
    });
    expect(summaryNotice('Två rader\n\n  väntar!  Se listan.')).toEqual({
      title: 'Två rader väntar!',
      description: 'Se listan.',
    });
    expect(summaryNotice('')).toBeNull();
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
    expect(statusOf(thread({ execution: execution('unknown') }), ctx()).notice?.title).toBe(
      'Utfallet är inte bekräftat',
    );
  });
  test('an undo in doubt: the original receipt is kept', () => {
    const s = statusOf(thread({ execution: execution('unknown', null, 'e0') }), ctx());
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
  test('failed: nothing more is sent until the person has read why', () => {
    const s = statusOf(thread({ execution: execution('failed') }), ctx());
    expect(s.kind).toBe('failed');
    expect(s.notice).toEqual({
      title: 'Beslutet gick inte igenom',
      description: 'Kontrollera beskedet innan du fattar ett nytt beslut.',
    });
    // Another reason a decision waits on is checked.
    expect(statusOf(thread({ execution: execution('failed', 'other') }), ctx()).notice?.move?.kind).toBe('check');
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
