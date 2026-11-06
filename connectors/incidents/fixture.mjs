// The generic deviation system's records (D52: a kind of system, no vendor; everything is made up). Generated from the
// day the fixture is seeded: one incident reported five days ago waits on the safety representative and falls due in
// two days; two more are under investigation, one of them reported more than two weeks ago, so Läget has something to
// say (D54). The people are the unit's staff, by the same person ids the HR system knows; refs are stable.

export const UNIT = 'unit-skola';

export const dateIn = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(date);
export const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const shortDate = day =>
  new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' }).format(new Date(day + 'T12:00:00'));

const staff = [
  ['hr:emp:1001', 'anna'],
  ['hr:emp:1002', 'erik'],
  ['hr:emp:1003', 'maria'],
  ['hr:emp:1004', 'johan'],
  ['hr:emp:1005', 'hassan'],
  ['hr:emp:1006', 'lena'],
  ['hr:emp:1007', 'omar'],
  ['hr:emp:1008', 'sara'],
  ['hr:emp:1009', 'per'],
  ['hr:emp:1010', 'mona'],
  ['hr:emp:1011', 'jonas'],
  ['hr:emp:1012', 'aisha'],
];

export function seed(today) {
  const d = n => addDays(today, n);
  const employees = staff.map(([ref, personId]) => ({ ref, personId, unitId: UNIT }));
  const deviations = [
    {
      ref: 'incidents:dev:2026-1182',
      unitId: UNIT,
      title: 'Tillbud 2026-1182, halkolycka i duschen',
      reportedBy: 'hr:emp:1005',
      reportedAt: d(-5) + 'T11:10:00+01:00',
      state: 'waiting-safety-rep',
      waitingOn: 'skyddsombudets yttrande',
      dueBy: d(2),
    },
    {
      ref: 'incidents:dev:2026-1141',
      unitId: UNIT,
      title: 'Tillbud 2026-1141, trasig grind mot parkeringen',
      reportedBy: 'hr:emp:1011',
      reportedAt: d(-18) + 'T08:40:00+01:00',
      state: 'investigating',
      waitingOn: 'fastighetens åtgärd',
      dueBy: d(4),
    },
    {
      ref: 'incidents:dev:2026-1190',
      unitId: UNIT,
      title: 'Tillbud 2026-1190, elev klämde handen i en dörr',
      reportedBy: 'hr:emp:1012',
      reportedAt: d(-2) + 'T13:25:00+01:00',
      state: 'investigating',
      waitingOn: 'utredning',
      dueBy: d(12),
    },
  ];
  return { seededOn: today, employees, deviations };
}
