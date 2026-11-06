// The generic HR system's records (D52: a kind of system, no vendor; every name is made up). The records are generated
// from the day the fixture is seeded, so the scenarios hold whenever a developer starts the stack: three short absences
// within the rehab rule's window, two leave requests waiting, a delegation about to expire, a long sick leave and a vab
// running today. Refs are stable; only the dates move with the seed day. Reseed with FIXTURE_RESEED=true.

export const UNIT = 'unit-skola';
export const WARD = 'Björken';
// The unit's sick leave over the running period as the system's statistics hold it, against the municipality's target
// (D52: synthetic). The figure on Hem reads it (D54); the absence per person stays in the view it opens.
export const sickLeaveOf = { [UNIT]: { percent: 4.2, target: 4.0, change: 0.3, since: 'oktober' } };

/** The calendar date in Stockholm, which is where the people in this fixture work. */
export const dateIn = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(date);
export const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
export const shortDate = day =>
  new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' }).format(new Date(day + 'T12:00:00'));
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
