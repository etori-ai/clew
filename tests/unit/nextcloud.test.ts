import { describe, expect, test } from 'bun:test';
import { NextcloudProvider } from '../../packages/calendar/src/nextcloud';
import { invitedParticipant } from '../../packages/calendar/src/model';

const home = '/remote.php/dav/calendars/hillevi/';
const primary = `${home}personal/`;
const outbox = `${home}outbox/`;
const start = '2026-11-09T00:00:00.000Z';
const end = '2026-11-10T00:00:00.000Z';
const multistatus = (body: string) => `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:n="http://nextcloud.com/ns">
${body}
</d:multistatus>`;
const properties = (href: string, body: string) => `<d:response><d:href>${href}</d:href>
<d:propstat><d:prop>${body}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const discovery = {
  'PROPFIND /remote.php/dav/principals/users/hillevi/': multistatus(
    properties(
      '/remote.php/dav/principals/users/hillevi/',
      `
    <c:calendar-home-set><d:href>${home}</d:href></c:calendar-home-set>
    <c:schedule-outbox-URL><d:href>${outbox}</d:href></c:schedule-outbox-URL>`,
    ),
  ),
  [`PROPFIND ${home}`]: multistatus(
    properties(home, '<d:resourcetype><d:collection/></d:resourcetype>') +
      properties(primary, '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>'),
  ),
};

async function withProvider(
  replies: Readonly<Record<string, string>>,
  check: (provider: NextcloudProvider) => Promise<void>,
) {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const body = replies[`${request.method} ${new URL(request.url).pathname}`];
      return body === undefined
        ? new Response('Unknown DAV resource', { status: 404 })
        : new Response(body, { status: 207, headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
    },
  });
  try {
    await check(
      new NextcloudProvider(
        'hillevi',
        'synthetic-test-password',
        { email: 'hillevi@clew.test', name: 'Hillevi Berg' },
        server.url.href,
      ),
    );
  } finally {
    await server.stop(true);
  }
}

describe('the CalDAV contract through XML and iCalendar dependencies', () => {
  test('room discovery preserves names, addresses, capacity and equipment in namespaced XML', async () => {
    const rooms = multistatus(
      properties(
        '/remote.php/dav/principals/calendar-rooms/sal-a/',
        `
        <d:displayname>Sal A &amp; B</d:displayname>
        <c:calendar-user-address-set><d:href>mailto:sal-a@clew.test</d:href><d:href>urn:uuid:sal-a</d:href></c:calendar-user-address-set>
        <n:room-seating-capacity>12</n:room-seating-capacity><n:room-features>Projektor,Whiteboard</n:room-features>`,
      ) +
        properties(
          '/remote.php/dav/principals/calendar-rooms/sal-o/',
          `
        <d:displayname>Östra salen</d:displayname>
        <c:calendar-user-address-set><d:href>mailto:sal-o@clew.test</d:href></c:calendar-user-address-set>
        <n:room-seating-capacity>4</n:room-seating-capacity>`,
        ),
    ).replaceAll('\n', '\r\n');
    await withProvider({ 'PROPFIND /remote.php/dav/principals/calendar-rooms/': rooms }, async provider => {
      const resources = await provider.resources();
      expect(resources.map(({ name, email, capacity, equipment }) => ({ name, email, capacity, equipment }))).toEqual([
        { name: 'Sal A & B', email: 'sal-a@clew.test', capacity: 12, equipment: ['Projektor', 'Whiteboard'] },
        { name: 'Östra salen', email: 'sal-o@clew.test', capacity: 4, equipment: [] },
      ]);
    });
  });

  test('a calendar report preserves CRLF iCalendar text, revisions and chronological order', async () => {
    const meeting = (uid: string, title: string, hour: string) =>
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Clew contract test//EN',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `SUMMARY:${title}`,
        'DTSTAMP:20261104T080000Z',
        `DTSTART:20261109T${hour}0000Z`,
        `DTEND:20261109T${hour}3000Z`,
        'ORGANIZER:mailto:hillevi@clew.test',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n');
    const report = multistatus(
      properties(
        `${primary}late.ics`,
        `<d:getetag>&quot;rev-late&quot;</d:getetag><c:calendar-data><![CDATA[${meeting('late', 'Möte & planering', '13')}]]></c:calendar-data>`,
      ) +
        properties(
          `${primary}early.ics`,
          `<d:getetag>&quot;rev-early&quot;</d:getetag><c:calendar-data><![CDATA[${meeting('early', 'Utvecklingssamtal', '09')}]]></c:calendar-data>`,
        ),
    );
    await withProvider({ ...discovery, [`REPORT ${primary}`]: report }, async provider => {
      const events = await provider.list(start, end);
      expect(
        events.map(({ uid, title, start, end, revision, canCancel }) => ({
          uid,
          title,
          start,
          end,
          revision,
          canCancel,
        })),
      ).toEqual([
        {
          uid: 'early',
          title: 'Utvecklingssamtal',
          start: '2026-11-09T09:00:00.000Z',
          end: '2026-11-09T09:30:00.000Z',
          revision: '"rev-early"',
          canCancel: true,
        },
        {
          uid: 'late',
          title: 'Möte & planering',
          start: '2026-11-09T13:00:00.000Z',
          end: '2026-11-09T13:30:00.000Z',
          revision: '"rev-late"',
          canCancel: true,
        },
      ]);
    });
  });

  test('free-busy replies retain busy periods and leave an unanswered person unknown', async () => {
    const calendar = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Clew contract test//EN',
      'BEGIN:VFREEBUSY',
      'UID:availability',
      'DTSTAMP:20261104T080000Z',
      'DTSTART:20261109T000000Z',
      'DTEND:20261110T000000Z',
      'FREEBUSY;FBTYPE=BUSY:20261109T090000Z/PT1H',
      'FREEBUSY;FBTYPE=FREE:20261109T100000Z/20261109T110000Z',
      'END:VFREEBUSY',
      'END:VCALENDAR',
      '',
    ].join('\r\n');
    const reply = `<c:schedule-response xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:">
      <c:response><c:recipient><d:href>mailto:anna@clew.test</d:href></c:recipient>
      <c:request-status>2.0;Success</c:request-status><c:calendar-data><![CDATA[${calendar}]]></c:calendar-data>
      </c:response></c:schedule-response>`;
    await withProvider({ ...discovery, [`POST ${outbox}`]: reply }, async provider => {
      expect(
        await provider.freeBusy(start, end, [
          { ref: 'anna', email: 'anna@clew.test' },
          { ref: 'hassan', email: 'hassan@clew.test' },
        ]),
      ).toEqual([
        { ref: 'anna', state: 'known', busy: [{ start: '2026-11-09T09:00:00.000Z', end: '2026-11-09T10:00:00.000Z' }] },
        { ref: 'hassan', state: 'unknown', busy: [] },
      ]);
    });
  });
});

/** A calendar of `.ics` files the provider reads with GET and writes with PUT, each with its own ETag. */
async function withCalendar(
  files: Record<string, string>,
  account: { email: string; name: string },
  check: (provider: NextcloudProvider, written: string[]) => Promise<void>,
) {
  const stored = new Map(Object.entries(files).map(([uid, body]) => [`${primary}${uid}.ics`, { body, etag: '"1"' }]));
  const written: string[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const listing = discovery[`${request.method} ${path}` as keyof typeof discovery];
      if (listing) return new Response(listing, { status: 207, headers: { 'Content-Type': 'application/xml' } });
      const file = stored.get(path);
      if (request.method === 'GET' && file) return new Response(file.body, { headers: { ETag: file.etag } });
      if (request.method === 'PUT' && file && request.headers.get('If-Match') === file.etag) {
        const body = await request.text();
        written.push(body);
        stored.set(path, { body, etag: `"${Number(file.etag.slice(1, -1)) + 1}"` });
        return new Response(null, { status: 204 });
      }
      return new Response('Unknown DAV resource', { status: 404 });
    },
  });
  try {
    await check(new NextcloudProvider('hillevi', 'synthetic-test-password', account, server.url.href), written);
  } finally {
    await server.stop(true);
  }
}
const ics = (event: string[], ...zones: string[][]) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Another client//EN',
    ...zones.flat(),
    'BEGIN:VEVENT',
    'DTSTAMP:20261104T080000Z',
    'SUMMARY:Avstämning',
    ...event,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
/** A zone with one fixed offset, under a name no zone database has. */
const fixedZone = (tzid: string, offset: string) => [
  'BEGIN:VTIMEZONE',
  `TZID:${tzid}`,
  'BEGIN:STANDARD',
  'DTSTART:19700101T000000',
  `TZOFFSETFROM:${offset}`,
  `TZOFFSETTO:${offset}`,
  'END:STANDARD',
  'END:VTIMEZONE',
];
const hillevi = { email: 'hillevi.berg@kommun.example', name: 'Hillevi Berg' };

describe('whose event it is (DE-M8)', () => {
  test('the account is the address Clew’s directory has, never the sign-in name at a fixed domain', async () => {
    const files = {
      own: ics([
        'UID:own',
        'DTSTART:20261109T090000Z',
        'DTEND:20261109T100000Z',
        'ORGANIZER:mailto:HILLEVI.BERG@kommun.example',
      ]),
      guessed: ics([
        'UID:guessed',
        'DTSTART:20261109T090000Z',
        'DTEND:20261109T100000Z',
        'ORGANIZER:mailto:hillevi@clew.test',
      ]),
      invited: ics([
        'UID:invited',
        'DTSTART:20261109T090000Z',
        'DTEND:20261109T100000Z',
        'ORGANIZER:mailto:anna@kommun.example',
        'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:hillevi.berg@kommun.example',
      ]),
    };
    await withCalendar(files, hillevi, async provider => {
      expect(provider.account).toEqual({ ref: 'nextcloud:account:hillevi', ...hillevi });
      const read = async (uid: string) => (await provider.lookup(await provider.eventRef(uid)))!;
      const own = await read('own'),
        guessed = await read('guessed'),
        invited = await read('invited');
      expect(own.canCancel).toBe(true);
      expect(guessed.canCancel).toBe(false);
      expect(invited.canCancel).toBe(false);
      expect(invitedParticipant(invited, provider.account)).toMatchObject({ email: 'hillevi.berg@kommun.example' });
    });
  });
  test('an appointment without an organiser is the owner’s own, not someone else’s invitation', async () => {
    const files = { alone: ics(['UID:alone', 'DTSTART:20261109T090000Z', 'DTEND:20261109T100000Z']) };
    await withCalendar(files, hillevi, async provider => {
      const event = (await provider.lookup(await provider.eventRef('alone')))!;
      expect(event).toMatchObject({ organizer: '', canCancel: true });
      expect(invitedParticipant(event, provider.account)).toBeUndefined();
    });
  });
});

describe('time zones as each file writes them (DE-L14)', () => {
  const at = async (provider: NextcloudProvider, uid: string) => {
    const event = (await provider.lookup(await provider.eventRef(uid)))!;
    return [event.start, event.end];
  };
  test('a zone a file defines is read with that file’s definition and never reaches another file', async () => {
    const files = {
      first: ics(
        ['UID:first', 'DTSTART;TZID=Kontoret:20261109T090000', 'DTEND;TZID=Kontoret:20261109T100000'],
        fixedZone('Kontoret', '+0100'),
      ),
      second: ics(
        ['UID:second', 'DTSTART;TZID=Kontoret:20261109T090000', 'DTEND;TZID=Kontoret:20261109T100000'],
        fixedZone('Kontoret', '+0300'),
      ),
      third: ics(['UID:third', 'DTSTART;TZID=Kontoret:20261109T090000', 'DTEND;TZID=Kontoret:20261109T100000']),
    };
    await withCalendar(files, hillevi, async provider => {
      expect(await at(provider, 'first')).toEqual(['2026-11-09T08:00:00.000Z', '2026-11-09T09:00:00.000Z']);
      expect(await at(provider, 'second')).toEqual(['2026-11-09T06:00:00.000Z', '2026-11-09T07:00:00.000Z']);
      // The third names the zone without defining it, and no zone database has the name: it is refused, never guessed.
      await expect(provider.lookup(await provider.eventRef('third'))).rejects.toThrow(
        'Mötet har en tidszon som kalendern inte beskriver.',
      );
    });
  });
  test('a floating time is Clew’s zone, and a zone named by reference is the IANA zone, whatever the server’s zone', async () => {
    const files = {
      floating: ics(['UID:floating', 'DTSTART:20261109T090000', 'DTEND:20261109T093000']),
      summer: ics(['UID:summer', 'DTSTART:20260609T090000', 'DURATION:PT30M']),
      reference: ics(['UID:reference', 'DTSTART;TZID=America/New_York:20261109T090000', 'DURATION:PT1H']),
      // 02:30 on the last Sunday of March does not exist in Stockholm: read with the offset before the change.
      gap: ics(['UID:gap', 'DTSTART:20270328T023000', 'DTEND:20270328T040000']),
    };
    await withCalendar(files, hillevi, async provider => {
      expect(await at(provider, 'floating')).toEqual(['2026-11-09T08:00:00.000Z', '2026-11-09T08:30:00.000Z']);
      expect(await at(provider, 'summer')).toEqual(['2026-06-09T07:00:00.000Z', '2026-06-09T07:30:00.000Z']);
      expect(await at(provider, 'reference')).toEqual(['2026-11-09T14:00:00.000Z', '2026-11-09T15:00:00.000Z']);
      expect(await at(provider, 'gap')).toEqual(['2027-03-28T01:30:00.000Z', '2027-03-28T02:00:00.000Z']);
    });
  });
  test('a move writes the new times in UTC without the old zone, and the end itself instead of a length', async () => {
    const files = {
      zoned: ics(
        [
          'UID:zoned',
          'DTSTART;TZID=Kontoret:20261109T090000',
          'DURATION:PT30M',
          'ORGANIZER:mailto:hillevi.berg@kommun.example',
          'ATTENDEE;PARTSTAT=ACCEPTED:mailto:anna@kommun.example',
        ],
        fixedZone('Kontoret', '+0100'),
      ),
    };
    await withCalendar(files, hillevi, async (provider, written) => {
      const ref = await provider.eventRef('zoned');
      const moved = await provider.reschedule(ref, '"1"', '2026-11-10T08:00:00.000Z', '2026-11-10T09:00:00.000Z');
      expect([moved.start, moved.end]).toEqual(['2026-11-10T08:00:00.000Z', '2026-11-10T09:00:00.000Z']);
      const lines = written[0]!.split('\r\n');
      expect(lines).toContain('DTSTART:20261110T080000Z');
      expect(lines).toContain('DTEND:20261110T090000Z');
      expect(lines.filter(line => /^(DTSTART|DTEND);/.test(line) || line.startsWith('DURATION'))).toEqual([]);
      expect(lines).toContain('ATTENDEE;PARTSTAT=ACCEPTED:mailto:anna@kommun.example');
    });
  });
});
