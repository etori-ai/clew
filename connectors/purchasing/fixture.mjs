// The generic purchasing system's records (D52: a kind of system, no vendor; everything is made up). Generated from the
// day the fixture is seeded: purchase requests that wait for an approver. The system knows a person by its own account
// name, the one in the token its authorization server issued, never by Clew's id: `approver` is that name. Two
// approvers have requests, so two people who link their accounts see different lists; refs are stable.

export const dateIn = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(date);
export const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const shortDate = day =>
  new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' }).format(new Date(day + 'T12:00:00'));
export const kronor = amount => new Intl.NumberFormat('sv-SE').format(amount) + ' kr';

const requested = [
  ['2026-0412', 'hillevi', 'Läromedel till årskurs 4', 'Sara Nyström', 8400, 3],
  ['2026-0415', 'hillevi', 'Två bärbara datorer', 'Per Holm', 23800, 5],
  ['2026-0419', 'hillevi', 'Studiebesök, buss', 'Mona Ek', 4200, 9],
  ['2026-0407', 'hassan', 'Arbetskläder, vinter', 'Omar Said', 6900, 2],
  ['2026-0421', 'hassan', 'Förbandsmaterial', 'Lena Berg', 1350, 7],
];

export function seed(today) {
  return {
    requests: requested.map(([number, approver, title, requester, amount, due]) => ({
      ref: 'purchasing:req:' + number,
      approver,
      title,
      requester,
      amount,
      dueBy: addDays(today, due),
      state: 'pending',
    })),
  };
}
