/**
 * Synthetic meetings for every persona and Hillevi's unit, so each calendar has a week to show and slot search has real
 * collisions to avoid. One list for both development calendars: `calendar-seed.ts` books them in Nextcloud through the
 * synthetic directory, and `fake-graph.ts` books them in the local fake of Microsoft Graph when it starts (D69). The seed
 * is idempotent by UID, so a repeated run keeps what is there and adds what is missing.
 */
import type { CalendarProvider } from '@clew/calendar/model';
import { addDays, localInstant, today, weekStart } from '@clew/calendar/dates';

export type CalendarFixture = {
  user: string;
  week: string;
  day: number;
  time: string;
  end: string;
  title: string;
  guests?: string[];
  room?: string;
};
const unit = ['anna@clew.test', 'erik@clew.test', 'maria@clew.test', 'johan@clew.test'];

/** The weeks the fixtures fall in: this week and the next, from the day given or today. */
export function fixtureWeeks(date = process.env.CALENDAR_FIXTURE_DATE ?? today()) {
  const monday = weekStart(date);
  return { monday, next: addDays(monday, 7) };
}

/** The fixtures in a stable order: an entry's index is part of its UID, so new ones are appended, never inserted. */
export function calendarFixtures(date?: string): CalendarFixture[] {
  const { monday, next } = fixtureWeeks(date);
  return [
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
    // Room bookings of different sizes, so a room can be taken when someone looks for one.
    {
      user: 'hillevi',
      week: monday,
      day: 1,
      time: '13:00',
      end: '14:00',
      title: 'Arbetslagsmöte',
      guests: unit,
      room: 'Linden',
    },
    {
      user: 'hillevi',
      week: monday,
      day: 4,
      time: '10:00',
      end: '11:00',
      title: 'Rektorssamråd',
      guests: ['erik@clew.test'],
      room: 'Eken',
    },
    { user: 'mikael', week: monday, day: 2, time: '14:00', end: '15:00', title: 'Systemgenomgång', room: 'Aspen' },
    { user: 'hassan', week: monday, day: 3, time: '10:00', end: '11:30', title: 'Vårdplanering', room: 'Aspen' },
    {
      user: 'hillevi',
      week: next,
      day: 4,
      time: '13:00',
      end: '15:00',
      title: 'Personalmöte',
      guests: unit,
      room: 'Boken',
    },
    { user: 'mikael', week: next, day: 1, time: '09:00', end: '10:00', title: 'Driftöverlämning', room: 'Tallen' },
    { user: 'hassan', week: next, day: 2, time: '09:00', end: '10:00', title: 'Enskild handledning', room: 'Granen' },
    {
      user: 'hassan',
      week: next,
      day: 3,
      time: '09:00',
      end: '12:00',
      title: 'Introduktion nyanställda',
      room: 'Almen',
    },
    // Mikael asks for a room Hillevi already holds, so the second booking shows a room that said no.
    {
      user: 'hillevi',
      week: next,
      day: 0,
      time: '13:00',
      end: '14:00',
      title: 'Ledningsgrupp',
      guests: ['maria@clew.test'],
      room: 'Eken',
    },
    { user: 'mikael', week: next, day: 0, time: '13:00', end: '14:00', title: 'Verksamhetsdialog', room: 'Eken' },
  ];
}

/**
 * Books every fixture that is not already there, through the provider the caller gives for each user. Answers how many
 * were booked and how many were already in place.
 */
export async function seedCalendar(
  providerFor: (user: string) => CalendarProvider,
  date?: string,
): Promise<{ booked: number; kept: number }> {
  let booked = 0,
    kept = 0;
  for (const [i, fixture] of calendarFixtures(date).entries()) {
    const provider = providerFor(fixture.user);
    const uid = `clew-fixture-${fixture.week}-${i}`,
      ref = await provider.eventRef(uid);
    if (await provider.lookup(ref)) {
      kept++;
      continue;
    }
    const day = addDays(fixture.week, fixture.day);
    const room = fixture.room ? (await provider.resources()).find(r => r.name === fixture.room) : undefined;
    if (fixture.room && !room) throw new Error(`The room ${fixture.room} is missing. Provision the rooms first.`);
    await provider.create(uid, {
      title: fixture.title,
      start: localInstant(`${day}T${fixture.time}`),
      end: localInstant(`${day}T${fixture.end}`),
      participants: fixture.guests ?? [],
      ...(room ? { room: room.ref } : {}),
    });
    booked++;
  }
  return { booked, kept };
}
