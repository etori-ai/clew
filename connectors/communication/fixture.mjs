// The generic communication system's records (D52: a kind of system, no vendor). Generated from the day the fixture is
// seeded: one notice that requires a read receipt, published yesterday morning, and one that does not. Refs are stable.
// Each notice is also news (D112): the sender is the department that published it, as a reader knows it. A notice's
// body is its text, paragraphs separated by a blank line; `link` is where the whole of it lives in the system, when it
// has more than the body (the routine's checklists and forms). The addresses are on a reserved example domain.

export const dateIn = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(date);
export const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/** Where the system shows a notice in full. */
const SITE = 'https://kommunikation.example.invalid';

export function seed(today) {
  const d = n => addDays(today, n);
  const notices = [
    {
      ref: 'communication:notice:2026-44-1',
      title: 'Ny rutin vid hot och våld',
      body: [
        'Från den 1 december gäller en ny rutin vid hot och våld för förvaltningens skolor och fritidshem. Den ersätter handlingsplanen från 2023 och gäller både när en elev och när en vuxen utsätts.',
        'Den som utsätts, eller ser att någon annan utsätts, ser först till att ingen är i fara och larmar 112 vid behov. Rektor informeras samma dag, och händelsen registreras i avvikelsesystemet senast nästa arbetsdag.',
        'Rektor ser till att den som drabbats erbjuds stöd och samtal och att händelsen följs upp inom en vecka. Vid en allvarlig händelse kontaktas också skyddsombudet och förvaltningens säkerhetssamordnare.',
        'I den fullständiga rutinen finns checklistor, blanketter och kontaktuppgifter. Bekräfta att du har tagit del av rutinen.',
      ].join('\n\n'),
      link: `${SITE}/meddelanden/2026-44-1`,
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
