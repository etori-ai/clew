import { describe, expect, test } from 'bun:test';
import type { Chip, Thread } from '@clew/contracts';
import { conversationFor, listSubject, pageSubject, sourceReads } from '../src/components/page-conversation';

type Message = Thread['messages'][number];
const asked = (chips: Chip[], id = 'q'): Message => ({
  id,
  role: 'user',
  body: 'Vad står på agendan?',
  createdAt: '2026-11-18T09:00:00.000Z',
  meta: { chips },
});
const answer: Message = { id: 'a', role: 'assistant', body: 'Tio personer.', createdAt: '2026-11-18T09:00:01.000Z' };
const thread = (
  id: string,
  updatedAt: string,
  messages: Message[],
  kind: Thread['kind'] = 'question',
  askedBeside?: Thread['askedBeside'],
): Thread =>
  ({ id, kind, title: id, updatedAt, messages, ...(askedBeside ? { askedBeside } : {}) }) as unknown as Thread;
const beside = (subject: string, openedAt: string | null = null): Thread['askedBeside'] => ({
  subject,
  label: 'Om Beställningar och felanmälningar',
  openedAt,
});

const meeting: Chip = { ref: 'event:v1', kind: 'event', label: 'Morgonmöte ledningsgrupp' };
const week45: Chip = { ref: 'capability:calendar.week', kind: 'capability', label: 'Vecka 45' };
const week46: Chip = { ref: 'capability:calendar.week', kind: 'capability', label: 'Vecka 46' };

describe('the conversation beside a page is the person’s newest about its subject (D130 rule 6)', () => {
  test('a question asked with the subject’s chip makes the conversation about it, and the newest one wins', () => {
    const older = thread('om-1', '2026-11-17T10:00:00.000Z', [asked([meeting]), answer]);
    const newer = thread('om-2', '2026-11-18T10:00:00.000Z', [asked([meeting]), answer]);
    expect(conversationFor([older, newer], { key: 'event:v1', chips: [meeting] })?.id).toBe('om-2');
    expect(conversationFor([newer, older], { key: 'event:v1', chips: [meeting] })?.id).toBe('om-2');
  });
  test('a later question with the chip counts as much as the first; an answer naming it does not', () => {
    const later = thread('om-3', '2026-11-18T10:00:00.000Z', [asked([]), answer, asked([meeting], 'q2')]);
    expect(conversationFor([later], { key: 'event:v1', chips: [meeting] })?.id).toBe('om-3');
    const answered = thread('om-4', '2026-11-18T10:00:00.000Z', [
      asked([]),
      { ...answer, meta: { key: 'event:v1', chips: [meeting] } } as Message,
    ]);
    expect(conversationFor([answered], { key: 'event:v1', chips: [meeting] })).toBeNull();
  });
  test('only conversations count, not a work item that carries the chip', () => {
    const item = thread('item-1', '2026-11-18T10:00:00.000Z', [asked([meeting])], 'pushed');
    expect(conversationFor([item], { key: 'event:v1', chips: [meeting] })).toBeNull();
  });
  test('a range read is told apart by the week or day it was asked about, its label', () => {
    const w45 = thread('om-w45', '2026-11-17T10:00:00.000Z', [asked([week45]), answer]);
    const w46 = thread('om-w46', '2026-11-18T10:00:00.000Z', [asked([week46]), answer]);
    expect(conversationFor([w45, w46], { key: 'range:week:2026-11-02', chips: [week45] })?.id).toBe('om-w45');
    expect(conversationFor([w45, w46], { key: 'range:week:2026-11-09', chips: [week46] })?.id).toBe('om-w46');
  });
  test('a subject without a chip, or with no conversation about it yet, has none', () => {
    const other = thread('om-x', '2026-11-18T10:00:00.000Z', [asked([{ ...meeting, ref: 'event:v2' }]), answer]);
    expect(conversationFor([other], { key: 'event:v1', chips: [meeting] })).toBeNull();
    expect(conversationFor([other], { key: 'event:v1', chips: [] })).toBeNull();
    expect(conversationFor([], { key: 'event:v1', chips: [meeting] })).toBeNull();
  });
});

describe('the subject a conversation was asked beside finds it on any device (D130 rule 6)', () => {
  const requests: Chip = { ref: 'capability:clew.requests', kind: 'capability', label: 'Beställningar' };
  const subject = { key: 'view:clew.requests', chips: [requests] };
  test('the subject kept on the conversation finds it, without the chip on any question', () => {
    const kept = thread('om-a', '2026-11-18T10:00:00.000Z', [asked([]), answer], 'question', beside(subject.key));
    expect(conversationFor([kept], subject)?.id).toBe('om-a');
  });
  test('it comes before a newer conversation that is only found by its chip, and the newest of them wins', () => {
    const older = thread('om-b', '2026-11-16T10:00:00.000Z', [asked([]), answer], 'question', beside(subject.key));
    const newer = thread('om-c', '2026-11-17T10:00:00.000Z', [asked([]), answer], 'question', beside(subject.key));
    const chipped = thread('om-d', '2026-11-18T10:00:00.000Z', [asked([requests]), answer]);
    expect(conversationFor([older, chipped, newer], subject)?.id).toBe('om-c');
  });
  test('a conversation asked before the subject was kept is still found by its chip', () => {
    const before = thread('om-e', '2026-11-18T10:00:00.000Z', [asked([requests]), answer]);
    expect(conversationFor([before], subject)?.id).toBe('om-e');
  });
  test('another subject’s conversation is not this one’s, whether opened or not', () => {
    const other = thread('om-f', '2026-11-18T10:00:00.000Z', [asked([]), answer], 'question', beside('view:hr.staff'));
    const opened = thread(
      'om-g',
      '2026-11-18T10:00:00.000Z',
      [asked([]), answer],
      'question',
      beside('view:hr.staff', '2026-11-18T11:00:00.000Z'),
    );
    expect(conversationFor([other, opened], subject)).toBeNull();
  });
});

describe('a list’s subject in the words of the pane (D130 rules 4 and 10)', () => {
  const read = {
    key: 'view:clew.requests',
    label: 'beställningar och felanmälningar',
    chips: [
      { ref: 'capability:clew.requests', kind: 'capability' as const, label: 'Beställningar och felanmälningar' },
    ],
    search: '',
  };
  test('what the pane is about keeps the title; the box asks with its first letter lowered', () => {
    const subject = listSubject(read, 'Beställningar och felanmälningar');
    expect(subject.about).toBe('Om Beställningar och felanmälningar');
    expect(subject.placeholder).toBe('Fråga om beställningar och felanmälningar');
    expect(subject.label).toBe('beställningar och felanmälningar');
    expect(subject.key).toBe('view:clew.requests');
    expect(subject.chips).toEqual(read.chips);
  });
  test('a name in the title and a word in capitals read as written', () => {
    expect(listSubject(read, 'Kompetenser för Anna Lindqvist').placeholder).toBe(
      'Fråga om kompetenser för Anna Lindqvist',
    );
    expect(listSubject(read, 'IT-ärenden').placeholder).toBe('Fråga om IT-ärenden');
  });
});

describe('a page’s subject goes with the reads the assistant may make, and says which it may not (D130 rule 4)', () => {
  const views = [
    { capability: 'people.reports', title: 'Mina medarbetare', assistant: true as const },
    { capability: 'talks.talks', title: 'Utvecklingssamtal', assistant: true as const },
    { capability: 'hr.presenceAll', title: 'Frånvaro' },
    { capability: 'qlik.sickLeave', title: 'Sjukfrånvaro' },
  ];
  const still = 'Du kan ändå fråga om annat som du har tillgång till.';
  test('every read the assistant may make is a capability chip, once, named by the page or by the read’s own title', () => {
    const subject = pageSubject({
      key: 'staff',
      title: 'Medarbetare',
      reads: [
        { capability: 'people.reports', own: true, label: 'Medarbetare' },
        { capability: 'talks.talks', source: 'Utvecklingssamtal', own: true },
        { capability: 'talks.talks', source: 'Utvecklingssamtal', own: true },
      ],
      views,
    })!;
    expect(subject.chips).toEqual([
      { ref: 'capability:people.reports', kind: 'capability', label: 'Medarbetare' },
      { ref: 'capability:talks.talks', kind: 'capability', label: 'Utvecklingssamtal' },
    ]);
    expect(subject.closed).toBeUndefined();
    expect(subject.key).toBe('staff');
    expect(subject.search).toBe('');
    expect(subject.about).toBe('Om Medarbetare');
    expect(subject.placeholder).toBe('Fråga om medarbetare');
    expect(subject.label).toBe('medarbetare');
  });
  test('a read of another system the assistant may not make is named by its system; the rest still go', () => {
    const subject = pageSubject({
      key: 'units',
      title: 'Läget',
      reads: [
        { capability: 'talks.talks', source: 'Utvecklingssamtal', own: true },
        { capability: 'qlik.sickLeave', source: 'Qlik' },
        { capability: 'hr.presenceAll', source: 'Personalsystemet' },
        { capability: 'qlik.sickLeave', source: 'Qlik' },
      ],
      views,
    })!;
    expect(subject.chips.map(c => c.ref)).toEqual(['capability:talks.talks']);
    expect(subject.closed).toBe('Assistenten kan inte läsa det som Qlik och Personalsystemet visar här.');
  });
  test('a read the person may not call, absent from their reads, is closed as well; one of Clew’s own by its name', () => {
    const subject = pageSubject({
      key: 'staff',
      title: 'Medarbetare',
      reads: [
        { capability: 'boarding.plans', own: true, label: 'Introduktion och avslut' },
        { capability: 'talks.talks', source: 'Utvecklingssamtal', own: true },
        { capability: 'hr.presenceAll', source: 'Personalsystemet' },
      ],
      views,
    })!;
    expect(subject.chips.map(c => c.ref)).toEqual(['capability:talks.talks']);
    expect(subject.closed).toBe(
      'Assistenten kan inte läsa introduktion och avslut och det som Personalsystemet visar här.',
    );
  });
  test('where nothing can be read, the line says so and that the assistant still answers about the rest', () => {
    // A lens of another system with no overview the assistant may make: named by its system.
    const lens = pageSubject({
      key: 'lens:hr.presence',
      title: 'Frånvaro',
      reads: [{ capability: null, source: 'Personalsystemet' }],
      views,
      search: '?lens=hr.presence',
    })!;
    expect(lens.chips).toEqual([]);
    expect(lens.closed).toBe(`Assistenten kan inte läsa det som Personalsystemet visar här. ${still}`);
    expect(lens.key).toBe('lens:hr.presence');
    expect(lens.search).toBe('?lens=hr.presence');
    // Clew's own among what is closed: what is shown, in general.
    const own = pageSubject({
      key: 'boarding',
      title: 'Introduktion och avslut',
      reads: [{ capability: 'boarding.plans', own: true, label: 'Introduktion och avslut' }],
      views,
    })!;
    expect(own.chips).toEqual([]);
    expect(own.closed).toBe(`Assistenten kan inte läsa det som visas här. ${still}`);
  });
  test('a page whose content is never the assistant’s says why, whatever its reads', () => {
    const search = pageSubject({
      key: 'competence:search',
      title: 'Kompetenssökning',
      reads: [{ capability: 'people.reports', own: true }],
      views,
      named: 'kompetenser',
      never: 'search',
    })!;
    expect(search.chips).toEqual([]);
    expect(search.closed).toBe(
      `Assistenten läser aldrig din sökning eller det den hittar: sökningen görs bara av dig, här på sidan. ${still}`,
    );
    expect(search.about).toBe('Om Kompetenssökning');
    expect(search.placeholder).toBe('Fråga om kompetenser');
    expect(search.label).toBe('kompetenser');
  });
  test('the box asks about what the page names, and nothing is known before the person’s reads are', () => {
    const queue = pageSubject({
      key: 'todo:needs-you',
      title: 'Att göra · Behöver dig',
      reads: [{ capability: 'people.reports', own: true, label: 'Att göra' }],
      views,
      named: 'ärendena',
    })!;
    expect(queue.about).toBe('Om Att göra · Behöver dig');
    expect(queue.placeholder).toBe('Fråga om ärendena');
    expect(queue.chips).toEqual([{ ref: 'capability:people.reports', kind: 'capability', label: 'Att göra' }]);
    expect(pageSubject({ key: 'tools', title: 'Alla verktyg', reads: [], views: undefined })).toBeNull();
    // A page that shows no read yet (a register with nothing in it) says nothing about what is closed.
    const empty = pageSubject({ key: 'units', title: 'Läget', reads: [], views })!;
    expect(empty.chips).toEqual([]);
    expect(empty.closed).toBeUndefined();
  });
});

describe('a source about people or units is read through its overviews (D127, D130 rule 4)', () => {
  test('each overview of the source’s connector is a read, named as the source', () => {
    expect(
      sourceReads({
        capability: 'dialogue.unit',
        source: 'Dialogstöd',
        title: 'Uppföljningsdialog',
        own: true,
        overviews: ['dialogue.units'],
      }),
    ).toEqual([
      {
        capability: 'dialogue.units',
        source: 'Dialogstöd',
        own: true,
        label: 'Uppföljningsdialog',
        about: 'dialogue.unit',
      },
    ]);
  });
  test('a source with none is a read the assistant cannot make, which the pane names', () => {
    const reads = sourceReads({ capability: 'qlik.unit', source: 'Qlik', title: 'Sjukfrånvaro' });
    expect(reads).toEqual([
      { capability: null, source: 'Qlik', own: false, label: 'Sjukfrånvaro', about: 'qlik.unit' },
    ]);
    expect(pageSubject({ key: 'units', title: 'Läget', reads, views: [] })!.closed).toBe(
      'Assistenten kan inte läsa det som Qlik visar här. Du kan ändå fråga om annat som du har tillgång till.',
    );
  });
  test('a source with no overview is not said closed while the assistant may make another read of its system', () => {
    const reads = [
      ...sourceReads({ capability: 'competence.unit', source: 'Clew', title: 'Kompetens', own: true }),
      ...sourceReads({ capability: 'qlik.unit', source: 'Qlik', title: 'Sjukfrånvaro' }),
    ];
    const views = [
      { capability: 'competence.coverage', title: 'Kompetenstäckning', assistant: true as const },
      { capability: 'qlik.unit', title: 'Sjukfrånvaro' },
    ];
    const subject = pageSubject({ key: 'units', title: 'Läget', reads, views })!;
    // No chip for it: the model picks the system's tool itself. Only the system with no read for the assistant is named.
    expect(subject.chips).toEqual([]);
    expect(subject.closed).toBe(
      'Assistenten kan inte läsa det som Qlik visar här. Du kan ändå fråga om annat som du har tillgång till.',
    );
  });
  test('a read Clew joins across systems says nothing about another: its source is closed without an overview', () => {
    const reads = sourceReads({ capability: 'clew.talkUnits', source: 'Clew', title: 'Utvecklingssamtal', own: true });
    const views = [{ capability: 'clew.news', title: 'Nyheter', assistant: true as const }];
    expect(pageSubject({ key: 'units', title: 'Läget', reads, views })!.closed).toBe(
      'Assistenten kan inte läsa det som visas här. Du kan ändå fråga om annat som du har tillgång till.',
    );
  });
});
