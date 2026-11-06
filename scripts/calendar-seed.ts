/** Synthetic meetings for every persona and Hillevi's unit so each calendar has a week to show and slot search has real collisions to avoid. Idempotent by UID. */
import { fixtureProvider } from '@clew/calendar/accounts';
import { addDays, localInstant, today, weekStart } from '@clew/calendar/dates';
if (process.env.CLEW_POC !== 'true') throw new Error('Synthetic POC mode required');
const date = process.env.CALENDAR_FIXTURE_DATE ?? today();
const monday = weekStart(date),
  next = addDays(monday, 7);
type Fixture = { user: string; week: string; day: number; time: string; end: string; title: string; guests?: string[] };
const fixtures: Fixture[] = [
  // This week: Hillevi's day has a few meetings, which gives "I dag" something to draw.
  ...[0, 1, 2, 3, 4].map(day => ({
    user: 'hillevi',
    week: monday,
    day,
    time: '08:15',
    end: '08:45',
    title: 'Morgonmöte ledningsgrupp',
  })),
  {
    user: 'hillevi',
    week: monday,
    day: 1,
    time: '10:00',
    end: '11:00',
    title: 'Elevhälsoteam',
    guests: ['anna@clew.test'],
  },
  { user: 'hillevi', week: monday, day: 2, time: '13:00', end: '14:30', title: 'Budgetgenomgång' },
  { user: 'hillevi', week: monday, day: 3, time: '15:00', end: '16:00', title: 'Skolledarnätverk' },
  // Next week: the week the proposals are drawn in.
  { user: 'hillevi', week: next, day: 0, time: '09:00', end: '11:00', title: 'Rektorsmöte förvaltningen' },
  { user: 'hillevi', week: next, day: 1, time: '13:00', end: '14:00', title: 'Samverkan fackliga' },
  { user: 'hillevi', week: next, day: 2, time: '10:00', end: '12:00', title: 'Kvalitetsdialog' },
  { user: 'hillevi', week: next, day: 3, time: '14:00', end: '15:00', title: 'APT-förberedelse' },
  { user: 'anna', week: next, day: 0, time: '13:00', end: '15:00', title: 'Lektioner' },
  { user: 'anna', week: next, day: 1, time: '09:00', end: '12:00', title: 'Lektioner' },
  { user: 'erik', week: next, day: 1, time: '14:00', end: '16:00', title: 'Lektioner' },
  { user: 'erik', week: next, day: 2, time: '13:00', end: '16:00', title: 'Friluftsdag' },
  { user: 'maria', week: next, day: 3, time: '09:00', end: '12:00', title: 'Lektioner' },
  { user: 'johan', week: next, day: 4, time: '09:00', end: '11:00', title: 'Lektioner' },
  { user: 'johan', week: next, day: 0, time: '11:00', end: '12:00', title: 'Mentorstid' },
  // Appended after the originals so earlier fixture UIDs keep their index. Hassan (undersköterska) and Mikael (systemförvaltare) each get a visible week.
  { user: 'hassan', week: monday, day: 0, time: '07:00', end: '07:30', title: 'Rapport dagpass' },
  { user: 'hassan', week: monday, day: 2, time: '13:00', end: '14:00', title: 'APT hemtjänst' },
  { user: 'hassan', week: monday, day: 4, time: '09:00', end: '10:00', title: 'Handledning' },
  { user: 'hassan', week: next, day: 1, time: '07:00', end: '07:30', title: 'Rapport dagpass' },
  { user: 'hassan', week: next, day: 3, time: '14:00', end: '15:30', title: 'Utbildning läkemedel' },
  { user: 'mikael', week: monday, day: 0, time: '09:00', end: '09:30', title: 'Driftmöte' },
  { user: 'mikael', week: monday, day: 1, time: '13:00', end: '15:00', title: 'Leverantörsmöte Eneo' },
  { user: 'mikael', week: monday, day: 3, time: '10:00', end: '11:00', title: 'Förvaltningsråd' },
  { user: 'mikael', week: next, day: 0, time: '09:00', end: '09:30', title: 'Driftmöte' },
  { user: 'mikael', week: next, day: 2, time: '13:00', end: '16:00', title: 'Servicefönster' },
];
for (const [i, fixture] of fixtures.entries()) {
  const provider = fixtureProvider(fixture.user);
  const uid = `clew-fixture-${fixture.week}-${i}`,
    ref = await provider.eventRef(uid);
  if (await provider.lookup(ref)) continue;
  const day = addDays(fixture.week, fixture.day);
  await provider.create(uid, {
    title: fixture.title,
    start: localInstant(`${day}T${fixture.time}`),
    end: localInstant(`${day}T${fixture.end}`),
    participants: fixture.guests ?? [],
  });
}
console.log(`Calendar fixtures for weeks ${monday} and ${next} are in place. Existing meetings were kept.`);
