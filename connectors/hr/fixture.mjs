// The generic HR system's records (D52: a kind of system, no vendor; every name is made up). The records are generated
// from the day the fixture is seeded, so the scenarios hold whenever a developer starts the stack: three short absences
// within the rehab rule's window, two leave requests waiting, a delegation about to expire, a long sick leave and a vab
// running today, and a sick report made this morning. Refs are stable; only the dates move with the seed day. Reseed
// with FIXTURE_RESEED=true. An employee's `personId` is their user name; the people the development directory has on
// Bergsåkers skola carry the ones it gives them.

export const UNIT = 'unit-skola';
export const WARD = 'Björken';
// The unit's sick leave over the running period as the system's statistics hold it, against the municipality's target
// (D52: synthetic). The figure on Hem reads it (D54); the absence per person stays in the view it opens.
export const sickLeaveOf = { [UNIT]: { percent: 4.2, target: 4.0, change: 0.3, since: 'oktober' } };

/**
 * The municipality's rehabilitation routine as the HR system holds it (D52: synthetic, made up for the fixture): what
 * the manager does at each point of a short and a long sick leave, and when someone is back. Policy text, not a record
 * about anyone, so the model may read it (D115). Rule 4.2 is the one the scan's omtankesamtal card follows.
 */
export const REHAB_ROUTINE = {
  name: 'Rehabiliteringsrutinen',
  owner: 'HR-avdelningen',
  reviewedAt: '2026-03-02',
  rows: [
    {
      ref: 'hr:rehab-step:1',
      section: 'Kort sjukfrånvaro',
      at: 'Dag 1',
      title: 'Kontakta medarbetaren',
      detail:
        'Ring medarbetaren samma dag som sjukanmälan kommer. Fråga hur hen mår, hur länge frånvaron väntas vara och om något i arbetet kan göra det lättare att komma tillbaka. Fråga aldrig om diagnos. Se till att sjukanmälan är registrerad i personalsystemet.',
    },
    {
      ref: 'hr:rehab-step:2',
      section: 'Kort sjukfrånvaro',
      at: 'Dag 8',
      title: 'Be om läkarintyg',
      detail:
        'Från dag 8 behövs läkarintyg. Påminn medarbetaren om att skicka in det och håll kontakten minst en gång i veckan.',
    },
    {
      ref: 'hr:rehab-step:3',
      section: 'Upprepad korttidsfrånvaro',
      at: 'Tredje perioden på sex månader',
      title: 'Boka ett omtankesamtal',
      detail:
        'Efter den tredje korta sjukfrånvaron på sex månader bokar du ett omtankesamtal inom två veckor (rutin 4.2). Samtalet handlar om hur medarbetaren mår och om arbetet, inte om diagnos. Skriv ner vad ni kommer överens om.',
    },
    {
      ref: 'hr:rehab-step:4',
      section: 'Lång sjukfrånvaro',
      at: 'Dag 15',
      title: 'Anmäl till Försäkringskassan',
      detail:
        'Från dag 15 betalar Försäkringskassan sjukpenning. Anmäl sjukfallet till Försäkringskassan inom en vecka och håll kontakten med medarbetaren minst varannan vecka.',
    },
    {
      ref: 'hr:rehab-step:5',
      section: 'Lång sjukfrånvaro',
      at: 'Senast dag 30',
      title: 'Gör en plan för återgång i arbete',
      detail:
        'Väntas frånvaron bli 60 dagar eller längre gör du en plan för återgång i arbete tillsammans med medarbetaren. Ta hjälp av HR och företagshälsovården.',
    },
    {
      ref: 'hr:rehab-step:6',
      section: 'Lång sjukfrånvaro',
      at: 'Dag 90 och dag 180',
      title: 'Följ upp planen',
      detail:
        'Följ upp planen med medarbetaren. Pröva tillsammans med HR anpassningar av arbetet och andra arbetsuppgifter i kommunen.',
    },
    {
      ref: 'hr:rehab-step:7',
      section: 'Tillbaka i arbete',
      at: 'Första veckan',
      title: 'Ha ett uppföljningssamtal',
      detail: 'Ha ett samtal den första veckan efter återgången och följ upp att anpassningarna fungerar.',
    },
  ],
};

/** The calendar date in Stockholm, which is where the people in this fixture work. */
export const dateIn = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(date);
export const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
export const shortDate = day =>
  new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' }).format(new Date(day + 'T12:00:00'));
const dayAndMonth = day =>
  new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .formatToParts(new Date(day + 'T12:00:00Z'))
    .map(p => (p.type === 'month' ? p.value.replace(/\.$/, '') : p.value))
    .join('');
/** A period as a line reads it, without the month's full stop: "21 dec", "21–23 dec", "30 dec–2 jan". */
export function period(from, to = from) {
  if (to === from) return dayAndMonth(from);
  const [a, b] = [dayAndMonth(from), dayAndMonth(to)];
  const month = s => s.split(' ').slice(1).join(' ');
  return month(a) === month(b) && from.slice(0, 4) === to.slice(0, 4) ? `${a.split(' ')[0]}–${b}` : `${a}–${b}`;
}
export const isWeekday = day => {
  const n = new Date(day + 'T12:00:00Z').getUTCDay();
  return n >= 1 && n <= 5;
};

const employee = (n, personId, name, role) => ({
  ref: 'hr:emp:' + n,
  personId,
  name,
  email: personId + '@clew.test',
  unitId: UNIT,
  role,
});

/** Everything the HR system holds about the unit, relative to `today` (YYYY-MM-DD). */
export function seed(today) {
  const d = n => addDays(today, n);
  const employees = [
    employee(1001, 'anna', 'Anna Lindqvist', 'Lärare'),
    employee(1002, 'erik', 'Erik Sandström', 'Lärare'),
    employee(1003, 'maria', 'Maria Källström', 'Specialpedagog'),
    employee(1004, 'johan', 'Johan Byström', 'Lärare'),
    employee(1005, 'hassan', 'Hassan Ali', 'Elevassistent'),
    employee(1006, 'lena', 'Lena Öhman', 'Lärare'),
    employee(1007, 'omar', 'Omar Haddad', 'Fritidspedagog'),
    employee(1008, 'sara', 'Sara Nyström', 'Lärare'),
    employee(1009, 'per', 'Per Lindahl', 'Vaktmästare'),
    employee(1010, 'mona', 'Mona Berg', 'Skoladministratör'),
    employee(1011, 'jonas', 'Jonas Kask', 'Lärare'),
    employee(1012, 'aisha', 'Aisha El Amin', 'Kurator'),
    // The rest of Bergsåkers skola in the development directory, by the user names it gives them, so every person on
    // the manager's Personal has an answer from `hr.person` (D97).
    employee(1013, 'karin', 'Karin Lindqvist', 'Lärare'),
    employee(1014, 'lars.bergstrom', 'Lars Bergström', 'Lärare'),
    employee(1015, 'maria.eriksson', 'Maria Eriksson', 'Lärare'),
    employee(1016, 'omar.hosseini', 'Omar Hosseini', 'Fritidspedagog'),
    employee(1017, 'petra.karlsson', 'Petra Karlsson', 'Lärare'),
    employee(1018, 'sven.lundgren', 'Sven Lundgren', 'Lärare'),
    employee(1019, 'yusuf.lindqvist', 'Yusuf Lindqvist', 'Elevassistent'),
  ];
  /** Inclusive dates. `short` is sjuk up to 14 days, `vab`, `long` is sjukskrivning. */
  const absences = [
    { employee: 'hr:emp:1001', from: d(-145), to: d(-144), kind: 'short' },
    { employee: 'hr:emp:1001', from: d(-78), to: d(-78), kind: 'short' },
    { employee: 'hr:emp:1001', from: d(-2), to: d(-2), kind: 'short' },
    { employee: 'hr:emp:1004', from: d(-30), to: d(-29), kind: 'vab' },
    { employee: 'hr:emp:1006', from: d(-9), to: d(44), kind: 'long' },
    { employee: 'hr:emp:1008', from: d(-1), to: d(-1), kind: 'short' },
    { employee: 'hr:emp:1011', from: d(-1), to: d(0), kind: 'vab' },
    { employee: 'hr:emp:1002', from: d(-51), to: d(-50), kind: 'short' },
    // Erik reported sick this morning: the first day of a short absence (Personal's "Sjuk · dag 1").
    { employee: 'hr:emp:1002', from: d(0), to: d(0), kind: 'short' },
  ];
  const leaveRequests = [
    {
      ref: 'hr:leave:7781',
      employee: 'hr:emp:1004',
      from: d(48),
      to: d(49),
      days: 2,
      type: 'semester',
      submittedAt: d(-2) + 'T16:40:00+01:00',
    },
    {
      ref: 'hr:leave:7790',
      employee: 'hr:emp:1005',
      from: d(48),
      to: d(52),
      days: 5,
      type: 'semester',
      submittedAt: d(-1) + 'T06:35:00+01:00',
    },
  ];
  const delegations = [
    {
      ref: 'hr:deleg:301',
      employee: 'hr:emp:1005',
      title: 'Läkemedelsdelegering',
      expires: d(24),
      renewer: 'Maria Källström (ssk)',
    },
    {
      ref: 'hr:deleg:302',
      employee: 'hr:emp:1007',
      title: 'Brandskyddsansvarig',
      expires: d(41),
      renewer: 'Per Lindahl',
    },
  ];
  /** The ward's roster for three weeks around the seed day, weekdays only. */
  const shifts = [];
  for (let n = -7; n <= 14; n++) {
    const date = d(n);
    if (!isWeekday(date)) continue;
    for (const [ref, start, end] of [
      ['hr:emp:1005', '07:00', '16:00'],
      ['hr:emp:1006', '07:00', '16:00'],
      ['hr:emp:1007', '07:00', '16:00'],
      ['hr:emp:1012', '12:00', '20:00'],
    ])
      shifts.push({ employee: ref, date, start, end, ward: WARD });
  }
  return { seededOn: today, employees, absences, leaveRequests, delegations, shifts };
}
