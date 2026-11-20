import { describe, expect, test } from 'bun:test';
import { OPEN_THING_INPUT_MAX, type Chip, type EntitySource, type Thread } from '@clew/contracts';
import {
  SUBJECT_MAX,
  UNNAMED_PERSON,
  conversationFor,
  entityPageSubject,
  itemPageSubject,
  listSubject,
  pageSubject,
  paneReach,
  pageTurn,
  recordKey,
  recordSubject,
  recordThing,
  sourceReads,
  stableJson,
} from '../src/components/conversation/page-conversation';
import { turnInput } from '../src/components/conversation/turns';

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

describe('the conversation beside a page is the person’s newest about its subject (D135 rule 6)', () => {
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

describe('the subject a conversation was asked beside finds it on any device (D135 rule 6)', () => {
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

describe('a list’s subject in the words of the pane (D135 rules 4 and 10)', () => {
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

describe('a page’s subject goes with the reads the assistant may make, and says which it may not (D135 rule 4)', () => {
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
    expect(subject.cannotRead).toBeUndefined();
    expect(subject.key).toBe('staff');
    expect(subject.search).toBe('');
    expect(subject.about).toBe('Om Medarbetare');
    expect(subject.placeholder).toBe('Fråga om medarbetare');
    expect(subject.label).toBe('medarbetare');
  });
  test('a read of another system the assistant may not make is listed by its system; the rest still go', () => {
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
    // The list says it, by name and once each (D138 item 7): there is no sentence under the pane's heading.
    expect(subject.cannotRead).toEqual(['Qlik', 'Personalsystemet']);
    expect(subject.closed).toBeUndefined();
  });
  test('a read the person may not call, absent from their reads, is closed as well; one of Clew’s own by its name as written', () => {
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
    expect(subject.cannotRead).toEqual(['Introduktion och avslut', 'Personalsystemet']);
    expect(subject.closed).toBeUndefined();
    // One of Clew's own with no name to be listed by: the line says that not all of the page can be read.
    const unnamed = pageSubject({
      key: 'staff',
      title: 'Medarbetare',
      reads: [
        { capability: 'talks.talks', source: 'Utvecklingssamtal', own: true },
        { capability: 'secret.read', own: true },
        { capability: 'hr.presenceAll', source: 'Personalsystemet' },
      ],
      views,
    })!;
    expect(unnamed.cannotRead).toEqual(['Personalsystemet']);
    expect(unnamed.closed).toBe('Assistenten kan inte läsa allt som visas här.');
  });
  test('where nothing can be read, the list says what; with a read of no name, the line says so and that the assistant still answers', () => {
    // A lens of another system with no overview the assistant may make: named by its system.
    const lens = pageSubject({
      key: 'lens:hr.presence',
      title: 'Frånvaro',
      reads: [{ capability: null, source: 'Personalsystemet' }],
      views,
      search: '?lens=hr.presence',
    })!;
    expect(lens.chips).toEqual([]);
    expect(lens.cannotRead).toEqual(['Personalsystemet']);
    expect(lens.closed).toBeUndefined();
    expect(lens.key).toBe('lens:hr.presence');
    expect(lens.search).toBe('?lens=hr.presence');
    // Clew's own among what is closed: by its name.
    const own = pageSubject({
      key: 'boarding',
      title: 'Introduktion och avslut',
      reads: [{ capability: 'boarding.plans', own: true, label: 'Introduktion och avslut' }],
      views,
    })!;
    expect(own.chips).toEqual([]);
    expect(own.cannotRead).toEqual(['Introduktion och avslut']);
    expect(own.closed).toBeUndefined();
    // With no name to list it by: what is shown, in general, and that the rest can still be asked about.
    const nameless = pageSubject({ key: 'x', title: 'X', reads: [{ capability: 'secret.read', own: true }], views })!;
    expect(nameless.cannotRead).toBeUndefined();
    expect(nameless.closed).toBe(`Assistenten kan inte läsa det som visas här. ${still}`);
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
    expect(search.cannotRead).toBeUndefined();
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
    expect(empty.cannotRead).toBeUndefined();
  });
});

describe('a source about people or units is read through its overviews (D127, D135 rule 4)', () => {
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
  test('a source with none is a read the assistant cannot make, which the pane lists by its system', () => {
    const reads = sourceReads({ capability: 'qlik.unit', source: 'Qlik', title: 'Sjukfrånvaro' });
    expect(reads).toEqual([
      { capability: null, source: 'Qlik', own: false, label: 'Sjukfrånvaro', about: 'qlik.unit' },
    ]);
    expect(pageSubject({ key: 'units', title: 'Läget', reads, views: [] })).toMatchObject({ cannotRead: ['Qlik'] });
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
    // No chip for it: the model picks the system's tool itself. Only the system with no read for the assistant is listed.
    expect(subject.chips).toEqual([]);
    expect(subject.cannotRead).toEqual(['Qlik']);
    expect(subject.closed).toBeUndefined();
  });
  test('a read Clew joins across systems says nothing about another: its source is closed without an overview', () => {
    const reads = sourceReads({ capability: 'clew.talkUnits', source: 'Clew', title: 'Utvecklingssamtal', own: true });
    const views = [{ capability: 'clew.news', title: 'Nyheter', assistant: true as const }];
    expect(pageSubject({ key: 'units', title: 'Läget', reads, views })).toMatchObject({
      cannotRead: ['Utvecklingssamtal'],
    });
  });
});

describe('before anything is asked the pane says what it can do here, every line from what it is allowed (D138 item 7)', () => {
  const views = [
    { capability: 'talks.talks', title: 'Utvecklingssamtal', assistant: true as const },
    { capability: 'clew.work', title: 'Att göra', assistant: true as const },
    { capability: 'hr.presenceAll', title: 'Frånvaro' },
  ];
  test('the reads are the subject’s chips by their words, once each; what it fills in is the server’s; the rest is closed', () => {
    const subject = pageSubject({
      key: 'units',
      title: 'Läget',
      reads: [
        { capability: 'talks.talks', source: 'Utvecklingssamtal', own: true },
        { capability: 'clew.work', own: true, label: 'Dina ärenden i Att göra' },
        { capability: 'talks.talks', source: 'Utvecklingssamtal', own: true, label: 'Samtalen' },
        { capability: 'hr.presenceAll', source: 'Personalsystemet' },
        { capability: 'boarding.plans', own: true, label: 'Introduktion och avslut' },
      ],
      views,
    })!;
    expect(paneReach(subject, [{ title: 'Lägg till en kommentar' }, { title: 'Lägg till en kommentar' }])).toEqual({
      reads: ['Utvecklingssamtal', 'Dina ärenden i Att göra'],
      prepares: ['Lägg till en kommentar'],
      cannotRead: ['Introduktion och avslut', 'Personalsystemet'],
    });
  });
  test('before the server has answered, or where it says nothing, nothing is said to be filled in', () => {
    const subject = pageSubject({
      key: 'todo:needs-you',
      title: 'Att göra · Behöver dig',
      reads: [{ capability: 'clew.work', own: true, label: 'Att göra' }],
      views,
      named: 'ärendena',
    })!;
    expect(paneReach(subject)).toEqual({ reads: ['Att göra'], prepares: [], cannotRead: [] });
    expect(paneReach(subject, [])).toEqual({ reads: ['Att göra'], prepares: [], cannotRead: [] });
  });
  test('a work item’s page reads the item by its title, and fills in its actions as the server says them', () => {
    const subject = itemPageSubject({ id: 'ledighet-1', title: 'Ledighetsansökan från Anna Lindqvist' });
    expect(paneReach(subject, [{ title: 'Bevilja' }, { title: 'Avslå' }])).toEqual({
      reads: ['Ledighetsansökan från Anna Lindqvist'],
      prepares: ['Bevilja', 'Avslå'],
      cannotRead: [],
    });
  });
  test('a person’s page reads nothing of its own, and lists the systems its sections come from that are closed', () => {
    const subject = entityPageSubject({
      kind: 'person',
      id: 'p-anna',
      name: 'Anna Lindqvist',
      relation: 'managed',
      sections: [
        { capability: 'hr.absence', connector: 'hr', source: 'Personalsystemet', title: 'Frånvaro' } as EntitySource,
      ],
      views,
    })!;
    expect(paneReach(subject)).toEqual({ reads: [], prepares: [], cannotRead: ['Personalsystemet'] });
  });
});

describe('a record is one conversation per record, by its read and its input (D136 item 1)', () => {
  test('the input is one text whatever order its address wrote it in; arrays keep theirs', () => {
    expect(stableJson({ b: 1, a: { d: [2, 1], c: 'x' } })).toBe('{"a":{"c":"x","d":[2,1]},"b":1}');
    expect(stableJson({ a: undefined, b: null })).toBe('{"b":null}');
    expect(recordKey('supplier.card', { id: '42', year: 2026 })).toBe(
      recordKey('supplier.card', { year: 2026, id: '42' }),
    );
  });
  test('two records of one read are two subjects, and neither is the list’s', () => {
    const a = recordKey('supplier.card', { id: '42' });
    const b = recordKey('supplier.card', { id: '43' });
    expect(a).toBe('view:supplier.card:{"id":"42"}');
    expect(a).not.toBe(b);
    expect(a).not.toBe('view:supplier.card');
  });
  test('an input too long for the subject is kept as its digest, the same for the same input and within the limit', () => {
    const long = { text: 'x'.repeat(SUBJECT_MAX) };
    const key = recordKey('docs.document', long);
    expect(key).toMatch(/^view:docs\.document#[0-9a-f]{16}$/);
    expect(key.length).toBeLessThanOrEqual(SUBJECT_MAX);
    expect(recordKey('docs.document', { text: 'x'.repeat(SUBJECT_MAX) })).toBe(key);
    expect(recordKey('docs.document', { text: 'y'.repeat(SUBJECT_MAX) })).not.toBe(key);
  });
  test('the record is the thing with its input; one whose input the server would refuse is told as nothing', () => {
    expect(recordThing('supplier.card', { id: '42' })).toEqual({
      kind: 'record',
      capability: 'supplier.card',
      input: { id: '42' },
    });
    expect(recordThing('docs.document', { text: 'x'.repeat(OPEN_THING_INPUT_MAX) })).toBeUndefined();
  });
  test('a record’s conversation is found by its key alone, never by the read’s chip another record shares', () => {
    const chip: Chip = { ref: 'capability:supplier.card', kind: 'capability', label: 'Leverantör' };
    const other = thread('om-42', '2026-11-18T10:00:00.000Z', [asked([chip]), answer], 'question', {
      subject: recordKey('supplier.card', { id: '42' }),
      label: 'Om Acme AB',
      openedAt: null,
    });
    const mine = { key: recordKey('supplier.card', { id: '43' }), chips: [chip], thing: { kind: 'record' as const } };
    expect(conversationFor([other], mine)).toBeNull();
    expect(conversationFor([other], { ...mine, key: recordKey('supplier.card', { id: '42' }) })?.id).toBe('om-42');
  });
});

describe('a thing’s page says what stands open (D136 items 1 to 7)', () => {
  const views = [
    { capability: 'supplier.card', title: 'Leverantör', assistant: true as const },
    { capability: 'qlik.card', title: 'Rapport' },
    { capability: 'boarding.plan', title: 'Planen', assistant: true as const },
    { capability: 'talks.talks', title: 'Utvecklingssamtal', assistant: true as const },
  ];
  const source = (s: Partial<EntitySource> & Pick<EntitySource, 'capability' | 'source' | 'title'>) =>
    ({ connector: s.capability.split('.')[0]!, view: { kind: 'record' }, ...s }) as EntitySource;
  test('a work item’s page and its review: the key it was always asked under, its chip as what stands open, no thing', () => {
    const subject = itemPageSubject({ id: 'ledighet-1', title: 'Ledighetsansökan från Anna Lindqvist' });
    expect(subject).toMatchObject({
      key: 'thread:ledighet-1',
      about: 'Om ärendet Ledighetsansökan från Anna Lindqvist',
      placeholder: 'Fråga om ärendet',
      search: '?card=ledighet-1',
    });
    expect(subject.thing).toBeUndefined();
    expect(pageTurn(subject)).toEqual({
      chips: [{ ref: 'thread:ledighet-1', kind: 'thread', label: 'Ledighetsansökan från Anna Lindqvist' }],
      beside: 'thread:ledighet-1',
      page: { subject: 'thread:ledighet-1', label: 'Om ärendet Ledighetsansökan från Anna Lindqvist' },
    });
  });
  test('a record the assistant may read: its chip, its thing, its name as written, and it stands beside the conversation', () => {
    const subject = recordSubject({
      capability: 'supplier.card',
      input: { id: '42' },
      name: 'Acme AB',
      title: 'Leverantör',
      source: 'Ekonomisystemet',
      views,
      search: '?open=supplier.card',
    })!;
    expect(subject.about).toBe('Om Acme AB');
    expect(subject.placeholder).toBe('Fråga om Acme AB');
    expect(subject.closed).toBeUndefined();
    expect(pageTurn(subject)).toEqual({
      chips: [{ ref: 'capability:supplier.card', kind: 'capability', label: 'Leverantör' }],
      beside: 'capability:supplier.card',
      page: { subject: 'view:supplier.card:{"id":"42"}', label: 'Om Acme AB' },
      thing: { kind: 'record', capability: 'supplier.card', input: { id: '42' } },
    });
  });
  test('a record the assistant may not read: no chip, the thing still goes, and the pane lists the system', () => {
    const subject = recordSubject({
      capability: 'qlik.card',
      input: { report: 'r1' },
      name: 'Sjukfrånvaro oktober',
      title: 'Rapport',
      source: 'Qlik',
      views,
      search: '',
    })!;
    expect(subject.chips).toEqual([]);
    expect(subject.thing).toEqual({ kind: 'record', capability: 'qlik.card', input: { report: 'r1' } });
    expect(subject.cannotRead).toEqual(['Qlik']);
    expect(subject.closed).toBeUndefined();
    expect(recordSubject({ capability: 'qlik.card', input: {}, name: 'x', views: undefined, search: '' })).toBeNull();
  });
  test('a plan is a record of boarding.plan, said in Clew’s own words with the read’s own title on its chip', () => {
    const subject = recordSubject({
      capability: 'boarding.plan',
      input: { plan: 'p1' },
      name: 'Introduktion för Anna Lindqvist',
      common: true,
      views,
      search: '',
    })!;
    expect(subject.key).toBe('view:boarding.plan:{"plan":"p1"}');
    expect(subject.about).toBe('Om Introduktion för Anna Lindqvist');
    expect(subject.placeholder).toBe('Fråga om introduktion för Anna Lindqvist');
    expect(subject.chips).toEqual([{ ref: 'capability:boarding.plan', kind: 'capability', label: 'Planen' }]);
    expect(subject.thing).toEqual({ kind: 'record', capability: 'boarding.plan', input: { plan: 'p1' } });
  });
  test('a person: one subject for every tab, the person by Clew’s id, no chip, and a section’s system listed', () => {
    const sections = [
      source({
        capability: 'talks.person',
        source: 'Clew',
        title: 'Utvecklingssamtal',
        own: true,
        overviews: ['talks.talks'],
      }),
      source({ capability: 'hr.absence', source: 'Personalsystemet', title: 'Frånvaro' }),
    ];
    const subject = entityPageSubject({
      kind: 'person',
      id: 'p-anna',
      name: 'Anna Lindqvist',
      relation: 'managed',
      sections,
      views,
      tab: 'hr.absence',
    })!;
    expect(subject.key).toBe('person:p-anna');
    expect(subject.about).toBe('Om Anna Lindqvist');
    expect(subject.placeholder).toBe('Fråga om Anna Lindqvist');
    expect(subject.search).toBe('?person=p-anna&section=hr.absence');
    expect(subject.cannotRead).toEqual(['Personalsystemet']);
    expect(subject.closed).toBeUndefined();
    expect(pageTurn(subject)).toEqual({
      chips: [],
      page: { subject: 'person:p-anna', label: 'Om Anna Lindqvist' },
      thing: { kind: 'person', id: 'p-anna' },
    });
    // Another tab is the same subject.
    expect(
      entityPageSubject({ kind: 'person', id: 'p-anna', name: 'Anna Lindqvist', relation: 'managed', sections, views })!
        .key,
    ).toBe('person:p-anna');
  });
  test('the page of someone the reader neither is nor manages says the assistant is not told who it is, and still sends them', () => {
    const colleague = entityPageSubject({
      kind: 'person',
      id: 'p-olle',
      name: 'Olle Berg',
      relation: 'colleague',
      sections: [],
      views,
    })!;
    expect(colleague.closed).toBe(UNNAMED_PERSON);
    expect(colleague.thing).toEqual({ kind: 'person', id: 'p-olle' });
    const closedToo = entityPageSubject({
      kind: 'person',
      id: 'p-olle',
      name: 'Olle Berg',
      relation: 'colleague',
      sections: [source({ capability: 'hr.absence', source: 'Personalsystemet', title: 'Frånvaro' })],
      views,
    })!;
    // Under the heading only what the list does not say: that the assistant is not told who it is.
    expect(closedToo.closed).toBe(UNNAMED_PERSON);
    expect(closedToo.cannotRead).toEqual(['Personalsystemet']);
    for (const relation of ['self', 'managed'] as const)
      expect(
        entityPageSubject({ kind: 'person', id: 'p', name: 'N', relation, sections: [], views })!.closed,
      ).toBeUndefined();
  });
  test('a unit: its key and id, no chip, and no line about who it is', () => {
    const subject = entityPageSubject({
      kind: 'unit',
      id: 'u-1',
      name: 'Bergsåkers skola',
      relation: 'member',
      sections: [],
      views,
    })!;
    expect(subject.key).toBe('unit:u-1');
    expect(subject.search).toBe('?unit=u-1');
    expect(subject.chips).toEqual([]);
    expect(subject.thing).toEqual({ kind: 'unit', id: 'u-1' });
    expect(subject.closed).toBeUndefined();
    expect(
      entityPageSubject({ kind: 'unit', id: 'u-1', name: 'x', relation: 'manages', sections: [], views: undefined }),
    ).toBeNull();
  });
});

describe('the thing goes with a question to Clew, never to another system’s assistant (D136 item 1)', () => {
  const thing = { kind: 'person' as const, id: 'p-anna' };
  const page = { subject: 'person:p-anna', label: 'Om Anna Lindqvist' };
  test('asked of Clew, the request carries the thing and the page', () => {
    expect(turnInput({ text: 'Hur går det?', chips: [], current: null, own: true, page, thing })).toEqual({
      text: 'Hur går det?',
      chips: [],
      own: true,
      page,
      thing,
    });
  });
  test('handed to another system’s assistant, neither the thing nor the page nor what stands open goes', () => {
    const request = turnInput({
      text: 'Hur går det?',
      chips: [],
      beside: 'thread:t1',
      current: { id: 'c1', title: 'x', messages: [] },
      handed: { id: 'kunskap:hr', name: 'HR-assistenten', source: 'Kunskapsbanken' },
      page,
      thing,
    });
    expect(request).toEqual({ text: 'Hur går det?', chips: [], conversationId: 'c1', assistant: 'kunskap:hr' });
  });
});
