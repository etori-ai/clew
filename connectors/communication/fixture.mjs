// The generic communication system's records (D52: a kind of system, no vendor). Generated from the day the fixture is
// seeded: one notice that requires a read receipt, published yesterday morning, and one that does not. Refs are stable.
// Each notice is also news (D111): the sender is the department that published it, as a reader knows it.

export const dateIn = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(date);
export const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

export function seed(today) {
  const d = n => addDays(today, n);
  const notices = [
    {
      ref: 'communication:notice:2026-44-1',
      title: 'Ny rutin vid hot och våld',
      body: 'Från 1 december gäller en ny rutin vid hot och våld i skolan. Läs rutinen och bekräfta att du tagit del av den.',
      publishedAt: d(-1) + 'T06:30:00+01:00',
      sender: 'Barn och utbildning',
      requiresReceipt: true,
      audience: 'all',
    },
    {
      ref: 'communication:notice:2026-44-2',
      title: 'Enkät om matsalen',
      body: 'Kostenheten vill veta hur matsalen fungerar. Tar tre minuter.',
      publishedAt: d(-2) + 'T09:00:00+01:00',
      sender: 'Kostenheten',
      requiresReceipt: false,
      audience: 'all',
    },
  ];
  return { seededOn: today, notices };
}
