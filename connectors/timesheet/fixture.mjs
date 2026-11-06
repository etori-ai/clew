// The generic time-reporting system's records (D52: a kind of system, no vendor). Its roster is the same ward the HR
// system schedules, generated for three weeks around the seed day, weekdays only: the two systems agree on who works
// when because a municipality's HR and time systems share the roster, not because this file imports anything.

export const UNIT = 'unit-skola';
export const WARD = 'Björken';

export const dateIn = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(date);
export const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const shortDate = day =>
  new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' }).format(new Date(day + 'T12:00:00'));
const isWeekday = day => {
  const n = new Date(day + 'T12:00:00Z').getUTCDay();
  return n >= 1 && n <= 5;
};

export function seed(today) {
  const shifts = [];
  for (let n = -7; n <= 14; n++) {
    const date = addDays(today, n);
    if (!isWeekday(date)) continue;
    for (const [employee, start, end] of [
      ['hr:emp:1005', '07:00', '16:00'],
      ['hr:emp:1006', '07:00', '16:00'],
      ['hr:emp:1007', '07:00', '16:00'],
      ['hr:emp:1012', '12:00', '20:00'],
    ])
      shifts.push({ employee, unitId: UNIT, date, start, end, ward: WARD });
  }
  return { seededOn: today, shifts };
}
