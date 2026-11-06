// The generic economy system's records (D52: a kind of system, no vendor; the suppliers are made up). Generated from the
// day the fixture is seeded: two invoices matching one order fall due tomorrow, one without an order in a week, and the
// cost centre's forecast overshoots its budget. Refs are stable; only the dates move with the seed day.

export const UNIT = 'unit-skola';
export const costCentreOf = { [UNIT]: 'KS-4410' };

export const dateIn = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(date);
export const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const shortDate = day =>
  new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' }).format(new Date(day + 'T12:00:00'));
export const money = n =>
  new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 }).format(n);

export function seed(today) {
  const d = n => addDays(today, n);
  const invoices = [
    {
      ref: 'finance:inv:55120',
      supplier: 'Skolgrossisten',
      amount: 11200,
      due: d(1),
      order: '2026-0412',
      costCentre: 'KS-4410',
      account: 'Läromedel',
    },
    {
      ref: 'finance:inv:55121',
      supplier: 'Skolgrossisten',
      amount: 7200,
      due: d(1),
      order: '2026-0412',
      costCentre: 'KS-4410',
      account: 'Läromedel',
    },
    {
      ref: 'finance:inv:55140',
      supplier: 'Energibolaget',
      amount: 18650,
      due: d(8),
      order: '',
      costCentre: 'KS-4410',
      account: 'Lokaler',
    },
  ];
  const budgets = [
    {
      costCentre: 'KS-4410',
      budget: 37_400_000,
      outcome: 31_900_000,
      forecast: 38_110_000,
      driver: 'vikarier −710 tkr',
    },
  ];
  return { seededOn: today, invoices, budgets };
}
